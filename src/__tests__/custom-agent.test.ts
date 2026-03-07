import { CustomAgent } from "../agents/custom-agent";
import type { CustomAgentConfig, DocumentContext, ModelConfig, UIScreen } from "../types/ui-types";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockScreens: UIScreen[] = [
  { name: "Home Screen", layout: "vertical", elements: [{ type: "text", value: "Hello" }] },
];

// Mock the skill modules so no real AI calls are made
jest.mock("../skills/generate-screen", () => ({
  generateScreen: jest.fn().mockResolvedValue([
    { name: "Home Screen", layout: "vertical", elements: [{ type: "text", value: "Hello" }] },
  ]),
}));

jest.mock("../skills/generate-variants", () => ({
  generateVariants: jest.fn().mockResolvedValue([
    { name: "Variant A", layout: "vertical", elements: [{ type: "button", value: "A" }] },
    { name: "Variant B", layout: "vertical", elements: [{ type: "button", value: "B" }] },
  ]),
}));

jest.mock("../skills/apply-design-system", () => ({
  applyDesignSystem: jest.fn(({ screens }: { screens: UIScreen[] }) => screens),
}));

jest.mock("../services/ai-service", () => ({
  AIService: jest.fn().mockImplementation(() => ({
    generateScreens: jest.fn().mockResolvedValue(mockScreens),
    formatUserPrompt: jest.fn((p: string) => p),
  })),
}));

import { generateScreen } from "../skills/generate-screen";
import { generateVariants } from "../skills/generate-variants";
import { applyDesignSystem } from "../skills/apply-design-system";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockContext: DocumentContext = {
  designSystem: { components: ["ButtonPrimary"], colors: ["Blue"], textStyles: ["H1"] },
  screens: ["Dashboard"],
  pages: ["Page 1"],
};

const mockModelConfig: ModelConfig = { model: "gpt-4o", githubToken: "ghp_test" };

function makeAgent(overrides: Partial<CustomAgentConfig> = {}): CustomAgent {
  const config: CustomAgentConfig = {
    id: "test-agent",
    name: "Test Agent",
    systemPrompt: "You are a test agent.",
    skills: ["generate-screen", "apply-design-system"],
    ...overrides,
  };
  return new CustomAgent(config);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CustomAgent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exposes id and agentName from config", () => {
    const agent = makeAgent({ id: "my-id", name: "My Agent" });
    expect(agent.id).toBe("my-id");
    expect(agent.agentName).toBe("My Agent");
  });

  describe("generate() — single screen", () => {
    it("calls generateScreen when variants === 1", async () => {
      const agent = makeAgent();
      await agent.generate("Login page", 1, mockContext, mockModelConfig);

      expect(generateScreen).toHaveBeenCalledTimes(1);
      expect(generateVariants).not.toHaveBeenCalled();
    });

    it("applies the design system when the skill is listed", async () => {
      const agent = makeAgent({ skills: ["generate-screen", "apply-design-system"] });
      await agent.generate("Login page", 1, mockContext, mockModelConfig);

      expect(applyDesignSystem).toHaveBeenCalledTimes(1);
    });

    it("skips applyDesignSystem when the skill is not listed", async () => {
      const agent = makeAgent({ skills: ["generate-screen"] });
      await agent.generate("Login page", 1, mockContext, mockModelConfig);

      expect(applyDesignSystem).not.toHaveBeenCalled();
    });

    it("passes the agent systemPrompt to generateScreen", async () => {
      const agent = makeAgent({ systemPrompt: "Custom system prompt" });
      await agent.generate("Home", 1, mockContext, mockModelConfig);

      expect(generateScreen).toHaveBeenCalledWith(
        expect.objectContaining({ agentPrompt: "Custom system prompt" })
      );
    });

    it("passes history to generateScreen", async () => {
      const agent = makeAgent();
      const history = [{ role: "user" as const, content: "Hello" }];
      await agent.generate("Home", 1, mockContext, mockModelConfig, history);

      expect(generateScreen).toHaveBeenCalledWith(
        expect.objectContaining({ history })
      );
    });
  });

  describe("generate() — variants", () => {
    it("calls generateVariants when variants > 1 and skill is listed", async () => {
      const agent = makeAgent({ skills: ["generate-screen", "generate-variants", "apply-design-system"] });
      const result = await agent.generate("Login", 3, mockContext, mockModelConfig);

      expect(generateVariants).toHaveBeenCalledTimes(1);
      expect(generateScreen).not.toHaveBeenCalled();
      expect(result).toHaveLength(2); // from mock
    });

    it("falls back to generateScreen when variants > 1 but skill not listed", async () => {
      const agent = makeAgent({ skills: ["generate-screen", "apply-design-system"] });
      await agent.generate("Login", 3, mockContext, mockModelConfig);

      expect(generateScreen).toHaveBeenCalledTimes(1);
      expect(generateVariants).not.toHaveBeenCalled();
    });

    it("passes variant count to generateVariants", async () => {
      const agent = makeAgent({
        skills: ["generate-screen", "generate-variants"],
      });
      await agent.generate("Dashboard", 4, mockContext, mockModelConfig);

      expect(generateVariants).toHaveBeenCalledWith(
        expect.objectContaining({ variants: 4 })
      );
    });
  });
});
