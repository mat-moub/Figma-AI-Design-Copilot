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
 * Used in Generate mode where a single text node is the target.
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

/**
 * Build the full selected-frame context for Ask mode.
 *
 * Priority order:
 * 1. If the screen containing the selection is in `pageTextContext`, render all
 *    its `TextEntry` items as indented markdown (richest: has role, depth, font style).
 * 2. If `selectedComponent` is available (non-text node selected), render its
 *    `texts[]` array as a markdown list with font metadata.
 * 3. If only `selectedText` is available (single text node), fall back to the
 *    same compact 2-line format used by Generate mode.
 * 4. If nothing is selected, return a "nothing selected" message.
 */
function formatSelectedContext(context: DocumentContext): string {
  const { selectedText, selectedComponent, pageTextContext } = context;

  // ── Case 1: try to find the selected frame in pageTextContext ────────────
  const screenName = selectedText?.screenName ?? selectedComponent?.screenName ?? null;
  if (screenName) {
    const screen = pageTextContext.find((s) => s.screenName === screenName);
    if (screen && screen.texts.length > 0) {
      const lines: string[] = [
        `Selected frame: **${screenName}** (${String(screen.texts.length)} text node${screen.texts.length > 1 ? "s" : ""})`,
        "",
      ];
      for (const entry of screen.texts) {
        const indent = "  ".repeat(entry.depth);
        const styled = applyMarkdownStyle(entry);
        const size   = entry.fontSize === "mixed" ? "" : ` [${String(entry.fontSize)}px]`;
        const comp   = entry.insideComponent ? " _(component)_" : "";
        lines.push(`${indent}${styled}${size}${comp}`);
      }
      // Also highlight the specifically selected node when available
      if (selectedText && selectedText.characters.trim() !== "") {
        lines.push("");
        lines.push(`> **Currently selected text node:** "${selectedText.characters}"`);
        lines.push(`> Role: ${selectedText.role}, font: ${selectedText.fontFamily} ${selectedText.fontSize === "mixed" ? "mixed" : `${String(selectedText.fontSize)}px`}${selectedText.insideComponent ? ", inside a component" : ""}`);
      }
      return lines.join("\n");
    }
  }

  // ── Case 2: selectedComponent with texts (frame/group/component selected) ─
  if (selectedComponent && selectedComponent.texts.length > 0) {
    const nodeInfo = `${selectedComponent.nodeType} "${selectedComponent.componentName}"${selectedComponent.screenName ? ` on screen "${selectedComponent.screenName}"` : ""}`;
    const lines: string[] = [
      `Selected frame: ${nodeInfo} (${String(selectedComponent.texts.length)} text node${selectedComponent.texts.length > 1 ? "s" : ""})`,
      "",
    ];
    for (const t of selectedComponent.texts) {
      const style = typeof t.fontStyle === "string" ? t.fontStyle.toLowerCase() : "";
      const isBold  = /bold|heavy|black|semibold|extrabold/.test(style);
      const isLight = /light|thin|extralight/.test(style);
      const size    = t.fontSize === "mixed" ? "mixed" : `${String(t.fontSize)}px`;
      const text    = isBold ? `**${t.characters}**` : isLight ? `_${t.characters}_` : t.characters;
      lines.push(`- ${text} [${t.fontFamily} ${size}]`);
    }
    return lines.join("\n");
  }

  // ── Case 3: single text node selected ────────────────────────────────────
  if (selectedText && selectedText.characters.trim() !== "") {
    return formatSelectedText(selectedText);
  }

  // ── Case 4: nothing selected ──────────────────────────────────────────────
  return "No text node or frame currently selected in Figma.";
}

// ─── System prompt builder ────────────────────────────────────────────────────

/**
 * Build the system prompt for alternative generation.
 * When an app summary is available it replaces the raw page text context,
 * keeping token usage lean while preserving full structural awareness.
 */
function buildAlternativesSystemPrompt(
  context: DocumentContext,
  agentPrompt: string,
  count: number,
  appSummary?: string | null
): string {
  const screens =
    context.screens.length > 0 ? context.screens.join(", ") : "None found";
  const selectedText = formatSelectedText(context.selectedText);

  const contextBlock = appSummary
    ? `## App Writing Summary\n\n${appSummary}`
    : `## Raw Text Content (grouped by screen)\n\n${formatTextContext(context.pageTextContext)}`;

  return `${agentPrompt}

---
FIGMA DOCUMENT CONTEXT
---
Current Page Screens: ${screens}

${contextBlock}

SELECTED TEXT NODE
---
${selectedText}

Generate exactly ${String(count)} distinct wording alternative${count !== 1 ? "s" : ""}.
Return ONLY the JSON array, no markdown fences, no explanation.`;
}

