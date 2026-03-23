/**
 * Unit tests for AIService.generateAlternatives
 *
 * Key invariant verified here: the current user message is appended to the
 * messages array exactly ONCE by generateAlternatives itself.  The caller must
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
  pageTextContext: [],
  selectedText: null,
};

const mockModelConfig: ModelConfig = {
  provider: "gemini",
  model: "gemini-flash-lite-latest",
  geminiKey: "AIza-test",
};

const ALTERNATIVES_JSON = JSON.stringify([
  { text: "Get started", rationale: "Short and action-oriented" },
  { text: "Begin your journey", rationale: "More evocative" },
]);

/** Build a fetch mock that returns a valid Gemini response with the given content. */
function mockFetchWithContent(content: string): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        candidates: [{ content: { parts: [{ text: content }], role: "model" } }],
      }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AIService.generateAlternatives", () => {
  beforeEach(() => {
    global.fetch = mockFetchWithContent(ALTERNATIVES_JSON);
  });

  it("sends systemInstruction + user content when history is empty", async () => {
    const service = new AIService();
    await service.generateAlternatives(
      "Make this CTA more compelling",
      2,
      "You are an expert UX writer",
      mockContext,
      mockModelConfig,
      []
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };

    // System prompt goes into systemInstruction
    expect(body.systemInstruction.parts[0].text).toContain("You are an expert UX writer");
    // Contents has exactly 1 user message
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[0].parts[0].text).toBe("Make this CTA more compelling");
  });

  it("interleaves previous turns before the current user message", async () => {
    const previousHistory: ChatMessage[] = [
      { role: "user", content: "Make this shorter" },
      { role: "assistant", content: "Sure, here are 2 alternatives" },
    ];

    const service = new AIService();
    await service.generateAlternatives(
      "Now make it more formal",
      2,
      "You are an expert UX writer",
      mockContext,
      mockModelConfig,
      previousHistory
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };

    // prev-user | prev-assistant (as "model") | current-user → 3 items in contents
    expect(body.contents).toHaveLength(3);
    expect(body.contents[0]).toEqual({ role: "user", parts: [{ text: "Make this shorter" }] });
    expect(body.contents[1]).toEqual({ role: "model", parts: [{ text: "Sure, here are 2 alternatives" }] });
    expect(body.contents[2]).toEqual({ role: "user", parts: [{ text: "Now make it more formal" }] });
  });

  it("does NOT duplicate the current prompt when history is passed correctly", async () => {
    const service = new AIService();
    const currentPrompt = "Suggest a friendlier tone";

    await service.generateAlternatives(
      currentPrompt,
      2,
      "You are an expert UX writer",
      mockContext,
      mockModelConfig,
      [] // caller passes only previous turns — NOT the current one
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };

    const userMessages = body.contents.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].parts[0].text).toBe(currentPrompt);
  });

  it("strips system messages from history to avoid conflicting system prompts", async () => {
    const historyWithSystem: ChatMessage[] = [
      { role: "system", content: "Old system prompt" },
      { role: "user", content: "Previous user turn" },
    ];

    const service = new AIService();
    await service.generateAlternatives(
      "New request",
      2,
      "You are an expert UX writer",
      mockContext,
      mockModelConfig,
      historyWithSystem
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string }>;
    };

    // System prompt is only in systemInstruction (no system role in contents)
    expect(body.systemInstruction.parts[0].text).toContain("You are an expert UX writer");
    const systemInContents = body.contents.filter((m) => m.role === "system");
    expect(systemInContents).toHaveLength(0);
  });

  it("embeds the Figma document context into the system prompt", async () => {
    const service = new AIService();
    await service.generateAlternatives(
      "Improve this label",
      2,
      "You are an expert UX writer",
      mockContext,
      mockModelConfig,
      []
    );

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      systemInstruction: { parts: Array<{ text: string }> };
    };

    const systemPrompt = body.systemInstruction.parts[0].text;
    expect(systemPrompt).toContain("ButtonPrimary");
    expect(systemPrompt).toContain("Brand Blue");
    expect(systemPrompt).toContain("Dashboard");
  });

  it("parses and returns valid alternatives from the provider response", async () => {
    const service = new AIService();
    const result = await service.generateAlternatives(
      "Improve this CTA",
      2,
      "You are an expert UX writer",
      mockContext,
      mockModelConfig,
      []
    );

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Get started");
    expect(result[0].rationale).toBe("Short and action-oriented");
    expect(result[1].text).toBe("Begin your journey");
  });

  it("strips markdown fences from the provider response before parsing", async () => {
    global.fetch = mockFetchWithContent("```json\n" + ALTERNATIVES_JSON + "\n```");

    const service = new AIService();
    const result = await service.generateAlternatives(
      "Improve this CTA",
      2,
      "You are an expert UX writer",
      mockContext,
      mockModelConfig,
      []
    );

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("Get started");
  });

  it("throws when the provider returns invalid JSON", async () => {
    global.fetch = mockFetchWithContent("not valid json");

    const service = new AIService();
    await expect(
      service.generateAlternatives("Improve", 2, "Agent", mockContext, mockModelConfig, [])
    ).rejects.toThrow(/invalid JSON/i);
  });

  it("throws when the provider returns a non-array JSON value", async () => {
    global.fetch = mockFetchWithContent('{"text": "not an array"}');

    const service = new AIService();
    await expect(
      service.generateAlternatives("Improve", 2, "Agent", mockContext, mockModelConfig, [])
    ).rejects.toThrow(/not a JSON array/i);
  });
});
