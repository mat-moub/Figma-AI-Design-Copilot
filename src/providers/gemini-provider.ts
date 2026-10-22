import type { ChatMessage } from "../types/ui-types";
import type { LLMProvider } from "./llm-provider";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiPart {
  text: string;
  thought?: boolean;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: GeminiPart[]; role: string };
  }>;
}

/**
 * LLM provider that calls the Google Gemini API directly (BYOK).
 *
 * Supported models are listed in src/models.ts.
 * Requires a Google AI Studio API key.
 *
 * The Gemini API separates the system prompt from the conversation history,
 * so this provider extracts system messages and forwards them as
 * `systemInstruction`, leaving only user/model turns in `contents`.
 */
export class GeminiProvider implements LLMProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error(
        "A Google AI Studio API key is required. " +
        "Create one at aistudio.google.com/apikey and paste it in the API Key field."
      );
    }
    this.apiKey = apiKey;
  }

  async chat(messages: ChatMessage[], modelId: string): Promise<string> {
    // Extract system messages and merge them into a single system instruction
    const systemMessages = messages.filter((m) => m.role === "system");
    const conversationMessages = messages.filter((m) => m.role !== "system");

    const systemInstruction =
      systemMessages.length > 0
        ? { parts: [{ text: systemMessages.map((m) => m.content).join("\n\n") }] }
        : undefined;

    // Map ChatMessage roles to Gemini roles (assistant → model)
    const contents: GeminiContent[] = conversationMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const url = `${GEMINI_API_BASE}/${modelId}:generateContent?key=${this.apiKey}`;

    const requestBody: {
      contents: GeminiContent[];
      systemInstruction?: { parts: GeminiPart[] };
      generationConfig: { maxOutputTokens: number };
    } = {
      contents,
      generationConfig: {
        // Argon shares its token limit between thinking and the visible answer.
        maxOutputTokens: modelId === "gemini-4-argon" ? 32768 : 4096,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = systemInstruction;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 400) {
        throw new Error(
          `Gemini API error 400: ${errorText}. ` +
          "Check that the model name is correct."
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          "Gemini API key is invalid or lacks permissions (401/403). " +
          "Please check your key at aistudio.google.com/apikey."
        );
      }
      if (response.status === 429) {
        throw new Error(
          "Gemini rate limit exceeded (429). " +
          "Please wait a moment or check your quota at aistudio.google.com."
        );
      }
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as GeminiResponse;
    return data.candidates[0]?.content?.parts
      ?.filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("") ?? "";
  }
}
