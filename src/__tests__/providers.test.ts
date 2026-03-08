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
import { GitHubCopilotProvider } from "../providers/github-copilot-provider";
import { OpenAIProvider } from "../providers/openai-provider";
import { AnthropicProvider } from "../providers/anthropic-provider";
import type { ChatMessage, ModelConfig } from "../types/ui-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ModelConfig>): ModelConfig {
  return {
    provider: "github-copilot",
    model: "gpt-5.2",
    githubToken: "ghp_test",
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
  it("returns GitHubCopilotProvider for github-copilot", () => {
    const provider = createProvider(makeConfig({ provider: "github-copilot" }));
    expect(provider).toBeInstanceOf(GitHubCopilotProvider);
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

  it("defaults to GitHubCopilotProvider when provider is undefined", () => {
    // Simulate a config that lacks the provider field (backwards compat)
    const config = { model: "gpt-5.2", githubToken: "ghp_test" } as unknown as ModelConfig;
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(GitHubCopilotProvider);
  });
});

// ─── GitHubCopilotProvider ────────────────────────────────────────────────────

describe("GitHubCopilotProvider", () => {
  it("throws when no token is supplied", () => {
    expect(() => new GitHubCopilotProvider("")).toThrow(/GitHub token/i);
  });

  it("sends a POST request to the Copilot API with the correct headers and body", async () => {
    const fetchMock = mockFetchOk({
      choices: [{ message: { content: "response text" } }],
    });
    global.fetch = fetchMock;

    const provider = new GitHubCopilotProvider("ghp_token");
    const result = await provider.chat([systemMsg, userMsg], "gpt-5.2");

    expect(result).toBe("response text");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.githubcopilot.com/chat/completions");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer ghp_token");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-5.2");
    expect(body["messages"]).toEqual([
      { role: "system", content: "You are a designer." },
      { role: "user", content: "Create a login screen." },
    ]);
  });

  it("throws a descriptive error on non-OK response", async () => {
    global.fetch = mockFetchError(500, "Internal Server Error");
    const provider = new GitHubCopilotProvider("ghp_token");
    await expect(provider.chat([userMsg], "gpt-5.2")).rejects.toThrow(
      /GitHub Copilot API error 500/
    );
  });
});

// ─── OpenAIProvider ───────────────────────────────────────────────────────────

describe("OpenAIProvider", () => {
  it("throws when no API key is supplied", () => {
    expect(() => new OpenAIProvider("")).toThrow(/OpenAI API key/i);
  });

  it("sends a POST request to the OpenAI API with the correct headers and body", async () => {
    const fetchMock = mockFetchOk({
      choices: [{ message: { content: "openai response" } }],
    });
    global.fetch = fetchMock;

    const provider = new OpenAIProvider("sk-test");
    const result = await provider.chat([systemMsg, userMsg], "gpt-4o");

    expect(result).toBe("openai response");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");

    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["model"]).toBe("gpt-4o");
    expect(body["messages"]).toEqual([
      { role: "system", content: "You are a designer." },
      { role: "user", content: "Create a login screen." },
    ]);
  });

  it("throws a clear message on 401 Unauthorized", async () => {
    global.fetch = mockFetchError(401, "Unauthorized");
    const provider = new OpenAIProvider("sk-bad");
    await expect(provider.chat([userMsg], "gpt-4o")).rejects.toThrow(/invalid or expired/i);
  });

  it("throws a clear message on 429 Too Many Requests", async () => {
    global.fetch = mockFetchError(429, "Rate limited");
    const provider = new OpenAIProvider("sk-good");
    await expect(provider.chat([userMsg], "gpt-4o")).rejects.toThrow(/rate limit/i);
  });

  it("throws a generic error on other HTTP errors", async () => {
    global.fetch = mockFetchError(503, "Service Unavailable");
    const provider = new OpenAIProvider("sk-good");
    await expect(provider.chat([userMsg], "gpt-4o")).rejects.toThrow(
      /OpenAI API error 503/
    );
  });
});

// ─── AnthropicProvider ────────────────────────────────────────────────────────

describe("AnthropicProvider", () => {
  it("throws when no API key is supplied", () => {
    expect(() => new AnthropicProvider("")).toThrow(/Anthropic API key/i);
  });

  it("sends the system prompt as a top-level field, not in messages", async () => {
    const fetchMock = mockFetchOk({
      content: [{ type: "text", text: "anthropic response" }],
    });
    global.fetch = fetchMock;

    const provider = new AnthropicProvider("sk-ant-test");
    const result = await provider.chat([systemMsg, userMsg], "claude-sonnet-4-5");

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
    expect(body["model"]).toBe("claude-sonnet-4-5");
  });

  it("works without a system message (omits the system field)", async () => {
    const fetchMock = mockFetchOk({
      content: [{ type: "text", text: "no system" }],
    });
    global.fetch = fetchMock;

    const provider = new AnthropicProvider("sk-ant-test");
    await provider.chat([userMsg], "claude-haiku-4-5");

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
    await provider.chat([sys1, sys2, userMsg], "claude-opus-4-5");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["system"]).toBe("Part 1.\n\nPart 2.");
  });

  it("throws when conversation does not start with a user message", async () => {
    const provider = new AnthropicProvider("sk-ant-test");
    const assistantMsg: ChatMessage = { role: "assistant", content: "Hello" };
    await expect(provider.chat([assistantMsg], "claude-haiku-4-5")).rejects.toThrow(
      /user message/i
    );
  });

  it("throws a clear message on 401 Unauthorized", async () => {
    global.fetch = mockFetchError(401, "Unauthorized");
    const provider = new AnthropicProvider("sk-ant-bad");
    await expect(provider.chat([userMsg], "claude-haiku-4-5")).rejects.toThrow(
      /invalid or expired/i
    );
  });

  it("throws a clear message on 429 Too Many Requests", async () => {
    global.fetch = mockFetchError(429, "Rate limited");
    const provider = new AnthropicProvider("sk-ant-good");
    await expect(provider.chat([userMsg], "claude-haiku-4-5")).rejects.toThrow(
      /rate limit/i
    );
  });

  it("returns empty string when no text block is present in response", async () => {
    const fetchMock = mockFetchOk({
      content: [{ type: "image", source: "data:image/png;base64,..." }],
    });
    global.fetch = fetchMock;

    const provider = new AnthropicProvider("sk-ant-test");
    const result = await provider.chat([userMsg], "claude-haiku-4-5");
    expect(result).toBe("");
  });
});
