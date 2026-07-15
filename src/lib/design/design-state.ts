import type { CancelToken } from "@/lib/tap/build-state";

// デザインモック生成中のブリューID(ビルド工程と同じインメモリロック方式)
export const designingBrews = new Set<string>();

// デザイン生成中断用トークン(generateルートが登録し、cancelルートが立てる)
export const designCancelTokens = new Map<string, CancelToken>();
