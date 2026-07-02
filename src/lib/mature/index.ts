import { promises as fs } from "node:fs";
import type { LlmClient, LlmImage } from "@/lib/llm/client";
import type { Brew, BuildPhase, MaturationPhase } from "@/lib/store/types";
import { runBuild } from "@/lib/tap";
import { latestSucceededBatch, maxBatchNumber, upsertBatch } from "@/lib/tap/batches";
import type { CancelToken } from "@/lib/tap/build-state";
import type { BuildEngine } from "@/lib/tap/engine";
import type { CommandRunner } from "@/lib/tap/runner";
import type { TemplateId } from "@/lib/tap/template";
import { evaluateBatch, writeEvaluationReport } from "./evaluate";
import { collectMaterials } from "./materials";

export interface EvaluateDeps {
  client: LlmClient;
  /** スクリーンショットを撮って保存パスを返す。失敗時は空配列(例外を投げない契約) */
  capture: (brewId: string, batch: number) => Promise<string[]>;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

export interface NextBatchDeps {
  engine: BuildEngine;
  runner: CommandRunner;
  template: TemplateId;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

export type MatureDeps = EvaluateDeps & NextBatchDeps;

export interface AutoOptions {
  targetScore: number; // 1〜5
  maxBatches: number; // 累計バッチ数の上限
}

const BUILD_PHASE_LABELS: Record<BuildPhase, string> = {
  preparing: "準備",
  generating: "生成",
  verifying: "検証",
  repairing: "修理",
};

function withMaturation(brew: Brew, phase: MaturationPhase, detail: string, batch: number): Brew {
  return { ...brew, maturationProgress: { phase, detail, batch } };
}

/** クラッシュで残った maturationProgress を消す。補正不要なら同一参照を返す */
export function normalizeStaleMaturation(brew: Brew): Brew {
  if (brew.maturationProgress === null) return brew;
  return { ...brew, maturationProgress: null };
}

async function loadImages(paths: string[]): Promise<LlmImage[]> {
  const images: LlmImage[] = [];
  for (const p of paths) {
    try {
      images.push({ data: await fs.readFile(p), mimeType: "image/png" });
    } catch {
      // 読めないスクリーンショットは採点対象から外す
    }
  }
  return images;
}

/** 最新成功バッチを評価し、evaluation と evaluation.md を保存した Brew を返す */
export async function runEvaluate(brew: Brew, deps: EvaluateDeps): Promise<Brew> {
  const target = latestSucceededBatch(brew);
  if (!target) throw new Error("成功したバッチがありません。先にビルドを完了してください。");

  let current = withMaturation(brew, "screenshotting", "実画面を撮影しています", target.number);
  try {
    await deps.onProgress?.(current);
    const shots = deps.cancel?.cancelled ? [] : await deps.capture(brew.id, target.number);
    if (deps.cancel?.cancelled) return { ...current, maturationProgress: null };

    current = withMaturation(
      current,
      "evaluating",
      "ルーブリックに沿って採点しています",
      target.number,
    );
    await deps.onProgress?.(current);
    const materials = await collectMaterials(current, target.number);
    const images = await loadImages(shots);
    const evaluation = await evaluateBatch(deps.client, materials, images);
    if (deps.cancel?.cancelled) return { ...current, maturationProgress: null };

    await writeEvaluationReport(brew.id, target.number, evaluation);
    return {
      ...current,
      batches: upsertBatch(current.batches, { ...target, evaluation }),
      maturationProgress: null,
    };
  } catch (err) {
    await deps.onProgress?.({ ...current, maturationProgress: null });
    throw err;
  }
}

/** 最新成功バッチの評価から次バッチを生成する */
export async function runNextBatch(brew: Brew, deps: NextBatchDeps): Promise<Brew> {
  const base = latestSucceededBatch(brew);
  if (!base?.evaluation) {
    throw new Error("最新の成功バッチがまだ評価されていません。先に評価を実行してください。");
  }
  const nextNumber = maxBatchNumber(brew) + 1;
  const { strategy, improvements } = base.evaluation;

  const current = withMaturation(
    brew,
    "planning",
    `バッチ${nextNumber} を${strategy === "repair" ? "修正" : "再ビルド"}方式で準備しています`,
    nextNumber,
  );
  try {
    await deps.onProgress?.(current);
    if (deps.cancel?.cancelled) return { ...current, maturationProgress: null };

    const done = await runBuild(current, {
      engine: deps.engine,
      runner: deps.runner,
      template: deps.template,
      batch: nextNumber,
      mode: { kind: "improve", strategy, fromBatch: base.number, instructions: improvements },
      cancel: deps.cancel,
      onProgress: async (b) => {
        // ネストされたビルドの進捗は maturationProgress に載せ替える(ロック判定の一本化)
        const detail = b.buildProgress
          ? `${BUILD_PHASE_LABELS[b.buildProgress.phase]}: ${b.buildProgress.detail}`
          : "ビルド中";
        await deps.onProgress?.({
          ...b,
          buildProgress: null,
          maturationProgress: { phase: "building", detail, batch: nextNumber },
        });
      },
    });
    return { ...done, buildProgress: null, maturationProgress: null };
  } catch (err) {
    await deps.onProgress?.({ ...current, maturationProgress: null });
    throw err;
  }
}

/** 評価→次バッチ→評価…を停止条件(目標達成/上限/失敗/中断)まで自動で回す */
export async function runAutoMaturation(
  brew: Brew,
  deps: MatureDeps,
  opts: AutoOptions,
): Promise<Brew> {
  let current = brew;
  for (;;) {
    if (deps.cancel?.cancelled) break;

    let latest = latestSucceededBatch(current);
    if (!latest) break;
    if (!latest.evaluation) {
      current = await runEvaluate(current, deps);
      latest = latestSucceededBatch(current);
      if (!latest?.evaluation) break; // 中断などで評価が確定しなかった
    }
    if (latest.evaluation.overall >= opts.targetScore) break; // 目標達成
    if (maxBatchNumber(current) >= opts.maxBatches) break; // 上限到達
    if (deps.cancel?.cancelled) break;

    current = await runNextBatch(current, deps);
    const newest = current.batches.find((b) => b.number === maxBatchNumber(current));
    if (newest?.status !== "succeeded") break; // ビルド失敗・中断
  }
  return { ...current, maturationProgress: null };
}
