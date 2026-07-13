import type { BuildEngine, BuildSession } from "./engine";

export interface CursorEngineOptions {
  apiKey: string;
  model: string;
  /** Cursor モデルの effort パラメータ。空なら未指定 */
  effort?: string;
  /** Cursor モデルの fast パラメータ ("true" | "false")。空なら未指定 */
  fast?: string;
}

export interface CursorModelSelection {
  id: string;
  params?: Array<{ id: string; value: string }>;
}

export interface CursorModelParams {
  effort?: string;
  fast?: string;
}

/** 設定のモデル名と params から Cursor SDK の model 指定を組み立てる */
export function buildCursorModelSelection(
  model: string,
  params: CursorModelParams = {},
): CursorModelSelection {
  const id = model.trim() || "composer-2.5";
  const selectionParams: Array<{ id: string; value: string }> = [];
  const effortValue = params.effort?.trim() ?? "";
  const fastValue = params.fast?.trim() ?? "";
  if (effortValue) selectionParams.push({ id: "effort", value: effortValue });
  if (fastValue === "true" || fastValue === "false") {
    selectionParams.push({ id: "fast", value: fastValue });
  }
  if (selectionParams.length === 0) return { id };
  return { id, params: selectionParams };
}

interface CursorAgentErrorLike extends Error {
  isRetryable?: boolean;
}

interface CursorTextBlock {
  type: string;
  text?: string;
}

interface CursorRun {
  id: string;
  supports(capability: string): boolean;
  unsupportedReason(capability: string): string | undefined;
  stream(): AsyncIterable<{
    type: string;
    message: { content: CursorTextBlock[] };
  }>;
  wait(): Promise<{ status: string; result?: string }>;
  cancel(): Promise<void>;
}

interface CursorAgent {
  send(prompt: string): Promise<CursorRun>;
  [Symbol.asyncDispose](): Promise<void>;
}

interface CursorSdkModule {
  Agent: {
    create(opts: {
      apiKey: string;
      model: CursorModelSelection;
      local: { cwd: string };
    }): Promise<CursorAgent>;
  };
}

async function loadCursorSdk(): Promise<CursorSdkModule> {
  // serverExternalPackages で外部化しているので、静的指定子でも実行時の Node require に解決される
  // (動的な指定子だと Turbopack が「expression is too dynamic」で解決できない)
  return import("@cursor/sdk") as unknown as Promise<CursorSdkModule>;
}

function isCursorAgentError(err: unknown): err is CursorAgentErrorLike {
  return err instanceof Error && "isRetryable" in err;
}

function retryableLabel(err: CursorAgentErrorLike): string {
  return String(err.isRetryable);
}

function cursorStartupError(err: CursorAgentErrorLike): Error {
  return new Error(`エージェント起動失敗: ${err.message} (retryable=${retryableLabel(err)})`);
}

/** @cursor/sdk によるビルドエンジン。1セッション = 1エージェント(コンテキスト維持) */
export function createCursorEngine(opts: CursorEngineOptions): BuildEngine {
  return {
    async createSession({ cwd, onLog }) {
      const { Agent } = await loadCursorSdk();
      let agent: CursorAgent;
      try {
        agent = await Agent.create({
          apiKey: opts.apiKey,
          model: buildCursorModelSelection(opts.model, {
            effort: opts.effort ?? "",
            fast: opts.fast ?? "",
          }),
          local: { cwd },
        });
      } catch (err) {
        if (isCursorAgentError(err)) throw cursorStartupError(err);
        throw err;
      }

      let currentRun: CursorRun | null = null;
      let pendingCancel = false;

      const cancelRun = async (run: CursorRun) => {
        if (run.supports("cancel")) await run.cancel();
      };

      const session: BuildSession = {
        async send(prompt) {
          let run: CursorRun | null = null;
          try {
            run = await agent.send(prompt);
            currentRun = run;
            onLog(`[cursor] run開始: ${run.id}`);
            if (pendingCancel) {
              pendingCancel = false;
              const runId = run.id;
              await cancelRun(run).catch((err) => {
                onLog(
                  `[cursor] cancel失敗 (run: ${runId}): ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
            }

            if (run.supports("stream")) {
              for await (const event of run.stream()) {
                if (event.type !== "assistant") continue;
                for (const block of event.message.content) {
                  if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
                    onLog(block.text);
                  }
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
            if (isCursorAgentError(err)) {
              if (run === null) {
                return {
                  ok: false,
                  summary: `エージェント起動失敗: ${err.message} (retryable=${retryableLabel(err)})`,
                };
              }
              return {
                ok: false,
                summary: `エージェント通信失敗 (run: ${run.id}): ${err.message} (retryable=${retryableLabel(err)})`,
              };
            }
            throw err;
          } finally {
            if (currentRun === run) currentRun = null;
          }
        },
        async cancel() {
          const run = currentRun;
          if (run) {
            await cancelRun(run);
            return;
          }
          // agent.send() の解決前にキャンセル要求が来た場合、run 作成直後に反映する。
          pendingCancel = true;
        },
        async dispose() {
          await agent[Symbol.asyncDispose]();
        },
      };
      return session;
    },
  };
}
