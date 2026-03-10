import type { ChatMessage } from "../types/ui-types";
import type { LLMProvider } from "./llm-provider";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

/**
 * LLM provider that calls the OpenAI Chat Completions API directly (BYOK).
 *
 * Supported models: gpt-5-mini, gpt-5, gpt-5.2, gpt-5.3, codex.
 * Requires an OpenAI API key (sk-…).
 */
export class OpenAIProvider implements LLMProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "An OpenAI API key is required. " +
        "Create one at platform.openai.com/api-keys and paste it in the API Key field."
      );
    }
    this.apiKey = apiKey;
  }

  async chat(messages: ChatMessage[], modelId: string): Promise<string> {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error(
          "OpenAI API key is invalid or expired (401). " +
          "Please check your key at platform.openai.com/api-keys."
        );
      }
      if (response.status === 429) {
        throw new Error(
          "OpenAI rate limit or quota exceeded (429). " +
          "Please wait a moment or check your plan at platform.openai.com."
        );
      }
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content ?? "";
  }
}
