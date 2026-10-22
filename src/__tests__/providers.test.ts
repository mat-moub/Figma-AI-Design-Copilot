/**
 * Unit tests for LLM provider implementations and the provider factory.
 *
 * Tests verify:
 * - createProvider() routes to the correct class based on config.provider
 * - Each provider constructs correct HTTP requests (method, URL, headers, body)
 * - Error handling for missing API keys, HTTP 401, and HTTP 429
 * - Anthropic provider correctly separates the system prompt from messages
 * - Response parsing extracts the assistant text content
 */

import { createProvider } from "../services/ai-service";
import { GeminiProvider } from "../providers/gemini-provider";
import { OpenAIProvider } from "../providers/openai-provider";
import { AnthropicProvider } from "../providers/anthropic-provider";
import { MistralProvider } from "../providers/mistral-provider";
import { PROVIDER_MODELS } from "../models";
import type { ChatMessage, ModelConfig } from "../types/ui-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ModelConfig>): ModelConfig {
  return {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    geminiKey: "AIza-test",
    ...overrides,
  };
}

/** Build a minimal fetch mock that resolves with the given JSON body. */
function mockFetchOk(body: unknown): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  });
}

/** Build a fetch mock that resolves with an HTTP error status. */
function mockFetchError(status: number, text: string): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(text),
  });
}

const systemMsg: ChatMessage = { role: "system", content: "You are a designer." };
const userMsg: ChatMessage = { role: "user", content: "Create a login screen." };

// ─── createProvider factory ───────────────────────────────────────────────────

describe("createProvider", () => {
  it("returns GeminiProvider for gemini", () => {
    const provider = createProvider(makeConfig({ provider: "gemini" }));
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it("returns OpenAIProvider for openai", () => {
    const provider = createProvider(
      makeConfig({ provider: "openai", openaiKey: "sk-test" })
    );
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("returns AnthropicProvider for anthropic", () => {
    const provider = createProvider(
      makeConfig({ provider: "anthropic", anthropicKey: "sk-ant-test" })
    );
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("defaults to GeminiProvider when provider is undefined", () => {
    // Simulate a config that lacks the provider field
    const config = { model: "gemini-3.5-flash-lite", geminiKey: "AIza-test" } as unknown as ModelConfig;
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(GeminiProvider);
  });
});

// ─── GeminiProvider ───────────────────────────────────────────────────────────

describe("GeminiProvider", () => {
  it.each(PROVIDER_MODELS.gemini)("supports $value without exposing thought parts", async ({ value }) => {
    const fetchMock = mockFetchOk({ candidates: [{ content: { parts: [
      { text: "internal reasoning", thought: true },
      { text: "First. " }, { text: "Second." },
    ] } }] });
    global.fetch = fetchMock;
    expect(await new GeminiProvider("AIza-test").chat([userMsg], value)).toBe("First. Second.");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`${value}:generateContent`);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig).not.toHaveProperty("temperature");
    expect(body.generationConfig.maxOutputTokens).toBe(value === "gemini-4-argon" ? 32768 : 4096);
  });
  it("throws when no API key is supplied", () => {
    expect(() => new GeminiProvider("")).toThrow(/Google AI Studio API key/i);
  });

  it("sends a POST request to the Gemini API with the correct URL and body", async () => {
    const fetchMock = mockFetchOk({
      candidates: [{ content: { parts: [{ text: "gemini response" }], role: "model" } }],
    });
    global.fetch = fetchMock;

    const provider = new GeminiProvider("AIza-test");
    const result = await provider.chat([systemMsg, userMsg], "gemini-3.5-flash-lite");

    expect(result).toBe("gemini response");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("gemini-3.5-flash-lite:generateContent");
    expect(url).toContain("key=AIza-test");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    // System message should go into systemInstruction, not contents
    expect(body["systemInstruction"]).toEqual({ parts: [{ text: "You are a designer." }] });
    expect(body["contents"]).toEqual([
      { role: "user", parts: [{ text: "Create a login screen." }] },
    ]);
  });

  it("maps assistant role to model role in contents", async () => {
    const fetchMock = mockFetchOk({
      candidates: [{ content: { parts: [{ text: "ok" }], role: "model" } }],
    });
    global.fetch = fetchMock;

    const assistantMsg: ChatMessage = { role: "assistant", content: "Previous answer" };
    const provider = new GeminiProvider("AIza-test");
    await provider.chat([userMsg, assistantMsg, userMsg], "gemini-3.5-flash-lite");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    const contents = body["contents"] as Array<{ role: string }>;
    expect(contents[1].role).toBe("model");
  });

  it("omits systemInstruction when no system message is present", async () => {
    const fetchMock = mockFetchOk({
      candidates: [{ content: { parts: [{ text: "ok" }], role: "model" } }],
    });
    global.fetch = fetchMock;

    const provider = new GeminiProvider("AIza-test");
    await provider.chat([userMsg], "gemini-3.5-flash-lite");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["systemInstruction"]).toBeUndefined();
  });

  it("throws a clear message on 401/403 Unauthorized", async () => {
    global.fetch = mockFetchError(401, "Unauthorized");
    const provider = new GeminiProvider("AIza-bad");
    await expect(provider.chat([userMsg], "gemini-3.5-flash-lite")).rejects.toThrow(
      /invalid or lacks permissions/i
    );
  });

  it("throws a clear message on 429 Too Many Requests", async () => {
    global.fetch = mockFetchError(429, "Rate limited");
    const provider = new GeminiProvider("AIza-good");
    await expect(provider.chat([userMsg], "gemini-3.5-flash-lite")).rejects.toThrow(
      /rate limit/i
    );
  });

  it("returns empty string when no text is present in response", async () => {
    const fetchMock = mockFetchOk({ candidates: [] });
    global.fetch = fetchMock;

    const provider = new GeminiProvider("AIza-test");
    const result = await provider.chat([userMsg], "gemini-3.5-flash-lite");
    expect(result).toBe("");
  });
});

// ─── OpenAIProvider ───────────────────────────────────────────────────────────

describe("MistralProvider", () => {
  it.each(PROVIDER_MODELS.mistral)("sends the verified model ID $value", async ({ value }) => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "mistral response" } }] });
    global.fetch = fetchMock;
    expect(await new MistralProvider("test-key").chat([systemMsg, userMsg], value)).toBe("mistral response");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body as string).model).toBe(value);
  });
});

