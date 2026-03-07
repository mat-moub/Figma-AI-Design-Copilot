import type { AIService } from "../services/ai-service";
import type { ChatMessage, DocumentContext, ModelConfig, UIScreen } from "../types/ui-types";

export interface GenerateVariantsInput {
  prompt: string;
  variants: number;
  context: DocumentContext;
  modelConfig: ModelConfig;
  history: ChatMessage[];
  agentPrompt: string;
  aiService: AIService;
}

/**
 * Generate Variants Skill
 *
 * Produces multiple UI design alternatives (variants A, B, C …) for the
 * same prompt by instructing the AI to return an array of distinct screens.
 */
export async function generateVariants(input: GenerateVariantsInput): Promise<UIScreen[]> {
  const { prompt, variants, context, modelConfig, history, agentPrompt, aiService } = input;

  const variantLabels = Array.from({ length: variants }, (_, i) =>
    String.fromCharCode(65 + i)
  ).join(", ");

  const variantPrompt =
    `${prompt}\n\nGenerate exactly ${variants} distinct design variants labeled Variant ${variantLabels}. ` +
    `Each variant should explore a different visual approach or layout while fulfilling the same goal. ` +
    `Return all ${variants} variants as separate objects in the JSON array.`;

  const screens = await aiService.generateScreens(
    variantPrompt,
    agentPrompt,
    context,
    modelConfig,
    history
  );

  // Ensure variants are correctly named if AI didn't label them
  return screens.map((screen, index) => ({
    ...screen,
    name: screen.name.includes("Variant")
      ? screen.name
      : `${screen.name} Variant ${String.fromCharCode(65 + index)}`,
  }));
}
