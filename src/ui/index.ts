/**
 * index.ts — Plugin UI Entry Point
 *
 * Runs inside the plugin's sandboxed iframe. Owns all shared mutable state and
 * exports getter/setter functions so that sub-modules (settings, chat, context)
 * can access it without circular import issues.
 *
 * Bootstraps the UI by calling setupEventListeners() and requesting initial
 * data from the plugin controller (main.ts).
 */

import { redactSecrets } from "../utils/redact-secrets";
import type {
  ChatMessage,
  DocumentContext,
  LLMProvider,
  PluginToUIMessage,
  ThemeMode,
} from "../types/ui-types";

declare global {
  interface Window {
    __AICOPILOT_UI_LOADED__?: boolean;
  }
}

window.__AICOPILOT_UI_LOADED__ = true;

// ── Constants ─────────────────────────────────────────────────────────────────

/** After this many milliseconds without a context refresh, warn the designer. */
export const CONTEXT_STALE_MS = 10 * 60 * 1000; // 10 minutes

/** localStorage key for the user's functional contexts array. */
export const CONTEXTS_KEY = "copilot_contexts";

/** localStorage key for the active context ID. */
export const ACTIVE_CONTEXT_KEY = "copilot_active_context_id";

/** @deprecated Legacy key — used only for migration from single-context. */
export const LEGACY_FUNCTIONAL_CONTEXT_KEY = "copilot_functional_context";

/** localStorage key for the active interaction mode. */
export const INTERACTION_MODE_KEY = "copilot_interaction_mode";

/** localStorage key for the debug mode toggle. */
export const DEBUG_MODE_KEY = "copilot_debug_mode";

/** localStorage key for the number of text alternatives to generate. */
export const ALTERNATIVES_COUNT_KEY = "copilot_alternatives_count";

/** localStorage key for the UI theme preference. */
export const THEME_KEY = "copilot_theme";

/** localStorage key for the badge animation preference. */
export const ANIMATE_BADGE_KEY = "copilot_animate_badge";

/** Default theme when no preference is stored. */
export const DEFAULT_THEME: ThemeMode = "dark";

