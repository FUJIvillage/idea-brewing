import { describe, expect, it } from "vitest";
import {
  addTokenUsage,
  normalizeUsage,
  stageForTag,
  sumTokenUsage,
} from "@/lib/llm/usage";
import type { Brew } from "@/lib/store/types";

describe("stageForTag", () => {
  it("maps tags to stages and ignores connection-test", () => {
    expect(stageForTag("mash")).toBe("mash");
    expect(stageForTag("boil-next")).toBe("boil");
    expect(stageForTag("boil-apply")).toBe("boil");
    expect(stageForTag("recipe")).toBe("recipe");
    expect(stageForTag("evaluate")).toBe("evaluate");
    expect(stageForTag("pub-persona")).toBe("pub");
    expect(stageForTag("pub-action")).toBe("pub");
    expect(stageForTag("pub-feedback")).toBe("pub");
    expect(stageForTag("pub-summary")).toBe("pub");
    expect(stageForTag("connection-test")).toBeNull();
  });
});

describe("normalizeUsage", () => {
  it("reads inputTokens/outputTokens", () => {
    expect(normalizeUsage({ inputTokens: 10, outputTokens: 5 })).toEqual({
      input: 10,
      output: 5,
      total: 15,
    });
  });

  it("falls back to prompt/completion aliases", () => {
    expect(normalizeUsage({ promptTokens: 3, completionTokens: 7 })).toEqual({
      input: 3,
      output: 7,
      total: 10,
    });
  });

  it("prefers explicit totalTokens when present", () => {
    expect(
      normalizeUsage({ inputTokens: 1, outputTokens: 1, totalTokens: 9 }),
    ).toEqual({ input: 1, output: 1, total: 9 });
  });

  it("treats missing as 0", () => {
    expect(normalizeUsage(undefined)).toEqual({ input: 0, output: 0, total: 0 });
    expect(normalizeUsage(null)).toEqual({ input: 0, output: 0, total: 0 });
  });
});

describe("addTokenUsage / sumTokenUsage", () => {
  const empty = { tokenUsage: null } as Brew;

  it("accumulates per stage", () => {
    const once = addTokenUsage(empty, "mash", { input: 1, output: 2, total: 3 });
    const twice = addTokenUsage(once, "mash", { input: 4, output: 5, total: 9 });
    expect(twice.tokenUsage?.byStage.mash).toEqual({ input: 5, output: 7, total: 12 });
    const withBoil = addTokenUsage(twice, "boil", { input: 1, output: 1, total: 2 });
    expect(sumTokenUsage(withBoil.tokenUsage)).toEqual({ input: 6, output: 8, total: 14 });
  });

  it("sums empty usage as zeros", () => {
    expect(sumTokenUsage(null)).toEqual({ input: 0, output: 0, total: 0 });
    expect(sumTokenUsage({ byStage: {} })).toEqual({ input: 0, output: 0, total: 0 });
  });
});
