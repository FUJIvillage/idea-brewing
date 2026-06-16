import type { Settings } from "@/lib/store/types";
import { createCursorEngine } from "./cursor-engine";
import type { BuildEngine } from "./engine";
import { createFakeBuildEngine } from "./fake-engine";
import type { TemplateId } from "./template";

export class TapNotConfiguredError extends Error {}

export interface ResolvedEngine {
  engine: BuildEngine;
  template: TemplateId;
}

/**
 * 設定からビルドエンジンとテンプレートを決める。
 * フェイクプロバイダ設定時(E2E)と IDEA_BREWING_FAKE_BUILD=1 のときはフェイク。
 */
export function resolveEngine(settings: Settings): ResolvedEngine {
  if (settings.provider === "fake" || process.env.IDEA_BREWING_FAKE_BUILD === "1") {
    return { engine: createFakeBuildEngine(), template: "tap-fake" };
  }

  const apiKey = settings.cursorApiKey.trim() || process.env.CURSOR_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new TapNotConfiguredError(
      "Cursor APIキーが未設定です。設定画面の「ビルドエンジン(Cursor)」で設定してください。",
    );
  }

  return {
    engine: createCursorEngine({ apiKey, model: settings.cursorModel.trim() || "composer-2.5" }),
    template: "tap-vite",
  };
}
