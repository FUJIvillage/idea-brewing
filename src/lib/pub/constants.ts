// クライアントコンポーネントからも import できるよう、Node依存のない定数だけを置く

/** Pub に招ける客の最大人数(自動生成+常連の合計) */
export const MAX_PUB_GUESTS = 5;

/** ペルソナ n 人目(1始まり)の最終画面スクリーンショットのファイル名 */
export function pubScreenshotName(n: number): string {
  return `persona-${n}.png`;
}

/** 存在しうるスクリーンショット名の一覧(配信ルートの許可リストにも使う) */
export const PUB_SCREENSHOT_FILES = Array.from({ length: MAX_PUB_GUESTS }, (_, i) =>
  pubScreenshotName(i + 1),
);
