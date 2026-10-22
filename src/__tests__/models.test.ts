import { PROVIDER_MODELS, resolveModel } from "../models";
import type { LLMProvider } from "../types/ui-types";

describe("saved model selection", () => {
  it.each(Object.keys(PROVIDER_MODELS) as LLMProvider[])(
    "restores every current %s selection and defaults invalid selections",
    (provider) => {
      for (const model of PROVIDER_MODELS[provider]) {
        expect(resolveModel(provider, model.value)).toBe(model.value);
      }
      for (const saved of [null, undefined, "", "retired-model", "toString", "constructor"]) {
        expect(resolveModel(provider, saved)).toBe(PROVIDER_MODELS[provider][0].value);
      }
    }
  );

  it.each([
    ["gemini", "gemini-flash-lite-latest", "gemini-3.5-flash-lite"],
    ["gemini", "gemini-flash-latest", "gemini-3.8-flash"],
    ["gemini", "gemini-pro-latest", "gemini-4-argon"],
    ["openai", "gpt-5.4-nano", "gpt-6-luna"],
    ["openai", "gpt-5.4-mini", "gpt-6.1-sol"],
    ["openai", "gpt-5.4", "gpt-6-astra"],
    ["anthropic", "claude-haiku-4-5", "claude-haiku-5-5"],
    ["anthropic", "claude-sonnet-4-6", "claude-sonnet-5-5"],
    ["anthropic", "claude-opus-4-6", "claude-opus-5-5"],
    ["mistral", "mistral-small-latest", "mistral-small-2603"],
    ["mistral", "mistral-medium-latest", "mistral-medium-3-5"],
    ["mistral", "mistral-large-latest", "mistral-large-4"],
  ])("migrates %s model %s to %s", (provider, saved, expected) => {
    expect(resolveModel(provider as LLMProvider, saved)).toBe(expected);
  });

  it("rejects a model saved under the wrong provider", () => {
    expect(resolveModel("gemini", "gpt-6-astra")).toBe("gemini-3.5-flash-lite");
  });
});
