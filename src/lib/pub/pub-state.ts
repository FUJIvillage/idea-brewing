import type { CancelToken } from "@/lib/tap/build-state";

// Pub 実行中のブリューID(ビルド・熟成と同じインメモリロック方式)
export const pubbingBrews = new Set<string>();

// Pub 中断用トークン(pub/run が登録し、pub/cancel が立てる)
export const pubCancelTokens = new Map<string, CancelToken>();
