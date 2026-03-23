/**
 * ui.ts — Plugin UI Logic
 *
 * Runs inside the plugin's sandboxed iframe. Handles the chat interface,
 * model selection, calling the AI service for text alternatives, and sending
 * apply-text commands to the plugin controller (main.ts).
 */

import { AIService } from "./services/ai-service";
import { UXWriterAgent } from "./agents/ux-writer-agent";
import { CustomAgentRegistry } from "./services/custom-agent-registry";
import type {
  ChatMessage,
  CopilotConfig,
  DocumentContext,
  LLMProvider,
  ModelConfig,
  PersistedSettings,
  PluginToUIMessage,
  SelectedTextContext,
  TextAlternative,
  ThemeMode,
} from "./types/ui-types";

declare global {
  interface Window {
    __AICOPILOT_UI_LOADED__?: boolean;
  }
}

window.__AICOPILOT_UI_LOADED__ = true;

// ── Constants ─────────────────────────────────────────────────────────────────

/** After this many milliseconds without a context refresh, warn the designer. */
const CONTEXT_STALE_MS = 10 * 60 * 1000; // 10 minutes

/** localStorage key for the user's functional/business context. */
const FUNCTIONAL_CONTEXT_KEY = "copilot_functional_context";

/** localStorage key for the active interaction mode. */
const INTERACTION_MODE_KEY = "copilot_interaction_mode";

/** localStorage key for the debug mode toggle. */
const DEBUG_MODE_KEY = "copilot_debug_mode";

/** localStorage key for the number of text alternatives to generate. */
const ALTERNATIVES_COUNT_KEY = "copilot_alternatives_count";

/** localStorage key for the UI theme preference. */
const THEME_KEY = "copilot_theme";

/** Default theme when no preference is stored. */
const DEFAULT_THEME: ThemeMode = "dark";

function createInMemoryStorage(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number): string | null {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, String(value));
    },
  };
}

function getSafeStorage(): Storage {
  try {
    const storage = window.localStorage;
    const probeKey = "__aicopilot_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return createInMemoryStorage();
  }
}

const safeStorage = getSafeStorage();

function redactSecrets(raw: unknown): string {
  const text = typeof raw === "string" ? raw : String(raw);
  return text
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "AIza***")
    .replace(/sk-ant-[A-Za-z0-9\-_]+/g, "sk-ant-***")
    .replace(/sk-[A-Za-z0-9\-_]{10,}/g, "sk-***")
    .replace(/ghp_[A-Za-z0-9]+/g, "ghp_***")
    .replace(/(key=)[^&\s]+/gi, "$1***");
}

// ── State ─────────────────────────────────────────────────────────────────────

/** Apply the given theme to the document and persist the preference. */
function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", theme);
  safeStorage.setItem(THEME_KEY, theme);
  const toggle = document.getElementById("theme-toggle") as HTMLInputElement | null;
  if (toggle) toggle.checked = theme === "dark";
  const lightLabel = document.getElementById("theme-label-light");
  const darkLabel = document.getElementById("theme-label-dark");
  if (lightLabel) lightLabel.classList.toggle("theme-switch-label--active", theme === "light");
  if (darkLabel) darkLabel.classList.toggle("theme-switch-label--active", theme === "dark");
}

/** Return the currently persisted theme, falling back to the default. */
function getStoredTheme(): ThemeMode {
  const stored = safeStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
}

// Apply theme as early as possible to avoid flash
applyTheme(getStoredTheme());

let documentContext: DocumentContext | null = null;
let chatHistory: ChatMessage[] = [];
let contextFetchedAt: number | null = null;

/**
 * Active interaction mode.
 *   "generate" → produce text alternatives (default)
 *   "ask"      → conversational UX writing Q&A, no text applied
 */
let interactionMode: "generate" | "ask" = "generate";

let typingBubbleEl: HTMLDivElement | null = null;

const aiService = new AIService();
const uxWriterAgent = new UXWriterAgent();
const registry = new CustomAgentRegistry();

// ── DOM References ────────────────────────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

// ── Initialise ────────────────────────────────────────────────────────────────

function initializeUI(): void {
  try {
    setupEventListeners();
  } catch {
    showToast("Some UI controls failed to initialize.", "warning");
  }

  try {
    registry.loadFromStorage(safeStorage);
    renderCustomConfigSummary();

    // Restore provider selection and sync model/key UI
    const savedProvider = (safeStorage.getItem("copilot_provider") as LLMProvider | null) ?? "gemini";
    const providerSelect = document.getElementById("provider-select") as HTMLSelectElement | null;
    if (providerSelect) providerSelect.value = savedProvider;
    syncProviderUI(savedProvider);

    // Restore debug mode
    const debugEl = document.getElementById("debug-mode") as HTMLInputElement | null;
    if (debugEl) debugEl.checked = safeStorage.getItem(DEBUG_MODE_KEY) === "1";

    // Restore theme selection in settings
    const themeToggleInit = document.getElementById("theme-toggle") as HTMLInputElement | null;
    if (themeToggleInit) themeToggleInit.checked = getStoredTheme() === "dark";

    // Restore functional context in settings textarea
    const savedContext = safeStorage.getItem(FUNCTIONAL_CONTEXT_KEY) ?? "";
    const contextInput = document.getElementById("functional-context-input") as HTMLTextAreaElement | null;
    if (contextInput) contextInput.value = savedContext;

    // Restore alternatives count
    const savedCount = safeStorage.getItem(ALTERNATIVES_COUNT_KEY);
    const countInput = document.getElementById("alternatives-count-input") as HTMLInputElement | null;
    if (countInput && savedCount) countInput.value = savedCount;

    // Restore interaction mode (generate | ask)
    const savedMode = safeStorage.getItem(INTERACTION_MODE_KEY);
    if (savedMode === "ask" || savedMode === "generate") {
      setInteractionMode(savedMode);
    }

    requestPersistedSettings();
    requestDocumentContext();
    requestOnboardingStatus();
  } catch {
    showToast("Settings initialization failed partially. Core actions remain available.", "warning");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeUI);
} else {
  initializeUI();
}

// ── Plugin → UI messages ──────────────────────────────────────────────────────

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUIMessage | undefined;
  if (!msg) return;

  switch (msg.type) {
    case "context-ready":
      documentContext = msg.context;
      showContextBadge(msg.context);
      break;

    case "selection-changed":
      handleSelectionChanged(msg.selectedText);
      break;

    case "text-applied":
      setGenerating(false);
      showToast("Text applied successfully.");
      break;

    case "onboarding-status":
      if (!msg.done) setupOnboarding();
      break;

    case "settings-loaded":
      if (msg.settings) {
        applyPersistedSettings(msg.settings);
      }
      break;

    case "error":
      setGenerating(false);
      hideAssistantTypingIndicator();
      appendAssistantMessage(`Error: ${redactSecrets(msg.message)}`);
      showToast(`Error: ${redactSecrets(msg.message)}`, "error");
      break;

    case "notify":
      showToast(msg.message);
      break;
  }
};

