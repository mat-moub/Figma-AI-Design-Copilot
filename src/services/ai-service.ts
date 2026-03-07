import type {
  AIModel,
  ChatMessage,
  DocumentContext,
  ModelConfig,
  UIScreen,
} from "../types/ui-types";

// ─── GitHub Copilot API ───────────────────────────────────────────────────────

const COPILOT_API_URL = "https://api.githubcopilot.com/chat/completions";

/** Map our model ids to the identifiers accepted by the Copilot API. */
function copilotModelId(model: AIModel): string {
  switch (model) {
    case "claude-3.5-sonnet":
      return "claude-3.5-sonnet";
    case "o3-mini":
      return "o3-mini";
    case "gpt-4o":
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

// ─── GitHub Copilot request ───────────────────────────────────────────────────

async function callCopilot(
  messages: ChatMessage[],
  config: ModelConfig
): Promise<string> {
  if (!config.githubToken) {
    throw new Error(
      "A GitHub token with the 'copilot' scope is required. " +
      "Generate one at github.com/settings/tokens and paste it in the GitHub Token field."
    );
  }

  const response = await fetch(COPILOT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.githubToken}`,
      "Editor-Version": "figma-ai-design-copilot/1.0.0",
      "Editor-Plugin-Version": "figma-ai-design-copilot/1.0.0",
      "Copilot-Integration-Id": "figma-ai-design-copilot",
    },
    body: JSON.stringify({
      model: copilotModelId(config.model),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub Copilot API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? "";
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
   * Call the GitHub Copilot API and return parsed UI screens.
   *
   * @param userPrompt   The designer's natural language request.
   * @param agentPrompt  The agent's system prompt.
   * @param context      The Figma document context.
   * @param config       Model and GitHub token configuration.
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

    const rawResponse = await callCopilot(messages, config);
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

