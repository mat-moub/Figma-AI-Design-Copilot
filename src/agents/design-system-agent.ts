import type { AgentConfig, AgentType, ChatMessage, DocumentContext, ModelConfig, UIScreen } from "../types/ui-types";
import { AIService } from "../services/ai-service";
import { applyDesignSystem } from "../skills/apply-design-system";
import { generateScreen } from "../skills/generate-screen";

const DESIGN_SYSTEM_SYSTEM_PROMPT = `You are a design system expert with deep knowledge of component libraries, tokens, and style guides.

Your responsibilities:
- Ensure all generated UI strictly uses components from the provided design system
- Map generic UI patterns to specific named design system components
- Validate color, typography, and spacing usage against established tokens
- Flag or correct any deviation from design system standards

When generating UI:
- Prefer named design system components over generic elements
- Use the exact component names provided in the context (e.g. ButtonPrimary, CardAnalytics)
- Apply design tokens for colors and typography where possible
- Keep visual consistency across all generated screens

Always return ONLY the JSON array of screens as instructed in the system context.`;

export const DESIGN_SYSTEM_AGENT_CONFIG: AgentConfig = {
  type: "design-system",
  systemPrompt: DESIGN_SYSTEM_SYSTEM_PROMPT,
  skills: ["generate-screen", "apply-design-system"],
};

/**
 * Design System Agent
 *
 * Specialises in generating UI that strictly adheres to the documented
 * design system found in the Figma document.
 */
export class DesignSystemAgent {
  private readonly aiService = new AIService();
  private readonly config: AgentConfig = DESIGN_SYSTEM_AGENT_CONFIG;

  get agentType(): AgentType {
    return this.config.type;
  }

  /**
   * Generate design-system-compliant screens for the given prompt.
   */
  async generate(
    prompt: string,
    context: DocumentContext,
    modelConfig: ModelConfig,
    history: ChatMessage[] = []
  ): Promise<UIScreen[]> {
    const screens = await generateScreen({
      prompt,
      context,
      modelConfig,
      history,
      agentPrompt: this.config.systemPrompt,
      aiService: this.aiService,
    });

    // Always enforce design system mapping
    return applyDesignSystem({ screens, designSystem: context.designSystem });
  }
}
