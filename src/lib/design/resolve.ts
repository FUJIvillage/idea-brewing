import type { Settings } from "@/lib/store/types";

export class DesignNotConfiguredError extends Error {}

/** 設定 → 環境変数 PENCIL_CLI_KEY の順で解決する。どちらも無ければ設定誘導エラー */
export function resolvePencilKey(settings: Settings): string {
  const key = settings.pencilCliKey.trim() || process.env.PENCIL_CLI_KEY?.trim() || "";
  if (!key) {
    throw new DesignNotConfiguredError(
      "Pencil CLIキーが未設定です。設定画面の「デザインエンジン(Pencil)」で設定してください。",
    );
  }
  return key;
}
