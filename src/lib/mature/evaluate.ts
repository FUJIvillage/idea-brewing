import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GenerateOptions, LlmClient, LlmImage } from "@/lib/llm/client";
import { tapDir } from "@/lib/store";
import type { BatchEvaluation } from "@/lib/store/types";
import type { EvaluationMaterials } from "./materials";

const evaluationSchema = z.object({
  axes: z
    .array(
      z.object({
        name: z.string().min(1),
        score: z.number().int().min(1).max(5),
        comment: z.string(),
      }),
    )
    .min(1),
  summary: z.string().min(1),
  improvements: z.array(z.string().min(1)).min(1).max(10),
  strategy: z.enum(["repair", "rebuild"]),
});

const EVALUATE_SYSTEM = [
  "あなたは idea brewing の熟成職人です。生成された Web サービスをルーブリックに沿って厳密に自己評価します。",
  "ルーブリックの観点ごとに1〜5点で採点し、根拠を簡潔な講評として書きます。",
  "スクリーンショットが与えられた場合、UI/UX の観点は実画面を根拠に採点します。",
  "生成過程(煮沸の質疑応答・ビルドログ)から、要求とのズレや不安定な工程も指摘します。",
  "improvements は後続のコーディングエージェントがそのまま実行できる具体的な指示にします(5〜10個)。",
  "軽微な修正で改善できるなら strategy は repair、構造的な作り直しが必要なら rebuild を選びます。",
].join("\n");

export const DESIGN_FIDELITY_AXIS = "デザイン忠実度";

const MOCK_SYSTEM_SENTENCE = [
  `デザインモックが与えられた場合、観点「${DESIGN_FIDELITY_AXIS}」を必ず axes に含めます。`,
  "実画面がモックのレイアウト・配色・タイポグラフィ・装飾要素(進捗リング・バッジ・アイコン等)をどこまで再現しているかを採点し、",
  "欠けている装飾要素・色ズレ・配置ズレなどの差分は improvements に具体的に列挙します。",
].join("");

function buildEvaluatePrompt(materials: EvaluationMaterials): string {
  const sections = [
    "## 採点ルーブリック",
    materials.rubric,
    "## 生成されたコード",
    materials.codeDigest,
    "## 生成過程",
    materials.process,
  ];
  if (materials.mockImage) {
    sections.push(
      "## 画像について",
      "1枚目はデザインモック(目標)、2枚目以降は実画面のスクリーンショットです。",
    );
  }
  if (materials.previousEvaluation) {
    sections.push(
      "## 前回の評価(改善指示が反映されたかも確認すること)",
      JSON.stringify(materials.previousEvaluation, null, 2),
    );
  }
  return sections.join("\n\n");
}

export async function evaluateBatch(
  client: LlmClient,
  materials: EvaluationMaterials,
  screenshots: LlmImage[],
): Promise<BatchEvaluation> {
  // 画像の並びはプロンプトの「## 画像について」と一致させる(1枚目=モック、以降=実画面)
  const images = materials.mockImage ? [materials.mockImage, ...screenshots] : screenshots;
  const opts: GenerateOptions = {
    tag: "evaluate",
    system: materials.mockImage
      ? `${EVALUATE_SYSTEM}\n${MOCK_SYSTEM_SENTENCE}`
      : EVALUATE_SYSTEM,
    prompt: buildEvaluatePrompt(materials),
  };

  let raw: z.infer<typeof evaluationSchema> | null = null;
  let screenshotsUsed = images.length > 0;
  if (screenshotsUsed) {
    try {
      raw = await client.generateObject(evaluationSchema, { ...opts, images });
    } catch {
      screenshotsUsed = false; // vision 非対応モデルの可能性。画像なしで1回だけ再試行する
    }
  }
  if (!raw) raw = await client.generateObject(evaluationSchema, opts);

  const overall =
    Math.round((raw.axes.reduce((sum, a) => sum + a.score, 0) / raw.axes.length) * 10) / 10;
  return {
    overall,
    axes: raw.axes,
    summary: raw.summary,
    improvements: raw.improvements,
    strategy: raw.strategy,
    screenshotsUsed,
    evaluatedAt: new Date().toISOString(),
  };
}

export function renderEvaluationMarkdown(batch: number, ev: BatchEvaluation): string {
  return [
    `# バッチ${batch} 自己評価レポート`,
    "",
    `- 総合スコア: ${ev.overall.toFixed(1)} / 5.0`,
    `- 評価日時: ${ev.evaluatedAt}`,
    `- スクリーンショット: ${ev.screenshotsUsed ? "採点に使用" : "なしで評価"}`,
    `- 次バッチ戦略: ${ev.strategy}`,
    "",
    "## 観点別スコア",
    "",
    "| 観点 | スコア | 講評 |",
    "|---|---|---|",
    ...ev.axes.map((a) => `| ${a.name} | ${a.score} | ${a.comment} |`),
    "",
    "## 総評",
    "",
    ev.summary,
    "",
    "## 改善指示",
    "",
    ...ev.improvements.map((s, i) => `${i + 1}. ${s}`),
    "",
  ].join("\n");
}

export async function writeEvaluationReport(
  brewId: string,
  batch: number,
  ev: BatchEvaluation,
): Promise<void> {
  await fs.writeFile(
    path.join(tapDir(brewId, batch), "evaluation.md"),
    renderEvaluationMarkdown(batch, ev),
    "utf8",
  );
}
