import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serverStatus, startServer, stopServer } from "@/lib/tap/server-manager";
import { createBrew, tapDir } from "@/lib/store";

let tmp: string;
let brewId: string | null = null;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  if (brewId) {
    await stopServer(brewId);
    brewId = null;
  }
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("server-manager", () => {
  it("フェイクテンプレートのdevサーバーを起動・停止できる", async () => {
    const brew = await createBrew("サーバー");
    brewId = brew.id;
    await fs.cp(path.join(process.cwd(), "templates", "tap-fake"), tapDir(brew.id, 1), {
      recursive: true,
    });

    const { port } = await startServer(brew.id);
    expect(serverStatus(brew.id).running).toBe(true);
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.ok).toBe(true);
    expect(await res.text()).toContain("フェイクタップアプリ");

    await stopServer(brew.id);
    brewId = null;
    expect(serverStatus(brew.id).running).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 60_000);

  it("起動済みサーバーがあれば同じポートを返す", async () => {
    const brew = await createBrew("サーバー再利用");
    brewId = brew.id;
    await fs.cp(path.join(process.cwd(), "templates", "tap-fake"), tapDir(brew.id, 1), {
      recursive: true,
    });

    const first = await startServer(brew.id);
    const second = await startServer(brew.id);

    expect(second.port).toBe(first.port);
    await stopServer(brew.id);
    brewId = null;
  }, 60_000);
});