// ── Developer tools ───────────────────────────────────────────────────────────

/** Pending callback for the dev confirm modal. */
let devConfirmCallback: (() => void) | null = null;

function openDevConfirm(title: string, body: string, okLabel: string, onConfirm: () => void): void {
  const modal    = document.getElementById("confirm-dev-action");
  const titleEl  = document.getElementById("confirm-dev-title-text");
  const bodyEl   = document.getElementById("confirm-dev-body");
  const okLabelEl = document.getElementById("confirm-dev-ok-label");
  const okBtn    = document.getElementById("confirm-dev-ok-btn");

  if (titleEl)   titleEl.textContent  = title;
  if (bodyEl)    bodyEl.textContent   = body;
  if (okLabelEl) okLabelEl.textContent = okLabel;

  devConfirmCallback = onConfirm;

  // Wire the OK button (replace any previous listener by cloning)
  if (okBtn) {
    const fresh = okBtn.cloneNode(true) as HTMLElement;
    okBtn.parentNode?.replaceChild(fresh, okBtn);
    // Re-append label span since cloneNode copies children
    fresh.addEventListener("click", () => {
      closeDevConfirm();
      devConfirmCallback?.();
      devConfirmCallback = null;
    });
  }

  modal?.classList.remove("hidden");
}

function closeDevConfirm(): void {
  document.getElementById("confirm-dev-action")?.classList.add("hidden");
}

function restartOnboarding(): void {
  // Close settings panel if open
  document.getElementById("settings-view")?.classList.add("hidden");
  // Reset onboarding step and show the overlay
  onboardingStep = 0;
  setupOnboarding();
}

function resetAllData(): void {
  // Clear all persisted data
  safeStorage.clear();
  // Tell the plugin backend to reset the onboarding flag to false
  parent.postMessage({ pluginMessage: { type: "reset-onboarding" } }, "*");

  // In-place UI reset — do NOT reload (Figma won't re-send settings-loaded,
  // causing a white screen and re-restoring stale keys from clientStorage).

  // 1. Clear chat history
  const chatContainer = document.getElementById("chat-history");
  if (chatContainer) chatContainer.innerHTML = chatEmptyStateHTML();
  chatHistory = [];

  // 2. Reset provider to default and clear API key input
  const providerSelect = document.getElementById("provider-select") as HTMLSelectElement | null;
  if (providerSelect) providerSelect.value = "gemini";
  syncProviderUI("gemini");
  const keyInput = document.getElementById("api-key-input") as HTMLInputElement | null;
  if (keyInput) keyInput.value = "";

  // 3. Reset functional context
  const contextInput = document.getElementById("functional-context-input") as HTMLTextAreaElement | null;
  if (contextInput) contextInput.value = "";

  // 4. Reset debug mode
  const debugEl = document.getElementById("debug-mode") as HTMLInputElement | null;
  if (debugEl) debugEl.checked = false;

  // 5. Reset interaction mode
  setInteractionMode("generate");

  // 6. Apply default theme
  applyTheme(DEFAULT_THEME);

  // 7. Close settings panel if open
  document.getElementById("settings-view")?.classList.add("hidden");

  // 8. Show onboarding overlay
  onboardingStep = 0;
  setupOnboarding();
}

// ── Event listeners ───────────────────────────────────────────────────────────

function setupEventListeners(): void {
  const generateBtn = getEl<HTMLButtonElement>("generate-btn");
  const promptInput = getEl<HTMLTextAreaElement>("prompt-input");
  const clearBtn = getEl<HTMLButtonElement>("clear-btn");
  const apiKeyToggle = getEl<HTMLButtonElement>("api-key-toggle");

  // Single action button dispatches to the active mode handler
  generateBtn.addEventListener("click", () => {
    if (interactionMode === "ask") {
      void handleAsk();
    } else {
      void handleGenerate();
    }
  });

  promptInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (interactionMode === "ask") {
        void handleAsk();
      } else {
        void handleGenerate();
      }
    }
  });

  clearBtn.addEventListener("click", openNewConvoConfirm);
  apiKeyToggle.addEventListener("click", toggleApiKeyVisibility);

  // ── Mode tabs ───────────────────────────────────────────────────────────
  const tabGenerate = document.getElementById("mode-tab-generate");
  const tabAsk      = document.getElementById("mode-tab-ask");
  if (tabGenerate) tabGenerate.addEventListener("click", () => setInteractionMode("generate"));
  if (tabAsk)      tabAsk.addEventListener("click",      () => setInteractionMode("ask"));

  // ── Alternatives count input ────────────────────────────────────────────
  const countInput = document.getElementById("alternatives-count-input") as HTMLInputElement | null;
  if (countInput) {
    countInput.addEventListener("change", () => {
      safeStorage.setItem(ALTERNATIVES_COUNT_KEY, countInput.value);
    });
  }

  // ── Provider selection ─────────────────────────────────────────────────
  const providerSelect = document.getElementById("provider-select") as HTMLSelectElement | null;
  if (providerSelect) {
    providerSelect.addEventListener("change", () => {
      const provider = providerSelect.value as LLMProvider;
      safeStorage.setItem("copilot_provider", provider);
      syncProviderUI(provider);
      persistSettingsToPlugin();
    });
  }

  // ── Model selection: persist per provider ──────────────────────────────
  const modelSelect = document.getElementById("model-select") as HTMLSelectElement | null;
  if (modelSelect) {
    modelSelect.addEventListener("change", () => {
      const provider = getSelectedProvider();
      safeStorage.setItem(`copilot_model_${provider}`, modelSelect.value);
      updateConnectionBadge();
      persistSettingsToPlugin();
    });
  }

  // ── API key: persist per provider on change ────────────────────────────
  const apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement | null;
  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", () => {
      const provider = getSelectedProvider();
      const storageKey = PROVIDER_KEY_INFO[provider].storageKey;
      safeStorage.setItem(storageKey, apiKeyInput.value.trim());
      updateConnectionBadge();
      persistSettingsToPlugin();
    });
  }

  // ── Debug mode checkbox ─────────────────────────────────────────────────
  const debugCheckbox = document.getElementById("debug-mode") as HTMLInputElement | null;
  if (debugCheckbox) {
    debugCheckbox.addEventListener("change", () => {
      safeStorage.setItem(DEBUG_MODE_KEY, debugCheckbox.checked ? "1" : "0");
      persistSettingsToPlugin();
    });
  }

  // ── Theme toggle ─────────────────────────────────────────────────────────
  const themeToggle = document.getElementById("theme-toggle") as HTMLInputElement | null;
  if (themeToggle) {
    themeToggle.addEventListener("change", () => {
      const theme: ThemeMode = themeToggle.checked ? "dark" : "light";
      applyTheme(theme);
      persistSettingsToPlugin();
    });
  }

  // ── Functional context: persist on change ──────────────────────────────
  const contextInput = document.getElementById("functional-context-input") as HTMLTextAreaElement | null;
  if (contextInput) {
    contextInput.addEventListener("input", () => {
      safeStorage.setItem(FUNCTIONAL_CONTEXT_KEY, contextInput.value.trim());
      persistSettingsToPlugin();
    });
  }

  // ── Custom skills: file-drop zone ───────────────────────────────────────
  setupDropZone();

  // ── Custom skills: file picker fallback ────────────────────────────────
  const fileInput = document.getElementById("config-file-input") as HTMLInputElement | null;
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) void loadConfigFile(file);
      fileInput.value = "";
    });
  }

  // ── Custom skills: clear button ─────────────────────────────────────────
  const clearCustomBtn = document.getElementById("clear-custom-btn");
  if (clearCustomBtn) {
    clearCustomBtn.addEventListener("click", clearCustomConfig);
  }

  // ── Test connection button ───────────────────────────────────────────────
  const testConnectionBtn = document.getElementById("test-connection-btn");
  if (testConnectionBtn) {
    testConnectionBtn.addEventListener("click", () => void handleTestConnection());
  }

  // ── Developer: Restart onboarding ───────────────────────────────────────
  const restartOnboardingBtn = document.getElementById("restart-onboarding-btn");
  if (restartOnboardingBtn) {
    restartOnboardingBtn.addEventListener("click", () => {
      openDevConfirm(
        "Restart onboarding?",
        "The setup wizard will open again. Your settings and API keys will be kept.",
        "Restart",
        restartOnboarding
      );
    });
  }

  // ── Developer: Reset all data ────────────────────────────────────────────
  const resetAllDataBtn = document.getElementById("reset-all-data-btn");
  if (resetAllDataBtn) {
    resetAllDataBtn.addEventListener("click", () => {
      openDevConfirm(
        "Reset all data?",
        "This will permanently erase all settings, API keys, and plugin data. This cannot be undone.",
        "Reset all data",
        resetAllData
      );
    });
  }

  // ── Developer confirm modal wiring ──────────────────────────────────────
  const devCancelBtn = document.getElementById("confirm-dev-cancel-btn");
  if (devCancelBtn) {
    devCancelBtn.addEventListener("click", closeDevConfirm);
  }
}

