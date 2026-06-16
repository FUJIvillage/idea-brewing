import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { tapDir } from "@/lib/store";

interface RunningServer {
  child: ChildProcess;
  pid: number;
  port: number;
  startedAt: string;
}

export interface ServerStatus {
  running: boolean;
  port: number | null;
}

const servers = new Map<string, RunningServer>();

async function findFreePort(start = 5173): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => {
        srv.close(() => resolve(true));
      });
    });
    if (free) return port;
  }
  throw new Error("空きポートが見つかりません。");
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (hasExited(child)) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function killProcessTree(entry: RunningServer): Promise<void> {
  if (hasExited(entry.child)) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(entry.pid), "/T", "/F"], {
        windowsHide: true,
      });
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      killer.once("error", () => {
        entry.child.kill();
        done();
      });
      killer.once("close", done);
    });
  } else {
    try {
      process.kill(-entry.pid, "SIGTERM");
    } catch {
      entry.child.kill("SIGTERM");
    }
  }

  await waitForExit(entry.child);
}

async function respondsOk(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_000);
  try {
    const res = await fetch(`http://localhost:${port}/`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function startServer(brewId: string): Promise<{ port: number }> {
  const existing = serverStatus(brewId);
  if (existing.running && existing.port !== null) return { port: existing.port };

  const cwd = tapDir(brewId, 1);
  const port = await findFreePort();
  const child = spawn(`npm run dev -- --port ${port} --strictPort`, {
    cwd,
    shell: true,
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true,
  });
  let spawnError: Error | null = null;
  child.once("error", (err) => {
    spawnError = err;
  });

  servers.set(brewId, {
    child,
    pid: child.pid ?? -1,
    port,
    startedAt: new Date().toISOString(),
  });

  for (let i = 0; i < 30; i++) {
    if (spawnError) {
      await stopServer(brewId);
      throw spawnError;
    }
    if (hasExited(child)) {
      await stopServer(brewId);
      throw new Error("devサーバーの起動に失敗しました。");
    }
    if (await respondsOk(port)) return { port };
    await wait(1_000);
  }

  await stopServer(brewId);
  throw new Error("devサーバーが30秒以内に応答しませんでした。build.logと taps/batch-1 を確認してください。");
}

export async function stopServer(brewId: string): Promise<void> {
  const entry = servers.get(brewId);
  if (!entry) return;

  servers.delete(brewId);
  await killProcessTree(entry);
}

export function serverStatus(brewId: string): ServerStatus {
  const entry = servers.get(brewId);
  if (!entry) return { running: false, port: null };
  if (hasExited(entry.child)) {
    servers.delete(brewId);
    return { running: false, port: null };
  }
  return { running: true, port: entry.port };
}
