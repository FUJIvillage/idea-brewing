import { spawn } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  output: string;
}

export interface RunOptions {
  cwd: string;
  onLog?: (line: string) => void;
  timeoutMs?: number;
}

export interface CommandRunner {
  run(command: string, opts: RunOptions): Promise<CommandResult>;
}

/**
 * 実コマンド実行。Windows互換のため文字列コマンド+shell実行。
 * command には固定文字列のみ渡すこと(ユーザー入力を混ぜない)。
 */
export const realRunner: CommandRunner = {
  run(command, { cwd, onLog, timeoutMs = 600_000 }) {
    return new Promise((resolve) => {
      const child = spawn(command, { cwd, shell: true });
      let output = "";
      const onData = (buf: Buffer) => {
        const text = buf.toString();
        output += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onLog?.(line);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, output });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
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
