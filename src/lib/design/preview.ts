export const PREVIEW_PNG = "preview.png";
export const PREVIEW_SRC_PEN = "preview-src.pen";
export const PREVIEW_HOME_DIR = ".preview-home";
/** 生成中プレビューの更新間隔 */
export const PREVIEW_INTERVAL_MS = 12_000;
/** ほぼ空の失敗 PNG を除外する下限 */
export const PREVIEW_MIN_BYTES = 1024;

export function buildPreviewExportArgs(opts: {
  penPath: string;
  outPath: string;
}): string[] {
  return [
    "--in",
    opts.penPath,
    "--export",
    opts.outPath,
    "--export-scale",
    "1",
  ];
}

export function isValidPreviewPngSize(bytes: number): boolean {
  return bytes >= PREVIEW_MIN_BYTES;
}
