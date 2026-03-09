/**
 * ui.ts — Plugin UI Logic
 *
 * Runs inside the plugin's sandboxed iframe. Handles the chat interface,
 * model/agent selection, calling the AI service, and sending build commands
 * to the plugin controller (main.ts).
 */

import { AIService } from "./services/ai-service";
import { UXDesignerAgent } from "./agents/ux-designer-agent";
import { DesignSystemAgent } from "./agents/design-system-agent";
import { CustomAgentRegistry } from "./services/custom-agent-registry";
import { BUNDLED_SKILLS } from "./data/skills-library";
import {
  fetchSkillsLibrary,
  loadSkillsLibraryFromStorage,
  saveSkillsLibraryToStorage,
  clearSkillsLibraryFromStorage,
} from "./services/skills-library-service";
import type {
  ChatMessage,
  CopilotConfig,
  DocumentContext,
  ExternalSkillEntry,
  LLMProvider,
  ModelConfig,
  PluginToUIMessage,
  UIScreen,
} from "./types/ui-types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** After this many milliseconds without a context refresh, warn the designer. */
const CONTEXT_STALE_MS = 10 * 60 * 1000; // 10 minutes

/** localStorage key for the user's functional/business context. */
const FUNCTIONAL_CONTEXT_KEY = "copilot_functional_context";

/** localStorage key for the "Keep existing design system" checkbox. */
const KEEP_DESIGN_SYSTEM_KEY = "copilot_keep_design_system";

/** localStorage key for the "Advanced UX skills" checkbox. */
const ADVANCED_UX_SKILLS_KEY = "copilot_advanced_ux_skills";

// ── State ─────────────────────────────────────────────────────────────────────

let documentContext: DocumentContext | null = null;
let chatHistory: ChatMessage[] = [];
let contextFetchedAt: number | null = null;

/**
 * Extra skills loaded at runtime from the GitHub library.
 * Starts empty; users can click "⬇ Update" to refresh from the remote repo.
 * The bundled skills (BUNDLED_SKILLS) are always active in the default agents.
 */
let externalSkills: ExternalSkillEntry[] = [];

const aiService = new AIService();
const uxAgent = new UXDesignerAgent();
const dsAgent = new DesignSystemAgent();
const registry = new CustomAgentRegistry();

// ── DOM References ────────────────────────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

// ── Initialise ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  registry.loadFromStorage();
  populateCustomAgentOptions();

  // Restore provider selection and sync model/key UI before wiring listeners
  const savedProvider = (localStorage.getItem("copilot_provider") as LLMProvider | null) ?? "github-copilot";
  const providerSelect = document.getElementById("provider-select") as HTMLSelectElement | null;
  if (providerSelect) providerSelect.value = savedProvider;
  syncProviderUI(savedProvider);

  // Restore checkbox states
  const keepDsEl = document.getElementById("keep-design-system") as HTMLInputElement | null;
  if (keepDsEl) keepDsEl.checked = localStorage.getItem(KEEP_DESIGN_SYSTEM_KEY) === "1";
  const advUXEl = document.getElementById("advanced-ux-skills") as HTMLInputElement | null;
  if (advUXEl) advUXEl.checked = localStorage.getItem(ADVANCED_UX_SKILLS_KEY) === "1";

  // Restore functional context in settings textarea
  const savedContext = localStorage.getItem(FUNCTIONAL_CONTEXT_KEY) ?? "";
  const contextInput = document.getElementById("functional-context-input") as HTMLTextAreaElement | null;
  if (contextInput) contextInput.value = savedContext;

  setupEventListeners();
  requestDocumentContext();

  // Restore any extra skills loaded at runtime from the remote library
  externalSkills = loadSkillsLibraryFromStorage();

  // Render the skills library panel (bundled skills are always shown)
  renderSkillsLibrary();

  // Announce bundled skills in the chat only on first startup
  const announcedKey = "copilot_skills_announced";
  if (!localStorage.getItem(announcedKey)) {
    const skillNames = BUNDLED_SKILLS.map((s) => `• ${s.name}`).join("\n");
    appendAssistantMessage(
      `📚 ${pluralize(BUNDLED_SKILLS.length, "skill")} from the design library are bundled and active in all agents:\n\n${skillNames}`
    );
    localStorage.setItem(announcedKey, "1");
  }

  // Show onboarding on first launch
  setupOnboarding();
});

