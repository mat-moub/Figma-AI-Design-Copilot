/**
 * ui.ts — Plugin UI Logic
 *
 * Runs inside the plugin's sandboxed iframe. Handles the chat interface,
 * model selection, calling the AI service for text alternatives, and sending
 * apply-text commands to the plugin controller (main.ts).
 */

import { AIService } from "./services/ai-service";
import { UXWriterAgent } from "./agents/ux-writer-agent";
import type {
  ChatMessage,
  DocumentContext,
  FunctionalContext,
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

/** localStorage key for the user's functional contexts array. */
const CONTEXTS_KEY = "copilot_contexts";

/** localStorage key for the active context ID. */
const ACTIVE_CONTEXT_KEY = "copilot_active_context_id";

/** @deprecated Legacy key — used only for migration from single-context. */
const LEGACY_FUNCTIONAL_CONTEXT_KEY = "copilot_functional_context";

/** localStorage key for the active interaction mode. */
const INTERACTION_MODE_KEY = "copilot_interaction_mode";

/** localStorage key for the debug mode toggle. */
const DEBUG_MODE_KEY = "copilot_debug_mode";

/** localStorage key for the number of text alternatives to generate. */
const ALTERNATIVES_COUNT_KEY = "copilot_alternatives_count";

/** localStorage key for the UI theme preference. */
const THEME_KEY = "copilot_theme";

/** localStorage key for the badge animation preference. */
const ANIMATE_BADGE_KEY = "copilot_animate_badge";

/** Default theme when no preference is stored. */
const DEFAULT_THEME: ThemeMode = "dark";

/**
 * Generate a random UUID-like identifier.
 * `generateId()` requires a secure context, which Figma's plugin
 * iframe (data: URI) does not provide. Fall back to `crypto.getRandomValues`
 * which *is* available in that environment.
 */
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return generateId();
  }
  // Fallback: build a v4-style UUID from getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
  
  const statusLabel = document.getElementById("theme-status-label");
  if (statusLabel) {
    if (theme === "dark") {
      statusLabel.innerHTML = '<i class="fa-solid fa-moon" aria-hidden="true"></i> Dark';
    } else {
      statusLabel.innerHTML = '<i class="fa-solid fa-sun" aria-hidden="true"></i> Light';
    }
  }
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
    // Migrate legacy single functional context → named contexts system
    migrateLegacyContext();

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

    // Render contexts list in settings and sync context selector in chat
    renderContextsList();
    syncContextSelector();

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

/** Pending callback for the generic confirm modal. */
let confirmCallback: (() => void) | null = null;

function openConfirmDialog(title: string, body: string, okLabel: string, onConfirm: () => void): void {
  const modal    = document.getElementById("confirm-action");
  const titleEl  = document.getElementById("confirm-action-title-text");
  const bodyEl   = document.getElementById("confirm-action-body");
  const okLabelEl = document.getElementById("confirm-action-ok-label");
  const okBtn    = document.getElementById("confirm-action-ok-btn");

  if (titleEl)   titleEl.textContent  = title;
  if (bodyEl)    bodyEl.textContent   = body;
  if (okLabelEl) okLabelEl.textContent = okLabel;

  confirmCallback = onConfirm;

  // Wire the OK button (replace any previous listener by cloning)
  if (okBtn) {
    const fresh = okBtn.cloneNode(true) as HTMLElement;
    okBtn.parentNode?.replaceChild(fresh, okBtn);
    // Re-append label span since cloneNode copies children
    fresh.addEventListener("click", () => {
      closeConfirmDialog();
      confirmCallback?.();
      confirmCallback = null;
    });
  }

  modal?.classList.remove("hidden");
}

