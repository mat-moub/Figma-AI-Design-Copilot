/**
 * context.ts — Functional Context Management
 *
 * Handles named functional contexts: reading/writing from storage, rendering
 * the context list in Settings, syncing the context selector in the chat input,
 * and managing in-place editing directly on the card.
 *
 * Depends on shared state and helpers from index.ts (via imports).
 */

import type {
  FunctionalContext,
  DocumentContext,
  SelectedTextContext,
  SelectedComponentContext,
  ContextLoadMeta,
  ModelConfig,
} from "../types/ui-types";
import { safeStorage, generateId, CONTEXTS_KEY, ACTIVE_CONTEXT_KEY, LEGACY_FUNCTIONAL_CONTEXT_KEY, getDocumentContext, setDocumentContext, getContextFetchedAt, setContextFetchedAt } from "./index";

let contextLoading = false;
let contextResolve: ((ctx: DocumentContext) => void) | null = null;
let contextProgressCallback: ((progress: {
  processedFrames: number;
  totalFrames: number;
  estimatedTokens: number;
  scopeLabel: string;
}) => void) | null = null;
/** Whether the next context-ready should invalidate the cached app summary. */
let _pendingInvalidateSummary = true;

// ── Conversation context state ─────────────────────────────────────────────────

/**
 * True once the Figma context + app summary have been loaded for the current
 * conversation. Reset to false when the user starts a new conversation so the
 * next message triggers a fresh load.
 */
let _conversationContextReady = false;

/** Returns true if context has already been loaded for this conversation. */
export function isConversationContextReady(): boolean {
  return _conversationContextReady;
}

/** Mark the conversation context as loaded (called after first successful load). */
export function markConversationContextReady(): void {
  _conversationContextReady = true;
}

/** Reset at the start of a new conversation so the next message reloads context. */
export function resetConversationContext(): void {
  _conversationContextReady = false;
  invalidateAppSummary();
}

// ── App summary state ─────────────────────────────────────────────────────────

const APP_SUMMARY_KEY = "copilot_app_summary";
const APP_SUMMARY_HASH_KEY = "copilot_app_summary_hash";

/** In-memory copy of the cached app summary. `null` = not yet generated or invalidated. */
let _appSummary: string | null = null;
/** Whether a summarization request is currently in flight. */
let _summarizing = false;
/** Pending resolvers waiting for the in-flight summarization to complete. */
let _summarizeWaiters: Array<(s: string | null) => void> = [];

export function getAppSummary(): string | null {
  if (_appSummary !== null) return _appSummary;
  // Try to restore from localStorage
  const stored = safeStorage.getItem(APP_SUMMARY_KEY);
  if (stored) {
    _appSummary = stored;
    return stored;
  }
  return null;
}

export function setAppSummary(summary: string | null): void {
  _appSummary = summary;
  if (summary !== null) {
    safeStorage.setItem(APP_SUMMARY_KEY, summary);
  } else {
    safeStorage.removeItem(APP_SUMMARY_KEY);
    safeStorage.removeItem(APP_SUMMARY_HASH_KEY);
  }
}

/**
 * Compute a cheap cache key from context metadata so we can detect when the
 * Figma document has changed and the summary needs to be regenerated.
 */
function contextCacheKey(context: DocumentContext): string {
  const meta = context.contextMeta;
  const screens = context.screens.join(",");
  return meta
    ? `${meta.scopeType}:${meta.scopeName ?? ""}:${meta.totalTexts}:${meta.estimatedTokens}:${screens}`
    : `noMeta:${screens}`;
}

/** Invalidate the cached summary (called on every context reload). */
export function invalidateAppSummary(): void {
  _appSummary = null;
  safeStorage.removeItem(APP_SUMMARY_KEY);
  safeStorage.removeItem(APP_SUMMARY_HASH_KEY);
}

/**
 * Ensure an app summary exists for the given context.
 * - If a valid cached summary exists (same cache key), returns it immediately.
 * - If a summarization is already in flight, waits for it.
 * - Otherwise, kicks off a new summarization and caches the result.
 *
 * Debug logs are emitted when `debugMode` is true.
 */
