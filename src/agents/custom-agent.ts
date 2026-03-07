/**
 * custom-agent.ts
 *
 * A dynamic agent whose behaviour is driven entirely by a `CustomAgentConfig`
 * loaded from a user-provided copilot config file.  It mirrors the public API
 * of the built-in agents so that the dispatch logic in `ui.ts` can treat all
 * agents uniformly.
 */

import type { ChatMessage, CustomAgentConfig, DocumentContext, ModelConfig, UIScreen } from "../types/ui-types";
import { AIService } from "../services/ai-service";
import { generateScreen } from "../skills/generate-screen";
import { generateVariants } from "../skills/generate-variants";
import { applyDesignSystem } from "../skills/apply-design-system";

export class CustomAgent {
  private readonly aiService = new AIService();
  private readonly config: CustomAgentConfig;

  constructor(config: CustomAgentConfig) {
    this.config = config;
  }

  get id(): string {
    return this.config.id;
  }

  get agentName(): string {
    return this.config.name;
  }

  /**
   * Generate UI screens using the skill pipeline defined in the config.
   *
   * @param prompt       Natural language request from the designer.
   * @param variants     Number of screen variants to generate (≥ 1).
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
    const { systemPrompt, skills } = this.config;
    const useVariants = variants > 1 && skills.includes("generate-variants");
    const useDesignSystem = skills.includes("apply-design-system");

    let screens: UIScreen[];

    if (useVariants) {
      screens = await generateVariants({
        prompt,
        variants,
        context,
        modelConfig,
        history,
        agentPrompt: systemPrompt,
        aiService: this.aiService,
      });
    } else {
      screens = await generateScreen({
        prompt,
        context,
        modelConfig,
        history,
        agentPrompt: systemPrompt,
        aiService: this.aiService,
      });
    }

    if (useDesignSystem) {
      screens = applyDesignSystem({ screens, designSystem: context.designSystem });
    }

    return screens;
  }
}
