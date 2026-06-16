export interface CancelToken {
  cancelled: boolean;
}

// ビルド実行中のブリューID(レシピ生成と同じインメモリロック方式。
// クラッシュ時の永久ロックを防ぎ、再起動でリセットされるのは許容)
export const buildingBrews = new Set<string>();

// ビルド中断用トークン(buildルートが登録し、cancelルートが立てる)
export const cancelTokens = new Map<string, CancelToken>();
