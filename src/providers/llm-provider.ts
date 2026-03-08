import type { ChatMessage } from "../types/ui-types";

/**
 * Common interface for all LLM provider implementations.
 *
 * Each provider receives the conversation as a list of ChatMessages and the
 * provider-specific model identifier, then returns the assistant's response
 * as a plain string.
 *
 * The skill/tool orchestration layer lives above this interface: skills call
 * the provider via `AIService.generateScreens()`, which delegates here.
 */
export interface LLMProvider {
  /**
   * Send a conversation to the underlying LLM and return the assistant's
   * response text.
   *
   * @param messages  Full conversation including system, user, and assistant turns.
   * @param modelId   Provider-specific model identifier.
   */
  chat(messages: ChatMessage[], modelId: string): Promise<string>;
}
