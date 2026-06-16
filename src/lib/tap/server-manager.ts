import { existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { tapDir } from "@/lib/store";

interface RunningServer {
  child: ChildProcess;
  pid: number;
  port: number;
  startedAt: string;
  readyPromise: Promise<{ port: number }>;
}

export interface ServerStatus {
  running: boolean;
  port: number | null;
}

const servers = new Map<string, RunningServer>();
const startPromises = new Map<string, Promise<{ port: number }>>();

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

function waitForExit(child: ChildProcess, timeoutMs = 5_000): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function killProcessTree(entry: RunningServer): Promise<void> {
  if (hasExited(entry.child)) return;

  if (process.platform === "win32") {
    const taskkillCode = await new Promise<number | null>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(entry.pid), "/T", "/F"], {
        windowsHide: true,
      });
      let settled = false;
      const done = (code: number | null) => {
        if (settled) return;
        settled = true;
        resolve(code);
      };
      killer.once("error", () => {
        entry.child.kill();
        done(null);
      });
      killer.once("close", done);
    });
    const exited = await waitForExit(entry.child);
    if (!exited) {
      entry.child.kill();
      throw new Error(`devサーバーの停止に失敗しました(taskkill=${taskkillCode ?? "error"})。`);
    }
    return;
  } else {
    try {
      process.kill(-entry.pid, "SIGTERM");
    } catch {
      entry.child.kill("SIGTERM");
    }
  }

  const exited = await waitForExit(entry.child);
  if (!exited) throw new Error("devサーバーの停止に失敗しました。");
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
  const existing = servers.get(brewId);
  if (existing && !hasExited(existing.child)) return existing.readyPromise;
  if (existing) servers.delete(brewId);

  const starting = startPromises.get(brewId);
  if (starting) return starting;

  const promise = startFreshServer(brewId);
  startPromises.set(brewId, promise);
  try {
    return await promise;
  } finally {
    if (startPromises.get(brewId) === promise) startPromises.delete(brewId);
  }
}

async function startFreshServer(brewId: string): Promise<{ port: number }> {
  const cwd = tapDir(brewId, 1);
  const port = await findFreePort();
  const command = existsSync(path.join(cwd, "server.js"))
    ? `node server.js --port ${port}`
    : `npx vite --host 127.0.0.1 --port ${port} --strictPort`;
  const child = spawn(command, {
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

  const entry: RunningServer = {
    child,
    pid: child.pid ?? -1,
    port,
    startedAt: new Date().toISOString(),
    readyPromise: Promise.resolve({ port }),
  };
  entry.readyPromise = (async () => {
    for (let i = 0; i < 30; i++) {
      if (spawnError) {
        await stopEntryIfCurrent(brewId, entry);
        throw spawnError;
      }
      if (hasExited(child)) {
        await stopEntryIfCurrent(brewId, entry);
        throw new Error("devサーバーの起動に失敗しました。");
      }
      if ((await respondsOk(port)) && !hasExited(child)) return { port };
      await wait(1_000);
    }
    await stopEntryIfCurrent(brewId, entry);
    throw new Error(
      "devサーバーが30秒以内に応答しませんでした。build.logと taps/batch-1 を確認してください。",
    );
  })();

  servers.set(brewId, entry);
  child.once("close", () => {
    if (servers.get(brewId) === entry) servers.delete(brewId);
  });
  return entry.readyPromise;
}

async function stopEntryIfCurrent(brewId: string, entry: RunningServer): Promise<void> {
  await killProcessTree(entry);
  if (servers.get(brewId) === entry) servers.delete(brewId);
}

export async function stopServer(brewId: string): Promise<void> {
  const entry = servers.get(brewId);
  if (!entry) return;

  await stopEntryIfCurrent(brewId, entry);
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
