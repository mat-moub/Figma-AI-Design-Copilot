import type { AgentConfig, AgentType, ChatMessage, DocumentContext, ModelConfig, UIScreen } from "../types/ui-types";
import { AIService } from "../services/ai-service";
import { generateScreen } from "../skills/generate-screen";
import { generateVariants } from "../skills/generate-variants";
import { applyDesignSystem } from "../skills/apply-design-system";

const UX_DESIGNER_SYSTEM_PROMPT = `You are a senior UX designer with deep expertise in mobile and web UI design.

Your responsibilities:
- Design coherent, user-friendly UI screens following best UX practices
- Apply clear visual hierarchy, consistent spacing, and intuitive layout patterns
- Structure interfaces that guide users naturally through workflows
- Return structured UI JSON that represents real, production-quality design intent

Design principles you follow:
- Mobile-first approach with responsive considerations
- Accessibility: meaningful labels, logical tab order
- Visual clarity: sufficient contrast, whitespace, alignment
- Consistency: reuse patterns and components across screens

Always return ONLY the JSON array of screens as instructed in the system context.`;

export const UX_DESIGNER_AGENT_CONFIG: AgentConfig = {
  type: "ux-designer",
  systemPrompt: UX_DESIGNER_SYSTEM_PROMPT,
  skills: ["generate-screen", "generate-variants", "apply-design-system"],
};

/**
 * UX Designer Agent
 *
 * Orchestrates the generation of UI screens by calling appropriate skills
 * based on the user prompt and configuration.
 */
export class UXDesignerAgent {
  private readonly aiService = new AIService();
  private readonly config: AgentConfig = UX_DESIGNER_AGENT_CONFIG;

  get agentType(): AgentType {
    return this.config.type;
  }

  /**
   * Generate UI screens for the given prompt.
   *
   * @param prompt       Natural language request from the designer.
   * @param variants     Number of screen variants to generate.
   * @param context      Figma document context.
   * @param modelConfig  AI model configuration.
   * @param history      Previous chat messages.
   */
  async generate(
    prompt: string,
    variants: number,
    context: DocumentContext,
    modelConfig: ModelConfig,
    history: ChatMessage[] = []
  ): Promise<UIScreen[]> {
    if (variants > 1) {
      // Use the variants skill
      const screens = await generateVariants({
        prompt,
        variants,
        context,
        modelConfig,
        history,
        agentPrompt: this.config.systemPrompt,
        aiService: this.aiService,
      });
      return applyDesignSystem({ screens, designSystem: context.designSystem });
    }

    // Use the single screen skill
    const screens = await generateScreen({
      prompt,
      context,
      modelConfig,
      history,
      agentPrompt: this.config.systemPrompt,
      aiService: this.aiService,
    });
    return applyDesignSystem({ screens, designSystem: context.designSystem });
  }
}