// ── Core: Generate alternatives ───────────────────────────────────────────────

async function handleGenerate(): Promise<void> {
  const promptEl = getEl<HTMLTextAreaElement>("prompt-input");
  const prompt = promptEl.value.trim();
  if (!prompt) {
    showToast("Please enter a wording instruction.", "warning");
    return;
  }

  const modelConfig = getModelConfig();
  const missingKeyMsg = validateApiKey(modelConfig);
  if (missingKeyMsg) {
    showToast(missingKeyMsg, "warning");
    return;
  }

  const context: DocumentContext = documentContext ?? {
    designSystem: { components: [], colors: [], textStyles: [] },
    screens: [],
    pages: [],
    pageTextContext: [],
    selectedText: null,
  };

  // Warn the designer if the Figma context snapshot is older than CONTEXT_STALE_MS.
  if (documentContext && contextFetchedAt !== null && Date.now() - contextFetchedAt > CONTEXT_STALE_MS) {
    requestDocumentContext();
  }

  const count = getAlternativesCount();
  const fullContext = buildFullFunctionalContext();

  appendUserMessage(prompt);
  promptEl.value = "";
  setGenerating(true);
  showAssistantTypingIndicator();

  try {
    const alternatives = await uxWriterAgent.generate(
      prompt,
      count,
      context,
      modelConfig,
      chatHistory,
      fullContext || undefined
    );

    hideAssistantTypingIndicator();

    if (alternatives.length === 0) {
      appendAssistantMessage("No alternatives generated. Please refine your instruction.");
    } else {
      appendAlternativesMessage(alternatives);
    }

    chatHistory.push({ role: "user", content: prompt });
    chatHistory.push({
      role: "assistant",
      content: alternatives.map((a) => `• ${a.text}`).join("\n"),
    });
  } catch (err) {
    setGenerating(false);
    hideAssistantTypingIndicator();
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    appendAssistantMessage(`Error: ${message}`);
    chatHistory.push({ role: "user", content: prompt });
    chatHistory.push({ role: "assistant", content: `Error: ${message}` });
    showToast(message, "error");
  } finally {
    setGenerating(false);
  }
}

// ── Core: Ask ─────────────────────────────────────────────────────────────────

/**
 * Handle a user question in "Ask" mode.
 * Sends the question to the LLM as a conversational UX writing Q&A request.
 * No text is applied to Figma — the AI response is shown directly in the chat.
 */
async function handleAsk(): Promise<void> {
  const promptEl = getEl<HTMLTextAreaElement>("prompt-input");
  const question = promptEl.value.trim();
  if (!question) {
    showToast("Please enter a question.", "warning");
    return;
  }

  const modelConfig = getModelConfig();
  const missingKeyMsg = validateApiKey(modelConfig);
  if (missingKeyMsg) {
    showToast(missingKeyMsg, "warning");
    return;
  }

  const context: DocumentContext = documentContext ?? {
    designSystem: { components: [], colors: [], textStyles: [] },
    screens: [],
    pages: [],
    pageTextContext: [],
    selectedText: null,
  };

  appendUserMessage(question);
  promptEl.value = "";
  setGenerating(true);
  showAssistantTypingIndicator();

  try {
    const answer = await aiService.ask(question, context, modelConfig, chatHistory);

    hideAssistantTypingIndicator();
    appendAssistantMessage(answer);
    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: answer });
  } catch (err) {
    hideAssistantTypingIndicator();
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    appendAssistantMessage(`Error: ${message}`);
    chatHistory.push({ role: "user", content: question });
    chatHistory.push({ role: "assistant", content: `Error: ${message}` });
    showToast(message, "error");
  } finally {
    hideAssistantTypingIndicator();
    setGenerating(false);
  }
}

// ── Apply text to Figma ───────────────────────────────────────────────────────

/**
 * Send a text alternative to the plugin controller to apply it to the
 * currently selected TextNode in Figma.
 */
