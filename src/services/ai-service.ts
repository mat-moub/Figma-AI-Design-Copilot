import type {
  AIModel,
  ChatMessage,
  DocumentContext,
  ModelConfig,
  UIScreen,
} from "../types/ui-types";

// ─── Model endpoint helpers ───────────────────────────────────────────────────

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function openAIModelId(model: AIModel): string {
  switch (model) {
    case "copilot-gpt-4":
      return "gpt-4";
    case "gpt-4o":
      return "gpt-4o";
    default:
      return "gpt-4o";
  }
}

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

// ─── OpenAI-compatible request ────────────────────────────────────────────────

async function callOpenAI(
  messages: ChatMessage[],
  config: ModelConfig
): Promise<string> {
  if (!config.apiKey) {
    throw new Error("API key is required for OpenAI / Copilot models.");
  }

  const endpoint = config.apiEndpoint ?? OPENAI_API_URL;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: openAIModelId(config.model),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? "";
}

// ─── Anthropic request ────────────────────────────────────────────────────────

async function callClaude(
  messages: ChatMessage[],
  config: ModelConfig
): Promise<string> {
  if (!config.apiKey) {
    throw new Error("API key is required for Claude.");
  }

  const systemMsg = messages.find((m) => m.role === "system");
  const userMessages = messages.filter((m) => m.role !== "system");

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: systemMsg?.content ?? "",
      messages: userMessages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };

  return data.content.find((c) => c.type === "text")?.text ?? "";
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
   * Call the configured AI model and return parsed UI screens.
   *
   * @param userPrompt   The designer's natural language request.
   * @param agentPrompt  The agent's system prompt.
   * @param context      The Figma document context.
   * @param config       Model and API key configuration.
   * @param history      Previous chat messages for multi-turn conversations.
   */
  async generateScreens(
    userPrompt: string,
    agentPrompt: string,
    context: DocumentContext,
    config: ModelConfig,
    history: ChatMessage[] = []
  ): Promise<UIScreen[]> {
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

    let rawResponse: string;

    switch (config.model) {
      case "claude-3-5-sonnet":
        rawResponse = await callClaude(messages, config);
        break;
      case "copilot-gpt-4":
      case "gpt-4o":
      case "custom":
      default:
        rawResponse = await callOpenAI(messages, config);
        break;
    }

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
