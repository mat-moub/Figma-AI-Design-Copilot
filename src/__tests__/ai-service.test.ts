/**
 * Unit tests for AIService.generateScreens
 *
 * Key invariant verified here: the current user message is appended to the
 * messages array exactly ONCE by generateScreens itself.  The caller must
 * supply only *previous* turns in the `history` parameter — never the turn
 * being generated.  Violating this contract caused each prompt to be
 * duplicated in the LLM context.
 */

import { AIService } from "../services/ai-service";
import type { ChatMessage, DocumentContext, ModelConfig } from "../types/ui-types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const mockContext: DocumentContext = {
  designSystem: {
    components: ["ButtonPrimary", "CardBasic"],
    colors: ["Brand Blue"],
    textStyles: ["H1", "Body"],
  },
  screens: ["Dashboard", "Login"],
  pages: ["Page 1"],
};

const mockModelConfig: ModelConfig = {
  provider: "github-copilot",
  model: "gpt-5.2",
  githubToken: "ghp_test",
};

const SCREEN_JSON = JSON.stringify([
  { name: "Test Screen", layout: "vertical", elements: [{ type: "text", value: "Hello" }] },
]);

/** Build a fetch mock that returns a valid Copilot response with the given content. */
function mockFetchWithContent(content: string): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({ choices: [{ message: { content } }] }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AIService.generateScreens", () => {
  beforeEach(() => {
    global.fetch = mockFetchWithContent(SCREEN_JSON);
  });

  it("sends system + user message when history is empty", async () => {
    const service = new AIService();
    await service.generateScreens(
      "Create a login screen",
      "You are a UX designer",
      mockContext,
      mockModelConfig,
      []
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: ChatMessage[] };

    // First message must be the system prompt
    expect(body.messages[0].role).toBe("system");
    // Last message must be the user prompt
    expect(body.messages[body.messages.length - 1]).toEqual({
      role: "user",
      content: "Create a login screen",
    });
    // Total: 1 system + 1 user
    expect(body.messages).toHaveLength(2);
  });

  it("interleaves previous turns before the current user message", async () => {
    const previousHistory: ChatMessage[] = [
      { role: "user", content: "Create a dashboard" },
      { role: "assistant", content: "• Dashboard — 5 elements" },
    ];

    const service = new AIService();
    await service.generateScreens(
      "Now add a sidebar",
      "You are a UX designer",
      mockContext,
      mockModelConfig,
      previousHistory
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: ChatMessage[] };

    // system | prev-user | prev-assistant | current-user  → 4 messages total
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "Create a dashboard" });
    expect(body.messages[2]).toEqual({ role: "assistant", content: "• Dashboard — 5 elements" });
    expect(body.messages[3]).toEqual({ role: "user", content: "Now add a sidebar" });
  });

  it("does NOT duplicate the current prompt when history is passed correctly", async () => {
    // This test guards against the regression where handleGenerate() pushed the
    // current enriched prompt into chatHistory *before* calling the agent, then
    // generateScreens appended it *again* as the final user message.
    const service = new AIService();
    const currentPrompt = "Create a profile screen";

    await service.generateScreens(
      currentPrompt,
      "You are a UX designer",
      mockContext,
      mockModelConfig,
      [] // caller passes only previous turns — NOT the current one
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: ChatMessage[] };

    const userMessages = body.messages.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe(currentPrompt);
  });

  it("strips system messages from history to avoid conflicting system prompts", async () => {
    const historyWithSystem: ChatMessage[] = [
      { role: "system", content: "Old system prompt" },
      { role: "user", content: "Previous user turn" },
    ];

    const service = new AIService();
    await service.generateScreens(
      "New request",
      "You are a UX designer",
      mockContext,
      mockModelConfig,
      historyWithSystem
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: ChatMessage[] };

    // Only one system message must appear (the freshly built one)
    const systemMessages = body.messages.filter((m) => m.role === "system");
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0].content).toContain("You are a UX designer");
  });

  it("embeds the Figma document context into the system prompt", async () => {
    const service = new AIService();
    await service.generateScreens(
      "Create a screen",
      "You are a UX designer",
      mockContext,
      mockModelConfig,
      []
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { messages: ChatMessage[] };

    const systemPrompt = body.messages[0].content;
    expect(systemPrompt).toContain("ButtonPrimary");
    expect(systemPrompt).toContain("Brand Blue");
    expect(systemPrompt).toContain("Dashboard");
  });

  it("parses and returns valid screens from the provider response", async () => {
    const service = new AIService();
    const result = await service.generateScreens(
      "Create a screen",
      "You are a UX designer",
      mockContext,
      mockModelConfig,
      []
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Screen");
    expect(result[0].layout).toBe("vertical");
  });

  it("strips markdown fences from the provider response before parsing", async () => {
    global.fetch = mockFetchWithContent("```json\n" + SCREEN_JSON + "\n```");

    const service = new AIService();
    const result = await service.generateScreens(
      "Create a screen",
      "You are a UX designer",
      mockContext,
      mockModelConfig,
      []
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Screen");
  });

  it("throws when the provider returns invalid JSON", async () => {
    global.fetch = mockFetchWithContent("not valid json");

    const service = new AIService();
    await expect(
      service.generateScreens("Create", "Agent", mockContext, mockModelConfig, [])
    ).rejects.toThrow(/invalid JSON/i);
  });

  it("throws when the provider returns a non-array JSON value", async () => {
    global.fetch = mockFetchWithContent('{"screen": "not an array"}');

    const service = new AIService();
    await expect(
      service.generateScreens("Create", "Agent", mockContext, mockModelConfig, [])
    ).rejects.toThrow(/not a JSON array/i);
  });
});
