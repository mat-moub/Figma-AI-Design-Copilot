import type {
  ChatMessage,
  DocumentContext,
  ModelConfig,
  ScreenTextContext,
  SelectedTextContext,
  TextAlternative,
} from "../types/ui-types";
import type { LLMProvider } from "../providers/llm-provider";
import { GeminiProvider } from "../providers/gemini-provider";
import { OpenAIProvider } from "../providers/openai-provider";
import { AnthropicProvider } from "../providers/anthropic-provider";
import { MistralProvider } from "../providers/mistral-provider";

// ─── Text context formatter ───────────────────────────────────────────────────

/**
 * Render the page text context as a readable block for the system prompt.
 * Each screen section lists its text entries sorted by importance so the LLM
 * understands the content hierarchy at a glance.
 */
function formatTextContext(pageTextContext: ScreenTextContext[]): string {
  const populated = pageTextContext.filter((s) => s.texts.length > 0);
  if (populated.length === 0) return "None found";

  return populated
    .map((screen) => {
      const lines = screen.texts.map((t) => {
        const size =
          t.fontSize === "mixed" ? "mixed" : `${String(t.fontSize)}px`;
        const font =
          t.fontStyle === "mixed"
            ? t.fontFamily
            : `${t.fontFamily} ${t.fontStyle}`;
        const component = t.insideComponent ? ", in-component" : "";
        const preview =
          t.characters.length > 80
            ? `${t.characters.slice(0, 80)}…`
            : t.characters;
        return (
          `    [${t.role}, importance:${String(t.importance)}, ${size}, ${font}` +
          `${component}] "${preview}" (${String(t.charCount)} chars)`
        );
      });
      return `  Screen: "${screen.screenName}"\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

/**
 * Render the currently selected text node as a structured block for the
 * system prompt so the LLM has precise context about what it is rewriting.
 */
function formatSelectedText(selected: SelectedTextContext | null): string {
  if (!selected || selected.characters.trim() === "") {
    return "No text node currently selected in Figma.";
  }
  const size = selected.fontSize === "mixed" ? "mixed" : `${String(selected.fontSize)}px`;
  const component = selected.insideComponent ? ", inside a component" : "";
  const screen = selected.screenName ? `, on screen "${selected.screenName}"` : "";
  return (
    `Original text: "${selected.characters}" (${String(selected.charCount)} chars)\n` +
    `Role: ${selected.role}, font: ${selected.fontFamily} ${size}${component}${screen}`
  );
}

// ─── System prompt builder ────────────────────────────────────────────────────

function buildAlternativesSystemPrompt(
  context: DocumentContext,
  agentPrompt: string,
  count: number
): string {
  const screens =
    context.screens.length > 0 ? context.screens.join(", ") : "None found";
  const components =
    context.designSystem.components.length > 0
      ? context.designSystem.components.join(", ")
      : "None";
  const colors =
    context.designSystem.colors.length > 0
      ? context.designSystem.colors.join(", ")
      : "None";
  const textStyles =
    context.designSystem.textStyles.length > 0
      ? context.designSystem.textStyles.join(", ")
      : "None";
  const textContext = formatTextContext(context.pageTextContext);
  const selectedText = formatSelectedText(context.selectedText);

  return `${agentPrompt}

---
FIGMA DOCUMENT CONTEXT
---
Current Page Screens: ${screens}
Design System Components: ${components}
Design System Colors: ${colors}
Design System Text Styles: ${textStyles}

Current Page Text Content (grouped by screen, sorted by importance):
${textContext}

SELECTED TEXT NODE
---
${selectedText}

Generate exactly ${String(count)} distinct wording alternative${count !== 1 ? "s" : ""}.
Return ONLY the JSON array, no markdown fences, no explanation.`;
}

// ─── Provider factory ─────────────────────────────────────────────────────────

/**
 * Instantiate the correct `LLMProvider` from the user's `ModelConfig`.
 * Throws a descriptive error when the required API key is missing.
 */
export function createProvider(config: ModelConfig): LLMProvider {
  const provider = config.provider ?? "gemini";

  switch (provider) {
    case "gemini":
      return new GeminiProvider(config.geminiKey ?? "");

    case "openai":
      return new OpenAIProvider(config.openaiKey ?? "");

    case "anthropic":
      return new AnthropicProvider(config.anthropicKey ?? "");

    case "mistral":
    default:
      return new MistralProvider(config.mistralKey ?? "");
  }
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseAlternativesFromResponse(raw: string): TextAlternative[] {
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
    throw new Error("AI response is not a JSON array of text alternatives.");
  }

  return (parsed as Array<Record<string, unknown>>).map((item) => ({
    text: typeof item["text"] === "string" ? item["text"] : String(item["text"] ?? ""),
    rationale: typeof item["rationale"] === "string" ? item["rationale"] : undefined,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export class AIService {
  /**
   * Call the configured LLM provider and return parsed text alternatives.
   *
   * @param userPrompt   The designer's wording request or instruction.
   * @param count        Number of alternatives to generate.
   * @param agentPrompt  The agent's system prompt.
   * @param context      The Figma document context (including selected text).
   * @param config       Provider, model, and API key configuration.
   * @param history      Previous chat messages for multi-turn conversations.
   */
  async generateAlternatives(
    userPrompt: string,
    count: number,
    agentPrompt: string,
    context: DocumentContext,
    config: ModelConfig,
    history: ChatMessage[] = []
  ): Promise<TextAlternative[]> {
    const provider = createProvider(config);

    const systemMessage: ChatMessage = {
      role: "system",
      content: buildAlternativesSystemPrompt(context, agentPrompt, count),
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

    if (config.debug) {
      /* eslint-disable no-console */
      console.group("[AI Debug] generateAlternatives");
      console.log("System prompt:\n", messages[0].content);
      console.log("User prompt:\n", userPrompt);
      console.log("Figma context:", context);
      console.log("Raw AI response:\n", rawResponse);
      console.groupEnd();
      /* eslint-enable no-console */
    }

    return parseAlternativesFromResponse(rawResponse);
  }

  /**
   * Send a free-form UX writing question to the AI and return its plain-text answer.
   * Used by the "Ask" mode for conversational advice — no alternatives are generated.
   *
   * @param question  The designer's question or request.
   * @param context   The Figma document context (used for awareness only).
   * @param config    Provider, model, and API key configuration.
   * @param history   Previous chat messages for multi-turn conversations.
   */
  async ask(
    question: string,
    context: DocumentContext,
    config: ModelConfig,
    history: ChatMessage[] = []
  ): Promise<string> {
    const provider = createProvider(config);

    const screens =
      context.screens.length > 0 ? context.screens.join(", ") : "None found";
    const textContext = formatTextContext(context.pageTextContext);
    const selectedText = formatSelectedText(context.selectedText);

    const systemContent =
      `You are an expert UX writer and content designer integrated into Figma. ` +
      `Answer the designer's questions with clear, actionable advice about wording, ` +
      `microcopy, tone of voice, and content strategy. ` +
      `You have awareness of the designer's Figma document:\n` +
      `  - Current Page Screens: ${screens}\n` +
      `  - Current Page Text Content:\n${textContext}\n` +
      `  - Selected Text Node:\n${selectedText}\n\n` +
      `Respond in plain text. Be concise and helpful. Do NOT output JSON.`;

    const systemMessage: ChatMessage = { role: "system", content: systemContent };
    const conversationHistory = history.filter((m) => m.role !== "system");
    const userMessage: ChatMessage = { role: "user", content: question };

    const messages: ChatMessage[] = [
      systemMessage,
      ...conversationHistory,
      userMessage,
    ];

    const rawResponse = await provider.chat(messages, String(config.model));

    if (config.debug) {
      /* eslint-disable no-console */
      console.group("[AI Debug] ask");
      console.log("System prompt:\n", messages[0].content);
      console.log("Question:\n", question);
      console.log("Figma context:", context);
      console.log("Raw AI response:\n", rawResponse);
      console.groupEnd();
      /* eslint-enable no-console */
    }

    return rawResponse;
  }

  /**
   * Build a human-readable prompt for display in the chat history.
   */
  formatUserPrompt(prompt: string, count: number): string {
    if (count > 1) {
      return `${prompt}\n\nGenerate ${String(count)} alternatives.`;
    }
    return prompt;
  }
}
