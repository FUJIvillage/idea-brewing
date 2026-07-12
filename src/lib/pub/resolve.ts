import { getConfiguredClient } from "@/lib/llm";
import { readSettings } from "@/lib/store";
import type { Settings } from "@/lib/store/types";
import { startServer, stopServer } from "@/lib/tap/server-manager";
import { createPlaywrightPubDriver } from "./driver";
import { createFakePubDriver } from "./fake-driver";
import type { PubDeps } from "./index";

function isFakeMode(settings: Settings): boolean {
  return settings.provider === "fake" || process.env.IDEA_BREWING_FAKE_BUILD === "1";
}

/** Pub 用 deps。フェイク構成ではサーバー起動・実ブラウザ・撮影をすべてスキップする */
export async function resolvePubDeps(): Promise<
  Pick<PubDeps, "client" | "startServer" | "stopServer" | "createDriver">
> {
  const settings = await readSettings();
  const client = await getConfiguredClient();
  if (isFakeMode(settings)) {
    return {
      client,
      startServer: async () => ({ port: 0 }),
      stopServer: async () => undefined,
      createDriver: async () => createFakePubDriver(),
    };
  }
  return { client, startServer, stopServer, createDriver: createPlaywrightPubDriver };
}
