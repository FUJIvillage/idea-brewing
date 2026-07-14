"use client";

import { useCallback, useEffect, useState } from "react";
import type { Brew, BuildPhase } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { useBrewAction } from "./use-brew-action";
import { backSound, confirmSound } from "@/components/ps1/sound";

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
  const [resumable, setResumable] = useState(false);
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

  const fetchResumeState = useCallback(async () => {
    try {
      const batch = newest?.number ?? 1;
      const res = await fetch(`/api/brews/${brew.id}/tap/checkpoint?batch=${batch}`);
      if (res.ok) {
        const json = (await res.json()) as { resumable?: boolean };
        setResumable(Boolean(json.resumable));
      } else {
        setResumable(false);
      }
    } catch {
      setResumable(false);
    }
  }, [brew.id, newest?.number]);

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

  useEffect(() => {
    if (newest && (newest.status === "failed" || newest.status === "cancelled")) {
      void fetchResumeState();
    } else {
      setResumable(false);
    }
  }, [newest, fetchResumeState, brew.buildProgress]);

  async function build(mode?: "resume" | "fresh") {
    confirmSound();
    await postAction(
      "build",
      mode ? { mode } : undefined,
      () => {
        void fetchLog();
        void fetchResumeState();
      },
    );
  }

  async function serverAction(action: "start" | "stop") {
    setServerBusy(true);
    onBusyChange(true);
    setError(null);
    if (action === "start") confirmSound();
    else backSound();
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
    <div className="flex flex-col gap-4">
      {brew.buildProgress && (
        <p className="m-0 text-[#e0a83c]" aria-live="polite">
          {PHASE_LABELS[brew.buildProgress.phase]}: {brew.buildProgress.detail}
        </p>
      )}

      {!building && !newest && (
        <button onClick={() => build()} className="ps-btn w-fit">
          ▶ ビルド開始(1stバッチ)
        </button>
      )}

      {building && (
        <button onClick={cancelBuild} className="ps-btn-secondary w-fit">
          ビルド中断
        </button>
      )}

      {!building && !succeeded && newest?.status === "failed" && (
        <div className="flex flex-col gap-2">
          <p className="m-0 text-[#ff8a8a]">ビルド失敗: {newest.error}</p>
          {resumable ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => build("resume")} className="ps-btn">
                ▶ 再開
              </button>
              <button onClick={() => build("fresh")} className="ps-btn-secondary">
                最初から
              </button>
            </div>
          ) : (
            <button onClick={() => build("fresh")} className="ps-btn w-fit">
              ▶ 再ビルド
            </button>
          )}
        </div>
      )}

      {!building && !succeeded && newest?.status === "cancelled" && (
        <div className="flex flex-col gap-2">
          <p className="m-0" style={{ color: "rgba(255,220,160,.55)" }}>
            ビルドは中断されました。
          </p>
          {resumable ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => build("resume")} className="ps-btn">
                ▶ 再開
              </button>
              <button onClick={() => build("fresh")} className="ps-btn-secondary">
                最初から
              </button>
            </div>
          ) : (
            <button onClick={() => build("fresh")} className="ps-btn w-fit">
              ▶ ビルド開始(1stバッチ)
            </button>
          )}
        </div>
      )}

      {!building && succeeded && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[16px] tracking-wide text-[#ffe9c0]">
            ★ バッチ{succeeded.number} 完成(
            {succeeded.finishedAt
              ? `${Math.round((Date.parse(succeeded.finishedAt) - Date.parse(succeeded.startedAt)) / 1000)}秒`
              : "-"}
            )
          </p>
          {server.running && server.port !== null ? (
            <div
              className="flex flex-wrap items-center gap-3 border-2 px-4 py-3"
              style={{ borderColor: "#4a8a4a", background: "rgba(30,80,30,.2)" }}
            >
              <span className="ps-blink inline-block h-2.5 w-2.5 bg-[#8adc8a]" />
              <a
                href={`http://localhost:${server.port}`}
                target="_blank"
                rel="noreferrer"
                className="text-[#8adc8a] underline"
              >
                http://localhost:{server.port}
              </a>
              {server.batch !== null && (
                <span className="text-[13px]" style={{ color: "rgba(255,220,160,.55)" }}>
                  バッチ{server.batch} を提供中
                </span>
              )}
              <button
                onClick={() => serverAction("stop")}
                disabled={busy}
                className="ps-btn-secondary"
              >
                止める
              </button>
            </div>
          ) : (
            <button
              onClick={() => serverAction("start")}
              disabled={busy}
              className="ps-btn w-fit"
            >
              ▶ 注ぐ(サーバー起動)
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="m-0 text-[#ff8a8a]" aria-live="polite">
          {error}
        </p>
      )}

      {logLines.length > 0 && <pre className="ps-terminal m-0">{logLines.join("\n")}</pre>}
    </div>
  );
}
