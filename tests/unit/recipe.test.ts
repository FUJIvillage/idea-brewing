import { beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBrew, recipeDir } from "@/lib/store";
import { createFakeClient } from "@/lib/llm/fake-client";
import { addTextIngredient } from "@/lib/ingredients";
import { runMash } from "@/lib/brew-sheet";
import { generateRecipe, listRecipeFiles, RECIPE_FILES, readRecipeFile } from "@/lib/recipe";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-recipe-"));
});

async function readyBrew() {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "最高のtodoアプリ");
  brew = await runMash(brew, fake);
  return { brew, fake };
}

test("レシピ7ファイルが生成され stage が done になる", async () => {
  const { brew, fake } = await readyBrew();
  const progress: string[] = [];
  const done = await generateRecipe(brew, fake, async (b) => {
    if (b.recipeProgress) progress.push(b.recipeProgress.file);
  });
  expect(RECIPE_FILES).toHaveLength(7);
  for (const f of RECIPE_FILES) {
    expect(existsSync(path.join(recipeDir(brew.id), f.file))).toBe(true);
  }
  expect(done.stage).toBe("done");
  expect(done.recipeGeneratedAt).not.toBeNull();
  expect(done.recipeProgress).toBeNull();
  expect(progress).toHaveLength(7);
  const files = await listRecipeFiles(brew.id);
  expect(files).toEqual(RECIPE_FILES.map((f) => f.file));
});

test("再発酵すると旧版が history に退避される", async () => {
  const { brew, fake } = await readyBrew();
  const first = await generateRecipe(brew, fake);
  await generateRecipe(first, fake);
  const historyRoot = path.join(recipeDir(brew.id), "history");
  const stamps = readdirSync(historyRoot);
  expect(stamps).toHaveLength(1);
  expect(readdirSync(path.join(historyRoot, stamps[0]))).toHaveLength(7);
});

test("readRecipeFile は許可されたファイル名のみ読める", async () => {
  const { brew, fake } = await readyBrew();
  await generateRecipe(brew, fake);
  const text = await readRecipeFile(brew.id, "00-overview.md");
  expect(text).toContain("フェイク生成ドキュメント");
  await expect(readRecipeFile(brew.id, "../brew.json")).rejects.toThrow();
});
