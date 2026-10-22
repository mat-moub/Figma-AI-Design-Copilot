import type { ChatMessage } from "../types/ui-types";
import type { LLMProvider } from "./llm-provider";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * LLM provider that calls the Anthropic Messages API directly (BYOK).
 *
 * Supported models are listed in src/models.ts.
 * Requires an Anthropic API key (sk-ant-…).
 *
 * The Anthropic Messages API separates the `system` prompt from the
 * conversation history, so this provider extracts the first system message
 * (if present) and forwards the remaining turns as the `messages` array.
 */
export class AnthropicProvider implements LLMProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "An Anthropic API key is required. " +
        "Create one at console.anthropic.com and paste it in the API Key field."
      );
    }
    this.apiKey = apiKey;
  }

  async chat(messages: ChatMessage[], modelId: string): Promise<string> {
    // Anthropic requires the system prompt as a top-level field, not a message.
    const systemMessages = messages.filter((m) => m.role === "system");
    const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");

    // Only user/assistant turns go in `messages`; they must alternate.
    const conversationMessages: AnthropicMessage[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Anthropic requires at least one user message.
    if (conversationMessages.length === 0 || conversationMessages[0].role !== "user") {
      throw new Error("Anthropic requires the conversation to start with a user message.");
    }

    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: 4096,
      messages: conversationMessages,
    };

    if (systemPrompt) {
      body["system"] = systemPrompt;
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        // Required for direct browser access (e.g. Figma plugin iframe).
        // See: https://docs.anthropic.com/en/api/getting-started
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error(
          "Anthropic API key is invalid or expired (401). " +
          "Please check your key at console.anthropic.com."
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Anthropic rate limit or quota exceeded (429). " +
          "Please wait a moment or check your plan at console.anthropic.com."
        );
      }
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    // Reasoning models can interleave thinking and multiple visible text blocks.
    return data.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  }
}
