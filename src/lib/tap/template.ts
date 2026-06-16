import { promises as fs } from "node:fs";
import path from "node:path";
import { recipeDir, tapDir } from "@/lib/store";
import { RECIPE_FILES } from "@/lib/recipe";

export type TemplateId = "tap-vite" | "tap-fake";

export interface TapManifest {
  /** シェルで順に実行する検証コマンド。1つでも失敗したら検証失敗 */
  verify: string[];
}

export function templateDir(template: TemplateId): string {
  return path.join(process.cwd(), "templates", template);
}

export function shouldCopyTemplatePath(root: string, src: string): boolean {
  const segments = path.relative(root, src).split(path.sep).filter(Boolean);
  return !segments.includes("node_modules") && !segments.includes("dist");
}

/**
 * バッチフォルダを作り直してテンプレートをコピーし、レシピ一式を docs/recipe/ に同梱する。
 * 既存のバッチフォルダは丸ごと削除する(第2版では batch-1 の再ビルド = 上書き)。
 */
export async function prepareBatchDir(
  brewId: string,
  batch: number,
  template: TemplateId,
): Promise<string> {
  const dest = tapDir(brewId, batch);
  const root = templateDir(template);
  await fs.rm(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.cp(root, dest, {
    recursive: true,
    filter: (src) => shouldCopyTemplatePath(root, src),
  });
  const docsDir = path.join(dest, "docs", "recipe");
  await fs.mkdir(docsDir, { recursive: true });
  for (const def of RECIPE_FILES) {
    try {
      await fs.copyFile(path.join(recipeDir(brewId), def.file), path.join(docsDir, def.file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      // 存在しないレシピファイルはスキップ(呼び出し側でレシピ生成済みを検証している)
    }
  }
  return dest;
}

export async function readManifest(batchDir: string): Promise<TapManifest> {
  const raw = await fs.readFile(path.join(batchDir, "tap.json"), "utf8");
  const parsed = JSON.parse(raw) as Partial<TapManifest>;
  if (!Array.isArray(parsed.verify) || !parsed.verify.every((v) => typeof v === "string")) {
    throw new Error("tap.json の verify は文字列配列である必要があります。");
  }
  return { verify: parsed.verify };
}
