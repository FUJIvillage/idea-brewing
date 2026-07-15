import { promises as fs } from "node:fs";
import path from "node:path";
import { MOCK_PNG } from "@/lib/design";
import type { LlmImage } from "@/lib/llm/client";
import { readRecipeFile } from "@/lib/recipe";
import { designDir, tapDir } from "@/lib/store";
import type { BatchEvaluation, Brew, BoilEntry } from "@/lib/store/types";

const DIGEST_LIMIT = 60 * 1024; // コードダイジェストの合計上限(文字数で近似)
const LOG_TAIL_CHARS = 4 * 1024;

const DIGEST_EXCLUDES = new Set([
  "node_modules",
  "dist",
  "docs",
  "screenshots",
  "build.log",
  "evaluation.md",
  "agent-log.txt",
  "package-lock.json",
  "pub",
  "pub-staging",
]);

export interface EvaluationMaterials {
  rubric: string;
  codeDigest: string;
  process: string;
  previousEvaluation: BatchEvaluation | null;
  /** デザイン工程のモック(あれば「デザイン忠実度」の採点基準になる) */
  mockImage: LlmImage | null;
}

async function listDigestFiles(batchDir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await fs.readdir(path.join(batchDir, rel), { withFileTypes: true });
    for (const entry of entries) {
      if (DIGEST_EXCLUDES.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(childRel);
      else results.push(childRel);
    }
  }
  await walk("");
  return results.sort();
}

export async function buildCodeDigest(batchDir: string): Promise<string> {
  const files = await listDigestFiles(batchDir);
  let remaining = DIGEST_LIMIT;
  const chunks: string[] = [];
  for (const rel of files) {
    if (!rel.startsWith("src/")) continue;
    const content = await fs.readFile(path.join(batchDir, rel), "utf8");
    const header = `\n===== ${rel} =====\n`;
    if (header.length + content.length > remaining) {
      chunks.push(`${header}(サイズ上限のため省略)`);
      continue;
    }
    remaining -= header.length + content.length;
    chunks.push(header + content);
  }
  return [
    "### ファイルツリー",
    files.join("\n") || "(なし)",
    "",
    "### ソースコード(src/ 配下)",
    chunks.join("\n") || "(なし)",
  ].join("\n");
}

export function boilDump(entries: BoilEntry[]): string {
  const answered = entries.filter((e) => e.answer);
  if (answered.length === 0) return "(質疑なし)";
  return answered
    .map(
      (e, i) =>
        `Q${i + 1}: ${e.question}\nA${i + 1}(${e.answeredBy === "auto" ? "自動" : "ユーザー"}): ${e.answer}`,
    )
    .join("\n");
}

async function readBuildLogTail(brewId: string, batch: number): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(tapDir(brewId, batch), "build.log"), "utf8");
    return raw.slice(-LOG_TAIL_CHARS);
  } catch {
    return "(build.log なし)";
  }
}

export const RUBRIC_FILE = "06-evaluation-criteria.md";
export const RUBRIC_MISSING_ERROR = `自己評価基準(${RUBRIC_FILE})がありません。レシピを再生成してください。`;

/** ルーブリックの存在確認(ルートが実行前に400で弾くための事前検査) */
export async function hasRubric(brewId: string): Promise<boolean> {
  try {
    await readRecipeFile(brewId, RUBRIC_FILE);
    return true;
  } catch {
    return false;
  }
}

async function readMockImage(brewId: string): Promise<LlmImage | null> {
  try {
    return { data: await fs.readFile(path.join(designDir(brewId), MOCK_PNG)), mimeType: "image/png" };
  } catch {
    return null; // モック未生成なら従来どおりの評価
  }
}

export async function collectMaterials(brew: Brew, batch: number): Promise<EvaluationMaterials> {
  let rubric: string;
  try {
    rubric = await readRecipeFile(brew.id, RUBRIC_FILE);
  } catch {
    throw new Error(RUBRIC_MISSING_ERROR);
  }

  const codeDigest = await buildCodeDigest(tapDir(brew.id, batch));

  const previous = [...brew.batches]
    .filter((b) => b.number < batch && b.evaluation !== null)
    .sort((a, b) => b.number - a.number)[0];

  const process = [
    "### 煮沸での質疑応答",
    boilDump(brew.boil.entries),
    "",
    "### ビルドログ(末尾)",
    await readBuildLogTail(brew.id, batch),
  ].join("\n");

  return {
    rubric,
    codeDigest,
    process,
    previousEvaluation: previous?.evaluation ?? null,
    mockImage: brew.designMock?.status === "succeeded" ? await readMockImage(brew.id) : null,
  };
}