describe("OpenAIProvider", () => {
  it.each(PROVIDER_MODELS.openai)("uses compatible reasoning parameters for $value", async ({ value }) => {
    const fetchMock = mockFetchOk({ choices: [{ message: { content: "ok" } }] });
    global.fetch = fetchMock;
    await new OpenAIProvider("sk-test").chat([userMsg], value);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe(value);
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_completion_tokens).toBe(4096);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  });
  it("throws when no API key is supplied", () => {
    expect(() => new OpenAIProvider("")).toThrow(/OpenAI API key/i);
  });

  it("sends a POST request to the OpenAI API with the correct headers and body", async () => {
    const fetchMock = mockFetchOk({
      choices: [{ message: { content: "openai response" } }],
    });
    global.fetch = fetchMock;

    const provider = new OpenAIProvider("sk-test");
    const result = await provider.chat([systemMsg, userMsg], "gpt-6.1-sol");

    expect(result).toBe("openai response");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-6.1-sol");
    expect(body["messages"]).toEqual([
      { role: "system", content: "You are a designer." },
      { role: "user", content: "Create a login screen." },
    ]);
  });

  it("throws a clear message on 401 Unauthorized", async () => {
    global.fetch = mockFetchError(401, "Unauthorized");
    const provider = new OpenAIProvider("sk-bad");
    await expect(provider.chat([userMsg], "gpt-6.1-sol")).rejects.toThrow(/invalid or expired/i);
  });

  it("throws a clear message on 429 Too Many Requests", async () => {
    global.fetch = mockFetchError(429, "Rate limited");
    const provider = new OpenAIProvider("sk-good");
    await expect(provider.chat([userMsg], "gpt-6.1-sol")).rejects.toThrow(/rate limit/i);
  });

  it("throws a generic error on other HTTP errors", async () => {
    global.fetch = mockFetchError(503, "Service Unavailable");
    const provider = new OpenAIProvider("sk-good");
    await expect(provider.chat([userMsg], "gpt-6.1-sol")).rejects.toThrow(
      /OpenAI API error 503/
    );
  });
});

