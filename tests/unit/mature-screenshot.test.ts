import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew, tapDir } from "@/lib/store";
import {
  captureScreenshots,
  SCREENSHOT_FILES,
  type ScreenshotBrowser,
  type ScreenshotDeps,
} from "@/lib/mature/screenshot";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function fakeBrowser(log: string[]): ScreenshotBrowser {
  return {
    async newPage() {
      return {
        async goto(url: string) {
          log.push(`goto:${url}`);
        },
        async screenshot({ path: file }: { path: string }) {
          await fs.writeFile(file, "png", "utf8");
          log.push(`shot:${path.basename(file)}`);
        },
        async close() {},
      };
    },
    async close() {
      log.push("browser-closed");
    },
  };
}

describe("captureScreenshots", () => {
  it("2枚撮影して保存パスを返し、サーバーを停止する", async () => {
    const brew = await createBrew("撮影");
    const log: string[] = [];
    const deps: ScreenshotDeps = {
      startServer: async () => {
        log.push("server-start");
        return { port: 12345 };
      },
      stopServer: async () => {
        log.push("server-stop");
      },
      launch: async () => fakeBrowser(log),
    };

    const saved = await captureScreenshots(brew.id, 1, deps);

    expect(saved).toHaveLength(2);
    for (const name of SCREENSHOT_FILES) {
      expect(existsSync(path.join(tapDir(brew.id, 1), "screenshots", name))).toBe(true);
    }
    expect(log).toContain("server-stop");
    expect(log).toContain("browser-closed");
    expect(log[0]).toBe("server-start");
  });

  it("サーバー起動に失敗したら空配列(例外なし)", async () => {
    const brew = await createBrew("撮影失敗1");
    const saved = await captureScreenshots(brew.id, 1, {
      startServer: async () => {
        throw new Error("起動失敗");
      },
      stopServer: async () => {},
      launch: async () => fakeBrowser([]),
    });
    expect(saved).toEqual([]);
  });

  it("ブラウザ起動に失敗したら空配列を返しサーバーは停止する", async () => {
    const brew = await createBrew("撮影失敗2");
    const log: string[] = [];
    const saved = await captureScreenshots(brew.id, 1, {
      startServer: async () => ({ port: 12345 }),
      stopServer: async () => {
        log.push("server-stop");
      },
      launch: async () => {
        throw new Error("playwright未インストール");
      },
    });
    expect(saved).toEqual([]);
    expect(log).toContain("server-stop");
  });
});
