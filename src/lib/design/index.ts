import { promises as fs } from "node:fs";
import path from "node:path";
import { designDir, recipeDir } from "@/lib/store";
import type { Brew, DesignMockRecord, Settings } from "@/lib/store/types";
import type { CancelToken } from "@/lib/tap/build-state";
import { isFakeMode } from "@/lib/tap/resolve";
import { runPencil } from "./pencil-cli";
import { buildMockPrompt } from "./prompt";
import {
  resolvePencilAgentApiKey,
  resolvePencilKey,
  resolvePencilModel,
} from "./resolve";

export const DESIGN_TIMEOUT_MS = 15 * 60 * 1000;
export const MOCK_PEN = "mock.pen";
export const MOCK_PNG = "mock.png";
export const USAGE_JSON = "usage.json";
export const DESIGN_LOG = "design.log";

/** モック生成に必要なレシピファイル(--prompt-file で添付する) */
export const REQUIRED_RECIPE_FILES = ["02-screens.md", "03-design-system.md"] as const;

const LOG_TAIL_CHARS = 500;

export interface PencilUsageInfo {
  model: string;
  costUsd: number | null;
  durationMs: number | null;
}

/** usage.json(pencil --usage 出力)を寛容にパースする。形式が変わっても失敗にしない */
export function parsePencilUsage(raw: string): PencilUsageInfo {
  try {
    const json = JSON.parse(raw) as {
      model?: unknown;
      usage?: { totalCostUsd?: unknown; durationMs?: unknown };
    };
    return {
      model: typeof json.model === "string" ? json.model : "",
      costUsd: typeof json.usage?.totalCostUsd === "number" ? json.usage.totalCostUsd : null,
      durationMs: typeof json.usage?.durationMs === "number" ? json.usage.durationMs : null,
    };
  } catch {
    return { model: "", costUsd: null, durationMs: null };
  }
}

export interface PencilArgsOptions {
  dir: string;
  recipe: string;
  prompt: string;
  /** 差分修正モード(既存 mock.pen があるときのみ true にする) */
  refine: boolean;
  /** resolvePencilModel 済みのモデルID。空なら --model を付けず CLI 既定 */
  model: string;
}

export function buildPencilArgs(opts: PencilArgsOptions): string[] {
  const args = [
    ...(opts.refine ? ["--in", path.join(opts.dir, MOCK_PEN)] : []),
    "--out",
    path.join(opts.dir, MOCK_PEN),
    "--prompt",
    opts.prompt,
    ...REQUIRED_RECIPE_FILES.flatMap((f) => ["--prompt-file", path.join(opts.recipe, f)]),
    "--export",
    path.join(opts.dir, MOCK_PNG),
    "--export-scale",
    "2",
    "--usage",
    path.join(opts.dir, USAGE_JSON),
  ];
  if (opts.model.trim()) args.push("--model", opts.model.trim());
  return args;
}

/** モック生成に必要なレシピファイルが揃っているか(ルートの事前検査用) */
export async function hasDesignRecipe(brewId: string): Promise<boolean> {
  for (const file of REQUIRED_RECIPE_FILES) {
    try {
      await fs.access(path.join(recipeDir(brewId), file));
    } catch {
      return false;
    }
  }
  return true;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readLogTail(logPath: string): Promise<string> {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    return raw.slice(-LOG_TAIL_CHARS);
  } catch {
    return "";
  }
}

