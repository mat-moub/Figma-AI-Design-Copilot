/**
 * context.ts — Functional Context Management
 *
 * Handles named functional contexts: reading/writing from storage, rendering
 * the context list in Settings, syncing the context selector in the chat input,
 * and managing the inline add/edit form.
 *
 * Depends on shared state and helpers from index.ts (via imports).
 */

import type { FunctionalContext, DocumentContext, SelectedTextContext, SelectedComponentContext } from "../types/ui-types";
import { safeStorage, generateId, CONTEXTS_KEY, ACTIVE_CONTEXT_KEY, LEGACY_FUNCTIONAL_CONTEXT_KEY, getDocumentContext, setDocumentContext, getContextFetchedAt, setContextFetchedAt } from "./index";

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

// ── Context form ──────────────────────────────────────────────────────────────

/** Open the inline add/edit form in the settings panel. */
export function openContextForm(editId?: string): void {
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
export function closeContextForm(): void {
  const form = document.getElementById("ctx-form");
  form?.classList.add("hidden");
}

/** Save (create or update) a context from the inline form fields. */
export function saveContextForm(): void {
  const titleInput = document.getElementById("ctx-form-title") as HTMLInputElement | null;
  const contentInput = document.getElementById("ctx-form-content") as HTMLTextAreaElement | null;
  const formEditId = document.getElementById("ctx-form-edit-id") as HTMLInputElement | null;
  if (!titleInput || !contentInput || !formEditId) return;

  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title) {
    import("./chat").then(({ showToast }) => showToast("Please enter a context title.", "warning"));
    return;
  }
  if (!content) {
    import("./chat").then(({ showToast }) => showToast("Please enter context content.", "warning"));
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
  import("./settings").then(({ persistSettingsToPlugin }) => persistSettingsToPlugin());
  import("./chat").then(({ showToast }) =>
    showToast(editId ? "Context updated." : "Context added.")
  );
}

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

export function requestDocumentContext(): void {
  parent.postMessage({ pluginMessage: { type: "get-context" } }, "*");
  import("./chat").then(({ showToast }) => showToast("Refreshing document context…"));
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
  badge.title = [
    `Refreshed: ${refreshedAt}`,
    `Selected text: ${selectedLabel}`,
    `Screens: ${context.screens.join(", ") || "none"}`,
  ].join("\n");
  badge.classList.remove("hidden", "ctx-badge--stale");
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
