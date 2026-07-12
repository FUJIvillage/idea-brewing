import { pubbingBrews } from "@/lib/pub/pub-state";
import { generatingRecipeBrews } from "@/lib/recipe/recipe-state";
import type { CancelToken } from "@/lib/tap/build-state";
import { buildingBrews } from "@/lib/tap/build-state";

// 熟成実行中のブリューID(ビルド工程と同じインメモリロック方式)
export const maturingBrews = new Set<string>();

// 熟成中断用トークン(mature系ルートが登録し、cancelルートが立てる)
export const matureCancelTokens = new Map<string, CancelToken>();

/** レシピ生成・ビルド・熟成・Pub いずれかが実行中か(相互排他の判定に使う) */
export function isBrewBusy(brewId: string): boolean {
  return (
    generatingRecipeBrews.has(brewId) ||
    buildingBrews.has(brewId) ||
    maturingBrews.has(brewId) ||
    pubbingBrews.has(brewId)
  );
}
