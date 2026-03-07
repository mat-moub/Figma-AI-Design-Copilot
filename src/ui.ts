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
import type {
  AgentType,
  AIModel,
  ChatMessage,
  DocumentContext,
  ModelConfig,
  PluginToUIMessage,
  UIScreen,
} from "./types/ui-types";

// ── State ─────────────────────────────────────────────────────────────────────

let documentContext: DocumentContext | null = null;
let chatHistory: ChatMessage[] = [];

const aiService = new AIService();
const uxAgent = new UXDesignerAgent();
const dsAgent = new DesignSystemAgent();

// ── DOM References ────────────────────────────────────────────────────────────

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

// ── Initialise ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  requestDocumentContext();
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
        `✅ ${msg.count} screen${msg.count !== 1 ? "s" : ""} have been added to your Figma document.`
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
  if (!modelConfig.apiKey && modelConfig.model !== "custom") {
    showToast("Please enter your API key in the settings.", "warning");
    return;
  }

  const context: DocumentContext = documentContext ?? {
    designSystem: { components: [], colors: [], textStyles: [] },
    screens: [],
    pages: [],
  };

  const variants = getVariantCount();
  const agentType = getSelectedAgent();

  appendUserMessage(prompt);
  promptEl.value = "";
  setGenerating(true);

  const enrichedPrompt = aiService.formatUserPrompt(prompt, variants, context);

  // Add to history for multi-turn conversations
  chatHistory.push({ role: "user", content: enrichedPrompt });

  try {
    let screens: UIScreen[];

    if (agentType === "design-system") {
      screens = await dsAgent.generate(enrichedPrompt, context, modelConfig, chatHistory);
    } else {
      screens = await uxAgent.generate(enrichedPrompt, variants, context, modelConfig, chatHistory);
    }

    const summary = formatScreensSummary(screens);
    appendAssistantMessage(`Generating ${screens.length} screen${screens.length !== 1 ? "s" : ""}…\n\n${summary}`);

    // Add AI response to history
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
  const badge = document.getElementById("ctx-badge");
  if (!badge) return;
  const total =
    context.designSystem.components.length +
    context.designSystem.colors.length +
    context.screens.length;
  badge.textContent = `${total} items`;
  badge.title = [
    `Components: ${context.designSystem.components.join(", ") || "none"}`,
    `Colors: ${context.designSystem.colors.join(", ") || "none"}`,
    `Screens: ${context.screens.join(", ") || "none"}`,
  ].join("\n");
  badge.classList.remove("hidden");
}

// ── Config helpers ────────────────────────────────────────────────────────────

function getModelConfig(): ModelConfig {
  const modelEl = getEl<HTMLSelectElement>("model-select");
  const apiKeyEl = getEl<HTMLInputElement>("api-key-input");
  const endpointEl = document.getElementById("custom-endpoint") as HTMLInputElement | null;

  return {
    model: modelEl.value as AIModel,
    apiKey: apiKeyEl.value.trim() || undefined,
    apiEndpoint: endpointEl?.value.trim() || undefined,
  };
}

function getVariantCount(): number {
  const el = getEl<HTMLInputElement>("variants-input");
  const val = parseInt(el.value, 10);
  return isNaN(val) || val < 1 ? 1 : Math.min(val, 5);
}

function getSelectedAgent(): AgentType {
  const el = getEl<HTMLSelectElement>("agent-select");
  return el.value as AgentType;
}

// ── Chat UI helpers ───────────────────────────────────────────────────────────

function appendUserMessage(content: string): void {
  appendChatMessage("user", content);
}

function appendAssistantMessage(content: string): void {
  appendChatMessage("assistant", content);
}

function appendChatMessage(role: "user" | "assistant", content: string): void {
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
  const btn = getEl<HTMLButtonElement>("api-key-toggle");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "Hide";
  } else {
    input.type = "password";
    btn.textContent = "Show";
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message: string, level: "info" | "warning" | "error" = "info"): void {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast toast--${level} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

// ── Format screens summary ────────────────────────────────────────────────────

function formatScreensSummary(screens: UIScreen[]): string {
  return screens
    .map(
      (s) =>
        `• **${s.name}** — ${s.elements.length} element${s.elements.length !== 1 ? "s" : ""} (${s.layout} layout)`
    )
    .join("\n");
}
