import type { ChatMessage } from "../types/ui-types";
import type { LLMProvider } from "./llm-provider";

const MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";

/**
 * LLM provider that calls the Mistral AI Chat Completions API directly (BYOK).
 * The Mistral API is OpenAI-compatible — same request/response shape, different base URL and key.
 *
 * Supported models are listed in src/models.ts.
 * Requires a Mistral API key from console.mistral.ai.
 */
export class MistralProvider implements LLMProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "A Mistral API key is required. " +
        "Create one at console.mistral.ai and paste it in the API Key field."
      );
    }
    this.apiKey = apiKey;
  }

  async chat(messages: ChatMessage[], modelId: string): Promise<string> {
    const response = await fetch(MISTRAL_API_URL, {
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
          "Mistral API key is invalid or expired (401). " +
          "Please check your key at console.mistral.ai."
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Mistral rate limit or quota exceeded (429). " +
          "Please wait a moment or check your plan at console.mistral.ai."
        );
      }
      throw new Error(`Mistral API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content ?? "";
  }
}
