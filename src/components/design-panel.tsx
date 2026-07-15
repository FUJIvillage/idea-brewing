"use client";

import { useEffect, useState } from "react";
import type { Brew } from "@/lib/store/types";
import { confirmSound } from "@/components/ps1/sound";
import { useBrewAction } from "./use-brew-action";

function formatCost(costUsd: number | null): string {
  return costUsd === null ? "不明" : `$${costUsd.toFixed(2)}`;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "不明";
  const sec = Math.round(durationMs / 1000);
  return sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`;
}

export function DesignPanel({
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
  const [instruction, setInstruction] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);

  const mock = brew.designMock;
  const running = mock?.status === "generating";
  const { busy, error, post, cancel } = useBrewAction({
    brewId: brew.id,
    base: "design",
    running,
    onUpdate,
    refresh,
    onBusyChange,
  });
  const working = busy || running;

  useEffect(() => {
    if (!working) return;
    const startedAt = Date.now() - elapsedSec * 1000;
    const timer = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
    // 経過タイマーは working の切り替わり時だけ再作成する(elapsedSec 依存にすると毎秒作り直しになる)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  function generate() {
    confirmSound();
    setElapsedSec(0);
    void post("generate", instruction.trim() ? { instruction: instruction.trim() } : {});
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[14px]" style={{ color: "rgba(255,220,160,.55)" }}>
        レシピ(画面仕様+デザインシステム)から Pencil で高忠実度モックアップを生成します。
        モックは熟成の評価で「デザイン忠実度」の採点基準になります。
        所要目安は約5分、コストは1回 $2 前後です(モデルによる)。
      </p>

      {working && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[#e0a83c]" aria-live="polite">
            モックアップを生成中…(経過 {Math.floor(elapsedSec / 60)}分{elapsedSec % 60}秒)
          </p>
          <button onClick={() => void cancel()} className="ps-btn-secondary w-fit">
            中断
          </button>
        </div>
      )}

      {!working && mock?.status === "succeeded" && (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/brews/${brew.id}/design/mock?t=${encodeURIComponent(mock.generatedAt ?? "")}`}
            alt="デザインモックアップ"
            className="max-w-full border-2 border-[#3a2a12]"
            style={{ background: "#040201" }}
          />
          <p className="m-0 text-[13px]" style={{ color: "rgba(255,220,160,.55)" }}>
            生成日時: {mock.generatedAt ? new Date(mock.generatedAt).toLocaleString() : "不明"} /
            モデル: {mock.model || "不明"} / コスト: {formatCost(mock.costUsd)} / 所要:{" "}
            {formatDuration(mock.durationMs)}
          </p>
          <div className="flex flex-wrap items-end gap-3 border-2 border-[#3a2a12] bg-[#0e0804] p-4">
            <label className="grow text-[13px] text-[#e8c07a]">
              追加指示(任意)
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例: 左上の不要な要素を消して / ダークテーマにして"
                className="ps-input mt-1 block w-full"
              />
            </label>
            <button onClick={generate} className="ps-btn-secondary">
              ▶ 再生成
            </button>
          </div>
        </div>
      )}

      {!working && mock?.status !== "succeeded" && (
        <div className="flex flex-col gap-3">
          {mock?.status === "failed" && (
            <pre
              className="m-0 max-h-[200px] overflow-auto whitespace-pre-wrap border-2 border-[#3a2a12] bg-[#040201] p-3 text-[13px] text-[#ff8a8a]"
            >
              {mock.error ?? "生成に失敗しました。"}
            </pre>
          )}
          {mock?.status === "cancelled" && (
            <p className="m-0" style={{ color: "rgba(255,220,160,.55)" }}>
              前回の生成は中断されました。
            </p>
          )}
          <button onClick={generate} className="ps-btn w-fit">
            {mock?.status === "failed" ? "▶ 再試行" : "▶ モックを生成"}
          </button>
        </div>
      )}

      {error && (
        <p className="m-0 text-[#ff8a8a]" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
