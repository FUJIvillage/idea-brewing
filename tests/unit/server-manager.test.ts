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

    const { port } = await startServer(brew.id, 1);
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

    const first = await startServer(brew.id, 1);
    const second = await startServer(brew.id, 1);

    expect(second.port).toBe(first.port);
    await stopServer(brew.id);
    brewId = null;
  }, 60_000);

  it("同時に起動要求しても同じサーバーを共有する", async () => {
    const brew = await createBrew("サーバー同時起動");
    brewId = brew.id;
    await fs.cp(path.join(process.cwd(), "templates", "tap-fake"), tapDir(brew.id, 1), {
      recursive: true,
    });

    const [first, second] = await Promise.all([startServer(brew.id, 1), startServer(brew.id, 1)]);

    expect(second.port).toBe(first.port);
    expect(serverStatus(brew.id)).toEqual({ running: true, port: first.port, batch: 1 });
    await stopServer(brew.id);
    brewId = null;
  }, 60_000);

  it("別バッチを指定すると旧サーバーを止めて起動し直す", async () => {
    const brew = await createBrew("バッチ切替");
    brewId = brew.id;
    await fs.cp(path.join(process.cwd(), "templates", "tap-fake"), tapDir(brew.id, 1), {
      recursive: true,
    });
    await fs.cp(path.join(process.cwd(), "templates", "tap-fake"), tapDir(brew.id, 2), {
      recursive: true,
    });

    await startServer(brew.id, 1);
    expect(serverStatus(brew.id).batch).toBe(1);

    const { port } = await startServer(brew.id, 2);
    const status = serverStatus(brew.id);
    expect(status).toEqual({ running: true, port, batch: 2 });

    await stopServer(brew.id);
    brewId = null;
  }, 60_000);
});
