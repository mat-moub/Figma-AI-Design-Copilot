/**
 * settings.ts — Settings Panel, Provider Configuration, and Onboarding
 *
 * Handles provider/model selection, API key management, theme, debug mode,
 * connection badge, test connection, and the onboarding wizard.
 *
 * Shared mutable state is accessed via getter/setter functions from index.ts.
 */

import type { FunctionalContext, LLMProvider, ModelConfig, PersistedSettings, ThemeMode } from "../types/ui-types";
import { redactSecrets } from "../utils/redact-secrets";
import {
  safeStorage,
  getEl,
  generateId,
  PROVIDER_MODELS,
  PROVIDER_KEY_INFO,
  THEME_KEY,
  ANIMATE_BADGE_KEY,
  DEBUG_MODE_KEY,
  INTERACTION_MODE_KEY,
  ALTERNATIVES_COUNT_KEY,
  DEFAULT_THEME,
  getInteractionMode,
} from "./index";
import {
  getContexts,
  getActiveContextId,
  saveContexts,
  setActiveContextId,
  renderContextsList,
  syncContextSelector,
  requestDocumentContext,
} from "./context";

// Import lazily to avoid circular at module-load time; used in setInteractionMode
// and other places that need chat functions.

// ── API Service (lazy, to avoid circular) ─────────────────────────────────────

async function getAIService() {
  const { AIService } = await import("../services/ai-service");
  return new AIService();
}

// ── Theme ─────────────────────────────────────────────────────────────────────

