import { getConfiguredClient } from "@/lib/llm";
import { readSettings } from "@/lib/store";
import type { Settings } from "@/lib/store/types";
import { resolveEngine } from "@/lib/tap/resolve";
import { realRunner } from "@/lib/tap/runner";
import { startServer, stopServer } from "@/lib/tap/server-manager";
import type { EvaluateDeps, NextBatchDeps } from "./index";
import { captureScreenshots, launchChromium } from "./screenshot";

function isFakeMode(settings: Settings): boolean {
  return settings.provider === "fake" || process.env.IDEA_BREWING_FAKE_BUILD === "1";
}

/** 評価用deps。フェイク構成ではスクリーンショット工程をスキップする */
export async function resolveEvaluateDeps(): Promise<Pick<EvaluateDeps, "client" | "capture">> {
  const settings = await readSettings();
  const client = await getConfiguredClient();
  const capture = isFakeMode(settings)
    ? async () => [] as string[]
    : (brewId: string, batch: number) =>
        captureScreenshots(brewId, batch, { startServer, stopServer, launch: launchChromium });
  return { client, capture };
}

/** 次バッチ生成用deps。Cursor未設定時は TapNotConfiguredError を投げる */
export async function resolveNextBatchDeps(): Promise<
  Pick<NextBatchDeps, "engine" | "runner" | "template">
> {
  const settings = await readSettings();
  const { engine, template } = await resolveEngine(settings);
  return { engine, runner: realRunner, template };
}