// ─── AnthropicProvider ────────────────────────────────────────────────────────

describe("AnthropicProvider", () => {
  it("joins visible text blocks while excluding thinking", async () => {
    global.fetch = mockFetchOk({ content: [
      { type: "thinking", thinking: "internal reasoning" },
      { type: "text", text: "First. " },
      { type: "text", text: "Second." },
    ] });
    expect(await new AnthropicProvider("sk-ant-test").chat([userMsg], "claude-opus-5-5"))
      .toBe("First. Second.");
  });
  it("throws when no API key is supplied", () => {
    expect(() => new AnthropicProvider("")).toThrow(/Anthropic API key/i);
  });

  it("sends the system prompt as a top-level field, not in messages", async () => {
    const fetchMock = mockFetchOk({
      content: [{ type: "text", text: "anthropic response" }],
    });
    global.fetch = fetchMock;

    const provider = new AnthropicProvider("sk-ant-test");
    const result = await provider.chat([systemMsg, userMsg], "claude-sonnet-5-5");

    expect(result).toBe("anthropic response");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");

    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["system"]).toBe("You are a designer.");
    // The system message must NOT appear inside the messages array
    expect(body["messages"]).toEqual([
      { role: "user", content: "Create a login screen." },
    ]);
    expect(body["model"]).toBe("claude-sonnet-5-5");
  });

  it("works without a system message (omits the system field)", async () => {
    const fetchMock = mockFetchOk({
      content: [{ type: "text", text: "no system" }],
    });
    global.fetch = fetchMock;

    const provider = new AnthropicProvider("sk-ant-test");
    await provider.chat([userMsg], "claude-haiku-5-5");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["system"]).toBeUndefined();
  });

  it("merges multiple system messages into a single system field", async () => {
    const fetchMock = mockFetchOk({
      content: [{ type: "text", text: "merged" }],
    });
    global.fetch = fetchMock;

    const sys1: ChatMessage = { role: "system", content: "Part 1." };
    const sys2: ChatMessage = { role: "system", content: "Part 2." };

    const provider = new AnthropicProvider("sk-ant-test");
    await provider.chat([sys1, sys2, userMsg], "claude-opus-5-5");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["system"]).toBe("Part 1.\n\nPart 2.");
  });

  it("throws when conversation does not start with a user message", async () => {
    const provider = new AnthropicProvider("sk-ant-test");
    const assistantMsg: ChatMessage = { role: "assistant", content: "Hello" };
    await expect(provider.chat([assistantMsg], "claude-haiku-5-5")).rejects.toThrow(
      /user message/i
    );
  });

  it("throws a clear message on 401 Unauthorized", async () => {
    global.fetch = mockFetchError(401, "Unauthorized");
    const provider = new AnthropicProvider("sk-ant-bad");
    await expect(provider.chat([userMsg], "claude-haiku-5-5")).rejects.toThrow(
      /invalid or expired/i
    );
  });

  it("throws a clear message on 429 Too Many Requests", async () => {
    global.fetch = mockFetchError(429, "Rate limited");
    const provider = new AnthropicProvider("sk-ant-good");
    await expect(provider.chat([userMsg], "claude-haiku-5-5")).rejects.toThrow(
      /rate limit/i
    );
  });

  it("returns empty string when no text block is present in response", async () => {
    const fetchMock = mockFetchOk({
      content: [{ type: "image", source: "data:image/png;base64,..." }],
    });
    global.fetch = fetchMock;

    const provider = new AnthropicProvider("sk-ant-test");
    const result = await provider.chat([userMsg], "claude-haiku-5-5");
    expect(result).toBe("");
  });
});
