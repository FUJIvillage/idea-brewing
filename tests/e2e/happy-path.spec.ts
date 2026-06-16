import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("原料投入からタップ提供までのハッピーパス", async ({ page }) => {
  let brewId: string | null = null;
  let tapServerStartRequested = false;
  const e2eDataDir = path.join(process.cwd(), ".e2e-data");

  try {
    // 1. 新しい仕込み
    await page.goto("/");
    await page.getByRole("link", { name: "新しい仕込み" }).click();
    await page.getByLabel("ブリュー名").fill("最高のtodoアプリ");
    await page.getByLabel("アイデアメモ").fill("最高のtodoアプリ");
    await page.getByRole("button", { name: "仕込みを始める" }).click();

    // 2. 仕込み(マッシュ)
    // マッシュAPI + Next devの初回コンパイルを跨ぐためデフォルト5秒では不足しうる
    await page.getByRole("button", { name: "仕込み開始(マッシュ)" }).click();
    await expect(page.getByRole("heading", { name: "コンセプト", exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // 3. グリル(auto)
    await page.getByRole("button", { name: "グリル", exact: true }).click();
    await page.getByLabel("autoモード").check();
    await page.getByRole("button", { name: "グリル開始" }).click();
    // 「煮詰め完了にする」ボタンと区別するため句点付きの完了メッセージで待つ
    await expect(page.getByText("煮詰め完了。")).toBeVisible({ timeout: 30_000 });

    // 4. レシピ生成(発酵)
    await page.getByRole("button", { name: "レシピ", exact: true }).click();
    await page.getByRole("button", { name: "レシピ生成" }).click();
    // 進行表示「7/7: 06-evaluation-criteria.md を生成中...」と部分一致しないよう、
    // サーバーのreaddir結果から描画されるファイル一覧のボタンで待つ(=ディスク出力済みを含意)
    await expect(
      page.getByRole("button", { name: "06-evaluation-criteria.md" }),
    ).toBeVisible({ timeout: 60_000 });

    // 5. ファイルが実際にディスクへ出力されている
    const brewsDir = path.join(e2eDataDir, "brews");
    const ids = readdirSync(brewsDir);
    // globalSetupは1回の実行につき1度だけ走るため、--retries併用時はこの前提が崩れる
    expect(ids).toHaveLength(1);
    brewId = ids[0];
    for (const f of [
      "00-overview.md",
      "01-requirements.md",
      "02-screens.md",
      "03-design-system.md",
      "04-architecture.md",
      "05-implementation-plan.md",
      "06-evaluation-criteria.md",
    ]) {
      expect(existsSync(path.join(brewsDir, brewId, "recipe", f))).toBe(true);
    }

    // 6. ビルド(タップ・フェイクエンジン)
    await page.getByRole("button", { name: "タップ", exact: true }).click();
    await page.getByRole("button", { name: "ビルド開始(1stバッチ)", exact: true }).click();
    await expect(page.getByText(/1stバッチ完成/)).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("button", { name: "注ぐ(サーバー起動)", exact: true }),
    ).toBeVisible();
    expect(existsSync(path.join(brewsDir, brewId, "taps", "batch-1", "tap.json"))).toBe(true);
    expect(existsSync(path.join(brewsDir, brewId, "taps", "batch-1", "build.log"))).toBe(true);

    // 7. 注ぐ(devサーバー起動)
    tapServerStartRequested = true;
    await page.getByRole("button", { name: "注ぐ(サーバー起動)", exact: true }).click();
    const link = page.getByRole("link", { name: /^http:\/\/localhost:\d+$/ });
    await expect(link).toBeVisible({ timeout: 60_000 });
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^http:\/\/localhost:\d+$/);
    if (!href) throw new Error("タップサーバーのリンクURLを取得できませんでした。");
    const res = await page.request.get(href);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain("フェイクタップアプリ");

    // 8. 止める
    await page.getByRole("button", { name: "止める", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "注ぐ(サーバー起動)", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    tapServerStartRequested = false;
  } finally {
    if (brewId && tapServerStartRequested) {
      await page.request
        .post(`/api/brews/${brewId}/tap/server`, { data: { action: "stop" } })
        .catch(() => undefined);
    }
    rmSync(e2eDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
