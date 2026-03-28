/**
 * chat.ts — Chat UI and Generation Logic
 *
 * Handles the chat interface: appending messages, typing indicators, the
 * generate/ask handlers, markdown rendering, and toast notifications.
 *
 * Shared mutable state (documentContext, chatHistory, etc.) is accessed via
 * getter/setter functions exported from index.ts.
 */

import { AIService } from "../services/ai-service";
import { UXWriterAgent } from "../agents/ux-writer-agent";
import { redactSecrets } from "../utils/redact-secrets";
import type { DocumentContext, TextAlternative } from "../types/ui-types";
import {
  safeStorage,
  getEl,
  INTERACTION_MODE_KEY,
  getDocumentContext,
  getChatHistory,
  setChatHistory,
  getInteractionMode,
  setInteractionModeState,
  getTypingBubbleEl,
  setTypingBubbleEl,
} from "./index";
import { getModelConfig, validateApiKey, getAlternativesCount, getDebugMode } from "./settings";
import { getContexts, getActiveContextId, requestDocumentContext, ensureAppSummary, isConversationContextReady, markConversationContextReady, resetConversationContext } from "./context";

// Lazy-initialised service singletons shared across calls
const aiService = new AIService();
const uxWriterAgent = new UXWriterAgent();

// ── Generate alternatives ────────────────────────────────────────────────────

export async function handleGenerate(): Promise<void> {
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

  // Read the current context for the selected text chip (before refresh)
  const preContext = getDocumentContext();
  const selectedChars = preContext?.selectedText?.characters ?? null;

  const count = getAlternativesCount();
  const fullContext = buildFullFunctionalContext();

  appendUserMessage(prompt, selectedChars);
  promptEl.value = "";
  setGenerating(true);

  // Create a live AI bubble with status header
  const liveBubble = createLiveAssistantBubble();

  const contextAlreadyLoaded = isConversationContextReady();

  try {
    let freshContext: DocumentContext;

    if (contextAlreadyLoaded && preContext) {
      // Reuse the context already loaded for this conversation.
      // The selected text is kept up-to-date by handleSelectionChanged().
      freshContext = preContext;
    } else {
      // First message of the conversation — load context from Figma.
      liveBubble.updateStatus('<span class="chat-typing__spinner" aria-hidden="true"></span> Loading context…');
      freshContext = await requestDocumentContext((progress) => {
        liveBubble.updateStatus(formatContextProgressHTML(progress));
      }, /* invalidateSummary */ false);
    }

    // Ensure app summary exists — generated once per conversation, cached thereafter.
    const debug = getDebugMode();
    if (!contextAlreadyLoaded) {
      liveBubble.updateStatus('<span class="chat-typing__spinner" aria-hidden="true"></span> Analysing document…');
    }
    const appSummary = await ensureAppSummary(freshContext, modelConfig, debug);
    if (debug) {
      /* eslint-disable no-console */
      console.log("[Debug] handleGenerate — app summary:", appSummary ? `${appSummary.length} chars` : "none (fallback to raw context)");
      /* eslint-enable no-console */
    }

    // Mark context as loaded for this conversation after the first successful load
    if (!contextAlreadyLoaded) {
      markConversationContextReady();
      liveBubble.updateStatus(formatContextReadyHTML(freshContext.contextMeta));
    }
    liveBubble.showThinking();

    const chatHistory = getChatHistory();
    const alternatives = await uxWriterAgent.generate(
      prompt,
      count,
      freshContext,
      modelConfig,
      chatHistory,
      fullContext || undefined,
      appSummary
    );

    if (alternatives.length === 0) {
      liveBubble.setContent(renderMarkdown("No alternatives generated. Please refine your instruction."));
    } else {
      liveBubble.setAlternatives(alternatives);
    }

    setChatHistory([
      ...chatHistory,
      { role: "user", content: prompt },
      { role: "assistant", content: alternatives.map((a) => `• ${a.text}`).join("\n") },
    ]);
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    liveBubble.setContent(renderMarkdown(`Error: ${message}`));
    const chatHistory = getChatHistory();
    setChatHistory([
      ...chatHistory,
      { role: "user", content: prompt },
      { role: "assistant", content: `Error: ${message}` },
    ]);
    showToast(message, "error");
  } finally {
    setGenerating(false);
  }
}

