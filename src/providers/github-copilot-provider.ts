import type { ChatMessage } from "../types/ui-types";
import type { LLMProvider } from "./llm-provider";

const COPILOT_API_URL = "https://api.githubcopilot.com/chat/completions";

/**
 * LLM provider that routes requests through the GitHub Copilot proxy API.
 *
 * Requires a GitHub Personal Access Token with the `copilot` scope.
 * All Copilot-proxied models (GPT, Claude, Gemini) are accessed through
 * the single `chat/completions` endpoint.
 */
export class GitHubCopilotProvider implements LLMProvider {
  private readonly token: string;

  constructor(token: string) {
    if (!token) {
      throw new Error(
        "A GitHub token with the 'copilot' scope is required. " +
        "Generate one at github.com/settings/tokens and paste it in the GitHub Token field."
      );
    }
    this.token = token;
  }

  async chat(messages: ChatMessage[], modelId: string): Promise<string> {
    const response = await fetch(COPILOT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        "Editor-Version": "figma-ai-design-copilot/1.0.0",
        "Editor-Plugin-Version": "figma-ai-design-copilot/1.0.0",
        "Copilot-Integration-Id": "figma-ai-design-copilot",
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
      throw new Error(
        `GitHub Copilot API error ${response.status}: ${errorText}`
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    return data.choices[0]?.message?.content ?? "";
  }
}
