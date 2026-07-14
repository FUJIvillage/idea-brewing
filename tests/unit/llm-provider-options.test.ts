import { describe, expect, it } from "vitest";
import { buildLlmProviderOptions } from "@/lib/llm/ai-sdk-client";
import type { Settings } from "@/lib/store/types";

const base: Settings = {
  provider: "openai",
  apiKey: "k",
  baseUrl: "",
  model: "gpt-5.6",
  effort: "",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
  cursorEffort: "",
  cursorFast: "",
  boilMaxQuestions: 20,
};

describe("buildLlmProviderOptions", () => {
  it("effort未指定なら undefined", () => {
    expect(buildLlmProviderOptions(base)).toBeUndefined();
  });

  it("OpenAI では reasoningEffort を渡す", () => {
    expect(buildLlmProviderOptions({ ...base, effort: "max" })).toEqual({
      openai: { reasoningEffort: "max" },
    });
  });

  it("OpenRouter では openrouter.reasoningEffort を渡す", () => {
    expect(
      buildLlmProviderOptions({ ...base, provider: "openrouter", effort: "high" }),
    ).toEqual({
      openrouter: { reasoningEffort: "high" },
    });
  });

  it("Ollama では ollama.reasoningEffort を渡す", () => {
    expect(
      buildLlmProviderOptions({ ...base, provider: "ollama", effort: "medium" }),
    ).toEqual({
      ollama: { reasoningEffort: "medium" },
    });
  });

  it("Google では thinkingLevel にマップする", () => {
    expect(
      buildLlmProviderOptions({ ...base, provider: "google", effort: "high" }),
    ).toEqual({
      google: { thinkingConfig: { thinkingLevel: "high" } },
    });
  });

  it("Google で max/xhigh は high に丸める", () => {
    expect(
      buildLlmProviderOptions({ ...base, provider: "google", effort: "max" }),
    ).toEqual({
      google: { thinkingConfig: { thinkingLevel: "high" } },
    });
    expect(
      buildLlmProviderOptions({ ...base, provider: "google", effort: "xhigh" }),
    ).toEqual({
      google: { thinkingConfig: { thinkingLevel: "high" } },
    });
  });

  it("fake では undefined", () => {
    expect(
      buildLlmProviderOptions({ ...base, provider: "fake", effort: "max" }),
    ).toBeUndefined();
  });
});
