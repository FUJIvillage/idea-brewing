import { createWriteStream, existsSync, promises as fs } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { CancelToken } from "@/lib/tap/build-state";
import {
  PREVIEW_HOME_DIR,
  PREVIEW_PNG,
  PREVIEW_SRC_PEN,
  buildPreviewExportArgs,
  isValidPreviewPngSize,
} from "./preview";

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
  /** PENCIL_AGENT_API_KEY(下位エージェント用)。空なら渡さない */
  agentApiKey?: string;
  logPath: string;
  timeoutMs: number;
  token?: CancelToken;
}

/** Pencil CLI を実行し、stdout/stderr を logPath へ書き出す */
export async function runPencil(opts: RunPencilOptions): Promise<PencilRunResult> {
  const entry = resolvePencilEntry();
  const log = createWriteStream(opts.logPath, { flags: "w" });
  const env: NodeJS.ProcessEnv = { ...process.env, PENCIL_CLI_KEY: opts.key };
  const agentKey = opts.agentApiKey?.trim();
  if (agentKey) env.PENCIL_AGENT_API_KEY = agentKey;
  const child = spawn(process.execPath, [entry, ...opts.args], {
    env,
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

/**
 * 隔離 HOME で mock.pen を PNG エクスポートする（エージェントなし）。
 * 本体プロセスとソケットが衝突しないよう designDir/.preview-home を HOME にする。
 * 成功時 true。失敗しても例外は投げない呼び出し側向けに boolean を返す。
 */
export async function exportPencilPreview(opts: {
  designDir: string;
  key: string;
}): Promise<boolean> {
  const penPath = path.join(opts.designDir, "mock.pen");
  if (!existsSync(penPath)) return false;

  const srcPath = path.join(opts.designDir, PREVIEW_SRC_PEN);
  const outPath = path.join(opts.designDir, PREVIEW_PNG);
  const tmpPath = `${outPath}.tmp`;
  const home = path.join(opts.designDir, PREVIEW_HOME_DIR);

  try {
    await fs.mkdir(home, { recursive: true });
    await fs.copyFile(penPath, srcPath);
    const entry = resolvePencilEntry();
    const args = buildPreviewExportArgs({ penPath: srcPath, outPath: tmpPath });
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [entry, ...args], {
        env: { ...process.env, HOME: home, PENCIL_CLI_KEY: opts.key },
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("close", (c) => resolve(c));
    });
    if (code !== 0 || !existsSync(tmpPath)) {
      await fs.unlink(tmpPath).catch(() => undefined);
      return false;
    }
    const { size } = await fs.stat(tmpPath);
    if (!isValidPreviewPngSize(size)) {
      await fs.unlink(tmpPath).catch(() => undefined);
      return false;
    }
    await fs.rename(tmpPath, outPath);
    return true;
  } catch {
    await fs.unlink(tmpPath).catch(() => undefined);
    return false;
  }
}

export interface StartPreviewLoopOptions {
  designDir: string;
  key: string;
  intervalMs: number;
  token?: CancelToken;
  /** テスト用: 実 CLI の代わり */
  exportOnce?: () => Promise<boolean>;
}

/** 周期的にプレビュー PNG を更新する。戻り値の stop() で止める */
export function startPreviewLoop(opts: StartPreviewLoopOptions): () => void {
  let stopped = false;
  let inFlight = false;
  const exportOnce =
    opts.exportOnce ??
    (() => exportPencilPreview({ designDir: opts.designDir, key: opts.key }));

  const tick = async () => {
    if (stopped || opts.token?.cancelled || inFlight) return;
    inFlight = true;
    try {
      await exportOnce();
    } catch {
      // プレビュー失敗は生成本体に影響させない
    } finally {
      inFlight = false;
    }
  };

  // 初回は少し待ってから（mock.pen 作成待ち）
  const first = setTimeout(() => void tick(), Math.min(3_000, opts.intervalMs));
  const timer = setInterval(() => void tick(), opts.intervalMs);

  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(timer);
  };
}
