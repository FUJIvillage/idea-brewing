"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { BatchEvaluation, BatchStatus, Brew, MaturationPhase } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { useBrewAction } from "./use-brew-action";

const STATUS_LABELS: Record<BatchStatus, string> = {
  building: "ビルド中",
  succeeded: "成功",
  failed: "失敗",
  cancelled: "中断",
};

const PHASE_LABELS: Record<MaturationPhase, string> = {
  screenshotting: "撮影",
  evaluating: "採点",
  planning: "準備",
  building: "ビルド",
};

type Report = {
  markdown: string | null;
  evaluation: BatchEvaluation | null;
  screenshots: string[];
};

export function MaturePanel({
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
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState<{ batch: number; data: Report } | null>(null);
  const [targetScore, setTargetScore] = useState("4.0");
  const [maxBatches, setMaxBatches] = useState("3");

  const selectedRef = useRef<number | null>(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const latest = latestSucceededBatch(brew);
  const running = brew.maturationProgress !== null;
  const {
    busy,
    error,
    setError,
    post: postAction,
    cancel: cancelMaturation,
  } = useBrewAction({ brewId: brew.id, base: "mature", running, onUpdate, refresh, onBusyChange });
  const working = busy || running;

  const fetchReport = useCallback(
    async (batch: number) => {
      try {
        const res = await fetch(`/api/brews/${brew.id}/mature/report?batch=${batch}`);
        if (!res.ok) return;
        // 取得中に別バッチへ切り替わっていたら破棄(未選択=初期表示中はそのまま採用)
        if (selectedRef.current !== null && selectedRef.current !== batch) return;
        setReport({ batch, data: (await res.json()) as Report });
      } catch {
        // 表示用の取得失敗は無視する
      }
    },
    [brew.id],
  );

  // 初期表示: 評価済みの最新成功バッチを選択する
  useEffect(() => {
    if (selected !== null) return;
    if (!latest?.evaluation) return;
    const batch = latest.number;
    let cancelled = false;
    (async () => {
      await fetchReport(batch);
      if (!cancelled) setSelected((cur) => cur ?? batch);
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, latest, fetchReport]);

  async function selectBatch(batch: number) {
    setSelected(batch);
    selectedRef.current = batch;
    setReport(null);
    await fetchReport(batch);
  }

  async function post(pathSuffix: string, body?: unknown) {
    await postAction(pathSuffix, body, async (updated) => {
      if (updated) {
        const latestBatch = latestSucceededBatch(updated);
        if (latestBatch) {
          setSelected(latestBatch.number);
          selectedRef.current = latestBatch.number;
          await fetchReport(latestBatch.number);
        }
      } else {
        const batch = selectedRef.current;
        if (batch !== null) void fetchReport(batch);
      }
    });
  }

  function startAuto() {
    const score = Number(targetScore);
    const max = Number(maxBatches);
    if (Number.isNaN(score) || score < 1 || score > 5) {
      setError("目標スコアは1〜5で指定してください。");
      return;
    }
    if (!Number.isInteger(max) || max < 1 || max > 10) {
      setError("上限バッチ数は1〜10の整数で指定してください。");
      return;
    }
    void post("auto", { targetScore: score, maxBatches: max });
  }

  const sorted = [...brew.batches].sort((a, b) => a.number - b.number);
  const evaluated = sorted.filter((b) => b.evaluation !== null);

  function trendFor(batchNumber: number): string | null {
    const idx = evaluated.findIndex((b) => b.number === batchNumber);
    if (idx <= 0) return null;
    const diff = evaluated[idx].evaluation!.overall - evaluated[idx - 1].evaluation!.overall;
    if (diff === 0) return "±0.0";
    return `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`;
  }

  return (
    <section>
      <h2 className="text-lg font-bold text-amber-100">熟成(自己評価バッチループ)</h2>

      {brew.maturationProgress && (
        <p className="mt-2 text-amber-200" aria-live="polite">
          {PHASE_LABELS[brew.maturationProgress.phase]}(バッチ{brew.maturationProgress.batch}):{" "}
          {brew.maturationProgress.detail}
        </p>
      )}

      {/* バッチ一覧 */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {sorted.map((b) => (
          <button
            key={b.number}
            onClick={() => void selectBatch(b.number)}
            className={`rounded-lg border p-3 text-left ${
              selected === b.number
                ? "border-amber-400 bg-amber-900/40"
                : "border-amber-900/60 bg-black/20 hover:border-amber-600"
            }`}
          >
            <p className="font-bold text-amber-100">バッチ{b.number}</p>
            <p className="text-sm text-amber-300">{STATUS_LABELS[b.status]}</p>
            {b.evaluation ? (
              <p className="mt-1 text-amber-200">
                {b.evaluation.overall.toFixed(1)} / 5.0
                {trendFor(b.number) && (
                  <span className="ml-2 text-sm text-amber-400">{trendFor(b.number)}</span>
                )}
              </p>
            ) : (
              b.status === "succeeded" && <p className="mt-1 text-sm text-amber-200/60">未評価</p>
            )}
          </button>
        ))}
      </div>

      {/* 操作 */}
      {!working && latest && !latest.evaluation && (
        <button
          onClick={() => void post("evaluate")}
          className="mt-4 rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
        >
          このバッチを評価
        </button>
      )}

      {!working && latest?.evaluation && (
        <div className="mt-4 space-y-2">
          <button
            onClick={() => void post("next")}
            className="rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
          >
            改善して次のバッチへ(
            {latest.evaluation.strategy === "repair" ? "修正" : "再ビルド"}・指示
            {latest.evaluation.improvements.length}件)
          </button>
        </div>
      )}

      {!working && latest && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-amber-900/60 bg-black/20 p-4">
          <label className="text-sm text-amber-200">
            目標スコア
            <input
              value={targetScore}
              onChange={(e) => setTargetScore(e.target.value)}
              className="mt-1 block w-24 rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
            />
          </label>
          <label className="text-sm text-amber-200">
            上限バッチ数
            <input
              value={maxBatches}
              onChange={(e) => setMaxBatches(e.target.value)}
              className="mt-1 block w-24 rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
            />
          </label>
          <button
            onClick={startAuto}
            className="rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500"
          >
            自動で熟成
          </button>
        </div>
      )}

      {working && (
        <button
          onClick={() => void cancelMaturation()}
          className="mt-4 rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500"
        >
          中断
        </button>
      )}

      {error && (
        <p className="mt-3 text-red-400" aria-live="polite">
          {error}
        </p>
      )}

      {/* 評価レポート */}
      {selected !== null && report?.batch === selected && (
        <div className="mt-6">
          <h3 className="font-bold text-amber-100">バッチ{selected} 評価レポート</h3>
          {report.data.screenshots.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {report.data.screenshots.map((name) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={name}
                  src={`/api/brews/${brew.id}/mature/screenshot?batch=${selected}&name=${name}`}
                  alt={`バッチ${selected} ${name}`}
                  className="max-h-48 rounded border border-amber-900/60"
                />
              ))}
            </div>
          )}
          {report.data.markdown ? (
            <article className="prose prose-invert mt-4 max-w-none rounded-lg border border-amber-900/40 bg-black/20 p-6">
              <ReactMarkdown>{report.data.markdown}</ReactMarkdown>
            </article>
          ) : (
            <p className="mt-3 text-amber-200/60">このバッチはまだ評価されていません。</p>
          )}
        </div>
      )}
    </section>
  );
}
