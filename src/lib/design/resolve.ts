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

/**
 * Pencil のデザインモデルを解決する。
 * 未指定時の CLI 既定は Claude だが、Claude Code ログイン or ANTHROPIC_API_KEY が別途必要なため、
 * 煮沸プロバイダが持つ API キーで動くモデルへフォールバックする。
 */
export function resolvePencilModel(settings: Settings): string {
  const explicit = settings.pencilModel.trim();
  if (explicit) return explicit;
  switch (settings.provider) {
    case "openai":
    case "openrouter":
      return "gpt-5.4";
    case "google":
      return "gemini-3.5-flash";
    default:
      return "";
  }
}

function pencilAgentFamily(model: string): "claude" | "codex" | "gemini" | "unknown" {
  const id = model.trim().toLowerCase();
  if (!id) return "unknown";
  if (id.startsWith("claude") || id.startsWith("fable")) return "claude";
  if (id.startsWith("gpt") || id.includes("codex")) return "codex";
  if (id.startsWith("gemini")) return "gemini";
  return "unknown";
}

/**
 * 選択モデルのエージェント向け API キー。
 * PENCIL_AGENT_API_KEY 環境変数があれば最優先。なければプロバイダ apiKey を、
 * モデル系統とプロバイダが一致するときだけ渡す。
 */
export function resolvePencilAgentApiKey(settings: Settings, model: string): string {
  const fromEnv = process.env.PENCIL_AGENT_API_KEY?.trim() || "";
  if (fromEnv) return fromEnv;

  const family = pencilAgentFamily(model);
  const apiKey = settings.apiKey.trim();
  if (!apiKey) return "";

  if (family === "codex" && (settings.provider === "openai" || settings.provider === "openrouter")) {
    return apiKey;
  }
  if (family === "gemini" && settings.provider === "google") {
    return apiKey;
  }
  return "";
}
