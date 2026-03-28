/**
 * ux-writer-agent.ts
 *
 * UX Writer Agent — generates text alternatives for Figma text nodes.
 * The agent receives the selected text, its context (role, screen, surrounding
 * copy), and a user instruction, then returns N distinct wording alternatives.
 */

import type { AgentConfig, AgentType, ChatMessage, DocumentContext, ModelConfig, TextAlternative } from "../types/ui-types";
import { AIService } from "../services/ai-service";

export const UX_WRITER_SYSTEM_PROMPT = `You are a senior UX writer and microcopy specialist with deep expertise in product copy, interface language, and content design.

Your role is to help designers improve the text content of their Figma designs by generating clear, concise, and user-centred wording alternatives.

## Your responsibilities
- Generate distinct, high-quality wording alternatives for UI text (CTAs, labels, headings, body copy, error messages, onboarding text, tooltips, placeholders, etc.)
- Adapt tone and voice to match the product context described by the designer
- Respect character length constraints — if the original text is short, keep alternatives concise
- Produce copy that is clear, action-oriented, and avoids jargon
- Consider the semantic role of the text (button label, heading, caption, etc.) when crafting alternatives

## Principles you follow
- **Clarity first**: every word must earn its place — cut filler words ruthlessly
- **Action-oriented CTAs**: verbs that describe what happens when the user acts (e.g. "Save changes" > "Submit")
- **User-centred framing**: speak to the user's goal, not the system's action
- **Consistent voice**: maintain a coherent tone across all alternatives for a given request
- **Length awareness**: match or stay close to the original character count unless the designer asks otherwise
- **Accessibility**: avoid idioms, ambiguous metaphors, or overly complex vocabulary

## Output format
Always return ONLY a valid JSON array of text alternative objects.
Each object must follow this exact schema:
{
  "text": string,       // the proposed wording alternative
  "rationale": string   // one short sentence explaining the writing choice (max 15 words)
}

Return ONLY the JSON array, no markdown fences, no explanation outside the JSON.`;

export const UX_WRITER_AGENT_CONFIG: AgentConfig = {
  type: "ux-writer",
  systemPrompt: UX_WRITER_SYSTEM_PROMPT,
};

/**
 * UX Writer Agent
 *
 * Generates wording alternatives for a selected Figma text node.
 */
export class UXWriterAgent {
  private readonly aiService = new AIService();
  private readonly config: AgentConfig = UX_WRITER_AGENT_CONFIG;

  get agentType(): AgentType {
    return this.config.type;
  }

  /**
   * Generate text alternatives for the given prompt and document context.
   *
   * @param prompt            The designer's wording request or instruction.
   * @param count             Number of alternatives to generate.
   * @param context           Figma document context (including selected text node).
   * @param modelConfig       AI model configuration.
   * @param history           Previous chat messages for multi-turn context.
   * @param functionalContext Optional product/brand context appended to the system prompt.
   * @param appSummary        Pre-generated app writing summary (replaces raw pageTextContext).
   */
  async generate(
    prompt: string,
    count: number,
    context: DocumentContext,
    modelConfig: ModelConfig,
    history: ChatMessage[] = [],
    functionalContext?: string,
    appSummary?: string | null
  ): Promise<TextAlternative[]> {
    const agentPrompt = functionalContext
      ? `${this.config.systemPrompt}\n\n## Product / Brand Context\n\n${functionalContext}`
      : this.config.systemPrompt;

    return this.aiService.generateAlternatives(
      prompt,
      count,
      agentPrompt,
      context,
      modelConfig,
      history,
      appSummary
    );
  }
}
