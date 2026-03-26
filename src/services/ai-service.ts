import type {
  ChatMessage,
  DocumentContext,
  ModelConfig,
  ScreenTextContext,
  SelectedTextContext,
  TextAlternative,
  TextEntry,
} from "../types/ui-types";
import type { LLMProvider } from "../providers/llm-provider";
import { GeminiProvider } from "../providers/gemini-provider";
import { OpenAIProvider } from "../providers/openai-provider";
import { AnthropicProvider } from "../providers/anthropic-provider";
import { MistralProvider } from "../providers/mistral-provider";

// ─── Text context formatter ───────────────────────────────────────────────────

/**
 * Apply Figma-style markdown formatting to a text entry's content string:
 * - headings → `##` / `###` (scaled by nesting depth)
 * - bold font styles → `**text**`
 * - captions / light fonts → `_text_`
 * - button / CTA roles → `` `text` ``
 * - plain body text → left as-is
 */
function applyMarkdownStyle(entry: TextEntry): string {
  const { characters, role, fontStyle, depth } = entry;
  const style = typeof fontStyle === "string" ? fontStyle.toLowerCase() : "";
  const isBold   = /bold|heavy|black|semibold|extrabold/.test(style);
  const isLight  = /light|thin|extralight/.test(style);

  if (role === "heading") {
    // h2 at depth 0, h3 at depth 1, h4+ beyond
    const hashes = depth === 0 ? "##" : depth === 1 ? "###" : "####";
    return `${hashes} ${characters}`;
  }
  if (role === "subheading") {
    const hashes = depth <= 1 ? "###" : "####";
    return `${hashes} ${characters}`;
  }
  if (role === "button") {
    return `\`${characters}\``;
  }
  if (isBold) {
    return `**${characters}**`;
  }
  if (role === "caption" || isLight) {
    return `_${characters}_`;
  }
  return characters;
}

/**
 * Render the page text context as structured markdown for the system prompt.
 *
 * Format:
 * ```
 * # Screen name
 *
 * ## Heading text          ← role=heading, depth=0
 *   ### Sub-heading        ← role=subheading, depth=1 (inside a container)
 *   **Bold label**         ← bold font, depth=1
 *   _caption text_         ← caption role or light font
 *   `Button label`         ← button/CTA role
 *     Plain body copy      ← depth=2, inside nested container
 * ```
 *
 * Indentation mirrors the Figma frame hierarchy via `depth`.
 * A font size hint `[14px]` is appended when the size is known.
 */
function formatTextContext(pageTextContext: ScreenTextContext[]): string {
  const populated = pageTextContext.filter((s) => s.texts.length > 0);
  if (populated.length === 0) return "None found";

  return populated
    .map((screen) => {
      const lines: string[] = [`# ${screen.screenName}`, ""];

      for (const entry of screen.texts) {
        const indent = "  ".repeat(entry.depth);
        const styled = applyMarkdownStyle(entry);
        const size   = entry.fontSize === "mixed" ? "" : ` [${String(entry.fontSize)}px]`;
        lines.push(`${indent}${styled}${size}`);
      }

      return lines.join("\n");
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
  const textContext = formatTextContext(context.pageTextContext);
  const selectedText = formatSelectedText(context.selectedText);

  return `${agentPrompt}

---
FIGMA DOCUMENT CONTEXT
---
Current Page Screens: ${screens}

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
}