function closeConfirmDialog(): void {
  document.getElementById("confirm-action")?.classList.add("hidden");
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

  // 3. Reset functional contexts
  renderContextsList();
  syncContextSelector();

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

  // ── Badge animation toggle ───────────────────────────────────────────────
  const animateBadgeToggle = document.getElementById("animate-badge-toggle") as HTMLInputElement | null;
  if (animateBadgeToggle) {
    animateBadgeToggle.addEventListener("change", () => {
      const animate = animateBadgeToggle.checked;
      safeStorage.setItem(ANIMATE_BADGE_KEY, animate ? "1" : "0");
      
      const badge = document.getElementById("ctx-badge");
      if (badge) {
        if (animate && documentContext?.selectedText) {
          badge.classList.add("ctx-badge--animate");
        } else {
          badge.classList.remove("ctx-badge--animate");
        }
      }
      persistSettingsToPlugin();
    });
  }

  // ── Context selector: change active context ──────────────────────────────
  const contextSelector = document.getElementById("context-selector") as HTMLSelectElement | null;
  if (contextSelector) {
    contextSelector.addEventListener("change", () => {
      const id = contextSelector.value || null;
      setActiveContextId(id);
      persistSettingsToPlugin();
    });
  }

  // ── Context CRUD buttons (delegated on the contexts list container) ─────
  const ctxListContainer = document.getElementById("contexts-list");
  if (ctxListContainer) {
    ctxListContainer.addEventListener("click", (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>("[data-ctx-action]");
      if (!btn) return;
      const action = btn.dataset.ctxAction;
      const id = btn.dataset.ctxId ?? "";
      if (action === "edit") openContextForm(id);
      if (action === "delete") {
        openConfirmDialog(
          "Delete Context",
          "Are you sure you want to delete this context? This action cannot be undone.",
          "Delete",
          () => deleteContext(id)
        );
      }
    });
  }

  const ctxAddBtn = document.getElementById("ctx-add-btn");
  if (ctxAddBtn) {
    ctxAddBtn.addEventListener("click", () => openContextForm());
  }

  const ctxFormSaveBtn = document.getElementById("ctx-form-save-btn");
  if (ctxFormSaveBtn) {
    ctxFormSaveBtn.addEventListener("click", () => saveContextForm());
  }

  const ctxFormCancelBtn = document.getElementById("ctx-form-cancel-btn");
  if (ctxFormCancelBtn) {
    ctxFormCancelBtn.addEventListener("click", () => closeContextForm());
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
      openConfirmDialog(
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
      openConfirmDialog(
        "Reset all data?",
        "This will permanently erase all settings, API keys, and plugin data. This cannot be undone.",
        "Reset all data",
        resetAllData
      );
    });
  }

  // ── Generic confirm modal wiring ──────────────────────────────────────
  const devCancelBtn = document.getElementById("confirm-action-cancel-btn");
  if (devCancelBtn) {
    devCancelBtn.addEventListener("click", closeConfirmDialog);
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

  // Update empty state text if there is no chat history yet
  if (chatHistory.length === 0) {
    const container = document.getElementById("chat-history");
    if (container) container.innerHTML = chatEmptyStateHTML();
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
  const badgeLabel = document.getElementById("ctx-badge-label");
  const badgeText = document.getElementById("ctx-badge-text");
  if (!badge || !badgeLabel || !badgeText) return;

  const hasSelectedText = context.selectedText !== null;
  const screenCount = context.screens.length;
  
  const textContent = context.selectedText?.characters || "";
  const truncatedText = textContent.length > 20 ? textContent.slice(0, 20) + "…" : textContent;
  
  const selectedLabel = hasSelectedText
    ? `"${textContent.slice(0, 30)}${textContent.length > 30 ? "…" : ""}"`
    : "none";

  badgeLabel.textContent = hasSelectedText ? "Text selected" : `${String(screenCount)} screens`;
  badgeText.textContent = hasSelectedText ? `"${truncatedText}"` : "None";
  
  // If no text is selected, stop animation by showing only the first line
  if (!hasSelectedText) {
    badge.classList.remove("ctx-badge--animate");
  } else {
    // Check global setting to re-enable
    const animateSetting = safeStorage.getItem("copilot_animate_badge") !== "0";
    if (animateSetting) {
      badge.classList.add("ctx-badge--animate");
    } else {
      badge.classList.remove("ctx-badge--animate");
    }
  }

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
  const contexts = getContexts();
  const activeContextId = getActiveContextId();

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
    contexts,
    activeContextId,
    debugMode: getDebugMode(),
    theme: getStoredTheme(),
    animateBadge: safeStorage.getItem(ANIMATE_BADGE_KEY) !== "0",
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

  // Restore contexts and active context ID
  if (settings.contexts && settings.contexts.length > 0) {
    saveContexts(settings.contexts);
    if (settings.activeContextId) {
      setActiveContextId(settings.activeContextId);
    }
  } else if (settings.functionalContext) {
    // Migration from legacy single context in persisted settings
    const legacyContent = settings.functionalContext.trim();
    if (legacyContent) {
      const ctx: FunctionalContext = {
        id: generateId(),
        title: "My context",
        content: legacyContent,
      };
      saveContexts([ctx]);
      setActiveContextId(ctx.id);
    }
  }

  renderContextsList();
  syncContextSelector();

  const providerSelect = document.getElementById("provider-select") as HTMLSelectElement | null;
  if (providerSelect) providerSelect.value = settings.provider;
  syncProviderUI(settings.provider);

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

  // Restore badge animation preference
  const animateBadge = settings.animateBadge !== false;
  safeStorage.setItem(ANIMATE_BADGE_KEY, animateBadge ? "1" : "0");
  const animateToggle = document.getElementById("animate-badge-toggle") as HTMLInputElement | null;
  if (animateToggle) {
    animateToggle.checked = animateBadge;
  }
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

/**
 * Returns the content of the currently active functional context, or empty string.
 */
function buildFullFunctionalContext(): string {
  const contexts = getContexts();
  const activeId = getActiveContextId();
  if (!activeId) return "";
  const active = contexts.find((c) => c.id === activeId);
  return active?.content.trim() ?? "";
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
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
    </div>
    <p class="chat-empty__title">Select a text node to start</p>
    <p class="chat-empty__subtitle">Select any text in Figma, then describe<br>what you want &mdash; I'll suggest alternatives.</p>
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

// ── Context management helpers ────────────────────────────────────────────────

/** Read all functional contexts from localStorage. */
function getContexts(): FunctionalContext[] {
  const raw = safeStorage.getItem(CONTEXTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as FunctionalContext[]) : [];
  } catch {
    return [];
  }
}

/** Persist the full contexts array to localStorage. */
function saveContexts(contexts: FunctionalContext[]): void {
  safeStorage.setItem(CONTEXTS_KEY, JSON.stringify(contexts));
}

/** Read the active context ID from localStorage. */
function getActiveContextId(): string | null {
  return safeStorage.getItem(ACTIVE_CONTEXT_KEY) ?? null;
}

/** Set the active context ID in localStorage and sync the selector. */
function setActiveContextId(id: string | null): void {
  if (id) {
    safeStorage.setItem(ACTIVE_CONTEXT_KEY, id);
  } else {
    safeStorage.removeItem(ACTIVE_CONTEXT_KEY);
  }
  syncContextSelector();
}

/**
 * One-time migration: convert the legacy single functional context to a named
 * context in the new multi-context system.
 */
function migrateLegacyContext(): void {
  const legacy = safeStorage.getItem(LEGACY_FUNCTIONAL_CONTEXT_KEY);
  if (!legacy || !legacy.trim()) return;

  // Only migrate if there are no existing contexts yet
  if (getContexts().length > 0) {
    safeStorage.removeItem(LEGACY_FUNCTIONAL_CONTEXT_KEY);
    return;
  }

  const ctx: FunctionalContext = {
    id: generateId(),
    title: "My context",
    content: legacy.trim(),
  };
  saveContexts([ctx]);
  setActiveContextId(ctx.id);
  safeStorage.removeItem(LEGACY_FUNCTIONAL_CONTEXT_KEY);
}

/** Render the list of context cards in the Settings panel. */
function renderContextsList(): void {
  const container = document.getElementById("contexts-list");
  if (!container) return;

  const contexts = getContexts();

  if (contexts.length === 0) {
    container.innerHTML = '<p class="ctx-empty">No contexts yet. Click "+ Add" to create one.</p>';
    return;
  }

  container.innerHTML = "";
  for (const ctx of contexts) {
    const card = document.createElement("div");
    card.className = "ctx-card";
    card.innerHTML = `
      <div class="ctx-card__header">
        <span class="ctx-card__title">${escapeHTML(ctx.title)}</span>
        <div class="ctx-card__actions">
          <button class="btn btn--icon-sm" data-ctx-action="edit" data-ctx-id="${escapeHTML(ctx.id)}" title="Edit">
            <i class="fa-solid fa-pen" aria-hidden="true"></i>
          </button>
          <button class="btn btn--icon-sm" data-ctx-action="delete" data-ctx-id="${escapeHTML(ctx.id)}" title="Delete">
            <i class="fa-solid fa-trash" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="ctx-card__preview">${escapeHTML(ctx.content.substring(0, 120))}${ctx.content.length > 120 ? "…" : ""}</div>
    `;
    container.appendChild(card);
  }
}



/** Populate the context selector dropdown in the chat input area. */
function syncContextSelector(): void {
  const selector = document.getElementById("context-selector") as HTMLSelectElement | null;
  if (!selector) return;

  const contexts = getContexts();
  let activeId = getActiveContextId();

  if (contexts.length === 0) {
    selector.innerHTML = '<option value="">(No context)</option>';
    return;
  }

  // If there are contexts but no valid activeId, auto-select the first one
  if (!activeId || !contexts.find((c) => c.id === activeId)) {
    activeId = contexts[0].id;
    safeStorage.setItem(ACTIVE_CONTEXT_KEY, activeId);
    // Persist to ensure the plugin has the active context correct.
    persistSettingsToPlugin();
  }

  selector.innerHTML = "";
  for (const ctx of contexts) {
    const opt = document.createElement("option");
    opt.value = ctx.id;
    opt.textContent = ctx.title;
    if (ctx.id === activeId) opt.selected = true;
    selector.appendChild(opt);
  }
}

/** Open the inline add/edit form in the settings panel. */
function openContextForm(editId?: string): void {
  const form = document.getElementById("ctx-form");
  const titleInput = document.getElementById("ctx-form-title") as HTMLInputElement | null;
  const contentInput = document.getElementById("ctx-form-content") as HTMLTextAreaElement | null;
  const formEditId = document.getElementById("ctx-form-edit-id") as HTMLInputElement | null;
  if (!form || !titleInput || !contentInput || !formEditId) return;

  if (editId) {
    const contexts = getContexts();
    const existing = contexts.find((c) => c.id === editId);
    if (existing) {
      titleInput.value = existing.title;
      contentInput.value = existing.content;
      formEditId.value = existing.id;
    }
  } else {
    titleInput.value = "";
    contentInput.value = "";
    formEditId.value = "";
  }

  form.classList.remove("hidden");
  titleInput.focus();
}

/** Hide the context add/edit form. */
function closeContextForm(): void {
  const form = document.getElementById("ctx-form");
  form?.classList.add("hidden");
}

/** Save (create or update) a context from the inline form fields. */
function saveContextForm(): void {
  const titleInput = document.getElementById("ctx-form-title") as HTMLInputElement | null;
  const contentInput = document.getElementById("ctx-form-content") as HTMLTextAreaElement | null;
  const formEditId = document.getElementById("ctx-form-edit-id") as HTMLInputElement | null;
  if (!titleInput || !contentInput || !formEditId) return;

  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title) {
    showToast("Please enter a context title.", "warning");
    return;
  }
  if (!content) {
    showToast("Please enter context content.", "warning");
    return;
  }

  const contexts = getContexts();
  const editId = formEditId.value;

  if (editId) {
    // Update existing
    const idx = contexts.findIndex((c) => c.id === editId);
    if (idx !== -1) {
      contexts[idx] = { ...contexts[idx], title, content };
    }
  } else {
    // Create new
    const newCtx: FunctionalContext = {
      id: generateId(),
      title,
      content,
    };
    contexts.push(newCtx);
  }

  saveContexts(contexts);
  
  if (!editId && contexts.length === 1) {
    // Auto-activate if it's the first context (requires contexts to be saved first)
    setActiveContextId(contexts[0].id);
  } else {
    // If not doing setActiveContextId (which calls syncContextSelector), do it manually
    syncContextSelector();
  }

  renderContextsList();
  closeContextForm();
  persistSettingsToPlugin();
  showToast(editId ? "Context updated." : "Context added.");
}

/** Delete a context by ID. */
function deleteContext(id: string): void {
  let contexts = getContexts();
  contexts = contexts.filter((c) => c.id !== id);
  saveContexts(contexts);

  // If the deleted context was active, clear the active selection
  if (getActiveContextId() === id) {
    setActiveContextId(null);
  }

  renderContextsList();
  syncContextSelector();
  persistSettingsToPlugin();
  showToast("Context deleted.");
}

/** Escape HTML special characters for safe insertion. */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  // Use onclick assignment (not addEventListener) so re-calling setupOnboarding()
  // during restart/reset never stacks duplicate handlers that would skip steps.
  if (obProviderSelect) {
    obProviderSelect.onchange = () => {
      syncOnboardingProviderUI(obProviderSelect.value as LLMProvider);
    };
  }

  const keyToggle = document.getElementById("ob-api-key-toggle");
  if (keyToggle) {
    keyToggle.onclick = () => {
      const input = document.getElementById("ob-api-key-input") as HTMLInputElement | null;
      const eye      = document.getElementById("ob-key-icon-eye");
      const eyeSlash = document.getElementById("ob-key-icon-eye-slash");
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      eye?.classList.toggle("hidden", !isPassword);
      eyeSlash?.classList.toggle("hidden", isPassword);
    };
  }

  const skipBtn = document.getElementById("ob-skip-btn");
  if (skipBtn) {
    skipBtn.onclick = () => dismissOnboarding();
  }

  const backBtn = document.getElementById("ob-back-btn");
  if (backBtn) {
    backBtn.onclick = () => {
      if (onboardingStep > 0) goToOnboardingStep(onboardingStep - 1);
    };
  }

  const nextBtn = document.getElementById("ob-next-btn");
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (onboardingStep < ONBOARDING_TOTAL_STEPS - 1) {
        if (onboardingStep === 1) applyOnboardingConfig();
        if (onboardingStep === 2) applyOnboardingCustomAgent();
        goToOnboardingStep(onboardingStep + 1);
      } else {
        dismissOnboarding();
      }
    };
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
  const titleInput = document.getElementById("ob-context-title") as HTMLInputElement | null;
  const promptInput = document.getElementById("ob-agent-prompt") as HTMLTextAreaElement | null;

  const title = titleInput?.value.trim() ?? "";
  const content = promptInput?.value.trim() ?? "";

  if (!content || content === OB_AGENT_DEFAULT_PROMPT) return;

  const ctx: FunctionalContext = {
    id: generateId(),
    title: title || "My context",
    content,
  };

  const contexts = getContexts();
  contexts.push(ctx);
  saveContexts(contexts);
  setActiveContextId(ctx.id);

  renderContextsList();
  syncContextSelector();
  persistSettingsToPlugin();
  showToast("Functional context saved!");
}