function applyTextToFigma(text: string): void {
  parent.postMessage(
    { pluginMessage: { type: "apply-text", text } },
    "*"
  );
}

// ── Mode switching ────────────────────────────────────────────────────────────

function setInteractionMode(mode: "generate" | "ask"): void {
  interactionMode = mode;
  safeStorage.setItem(INTERACTION_MODE_KEY, mode);
  persistSettingsToPlugin();

  const inputSection = document.getElementById("input-section");
  const tabGenerate  = document.getElementById("mode-tab-generate");
  const tabAsk       = document.getElementById("mode-tab-ask");
  const promptEl     = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
  const generateLabel = document.getElementById("generate-label");
  const generateIcon  = document.getElementById("generate-icon");
  const optionsBar    = document.getElementById("options-bar");

  if (mode === "ask") {
    inputSection?.classList.add("mode--ask");
    tabAsk?.classList.add("mode-tab--active");
    tabGenerate?.classList.remove("mode-tab--active");
    tabAsk?.setAttribute("aria-selected", "true");
    tabGenerate?.setAttribute("aria-selected", "false");
    if (promptEl) promptEl.placeholder = "Ask a UX writing question…";
    if (generateLabel) generateLabel.textContent = "Ask";
    if (generateIcon) generateIcon.className = "fa-solid fa-comments";
    if (optionsBar) optionsBar.classList.add("hidden");
  } else {
    inputSection?.classList.remove("mode--ask");
    tabGenerate?.classList.add("mode-tab--active");
    tabAsk?.classList.remove("mode-tab--active");
    tabGenerate?.setAttribute("aria-selected", "true");
    tabAsk?.setAttribute("aria-selected", "false");
    if (promptEl) promptEl.placeholder = "Describe the wording you need…";
    if (generateLabel) generateLabel.textContent = "Generate";
    if (generateIcon) generateIcon.className = "fa-solid fa-wand-magic-sparkles";
    if (optionsBar) optionsBar.classList.remove("hidden");
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

function requestDocumentContext(): void {
  parent.postMessage({ pluginMessage: { type: "get-context" } }, "*");
  showToast("Refreshing document context…");
}

function requestPersistedSettings(): void {
  parent.postMessage({ pluginMessage: { type: "get-settings" } }, "*");
}

function requestOnboardingStatus(): void {
  parent.postMessage({ pluginMessage: { type: "get-onboarding-status" } }, "*");
}

function showContextBadge(context: DocumentContext): void {
  contextFetchedAt = Date.now();
  const badge = document.getElementById("ctx-badge");
  if (!badge) return;

  const hasSelectedText = context.selectedText !== null;
  const screenCount = context.screens.length;
  const selectedLabel = hasSelectedText
    ? `"${context.selectedText!.characters.slice(0, 30)}${context.selectedText!.characters.length > 30 ? "…" : ""}"`
    : "none";

  badge.textContent = hasSelectedText ? "Text selected" : `${String(screenCount)} screens`;
  const refreshedAt = new Date(contextFetchedAt).toLocaleTimeString();
  badge.title = [
    `Refreshed: ${refreshedAt}`,
    `Selected text: ${selectedLabel}`,
    `Screens: ${context.screens.join(", ") || "none"}`,
  ].join("\n");
  badge.classList.remove("hidden", "ctx-badge--stale");
}

/**
 * Called whenever the Figma selection changes. Patches the in-memory
 * documentContext with the newly selected text so the next generation
 * automatically uses the right node — without a full context round-trip.
 */
function handleSelectionChanged(selectedText: SelectedTextContext | null): void {
  if (documentContext) {
    documentContext = { ...documentContext, selectedText };
  } else {
    // No context loaded yet — build a minimal shell so selectedText is available
    documentContext = {
      designSystem: { components: [], colors: [], textStyles: [] },
      screens: [],
      pages: [],
      pageTextContext: [],
      selectedText,
    };
  }

  // Refresh the badge to reflect the new selection
  showContextBadge(documentContext);
}

// ── Config helpers ────────────────────────────────────────────────────────────

/** Models available per provider, used to populate the model dropdown. */
const PROVIDER_MODELS: Record<LLMProvider, Array<{ value: string; label: string }>> = {
  "gemini": [
    { value: "gemini-flash-lite-latest", label: "Gemini Flash Lite" },
    { value: "gemini-flash-latest",      label: "Gemini Flash" },
    { value: "gemini-pro-latest",        label: "Gemini Pro" },
  ],
  openai: [
    { value: "gpt-5.4-nano", label: "GPT-5.4 nano" },
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
    { value: "gpt-5.4",      label: "GPT-5.4" },
  ],
  anthropic: [
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  ],
  mistral: [
    { value: "mistral-small-latest",  label: "Mistral Small" },
    { value: "mistral-medium-latest", label: "Mistral Medium" },
    { value: "mistral-large-latest",  label: "Mistral Large" },
  ],
};

/** Key labels and placeholders per provider for the API key input field. */
const PROVIDER_KEY_INFO: Record<LLMProvider, { label: string; placeholder: string; storageKey: string; hint: string; icon: string; instructionsHtml: string }> = {
  gemini: {
    label: "API Key",
    placeholder: "AIza… (Google AI Studio key)",
    storageKey: "copilot_gemini_key",
    hint: "Get your API key at aistudio.google.com/apikey.",
    icon: '<i class="fa-brands fa-google" aria-hidden="true"></i>',
    instructionsHtml: `<div class="ob-inst-header"><i class="fa-brands fa-google" aria-hidden="true"></i> Gemini — How to get your API key</div><ol><li>Go to <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com/apikey</a>.</li><li>Click <strong>Create API key</strong>.</li><li>Copy the key (<code>AIza…</code>) and paste it in the field above.</li></ol><p class="ob-inst-note">Ensure your Google account has Gemini API access. Errors 400/401/429 are shown in the chat.</p>`,
  },
  openai: {
    label: "API Key",
    placeholder: "sk-… (OpenAI API key)",
    storageKey: "copilot_openai_key",
    hint: "Get your API key at platform.openai.com/api-keys.",
    icon: '<i class="fa-brands fa-openai" aria-hidden="true"></i>',
    instructionsHtml: `<div class="ob-inst-header"><i class="fa-brands fa-openai" aria-hidden="true"></i> OpenAI — How to get your API key</div><ol><li>Go to <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com/api-keys</a>.</li><li>Click <strong>Create new secret key</strong>.</li><li>Copy the key (<code>sk-…</code>) and paste it in the field above.</li></ol><p class="ob-inst-note">Ensure your account has sufficient credits. Errors 401/429 are shown in the chat.</p>`,
  },
  anthropic: {
    label: "API Key",
    placeholder: "sk-ant-… (Anthropic API key)",
    storageKey: "copilot_anthropic_key",
    hint: "Get your API key at console.anthropic.com → API Keys.",
    icon: '<svg class="icon icon--fill" aria-hidden="true"><use href="#icon-anthropic"/></svg>',
    instructionsHtml: `<div class="ob-inst-header"><svg class="icon icon--fill" aria-hidden="true"><use href="#icon-anthropic"/></svg> Anthropic — How to get your API key</div><ol><li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com → API Keys</a>.</li><li>Click <strong>Create key</strong>.</li><li>Copy the key (<code>sk-ant-…</code>) and paste it in the field above.</li></ol><p class="ob-inst-note">Errors 401/429 are surfaced in the chat with a descriptive message.</p>`,
  },
  mistral: {
    label: "API Key",
    placeholder: "… (Mistral API key)",
    storageKey: "copilot_mistral_key",
    hint: "Get your API key at console.mistral.ai.",
    icon: '<span class="provider-icon-badge" aria-hidden="true">M</span>',
    instructionsHtml: `<div class="ob-inst-header">Mistral — How to get your API key</div><ol><li>Go to <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener noreferrer">console.mistral.ai → API Keys</a>.</li><li>Click <strong>Create new key</strong>.</li><li>Copy the key and paste it in the field above.</li></ol><p class="ob-inst-note">Errors 401/429 are surfaced in the chat with a descriptive message.</p>`,
  },
};

function syncProviderUI(provider: LLMProvider): void {
  const modelSelect = getEl<HTMLSelectElement>("model-select");
  const keyInput = getEl<HTMLInputElement>("api-key-input");

  modelSelect.innerHTML = "";
  for (const { value, label } of PROVIDER_MODELS[provider]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    modelSelect.appendChild(opt);
  }

  const savedModel = safeStorage.getItem(`copilot_model_${provider}`);
  if (savedModel) modelSelect.value = savedModel;

  const info = PROVIDER_KEY_INFO[provider];
  const keyLabelText = document.getElementById("api-key-label-text");
  if (keyLabelText) keyLabelText.textContent = info.label;
  keyInput.placeholder = info.placeholder;

  const keyHint = document.getElementById("api-key-hint");
  if (keyHint) keyHint.textContent = info.hint;

  const savedKey = safeStorage.getItem(info.storageKey) ?? "";
  keyInput.value = savedKey;

  updateConnectionBadge();
}

function getSelectedProvider(): LLMProvider {
  const el = document.getElementById("provider-select") as HTMLSelectElement | null;
  return (el?.value as LLMProvider) ?? "gemini";
}

function collectPersistedSettings(): PersistedSettings {
  const provider = getSelectedProvider();
  const functionalContext = (
    (document.getElementById("functional-context-input") as HTMLTextAreaElement | null)?.value ?? ""
  ).trim();

  const modelByProvider: Partial<Record<LLMProvider, ModelConfig["model"]>> = {
    gemini: (safeStorage.getItem("copilot_model_gemini") as ModelConfig["model"] | null) ?? undefined,
    openai: (safeStorage.getItem("copilot_model_openai") as ModelConfig["model"] | null) ?? undefined,
    anthropic: (safeStorage.getItem("copilot_model_anthropic") as ModelConfig["model"] | null) ?? undefined,
    mistral: (safeStorage.getItem("copilot_model_mistral") as ModelConfig["model"] | null) ?? undefined,
  };

  const apiKeyByProvider: Partial<Record<LLMProvider, string>> = {
    gemini: safeStorage.getItem(PROVIDER_KEY_INFO.gemini.storageKey) ?? undefined,
    openai: safeStorage.getItem(PROVIDER_KEY_INFO.openai.storageKey) ?? undefined,
    anthropic: safeStorage.getItem(PROVIDER_KEY_INFO.anthropic.storageKey) ?? undefined,
    mistral: safeStorage.getItem(PROVIDER_KEY_INFO.mistral.storageKey) ?? undefined,
  };

  return {
    provider,
    modelByProvider,
    apiKeyByProvider,
    interactionMode,
    functionalContext,
    debugMode: getDebugMode(),
    theme: getStoredTheme(),
  };
}

function persistSettingsToPlugin(): void {
  parent.postMessage(
    {
      pluginMessage: {
        type: "save-settings",
        settings: collectPersistedSettings(),
      },
    },
    "*"
  );
}

function applyPersistedSettings(settings: PersistedSettings): void {
  safeStorage.setItem("copilot_provider", settings.provider);

  for (const provider of ["gemini", "openai", "anthropic", "mistral"] as const) {
    const model = settings.modelByProvider[provider];
    if (model) safeStorage.setItem(`copilot_model_${provider}`, model);

    const key = settings.apiKeyByProvider[provider];
    if (typeof key === "string") {
      safeStorage.setItem(PROVIDER_KEY_INFO[provider].storageKey, key);
    }
  }

  safeStorage.setItem(INTERACTION_MODE_KEY, settings.interactionMode);
  safeStorage.setItem(FUNCTIONAL_CONTEXT_KEY, settings.functionalContext);

  const providerSelect = document.getElementById("provider-select") as HTMLSelectElement | null;
  if (providerSelect) providerSelect.value = settings.provider;
  syncProviderUI(settings.provider);

  const contextInput = document.getElementById("functional-context-input") as HTMLTextAreaElement | null;
  if (contextInput) contextInput.value = settings.functionalContext;

  const debugModeEl = document.getElementById("debug-mode") as HTMLInputElement | null;
  if (debugModeEl) {
    debugModeEl.checked = settings.debugMode ?? false;
    safeStorage.setItem(DEBUG_MODE_KEY, settings.debugMode ? "1" : "0");
  }

  setInteractionMode(settings.interactionMode);
  updateConnectionBadge();

  // Apply theme from persisted settings
  const theme = settings.theme ?? DEFAULT_THEME;
  applyTheme(theme);
}

function getDebugMode(): boolean {
  const el = document.getElementById("debug-mode") as HTMLInputElement | null;
  return el?.checked ?? false;
}

function getModelConfig(): ModelConfig {
  const provider = getSelectedProvider();
  const modelEl = getEl<HTMLSelectElement>("model-select");
  const keyInput = getEl<HTMLInputElement>("api-key-input");
  const keyValue = keyInput.value.trim();

  const config: ModelConfig = {
    provider,
    model: modelEl.value as ModelConfig["model"],
    debug: getDebugMode(),
  };

  if (provider === "gemini") {
    config.geminiKey = keyValue || undefined;
  } else if (provider === "openai") {
    config.openaiKey = keyValue || undefined;
  } else if (provider === "anthropic") {
    config.anthropicKey = keyValue || undefined;
  } else if (provider === "mistral") {
    config.mistralKey = keyValue || undefined;
  }

  return config;
}

function validateApiKey(config: ModelConfig): string | null {
  switch (config.provider) {
    case "gemini":
      return config.geminiKey
        ? null
        : "Please enter your Google AI Studio API key (AIza…) in the settings.";
    case "openai":
      return config.openaiKey
        ? null
        : "Please enter your OpenAI API key (sk-…) in the settings.";
    case "anthropic":
      return config.anthropicKey
        ? null
        : "Please enter your Anthropic API key (sk-ant-…) in the settings.";
    case "mistral":
    default:
      return config.mistralKey
        ? null
        : "Please enter your Mistral API key in the settings.";
  }
}

function getAlternativesCount(): number {
  const el = document.getElementById("alternatives-count-input") as HTMLInputElement | null;
  if (!el) return 3;
  const val = parseInt(el.value, 10);
  return isNaN(val) || val < 1 ? 3 : Math.min(val, 10);
}

/** Returns the functional context text entered by the user. */
function getFunctionalContext(): string {
  return (safeStorage.getItem(FUNCTIONAL_CONTEXT_KEY) ?? "").trim();
}

/**
 * Build an additional system-prompt block from user-provided custom skills.
 */
function buildCustomSkillsAddition(): string {
  const skills = registry.getSkills();
  if (skills.length === 0) return "";
  return skills.map((s) => s.promptModifier).join("\n\n");
}

function buildFullFunctionalContext(): string {
  const parts: string[] = [];
  const ctx = getFunctionalContext();
  if (ctx) parts.push(ctx);
  const customSkills = buildCustomSkillsAddition();
  if (customSkills) parts.push(customSkills);
  return parts.join("\n\n");
}

// ── Chat UI helpers ───────────────────────────────────────────────────────────

function chatEmptyStateHTML(): string {
  if (interactionMode === "ask") {
    return `<div class="chat-empty" id="chat-empty-state">
    <div class="chat-empty__icon">
      <i class="fa-solid fa-comments" aria-hidden="true"></i>
    </div>
    <p class="chat-empty__title">Ask a UX writing question</p>
    <p class="chat-empty__subtitle">Get advice on wording, microcopy, tone of voice,<br>or content strategy.</p>
  </div>`;
  }
  return `<div class="chat-empty" id="chat-empty-state">
    <div class="chat-empty__icon">
      <i class="fa-solid fa-pen-nib" aria-hidden="true"></i>
    </div>
    <p class="chat-empty__title">Generate text alternatives</p>
    <p class="chat-empty__subtitle">Select a text node in Figma, describe what you need,<br>and click Generate.</p>
  </div>`;
}

function appendUserMessage(content: string): void {
  appendChatMessage("user", content);
}

function appendAssistantMessage(content: string): void {
  appendChatMessage("assistant", content);
}

function appendChatMessage(role: "user" | "assistant", content: string): void {
  const container = getEl<HTMLDivElement>("chat-history");

  const emptyState = document.getElementById("chat-empty-state");
  if (emptyState) emptyState.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${role}`;

  const label = document.createElement("span");
  label.className = "chat-label";
  label.textContent = role === "user" ? "You" : "AI";

  const text = document.createElement("p");
  text.className = "chat-text";
  text.textContent = content;

  bubble.appendChild(label);
  bubble.appendChild(text);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

/**
 * Render a list of text alternatives in the chat.
 * Each alternative has a "Apply" button that sends it to Figma.
 */
function appendAlternativesMessage(alternatives: TextAlternative[]): void {
  const container = getEl<HTMLDivElement>("chat-history");

  const emptyState = document.getElementById("chat-empty-state");
  if (emptyState) emptyState.remove();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--assistant";

  const label = document.createElement("span");
  label.className = "chat-label";
  label.textContent = "AI";

  const intro = document.createElement("p");
  intro.className = "chat-text";
  intro.textContent = `${String(alternatives.length)} alternative${alternatives.length !== 1 ? "s" : ""} generated:`;

  bubble.appendChild(label);
  bubble.appendChild(intro);

  const list = document.createElement("ul");
  list.className = "alternatives-list";

  for (const alt of alternatives) {
    const item = document.createElement("li");
    item.className = "alternative-item";

    const textSpan = document.createElement("span");
    textSpan.className = "alternative-text";
    textSpan.textContent = alt.text;

    const rationaleSpan = document.createElement("span");
    rationaleSpan.className = "alternative-rationale";
    rationaleSpan.textContent = alt.rationale ?? "";

    const applyBtn = document.createElement("button");
    applyBtn.className = "btn btn--ghost btn--sm alternative-apply-btn";
    applyBtn.type = "button";
    applyBtn.textContent = "Apply";
    applyBtn.title = "Apply this text to the selected Figma text node";
    applyBtn.addEventListener("click", () => {
      applyTextToFigma(alt.text);
      showToast(`Applying: "${alt.text.slice(0, 40)}${alt.text.length > 40 ? "…" : ""}"`);
    });

    item.appendChild(textSpan);
    if (alt.rationale) item.appendChild(rationaleSpan);
    item.appendChild(applyBtn);
    list.appendChild(item);
  }

  bubble.appendChild(list);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

function showAssistantTypingIndicator(): void {
  if (typingBubbleEl) return;

  const container = getEl<HTMLDivElement>("chat-history");
  const emptyState = document.getElementById("chat-empty-state");
  if (emptyState) emptyState.remove();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--assistant";
  bubble.id = "chat-typing-bubble";

  const label = document.createElement("span");
  label.className = "chat-label";
  label.textContent = "AI";

  const text = document.createElement("p");
  text.className = "chat-text";
  text.innerHTML = [
    '<span class="chat-typing">',
    '  <span class="chat-typing__spinner" aria-hidden="true"></span>',
    '  <span class="chat-typing__label">Thinking…</span>',
    '</span>',
  ].join("");

  bubble.appendChild(label);
  bubble.appendChild(text);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  typingBubbleEl = bubble;
}

function hideAssistantTypingIndicator(): void {
  if (!typingBubbleEl) return;
  typingBubbleEl.remove();
  typingBubbleEl = null;
}

// ── New conversation confirmation ─────────────────────────────────────────────

function openNewConvoConfirm(): void {
  const overlay = document.getElementById("confirm-new-convo");
  if (!overlay) {
    // Fallback: no modal in DOM, clear directly
    clearHistory();
    return;
  }
  overlay.classList.remove("hidden");

  const okBtn     = document.getElementById("confirm-ok-btn");
  const cancelBtn = document.getElementById("confirm-cancel-btn");

  function close(): void {
    overlay!.classList.add("hidden");
    okBtn?.removeEventListener("click", onOk);
    cancelBtn?.removeEventListener("click", close);
    overlay!.removeEventListener("click", onBackdrop);
  }

  function onOk(): void {
    close();
    clearHistory();
  }

  function onBackdrop(e: MouseEvent): void {
    if (e.target === overlay) close();
  }

  okBtn?.addEventListener("click", onOk);
  cancelBtn?.addEventListener("click", close);
  overlay.addEventListener("click", onBackdrop);
}

function clearHistory(): void {
  const container = getEl<HTMLDivElement>("chat-history");
  container.innerHTML = chatEmptyStateHTML();
  chatHistory = [];
  showToast("New conversation started.");
}

// ── Generating state ──────────────────────────────────────────────────────────

function setGenerating(active: boolean): void {
  const btn = getEl<HTMLButtonElement>("generate-btn");
  const spinner = document.getElementById("spinner");
  const label = document.getElementById("generate-label");
  btn.disabled = active;
  if (label) {
    if (active) {
      label.textContent = interactionMode === "ask" ? "Asking…" : "Generating…";
    } else {
      label.textContent = interactionMode === "ask" ? "Ask" : "Generate";
    }
  }
  if (spinner) spinner.classList.toggle("hidden", !active);
}

// ── API key visibility ────────────────────────────────────────────────────────

function toggleApiKeyVisibility(): void {
  const input = getEl<HTMLInputElement>("api-key-input");
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  const iconEye      = document.getElementById("api-key-icon-eye");
  const iconEyeSlash = document.getElementById("api-key-icon-eye-slash");
  if (iconEye)      iconEye.classList.toggle("hidden", !isPassword);
  if (iconEyeSlash) iconEyeSlash.classList.toggle("hidden", isPassword);
}

// ── Connection badge ──────────────────────────────────────────────────────────

function updateConnectionBadge(): void {
  const dot  = document.getElementById("connection-dot");
  const text = document.getElementById("connection-text");
  if (!dot || !text) return;

  const provider = getSelectedProvider();
  const modelEl  = document.getElementById("model-select") as HTMLSelectElement | null;
  const keyInput = document.getElementById("api-key-input")  as HTMLInputElement  | null;
  const hasKey   = !!(keyInput?.value.trim());

  const providerLabels: Record<string, string> = {
    "gemini":    "Gemini",
    "openai":    "OpenAI",
    "anthropic": "Anthropic",
  };

  const providerShort = providerLabels[provider] ?? provider;
  const modelShort    = modelEl?.options[modelEl.selectedIndex]?.text ?? modelEl?.value ?? "—";

  const statusLabel = hasKey ? "API key configured" : "No API key — click to configure";
  dot.className    = hasKey ? "connection-dot connection-dot--ready" : "connection-dot";
  dot.title        = statusLabel;
  dot.setAttribute("aria-label", statusLabel);
  text.textContent = `${providerShort} · ${modelShort}`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message: string, level: "info" | "warning" | "error" = "info"): void {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast toast--${level} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

// ── Pluralize helper ──────────────────────────────────────────────────────────

function pluralize(count: number, singular: string): string {
  return `${String(count)} ${singular}${count !== 1 ? "s" : ""}`;
}

// ── Custom skills: config loading ─────────────────────────────────────────────

function setupDropZone(): void {
  const zone = document.getElementById("drop-zone");
  if (!zone) return;

  zone.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault();
    zone.classList.add("drop-zone--active");
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("drop-zone--active");
  });

  zone.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault();
    zone.classList.remove("drop-zone--active");

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.name.endsWith(".json")) {
        void loadConfigFile(file);
        return;
      }
    }

    showToast("Please drop a JSON config file.", "warning");
  });
}

async function loadConfigFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    const json = JSON.parse(text) as unknown;
    registry.load(json as CopilotConfig);
    registry.saveToStorage(safeStorage);
    renderCustomConfigSummary();
    showToast(
      `Loaded ${pluralize(registry.skillCount, "skill")} from ${file.name}.`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse config file.";
    showToast(message, "error");
  }
}

function clearCustomConfig(): void {
  registry.clear(safeStorage);
  renderCustomConfigSummary();
  showToast("Custom skills cleared.");
}

function renderCustomConfigSummary(): void {
  const summary = document.getElementById("custom-config-summary");
  if (!summary) return;

  const skills = registry.getSkills();

  if (skills.length === 0) {
    summary.textContent = "No custom config loaded.";
  } else {
    summary.textContent = `Skills: ${skills.map((s) => s.name).join(", ")}`;
  }
}

// ── Test connection ───────────────────────────────────────────────────────────

async function handleTestConnection(): Promise<void> {
  const btn = document.getElementById("test-connection-btn") as HTMLButtonElement | null;
  const statusEl = document.getElementById("test-connection-status");

  const modelConfig = getModelConfig();
  const missingKeyMsg = validateApiKey(modelConfig);
  if (missingKeyMsg) {
    showToast(missingKeyMsg, "warning");
    if (statusEl) {
      statusEl.textContent = "No API key configured";
      statusEl.className = "test-connection-status test-connection-status--warn";
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    const label = btn.querySelector<HTMLSpanElement>("#test-connection-label");
    if (label) label.textContent = "Testing…";
  }
  if (statusEl) {
    statusEl.textContent = "Testing connection…";
    statusEl.className = "test-connection-status";
  }

  try {
    const emptyContext: DocumentContext = {
      designSystem: { components: [], colors: [], textStyles: [] },
      screens: [],
      pages: [],
      pageTextContext: [],
      selectedText: null,
    };

    const timeoutMs = 15000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("Connection test timed out after 15s. Check your API key, provider status, or network policy."));
      }, timeoutMs);
    });

    await Promise.race([
      aiService.ask("Reply with the single word: ok", emptyContext, modelConfig),
      timeoutPromise,
    ]);

    showToast("Connection successful!", "info");
    if (statusEl) {
      statusEl.textContent = "Connection successful";
      statusEl.className = "test-connection-status test-connection-status--ok";
    }
  } catch (err) {
    const rawMessage = redactSecrets(err instanceof Error ? err.message : "Connection failed.");
    const message = /failed to fetch|networkerror|network error/i.test(rawMessage)
      ? "Network request blocked or failed. Verify manifest allowed domains and provider endpoint access."
      : rawMessage;

    showToast(`${message}`, "error");
    if (statusEl) {
      statusEl.textContent = `${message}`;
      statusEl.className = "test-connection-status test-connection-status--error";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      const label = btn.querySelector<HTMLSpanElement>("#test-connection-label");
      if (label) label.textContent = "Test connection";
    }
  }
}

// ── Onboarding ────────────────────────────────────────────────────────────────

const ONBOARDING_TOTAL_STEPS = 4;

const OB_AGENT_DEFAULT_PROMPT =
  "We are building an application for... " +
  "(describe your product, industry, or target users here). " +
  "Generate wording that matches our brand and tone of voice.";

let onboardingStep = 0;

function setupOnboarding(): void {
  const VALID_PROVIDERS: LLMProvider[] = ["gemini", "openai", "anthropic", "mistral"];
  const rawProvider = safeStorage.getItem("copilot_provider");
  const savedProvider: LLMProvider =
    rawProvider !== null && (VALID_PROVIDERS as string[]).includes(rawProvider)
      ? (rawProvider as LLMProvider)
      : "gemini";
  const obProviderSelect = document.getElementById("ob-provider-select") as HTMLSelectElement | null;
  if (obProviderSelect) obProviderSelect.value = savedProvider;
  syncOnboardingProviderUI(savedProvider);

  if (obProviderSelect) {
    obProviderSelect.addEventListener("change", () => {
      syncOnboardingProviderUI(obProviderSelect.value as LLMProvider);
    });
  }

  const keyToggle = document.getElementById("ob-api-key-toggle");
  if (keyToggle) {
    keyToggle.addEventListener("click", () => {
      const input = document.getElementById("ob-api-key-input") as HTMLInputElement | null;
      const eye      = document.getElementById("ob-key-icon-eye");
      const eyeSlash = document.getElementById("ob-key-icon-eye-slash");
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      eye?.classList.toggle("hidden", !isPassword);
      eyeSlash?.classList.toggle("hidden", isPassword);
    });
  }

  const skipBtn = document.getElementById("ob-skip-btn");
  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      dismissOnboarding();
    });
  }

  const backBtn = document.getElementById("ob-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (onboardingStep > 0) goToOnboardingStep(onboardingStep - 1);
    });
  }

  const nextBtn = document.getElementById("ob-next-btn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (onboardingStep < ONBOARDING_TOTAL_STEPS - 1) {
        if (onboardingStep === 1) applyOnboardingConfig();
        if (onboardingStep === 2) applyOnboardingCustomAgent();
        goToOnboardingStep(onboardingStep + 1);
      } else {
        dismissOnboarding();
      }
    });
  }

  goToOnboardingStep(0);
  const overlay = document.getElementById("onboarding-view");
  overlay?.classList.remove("hidden");
}

function goToOnboardingStep(step: number): void {
  const stepEls = document.querySelectorAll<HTMLElement>(".onboarding-step");
  const dotEls  = document.querySelectorAll<HTMLElement>(".onboarding-dot");

  stepEls.forEach((el, i) => el.classList.toggle("hidden", i !== step));
  dotEls.forEach((el, i) => el.classList.toggle("onboarding-dot--active", i === step));

  const backBtn = document.getElementById("ob-back-btn");
  const nextBtn = document.getElementById("ob-next-btn");
  const skipBtn = document.getElementById("ob-skip-btn");

  const isLastStep = step === ONBOARDING_TOTAL_STEPS - 1;

  backBtn?.classList.toggle("hidden", step === 0 || isLastStep);

  if (skipBtn) {
    skipBtn.classList.toggle("hidden", isLastStep);
    skipBtn.textContent = step === 2 ? "Skip for now" : "Skip setup";
  }

  if (nextBtn) {
    nextBtn.textContent = isLastStep ? "Get started" : "Next →";
  }

  onboardingStep = step;
}

function syncOnboardingProviderUI(provider: LLMProvider): void {
  const modelSelect = document.getElementById("ob-model-select") as HTMLSelectElement | null;
  const keyInput    = document.getElementById("ob-api-key-input") as HTMLInputElement | null;
  const keyLabel    = document.getElementById("ob-api-key-label");

  if (modelSelect) {
    modelSelect.innerHTML = "";
    for (const { value, label } of PROVIDER_MODELS[provider]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      modelSelect.appendChild(opt);
    }
    const savedModel = safeStorage.getItem(`copilot_model_${provider}`);
    if (savedModel) modelSelect.value = savedModel;
  }

  const info = PROVIDER_KEY_INFO[provider];
  if (keyLabel?.lastChild) keyLabel.lastChild.textContent = info.label;
  if (keyInput) {
    keyInput.placeholder = info.placeholder;
    keyInput.value = safeStorage.getItem(info.storageKey) ?? "";
  }

  const providerIcon = document.getElementById("ob-provider-icon");
  if (providerIcon) providerIcon.innerHTML = info.icon;

  const instructions = document.getElementById("ob-token-instructions");
  if (instructions) instructions.innerHTML = info.instructionsHtml;
}

function applyOnboardingConfig(): void {
  const obProvider = document.getElementById("ob-provider-select") as HTMLSelectElement | null;
  const obModel    = document.getElementById("ob-model-select")    as HTMLSelectElement | null;
  const obKey      = document.getElementById("ob-api-key-input")   as HTMLInputElement  | null;

  if (!obProvider) return;
  const provider = obProvider.value as LLMProvider;

  safeStorage.setItem("copilot_provider", provider);
  if (obModel) safeStorage.setItem(`copilot_model_${provider}`, obModel.value);
  if (obKey) {
    const info = PROVIDER_KEY_INFO[provider];
    safeStorage.setItem(info.storageKey, obKey.value.trim());
  }

  const mainProvider = document.getElementById("provider-select") as HTMLSelectElement | null;
  if (mainProvider) mainProvider.value = provider;
  syncProviderUI(provider);
  persistSettingsToPlugin();
}

function dismissOnboarding(): void {
  const overlay = document.getElementById("onboarding-view");
  overlay?.classList.add("hidden");
  parent.postMessage({ pluginMessage: { type: "set-onboarding-done" } }, "*");
}

function applyOnboardingCustomAgent(): void {
  const promptInput = document.getElementById("ob-agent-prompt") as HTMLTextAreaElement | null;

  const functionalContext = promptInput?.value.trim() ?? "";

  if (!functionalContext || functionalContext === OB_AGENT_DEFAULT_PROMPT) return;

  safeStorage.setItem(FUNCTIONAL_CONTEXT_KEY, functionalContext);

  const settingsInput = document.getElementById("functional-context-input") as HTMLTextAreaElement | null;
  if (settingsInput) settingsInput.value = functionalContext;

  persistSettingsToPlugin();
  showToast("Functional context saved!");
}
