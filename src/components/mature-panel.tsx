"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { BatchEvaluation, BatchStatus, Brew, MaturationPhase } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { useBrewAction } from "./use-brew-action";
import { blip, confirmSound } from "@/components/ps1/sound";

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

function stars(score: number): string {
  const n = Math.round(score);
  return "★".repeat(Math.min(5, Math.max(0, n))) + "☆".repeat(Math.max(0, 5 - n));
}

export function MaturePanel({
  brew,
  onUpdate,
  refresh,
  onBusyChange,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
  refresh: () => Promise<Brew | void>;
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
        if (selectedRef.current !== null && selectedRef.current !== batch) return;
        setReport({ batch, data: (await res.json()) as Report });
      } catch {
        // 表示用の取得失敗は無視する
      }
    },
    [brew.id],
  );

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
    blip(560);
    setSelected(batch);
    selectedRef.current = batch;
    setReport(null);
    await fetchReport(batch);
  }

  async function post(pathSuffix: string, body?: unknown) {
    confirmSound();
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

  const evaluation = report?.data.evaluation ?? null;

  return (
    <div className="flex flex-col gap-4">
      {brew.maturationProgress && (
        <p className="m-0 text-[#e0a83c]" aria-live="polite">
          {PHASE_LABELS[brew.maturationProgress.phase]}(バッチ{brew.maturationProgress.batch}):{" "}
          {brew.maturationProgress.detail}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {sorted.map((b) => {
          const active = selected === b.number;
          const trend = trendFor(b.number);
          return (
            <button
              key={b.number}
              type="button"
              onClick={() => void selectBatch(b.number)}
              className="min-w-[140px] p-3 text-left font-[inherit]"
              style={{
                background: active ? "#3a2408" : "#0e0804",
                border: `2px solid ${active ? "#f5b94a" : "#3a2a12"}`,
                color: active ? "#ffd88a" : "#ffe9c0",
                cursor: "pointer",
              }}
            >
              <p className="m-0 text-[15px]">
                {active ? "▶ " : ""}バッチ{b.number}
              </p>
              <p className="m-0 text-[13px]" style={{ color: "rgba(255,220,160,.55)" }}>
                {STATUS_LABELS[b.status]}
              </p>
              {b.evaluation ? (
                <p className="mt-1 mb-0 text-[#f5a623]">
                  {b.evaluation.overall.toFixed(1)} / 5.0
                  {trend && (
                    <span
                      className="ml-2 text-[13px]"
                      style={{ color: trend.startsWith("+") ? "#8adc8a" : "#e0a83c" }}
                    >
                      {trend}
                    </span>
                  )}
                </p>
              ) : (
                b.status === "succeeded" && (
                  <p className="mt-1 mb-0 text-[13px]" style={{ color: "rgba(255,220,160,.45)" }}>
                    未評価
                  </p>
                )
              )}
            </button>
          );
        })}
      </div>

      {!working && latest && !latest.evaluation && (
        <button onClick={() => void post("evaluate")} className="ps-btn w-fit">
          ▶ このバッチを評価
        </button>
      )}

      {!working && latest?.evaluation && (
        <button onClick={() => void post("next")} className="ps-btn w-fit">
          ▶ 改善して次のバッチへ(
          {latest.evaluation.strategy === "repair" ? "修正" : "再ビルド"}・指示
          {latest.evaluation.improvements.length}件)
        </button>
      )}

      {!working && latest && (
        <div className="flex flex-wrap items-end gap-3 border-2 border-[#3a2a12] bg-[#0e0804] p-4">
          <label className="text-[13px] text-[#e8c07a]">
            目標スコア
            <input
              value={targetScore}
              onChange={(e) => setTargetScore(e.target.value)}
              className="ps-input mt-1 block w-24"
            />
          </label>
          <label className="text-[13px] text-[#e8c07a]">
            上限バッチ数
            <input
              value={maxBatches}
              onChange={(e) => setMaxBatches(e.target.value)}
              className="ps-input mt-1 block w-24"
            />
          </label>
          <button onClick={startAuto} className="ps-btn-secondary">
            自動で熟成
          </button>
        </div>
      )}

      {working && (
        <button onClick={() => void cancelMaturation()} className="ps-btn-secondary w-fit">
          中断
        </button>
      )}

      {error && (
        <p className="m-0 text-[#ff8a8a]" aria-live="polite">
          {error}
        </p>
      )}

      {selected !== null && report?.batch === selected && (
        <div>
          <h3 className="m-0 text-[17px] font-normal tracking-[2px] text-[#f5b94a]">
            ◆ バッチ{selected} 評価レポート
          </h3>

          <div className="mt-3 flex flex-wrap gap-3">
            {report.data.screenshots.length > 0 ? (
              report.data.screenshots.map((name) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={name}
                  src={`/api/brews/${brew.id}/mature/screenshot?batch=${selected}&name=${name}`}
                  alt={`バッチ${selected} ${name}`}
                  className="max-h-[130px] border-2 border-[#3a2a12]"
                  style={{
                    width: name.includes("mobile") ? 80 : 220,
                    objectFit: "cover",
                    background: "#040201",
                  }}
                />
              ))
            ) : (
              <>
                <div
                  className="border-2 border-[#3a2a12]"
                  style={{
                    width: 220,
                    height: 130,
                    background:
                      "repeating-linear-gradient(-45deg,#0a0603,#0a0603 8px,#150d05 8px,#150d05 16px)",
                  }}
                />
                <div
                  className="border-2 border-[#3a2a12]"
                  style={{
                    width: 80,
                    height: 130,
                    background:
                      "repeating-linear-gradient(-45deg,#0a0603,#0a0603 8px,#150d05 8px,#150d05 16px)",
                  }}
                />
              </>
            )}
          </div>

          {evaluation && (
            <div className="mt-4 flex flex-col gap-2">
              {evaluation.axes.map((s) => (
                <div
                  key={s.name}
                  className="grid items-center gap-3 text-[14px]"
                  style={{ gridTemplateColumns: "190px 120px 1fr" }}
                >
                  <span className="text-[#ffd88a]">{s.name}</span>
                  <span className="tracking-[2px] text-[#f5a623]">{stars(s.score)}</span>
                  <span style={{ color: "rgba(255,220,160,.7)" }}>{s.comment}</span>
                </div>
              ))}
              <p className="mt-2 mb-0 text-[15px] text-[#ffe9c0]">
                総評: {evaluation.summary}
              </p>
            </div>
          )}

          {report.data.markdown ? (
            <article className="prose prose-invert mt-4 max-w-none border-2 border-[#3a2a12] bg-[#040201] p-5">
              <ReactMarkdown>{report.data.markdown}</ReactMarkdown>
            </article>
          ) : (
            !evaluation && (
              <p className="mt-3" style={{ color: "rgba(255,220,160,.45)" }}>
                このバッチはまだ評価されていません。
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}