export async function ensureAppSummary(
  context: DocumentContext,
  config: ModelConfig,
  debugMode = false
): Promise<string | null> {
  const cacheKey = contextCacheKey(context);
  const storedKey = safeStorage.getItem(APP_SUMMARY_HASH_KEY);
  const stored = safeStorage.getItem(APP_SUMMARY_KEY);

  // Return cached summary if the context hasn't changed
  if (stored && storedKey === cacheKey) {
    _appSummary = stored;
    if (debugMode) {
      /* eslint-disable no-console */
      console.group("[Debug] ensureAppSummary — cache hit");
      console.log("Cache key:", cacheKey);
      console.log("Summary (first 300 chars):", stored.slice(0, 300));
      console.groupEnd();
      /* eslint-enable no-console */
    }
    return stored;
  }

  // If already summarizing, wait for the in-flight result
  if (_summarizing) {
    if (debugMode) {
      /* eslint-disable no-console */
      console.log("[Debug] ensureAppSummary — waiting for in-flight summarization");
      /* eslint-enable no-console */
    }
    return new Promise<string | null>((resolve) => {
      _summarizeWaiters.push(resolve);
    });
  }

  // No valid cache — run summarization
  _summarizing = true;
  if (debugMode) {
    /* eslint-disable no-console */
    console.group("[Debug] ensureAppSummary — starting summarization");
    console.log("Cache key:", cacheKey);
    console.log("Screens:", context.screens);
    console.log("Total text entries:", context.pageTextContext.reduce((n, s) => n + s.texts.length, 0));
    console.groupEnd();
    /* eslint-enable no-console */
  }

  let summary: string | null = null;
  try {
    const { AIService } = await import("../services/ai-service");
    const svc = new AIService();
    summary = await svc.summarizeAppContext(context, config);
    setAppSummary(summary);
    safeStorage.setItem(APP_SUMMARY_HASH_KEY, cacheKey);
    if (debugMode) {
      /* eslint-disable no-console */
      console.group("[Debug] ensureAppSummary — summary ready");
      console.log("Summary (first 500 chars):\n", summary.slice(0, 500));
      console.groupEnd();
      /* eslint-enable no-console */
    }
  } catch (err) {
    if (debugMode) {
      /* eslint-disable no-console */
      console.warn("[Debug] ensureAppSummary — summarization failed:", err);
      /* eslint-enable no-console */
    }
    summary = null;
  } finally {
    _summarizing = false;
    const waiters = _summarizeWaiters;
    _summarizeWaiters = [];
    for (const resolve of waiters) resolve(summary);
  }

  return summary;
}

function getLoadContextElements(): {
  button: HTMLButtonElement | null;
  spinner: HTMLElement | null;
  label: HTMLElement | null;
} {
  return {
    button: document.getElementById("load-context-btn") as HTMLButtonElement | null,
    spinner: document.getElementById("load-context-spinner"),
    label: document.getElementById("load-context-label"),
  };
}

export function setContextLoading(active: boolean, labelText?: string): void {
  void labelText;
  contextLoading = active;
  const { button, spinner } = getLoadContextElements();
  if (button) {
    button.disabled = active;
    button.classList.toggle("context-loading", active);
    button.title = active ? "Loading context…" : "Reload document context";
  }
  spinner?.classList.toggle("hidden", !active);
}

