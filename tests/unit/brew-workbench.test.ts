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
    boil: { entries: [], auto: false, finished: true },
    recipeProgress: null,
    recipeGeneratedAt: "2026-01-01T00:00:00.000Z",
    batches: [],
    buildProgress: null,
    maturationProgress: null,
    pubProgress: null,
    designMock: null,
    tokenUsage: null,
  };
}

describe("BrewWorkbench", () => {
  it("Phase 1のタブラベルを保ったままタップタブを表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, { initial: recipeReadyBrew() }),
    );

    expect(html).toContain("原料");
    expect(html).toContain("ブリューシート");
    expect(html).toContain("煮沸");
    expect(html).toContain("レシピ");
    expect(html).toContain("デザイン");
    expect(html).toContain("タップ");
    expect(html).toContain("トークン消費");
    expect(html).toContain("まだトークン消費なし");
  });

  it("tokenUsage があるときは工程別と合計を出す", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, {
        initial: {
          ...recipeReadyBrew(),
          tokenUsage: {
            byStage: {
              mash: { input: 10, output: 20, total: 30 },
              boil: { input: 1, output: 2, total: 3 },
            },
          },
        },
      }),
    );
    expect(html).toContain("仕込み");
    expect(html).toContain("煮沸");
    expect(html).toContain("合計 入 11 / 出 22 / 計 33");
  });

  it("デザインモック生成中はデザインパネルを表示しタブを無効化する", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, {
        initial: {
          ...recipeReadyBrew(),
          designMock: {
            status: "generating",
            generatedAt: null,
            error: null,
            model: "",
            costUsd: null,
            durationMs: null,
          },
        },
      }),
    );

    expect(html).toContain("モックアップを生成中");
    expect((html.match(/disabled=\"\"/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // 最初のプレビューが出るまではチルアニメを表示する
    expect(html).toContain("/anim/design-chill.gif");
  });

  it("レシピ生成中は発酵アニメを表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, {
        initial: {
          ...recipeReadyBrew(),
          recipeProgress: { current: 2, total: 7, file: "01-requirements.md" },
        },
      }),
    );

    expect(html).toContain("/anim/ferment-chill.gif");
  });

  it("熟成進捗中は熟成アニメを表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, {
        initial: {
          ...recipeReadyBrew(),
          batches: [
            {
              number: 1,
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:01:00.000Z",
              error: null,
              evaluation: null,
              pub: null,
            },
          ],
          maturationProgress: { phase: "evaluating", detail: "採点中", batch: 1 },
        },
      }),
    );

    expect(html).toContain("/anim/mature-chill.gif");
  });

  it("デザインモック成功時はモック画像と再生成ボタンを表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, {
        initial: {
          ...recipeReadyBrew(),
          designMock: {
            status: "succeeded",
            generatedAt: "2026-07-15T00:00:00.000Z",
            error: null,
            model: "claude-opus-4-6",
            costUsd: 2.18,
            durationMs: 304180,
          },
        },
        initialTab: "design",
      }),
    );

    expect(html).toContain("/design/mock?t=");
    expect(html).toContain("再生成");
    expect(html).toContain("claude-opus-4-6");
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
    expect(html).toContain("ビルド中断");
    // ビルド待ちの間はドット絵ループアニメ(真夜中の醸造所)を表示する
    expect(html).toContain("/anim/brewing-chill.gif");
  });

  it("成功バッチがあるとき熟成タブが有効になる", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, {
        initial: {
          ...recipeReadyBrew(),
          batches: [
            {
              number: 1,
              status: "succeeded",
              startedAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:01:00.000Z",
              error: null,
              evaluation: null,
              pub: null,
            },
          ],
        },
      }),
    );

    expect(html).toContain("熟成");
    expect(html.match(/disabled=\"\"/g) ?? []).toHaveLength(0);
  });

  it("原料タブではマッシュアニメを常に表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(BrewWorkbench, {
        initial: {
          ...recipeReadyBrew(),
          stage: "ingredients",
          sheet: null,
          boil: { entries: [], auto: false, finished: false },
          recipeGeneratedAt: null,
        },
        initialTab: "ingredients",
      }),
    );

    // 仕込み中だけでなく待機中も常に表示し、操作ボタン位置がずれないようにする
    expect(html).toContain("/anim/mash-chill.gif");
    expect(html).toContain("仕込み開始(マッシュ)");
  });
});
