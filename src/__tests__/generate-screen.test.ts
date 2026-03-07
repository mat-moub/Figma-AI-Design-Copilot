import { generateScreen } from "../skills/generate-screen";
import type { AIService } from "../services/ai-service";
import type { DocumentContext, ModelConfig, UIScreen } from "../types/ui-types";

const mockContext: DocumentContext = {
  designSystem: { components: ["ButtonPrimary"], colors: ["Blue"], textStyles: ["H1"] },
  screens: ["Dashboard"],
  pages: ["Page 1"],
};

const mockModelConfig: ModelConfig = { model: "gpt-4o", githubToken: "ghp_test" };

function makeMockAIService(screens: UIScreen[]): AIService {
  return {
    generateScreens: jest.fn().mockResolvedValue(screens),
    formatUserPrompt: jest.fn((p) => p),
  } as unknown as AIService;
}

describe("generateScreen", () => {
  it("returns screens from AI service", async () => {
    const mockScreens: UIScreen[] = [
      { name: "Profile Screen", layout: "vertical", elements: [{ type: "text", value: "Profile" }] },
    ];

    const aiService = makeMockAIService(mockScreens);
    const result = await generateScreen({
      prompt: "Profile screen",
      context: mockContext,
      modelConfig: mockModelConfig,
      history: [],
      agentPrompt: "You are a UX designer",
      aiService,
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Profile Screen");
  });

  it("returns fallback screen when AI returns empty array", async () => {
    const aiService = makeMockAIService([]);
    const result = await generateScreen({
      prompt: "Some screen",
      context: mockContext,
      modelConfig: mockModelConfig,
      history: [],
      agentPrompt: "You are a UX designer",
      aiService,
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Generated Screen");
    expect(result[0].elements[0].type).toBe("text");
  });

  it("calls AI service with the correct arguments", async () => {
    const aiService = makeMockAIService([{ name: "S", layout: "vertical", elements: [] }]);
    const spy = jest.spyOn(aiService, "generateScreens");

    await generateScreen({
      prompt: "Login",
      context: mockContext,
      modelConfig: mockModelConfig,
      history: [{ role: "user", content: "Hello" }],
      agentPrompt: "Agent prompt",
      aiService,
    });

    expect(spy).toHaveBeenCalledWith(
      "Login",
      "Agent prompt",
      mockContext,
      mockModelConfig,
      [{ role: "user", content: "Hello" }]
    );
  });
});