// ── Plugin → UI messages ──────────────────────────────────────────────────────

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUIMessage | undefined;
  if (!msg) return;

  switch (msg.type) {
    case "context-ready":
      documentContext = msg.context;
      showContextBadge(msg.context);
      break;

    case "screens-built":
      setGenerating(false);
      appendAssistantMessage(
        `✅ ${pluralize(msg.count, "screen")} have been added to your Figma document.`
      );
      break;

    case "error":
      setGenerating(false);
      appendAssistantMessage(`❌ Error: ${msg.message}`);
      showToast(`Error: ${msg.message}`, "error");
      break;

    case "notify":
      showToast(msg.message);
      break;
  }
};

// ── Event listeners ───────────────────────────────────────────────────────────

function setupEventListeners(): void {
  const generateBtn = getEl<HTMLButtonElement>("generate-btn");
  const promptInput = getEl<HTMLTextAreaElement>("prompt-input");
  const clearBtn = getEl<HTMLButtonElement>("clear-btn");
  const refreshCtxBtn = getEl<HTMLButtonElement>("refresh-ctx-btn");
  const apiKeyToggle = getEl<HTMLButtonElement>("api-key-toggle");

  generateBtn.addEventListener("click", () => void handleGenerate());

  promptInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      void handleGenerate();
    }
  });

  clearBtn.addEventListener("click", clearHistory);
  refreshCtxBtn.addEventListener("click", requestDocumentContext);
  apiKeyToggle.addEventListener("click", toggleApiKeyVisibility);

  // ── Provider selection ─────────────────────────────────────────────────
  const providerSelect = document.getElementById("provider-select") as HTMLSelectElement | null;
  if (providerSelect) {
    providerSelect.addEventListener("change", () => {
      const provider = providerSelect.value as LLMProvider;
      localStorage.setItem("copilot_provider", provider);
      syncProviderUI(provider);
    });
  }

  // ── Model selection: persist per provider ──────────────────────────────
  const modelSelect = document.getElementById("model-select") as HTMLSelectElement | null;
  if (modelSelect) {
    modelSelect.addEventListener("change", () => {
      const provider = getSelectedProvider();
      localStorage.setItem(`copilot_model_${provider}`, modelSelect.value);
      updateConnectionBadge();
    });
  }

  // ── API key: persist per provider on change ────────────────────────────
  const apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement | null;
  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", () => {
      const provider = getSelectedProvider();
      const storageKey = PROVIDER_KEY_INFO[provider].storageKey;
      localStorage.setItem(storageKey, apiKeyInput.value.trim());
      updateConnectionBadge();
    });
  }

  // ── Options checkboxes: persist state ──────────────────────────────────
  const keepDsCheckbox = document.getElementById("keep-design-system") as HTMLInputElement | null;
  if (keepDsCheckbox) {
    keepDsCheckbox.addEventListener("change", () => {
      localStorage.setItem(KEEP_DESIGN_SYSTEM_KEY, keepDsCheckbox.checked ? "1" : "0");
    });
  }

  const advUXCheckbox = document.getElementById("advanced-ux-skills") as HTMLInputElement | null;
  if (advUXCheckbox) {
    advUXCheckbox.addEventListener("change", () => {
      localStorage.setItem(ADVANCED_UX_SKILLS_KEY, advUXCheckbox.checked ? "1" : "0");
    });
  }

  // ── Functional context: persist on change ──────────────────────────────
  const contextInput = document.getElementById("functional-context-input") as HTMLTextAreaElement | null;
  if (contextInput) {
    contextInput.addEventListener("input", () => {
      localStorage.setItem(FUNCTIONAL_CONTEXT_KEY, contextInput.value.trim());
    });
  }

  // ── Custom agents / skills: file-drop zone ──────────────────────────────
  setupDropZone();

  // ── Custom agents: file picker fallback ────────────────────────────────
  const fileInput = document.getElementById("config-file-input") as HTMLInputElement | null;
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) void loadConfigFile(file);
      fileInput.value = "";
    });
  }

  // ── Custom agents: clear button ─────────────────────────────────────────
  const clearCustomBtn = document.getElementById("clear-custom-btn");
  if (clearCustomBtn) {
    clearCustomBtn.addEventListener("click", clearCustomConfig);
  }

  // ── Skills library ──────────────────────────────────────────────────────
  const loadSkillsBtn = document.getElementById("load-skills-library-btn");
  if (loadSkillsBtn) {
    loadSkillsBtn.addEventListener("click", () => void handleLoadSkillsLibrary());
  }

  const clearSkillsBtn = document.getElementById("clear-skills-library-btn");
  if (clearSkillsBtn) {
    clearSkillsBtn.addEventListener("click", handleClearSkillsLibrary);
  }
}

