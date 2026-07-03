import type { CancelToken } from "@/lib/tap/build-state";
import { buildingBrews } from "@/lib/tap/build-state";

// 熟成実行中のブリューID(ビルド工程と同じインメモリロック方式)
export const maturingBrews = new Set<string>();

// 熟成中断用トークン(mature系ルートが登録し、cancelルートが立てる)
export const matureCancelTokens = new Map<string, CancelToken>();

/** ビルド・熟成いずれかが実行中か(相互排他の判定に使う) */
export function isBrewBusy(brewId: string): boolean {
  return buildingBrews.has(brewId) || maturingBrews.has(brewId);
}