// ── Ask ────────────────────────────────────────────────────────────────────────

/**
 * Handle a user question in "Ask" mode.
 * Sends the question to the LLM as a conversational UX writing Q&A request.
 * No text is applied to Figma — the AI response is shown directly in the chat.
 */
export async function handleAsk(): Promise<void> {
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

  // Read pre-refresh context for the selected text chip
  const preContext = getDocumentContext();
  const selectedChars = preContext?.selectedText?.characters ?? null;

  appendUserMessage(question, selectedChars);
  promptEl.value = "";
  setGenerating(true);

  // Create a live AI bubble with status header
  const liveBubble = createLiveAssistantBubble();

  const contextAlreadyLoaded = isConversationContextReady();

  try {
    let freshContext: DocumentContext;

    if (contextAlreadyLoaded && preContext) {
      // Reuse the context loaded for this conversation.
      freshContext = preContext;
    } else {
      // First message — load context from Figma.
      liveBubble.updateStatus('<span class="chat-typing__spinner" aria-hidden="true"></span> Loading context…');
      freshContext = await requestDocumentContext((progress) => {
        liveBubble.updateStatus(formatContextProgressHTML(progress));
      }, /* invalidateSummary */ false);
    }

    // Ensure app summary exists — once per conversation.
    const debug = getDebugMode();
    if (!contextAlreadyLoaded) {
      liveBubble.updateStatus('<span class="chat-typing__spinner" aria-hidden="true"></span> Analysing document…');
    }
    const appSummary = await ensureAppSummary(freshContext, modelConfig, debug);
    if (debug) {
      /* eslint-disable no-console */
      console.log("[Debug] handleAsk — app summary:", appSummary ? `${appSummary.length} chars` : "none (fallback to raw context)");
      /* eslint-enable no-console */
    }

    if (!contextAlreadyLoaded) {
      markConversationContextReady();
      liveBubble.updateStatus(formatContextReadyHTML(freshContext.contextMeta));
    }
    liveBubble.showThinking();

    const chatHistory = getChatHistory();
    const answer = await aiService.ask(question, freshContext, modelConfig, chatHistory, appSummary);

    liveBubble.setContent(renderMarkdown(answer));
    setChatHistory([
      ...chatHistory,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ]);
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    liveBubble.setContent(renderMarkdown(`Error: ${message}`));
    const chatHistory = getChatHistory();
    setChatHistory([
      ...chatHistory,
      { role: "user", content: question },
      { role: "assistant", content: `Error: ${message}` },
    ]);
    showToast(message, "error");
  } finally {
    setGenerating(false);
  }
}

// ── Apply text to Figma ───────────────────────────────────────────────────────

/**
 * Send a text alternative to the plugin controller to apply it to the
 * currently selected TextNode in Figma.
 */
export function applyTextToFigma(text: string): void {
  parent.postMessage(
    { pluginMessage: { type: "apply-text", text } },
    "*"
  );
}

// ── Mode switching ────────────────────────────────────────────────────────────

export function setInteractionMode(mode: "generate" | "ask"): void {
  setInteractionModeState(mode);
  safeStorage.setItem(INTERACTION_MODE_KEY, mode);
  import("./settings").then(({ persistSettingsToPlugin }) => persistSettingsToPlugin());

  const inputSection  = document.getElementById("input-section");
  const tabGenerate   = document.getElementById("mode-tab-generate");
  const tabAsk        = document.getElementById("mode-tab-ask");
  const promptEl      = document.getElementById("prompt-input") as HTMLTextAreaElement | null;
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
  if (getChatHistory().length === 0) {
    const container = document.getElementById("chat-history");
    if (container) container.innerHTML = chatEmptyStateHTML();
  }
}

// ── Generating state ──────────────────────────────────────────────────────────