/** Apply the given theme to the document and persist the preference. */
export function applyTheme(theme: ThemeMode): void {
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
export function getStoredTheme(): ThemeMode {
  const stored = safeStorage.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : DEFAULT_THEME;
}

// ── Provider / Model UI ───────────────────────────────────────────────────────

export function syncProviderUI(provider: LLMProvider): void {
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

export function getSelectedProvider(): LLMProvider {
  const el = document.getElementById("provider-select") as HTMLSelectElement | null;
  return (el?.value as LLMProvider) ?? "gemini";
}

// ── Persist / Apply settings ──────────────────────────────────────────────────

export function collectPersistedSettings(): PersistedSettings {
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
    interactionMode: getInteractionMode(),
    contexts,
    activeContextId,
    debugMode: getDebugMode(),
    theme: getStoredTheme(),
    animateBadge: safeStorage.getItem(ANIMATE_BADGE_KEY) !== "0",
  };
}

export function persistSettingsToPlugin(): void {
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

export function applyPersistedSettings(settings: PersistedSettings): void {
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

  import("./chat").then(({ setInteractionMode }) => setInteractionMode(settings.interactionMode));
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

// ── Model config helpers ──────────────────────────────────────────────────────

export function getDebugMode(): boolean {
  const el = document.getElementById("debug-mode") as HTMLInputElement | null;
  return el?.checked ?? false;
}

export function getModelConfig(): ModelConfig {
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

export function validateApiKey(config: ModelConfig): string | null {
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

export function getAlternativesCount(): number {
  const el = document.getElementById("alternatives-count-input") as HTMLInputElement | null;
  if (!el) return 3;
  const val = parseInt(el.value, 10);
  return isNaN(val) || val < 1 ? 3 : Math.min(val, 10);
}

// ── Connection badge ──────────────────────────────────────────────────────────

export function updateConnectionBadge(): void {
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
    "mistral":   "Mistral",
  };

  const providerShort = providerLabels[provider] ?? provider;
  const modelShort    = modelEl?.options[modelEl.selectedIndex]?.text ?? modelEl?.value ?? "—";

  const statusLabel = hasKey ? "API key configured" : "No API key — click to configure";
  dot.className    = hasKey ? "connection-dot connection-dot--ready" : "connection-dot";
  dot.title        = statusLabel;
  dot.setAttribute("aria-label", statusLabel);
  text.textContent = `${providerShort} · ${modelShort}`;
}

// ── API key visibility toggle ─────────────────────────────────────────────────

export function toggleApiKeyVisibility(): void {
  const input = getEl<HTMLInputElement>("api-key-input");
  const isPassword = input.type === "password";
  input.type = isPassword ? "text" : "password";
  const iconEye      = document.getElementById("api-key-icon-eye");
  const iconEyeSlash = document.getElementById("api-key-icon-eye-slash");
  if (iconEye)      iconEye.classList.toggle("hidden", !isPassword);
  if (iconEyeSlash) iconEyeSlash.classList.toggle("hidden", isPassword);
}

// ── Test connection ───────────────────────────────────────────────────────────

export async function handleTestConnection(): Promise<void> {
  const btn = document.getElementById("test-connection-btn") as HTMLButtonElement | null;
  const statusEl = document.getElementById("test-connection-status");

  const modelConfig = getModelConfig();
  const missingKeyMsg = validateApiKey(modelConfig);
  if (missingKeyMsg) {
    const { showToast } = await import("./chat");
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

  const { showToast } = await import("./chat");
  const { EMPTY_DOCUMENT_CONTEXT } = await import("./index");

  try {
    const aiSvc = await getAIService();
    const emptyContext = { ...EMPTY_DOCUMENT_CONTEXT };

    const timeoutMs = 15000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("Connection test timed out after 15s. Check your API key, provider status, or network policy."));
      }, timeoutMs);
    });

    await Promise.race([
      aiSvc.ask("Reply with the single word: ok", emptyContext, modelConfig),
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

// ── Onboarding generate context ───────────────────────────────────────────────

async function handleObGenerateContext(): Promise<void> {
  const btn       = document.getElementById("ob-generate-context-btn") as HTMLButtonElement | null;
  const label     = document.getElementById("ob-generate-context-label");
  const spinner   = document.getElementById("ob-generate-context-spinner");
  const statusEl  = document.getElementById("ob-generate-context-status");
  const titleInput  = document.getElementById("ob-context-title")  as HTMLInputElement   | null;
  const promptInput = document.getElementById("ob-agent-prompt")   as HTMLTextAreaElement | null;

  const providerEl = document.getElementById("ob-provider-select") as HTMLSelectElement | null;
  const modelEl    = document.getElementById("ob-model-select")    as HTMLSelectElement | null;
  const keyEl      = document.getElementById("ob-api-key-input")   as HTMLInputElement  | null;

  const provider = (providerEl?.value ?? "gemini") as LLMProvider;
  const model    = (modelEl?.value ?? "") as ModelConfig["model"];
  const keyValue = keyEl?.value.trim() ?? "";

  const modelConfig: ModelConfig = { provider, model, debug: getDebugMode() };
  if (provider === "gemini")         modelConfig.geminiKey    = keyValue || undefined;
  else if (provider === "openai")    modelConfig.openaiKey    = keyValue || undefined;
  else if (provider === "anthropic") modelConfig.anthropicKey = keyValue || undefined;
  else if (provider === "mistral")   modelConfig.mistralKey   = keyValue || undefined;

  const missingKeyMsg = validateApiKey(modelConfig);
  if (missingKeyMsg) {
    const { showToast } = await import("./chat");
    showToast(missingKeyMsg, "warning");
    return;
  }

  // Show loading state
  if (btn)    btn.disabled = true;
  if (label)  label.textContent = "Generating…";
  if (spinner) spinner.classList.remove("hidden");
  if (statusEl) statusEl.textContent = "";

  try {
    // Load Figma document context (triggers a message to the sandbox)
    await requestDocumentContext();

    // Wait briefly for context to arrive (it is dispatched asynchronously)
    const { getDocumentContext } = await import("./index");
    let context = getDocumentContext();
    if (!context) {
      // Give the sandbox up to 5 s to respond
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const poll = setInterval(() => {
          context = getDocumentContext();
          if (context) { clearInterval(poll); resolve(); }
          else if (Date.now() > deadline) { clearInterval(poll); reject(new Error("Timed out waiting for Figma context.")); }
        }, 100);
      });
      context = getDocumentContext();
    }

    if (!context) throw new Error("Could not load Figma document context.");

    const aiSvc = await getAIService();
    const result = await aiSvc.generateFunctionalContext(context, modelConfig);

    if (titleInput)  titleInput.value  = result.title;
    if (promptInput) promptInput.value = result.content;

    if (statusEl) {
      statusEl.textContent = "Done!";
      setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 2500);
    }

    if (getDebugMode()) {
      /* eslint-disable no-console */
      console.log("[OB generateFunctionalContext] result:", result);
      /* eslint-enable no-console */
    }
  } catch (err) {
    const { redactSecrets } = await import("../utils/redact-secrets");
    const msg = redactSecrets(err instanceof Error ? err.message : "Failed to generate context.");
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.style.color = "var(--error, #e74c3c)";
    }
    const { showToast } = await import("./chat");
    showToast(msg, "error");
  } finally {
    if (btn)    btn.disabled = false;
    if (label)  label.textContent = "Generate from Figma";
    if (spinner) spinner.classList.add("hidden");
  }
}

// ── Onboarding test connection ────────────────────────────────────────────────

