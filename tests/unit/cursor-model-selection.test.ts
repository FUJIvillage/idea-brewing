import { describe, expect, it } from "vitest";
import { buildCursorModelSelection } from "@/lib/tap/cursor-engine";

describe("buildCursorModelSelection", () => {
  it("モデルIDだけを返す(effort未指定)", () => {
    expect(buildCursorModelSelection("gpt-5.6-luna", "")).toEqual({
      id: "gpt-5.6-luna",
    });
  });

  it("空白のeffortはparamsを付けない", () => {
    expect(buildCursorModelSelection("gpt-5.6-luna", "   ")).toEqual({
      id: "gpt-5.6-luna",
    });
  });

  it("effortをparamsに載せる", () => {
    expect(buildCursorModelSelection("gpt-5.6-luna", "max")).toEqual({
      id: "gpt-5.6-luna",
      params: [{ id: "effort", value: "max" }],
    });
  });

  it("モデルIDが空白なら既定モデルを使う", () => {
    expect(buildCursorModelSelection("   ", "high")).toEqual({
      id: "composer-2.5",
      params: [{ id: "effort", value: "high" }],
    });
  });
});
