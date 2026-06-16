import { spawn, type ChildProcess } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  output: string;
}

export interface RunOptions {
  cwd: string;
  onLog?: (line: string) => void;
  timeoutMs?: number;
  cancel?: { cancelled: boolean };
}

export interface CommandRunner {
  run(command: string, opts: RunOptions): Promise<CommandResult>;
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    child.kill();
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
    killer.on("error", () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

/**
 * 実コマンド実行。Windows互換のため文字列コマンド+shell実行。
 * command には固定文字列のみ渡すこと(ユーザー入力を混ぜない)。
 */
export const realRunner: CommandRunner = {
  run(command, { cwd, onLog, timeoutMs = 600_000, cancel }) {
    if (cancel?.cancelled) {
      return Promise.resolve({ ok: false, output: "Command cancelled before start." });
    }
    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd,
        shell: true,
        detached: process.platform !== "win32",
      });
      let output = "";
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      const onData = (buf: Buffer) => {
        const text = buf.toString();
        output += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onLog?.(line);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      const timer = setTimeout(() => {
        timedOut = true;
        const message = `Command timed out after ${timeoutMs}ms: ${command}`;
        output += `\n${message}\n`;
        onLog?.(message);
        killProcessTree(child);
      }, timeoutMs);
      const cancelTimer = cancel
        ? setInterval(() => {
            if (!cancel.cancelled || cancelled) return;
            cancelled = true;
            const message = `Command cancelled: ${command}`;
            output += `\n${message}\n`;
            onLog?.(message);
            killProcessTree(child);
          }, 250)
        : null;
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancelTimer) clearInterval(cancelTimer);
        resolve({ ok: !timedOut && !cancelled && code === 0, output });
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (cancelTimer) clearInterval(cancelTimer);
        resolve({ ok: false, output: output + String(err) });
      });
    });
  },
};

export interface FakeRunnerStep {
  ok: boolean;
  output?: string;
}

/** 呼び出しごとに steps を先頭から消費するフェイク。steps が尽きたら成功を返す */
export function createFakeRunner(
  steps: FakeRunnerStep[] = [],
): CommandRunner & { commands: string[] } {
  const commands: string[] = [];
  const queue = [...steps];
  return {
    commands,
    async run(command) {
      commands.push(command);
      const step = queue.shift() ?? { ok: true };
      return { ok: step.ok, output: step.output ?? "" };
    },
  };
}
