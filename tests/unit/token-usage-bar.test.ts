import { describe, expect, it } from "vitest";
import {
  formatTokenCell,
  hasAnyTokenUsage,
  USAGE_STAGE_LABELS,
} from "@/components/token-usage-bar";

describe("token-usage-bar helpers", () => {
  it("formats missing stage as dashes", () => {
    expect(formatTokenCell(undefined)).toEqual({
      input: "—",
      output: "—",
      total: "—",
    });
  });

  it("formats counts with locale separators", () => {
    expect(formatTokenCell({ input: 1200, output: 34, total: 1234 })).toEqual({
      input: "1,200",
      output: "34",
      total: "1,234",
    });
  });

  it("detects empty usage", () => {
    expect(hasAnyTokenUsage(null)).toBe(false);
    expect(hasAnyTokenUsage({ byStage: {} })).toBe(false);
    expect(hasAnyTokenUsage({ byStage: { mash: { input: 1, output: 2, total: 3 } } })).toBe(
      true,
    );
  });

  it("has labels for every stage", () => {
    expect(USAGE_STAGE_LABELS.mash).toBe("仕込み");
    expect(USAGE_STAGE_LABELS.design).toBe("デザイン");
  });
});
