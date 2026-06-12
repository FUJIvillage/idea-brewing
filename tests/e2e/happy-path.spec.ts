import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("原料投入からレシピ生成までのハッピーパス", async ({ page }) => {
  // 1. 新しい仕込み
  await page.goto("/");
  await page.getByRole("link", { name: "新しい仕込み" }).click();
  await page.getByLabel("ブリュー名").fill("最高のtodoアプリ");
  await page.getByLabel("アイデアメモ").fill("最高のtodoアプリ");
  await page.getByRole("button", { name: "仕込みを始める" }).click();

  // 2. 仕込み(マッシュ)
  await page.getByRole("button", { name: "仕込み開始(マッシュ)" }).click();
  await expect(page.getByRole("heading", { name: "コンセプト", exact: true })).toBeVisible();

  // 3. グリル(auto)
  await page.getByRole("button", { name: "グリル", exact: true }).click();
  await page.getByLabel("autoモード", { exact: false }).check();
  await page.getByRole("button", { name: "グリル開始" }).click();
  // 「煮詰め完了にする」ボタンと区別するため句点付きの完了メッセージで待つ
  await expect(page.getByText("煮詰め完了。")).toBeVisible({ timeout: 30_000 });

  // 4. レシピ生成(発酵)
  await page.getByRole("button", { name: "レシピ", exact: true }).click();
  await page.getByRole("button", { name: "レシピ生成" }).click();
  await expect(page.getByText("06-evaluation-criteria.md")).toBeVisible({
    timeout: 60_000,
  });

  // 5. ファイルが実際にディスクへ出力されている
  const brewsDir = path.join(process.cwd(), ".e2e-data", "brews");
  const ids = readdirSync(brewsDir);
  expect(ids).toHaveLength(1);
  for (const f of [
    "00-overview.md",
    "01-requirements.md",
    "02-screens.md",
    "03-design-system.md",
    "04-architecture.md",
    "05-implementation-plan.md",
    "06-evaluation-criteria.md",
  ]) {
    expect(existsSync(path.join(brewsDir, ids[0], "recipe", f))).toBe(true);
  }
});
