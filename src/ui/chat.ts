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
  CONTEXT_STALE_MS,
  INTERACTION_MODE_KEY,
  getDocumentContext,
  getChatHistory,
  setChatHistory,
  getInteractionMode,
  setInteractionModeState,
  getTypingBubbleEl,
  setTypingBubbleEl,
  EMPTY_DOCUMENT_CONTEXT,
} from "./index";
import { getModelConfig, validateApiKey, getAlternativesCount } from "./settings";
import { getContexts, getActiveContextId, requestDocumentContext } from "./context";

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

  const documentContext = getDocumentContext();
  const context: DocumentContext = documentContext ?? EMPTY_DOCUMENT_CONTEXT;

  // Warn the designer if the Figma context snapshot is stale
  const { getContextFetchedAt } = await import("./index");
  const contextFetchedAt = getContextFetchedAt();
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
    const chatHistory = getChatHistory();
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

    setChatHistory([
      ...chatHistory,
      { role: "user", content: prompt },
      { role: "assistant", content: alternatives.map((a) => `• ${a.text}`).join("\n") },
    ]);
  } catch (err) {
    setGenerating(false);
    hideAssistantTypingIndicator();
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    appendAssistantMessage(`Error: ${message}`);
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

  const documentContext = getDocumentContext();
  const context: DocumentContext = documentContext ?? EMPTY_DOCUMENT_CONTEXT;

  appendUserMessage(question);
  promptEl.value = "";
  setGenerating(true);
  showAssistantTypingIndicator();

  try {
    const chatHistory = getChatHistory();
    const answer = await aiService.ask(question, context, modelConfig, chatHistory);

    hideAssistantTypingIndicator();
    appendAssistantMessage(answer);
    setChatHistory([
      ...chatHistory,
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ]);
  } catch (err) {
    hideAssistantTypingIndicator();
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    appendAssistantMessage(`Error: ${message}`);
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

export function appendUserMessage(content: string): void {
  appendChatMessage("user", content);
}

export function appendAssistantMessage(content: string): void {
  appendChatMessage("assistant", content);
}

export function appendChatMessage(role: "user" | "assistant", content: string): void {
  const container = getEl<HTMLDivElement>("chat-history");

  const emptyState = document.getElementById("chat-empty-state");
  if (emptyState) emptyState.remove();

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${role}`;

  const label = document.createElement("span");
  label.className = "chat-label";
  label.textContent = role === "user" ? "You" : "AI";

  const text = document.createElement("div");
  text.className = "chat-text";
  if (role === "assistant") {
    text.innerHTML = renderMarkdown(content);
  } else {
    text.textContent = content;
  }

  bubble.appendChild(label);
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
