"use client";

import { useCallback, useEffect, useState } from "react";
import type { Brew, BuildPhase } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { useBrewAction } from "./use-brew-action";

const PHASE_LABELS: Record<BuildPhase, string> = {
  preparing: "準備",
  generating: "生成",
  verifying: "検証",
  repairing: "修理",
};

type ServerState = {
  running: boolean;
  port: number | null;
  batch: number | null;
};

type ErrorBody = {
  error?: string;
};

export function TapPanel({
  brew,
  onUpdate,
  refresh,
  onBusyChange,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
  refresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [serverBusy, setServerBusy] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [server, setServer] = useState<ServerState>({
    running: false,
    port: null,
    batch: null,
  });

  const newest =
    brew.batches.length > 0
      ? brew.batches.reduce((a, b) => (b.number > a.number ? b : a))
      : null;
  const succeeded = latestSucceededBatch(brew);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/brews/${brew.id}/tap/log`);
      if (res.ok) {
        const json = (await res.json()) as { lines?: string[] };
        setLogLines(json.lines ?? []);
      }
    } catch {
      // 表示用の取得失敗は無視する
    }
  }, [brew.id]);

  const onTick = useCallback(() => void fetchLog(), [fetchLog]);
  const {
    busy: buildBusy,
    error,
    setError,
    post: postAction,
    cancel: cancelBuild,
  } = useBrewAction({
    brewId: brew.id,
    base: "tap",
    running: brew.buildProgress !== null,
    onUpdate,
    refresh,
    onBusyChange,
    onTick,
  });
  const busy = buildBusy || serverBusy;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [serverRes, logRes] = await Promise.all([
          fetch(`/api/brews/${brew.id}/tap/server`),
          fetch(`/api/brews/${brew.id}/tap/log`),
        ]);
        if (cancelled) return;
        if (serverRes.ok) setServer((await serverRes.json()) as ServerState);
        if (logRes.ok) {
          const json = (await logRes.json()) as { lines?: string[] };
          setLogLines(json.lines ?? []);
        }
      } catch {
        // 表示用の取得失敗は無視する
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brew.id]);

  async function build() {
    await postAction("build", undefined, () => void fetchLog());
  }

  async function serverAction(action: "start" | "stop") {
    setServerBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/tap/server`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as ServerState | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      setServer(json as ServerState);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setServerBusy(false);
      onBusyChange(false);
    }
  }

  const building = buildBusy || brew.buildProgress !== null;

  return (
    <section>
      <h2 className="text-lg font-bold text-amber-100">タップ</h2>

      {brew.buildProgress && (
        <p className="mt-2 text-amber-200" aria-live="polite">
          {PHASE_LABELS[brew.buildProgress.phase]}: {brew.buildProgress.detail}
        </p>
      )}

      {!building && !newest && (
        <button
          onClick={build}
          className="mt-4 rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
        >
          ビルド開始(1stバッチ)
        </button>
      )}

      {building && (
        <button
          onClick={cancelBuild}
          className="mt-4 rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500"
        >
          ビルド中断
        </button>
      )}

      {!building && !succeeded && newest?.status === "failed" && (
        <div className="mt-4">
          <p className="text-red-400">ビルド失敗: {newest.error}</p>
          <button
            onClick={build}
            className="mt-2 rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
          >
            再ビルド
          </button>
        </div>
      )}

      {!building && !succeeded && newest?.status === "cancelled" && (
        <div className="mt-4">
          <p className="text-amber-200/70">ビルドは中断されました。</p>
          <button
            onClick={build}
            className="mt-2 rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
          >
            ビルド開始(1stバッチ)
          </button>
        </div>
      )}

      {!building && succeeded && (
        <div className="mt-4 space-y-3">
          <p className="text-amber-200">
            バッチ{succeeded.number} 完成(
            {succeeded.finishedAt
              ? `${Math.round((Date.parse(succeeded.finishedAt) - Date.parse(succeeded.startedAt)) / 1000)}秒`
              : "-"}
            )
          </p>
          {server.running && server.port !== null ? (
            <div className="flex items-center gap-3">
              <a
                href={`http://localhost:${server.port}`}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-amber-300 underline"
              >
                http://localhost:{server.port}
              </a>
              {server.batch !== null && (
                <span className="text-sm text-amber-200/70">バッチ{server.batch} を提供中</span>
              )}
              <button
                onClick={() => serverAction("stop")}
                disabled={busy}
                className="rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500 disabled:opacity-50"
              >
                止める
              </button>
            </div>
          ) : (
            <button
              onClick={() => serverAction("start")}
              disabled={busy}
              className="rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500 disabled:opacity-50"
            >
              注ぐ(サーバー起動)
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-red-400" aria-live="polite">
          {error}
        </p>
      )}

      {logLines.length > 0 && (
        <pre className="mt-4 max-h-64 overflow-auto rounded border border-amber-900/60 bg-black/40 p-3 text-xs text-amber-100/80">
          {logLines.join("\n")}
        </pre>
      )}
    </section>
  );
}
