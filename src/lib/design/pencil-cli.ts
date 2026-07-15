import { createWriteStream, existsSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { CancelToken } from "@/lib/tap/build-state";

export interface PencilRunResult {
  code: number | null;
  timedOut: boolean;
  cancelled: boolean;
}

/**
 * ローカル node_modules の CLI エントリ(ESM)を返す。
 * .bin の .cmd シムは Windows で shell 必須になるため、node 直接実行で回避する
 */
export function resolvePencilEntry(): string {
  const entry = path.join(
    process.cwd(),
    "node_modules",
    "@pencil.dev",
    "cli",
    "dist",
    "index.mjs",
  );
  if (!existsSync(entry)) {
    throw new Error(
      "Pencil CLI が見つかりません。npm install で @pencil.dev/cli を導入してください。",
    );
  }
  return entry;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Pencil CLI はエージェント実行中に子プロセスを持ちうるため、Windows ではツリーごと止める */
function killTree(child: ChildProcess): void {
  if (hasExited(child)) return;
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
    killer.once("error", () => child.kill());
  } else {
    child.kill("SIGTERM");
  }
}

export interface RunPencilOptions {
  args: string[];
  /** PENCIL_CLI_KEY として子プロセスにのみ渡す(ログには書かない) */
  key: string;
  logPath: string;
  timeoutMs: number;
  token?: CancelToken;
}

/** Pencil CLI を実行し、stdout/stderr を logPath へ書き出す */
export async function runPencil(opts: RunPencilOptions): Promise<PencilRunResult> {
  const entry = resolvePencilEntry();
  const log = createWriteStream(opts.logPath, { flags: "w" });
  const child = spawn(process.execPath, [entry, ...opts.args], {
    env: { ...process.env, PENCIL_CLI_KEY: opts.key },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });

  let timedOut = false;
  let cancelled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killTree(child);
  }, opts.timeoutMs);
  const watcher = setInterval(() => {
    if (opts.token?.cancelled) {
      cancelled = true;
      killTree(child);
    }
  }, 500);

  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (c) => resolve(c));
    });
    return { code, timedOut, cancelled };
  } finally {
    clearTimeout(timer);
    clearInterval(watcher);
    log.end();
  }
}
