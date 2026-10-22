import type { LLMProvider } from "./types/ui-types";

/** Text-generation catalog verified against official provider docs on 2026-10-22.
 * Sources: https://ai.google.dev/gemini-api/docs/models
 * https://developers.openai.com/api/docs/models
 * https://platform.claude.com/docs/en/models/overview
 * https://docs.mistral.ai/models
 * The first entry per provider is its default (cost-efficient tier).
 */
export const PROVIDER_MODELS = {
  gemini: [
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { value: "gemini-4-argon", label: "Gemini 4 Argon" },
  ],
  openai: [
    { value: "gpt-6-luna", label: "GPT-6 Luna" },
    { value: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
    { value: "gpt-6-astra", label: "GPT-6 Astra" },
  ],
  anthropic: [
    { value: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { value: "claude-fable-5-1", label: "Claude Fable 5.1" },
  ],
  mistral: [
    { value: "mistral-small-2603", label: "Mistral Small 4" },
    { value: "mistral-medium-3-5", label: "Mistral Medium 3.5" },
    { value: "mistral-large-4", label: "Mistral Large 4 (Preview)" },
  ],
} as const satisfies Record<LLMProvider, ReadonlyArray<{ value: string; label: string }>>;

export type ProviderModel<P extends LLMProvider> = (typeof PROVIDER_MODELS)[P][number]["value"];

const LEGACY_MODELS: Record<LLMProvider, Record<string, string>> = {
  gemini: {
    "gemini-flash-lite-latest": "gemini-3.5-flash-lite",
    "gemini-flash-latest": "gemini-3.8-flash",
    "gemini-pro-latest": "gemini-4-argon",
  },
  openai: {
    "gpt-5.4-nano": "gpt-6-luna",
    "gpt-5.4-mini": "gpt-6.1-sol",
    "gpt-5.4": "gpt-6-astra",
  },
  anthropic: {
    "claude-haiku-4-5": "claude-haiku-5-5",
    "claude-sonnet-4-6": "claude-sonnet-5-5",
    "claude-opus-4-6": "claude-opus-5-5",
  },
  mistral: {
    "mistral-small-latest": "mistral-small-2603",
    "mistral-medium-latest": "mistral-medium-3-5",
    "mistral-large-latest": "mistral-large-4",
  },
};

/** Restore a current selection, migrate an old tier, or use a valid default. */
export function resolveModel<P extends LLMProvider>(provider: P, saved?: string | null): ProviderModel<P> {
  const models = PROVIDER_MODELS[provider];
  const candidate = saved ? LEGACY_MODELS[provider][saved] ?? saved : undefined;
  return (models.find((model) => model.value === candidate)?.value ?? models[0].value) as ProviderModel<P>;
}
