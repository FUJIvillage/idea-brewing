import { promises as fs } from "node:fs";
import path from "node:path";
import type { BuildEngine, BuildSession } from "./engine";

export interface FakeBuildEngineOptions {
  /** 先頭から指定回数だけ send を失敗させる */
  failSends?: number;
  /** 各 send 完了後に呼ばれる(中断テスト用) */
  afterSend?: (count: number) => Promise<void> | void;
}

/** SDKを呼ばない決定論的エンジン。プロンプトを記録し、cwd に痕跡ファイルを書く */
export function createFakeBuildEngine(
  opts?: FakeBuildEngineOptions,
): BuildEngine & { prompts: string[] } {
  const prompts: string[] = [];
  let remainingFailures = opts?.failSends ?? 0;
  return {
    prompts,
    async createSession({ cwd, onLog }) {
      const session: BuildSession = {
        async send(prompt: string) {
          prompts.push(prompt);
          onLog(`[fake-engine] send: ${prompt.slice(0, 60)}`);
          await fs.appendFile(path.join(cwd, "agent-log.txt"), prompt + "\n---\n", "utf8");
          await opts?.afterSend?.(prompts.length);
          if (remainingFailures > 0) {
            remainingFailures--;
            return { ok: false, summary: "fake failure" };
          }
          return { ok: true, summary: "fake done" };
        },
        async cancel() {},
        async dispose() {},
      };
      return session;
    },
  };
}