/** Models available per provider, used to populate the model dropdown. */
export const PROVIDER_MODELS: Record<LLMProvider, Array<{ value: string; label: string }>> = {
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
export const PROVIDER_KEY_INFO: Record<LLMProvider, { label: string; placeholder: string; storageKey: string; hint: string; icon: string; instructionsHtml: string; apiKeyUrl: string }> = {
  gemini: {
    label: "API Key",
    placeholder: "AIza… (Google AI Studio key)",
    storageKey: "copilot_gemini_key",
    hint: "Get your API key at aistudio.google.com/apikey.",
    icon: '<i class="fa-brands fa-google" aria-hidden="true"></i>',
    apiKeyUrl: "https://aistudio.google.com/apikey",
    instructionsHtml:
      `Sign in to Google AI Studio and click <strong>Create API key</strong>.<br>` +
      `The key starts with <code>AIza…</code> — copy it and paste it below.<br>` +
      `<span class="ob-apikey-warn">⚠ Save it immediately: Google only shows it once.</span>`,
  },
  openai: {
    label: "API Key",
    placeholder: "sk-… (OpenAI API key)",
    storageKey: "copilot_openai_key",
    hint: "Get your API key at platform.openai.com/api-keys.",
    icon: '<i class="fa-brands fa-openai" aria-hidden="true"></i>',
    apiKeyUrl: "https://platform.openai.com/api-keys",
    instructionsHtml:
      `Sign in to OpenAI and click <strong>Create new secret key</strong>.<br>` +
      `The key starts with <code>sk-…</code> — copy it and paste it below.<br>` +
      `<span class="ob-apikey-warn">⚠ Save it immediately: OpenAI only shows it once.</span>`,
  },
  anthropic: {
    label: "API Key",
    placeholder: "sk-ant-… (Anthropic API key)",
    storageKey: "copilot_anthropic_key",
    hint: "Get your API key at console.anthropic.com → API Keys.",
    icon: '<svg class="icon icon--fill" aria-hidden="true"><use href="#icon-anthropic"/></svg>',
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    instructionsHtml:
      `Sign in to Anthropic Console and click <strong>Create key</strong>.<br>` +
      `The key starts with <code>sk-ant-…</code> — copy it and paste it below.<br>` +
      `<span class="ob-apikey-warn">⚠ Save it immediately: Anthropic only shows it once.</span>`,
  },
  mistral: {
    label: "API Key",
    placeholder: "… (Mistral API key)",
    storageKey: "copilot_mistral_key",
    hint: "Get your API key at console.mistral.ai.",
    icon: '<span class="provider-icon-badge" aria-hidden="true">M</span>',
    apiKeyUrl: "https://console.mistral.ai/api-keys",
    instructionsHtml:
      `Sign in to Mistral Console and click <strong>Create new key</strong>.<br>` +
      `Copy the key and paste it below.<br>` +
      `<span class="ob-apikey-warn">⚠ Save it immediately: Mistral only shows it once.</span>`,
  },
};

/** Minimal empty document context — used as a fallback when no Figma context has been loaded yet. */
export const EMPTY_DOCUMENT_CONTEXT: DocumentContext = {
  designSystem: { components: [], colors: [], textStyles: [] },
  screens: [],
  pages: [],
  pageTextContext: [],
  selectedText: null,
  selectedComponent: null,
};

// ── Storage ───────────────────────────────────────────────────────────────────

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

export const safeStorage = getSafeStorage();

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Generate a random UUID-like identifier.
 * `crypto.randomUUID()` requires a secure context, which Figma's plugin
 * iframe (data: URI) does not provide. Fall back to `crypto.getRandomValues`
 * which *is* available in that environment.
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: build a v4-style UUID from getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

// ── Shared mutable state ──────────────────────────────────────────────────────
// Sub-modules access this state exclusively via the getter/setter functions
// below to avoid direct cross-module mutation and to prevent circular imports.

let _documentContext: DocumentContext | null = null;
let _chatHistory: ChatMessage[] = [];
let _contextFetchedAt: number | null = null;
let _interactionMode: "generate" | "ask" = "generate";
let _typingBubbleEl: HTMLDivElement | null = null;

export const getDocumentContext = (): DocumentContext | null => _documentContext;
export const setDocumentContext = (ctx: DocumentContext | null): void => { _documentContext = ctx; };

export const getChatHistory = (): ChatMessage[] => _chatHistory;
export const setChatHistory = (h: ChatMessage[]): void => { _chatHistory = h; };

export const getContextFetchedAt = (): number | null => _contextFetchedAt;
export const setContextFetchedAt = (t: number | null): void => { _contextFetchedAt = t; };

export const getInteractionMode = (): "generate" | "ask" => _interactionMode;
export const setInteractionModeState = (m: "generate" | "ask"): void => { _interactionMode = m; };

export const getTypingBubbleEl = (): HTMLDivElement | null => _typingBubbleEl;
export const setTypingBubbleEl = (el: HTMLDivElement | null): void => { _typingBubbleEl = el; };

// ── Early theme application ───────────────────────────────────────────────────
// Apply theme as early as possible to avoid flash, before any async imports.
{
  const stored = safeStorage.getItem(THEME_KEY);
  const theme: ThemeMode = stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
  document.documentElement.setAttribute("data-theme", theme);
}

// ── Initialise ────────────────────────────────────────────────────────────────

async function initializeUI(): Promise<void> {
  const {
    setupEventListeners,
    syncProviderUI,
    getStoredTheme,
    applyTheme,
  } = await import("./settings");

  const {
    renderContextsList,
    syncContextSelector,
    migrateLegacyContext,
    requestPersistedSettings,
    requestOnboardingStatus,
    setContextLoading,
  } = await import("./context");

  const { setInteractionMode, showToast } = await import("./chat");

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
    applyTheme(getStoredTheme());

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
    setContextLoading(false);
    requestOnboardingStatus();
  } catch {
    showToast("Settings initialization failed partially. Core actions remain available.", "warning");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void initializeUI());
} else {
  void initializeUI();
}

// ── Plugin → UI messages ──────────────────────────────────────────────────────

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as PluginToUIMessage | undefined;
  if (!msg) return;

  void (async () => {
    const { showToast, setGenerating, appendAssistantMessage, hideAssistantTypingIndicator } = await import("./chat");
    const { handleSelectionChanged, handleContextReady, handleContextLoadProgress, setContextLoading } = await import("./context");
    const { setupOnboarding, applyPersistedSettings } = await import("./settings");

    switch (msg.type) {
      case "context-ready":
        _documentContext = msg.context;
        handleContextReady(msg.context);
        break;

      case "context-load-progress":
        handleContextLoadProgress(msg);
        break;

      case "selection-changed":
        handleSelectionChanged(msg.selectedText, msg.selectedComponent);
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
        setContextLoading(false);
        setGenerating(false);
        hideAssistantTypingIndicator();
        appendAssistantMessage(`Error: ${redactSecrets(msg.message)}`);
        showToast(`Error: ${redactSecrets(msg.message)}`, "error");
        break;

      case "notify":
        showToast(msg.message);
        break;
    }
  })();
};
