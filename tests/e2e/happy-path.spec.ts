import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.setTimeout(240_000);

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
    await page.waitForURL(/\/brews\/(?!new$)[^/]+$/);
    const match = page.url().match(/\/brews\/([^/?#]+)$/);
    if (!match) throw new Error("作成したブリューIDをURLから取得できませんでした。");
    brewId = decodeURIComponent(match[1]);

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
    await expect(page.getByText(/バッチ1 完成/)).toBeVisible({ timeout: 60_000 });
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
    expect(href).not.toBeNull();
    if (!href) throw new Error("タップサーバーのリンクURLを取得できませんでした。");
    expect(href).toMatch(/^http:\/\/localhost:\d+$/);
    const res = await page.request.get(href);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain("フェイクタップアプリ");

    // 8. 止める
    await page.getByRole("button", { name: "止める", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "注ぐ(サーバー起動)", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    tapServerStartRequested = false;

    // 9. 熟成: 評価(フェイクLLM・スクリーンショットはスキップされる)
    await page.getByRole("button", { name: "熟成", exact: true }).click();
    await page.getByRole("button", { name: "このバッチを評価", exact: true }).click();
    await expect(page.getByText("3.0 / 5.0").first()).toBeVisible({ timeout: 60_000 });
    expect(existsSync(path.join(brewsDir, brewId, "taps", "batch-1", "evaluation.md"))).toBe(true);

    // 10. 改善して次のバッチへ(repair)
    await page.getByRole("button", { name: /改善して次のバッチへ/ }).click();
    await expect(page.getByText("バッチ2", { exact: true })).toBeVisible({ timeout: 60_000 });
    expect(
      existsSync(
        path.join(brewsDir, brewId, "taps", "batch-2", "docs", "recipe", "07-improvement-notes.md"),
      ),
    ).toBe(true);

    // 11. タップに戻るとバッチ2が提供対象になっている
    await page.getByRole("button", { name: "タップ", exact: true }).click();
    await expect(page.getByText(/バッチ2 完成/)).toBeVisible({ timeout: 30_000 });
    tapServerStartRequested = true;
    await page.getByRole("button", { name: "注ぐ(サーバー起動)", exact: true }).click();
    const link2 = page.getByRole("link", { name: /^http:\/\/localhost:\d+$/ });
    await expect(link2).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "止める", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "注ぐ(サーバー起動)", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    tapServerStartRequested = false;

    // 12. Pub: 常連客を登録して開店(フェイクLLM+フェイクドライバ)
    await page.getByRole("button", { name: "Pub", exact: true }).click();
    await page.getByText("常連客の管理").click();
    await page.getByLabel("名前").fill("テスト常連");
    await page.getByLabel("プロフィール").fill("毎日来る");
    await page.getByLabel("目的(1行に1件)").fill("トップページを見る");
    await page.getByRole("button", { name: "常連客を追加", exact: true }).click();
    const regularCheckbox = page.getByRole("checkbox", { name: "テスト常連" });
    await expect(regularCheckbox).toBeVisible({ timeout: 30_000 });
    await regularCheckbox.check();
    await page.getByLabel("自動生成の人数").fill("1");
    await page.getByRole("button", { name: "開店する", exact: true }).click();

    // 常連(1人目=高評価4.5) + 自動生成(2人目=3.3) → 総合 3.9
    await expect(page.getByText(/3\.9 \/ 5\.0/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("常連", { exact: true })).toBeVisible();
    expect(
      existsSync(path.join(brewsDir, brewId, "taps", "batch-2", "pub", "report.md")),
    ).toBe(true);

    // 13. リーダーボードに載る
    await page.goto("/leaderboard");
    await expect(page.getByRole("link", { name: "最高のtodoアプリ" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("3.9", { exact: true })).toBeVisible();
  } finally {
    if (brewId) {
      await page.request.post(`/api/brews/${brewId}/tap/cancel`).catch(() => undefined);
      await page.request.post(`/api/brews/${brewId}/mature/cancel`).catch(() => undefined);
      await page.request.post(`/api/brews/${brewId}/pub/cancel`).catch(() => undefined);
    }
    if (brewId && tapServerStartRequested) {
      await page.request
        .post(`/api/brews/${brewId}/tap/server`, { data: { action: "stop" } })
        .catch(() => undefined);
    }
  }
});
