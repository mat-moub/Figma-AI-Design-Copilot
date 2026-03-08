import { generateVariants } from "../skills/generate-variants";
import type { AIService } from "../services/ai-service";
import type { DocumentContext, ModelConfig, UIScreen } from "../types/ui-types";

const mockContext: DocumentContext = {
  designSystem: { components: [], colors: [], textStyles: [] },
  screens: [],
  pages: [],
};

const mockModelConfig: ModelConfig = { model: "gpt-5.2", githubToken: "ghp_test" };

function makeMockAIService(screens: UIScreen[]): AIService {
  return {
    generateScreens: jest.fn().mockResolvedValue(screens),
    formatUserPrompt: jest.fn((p) => p),
  } as unknown as AIService;
}

describe("generateVariants", () => {
  it("returns the correct number of variants", async () => {
    const mockScreens: UIScreen[] = [
      { name: "Login Variant A", layout: "vertical", elements: [] },
      { name: "Login Variant B", layout: "vertical", elements: [] },
      { name: "Login Variant C", layout: "vertical", elements: [] },
    ];

    const aiService = makeMockAIService(mockScreens);
    const result = await generateVariants({
      prompt: "Login screen",
      variants: 3,
      context: mockContext,
      modelConfig: mockModelConfig,
      history: [],
      agentPrompt: "You are a UX designer",
      aiService,
    });

    expect(result).toHaveLength(3);
  });

  it("adds variant label when screen name does not contain 'Variant'", async () => {
    const mockScreens: UIScreen[] = [
      { name: "Login Screen", layout: "vertical", elements: [] },
      { name: "Login Screen", layout: "vertical", elements: [] },
    ];

    const aiService = makeMockAIService(mockScreens);
    const result = await generateVariants({
      prompt: "Login screen",
      variants: 2,
      context: mockContext,
      modelConfig: mockModelConfig,
      history: [],
      agentPrompt: "You are a UX designer",
      aiService,
    });

    expect(result[0].name).toContain("Variant A");
    expect(result[1].name).toContain("Variant B");
  });

  it("preserves existing variant labels in screen names", async () => {
    const mockScreens: UIScreen[] = [
      { name: "Login Variant Alpha", layout: "vertical", elements: [] },
    ];

    const aiService = makeMockAIService(mockScreens);
    const result = await generateVariants({
      prompt: "Login screen",
      variants: 1,
      context: mockContext,
      modelConfig: mockModelConfig,
      history: [],
      agentPrompt: "You are a UX designer",
      aiService,
    });

    expect(result[0].name).toBe("Login Variant Alpha");
  });

  it("includes variant count in the prompt sent to AI", async () => {
    const aiService = makeMockAIService([]);
    const generateScreensSpy = jest.spyOn(aiService, "generateScreens");

    await generateVariants({
      prompt: "Dashboard",
      variants: 3,
      context: mockContext,
      modelConfig: mockModelConfig,
      history: [],
      agentPrompt: "You are a UX designer",
      aiService,
    }).catch(() => null);

    const calledPrompt = (generateScreensSpy.mock.calls[0] as string[])[0] as string;
    expect(calledPrompt).toContain("3");
    expect(calledPrompt).toContain("Variant");
  });
});