// ── Core: Generate ────────────────────────────────────────────────────────────

async function handleGenerate(): Promise<void> {
  const promptEl = getEl<HTMLTextAreaElement>("prompt-input");
  const prompt = promptEl.value.trim();
  if (!prompt) {
    showToast("Please enter a prompt.", "warning");
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
  };

  // Warn the designer if the Figma context snapshot is older than CONTEXT_STALE_MS.
  // The context is still used as-is — the user can click "Context" to refresh.
  if (documentContext && contextFetchedAt !== null && Date.now() - contextFetchedAt > CONTEXT_STALE_MS) {
    showToast("⚠️ Figma context may be stale — click 'Context' to refresh.", "warning");
  }

  const variants = getVariantCount();
  const keepDesignSystem = getKeepDesignSystem();
  const advancedUXSkills = getAdvancedUXSkills();
  const fullContext = buildFullFunctionalContext();

  appendUserMessage(prompt);
  promptEl.value = "";
  setGenerating(true);

  const enrichedPrompt = aiService.formatUserPrompt(prompt, variants, context);

  // NOTE: the current user message is intentionally NOT pushed to chatHistory
  // here. chatHistory holds only the *previous* turns so that generateScreens
  // can append the current userMessage without duplication. Both the raw user
  // message and the assistant reply are pushed to chatHistory after the agent
  // returns successfully (or on error, so the model retains context).

  try {
    let screens: UIScreen[];

    const skillsUsed = buildActiveSkillsList(keepDesignSystem, advancedUXSkills, variants);

    if (advancedUXSkills) {
      // UX Designer agent: includes UX frameworks in system prompt
      screens = await uxAgent.generate(
        enrichedPrompt, variants, context, modelConfig, chatHistory,
        fullContext || undefined, keepDesignSystem
      );
    } else if (keepDesignSystem) {
      // Design System agent: strictly enforces design system components
      screens = await dsAgent.generate(
        enrichedPrompt, context, modelConfig, chatHistory,
        fullContext || undefined
      );
    } else {
      // Default: UX Designer without enforced design system
      screens = await uxAgent.generate(
        enrichedPrompt, variants, context, modelConfig, chatHistory,
        fullContext || undefined, false
      );
    }

    const summary = formatScreensSummary(screens);
    appendAssistantMessage(`Generating ${pluralize(screens.length, "screen")}…\n\n${summary}`, skillsUsed);

    // Push both sides of the turn to history using the raw (un-enriched) prompt
    // so successive turns remain concise and the system prompt handles context.
    chatHistory.push({ role: "user", content: prompt });
    chatHistory.push({ role: "assistant", content: summary });

    // Send screens to the plugin controller for Figma rendering
    parent.postMessage(
      { pluginMessage: { type: "build-screens", screens } },
      "*"
    );
  } catch (err) {
    setGenerating(false);
    const message = err instanceof Error ? err.message : String(err);
    appendAssistantMessage(`❌ ${message}`);
    // Record the failed turn so the model retains conversation context
    chatHistory.push({ role: "user", content: prompt });
    chatHistory.push({ role: "assistant", content: `Error: ${message}` });
    showToast(message, "error");
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

function requestDocumentContext(): void {
  parent.postMessage({ pluginMessage: { type: "get-context" } }, "*");
  showToast("Refreshing document context…");
}

function showContextBadge(context: DocumentContext): void {
  contextFetchedAt = Date.now();
  const badge = document.getElementById("ctx-badge");
  if (!badge) return;
  const total =
    context.designSystem.components.length +
    context.designSystem.colors.length +
    context.screens.length;
  badge.textContent = `${total} items`;
  const refreshedAt = new Date(contextFetchedAt).toLocaleTimeString();
  badge.title = [
    `Refreshed: ${refreshedAt}`,
    `Components: ${context.designSystem.components.join(", ") || "none"}`,
    `Colors: ${context.designSystem.colors.join(", ") || "none"}`,
    `Screens: ${context.screens.join(", ") || "none"}`,
  ].join("\n");
  badge.classList.remove("hidden", "ctx-badge--stale");
}

// ── Config helpers ────────────────────────────────────────────────────────────

/** Models available per provider, used to populate the model dropdown. */
const PROVIDER_MODELS: Record<LLMProvider, Array<{ value: string; label: string }>> = {
  "github-copilot": [
    { value: "gpt-5.2", label: "GPT-5.2" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "gemini-3-flash", label: "Gemini 3 Flash" },
    { value: "gemini-3-pro", label: "Gemini 3 Pro" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  anthropic: [
    { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

/** Key labels and placeholders per provider for the API key input field. */
const PROVIDER_KEY_INFO: Record<LLMProvider, { label: string; placeholder: string; storageKey: string; hint: string }> = {
  "github-copilot": {
    label: "GH Token",
    placeholder: "ghp_… (copilot scope)",
    storageKey: "copilot_github_token",
    hint: "🔑 Get a Personal Access Token (classic) with the copilot scope at github.com → Settings → Developer settings → Personal access tokens.",
  },
  openai: {
    label: "API Key",
    placeholder: "sk-… (OpenAI API key)",
    storageKey: "copilot_openai_key",
    hint: "🔑 Get your API key at platform.openai.com/api-keys.",
  },
  anthropic: {
    label: "API Key",
    placeholder: "sk-ant-… (Anthropic API key)",
    storageKey: "copilot_anthropic_key",
    hint: "🔑 Get your API key at console.anthropic.com → API Keys.",
  },
};

/**
 * Update the model dropdown options and API key label/placeholder to match
 * the currently selected provider.
 */
function syncProviderUI(provider: LLMProvider): void {
  const modelSelect = getEl<HTMLSelectElement>("model-select");
  const keyInput = getEl<HTMLInputElement>("api-key-input");

  // Rebuild model options
  modelSelect.innerHTML = "";
  for (const { value, label } of PROVIDER_MODELS[provider]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    modelSelect.appendChild(opt);
  }

  // Restore previously saved model for this provider
  const savedModel = localStorage.getItem(`copilot_model_${provider}`);
  if (savedModel) modelSelect.value = savedModel;

  // Update key label and placeholder
  const info = PROVIDER_KEY_INFO[provider];
  const keyLabelText = document.getElementById("api-key-label-text");
  if (keyLabelText) keyLabelText.textContent = info.label;
  keyInput.placeholder = info.placeholder;

  // Update API key retrieval hint
  const keyHint = document.getElementById("api-key-hint");
  if (keyHint) keyHint.textContent = info.hint;

  // Restore previously saved API key for this provider
  const savedKey = localStorage.getItem(info.storageKey) ?? "";
  keyInput.value = savedKey;

  updateConnectionBadge();
}

function getSelectedProvider(): LLMProvider {
  const el = document.getElementById("provider-select") as HTMLSelectElement | null;
  return (el?.value as LLMProvider) ?? "github-copilot";
}

function getModelConfig(): ModelConfig {
  const provider = getSelectedProvider();
  const modelEl = getEl<HTMLSelectElement>("model-select");
  const keyInput = getEl<HTMLInputElement>("api-key-input");
  const keyValue = keyInput.value.trim();

  const config: ModelConfig = {
    provider,
    model: modelEl.value as ModelConfig["model"],
  };

  if (provider === "github-copilot") {
    config.githubToken = keyValue || undefined;
  } else if (provider === "openai") {
    config.openaiKey = keyValue || undefined;
  } else if (provider === "anthropic") {
    config.anthropicKey = keyValue || undefined;
  }

  return config;
}

/**
 * Return an error message if the required API key for the current provider is
 * missing, or `null` if configuration is valid.
 */
function validateApiKey(config: ModelConfig): string | null {
  switch (config.provider) {
    case "openai":
      return config.openaiKey
        ? null
        : "Please enter your OpenAI API key (sk-…) in the settings.";
    case "anthropic":
      return config.anthropicKey
        ? null
        : "Please enter your Anthropic API key (sk-ant-…) in the settings.";
    case "github-copilot":
    default:
      return config.githubToken
        ? null
        : "Please enter your GitHub token (copilot scope) in the settings.";
  }
}

function getVariantCount(): number {
  const el = getEl<HTMLInputElement>("variants-input");
  const val = parseInt(el.value, 10);
  return isNaN(val) || val < 1 ? 1 : Math.min(val, 5);
}

/** Returns true when "Keep existing design system" checkbox is checked. */
function getKeepDesignSystem(): boolean {
  const el = document.getElementById("keep-design-system") as HTMLInputElement | null;
  return el?.checked ?? false;
}

/** Returns true when "Advanced UX skills" checkbox is checked. */
function getAdvancedUXSkills(): boolean {
  const el = document.getElementById("advanced-ux-skills") as HTMLInputElement | null;
  return el?.checked ?? false;
}

/** Returns the functional context text entered by the user. */
function getFunctionalContext(): string {
  return (localStorage.getItem(FUNCTIONAL_CONTEXT_KEY) ?? "").trim();
}

/**
 * Build an additional system-prompt block from user-provided custom skills.
 * Each custom skill contributes a `promptModifier` that extends the agent's
 * behaviour without requiring TypeScript changes.
 */
function buildCustomSkillsAddition(): string {
  const skills = registry.getSkills();
  if (skills.length === 0) return "";
  return skills.map((s) => s.promptModifier).join("\n\n");
}

/**
 * Combine the functional context and custom-skill prompt modifiers into a
 * single string to append to the agent system prompt.
 */
function buildFullFunctionalContext(): string {
  const parts: string[] = [];
  const ctx = getFunctionalContext();
  if (ctx) parts.push(ctx);
  const customSkills = buildCustomSkillsAddition();
  if (customSkills) parts.push(customSkills);
  return parts.join("\n\n");
}

// ── Chat UI helpers ───────────────────────────────────────────────────────────

function appendUserMessage(content: string): void {
  appendChatMessage("user", content);
}

function appendAssistantMessage(content: string, skillsUsed?: string[]): void {
  appendChatMessage("assistant", content, skillsUsed);
}

function appendChatMessage(role: "user" | "assistant", content: string, skillsUsed?: string[]): void {
  const container = getEl<HTMLDivElement>("chat-history");
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

  if (skillsUsed && skillsUsed.length > 0) {
    const skillsRow = document.createElement("div");
    skillsRow.className = "chat-skills";
    skillsRow.setAttribute("aria-label", "Skills used");
    for (const skill of skillsUsed) {
      const tag = document.createElement("span");
      tag.className = "chat-skill-tag";
      tag.textContent = skill;
      skillsRow.appendChild(tag);
    }
    bubble.appendChild(skillsRow);
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

function clearHistory(): void {
  const container = getEl<HTMLDivElement>("chat-history");
  container.innerHTML = "";
  chatHistory = [];
  showToast("Chat history cleared.");
}

// ── Generating state ──────────────────────────────────────────────────────────

function setGenerating(active: boolean): void {
  const btn = getEl<HTMLButtonElement>("generate-btn");
  const spinner = document.getElementById("spinner");
  const label = document.getElementById("generate-label");
  btn.disabled = active;
  if (label) label.textContent = active ? "Generating…" : "Generate";
  if (spinner) spinner.classList.toggle("hidden", !active);
}

// ── API key visibility ────────────────────────────────────────────────────────

function toggleApiKeyVisibility(): void {
  const input = getEl<HTMLInputElement>("api-key-input");
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  // Swap eye ↔ eye-slash icons (defined in ui.html)
  const iconEye      = document.getElementById("api-key-icon-eye");
  const iconEyeSlash = document.getElementById("api-key-icon-eye-slash");
  if (iconEye)      iconEye.classList.toggle("hidden", !isPassword);
  if (iconEyeSlash) iconEyeSlash.classList.toggle("hidden", isPassword);
}

// ── Connection badge ──────────────────────────────────────────────────────────

/**
 * Refreshes the compact connection-status badge shown in the settings toggle
 * bar when the configuration panel is collapsed.
 *
 * Badge format:  ● GitHub · GPT-5.2   (green dot = key set)
 *                ○ OpenAI · GPT-4o    (orange dot = no key)
 */
function updateConnectionBadge(): void {
  const dot  = document.getElementById("connection-dot");
  const text = document.getElementById("connection-text");
  if (!dot || !text) return;

  const provider = getSelectedProvider();
  const modelEl  = document.getElementById("model-select") as HTMLSelectElement | null;
  const keyInput = document.getElementById("api-key-input")  as HTMLInputElement  | null;
  const hasKey   = !!(keyInput?.value.trim());

  const providerLabels: Record<string, string> = {
    "github-copilot": "GitHub",
    "openai":         "OpenAI",
    "anthropic":      "Anthropic",
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
  return `${count} ${singular}${count !== 1 ? "s" : ""}`;
}

// ── Format screens summary ────────────────────────────────────────────────────

function formatScreensSummary(screens: UIScreen[]): string {
  return screens
    .map(
      (s) =>
        `• **${s.name}** — ${pluralize(s.elements.length, "element")} (${s.layout} layout)`
    )
    .join("\n");
}

// ── Active skills resolver ────────────────────────────────────────────────────

/**
 * Returns the human-readable names of the skills that will be invoked for the
 * current checkbox configuration and variant count. Used to annotate assistant
 * chat bubbles with the skills that were active during a generation request.
 */
function buildActiveSkillsList(keepDesignSystem: boolean, advancedUXSkills: boolean, variants: number): string[] {
  const SKILL_LABELS: Record<string, string> = {
    "generate-screen":     "Generate Screen",
    "generate-variants":   "Generate Variants",
    "apply-design-system": "Apply Design System",
  };

  const base = variants > 1 ? "generate-variants" : "generate-screen";
  const skills: string[] = [base];

  // Design system is applied when the checkbox is checked (either mode)
  if (keepDesignSystem) {
    skills.push("apply-design-system");
  }

  const labels = skills.map((s) => SKILL_LABELS[s]);

  if (advancedUXSkills) labels.push("Advanced UX skills");

  // Always include custom skills from the registry
  const customSkills = registry.getSkills();
  for (const s of customSkills) {
    labels.push(s.name);
  }

  return labels;
}

// ── Custom agents: config loading ─────────────────────────────────────────────

/**
 * Refresh the info badge shown in the options bar.
 * Called whenever the custom-config registry or external skills list changes
 * so that the main page always reflects the current state.
 */
function populateCustomAgentOptions(): void {
  // Keep the main-page info badge in sync
  updateAgentsSkillsInfo();
}

// ── Custom agents: drop zone ──────────────────────────────────────────────────

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

    // Accept the first JSON file found
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
    // Registry validates internally and throws on invalid data
    registry.load(json as CopilotConfig);
    registry.saveToStorage();
    populateCustomAgentOptions();
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
  registry.clear();
  populateCustomAgentOptions();
  renderCustomConfigSummary();
  showToast("Custom skills cleared.");
}

/** Update the summary list of loaded custom skills (settings panel). */
function renderCustomConfigSummary(): void {
  const summary = document.getElementById("custom-config-summary");
  if (!summary) return;

  const skills = registry.getSkills();

  if (skills.length === 0) {
    summary.textContent = "No custom config loaded.";
  } else {
    summary.textContent = `Skills: ${skills.map((s) => s.name).join(", ")}`;
  }

  // Also refresh the compact info shown in the main-page options bar
  updateAgentsSkillsInfo();
}

/**
 * Update the compact skills info shown in the main-page options bar.
 *
 * Called whenever the custom-config registry or the external skills list changes
 * so that the main page always reflects the current state of the Settings
 * configuration without requiring the user to open Settings to verify.
 *
 * Output format examples:
 *   - ""                                  (nothing loaded)
 *   - "3 custom skills"
 *   - "3 custom skills · +5 remote"
 */
function updateAgentsSkillsInfo(): void {
  const infoEl = document.getElementById("agents-skills-info");
  if (!infoEl) return;

  const skills = registry.getSkills();
  const parts: string[] = [];

  if (skills.length > 0) {
    parts.push(pluralize(skills.length, "custom skill"));
  }
  if (externalSkills.length > 0) {
    parts.push(`+${externalSkills.length} remote`);
  }

  infoEl.textContent = parts.length > 0 ? parts.join(" · ") : "";
}

// ── Skills Library ────────────────────────────────────────────────────────────

/**
 * Fetch the latest non-code skills from the remote library, merge them with
 * the bundled skills, update state/storage, and post a chat summary.
 */
async function handleLoadSkillsLibrary(): Promise<void> {
  const loadBtn = document.getElementById("load-skills-library-btn") as HTMLButtonElement | null;
  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.textContent = "Updating…";
  }

  try {
    const skills = await fetchSkillsLibrary();
    externalSkills = skills;
    saveSkillsLibraryToStorage(skills);
    renderSkillsLibrary();

    if (skills.length === 0) {
      appendAssistantMessage("⚠️ Remote skills library is empty — bundled skills remain active.");
    } else {
      const skillNames = skills.map((s) => `• ${s.name}`).join("\n");
      appendAssistantMessage(
        `🔄 Remote skills library updated (${pluralize(skills.length, "skill")}):\n\n${skillNames}`
      );
    }

    showToast(`Updated: ${pluralize(skills.length, "skill")} from remote library.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update skills library.";
    showToast(message, "error");
    appendAssistantMessage(`❌ ${message}`);
  } finally {
    if (loadBtn) {
      loadBtn.disabled = false;
      // Restore button label (keep inner SVG intact by updating only the text node)
      const textNode = Array.from(loadBtn.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE
      );
      if (textNode) {
        textNode.textContent = " Update";
      } else {
        loadBtn.append(" Update");
      }
    }
  }
}

/** Clear extra runtime-loaded skills (bundled skills remain active). */
function handleClearSkillsLibrary(): void {
  externalSkills = [];
  clearSkillsLibraryFromStorage();
  renderSkillsLibrary();
  showToast("Runtime skills cleared. Bundled skills remain active.");
}

/**
 * Render the skills library panel.
 * Always shows the bundled skills; additionally shows any runtime-loaded skills.
 */
function renderSkillsLibrary(): void {
  const summary = document.getElementById("skills-library-summary");
  const listEl = document.getElementById("skills-library-list");

  if (!summary || !listEl) return;

  summary.textContent =
    `${pluralize(BUNDLED_SKILLS.length, "bundled skill")} active in all agents` +
    (externalSkills.length > 0
      ? ` · ${pluralize(externalSkills.length, "extra skill")} loaded from remote`
      : "");

  // Show bundled skills (always active)
  listEl.innerHTML = "";
  const bundledIds = new Set(BUNDLED_SKILLS.map((b) => b.id));
  for (const skill of BUNDLED_SKILLS) {
    const tag = document.createElement("span");
    tag.className = "skill-tag";
    tag.textContent = skill.name;
    tag.title = `Bundled: ${skill.description}`;
    listEl.appendChild(tag);
  }

  // Append extra runtime-loaded skills with a distinct style
  for (const skill of externalSkills) {
    // Skip if already covered by bundled set
    if (bundledIds.has(skill.id)) continue;
    const tag = document.createElement("span");
    tag.className = "skill-tag skill-tag--remote";
    tag.textContent = skill.name;
    tag.title = `Remote: ${skill.id}`;
    listEl.appendChild(tag);
  }

  listEl.classList.remove("hidden");

  // Refresh the compact info in the main-page agent bar
  updateAgentsSkillsInfo();
}

// ── Onboarding ────────────────────────────────────────────────────────────────

/** localStorage key for the onboarding completion flag. */
const ONBOARDING_DONE_KEY = "copilot_onboarding_done";
const ONBOARDING_TOTAL_STEPS = 4;

/**
 * Default placeholder shown in the onboarding functional context textarea.
 * If the user hasn't changed this text we skip saving it.
 */
const OB_AGENT_DEFAULT_PROMPT =
  "We are building an application for... " +
  "(describe your product, industry, or target users here). " +
  "Generate screens that match our brand and workflows.";

let onboardingStep = 0;

/**
 * Initialise and (if first launch) display the onboarding overlay.
 * The flow has 3 real steps plus a final "You're all set" screen (shown in
 * the breadcrumb but not announced as a numbered step in text).
 * On subsequent launches the overlay stays hidden because the done-flag is
 * already stored in localStorage.
 */
function setupOnboarding(): void {
  if (localStorage.getItem(ONBOARDING_DONE_KEY)) return;

  // Populate the onboarding provider/model/key UI with saved or default values
  const VALID_PROVIDERS: LLMProvider[] = ["github-copilot", "openai", "anthropic"];
  const rawProvider = localStorage.getItem("copilot_provider");
  const savedProvider: LLMProvider =
    rawProvider !== null && (VALID_PROVIDERS as string[]).includes(rawProvider)
      ? (rawProvider as LLMProvider)
      : "github-copilot";
  const obProviderSelect = document.getElementById("ob-provider-select") as HTMLSelectElement | null;
  if (obProviderSelect) obProviderSelect.value = savedProvider;
  syncOnboardingProviderUI(savedProvider);

  // Provider change → re-sync model list and key field
  if (obProviderSelect) {
    obProviderSelect.addEventListener("change", () => {
      syncOnboardingProviderUI(obProviderSelect.value as LLMProvider);
    });
  }

  // API key visibility toggle
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

  // Skip: dismiss onboarding without saving changes
  const skipBtn = document.getElementById("ob-skip-btn");
  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      dismissOnboarding();
    });
  }

  // Back: go to previous step
  const backBtn = document.getElementById("ob-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (onboardingStep > 0) goToOnboardingStep(onboardingStep - 1);
    });
  }

  // Next / Get started
  const nextBtn = document.getElementById("ob-next-btn");
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (onboardingStep < ONBOARDING_TOTAL_STEPS - 1) {
        // Save provider config when leaving step 2 (Config)
        if (onboardingStep === 1) applyOnboardingConfig();
        // Save custom agent when leaving step 3 (Custom Agent)
        if (onboardingStep === 2) applyOnboardingCustomAgent();
        goToOnboardingStep(onboardingStep + 1);
      } else {
        // Final step (You're all set): close the overlay
        dismissOnboarding();
      }
    });
  }

  goToOnboardingStep(0);
  const overlay = document.getElementById("onboarding-view");
  overlay?.classList.remove("hidden");
}

/** Navigate to a specific onboarding step and update the UI accordingly. */
function goToOnboardingStep(step: number): void {
  const stepEls = document.querySelectorAll<HTMLElement>(".onboarding-step");
  const dotEls  = document.querySelectorAll<HTMLElement>(".onboarding-dot");

  stepEls.forEach((el, i) => el.classList.toggle("hidden", i !== step));
  dotEls.forEach((el, i) => el.classList.toggle("onboarding-dot--active", i === step));

  const backBtn = document.getElementById("ob-back-btn");
  const nextBtn = document.getElementById("ob-next-btn");
  const skipBtn = document.getElementById("ob-skip-btn");

  const isLastStep = step === ONBOARDING_TOTAL_STEPS - 1;

  // Back: hidden on step 0 and on the final "You're all set" screen
  backBtn?.classList.toggle("hidden", step === 0 || isLastStep);

  // Skip: hidden on the final "You're all set" screen; labelled differently on step 2
  if (skipBtn) {
    skipBtn.classList.toggle("hidden", isLastStep);
    skipBtn.textContent = step === 2 ? "Skip for now" : "Skip setup";
  }

  if (nextBtn) {
    nextBtn.textContent = isLastStep ? "Get started 🚀" : "Next →";
  }

  onboardingStep = step;
}

/**
 * Populate the onboarding model dropdown and restore saved API key for the
 * chosen provider — mirrors `syncProviderUI` but targets the `#ob-*` elements.
 */
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
    const savedModel = localStorage.getItem(`copilot_model_${provider}`);
    if (savedModel) modelSelect.value = savedModel;
  }

  const info = PROVIDER_KEY_INFO[provider];
  if (keyLabel?.lastChild) keyLabel.lastChild.textContent = info.label;
  if (keyInput) {
    keyInput.placeholder = info.placeholder;
    keyInput.value = localStorage.getItem(info.storageKey) ?? "";
  }

  // Update API key retrieval hint
  const keyHint = document.getElementById("ob-api-key-hint");
  if (keyHint) keyHint.textContent = info.hint;
}

/**
 * Save the provider/model/key values from the onboarding form to localStorage
 * and sync the main settings UI so the plugin is immediately ready to use.
 */
function applyOnboardingConfig(): void {
  const obProvider = document.getElementById("ob-provider-select") as HTMLSelectElement | null;
  const obModel    = document.getElementById("ob-model-select")    as HTMLSelectElement | null;
  const obKey      = document.getElementById("ob-api-key-input")   as HTMLInputElement  | null;

  if (!obProvider) return;
  const provider = obProvider.value as LLMProvider;

  localStorage.setItem("copilot_provider", provider);
  if (obModel) localStorage.setItem(`copilot_model_${provider}`, obModel.value);
  if (obKey) {
    const info = PROVIDER_KEY_INFO[provider];
    localStorage.setItem(info.storageKey, obKey.value.trim());
  }

  // Reflect the new settings in the main settings panel
  const mainProvider = document.getElementById("provider-select") as HTMLSelectElement | null;
  if (mainProvider) mainProvider.value = provider;
  syncProviderUI(provider);
}

/** Close the onboarding overlay and persist the completion flag. */
function dismissOnboarding(): void {
  const overlay = document.getElementById("onboarding-view");
  overlay?.classList.add("hidden");
  localStorage.setItem(ONBOARDING_DONE_KEY, "1");
}

/**
 * Read the optional functional context from onboarding step 3 and persist it
 * to localStorage so all agents can use it automatically.
 *
 * Silently skipped if the user left the default placeholder unchanged.
 */
function applyOnboardingCustomAgent(): void {
  const promptInput = document.getElementById("ob-agent-prompt") as HTMLTextAreaElement | null;

  const functionalContext = promptInput?.value.trim() ?? "";

  // Skip silently if the user left the default placeholder unchanged
  if (!functionalContext || functionalContext === OB_AGENT_DEFAULT_PROMPT) return;

  localStorage.setItem(FUNCTIONAL_CONTEXT_KEY, functionalContext);

  // Reflect the saved value in the settings functional context field
  const settingsInput = document.getElementById("functional-context-input") as HTMLTextAreaElement | null;
  if (settingsInput) settingsInput.value = functionalContext;

  showToast("Functional context saved!");
}