// ─── Summarization prompt ─────────────────────────────────────────────────────

const SUMMARIZE_SYSTEM_PROMPT = `You are an expert UX writer and content strategist.
Analyse the structured Figma text content provided and produce a concise reference summary for a UX writing AI assistant.

Your output MUST cover:
1. **App type & domain** – what kind of product/app this appears to be (e.g. "B2B SaaS onboarding flow", "e-commerce mobile app")
2. **Screens overview** – bullet list of screen names and their apparent purpose
3. **Tone of voice** – adjectives that describe the writing style (e.g. "conversational, friendly, direct")
4. **Language patterns** – recurring sentence structures, vocabulary choices, phrasing conventions (e.g. "imperative CTAs", "first-person labels", "sentence case throughout")
5. **Vocabulary & terminology** – domain-specific terms, brand words, UI labels used
6. **Text hierarchy** – how headings, body, captions and CTAs are used structurally
7. **Recurring microcopy patterns** – error messages, empty states, tooltips, hints if present

Be concise. Use markdown headings and bullet lists. Maximum 400 words.
Do NOT reproduce the raw text verbatim — synthesise and generalise.`;

// ─── Functional context generation prompt ────────────────────────────────────

const FUNCTIONAL_CONTEXT_PROMPT = `You are an expert UX writer and product strategist.
Analyse the structured Figma document text content provided and generate a functional context description that will be used to guide AI-powered UX writing for this product.

Your output MUST be a valid JSON object with exactly two fields:
{
  "title": string,   // Short product/context name, 2-5 words max (e.g. "B2B SaaS HR Tool", "Mobile Banking App")
  "content": string  // 3-5 sentence functional context: describe the product type, target users, domain, tone of voice, and any notable UX writing conventions observed. Write in first-person plural (e.g. "We are building..."). This will be injected directly into the AI system prompt.
}

Return ONLY the JSON object, no markdown fences, no explanation.`;

// ─── Provider factory ─────────────────────────────────────────────────────────

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

/**
 * Replace literal newlines inside JSON string values with `\n` so that LLM
 * responses containing multi-line text fields can be parsed without error.
 *
 * The regex matches the content between JSON string delimiters (handling
 * escaped quotes) and replaces any bare CR/LF sequences it finds there.
 */
