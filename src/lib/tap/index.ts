import { appendFileSync } from "node:fs";
import path from "node:path";
import { readRecipeFile } from "@/lib/recipe";
import type { BatchStatus, Brew, BuildPhase } from "@/lib/store/types";
import type { CancelToken } from "./build-state";
import type { BuildEngine, BuildSendResult, BuildSession } from "./engine";
import type { CommandRunner } from "./runner";
import { extractTasks } from "./tasks";
import { prepareBatchDir, readManifest, templateDir, type TemplateId } from "./template";

export const MAX_REPAIR_ROUNDS = 2;

export interface BuildDeps {
  engine: BuildEngine;
  runner: CommandRunner;
  template: TemplateId;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

const INTRO_PROMPT = [
  "あなたはこの作業ディレクトリに Web サービスを実装するエンジニアです。",
  "docs/recipe/ ディレクトリにあるレシピ(00〜06 の Markdown)をすべて読んでください。",
  "このディレクトリは Vite + React + TypeScript + Tailwind CSS のひな形です。この構成は変更せず、この上にレシピのサービスを実装します。",
  "依存パッケージの追加は package.json の編集のみで行い、npm install は実行しないでください(検証工程で実行します)。",
  "dev サーバーの起動やビルドコマンドの実行もしないでください。",
  "まだコードは書かず、レシピを読んで実装方針を5行以内で要約してください。",
].join("\n");

function taskPrompt(index: number, total: number, title: string, body: string): string {
  return [
    `実装計画のタスク ${index}/${total} を実装してください。`,
    `## ${title}`,
    body || "(詳細はレシピ本文を参照)",
    "完了したら変更内容を3行以内で要約してください。",
  ].join("\n\n");
}

function repairPrompt(round: number, output: string): string {
  return [
    `検証コマンドが失敗しました(修理ラウンド ${round}/${MAX_REPAIR_ROUNDS})。`,
    "以下のエラー出力を読み、原因を修正してください。npm install やビルドの実行は不要です。",
    "```",
    output.slice(-4000),
    "```",
  ].join("\n");
}

function withProgress(brew: Brew, phase: BuildPhase, detail: string): Brew {
  return { ...brew, buildProgress: { phase, detail } };
}

function finishBatch(brew: Brew, status: BatchStatus, error: string | null): Brew {
  const [batch] = brew.batches;
  return {
    ...brew,
    stage: status === "succeeded" ? "built" : brew.stage,
    buildProgress: null,
    batches: [
      {
        ...batch,
        status,
        finishedAt: new Date().toISOString(),
        error,
      },
    ],
  };
}

/** クラッシュで building のまま残ったバッチを failed に補正する。補正不要なら同一参照を返す */
export function normalizeStaleBatch(brew: Brew): Brew {
  const [first] = brew.batches;
  if (!first || first.status !== "building") return brew;
  return {
    ...brew,
    batches: [
      {
        ...first,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "中断されました(プロセス終了)",
      },
    ],
    buildProgress: null,
  };
}

async function sendWithCancel(
  session: BuildSession,
  prompt: string,
  cancel?: CancelToken,
): Promise<BuildSendResult> {
  if (cancel?.cancelled) return { ok: false, summary: "中断されました" };
  if (!cancel) return session.send(prompt);

  let cancelRequested = false;
  const watcher = setInterval(() => {
    if (cancel.cancelled && !cancelRequested) {
      cancelRequested = true;
      void session.cancel().catch(() => {
        // cancel失敗はsend本体の結果で扱う。未捕捉rejectだけ防ぐ。
      });
    }
  }, 500);
  try {
    return await session.send(prompt);
  } finally {
    clearInterval(watcher);
  }
}

async function runVerify(
  runner: CommandRunner,
  commands: string[],
  cwd: string,
  log: (line: string) => void,
  cancel?: CancelToken,
): Promise<{ command: string; output: string } | null> {
  for (const command of commands) {
    log(`[verify] ${command}`);
    const result = await runner.run(command, { cwd, onLog: log, cancel });
    if (!result.ok) return { command, output: result.output };
  }
  return null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isProgrammerError(err: unknown): boolean {
  return err instanceof TypeError || err instanceof ReferenceError;
}

export async function runBuild(brew: Brew, deps: BuildDeps): Promise<Brew> {
  if (!brew.recipeGeneratedAt) {
    throw new Error("レシピがまだ生成されていません。");
  }

  let current: Brew = {
    ...brew,
    batches: [
      {
        number: 1,
        status: "building",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      },
    ],
  };

  current = withProgress(current, "preparing", "テンプレートを準備しています");
  await deps.onProgress?.(current);

  let session: BuildSession | null = null;
  let log: ((line: string) => void) | null = null;
  try {
    const manifest = await readManifest(templateDir(deps.template));
    const batchDir = await prepareBatchDir(brew.id, 1, deps.template);
    const logPath = path.join(batchDir, "build.log");
    log = (line: string) => {
      appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
    };

    log("[build] ビルドを開始");
    session = await deps.engine.createSession({ cwd: batchDir, onLog: log });

    const planMd = await readRecipeFile(brew.id, "05-implementation-plan.md").catch(() => "");
    const tasks = extractTasks(planMd);

    current = withProgress(current, "generating", "レシピを読み込んでいます");
    await deps.onProgress?.(current);
    log("[build] レシピ読み込みを指示");
    let res = await sendWithCancel(session, INTRO_PROMPT, deps.cancel);
    if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
    if (!res.ok) return finishBatch(current, "failed", res.summary);

    if (tasks.length === 0) {
      current = withProgress(current, "generating", "レシピ全体を一括実装中");
      await deps.onProgress?.(current);
      log("[build] 一括実装を指示");
      res = await sendWithCancel(
        session,
        "docs/recipe/ のレシピ全体を、このひな形の上に一括で実装してください。完了したら変更内容を3行以内で要約してください。",
        deps.cancel,
      );
      if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
      if (!res.ok) return finishBatch(current, "failed", res.summary);
    } else {
      for (let i = 0; i < tasks.length; i++) {
        current = withProgress(
          current,
          "generating",
          `タスク ${i + 1}/${tasks.length}: ${tasks[i].title}`,
        );
        await deps.onProgress?.(current);
        log(`[build] タスク ${i + 1}/${tasks.length}: ${tasks[i].title}`);
        res = await sendWithCancel(
          session,
          taskPrompt(i + 1, tasks.length, tasks[i].title, tasks[i].body),
          deps.cancel,
        );
        if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
        if (!res.ok) return finishBatch(current, "failed", res.summary);
      }
    }

    for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
      current = withProgress(
        current,
        "verifying",
        round === 0 ? "検証コマンドを実行中" : `再検証中(修理ラウンド ${round}/${MAX_REPAIR_ROUNDS})`,
      );
      await deps.onProgress?.(current);
      const failure = await runVerify(deps.runner, manifest.verify, batchDir, log, deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
      if (!failure) return finishBatch(current, "succeeded", null);
      if (round === MAX_REPAIR_ROUNDS) {
        return finishBatch(current, "failed", `検証失敗(修理上限超過): ${failure.command}`);
      }

      current = withProgress(current, "repairing", `修理ラウンド ${round + 1}/${MAX_REPAIR_ROUNDS}`);
      await deps.onProgress?.(current);
      log(`[build] 修理ラウンド ${round + 1}: ${failure.command} が失敗`);
      res = await sendWithCancel(session, repairPrompt(round + 1, failure.output), deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
      if (!res.ok) return finishBatch(current, "failed", res.summary);
    }

    return finishBatch(current, "failed", "不明な状態");
  } catch (err) {
    if (isProgrammerError(err)) throw err;
    const status: BatchStatus = deps.cancel?.cancelled ? "cancelled" : "failed";
    return finishBatch(current, status, status === "cancelled" ? null : errorMessage(err));
  } finally {
    try {
      await session?.dispose();
    } catch (err) {
      try {
        log?.(`[build] セッション破棄に失敗: ${errorMessage(err)}`);
      } catch {
        // dispose失敗で本来のビルド結果を上書きしない
      }
    }
  }
}
