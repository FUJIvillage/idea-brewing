import type { Settings } from "@/lib/store/types";
import type { BuildEngine } from "./engine";
import { createFakeBuildEngine } from "./fake-engine";
import type { TemplateId } from "./template";

export class TapNotConfiguredError extends Error {}

export interface ResolvedEngine {
  engine: BuildEngine;
  template: TemplateId;
}

/** フェイクプロバイダ設定時(E2E)と IDEA_BREWING_FAKE_BUILD=1 のときはフェイク構成 */
export function isFakeMode(settings: Settings): boolean {
  return settings.provider === "fake" || process.env.IDEA_BREWING_FAKE_BUILD === "1";
}

/** 設定からビルドエンジンとテンプレートを決める。フェイク構成ではフェイクエンジン */
export async function resolveEngine(settings: Settings): Promise<ResolvedEngine> {
  if (isFakeMode(settings)) {
    return { engine: createFakeBuildEngine(), template: "tap-fake" };
  }

  const apiKey = settings.cursorApiKey.trim() || process.env.CURSOR_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new TapNotConfiguredError(
      "Cursor APIキーが未設定です。設定画面の「ビルドエンジン(Cursor)」で設定してください。",
    );
  }

  const { createCursorEngine } = await import("./cursor-engine");
  return {
    engine: createCursorEngine({ apiKey, model: settings.cursorModel.trim() || "composer-2.5" }),
    template: "tap-vite",
  };
}