async function generateFakeMock(dir: string, startedAt: number): Promise<DesignMockRecord> {
  const fixture = path.join(process.cwd(), "templates", "design-fake", MOCK_PNG);
  await fs.copyFile(fixture, path.join(dir, MOCK_PNG));
  await fs.writeFile(
    path.join(dir, USAGE_JSON),
    JSON.stringify({ agentType: "fake", model: "fake", usage: { totalCostUsd: 0 } }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(dir, DESIGN_LOG),
    "フェイク構成のため Pencil CLI を呼ばず、テンプレートのモックをコピーしました。\n",
    "utf8",
  );
  return {
    status: "succeeded",
    generatedAt: new Date().toISOString(),
    error: null,
    model: "fake",
    costUsd: 0,
    durationMs: Date.now() - startedAt,
  };
}

/** クラッシュで generating のまま残った designMock を failed に補正する。補正不要なら同一参照を返す */
export function normalizeStaleDesignMock(brew: Brew): Brew {
  if (brew.designMock?.status !== "generating") return brew;
  return {
    ...brew,
    designMock: {
      ...brew.designMock,
      status: "failed",
      error: "中断されました(プロセス終了)",
    },
  };
}

export interface GenerateDesignMockOptions {
  /** 再生成時のユーザー追加指示 */
  instruction?: string;
  token?: CancelToken;
}

/**
 * Pencil CLI でレシピからモックアップを生成する。
 * 成否は戻り値の DesignMockRecord で返し、brew.json への反映は呼び出し側が行う
 */
export async function generateDesignMock(
  brew: Brew,
  settings: Settings,
  opts: GenerateDesignMockOptions = {},
): Promise<DesignMockRecord> {
  const startedAt = Date.now();
  const dir = designDir(brew.id);
  await fs.mkdir(dir, { recursive: true });

  if (isFakeMode(settings)) return generateFakeMock(dir, startedAt);

  const key = resolvePencilKey(settings);
  const model = resolvePencilModel(settings);
  const agentApiKey = resolvePencilAgentApiKey(settings, model);
  const refine = await exists(path.join(dir, MOCK_PEN));
  const args = buildPencilArgs({
    dir,
    recipe: recipeDir(brew.id),
    prompt: buildMockPrompt({ refine, instruction: opts.instruction }),
    refine,
    model,
  });

  const logPath = path.join(dir, DESIGN_LOG);
  const fail = async (message: string): Promise<DesignMockRecord> => {
    const tail = await readLogTail(logPath);
    const authHint =
      /authentication_failed|Not logged in|Please run \/login/i.test(tail)
        ? "\nヒント: Pencil CLIキーとは別に、デザインモデル側のエージェント認証が必要です。Claude 既定なら ANTHROPIC_API_KEY(または Claude Code ログイン)、OpenAI なら設定の APIキー + gpt 系モデル、Google なら Gemini 系モデルを使ってください。"
        : "";
    return {
      status: "failed",
      generatedAt: null,
      error: (tail ? `${message}\n--- design.log 末尾 ---\n${tail}` : message) + authHint,
      model: "",
      costUsd: null,
      durationMs: Date.now() - startedAt,
    };
  };

  let result;
  try {
    result = await runPencil({
      args,
      key,
      agentApiKey,
      logPath,
      timeoutMs: DESIGN_TIMEOUT_MS,
      token: opts.token,
    });
  } catch (err) {
    return fail(`Pencil CLI の起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (result.cancelled) {
    return {
      status: "cancelled",
      generatedAt: null,
      error: "中断されました。",
      model: "",
      costUsd: null,
      durationMs: Date.now() - startedAt,
    };
  }
  if (result.timedOut) {
    return fail(`Pencil CLI が${Math.round(DESIGN_TIMEOUT_MS / 60000)}分以内に完了しませんでした。`);
  }
  if (result.code !== 0) {
    return fail(`Pencil CLI がエラー終了しました(exit=${result.code ?? "null"})。`);
  }
  if (!(await exists(path.join(dir, MOCK_PNG)))) {
    return fail("Pencil CLI は終了しましたが、mock.png が出力されませんでした。");
  }

  const usage = parsePencilUsage(
    await fs.readFile(path.join(dir, USAGE_JSON), "utf8").catch(() => ""),
  );
  return {
    status: "succeeded",
    generatedAt: new Date().toISOString(),
    error: null,
    model: usage.model,
    costUsd: usage.costUsd,
    durationMs: usage.durationMs ?? Date.now() - startedAt,
  };
}
