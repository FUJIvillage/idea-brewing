import type { Brew } from "@/lib/store/types";
import { isNetworkFetchError } from "@/lib/boil/network";

export type BrewActionBase = "tap" | "mature" | "pub" | "recipe" | "design";

/** 長時間APIの通信切断後、サーバー側ジョブがまだ動いていればクライアントはポーリング継続で回復できる */
export function isLongJobStillRunning(base: BrewActionBase, brew: Brew): boolean {
  switch (base) {
    case "design":
      return brew.designMock?.status === "generating";
    case "recipe":
      return brew.recipeProgress !== null;
    case "tap":
      return (
        brew.buildProgress !== null || brew.batches.some((batch) => batch.status === "building")
      );
    case "mature":
      return brew.maturationProgress !== null;
    case "pub":
      return brew.pubProgress !== null;
    default: {
      const _exhaustive: never = base;
      return _exhaustive;
    }
  }
}

/**
 * Failed to fetch などネットワーク切断時、最新Brewを見て回復可能なら error を出さない。
 * 戻り値: UIに出すエラー文言。null ならエラー表示しない。
 */
export function recoverLongJobFetchError(
  err: unknown,
  base: BrewActionBase,
  latest: Brew | null | undefined,
): string | null {
  if (!isNetworkFetchError(err)) {
    return err instanceof Error ? err.message : String(err);
  }
  if (latest && isLongJobStillRunning(base, latest)) return null;
  return "通信が切れました。進行状況を確認して、必要なら再試行してください。";
}
