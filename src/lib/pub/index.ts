import { promises as fs } from "node:fs";
import path from "node:path";
import type { LlmClient } from "@/lib/llm/client";
import { trackingClient } from "@/lib/llm/usage";
import { renameWithRetry, tapDir } from "@/lib/store";
import type {
  Brew,
  PubPersona,
  PubPersonaResult,
  PubPhase,
  PubReport,
  SavedPersona,
} from "@/lib/store/types";
import { latestSucceededBatch, upsertBatch } from "@/lib/tap/batches";
import type { CancelToken } from "@/lib/tap/build-state";
import { MAX_PUB_GUESTS, pubScreenshotName } from "./constants";
import type { PubDriver } from "./driver";
import { generatePersonas, savedToPersona } from "./personas";
import { runPersonaSession } from "./session";

export interface PubDeps {
  client: LlmClient;
  startServer: (brewId: string, batch: number) => Promise<{ port: number }>;
  stopServer: (brewId: string) => Promise<void>;
  createDriver: (baseUrl: string) => Promise<PubDriver>;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

export interface PubOptions {
  autoCount: number; // 自動生成の人数(0〜5)
  savedPersonas: SavedPersona[]; // 参加する常連客(ルート層でID解決済み)
}

const SUMMARY_SYSTEM = [
  "あなたは Pub の店主です。AI客たちの評価とセッションの様子から、開発者向けに評判を総括します。",
  "良かった点・共通する不満・目立った行動のつまずきを簡潔にまとめてください。",
].join("\n");

function withPub(brew: Brew, phase: PubPhase, detail: string, batch: number): Brew {
  return { ...brew, pubProgress: { phase, detail, batch } };
}

/** クラッシュで残った pubProgress を消す。補正不要なら同一参照を返す */
export function normalizeStalePub(brew: Brew): Brew {
  if (brew.pubProgress === null) return brew;
  return { ...brew, pubProgress: null };
}

export function pubDir(brewId: string, batch: number): string {
  return path.join(tapDir(brewId, batch), "pub");
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildSummaryPrompt(results: PubPersonaResult[]): string {
  const sections = results.map((r) => {
    const head = `## ${r.persona.name}(${r.persona.origin === "saved" ? "常連" : "自動生成"} / ${
      r.status === "completed" ? `総合 ${r.overall.toFixed(1)}` : "セッション中断"
    })`;
    const body =
      r.status === "completed"
        ? [
            ...r.scores.map((s) => `- ${s.name}: ${s.score}`),
            `- レビュー: ${r.comment}`,
            ...r.taskResults.map((t) => `- [${t.achieved ? "達成" : "未達"}] ${t.goal}: ${t.note}`),
          ]
        : [`- ${r.comment}`];
    return [head, ...body].join("\n");
  });
  return sections.join("\n\n");
}

export function renderPubMarkdown(batch: number, report: PubReport): string {
  const completed = report.personaResults.filter((r) => r.status === "completed").length;
  const lines: string[] = [
    `# バッチ${batch} Pubレポート`,
    "",
    `- 総合スコア: ${report.overall.toFixed(1)} / 5.0`,
    `- 実施日時: ${report.ranAt}`,
    `- 客数: ${report.personaResults.length}(完走 ${completed})`,
    "",
    "## 総括",
    "",
    report.summary,
    "",
  ];
  for (const r of report.personaResults) {
    lines.push(`## ${r.persona.name}${r.persona.origin === "saved" ? "(常連)" : ""}`, "");
    lines.push(r.persona.profile, "");
    if (r.status === "aborted") {
      lines.push(`(${r.comment})`, "");
    } else {
      lines.push(
        `- 総合: ${r.overall.toFixed(1)} / 5.0`,
        ...r.scores.map((s) => `- ${s.name}: ${s.score}`),
        "",
        `> ${r.comment}`,
        "",
        "### タスク結果",
        "",
        ...r.taskResults.map((t) => `- [${t.achieved ? "x" : " "}] ${t.goal} — ${t.note}`),
        "",
      );
    }
    lines.push(
      "### 行動ログ",
      "",
      ...r.steps.map((s) => `${s.step}. ${s.action} → ${s.observation}`),
      "",
    );
  }
  return lines.join("\n");
}

async function writePubReport(dir: string, batch: number, report: PubReport): Promise<void> {
  await fs.writeFile(path.join(dir, "report.md"), renderPubMarkdown(batch, report), "utf8");
}

/** 最新成功バッチに AI 客を招いて Pub を実行し、PubReport を保存した Brew を返す */
export async function runPub(brew: Brew, deps: PubDeps, opts: PubOptions): Promise<Brew> {
  const target = latestSucceededBatch(brew);
  if (!target) throw new Error("成功したバッチがありません。先にビルドを完了してください。");
  const total = opts.autoCount + opts.savedPersonas.length;
  if (total < 1 || total > MAX_PUB_GUESTS) {
    throw new Error(`客の人数は合計1〜${MAX_PUB_GUESTS}にしてください。`);
  }

  // 成果物はステージングに書き、成功時だけ本体(pub/)と入れ替える。
  // 中断・失敗した再実行で前回のレポートと今回の中途半端なスクリーンショットが混ざるのを防ぐ
  const finalDir = pubDir(brew.id, target.number);
  const stagingDir = `${finalDir}-staging`;

  let current = withPub(brew, "opening", "生成アプリを起動しています", target.number);
  const client = trackingClient(
    deps.client,
    () => current,
    (b) => {
      current = b;
    },
  );
  try {
    await deps.onProgress?.(current);
    if (deps.cancel?.cancelled) return { ...current, pubProgress: null };

    // 撮影と同じ理由で、稼働中の「注ぐ」サーバーがあれば止めてから開店する
    await deps.stopServer(brew.id).catch(() => undefined);
    const { port } = await deps.startServer(brew.id, target.number);
    try {
      current = withPub(current, "opening", "AI客のペルソナを準備しています", target.number);
      await deps.onProgress?.(current);
      const personas: PubPersona[] = opts.savedPersonas.map(savedToPersona);
      if (opts.autoCount > 0) {
        personas.push(...(await generatePersonas(client, current, opts.autoCount)));
      }
      if (deps.cancel?.cancelled) return { ...current, pubProgress: null };

      await fs.rm(stagingDir, { recursive: true, force: true });
      await fs.mkdir(stagingDir, { recursive: true });
      const results: PubPersonaResult[] = [];
      for (let i = 0; i < personas.length; i++) {
        if (deps.cancel?.cancelled) return { ...current, pubProgress: null };
        const persona = personas[i];
        const label = `ペルソナ ${i + 1}/${personas.length}「${persona.name}」`;
        current = withPub(current, "serving", `${label}: セッション開始`, target.number);
        await deps.onProgress?.(current);

        const driver = await deps.createDriver(`http://localhost:${port}`);
        try {
          const result = await runPersonaSession(client, driver, persona, {
            cancel: deps.cancel,
            onStep: async (step) => {
              current = withPub(current, "serving", `${label}: ステップ ${step}`, target.number);
              await deps.onProgress?.(current);
            },
          });
          await driver
            .screenshot(path.join(stagingDir, pubScreenshotName(i + 1)))
            .catch(() => undefined);
          results.push(result);
        } finally {
          await driver.close().catch(() => undefined);
        }
      }
      if (deps.cancel?.cancelled) return { ...current, pubProgress: null };

      const completed = results.filter((r) => r.status === "completed");
      if (completed.length === 0) {
        throw new Error("すべてのAI客のセッションが失敗しました。設定を確認して再実行してください。");
      }

      current = withPub(current, "closing", "客の評判をまとめています", target.number);
      await deps.onProgress?.(current);
      const { value: summary } = await client.generateText({
        tag: "pub-summary",
        system: SUMMARY_SYSTEM,
        prompt: buildSummaryPrompt(results),
      });
      const report: PubReport = {
        overall: round1(completed.reduce((sum, r) => sum + r.overall, 0) / completed.length),
        personaResults: results,
        summary,
        ranAt: new Date().toISOString(),
      };
      await writePubReport(stagingDir, target.number, report);
      await fs.rm(finalDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await renameWithRetry(stagingDir, finalDir);
      return {
        ...current,
        batches: upsertBatch(current.batches, { ...target, pub: report }),
        pubProgress: null,
      };
    } finally {
      await deps.stopServer(brew.id).catch(() => undefined);
    }
  } catch (err) {
    try {
      await deps.onProgress?.({ ...current, pubProgress: null });
    } catch {
      // 進捗クリアの失敗より元のエラーを優先する
    }
    throw err;
  } finally {
    // 成功時はrenameで消えているのでno-op。中断・失敗時に中途半端な成果物を残さない
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