export function isContextLoading(): boolean {
  return contextLoading;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

/** Read all functional contexts from localStorage. */
export function getContexts(): FunctionalContext[] {
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
export function saveContexts(contexts: FunctionalContext[]): void {
  safeStorage.setItem(CONTEXTS_KEY, JSON.stringify(contexts));
}

/** Read the active context ID from localStorage. */
export function getActiveContextId(): string | null {
  return safeStorage.getItem(ACTIVE_CONTEXT_KEY) ?? null;
}

/** Set the active context ID in localStorage and sync the selector. */
export function setActiveContextId(id: string | null): void {
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
export function migrateLegacyContext(): void {
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

// ── UI rendering ──────────────────────────────────────────────────────────────

/** Build a read-only context card element. */
function buildReadCard(ctx: FunctionalContext): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "ctx-card";
  card.dataset.ctxId = ctx.id;
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
  return card;
}

/** Switch an existing read-only card to in-place edit mode. */
function activateCardEditMode(card: HTMLElement, title: string, content: string): void {
  card.classList.add("ctx-card--editing");
  card.innerHTML = `
    <div class="ctx-card__header ctx-card__header--edit">
      <input class="ctx-card__title-input" type="text"
             placeholder="e.g. B2B SaaS HR" maxlength="80"
             value="${escapeHTML(title)}" aria-label="Context title"/>
      <div class="ctx-card__actions">
        <button class="btn btn--icon-sm ctx-card__save-btn" data-ctx-action="save-inline" title="Save">
          <i class="fa-solid fa-check" aria-hidden="true"></i>
        </button>
        <button class="btn btn--icon-sm ctx-card__cancel-btn" data-ctx-action="cancel-inline" title="Cancel">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <textarea class="ctx-card__content-input"
              placeholder="Describe your product, industry, target users, or tone of voice…"
              spellcheck="false" aria-label="Context description">${escapeHTML(content)}</textarea>
  `;
  const titleInput = card.querySelector<HTMLInputElement>(".ctx-card__title-input");
  titleInput?.focus();
  titleInput?.select();
}

/** Render the list of context cards in the Settings panel. */
export function renderContextsList(): void {
  const container = document.getElementById("contexts-list");
  if (!container) return;

  const contexts = getContexts();

  if (contexts.length === 0) {
    container.innerHTML = '<p class="ctx-empty">No contexts yet. Click "+ Add" to create one.</p>';
    return;
  }

  container.innerHTML = "";
  for (const ctx of contexts) {
    container.appendChild(buildReadCard(ctx));
  }
}

/** Populate the context selector dropdown in the chat input area. */
export function syncContextSelector(): void {
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
    // Import lazily to avoid circular dependency at module load time
    import("./settings").then(({ persistSettingsToPlugin }) => persistSettingsToPlugin());
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

// ── Context in-place edit ─────────────────────────────────────────────────────

/**
 * Enter edit mode on the card for the given context ID.
 * The title and content become editable inputs directly on the card.
 */
export function openContextForm(editId?: string): void {
  if (editId) {
    // Edit an existing context: find its card and switch it to edit mode.
    const container = document.getElementById("contexts-list");
    const card = container?.querySelector<HTMLElement>(`[data-ctx-id="${CSS.escape(editId)}"]`);
    if (!card) return;

    const contexts = getContexts();
    const existing = contexts.find((c) => c.id === editId);
    if (!existing) return;

    card.dataset.ctxEditId = editId;
    activateCardEditMode(card, existing.title, existing.content);
  } else {
    // Add a new context: append a temporary new card in edit mode.
    const container = document.getElementById("contexts-list");
    if (!container) return;

    // Remove the empty-state paragraph if present.
    const empty = container.querySelector(".ctx-empty");
    empty?.remove();

    const tempCard = document.createElement("div");
    tempCard.className = "ctx-card";
    tempCard.dataset.ctxEditId = ""; // empty = new context
    container.appendChild(tempCard);
    activateCardEditMode(tempCard, "", "");
  }
}

/** Save (create or update) a context from an in-place editing card. */
export function saveContextInline(card: HTMLElement): void {
  const titleInput = card.querySelector<HTMLInputElement>(".ctx-card__title-input");
  const contentInput = card.querySelector<HTMLTextAreaElement>(".ctx-card__content-input");
  if (!titleInput || !contentInput) return;

  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title) {
    import("./chat").then(({ showToast }) => showToast("Please enter a context title.", "warning"));
    titleInput.focus();
    return;
  }
  if (!content) {
    import("./chat").then(({ showToast }) => showToast("Please enter context content.", "warning"));
    contentInput.focus();
    return;
  }

  const contexts = getContexts();
  const editId = card.dataset.ctxEditId ?? "";
  let isNew = false;

  if (editId) {
    const idx = contexts.findIndex((c) => c.id === editId);
    if (idx !== -1) {
      contexts[idx] = { ...contexts[idx], title, content };
    }
  } else {
    isNew = true;
    const newCtx: FunctionalContext = { id: generateId(), title, content };
    contexts.push(newCtx);
  }

  saveContexts(contexts);

  if (isNew && contexts.length === 1) {
    setActiveContextId(contexts[0].id);
  } else {
    syncContextSelector();
  }

  renderContextsList();
  import("./settings").then(({ persistSettingsToPlugin }) => persistSettingsToPlugin());
  import("./chat").then(({ showToast }) =>
    showToast(isNew ? "Context added." : "Context updated.")
  );
}

/** Cancel in-place editing on a card and restore it to read-only state. */
export function cancelContextInline(card: HTMLElement): void {
  const editId = card.dataset.ctxEditId ?? "";
  if (editId) {
    // Restore the original read-only card.
    const contexts = getContexts();
    const existing = contexts.find((c) => c.id === editId);
    if (existing) {
      const container = document.getElementById("contexts-list");
      if (container) {
        const readCard = buildReadCard(existing);
        container.replaceChild(readCard, card);
      }
    }
  } else {
    // New card that was never saved — just remove it, re-render if empty.
    const container = card.parentElement;
    card.remove();
    if (container && !container.querySelector(".ctx-card")) {
      container.innerHTML = '<p class="ctx-empty">No contexts yet. Click "+ Add" to create one.</p>';
    }
  }
}

/**
 * @deprecated Use saveContextInline / cancelContextInline instead.
 * Kept as no-ops for backward compatibility if any external caller exists.
 */
export function closeContextForm(): void { /* no-op — form removed */ }
export function saveContextForm(): void  { /* no-op — form removed */ }

/** Delete a context by ID. */
export function deleteContext(id: string): void {
  let contexts = getContexts();
  contexts = contexts.filter((c) => c.id !== id);
  saveContexts(contexts);

  // If the deleted context was active, clear the active selection
  if (getActiveContextId() === id) {
    setActiveContextId(null);
  }

  renderContextsList();
  syncContextSelector();
  import("./settings").then(({ persistSettingsToPlugin }) => persistSettingsToPlugin());
  import("./chat").then(({ showToast }) => showToast("Context deleted."));
}

// ── Document context (Figma selection) ───────────────────────────────────────

/**
 * Request document context from the plugin sandbox.
 * Returns a Promise that resolves when context-ready is received.
 * Optional onProgress callback is called on each context-load-progress message.
 *
 * @param onProgress   Called with incremental progress updates while loading.
 * @param invalidateSummary  When true (default), the cached app summary is
 *   cleared when the context arrives so it will be regenerated. Pass false
 *   to keep the existing summary (used when forcing a mid-conversation reload).
 */
export function requestDocumentContext(
  onProgress?: (progress: {
    processedFrames: number;
    totalFrames: number;
    estimatedTokens: number;
    scopeLabel: string;
  }) => void,
  invalidateSummary = true
): Promise<DocumentContext> {
  if (contextLoading && contextResolve) {
    // Already loading — piggyback on the existing request
    return new Promise<DocumentContext>((resolve) => {
      const prevResolve = contextResolve;
      contextResolve = (ctx) => {
        prevResolve?.(ctx);
        resolve(ctx);
      };
      if (onProgress) contextProgressCallback = onProgress;
    });
  }

  setContextLoading(true);
  contextProgressCallback = onProgress ?? null;
  _pendingInvalidateSummary = invalidateSummary;

  return new Promise<DocumentContext>((resolve) => {
    contextResolve = resolve;
    parent.postMessage({ pluginMessage: { type: "load-context" } }, "*");
  });
}

export function requestPersistedSettings(): void {
  parent.postMessage({ pluginMessage: { type: "get-settings" } }, "*");
}

export function requestOnboardingStatus(): void {
  parent.postMessage({ pluginMessage: { type: "get-onboarding-status" } }, "*");
}

export function showContextBadge(context: DocumentContext): void {
  setContextFetchedAt(Date.now());
  const badge = document.getElementById("ctx-badge");
  const badgeLabel = document.getElementById("ctx-badge-label");
  const badgeText = document.getElementById("ctx-badge-text");
  if (!badge || !badgeLabel || !badgeText) return;

  const hasSelectedText = context.selectedText !== null;
  const hasSelectedComponent = context.selectedComponent !== null;
  const screenCount = context.screens.length;
  const meta = context.contextMeta;

  const textContent = context.selectedText?.characters || "";
  const truncatedText = textContent.length > 20 ? textContent.slice(0, 20) + "…" : textContent;

  const selectedLabel = hasSelectedText
    ? `"${textContent.slice(0, 30)}${textContent.length > 30 ? "…" : ""}"`
    : hasSelectedComponent
    ? context.selectedComponent!.componentName
    : "none";

  if (hasSelectedText) {
    badgeLabel.textContent = "Text selected";
    badgeText.textContent = `"${truncatedText}"`;
  } else if (hasSelectedComponent) {
    const compName = context.selectedComponent!.componentName;
    badgeLabel.textContent = "Frame selected";
    badgeText.textContent = `"${compName.length > 20 ? compName.slice(0, 20) + "…" : compName}"`;
  } else {
    badgeLabel.textContent = `${String(screenCount)} screens`;
    badgeText.textContent = "None";
  }

  // Animate badge when text OR frame is selected
  if (!hasSelectedText && !hasSelectedComponent) {
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

  const contextFetchedAt = getContextFetchedAt();
  const refreshedAt = contextFetchedAt !== null ? new Date(contextFetchedAt).toLocaleTimeString() : "—";
  const metaLines = formatContextMetaTooltip(meta);
  badge.title = [
    `Refreshed: ${refreshedAt}`,
    `Selected text: ${selectedLabel}`,
    `Screens: ${context.screens.join(", ") || "none"}`,
    ...metaLines,
  ].join("\n");
  badge.classList.remove("hidden", "ctx-badge--stale");
}

export function handleContextLoadProgress(progress: {
  processedFrames: number;
  totalFrames: number;
  estimatedTokens: number;
  scopeLabel: string;
}): void {
  const total = Math.max(1, progress.totalFrames);
  const pct = Math.min(100, Math.round((progress.processedFrames / total) * 100));
  setContextLoading(true, `${pct}% (${progress.processedFrames}/${progress.totalFrames})`);
  if (contextProgressCallback) contextProgressCallback(progress);
}
export function handleContextReady(context: DocumentContext): void {
  setContextLoading(false);
  setDocumentContext(context);
  showContextBadge(context);

  // Only invalidate the cached app summary when the caller requested it
  // (explicit reload via button). Mid-conversation loads preserve the summary.
  if (_pendingInvalidateSummary) {
    invalidateAppSummary();
  }
  _pendingInvalidateSummary = true; // reset to safe default for next call

  // Resolve the pending promise from requestDocumentContext()
  if (contextResolve) {
    contextResolve(context);
    contextResolve = null;
  }
  contextProgressCallback = null;

  const meta = context.contextMeta;
  if (!meta) return;

  const summary = [
    `${meta.scopeType === "root-node" ? (meta.scopeName ?? "Root") : "Page"}`,
    `${meta.totalFrames} node${meta.totalFrames > 1 ? "s" : ""}`,
    `${meta.totalTexts} text${meta.totalTexts > 1 ? "s" : ""}`,
    `${meta.estimatedTokens} tok`,
    `${meta.durationMs}ms`,
    meta.truncated ? "truncated" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  import("./chat").then(({ showToast }) => showToast(`Context loaded: ${summary}`));
}

function formatContextMetaTooltip(meta: ContextLoadMeta | undefined): string[] {
  if (!meta) return [];
  return [
    `Scope: ${meta.scopeType}${meta.scopeName ? ` (${meta.scopeName})` : ""}`,
    `Strategy: ${meta.strategy}`,
    `Frames loaded: ${meta.totalFrames}`,
    `Text nodes loaded: ${meta.totalTexts}`,
    `Estimated tokens: ${meta.estimatedTokens}/${meta.maxTokens}`,
    `Min target: ${meta.minTokensTarget}`,
    `Truncated: ${meta.truncated ? "yes" : "no"}`,
    `Duration: ${meta.durationMs}ms`,
  ];
}

/**
 * Called whenever the Figma selection changes. Patches the in-memory
 * documentContext with the newly selected text/component so the next generation
 * automatically uses the right node — without a full context round-trip.
 */
export function handleSelectionChanged(
  selectedText: SelectedTextContext | null,
  selectedComponent: SelectedComponentContext | null
): void {
  const documentContext = getDocumentContext();
  let updated: DocumentContext;

  if (documentContext) {
    updated = { ...documentContext, selectedText, selectedComponent };
  } else {
    // No context loaded yet — build a minimal shell so selection is available
    updated = {
      designSystem: { components: [], colors: [], textStyles: [] },
      screens: [],
      pages: [],
      pageTextContext: [],
      selectedText,
      selectedComponent,
    };
  }

  setDocumentContext(updated);

  // Refresh the badge to reflect the new selection
  showContextBadge(updated);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Escape HTML special characters for safe insertion. */
export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
