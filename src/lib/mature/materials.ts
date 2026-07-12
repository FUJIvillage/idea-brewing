import { promises as fs } from "node:fs";
import path from "node:path";
import { readRecipeFile } from "@/lib/recipe";
import { tapDir } from "@/lib/store";
import type { BatchEvaluation, Brew, GrillEntry } from "@/lib/store/types";

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

export function grillDump(entries: GrillEntry[]): string {
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

export async function collectMaterials(brew: Brew, batch: number): Promise<EvaluationMaterials> {
  let rubric: string;
  try {
    rubric = await readRecipeFile(brew.id, "06-evaluation-criteria.md");
  } catch {
    throw new Error(
      "自己評価基準(06-evaluation-criteria.md)がありません。レシピを再生成してください。",
    );
  }

  const codeDigest = await buildCodeDigest(tapDir(brew.id, batch));

  const previous = [...brew.batches]
    .filter((b) => b.number < batch && b.evaluation !== null)
    .sort((a, b) => b.number - a.number)[0];

  const process = [
    "### グリルでの質疑応答",
    grillDump(brew.grill.entries),
    "",
    "### ビルドログ(末尾)",
    await readBuildLogTail(brew.id, batch),
  ].join("\n");

  return {
    rubric,
    codeDigest,
    process,
    previousEvaluation: previous?.evaluation ?? null,
  };
}
