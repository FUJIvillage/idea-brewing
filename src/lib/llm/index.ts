import { readSettings } from "@/lib/store";
import type { Settings } from "@/lib/store/types";
import type { LlmClient } from "./client";
import { createAiSdkClient } from "./ai-sdk-client";
import { createFakeClient } from "./fake-client";

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("LLM が未設定です。設定画面でプロバイダとモデルを設定してください。");
    this.name = "LlmNotConfiguredError";
  }
}

export function clientForSettings(settings: Settings): LlmClient {
  if (settings.provider === "fake") return createFakeClient();
  return createAiSdkClient(settings);
}

export async function getConfiguredClient(): Promise<LlmClient> {
  const settings = await readSettings();
  const needsKey = settings.provider !== "ollama" && settings.provider !== "fake";
  if (settings.provider !== "fake" && (!settings.model || (needsKey && !settings.apiKey))) {
    throw new LlmNotConfiguredError();
  }
  return clientForSettings(settings);
}
