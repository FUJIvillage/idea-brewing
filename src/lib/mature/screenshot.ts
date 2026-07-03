import { promises as fs } from "node:fs";
import path from "node:path";
import { tapDir } from "@/lib/store";

export const SCREENSHOT_FILES = ["desktop.png", "mobile.png"] as const;
export type ScreenshotFile = (typeof SCREENSHOT_FILES)[number];

const VIEWPORTS: Record<ScreenshotFile, { width: number; height: number }> = {
  "desktop.png": { width: 1280, height: 800 },
  "mobile.png": { width: 390, height: 844 },
};

export interface ScreenshotPage {
  goto(url: string, opts: { waitUntil: "networkidle"; timeout: number }): Promise<unknown>;
  screenshot(opts: { path: string }): Promise<unknown>;
  close(): Promise<void>;
}

export interface ScreenshotBrowser {
  newPage(opts: { viewport: { width: number; height: number } }): Promise<ScreenshotPage>;
  close(): Promise<void>;
}

export interface ScreenshotDeps {
  startServer: (brewId: string, batch: number) => Promise<{ port: number }>;
  stopServer: (brewId: string) => Promise<void>;
  launch: () => Promise<ScreenshotBrowser>;
}

export async function launchChromium(): Promise<ScreenshotBrowser> {
  const { chromium } = await import("playwright");
  return chromium.launch();
}

/**
 * バッチの dev サーバーを起動して実画面を撮影する。
 * 撮影は評価の補助情報なので、失敗しても例外を投げず空配列を返す(熟成全体を止めない契約)。
 * 戻り値は保存できたスクリーンショットの絶対パス。
 */
export async function captureScreenshots(
  brewId: string,
  batch: number,
  deps: ScreenshotDeps,
): Promise<string[]> {
  let port: number;
  try {
    ({ port } = await deps.startServer(brewId, batch));
  } catch {
    return [];
  }

  try {
    const browser = await deps.launch();
    try {
      const dir = path.join(tapDir(brewId, batch), "screenshots");
      await fs.mkdir(dir, { recursive: true });
      const saved: string[] = [];
      for (const name of SCREENSHOT_FILES) {
        const page = await browser.newPage({ viewport: VIEWPORTS[name] });
        try {
          await page.goto(`http://localhost:${port}/`, {
            waitUntil: "networkidle",
            timeout: 15_000,
          });
          const file = path.join(dir, name);
          await page.screenshot({ path: file });
          saved.push(file);
        } finally {
          await page.close();
        }
      }
      return saved;
    } finally {
      await browser.close();
    }
  } catch {
    return [];
  } finally {
    await deps.stopServer(brewId).catch(() => undefined);
  }
}