function fixUnescapedNewlines(json: string): string {
  // Walk character by character tracking whether we're inside a string.
  // When inside a string, replace bare \n / \r\n / \r with their escape equivalents.
  let result = "";
  let inString = false;
  let i = 0;
  while (i < json.length) {
    const ch = json[i];
    if (inString) {
      if (ch === "\\") {
        // Escaped character — copy both chars verbatim
        result += ch + (json[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
        result += ch;
      } else if (ch === "\r" && json[i + 1] === "\n") {
        result += "\\n";
        i += 2;
        continue;
      } else if (ch === "\r" || ch === "\n") {
        result += "\\n";
      } else {
        result += ch;
      }
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
    i++;
  }
  return result;
}

function parseAlternativesFromResponse(raw: string): TextAlternative[] {
  // Strip potential markdown code fences
  const stripped = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Fix bare newlines inside JSON string values (common LLM output issue)
  const cleaned = fixUnescapedNewlines(stripped);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned invalid JSON: ${stripped.slice(0, 200)}`);
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
   * @param agentPrompt  The agent's system prompt (includes functional context if any).
   * @param context      The Figma document context (including selected text).
   * @param config       Provider, model, and API key configuration.
   * @param history      Previous chat messages for multi-turn conversations.
   * @param appSummary   Pre-generated app writing summary. When provided, replaces the
   *                     raw pageTextContext in the system prompt to save tokens.
   */
  async generateAlternatives(
    userPrompt: string,
    count: number,
    agentPrompt: string,
    context: DocumentContext,
    config: ModelConfig,
    history: ChatMessage[] = [],
    appSummary?: string | null
  ): Promise<TextAlternative[]> {
    const provider = createProvider(config);

    const systemMessage: ChatMessage = {
      role: "system",
      content: buildAlternativesSystemPrompt(context, agentPrompt, count, appSummary),
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
      console.log("App summary used:", appSummary ? "yes" : "no (raw context)");
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
   * @param question    The designer's question or request.
   * @param context     The Figma document context (used for awareness only).
   * @param config      Provider, model, and API key configuration.
   * @param history     Previous chat messages for multi-turn conversations.
   * @param appSummary  Pre-generated app writing summary (replaces raw pageTextContext).
   */
  async ask(
    question: string,
    context: DocumentContext,
    config: ModelConfig,
    history: ChatMessage[] = [],
    appSummary?: string | null
  ): Promise<string> {
    const provider = createProvider(config);

    const screens =
      context.screens.length > 0 ? context.screens.join(", ") : "None found";
    const selectedContext = formatSelectedContext(context);

    const contextSection = appSummary
      ? `## App Writing Summary\n\n${appSummary}`
      : `## Raw Text Content\n\n${formatTextContext(context.pageTextContext)}`;

    const systemContent =
      `You are an expert UX writer and content designer integrated into Figma. ` +
      `Answer the designer's questions with clear, actionable advice about wording, ` +
      `microcopy, tone of voice, and content strategy. ` +
      `You have awareness of the designer's Figma document:\n` +
      `  - Current Page Screens: ${screens}\n\n` +
      `${contextSection}\n\n` +
      `  - Selected Frame / Node:\n${selectedContext}\n\n` +
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
      console.log("App summary used:", appSummary ? "yes" : "no (raw context)");
      console.log("Selected context:\n", selectedContext);
      console.log("Figma context:", context);
      console.log("Raw AI response:\n", rawResponse);
      console.groupEnd();
      /* eslint-enable no-console */
    }

    return rawResponse;
  }

  /**
   * Analyse the Figma document text content and generate a functional context object
   * (title + content) that the user can save as a functional context in the plugin.
   *
   * @param context  The freshly loaded document context.
   * @param config   Provider, model, and API key configuration.
   */
  async generateFunctionalContext(
    context: DocumentContext,
    config: ModelConfig
  ): Promise<{ title: string; content: string }> {
    const provider = createProvider(config);

    const rawText = formatTextContext(context.pageTextContext);
    if (rawText === "None found") {
      return {
        title: "My context",
        content:
          "We are building an application for... " +
          "(describe your product, industry, or target users here). " +
          "Generate wording that matches our brand and tone of voice.",
      };
    }

    const systemMessage: ChatMessage = {
      role: "system",
      content: FUNCTIONAL_CONTEXT_PROMPT,
    };

    const userMessage: ChatMessage = {
      role: "user",
      content: `Here is the structured text content extracted from the Figma document:\n\n${rawText}\n\nGenerate the functional context JSON now.`,
    };

    const rawResponse = await provider.chat(
      [systemMessage, userMessage],
      String(config.model)
    );

    if (config.debug) {
      /* eslint-disable no-console */
      console.group("[AI Debug] generateFunctionalContext");
      console.log("System prompt:\n", FUNCTIONAL_CONTEXT_PROMPT);
      console.log("Raw text sent (chars):", rawText.length);
      console.log("Raw AI response:\n", rawResponse);
      console.groupEnd();
      /* eslint-enable no-console */
    }

    // Strip markdown fences and fix bare newlines before parsing
    const stripped = rawResponse
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const cleaned = fixUnescapedNewlines(stripped);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `AI returned invalid JSON for functional context: ${stripped.slice(0, 200)}`
      );
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>)["title"] !== "string" ||
      typeof (parsed as Record<string, unknown>)["content"] !== "string"
    ) {
      throw new Error(
        "AI response did not contain the expected { title, content } structure."
      );
    }

    const result = parsed as { title: string; content: string };
    return {
      title: result.title.trim(),
      content: result.content.trim(),
    };
  }

  /**
   * Analyse the full Figma text context and produce a concise writing reference summary.
   * The summary captures tone, language patterns, vocabulary, and screen structure so
   * subsequent generate/ask calls can use it instead of the raw token-heavy page text.
   *
   * @param context  The freshly loaded document context.
   * @param config   Provider, model, and API key configuration.
   */
  async summarizeAppContext(
    context: DocumentContext,
    config: ModelConfig
  ): Promise<string> {
    const provider = createProvider(config);

    const rawText = formatTextContext(context.pageTextContext);
    if (rawText === "None found") {
      return "No text content found in the Figma document.";
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: `Here is the full structured text content extracted from the Figma document:\n\n${rawText}\n\nProduce the writing reference summary now.`,
    };

    const systemMessage: ChatMessage = {
      role: "system",
      content: SUMMARIZE_SYSTEM_PROMPT,
    };

    const rawResponse = await provider.chat(
      [systemMessage, userMessage],
      String(config.model)
    );

    if (config.debug) {
      /* eslint-disable no-console */
      console.group("[AI Debug] summarizeAppContext");
      console.log("System prompt:\n", SUMMARIZE_SYSTEM_PROMPT);
      console.log("Raw text sent (chars):", rawText.length);
      console.log("Summary response:\n", rawResponse);
      console.groupEnd();
      /* eslint-enable no-console */
    }

    return rawResponse.trim();
  }
}
