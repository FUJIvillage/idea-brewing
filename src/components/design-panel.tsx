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

/**
 * 生成中の経過時間とライブプレビュー。working の間だけマウントされ、
 * アンマウントで状態が破棄されるため、再生成時のリセット用 setState が要らない
 * (エフェクト内の同期 setState は react-hooks/set-state-in-effect で禁止)
 */
function GeneratingView({ brewId, onCancel }: { brewId: string; onCancel: () => void }) {
  const [elapsedSec, setElapsedSec] = useState(0);
  // null = 有効なプレビューフレーム未取得(プレースホルダ表示)
  const [previewTick, setPreviewTick] = useState<number | null>(null);

  useEffect(() => {
    const startedAt = Date.now(); // マウント時点を起点にする(このビューは生成中のみマウントされる)
    const timer = setInterval(() => {
      setElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/brews/${brewId}/design/preview`, { cache: "no-store" });
        if (!cancelled && res.ok) setPreviewTick(Date.now());
      } catch {
        // プレビュー取得失敗はプレースホルダ(または前回フレーム)継続
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [brewId]);

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[#e0a83c]" aria-live="polite">
        モックアップを生成中…(経過 {Math.floor(elapsedSec / 60)}分{elapsedSec % 60}秒)
      </p>
      {previewTick !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/brews/${brewId}/design/preview?t=${previewTick}`}
          alt="デザインモックアップ（生成中プレビュー）"
          className="max-w-full border-2 border-[#3a2a12]"
          style={{ background: "#040201" }}
        />
      ) : (
        <div
          className="flex min-h-[180px] items-center justify-center border-2 border-dashed border-[#3a2a12] bg-[#0e0804] p-6 text-[14px]"
          style={{ color: "rgba(255,220,160,.55)" }}
          aria-live="polite"
        >
          キャンバス準備中…
        </div>
      )}
      <button onClick={onCancel} className="ps-btn-secondary w-fit">
        中断
      </button>
    </div>
  );
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

  function generate() {
    confirmSound();
    void post("generate", instruction.trim() ? { instruction: instruction.trim() } : {});
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[14px]" style={{ color: "rgba(255,220,160,.55)" }}>
        レシピ(画面仕様+デザインシステム)から Pencil で高忠実度モックアップを生成します。
        モックは熟成の評価で「デザイン忠実度」の採点基準になります。
        所要目安は約5分、コストは1回 $2 前後です(モデルによる)。
      </p>

      {working && <GeneratingView brewId={brew.id} onCancel={() => void cancel()} />}

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
