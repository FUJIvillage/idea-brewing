import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { readRecipeFile } from "@/lib/recipe";
import { tapDir } from "@/lib/store";
import type { BatchStatus, Brew, BuildPhase, NextBatchStrategy } from "@/lib/store/types";
import { upsertBatch } from "./batches";
import type { CancelToken } from "./build-state";
import {
  clearBuildCheckpoint,
  readBuildCheckpoint,
  writeBuildCheckpoint,
  type BuildCheckpoint,
} from "./checkpoint";
import type { BuildEngine, BuildSendResult, BuildSession } from "./engine";
import type { CommandRunner } from "./runner";
import { extractTasks } from "./tasks";
import {
  prepareBatchDir,
  prepareRepairDir,
  readManifest,
  templateDir,
  writeImprovementNotes,
  type TemplateId,
} from "./template";

const MAX_REPAIR_ROUNDS = 2;

export type BuildMode =
  | { kind: "initial" }
  | { kind: "resume" }
  | { kind: "improve"; strategy: NextBatchStrategy; fromBatch: number; instructions: string[] };

export interface BuildDeps {
  engine: BuildEngine;
  runner: CommandRunner;
  template: TemplateId;
  /** 対象バッチ番号(1始まり) */
  batch: number;
  mode: BuildMode;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

// デザイン仕様の装飾要素が「任意」を口実に省略され、最小実装で止まるのを防ぐ(全ビルド系プロンプトに同梱)
export const DESIGN_FIDELITY_SENTENCE =
  "docs/recipe/03-design-system.md はデザイン仕様です。「任意」「表示する場合」と書かれた装飾要素(円形進捗・バッジ・アイコン・アクセントバー等)も原則実装し、最小実装で済ませないでください。";

export const INTRO_PROMPT = [
  "あなたはこの作業ディレクトリに Web サービスを実装するエンジニアです。",
  "docs/recipe/ ディレクトリにあるレシピ(00〜06 の Markdown)をすべて読んでください。",
  "このディレクトリは Vite + React + TypeScript + Tailwind CSS のひな形です。この構成は変更せず、この上にレシピのサービスを実装します。",
  DESIGN_FIDELITY_SENTENCE,
  "依存パッケージの追加は package.json の編集のみで行い、npm install は実行しないでください(検証工程で実行します)。",
  "dev サーバーの起動やビルドコマンドの実行もしないでください。",
  "まだコードは書かず、レシピを読んで実装方針を5行以内で要約してください。",
].join("\n");

export function resumeIntroPrompt(completedTasks: number, totalTasks: number | null): string {
  const doneLabel =
    totalTasks === null
      ? "これまでの実装作業"
      : `タスク 1〜${completedTasks}/${totalTasks}`;
  return [
    "あなたはこの作業ディレクトリの Web サービス実装を再開するエンジニアです。",
    "docs/recipe/ のレシピ(00〜06)を必要に応じて読み、既存コードを確認してください。",
    `${doneLabel}は完了済みです。完了済みの成果を削除・破壊せず、続きだけを実装してください。`,
    "このディレクトリは Vite + React + TypeScript + Tailwind CSS です。構成は変更しないでください。",
    DESIGN_FIDELITY_SENTENCE,
    "依存パッケージの追加は package.json の編集のみで行い、npm install は実行しないでください。",
    "dev サーバーの起動やビルドコマンドの実行もしないでください。",
    "まだ追加実装はせず、再開方針を5行以内で要約してください。",
  ].join("\n");
}

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

const IMPROVE_NOTES_SENTENCE =
  "docs/recipe/07-improvement-notes.md に前バッチの自己評価から得た改善指示があります。実装ではこの指示を必ず反映してください。";

export const REPAIR_INTRO_PROMPT = [
  "あなたはこの作業ディレクトリの Web サービスを改善するエンジニアです。",
  "docs/recipe/ のレシピ(00〜06 の Markdown)と docs/recipe/07-improvement-notes.md の改善指示をすべて読んでください。",
  "このディレクトリには前バッチで実装済みのコードがあります。構成(Vite + React + TypeScript + Tailwind CSS)は変更せず、改善指示に従って既存コードを修正します。",
  DESIGN_FIDELITY_SENTENCE,
  "依存パッケージの追加は package.json の編集のみで行い、npm install は実行しないでください(検証工程で実行します)。",
  "dev サーバーの起動やビルドコマンドの実行もしないでください。",
  "まだコードは書かず、改善方針を5行以内で要約してください。",
].join("\n");

function improvementPrompt(index: number, total: number, instruction: string): string {
  return [
    `改善指示 ${index}/${total} を実施してください。`,
    instruction,
    "完了したら変更内容を3行以内で要約してください。",
  ].join("\n\n");
}

function withProgress(brew: Brew, phase: BuildPhase, detail: string): Brew {
  return { ...brew, buildProgress: { phase, detail } };
}

function finishBatch(
  brew: Brew,
  batchNumber: number,
  status: BatchStatus,
  error: string | null,
): Brew {
  const target = brew.batches.find((b) => b.number === batchNumber);
  if (!target) return { ...brew, buildProgress: null };
  return {
    ...brew,
    stage: status === "succeeded" ? "built" : brew.stage,
    buildProgress: null,
    batches: upsertBatch(brew.batches, {
      ...target,
      status,
      finishedAt: new Date().toISOString(),
      error,
    }),
  };
}

/** クラッシュで building のまま残ったバッチを failed に補正する。補正不要なら同一参照を返す */
export function normalizeStaleBatch(brew: Brew): Brew {
  if (!brew.batches.some((b) => b.status === "building")) return brew;
  return {
    ...brew,
    batches: brew.batches.map((b) =>
      b.status === "building"
        ? {
            ...b,
            status: "failed" as const,
            finishedAt: new Date().toISOString(),
            error: "中断されました(プロセス終了)",
          }
        : b,
    ),
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
    batches: upsertBatch(brew.batches, {
      number: deps.batch,
      status: "building",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      evaluation: null,
      pub: null,
    }),
  };

  current = withProgress(current, "preparing", "作業フォルダを準備しています");
  await deps.onProgress?.(current);

  let session: BuildSession | null = null;
  let log: ((line: string) => void) | null = null;
  try {
    const manifest = await readManifest(templateDir(deps.template));
    let checkpoint: BuildCheckpoint | null = null;
    let batchDir: string;

    if (deps.mode.kind === "resume") {
      checkpoint = await readBuildCheckpoint(brew.id, deps.batch);
      if (!checkpoint) {
        throw new Error("再開用の checkpoint がありません。最初からビルドしてください。");
      }
      batchDir = tapDir(brew.id, deps.batch);
      if (!existsSync(batchDir)) {
        throw new Error("再開用のバッチフォルダがありません。最初からビルドしてください。");
      }
      current = withProgress(
        current,
        "preparing",
        checkpoint.phase === "generating"
          ? `再開: タスク ${checkpoint.completedTasks + 1}/${checkpoint.totalTasks ?? "?"}`
          : `再開: ${checkpoint.phase}`,
      );
      await deps.onProgress?.(current);
    } else if (deps.mode.kind === "improve" && deps.mode.strategy === "repair") {
      batchDir = await prepareRepairDir(brew.id, deps.mode.fromBatch, deps.batch);
    } else {
      batchDir = await prepareBatchDir(brew.id, deps.batch, deps.template);
      await clearBuildCheckpoint(brew.id, deps.batch);
    }

    if (deps.mode.kind === "improve") {
      await writeImprovementNotes(batchDir, deps.mode.instructions);
    }
    const logPath = path.join(batchDir, "build.log");
    log = (line: string) => {
      appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
    };

    log(`[build] バッチ${deps.batch} のビルドを開始(${deps.mode.kind})`);
    session = await deps.engine.createSession({ cwd: batchDir, onLog: log });

    const saveCheckpoint = async (
      patch: Omit<BuildCheckpoint, "version" | "updatedAt">,
    ) => {
      checkpoint = await writeBuildCheckpoint(brew.id, deps.batch, patch);
    };

    if (deps.mode.kind === "improve" && deps.mode.strategy === "repair") {
      current = withProgress(current, "generating", "改善指示を読み込んでいます");
      await deps.onProgress?.(current);
      log("[build] 改善指示の読み込みを指示");
      let res = await sendWithCancel(session, REPAIR_INTRO_PROMPT, deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);

      const instructions = deps.mode.instructions;
      for (let i = 0; i < instructions.length; i++) {
        current = withProgress(current, "generating", `改善 ${i + 1}/${instructions.length}`);
        await deps.onProgress?.(current);
        log(`[build] 改善指示 ${i + 1}/${instructions.length}`);
        res = await sendWithCancel(
          session,
          improvementPrompt(i + 1, instructions.length, instructions[i]),
          deps.cancel,
        );
        if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
        if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);
      }
    } else if (!(deps.mode.kind === "resume" && checkpoint && checkpoint.phase !== "generating")) {
      // initial / resume(generating) / improve(rebuild)
      const planMd = await readRecipeFile(brew.id, "05-implementation-plan.md").catch(() => "");
      const tasks = extractTasks(planMd);
      const startTask =
        deps.mode.kind === "resume" && checkpoint ? checkpoint.completedTasks : 0;
      const isResume = deps.mode.kind === "resume";

      const intro = isResume
        ? resumeIntroPrompt(startTask, tasks.length > 0 ? tasks.length : null)
        : deps.mode.kind === "improve"
          ? `${INTRO_PROMPT}\n${IMPROVE_NOTES_SENTENCE}`
          : INTRO_PROMPT;

      current = withProgress(
        current,
        "generating",
        isResume
          ? `再開: レシピ確認 (次はタスク ${startTask + 1})`
          : "レシピを読み込んでいます",
      );
      await deps.onProgress?.(current);
      log(isResume ? "[build] 再開イントロを指示" : "[build] レシピ読み込みを指示");
      let res = await sendWithCancel(session, intro, deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);

      if (tasks.length === 0) {
        if (!isResume || startTask === 0) {
          current = withProgress(current, "generating", "レシピ全体を一括実装中");
          await deps.onProgress?.(current);
          log("[build] 一括実装を指示");
          res = await sendWithCancel(
            session,
            isResume
              ? "既存実装を壊さず、docs/recipe/ の未反映部分をこのひな形の上に実装してください。完了したら変更内容を3行以内で要約してください。"
              : "docs/recipe/ のレシピ全体を、このひな形の上に一括で実装してください。完了したら変更内容を3行以内で要約してください。",
            deps.cancel,
          );
          if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
          if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);
          await saveCheckpoint({
            phase: "verifying",
            completedTasks: 1,
            totalTasks: null,
            repairRound: 0,
          });
        }
      } else {
        await saveCheckpoint({
          phase: "generating",
          completedTasks: startTask,
          totalTasks: tasks.length,
          repairRound: 0,
        });
        for (let i = startTask; i < tasks.length; i++) {
          current = withProgress(
            current,
            "generating",
            `${isResume ? "再開: " : ""}タスク ${i + 1}/${tasks.length}: ${tasks[i].title}`,
          );
          await deps.onProgress?.(current);
          log(`[build] タスク ${i + 1}/${tasks.length}: ${tasks[i].title}`);
          res = await sendWithCancel(
            session,
            taskPrompt(i + 1, tasks.length, tasks[i].title, tasks[i].body),
            deps.cancel,
          );
          if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
          if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);
          await saveCheckpoint({
            phase: i + 1 >= tasks.length ? "verifying" : "generating",
            completedTasks: i + 1,
            totalTasks: tasks.length,
            repairRound: 0,
          });
        }
      }
    }

    const startRound =
      deps.mode.kind === "resume" && checkpoint?.phase === "repairing"
        ? checkpoint.repairRound
        : 0;

    for (let round = startRound; round <= MAX_REPAIR_ROUNDS; round++) {
      current = withProgress(
        current,
        "verifying",
        round === 0 ? "検証コマンドを実行中" : `再検証中(修理ラウンド ${round}/${MAX_REPAIR_ROUNDS})`,
      );
      await deps.onProgress?.(current);
      await saveCheckpoint({
        phase: "verifying",
        completedTasks: checkpoint?.completedTasks ?? 0,
        totalTasks: checkpoint?.totalTasks ?? null,
        repairRound: round,
      });
      const failure = await runVerify(deps.runner, manifest.verify, batchDir, log, deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!failure) {
        await clearBuildCheckpoint(brew.id, deps.batch);
        return finishBatch(current, deps.batch, "succeeded", null);
      }
      if (round === MAX_REPAIR_ROUNDS) {
        return finishBatch(
          current,
          deps.batch,
          "failed",
          `検証失敗(修理上限超過): ${failure.command}`,
        );
      }

      current = withProgress(current, "repairing", `修理ラウンド ${round + 1}/${MAX_REPAIR_ROUNDS}`);
      await deps.onProgress?.(current);
      await saveCheckpoint({
        phase: "repairing",
        completedTasks: checkpoint?.completedTasks ?? 0,
        totalTasks: checkpoint?.totalTasks ?? null,
        repairRound: round + 1,
      });
      log(`[build] 修理ラウンド ${round + 1}: ${failure.command} が失敗`);
      const repairRes = await sendWithCancel(
        session,
        repairPrompt(round + 1, failure.output),
        deps.cancel,
      );
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!repairRes.ok) return finishBatch(current, deps.batch, "failed", repairRes.summary);
    }

    return finishBatch(current, deps.batch, "failed", "不明な状態");
  } catch (err) {
    if (isProgrammerError(err)) throw err;
    const status: BatchStatus = deps.cancel?.cancelled ? "cancelled" : "failed";
    return finishBatch(current, deps.batch, status, status === "cancelled" ? null : errorMessage(err));
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
