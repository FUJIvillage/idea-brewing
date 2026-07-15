import { describe, expect, it, vi } from "vitest";
import { isNetworkFetchError, postBoilOrRecover } from "@/lib/boil/network";
import type { Brew } from "@/lib/store/types";

function fakeBrew(partial: Partial<Brew> = {}): Brew {
  return {
    schemaVersion: 1,
    id: "11111111-1111-4111-8111-111111111111",
    name: "t",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    stage: "boiling",
    ingredients: [],
    sheet: null,
    boil: { entries: [], auto: true, finished: false },
    recipeProgress: null,
    recipeGeneratedAt: null,
    batches: [],
    buildProgress: null,
    maturationProgress: null,
    pubProgress: null,
    designMock: null,
    tokenUsage: null,
    ...partial,
  };
}

describe("isNetworkFetchError", () => {
  it("Failed to fetch をネットワークエラーと判定する", () => {
    expect(isNetworkFetchError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("通常の Error はネットワークエラーではない", () => {
    expect(isNetworkFetchError(new Error("煮沸操作に失敗しました"))).toBe(false);
  });
});

describe("postBoilOrRecover", () => {
  it("成功時はそのまま返す", async () => {
    const brew = fakeBrew();
    const post = vi.fn().mockResolvedValue({ brew, entry: null });
    const load = vi.fn();
    const result = await postBoilOrRecover("id", { action: "next" }, { post, load });
    expect(result).toEqual({ brew, entry: null });
    expect(load).not.toHaveBeenCalled();
  });

  it("Failed to fetch なら brew を再取得して続行可能にする", async () => {
    const recovered = fakeBrew({
      boil: {
        entries: [
          {
            id: "e1",
            question: "q",
            options: [{ label: "a", recommended: true }],
            answer: "a",
            answeredBy: "auto",
            askedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        auto: true,
        finished: false,
      },
    });
    const post = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const load = vi.fn().mockResolvedValue(recovered);
    const result = await postBoilOrRecover("id", { action: "next" }, { post, load });
    expect(result.brew).toBe(recovered);
    expect(result.recovered).toBe(true);
    expect(load).toHaveBeenCalledWith("id");
  });

  it("別のエラーはそのまま投げる", async () => {
    const post = vi.fn().mockRejectedValue(new Error("LLM が未設定です"));
    const load = vi.fn();
    await expect(
      postBoilOrRecover("id", { action: "next" }, { post, load }),
    ).rejects.toThrow("LLM が未設定です");
    expect(load).not.toHaveBeenCalled();
  });
});
