"use client";

import { useEffect, useState } from "react";
import { MAX_PUB_GUESTS } from "@/lib/pub/constants";
import type { Brew, PubPhase, SavedPersona } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { useBrewAction } from "./use-brew-action";
import { confirmSound } from "@/components/ps1/sound";
import { PubBarScene } from "@/components/pub/pub-bar-scene";
import { PubReportView } from "@/components/pub/pub-report-view";

const PHASE_LABELS: Record<PubPhase, string> = {
  opening: "開店準備",
  serving: "接客中",
  closing: "閉店作業",
};

type ReportResponse = {
  markdown: string | null;
  report: unknown;
  screenshots: string[];
};

type ErrorBody = { error?: string };

export function PubPanel({
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
  const [autoCount, setAutoCount] = useState("3");
  const [personas, setPersonas] = useState<SavedPersona[]>([]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [newProfile, setNewProfile] = useState("");
  const [newGoals, setNewGoals] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [screenshots, setScreenshots] = useState<{ batch: number; names: string[] } | null>(null);

  const latest = latestSucceededBatch(brew);
  const running = brew.pubProgress !== null;
  const {
    busy,
    error,
    setError,
    post: postAction,
    cancel: cancelPub,
  } = useBrewAction({ brewId: brew.id, base: "pub", running, onUpdate, refresh, onBusyChange });
  const working = busy || running;
  const pubBatches = brew.batches
    .filter((b) => b.pub !== null)
    .sort((a, b) => a.number - b.number);
  const auto = Number(autoCount);
  const total = (Number.isInteger(auto) ? auto : NaN) + checkedIds.length;
  const totalValid =
    Number.isInteger(auto) &&
    auto >= 0 &&
    auto <= MAX_PUB_GUESTS &&
    total >= 1 &&
    total <= MAX_PUB_GUESTS;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/personas");
        if (!cancelled && res.ok) setPersonas((await res.json()) as SavedPersona[]);
      } catch {
        // 表示用の取得失敗は無視する
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const latestPubNumber = pubBatches.length > 0 ? pubBatches[pubBatches.length - 1].number : null;
  const shownBatch = selected ?? latestPubNumber;
  const report =
    shownBatch !== null ? (brew.batches.find((b) => b.number === shownBatch)?.pub ?? null) : null;

  const reportRanAt = report?.ranAt ?? null;
  useEffect(() => {
    if (shownBatch === null || reportRanAt === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/brews/${brew.id}/pub/report?batch=${shownBatch}`);
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as ReportResponse;
        setScreenshots({ batch: shownBatch, names: json.screenshots });
      } catch {
        // 表示用の取得失敗は無視する
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shownBatch, brew.id, reportRanAt]);

  async function savePersonas(next: SavedPersona[]): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch("/api/personas", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = (await res.json()) as SavedPersona[] | ErrorBody;
      if (!res.ok) {
        throw new Error(
          !Array.isArray(json) && json.error ? json.error : "エラーが発生しました。",
        );
      }
      const saved = json as SavedPersona[];
      setPersonas(saved);
      setCheckedIds((ids) => ids.filter((id) => saved.some((p) => p.id === id)));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function addPersona() {
    const goals = newGoals
      .split("\n")
      .map((g) => g.trim())
      .filter((g) => g !== "");
    const ok = await savePersonas([
      ...personas,
      { id: "", name: newName, profile: newProfile, goals },
    ]);
    if (ok) {
      setNewName("");
      setNewProfile("");
      setNewGoals("");
      confirmSound();
    }
  }

  async function openPub() {
    confirmSound();
    await postAction("run", { autoCount: auto, savedPersonaIds: checkedIds }, (updated) => {
      if (!updated) return;
      const latestPub = [...updated.batches].reverse().find((b) => b.pub !== null);
      if (latestPub) setSelected(latestPub.number);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {brew.pubProgress && (
        <div className="flex flex-col gap-3">
          <PubBarScene result={null} sign={null} />
          <p className="m-0 text-[#e0a83c]" aria-live="polite">
            {PHASE_LABELS[brew.pubProgress.phase]}(バッチ{brew.pubProgress.batch}):{" "}
            {brew.pubProgress.detail}
          </p>
        </div>
      )}

      {!working && latest && (
        <div className="border-2 border-[#3a2a12] bg-[#0e0804] p-4">
          <p className="m-0 text-[13px] text-[#e0a83c]">
            対象: バッチ{latest.number}(最新の成功バッチ)
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-[13px] text-[#e8c07a]">
              自動生成の人数
              <input
                value={autoCount}
                onChange={(e) => setAutoCount(e.target.value)}
                className="ps-input mt-1 block w-24"
              />
            </label>
            <button
              onClick={() => void openPub()}
              disabled={!totalValid}
              className="ps-btn"
            >
              ▶ 開店する
            </button>
            <p className="m-0 text-[13px]" style={{ color: "rgba(255,220,160,.45)" }}>
              合計 {Number.isNaN(total) ? "-" : total} 人(1〜{MAX_PUB_GUESTS})
            </p>
          </div>
          {personas.length > 0 && (
            <div className="mt-3">
              <p className="m-0 text-[13px] text-[#e8c07a]">参加する常連客</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {personas.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-1.5 text-[14px] text-[#ffe9c0]"
                  >
                    <input
                      type="checkbox"
                      checked={checkedIds.includes(p.id)}
                      style={{ accentColor: "#f5a623" }}
                      onChange={(e) =>
                        setCheckedIds((ids) =>
                          e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!working && (
        <details className="border-2 border-[#3a2a12] bg-[#0e0804] p-4">
          <summary className="cursor-pointer text-[15px] tracking-wide text-[#f5b94a]">
            ◆ 常連客の管理
          </summary>
          {personas.length > 0 && (
            <ul className="mt-3 list-none space-y-2 p-0">
              {personas.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 text-[14px]">
                  <span className="text-[#ffe9c0]">
                    <span className="text-[#ffd88a]">{p.name}</span> — {p.profile}
                    <span
                      className="block"
                      style={{ color: "rgba(255,220,160,.45)" }}
                    >
                      目的: {p.goals.join(" / ")}
                    </span>
                  </span>
                  <button
                    onClick={() => void savePersonas(personas.filter((x) => x.id !== p.id))}
                    className="ps-btn-secondary shrink-0 px-2 py-1 text-[13px]"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-[13px] text-[#e8c07a]">
              名前
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="ps-input mt-1 block w-full"
              />
            </label>
            <label className="text-[13px] text-[#e8c07a]">
              プロフィール
              <input
                value={newProfile}
                onChange={(e) => setNewProfile(e.target.value)}
                className="ps-input mt-1 block w-full"
              />
            </label>
            <label className="text-[13px] text-[#e8c07a] sm:col-span-2">
              目的(1行に1件)
              <textarea
                value={newGoals}
                onChange={(e) => setNewGoals(e.target.value)}
                rows={2}
                className="ps-input mt-1 block w-full"
              />
            </label>
          </div>
          <button onClick={() => void addPersona()} className="ps-btn-secondary mt-2">
            常連客を追加
          </button>
        </details>
      )}

      {working && (
        <button onClick={() => void cancelPub()} className="ps-btn-secondary w-fit">
          中断
        </button>
      )}

      {error && (
        <p className="m-0 text-[#ff8a8a]" aria-live="polite">
          {error}
        </p>
      )}

      {pubBatches.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {pubBatches.map((b) => (
            <button
              key={b.number}
              type="button"
              onClick={() => setSelected(b.number)}
              className="ps-select-item w-auto"
              data-active={shownBatch === b.number ? "true" : "false"}
            >
              {shownBatch === b.number ? "▶ " : "・ "}
              バッチ{b.number}
            </button>
          ))}
        </div>
      )}

      {report && shownBatch !== null && (
        <PubReportView
          key={shownBatch}
          report={report}
          batch={shownBatch}
          brewId={brew.id}
          screenshots={screenshots}
        />
      )}
    </div>
  );
}
