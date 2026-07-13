import { describe, expect, it } from "vitest";
import { buildCursorModelSelection } from "@/lib/tap/cursor-engine";

describe("buildCursorModelSelection", () => {
  it("モデルIDだけを返す(パラメータ未指定)", () => {
    expect(buildCursorModelSelection("gpt-5.6-luna")).toEqual({
      id: "gpt-5.6-luna",
    });
  });

  it("空白のeffort/fastはparamsを付けない", () => {
    expect(buildCursorModelSelection("gpt-5.6-luna", { effort: "   ", fast: "  " })).toEqual({
      id: "gpt-5.6-luna",
    });
  });

  it("effortをparamsに載せる", () => {
    expect(buildCursorModelSelection("gpt-5.6-luna", { effort: "max" })).toEqual({
      id: "gpt-5.6-luna",
      params: [{ id: "effort", value: "max" }],
    });
  });

  it("fastをparamsに載せる", () => {
    expect(buildCursorModelSelection("gpt-5.6-luna", { fast: "true" })).toEqual({
      id: "gpt-5.6-luna",
      params: [{ id: "fast", value: "true" }],
    });
  });

  it("effortとfastを両方載せる", () => {
    expect(
      buildCursorModelSelection("gpt-5.6-luna", { effort: "max", fast: "false" }),
    ).toEqual({
      id: "gpt-5.6-luna",
      params: [
        { id: "effort", value: "max" },
        { id: "fast", value: "false" },
      ],
    });
  });

  it("モデルIDが空白なら既定モデルを使う", () => {
    expect(buildCursorModelSelection("   ", { effort: "high" })).toEqual({
      id: "composer-2.5",
      params: [{ id: "effort", value: "high" }],
    });
  });
});
