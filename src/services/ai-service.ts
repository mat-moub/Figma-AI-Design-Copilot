import type {
  ChatMessage,
  DocumentContext,
  ModelConfig,
  UIScreen,
} from "../types/ui-types";
import type { LLMProvider } from "../providers/llm-provider";
import { GitHubCopilotProvider } from "../providers/github-copilot-provider";
import { OpenAIProvider } from "../providers/openai-provider";
import { AnthropicProvider } from "../providers/anthropic-provider";

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildSystemPrompt(context: DocumentContext, agentPrompt: string): string {
  const components =
    context.designSystem.components.length > 0
      ? context.designSystem.components.join(", ")
      : "None found";

  const colors =
    context.designSystem.colors.length > 0
      ? context.designSystem.colors.join(", ")
      : "None found";

  const screens =
    context.screens.length > 0
      ? context.screens.join(", ")
      : "None found";

  return `${agentPrompt}

---
FIGMA DOCUMENT CONTEXT
---
Design System Components: ${components}
Design System Colors: ${colors}
Existing Screens: ${screens}

When generating UI, always return ONLY a valid JSON array of screen objects.
Each screen object must follow this exact schema:
{
  "name": string,
  "layout": "vertical" | "horizontal" | "none",
  "elements": Array<{
    "type": "text" | "button" | "input" | "card" | "image" | "icon" | "divider" | "header" | "footer" | "nav" | "list" | "modal" | "tab" | "badge" | "avatar" | "container",
    "value": string (optional),
    "component": string (optional, name of design system component),
    "children": Array<element> (optional),
    "style": object (optional)
  }>
}

Return ONLY the JSON array, no markdown fences, no explanation.`;
}

// ─── Provider factory ─────────────────────────────────────────────────────────

/**
 * Instantiate the correct `LLMProvider` from the user's `ModelConfig`.
 * Throws a descriptive error when the required API key is missing.
 */
export function createProvider(config: ModelConfig): LLMProvider {
  const provider = config.provider ?? "github-copilot";

  switch (provider) {
    case "openai":
      return new OpenAIProvider(config.openaiKey ?? "");

    case "anthropic":
      return new AnthropicProvider(config.anthropicKey ?? "");

    case "github-copilot":
    default:
      return new GitHubCopilotProvider(config.githubToken ?? "");
  }
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseScreensFromResponse(raw: string): UIScreen[] {
  // Strip potential markdown code fences
  const cleaned = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI response is not a JSON array of screens.");
  }

  return parsed as UIScreen[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class AIService {
  /**
   * Call the configured LLM provider and return parsed UI screens.
   *
   * The provider is selected from `config.provider`:
   *   - `"github-copilot"` → GitHub Copilot proxy (default, backwards-compatible)
   *   - `"openai"` → OpenAI Chat Completions API (BYOK via `config.openaiKey`)
   *   - `"anthropic"` → Anthropic Messages API (BYOK via `config.anthropicKey`)
   *
   * @param userPrompt   The designer's natural language request.
   * @param agentPrompt  The agent's system prompt.
   * @param context      The Figma document context.
   * @param config       Provider, model, and API key configuration.
   * @param history      Previous chat messages for multi-turn conversations.
   */
  async generateScreens(
    userPrompt: string,
    agentPrompt: string,
    context: DocumentContext,
    config: ModelConfig,
    history: ChatMessage[] = []
  ): Promise<UIScreen[]> {
    const provider = createProvider(config);

    const systemMessage: ChatMessage = {
      role: "system",
      content: buildSystemPrompt(context, agentPrompt),
    };

    const conversationHistory: ChatMessage[] = history.filter(
      (m) => m.role !== "system"
    );

    const userMessage: ChatMessage = {
      role: "user",
      content: userPrompt,
    };

    const messages: ChatMessage[] = [
      systemMessage,
      ...conversationHistory,
      userMessage,
    ];

    const rawResponse = await provider.chat(messages, String(config.model));
    return parseScreensFromResponse(rawResponse);
  }

  /**
   * Build a human-readable prompt for display in the chat history.
   */
  formatUserPrompt(
    prompt: string,
    variants: number,
    context: DocumentContext
  ): string {
    let full = prompt;
    if (variants > 1) {
      full += `\n\nGenerate ${variants} variants.`;
    }
    if (context.designSystem.components.length > 0) {
      full += `\n\nUse these design system components where appropriate: ${context.designSystem.components.join(", ")}.`;
    }
    return full;
  }
}
