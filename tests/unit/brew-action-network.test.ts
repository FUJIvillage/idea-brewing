import { describe, expect, it } from "vitest";
import {
  isLongJobStillRunning,
  recoverLongJobFetchError,
} from "@/lib/brew-action-network";
import type { Brew } from "@/lib/store/types";

function fakeBrew(partial: Partial<Brew> = {}): Brew {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    name: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stage: "done",
    ingredients: [],
    sheet: null,
    boil: { entries: [], auto: false, finished: true },
    recipeProgress: null,
    recipeGeneratedAt: "2026-01-01T00:00:00.000Z",
    batches: [],
    buildProgress: null,
    maturationProgress: null,
    pubProgress: null,
    designMock: null,
    ...partial,
  };
}

describe("isLongJobStillRunning", () => {
  it("デザイン生成中を検知する", () => {
    expect(
      isLongJobStillRunning(
        "design",
        fakeBrew({
          designMock: {
            status: "generating",
            generatedAt: null,
            error: null,
            model: "",
            costUsd: null,
            durationMs: null,
          },
        }),
      ),
    ).toBe(true);
    expect(isLongJobStillRunning("design", fakeBrew())).toBe(false);
  });
});

describe("recoverLongJobFetchError", () => {
  it("通常エラーはメッセージを返す", () => {
    expect(recoverLongJobFetchError(new Error("保存失敗"), "design", fakeBrew())).toBe(
      "保存失敗",
    );
  });

  it("Failed to fetch かつ生成中ならエラー表示しない(ポーリング継続)", () => {
    const latest = fakeBrew({
      designMock: {
        status: "generating",
        generatedAt: null,
        error: null,
        model: "",
        costUsd: null,
        durationMs: null,
      },
    });
    expect(recoverLongJobFetchError(new TypeError("Failed to fetch"), "design", latest)).toBe(
      null,
    );
  });

  it("Failed to fetch でジョブ終了済みなら確認を促す", () => {
    expect(recoverLongJobFetchError(new TypeError("Failed to fetch"), "design", fakeBrew())).toBe(
      "通信が切れました。進行状況を確認して、必要なら再試行してください。",
    );
  });
});
