import type { AIService } from "../services/ai-service";
import type { ChatMessage, DocumentContext, ModelConfig, UIScreen } from "../types/ui-types";

export interface GenerateScreenInput {
  prompt: string;
  context: DocumentContext;
  modelConfig: ModelConfig;
  history: ChatMessage[];
  agentPrompt: string;
  aiService: AIService;
}

/**
 * Generate Screen Skill
 *
 * Creates a single UI screen from a natural language prompt using the
 * configured AI model and Figma document context.
 */
export async function generateScreen(input: GenerateScreenInput): Promise<UIScreen[]> {
  const { prompt, context, modelConfig, history, agentPrompt, aiService } = input;

  const screens = await aiService.generateScreens(
    prompt,
    agentPrompt,
    context,
    modelConfig,
    history
  );

  // Ensure at least one screen was returned
  if (screens.length === 0) {
    return [
      {
        name: "Generated Screen",
        layout: "vertical",
        elements: [{ type: "text", value: "No content generated. Please refine your prompt." }],
      },
    ];
  }

  return screens;
}
