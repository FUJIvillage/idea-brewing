import { promises as fs } from "node:fs";
import path from "node:path";
import type { LlmClient } from "@/lib/llm/client";
import { recipeDir } from "@/lib/store";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type BrewSheet,
  type GrillEntry,
} from "@/lib/store/types";

export interface RecipeFileDef {
  file: string;
  title: string;
  instructions: string;
}

export const RECIPE_FILES: RecipeFileDef[] = [
  {
    file: "00-overview.md",
    title: "サービス概要",
    instructions:
      "サービスの概要とエレベーターピッチ。何を・誰のために・なぜ作るのか、提供価値の核を簡潔にまとめる。",
  },
  {
    file: "01-requirements.md",
    title: "要件定義",
    instructions:
      "機能要件(Must/Should/Couldごとにユーザーストーリー形式)と非機能要件(性能・セキュリティ・対応環境)。受け入れ条件を箇条書きで付ける。",
  },
  {
    file: "02-screens.md",
    title: "画面設計",
    instructions:
      "画面一覧、各画面の構成要素(セクション・主要コンポーネント)、画面間の遷移とUXフロー。主要ユースケースごとのユーザー動線を含める。",
  },
  {
    file: "03-design-system.md",
    title: "デザインシステム",
    instructions:
      "UI/UXデザイン指針。カラーパレット(HEX値)、タイポグラフィ、余白とレイアウト原則、コンポーネントのスタイル方針、インタラクション。参考ビジュアルがあればその特徴を言語化して反映する。",
  },
  {
    file: "04-architecture.md",
    title: "技術構成",
    instructions:
      "推奨技術スタックと選定理由、データモデル、ディレクトリ構成、外部依存。ローカルで dev サーバーを起動してブラウザで動く Web アプリであることを前提にする。",
  },
  {
    file: "05-implementation-plan.md",
    title: "実装計画",
    instructions:
      "実装AIエージェント(コーディングエージェント)にそのまま渡せる粒度のタスク分解。各タスクに対象ファイル・実装内容・完了条件を付け、依存順に並べる。",
  },
  {
    file: "06-evaluation-criteria.md",
    title: "自己評価基準",
    instructions:
      "ブリューシートの成功基準と自己評価の観点を、観点×5段階の採点ルーブリックに展開する。観点ごとに1点と5点の具体的な状態を記述し、機能面とUI/UX面の両方を含める。",
  },
];

const RECIPE_SYSTEM = [
  "あなたは idea brewing の発酵職人です。",
  "確定したブリューシートとグリルでの質疑応答をもとに、後続の実装AIエージェントがそのまま使える実装資料を Markdown で書きます。",
  "資料は日本語。見出し構造を明確にし、曖昧な表現を避け、具体的に書きます。",
  "ファイルの先頭は「# <資料タイトル>」の見出しで始めてください。",
].join("\n");

function sheetDump(sheet: BrewSheet): string {
  return SHEET_KEYS.map((k) => `### ${SHEET_LABELS[k]}\n${sheet[k].content || "(空)"}`).join(
    "\n\n",
  );
}

function qaDump(entries: GrillEntry[]): string {
  const answered = entries.filter((e) => e.answer);
  if (answered.length === 0) return "(質疑なし)";
  return answered.map((e, i) => `Q${i + 1}: ${e.question}\nA${i + 1}: ${e.answer}`).join("\n");
}

export async function generateRecipe(
  brew: Brew,
  client: LlmClient,
  onProgress?: (brew: Brew) => Promise<void> | void,
): Promise<Brew> {
  if (!brew.sheet) throw new Error("シートがまだありません。先に仕込みを実行してください。");
  await archiveExistingRecipe(brew.id);
  await fs.mkdir(recipeDir(brew.id), { recursive: true });

  let current: Brew = { ...brew, stage: "fermenting" };
  const generated: string[] = [];

  try {
    for (let i = 0; i < RECIPE_FILES.length; i++) {
      const def = RECIPE_FILES[i];
      current = {
        ...current,
        recipeProgress: { current: i + 1, total: RECIPE_FILES.length, file: def.file },
      };
      await onProgress?.(current);

      const prompt = [
        `## 作成する資料`,
        `ファイル名: ${def.file}`,
        `タイトル: ${def.title}`,
        `指示: ${def.instructions}`,
        `## ブリューシート(確定版)`,
        sheetDump(current.sheet!),
        `## グリルでの質疑応答`,
        qaDump(current.grill.entries),
        `## 生成済みの資料`,
        generated.length > 0 ? generated.join(", ") : "(なし)",
      ].join("\n\n");

      const text = await client.generateText({ tag: "recipe", system: RECIPE_SYSTEM, prompt });
      await fs.writeFile(path.join(recipeDir(brew.id), def.file), text, "utf8");
      generated.push(def.file);
    }
  } catch (err) {
    await onProgress?.({ ...current, recipeProgress: null });
    throw err;
  }

  return {
    ...current,
    stage: "done",
    recipeProgress: null,
    recipeGeneratedAt: new Date().toISOString(),
  };
}

async function archiveExistingRecipe(brewId: string): Promise<void> {
  const dir = recipeDir(brewId);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return;
  }
  if (files.length === 0) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, "history", stamp);
  await fs.mkdir(dest, { recursive: true });
  for (const f of files) {
    await fs.rename(path.join(dir, f), path.join(dest, f));
  }
}

export async function listRecipeFiles(brewId: string): Promise<string[]> {
  try {
    const files = await fs.readdir(recipeDir(brewId));
    return RECIPE_FILES.map((d) => d.file).filter((f) => files.includes(f));
  } catch {
    return [];
  }
}

export async function readRecipeFile(brewId: string, file: string): Promise<string> {
  if (!RECIPE_FILES.some((d) => d.file === file)) {
    throw new Error(`不正なファイル名です: ${file}`);
  }
  return fs.readFile(path.join(recipeDir(brewId), file), "utf8");
}
