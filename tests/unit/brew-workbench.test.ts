import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrewWorkbench } from "@/components/brew-workbench";
import { SHEET_KEYS, type Brew, type BrewSheet } from "@/lib/store/types";

function sheet(): BrewSheet {
  return Object.fromEntries(
    SHEET_KEYS.map((key) => [
      key,
      { content: `${key} content`, sufficiency: "full", userEdited: false },
    ]),
  ) as BrewSheet;
}

function recipeReadyBrew(): Brew {
  return {
    schemaVersion: 1,
    id: "brew-ui-test",
    name: "UIテスト",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stage: "done",
    ingredients: [],
    sheet: sheet(),
    grill: { entries: [], auto: false, finished: true },
    recipeProgress: null,
    recipeGeneratedAt: "2026-01-01T00:00:00.000Z",
    batches: [],
    buildProgress: null,
    maturationProgress: null,
  };
}

describe("BrewWorkbench", () => {
  it("Phase 1のタブラベルを保ったままタップタブを表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, { initial: recipeReadyBrew() }),
    );

    expect(html).toContain("原料");
    expect(html).toContain("ブリューシート");
    expect(html).toContain("グリル");
    expect(html).toContain("レシピ");
    expect(html).toContain("タップ");
  });

  it("リモートビルド進捗がある間はタブを無効化する", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, {
        initial: {
          ...recipeReadyBrew(),
          buildProgress: { phase: "generating", detail: "別クライアントでビルド中" },
        },
      }),
    );

    expect(html).toContain("タップ");
    expect((html.match(/disabled=\"\"/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(html).toContain("タップ(1stバッチ)");
  });
});