async function handleObTestConnection(): Promise<void> {
  const btn = document.getElementById("ob-test-connection-btn") as HTMLButtonElement | null;
  const statusEl = document.getElementById("ob-test-connection-status");

  const providerEl = document.getElementById("ob-provider-select") as HTMLSelectElement | null;
  const modelEl    = document.getElementById("ob-model-select")    as HTMLSelectElement | null;
  const keyEl      = document.getElementById("ob-api-key-input")   as HTMLInputElement  | null;

  const provider = (providerEl?.value ?? "gemini") as LLMProvider;
  const model    = (modelEl?.value ?? "") as ModelConfig["model"];
  const keyValue = keyEl?.value.trim() ?? "";

  const modelConfig: ModelConfig = { provider, model };
  if (provider === "gemini")        modelConfig.geminiKey    = keyValue || undefined;
  else if (provider === "openai")   modelConfig.openaiKey    = keyValue || undefined;
  else if (provider === "anthropic") modelConfig.anthropicKey = keyValue || undefined;
  else if (provider === "mistral")  modelConfig.mistralKey   = keyValue || undefined;

  const missingKeyMsg = validateApiKey(modelConfig);
  if (missingKeyMsg) {
    const { showToast } = await import("./chat");
    showToast(missingKeyMsg, "warning");
    if (statusEl) {
      statusEl.textContent = "No API key configured";
      statusEl.className = "test-connection-status test-connection-status--warn";
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    const label = btn.querySelector<HTMLSpanElement>("#ob-test-connection-label");
    if (label) label.textContent = "Testing…";
  }
  if (statusEl) {
    statusEl.textContent = "Testing connection…";
    statusEl.className = "test-connection-status";
  }

  const { showToast } = await import("./chat");
  const { EMPTY_DOCUMENT_CONTEXT } = await import("./index");

  try {
    const aiSvc = await getAIService();
    const emptyContext = { ...EMPTY_DOCUMENT_CONTEXT };

    const timeoutMs = 15000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("Connection test timed out after 15s. Check your API key, provider status, or network policy."));
      }, timeoutMs);
    });

    await Promise.race([
      aiSvc.ask("Reply with the single word: ok", emptyContext, modelConfig),
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
      const label = btn.querySelector<HTMLSpanElement>("#ob-test-connection-label");
      if (label) label.textContent = "Test connection";
    }
  }
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

/** Pending callback for the generic confirm modal. */
let confirmCallback: (() => void) | null = null;

export function openConfirmDialog(title: string, body: string, okLabel: string, onConfirm: () => void): void {
  const modal     = document.getElementById("confirm-action");
  const titleEl   = document.getElementById("confirm-action-title-text");
  const bodyEl    = document.getElementById("confirm-action-body");
  const okLabelEl = document.getElementById("confirm-action-ok-label");
  const okBtn     = document.getElementById("confirm-action-ok-btn");

  if (titleEl)   titleEl.textContent  = title;
  if (bodyEl)    bodyEl.textContent   = body;
  if (okLabelEl) okLabelEl.textContent = okLabel;

  confirmCallback = onConfirm;

  // Wire the OK button (replace any previous listener by cloning)
  if (okBtn) {
    const fresh = okBtn.cloneNode(true) as HTMLElement;
    okBtn.parentNode?.replaceChild(fresh, okBtn);
    fresh.addEventListener("click", () => {
      closeConfirmDialog();
      confirmCallback?.();
      confirmCallback = null;
    });
  }

  modal?.classList.remove("hidden");
}

export function closeConfirmDialog(): void {
  document.getElementById("confirm-action")?.classList.add("hidden");
}

export function restartOnboarding(): void {
  document.getElementById("settings-view")?.classList.add("hidden");
  onboardingStep = 0;
  setupOnboarding();
}

