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

  it("熟成進捗中は熟成パネルを表示しタブを無効化する", () => {
    const detail = "評価レポート生成中";
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
          maturationProgress: { phase: "evaluating", detail, batch: 1 },
        },
      }),
    );

    expect(html).toContain(detail);
    expect(html).toContain("▶ 熟成");
    expect(html).toContain("中断");
    expect((html.match(/disabled=\"\"/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