export function setGenerating(active: boolean): void {
  const btn = getEl<HTMLButtonElement>("generate-btn");
  const spinner = document.getElementById("spinner");
  const label = document.getElementById("generate-label");
  btn.disabled = active;
  if (label) {
    const mode = getInteractionMode();
    if (active) {
      label.textContent = mode === "ask" ? "Asking…" : "Generating…";
    } else {
      label.textContent = mode === "ask" ? "Ask" : "Generate";
    }
  }
  if (spinner) spinner.classList.toggle("hidden", !active);
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function chatEmptyStateHTML(): string {
  if (getInteractionMode() === "ask") {
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

// ── Chat message helpers ──────────────────────────────────────────────────────

export function appendUserMessage(content: string, selectedText?: string | null): void {
  appendChatMessage("user", content, selectedText);
}

export function appendAssistantMessage(content: string): void {
  appendChatMessage("assistant", content);
}

export function appendChatMessage(role: "user" | "assistant", content: string, selectedText?: string | null): void {
  const container = getEl<HTMLDivElement>("chat-history");

  const emptyState = document.getElementById("chat-empty-state");
  if (emptyState) emptyState.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${role}`;

  const label = document.createElement("span");
  label.className = "chat-label";
  label.textContent = role === "user" ? "You" : "AI";

  bubble.appendChild(label);

  // Show selected text chip in user bubble
  if (role === "user" && selectedText) {
    const chip = document.createElement("div");
    chip.className = "chat-selected-text";
    chip.innerHTML = `<i class="fa-solid fa-font" aria-hidden="true"></i> <span>${escapeHTMLInline(selectedText)}</span>`;
    bubble.appendChild(chip);
  }

  const text = document.createElement("div");
  text.className = "chat-text";
  if (role === "assistant") {
    text.innerHTML = renderMarkdown(content);
  } else {
    text.textContent = content;
  }

  bubble.appendChild(text);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

/**
 * Render a list of text alternatives in the chat.
 * Each alternative has an "Apply" button that sends it to Figma.
 */
export function appendAlternativesMessage(alternatives: TextAlternative[]): void {
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

export function showAssistantTypingIndicator(): void {
  if (getTypingBubbleEl()) return;

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
  setTypingBubbleEl(bubble);
}

export function hideAssistantTypingIndicator(): void {
  const bubble = getTypingBubbleEl();
  if (!bubble) return;
  bubble.remove();
  setTypingBubbleEl(null);
}

// ── Live assistant bubble (context progress + thinking + response) ────────────

/**
 * Represents a live assistant bubble that can be updated progressively:
 * first with context-loading status, then thinking indicator, then final content.
 */
export interface LiveAssistantBubble {
  /** The bubble DOM element. */
  element: HTMLDivElement;
  /** Update the status header line (context loading progress, etc.). */
  updateStatus(html: string): void;
  /** Show the "Thinking…" spinner in the content area. */
  showThinking(): void;
  /** Replace the content area with the final assistant message (markdown rendered). */
  setContent(html: string): void;
  /** Replace the content area with an alternatives list. */
  setAlternatives(alternatives: TextAlternative[]): void;
}

/**
 * Create an assistant bubble with a status header and content area.
 * The bubble is immediately appended to the chat history.
 * Returns a handle to update the status and content areas.
 */
export function createLiveAssistantBubble(): LiveAssistantBubble {
  const container = getEl<HTMLDivElement>("chat-history");

  const emptyState = document.getElementById("chat-empty-state");
  if (emptyState) emptyState.remove();

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble chat-bubble--assistant";

  const label = document.createElement("span");
  label.className = "chat-label";
  label.textContent = "AI";

  const status = document.createElement("div");
  status.className = "chat-bubble__status";

  const content = document.createElement("div");
  content.className = "chat-text";

  bubble.appendChild(label);
  bubble.appendChild(status);
  bubble.appendChild(content);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;

  return {
    element: bubble,
    updateStatus(html: string): void {
      status.innerHTML = html;
      container.scrollTop = container.scrollHeight;
    },
    showThinking(): void {
      content.innerHTML = [
        '<span class="chat-typing">',
        '  <span class="chat-typing__spinner" aria-hidden="true"></span>',
        '  <span class="chat-typing__label">Thinking…</span>',
        '</span>',
      ].join("");
      container.scrollTop = container.scrollHeight;
    },
    setContent(html: string): void {
      content.innerHTML = html;
      container.scrollTop = container.scrollHeight;
    },
    setAlternatives(alternatives: TextAlternative[]): void {
      // Clear previous content
      content.innerHTML = "";

      const intro = document.createElement("p");
      intro.textContent = `${String(alternatives.length)} alternative${alternatives.length !== 1 ? "s" : ""} generated:`;
      content.appendChild(intro);

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

      content.appendChild(list);
      container.scrollTop = container.scrollHeight;
    },
  };
}

/** Format context loading progress as a status HTML string. */
export function formatContextProgressHTML(progress: {
  processedFrames: number;
  totalFrames: number;
  estimatedTokens: number;
  scopeLabel: string;
}): string {
  const total = Math.max(1, progress.totalFrames);
  const pct = Math.min(100, Math.round((progress.processedFrames / total) * 100));
  return `<span class="chat-typing__spinner" aria-hidden="true"></span> Loading context… ${String(pct)}% (${String(progress.processedFrames)}/${String(progress.totalFrames)})`;
}

/** Format the context loaded summary as a status HTML string. */
export function formatContextReadyHTML(meta: DocumentContext["contextMeta"]): string {
  if (!meta) return "Context loaded";
  const parts = [
    `${String(meta.totalTexts)} text${meta.totalTexts > 1 ? "s" : ""}`,
    `${String(meta.estimatedTokens)} tok`,
    `${String(meta.durationMs)}ms`,
  ];
  if (meta.truncated) parts.push("truncated");
  return `<i class="fa-solid fa-check" aria-hidden="true"></i> Context: ${parts.join(" · ")}`;
}

// ── New conversation confirmation ─────────────────────────────────────────────

export function openNewConvoConfirm(): void {
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

export function clearHistory(): void {
  const container = getEl<HTMLDivElement>("chat-history");
  container.innerHTML = chatEmptyStateHTML();
  setChatHistory([]);
  // Reset conversation context so the next message triggers a fresh Figma load
  resetConversationContext();
  showToast("New conversation started.");
}

// ── Toast ─────────────────────────────────────────────────────────────────────

export function showToast(message: string, level: "info" | "warning" | "error" = "info"): void {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast toast--${level} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

// ── Context helpers (used by generate) ───────────────────────────────────────

/**
 * Returns the content of the currently active functional context, or empty string.
 */
export function buildFullFunctionalContext(): string {
  const contexts = getContexts();
  const activeId = getActiveContextId();
  if (!activeId) return "";
  const active = contexts.find((c) => c.id === activeId);
  return active?.content.trim() ?? "";
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

/**
 * Convert a small subset of Markdown to safe HTML for AI chat bubbles.
 *
 * Supported syntax (in order of processing):
 *   - **bold** / __bold__
 *   - *italic* / _italic_
 *   - `inline code`
 *   - ~~strikethrough~~
 *   - Blank-line-separated paragraphs
 *   - Unordered lists  (lines starting with `- ` or `* `)
 *   - Ordered lists    (lines starting with `1. `)
 *   - Headings         (# / ## / ###)
 *   - Horizontal rule  (--- / ***)
 *
 * All raw HTML in the source string is escaped first so the LLM cannot
 * inject markup.
 */
export function renderMarkdown(raw: string): string {
  // 1. Escape HTML entities to prevent injection
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split("\n");
  const output: string[] = [];
  let inUl = false;
  let inOl = false;

  function closeList(): void {
    if (inUl) { output.push("</ul>"); inUl = false; }
    if (inOl) { output.push("</ol>"); inOl = false; }
  }

  /** Apply inline formatting to a single line of already-escaped text. */
  function inline(s: string): string {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Blank line
    if (line.trim() === "") {
      closeList();
      continue;
    }

    // Horizontal rule
    if (/^(\*{3,}|-{3,})$/.test(line.trim())) {
      closeList();
      output.push("<hr>");
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      closeList();
      const level = hMatch[1].length;
      output.push(`<h${level}>${inline(hMatch[2])}</h${level}>`);
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    if (ulMatch) {
      if (inOl) { output.push("</ol>"); inOl = false; }
      if (!inUl) { output.push("<ul>"); inUl = true; }
      output.push(`<li>${inline(ulMatch[1])}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (olMatch) {
      if (inUl) { output.push("</ul>"); inUl = false; }
      if (!inOl) { output.push("<ol>"); inOl = true; }
      output.push(`<li>${inline(olMatch[1])}</li>`);
      continue;
    }

    // Regular paragraph line
    closeList();
    output.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  return output.join("");
}

/** Escape HTML for safe inline insertion. */
function escapeHTMLInline(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
