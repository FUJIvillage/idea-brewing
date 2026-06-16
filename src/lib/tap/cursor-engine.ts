import { Agent, CursorAgentError, type Run } from "@cursor/sdk";
import type { BuildEngine, BuildSession } from "./engine";

export interface CursorEngineOptions {
  apiKey: string;
  model: string;
}

function cursorStartupError(err: CursorAgentError): Error {
  return new Error(`エージェント起動失敗: ${err.message} (retryable=${err.isRetryable})`);
}

/** @cursor/sdk によるビルドエンジン。1セッション = 1エージェント(コンテキスト維持) */
export function createCursorEngine(opts: CursorEngineOptions): BuildEngine {
  return {
    async createSession({ cwd, onLog }) {
      let agent: Awaited<ReturnType<typeof Agent.create>>;
      try {
        agent = await Agent.create({
          apiKey: opts.apiKey,
          model: { id: opts.model },
          local: { cwd },
        });
      } catch (err) {
        if (err instanceof CursorAgentError) throw cursorStartupError(err);
        throw err;
      }

      let currentRun: Run | null = null;

      const session: BuildSession = {
        async send(prompt) {
          let run: Run | null = null;
          try {
            run = await agent.send(prompt);
            currentRun = run;
            onLog(`[cursor] run開始: ${run.id}`);

            if (run.supports("stream")) {
              for await (const event of run.stream()) {
                if (event.type !== "assistant") continue;
                for (const block of event.message.content) {
                  if (block.type === "text" && block.text.trim()) onLog(block.text);
                }
              }
            } else {
              onLog(`[cursor] stream未対応: ${run.unsupportedReason("stream") ?? "unknown"}`);
            }

            const result = await run.wait();
            if (result.status === "error") {
              return { ok: false, summary: `エージェント実行失敗 (run: ${run.id})` };
            }
            if (result.status === "cancelled") {
              return { ok: false, summary: "中断されました" };
            }
            return { ok: true, summary: result.result ?? "" };
          } catch (err) {
            if (err instanceof CursorAgentError) {
              if (run === null) {
                return {
                  ok: false,
                  summary: `エージェント起動失敗: ${err.message} (retryable=${err.isRetryable})`,
                };
              }
              return {
                ok: false,
                summary: `エージェント通信失敗 (run: ${run.id}): ${err.message}`,
              };
            }
            throw err;
          } finally {
            currentRun = null;
          }
        },
        async cancel() {
          const run = currentRun;
          if (run?.supports("cancel")) await run.cancel();
        },
        async dispose() {
          await agent[Symbol.asyncDispose]();
        },
      };
      return session;
    },
  };
}