export async function resetAllData(): Promise<void> {
  const { chatEmptyStateHTML, setInteractionMode } = await import("./chat");

  // Clear all persisted data
  safeStorage.clear();
  // Tell the plugin backend to reset the onboarding flag to false
  parent.postMessage({ pluginMessage: { type: "reset-onboarding" } }, "*");

  // In-place UI reset — do NOT reload

  // 1. Clear chat history
  const chatContainer = document.getElementById("chat-history");
  if (chatContainer) chatContainer.innerHTML = chatEmptyStateHTML();
  const { setChatHistory } = await import("./index");
  setChatHistory([]);

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

export function setupEventListeners(): void {
  const generateBtn  = getEl<HTMLButtonElement>("generate-btn");
  const promptInput  = getEl<HTMLTextAreaElement>("prompt-input");
  const clearBtn     = getEl<HTMLButtonElement>("clear-btn");
  const apiKeyToggle = getEl<HTMLButtonElement>("api-key-toggle");
  const loadContextBtn = document.getElementById("load-context-btn") as HTMLButtonElement | null;

  // Single action button dispatches to the active mode handler
  generateBtn.addEventListener("click", () => {
    if (getInteractionMode() === "ask") {
      import("./chat").then(({ handleAsk }) => void handleAsk());
    } else {
      import("./chat").then(({ handleGenerate }) => void handleGenerate());
    }
  });

  promptInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (getInteractionMode() === "ask") {
        import("./chat").then(({ handleAsk }) => void handleAsk());
      } else {
        import("./chat").then(({ handleGenerate }) => void handleGenerate());
      }
    }
  });

  clearBtn.addEventListener("click", () => {
    import("./chat").then(({ openNewConvoConfirm }) => openNewConvoConfirm());
  });
  apiKeyToggle.addEventListener("click", toggleApiKeyVisibility);

  if (loadContextBtn) {
    loadContextBtn.addEventListener("click", () => {
      // An explicit reload must invalidate the summary and reset the conversation
      // context state so the next message does a full re-load + re-summarise.
      import("./context").then(({ resetConversationContext }) => resetConversationContext());
      requestDocumentContext();
    });
  }

  // ── Mode tabs ───────────────────────────────────────────────────────────
  const tabGenerate = document.getElementById("mode-tab-generate");
  const tabAsk      = document.getElementById("mode-tab-ask");
  if (tabGenerate) {
    tabGenerate.addEventListener("click", () => {
      import("./chat").then(({ setInteractionMode }) => setInteractionMode("generate"));
    });
  }
  if (tabAsk) {
    tabAsk.addEventListener("click", () => {
      import("./chat").then(({ setInteractionMode }) => setInteractionMode("ask"));
    });
  }

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
        import("./index").then(({ getDocumentContext }) => {
          const ctx = getDocumentContext();
          if (animate && ctx?.selectedText) {
            badge.classList.add("ctx-badge--animate");
          } else {
            badge.classList.remove("ctx-badge--animate");
          }
        });
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
      const card = btn.closest<HTMLElement>(".ctx-card");

      if (action === "edit") {
        const id = btn.dataset.ctxId ?? "";
        import("./context").then(({ openContextForm }) => openContextForm(id));
      }
      if (action === "save-inline" && card) {
        import("./context").then(({ saveContextInline }) => saveContextInline(card));
      }
      if (action === "cancel-inline" && card) {
        import("./context").then(({ cancelContextInline }) => cancelContextInline(card));
      }
      if (action === "delete") {
        const id = btn.dataset.ctxId ?? "";
        // Open the confirmation dialog synchronously (no async needed).
        // Resolve deleteContext lazily inside the confirmed callback only.
        openConfirmDialog(
          "Delete Context",
          "Are you sure you want to delete this context? This action cannot be undone.",
          "Delete",
          () => { import("./context").then(({ deleteContext }) => deleteContext(id)); }
        );
      }
    });
  }

  const ctxAddBtn = document.getElementById("ctx-add-btn");
  if (ctxAddBtn) {
    ctxAddBtn.addEventListener("click", () => {
      import("./context").then(({ openContextForm }) => openContextForm());
    });
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
        () => void resetAllData()
      );
    });
  }

  // ── Generic confirm modal wiring ──────────────────────────────────────
  const devCancelBtn = document.getElementById("confirm-action-cancel-btn");
  if (devCancelBtn) {
    devCancelBtn.addEventListener("click", closeConfirmDialog);
  }
}

// ── Onboarding ────────────────────────────────────────────────────────────────

const ONBOARDING_TOTAL_STEPS = 4;

const OB_AGENT_DEFAULT_PROMPT =
  "We are building an application for... " +
  "(describe your product, industry, or target users here). " +
  "Generate wording that matches our brand and tone of voice.";

let onboardingStep = 0;

export function setupOnboarding(): void {
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

  const obTestBtn = document.getElementById("ob-test-connection-btn");
  if (obTestBtn) {
    obTestBtn.onclick = () => void handleObTestConnection();
  }

  const obGenerateCtxBtn = document.getElementById("ob-generate-context-btn");
  if (obGenerateCtxBtn) {
    obGenerateCtxBtn.onclick = () => void handleObGenerateContext();
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

export function goToOnboardingStep(step: number): void {
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

export function syncOnboardingProviderUI(provider: LLMProvider): void {
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

export function applyOnboardingConfig(): void {
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

export function dismissOnboarding(): void {
  const overlay = document.getElementById("onboarding-view");
  overlay?.classList.add("hidden");
  parent.postMessage({ pluginMessage: { type: "set-onboarding-done" } }, "*");
}

export function applyOnboardingCustomAgent(): void {
  const titleInput  = document.getElementById("ob-context-title")  as HTMLInputElement   | null;
  const promptInput = document.getElementById("ob-agent-prompt")   as HTMLTextAreaElement | null;

  const title   = titleInput?.value.trim()  ?? "";
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
  import("./chat").then(({ showToast }) => showToast("Functional context saved!"));
}
