"use client";

import { useEffect, useState } from "react";
import type { Brew, PubPhase, SavedPersona } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { useBrewAction } from "./use-brew-action";

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
  const totalValid = Number.isInteger(auto) && auto >= 0 && auto <= 5 && total >= 1 && total <= 5;

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

  // 未選択のときは Pub 済みの最新バッチを表示する(導出値。effect での初期化はしない)
  const latestPubNumber = pubBatches.length > 0 ? pubBatches[pubBatches.length - 1].number : null;
  const shownBatch = selected ?? latestPubNumber;
  const report =
    shownBatch !== null ? (brew.batches.find((b) => b.number === shownBatch)?.pub ?? null) : null;

  // 表示バッチのスクリーンショット一覧を取得する。
  // 依存はレポートの実施日時(brew.updatedAt だと実行中の1秒ポーリングごとに再取得してしまう)
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
    }
  }

  async function openPub() {
    await postAction("run", { autoCount: auto, savedPersonaIds: checkedIds }, (updated) => {
      if (!updated) return;
      const latestPub = [...updated.batches].reverse().find((b) => b.pub !== null);
      if (latestPub) setSelected(latestPub.number);
    });
  }

  return (
    <section>
      <h2 className="text-lg font-bold text-amber-100">Pub(AIユーザーテスト)</h2>

      {brew.pubProgress && (
        <p className="mt-2 text-amber-200" aria-live="polite">
          {PHASE_LABELS[brew.pubProgress.phase]}(バッチ{brew.pubProgress.batch}):{" "}
          {brew.pubProgress.detail}
        </p>
      )}

      {/* 開店フォーム */}
      {!working && latest && (
        <div className="mt-4 rounded-lg border border-amber-900/60 bg-black/20 p-4">
          <p className="text-sm text-amber-300">対象: バッチ{latest.number}(最新の成功バッチ)</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-amber-200">
              自動生成の人数
              <input
                value={autoCount}
                onChange={(e) => setAutoCount(e.target.value)}
                className="mt-1 block w-24 rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
              />
            </label>
            <button
              onClick={() => void openPub()}
              disabled={!totalValid}
              className="rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500 disabled:opacity-30"
            >
              開店する
            </button>
            <p className="text-sm text-amber-200/60">
              合計 {Number.isNaN(total) ? "-" : total} 人(1〜5)
            </p>
          </div>
          {personas.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-amber-200">参加する常連客</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {personas.map((p) => (
                  <label key={p.id} className="flex items-center gap-1 text-sm text-amber-100">
                    <input
                      type="checkbox"
                      checked={checkedIds.includes(p.id)}
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

      {/* 常連客の管理 */}
      {!working && (
        <details className="mt-4 rounded-lg border border-amber-900/60 bg-black/20 p-4">
          <summary className="cursor-pointer font-bold text-amber-200">常連客の管理</summary>
          {personas.length > 0 && (
            <ul className="mt-3 space-y-2">
              {personas.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-amber-100">
                    <span className="font-bold">{p.name}</span> — {p.profile}
                    <span className="block text-amber-200/60">目的: {p.goals.join(" / ")}</span>
                  </span>
                  <button
                    onClick={() => void savePersonas(personas.filter((x) => x.id !== p.id))}
                    className="shrink-0 rounded border border-amber-700 px-2 py-1 text-amber-200 hover:border-amber-500"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-sm text-amber-200">
              名前
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 block w-full rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
              />
            </label>
            <label className="text-sm text-amber-200">
              プロフィール
              <input
                value={newProfile}
                onChange={(e) => setNewProfile(e.target.value)}
                className="mt-1 block w-full rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
              />
            </label>
            <label className="text-sm text-amber-200 sm:col-span-2">
              目的(1行に1件)
              <textarea
                value={newGoals}
                onChange={(e) => setNewGoals(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
              />
            </label>
          </div>
          <button
            onClick={() => void addPersona()}
            className="mt-2 rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500"
          >
            常連客を追加
          </button>
        </details>
      )}

      {working && (
        <button
          onClick={() => void cancelPub()}
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

      {/* バッチ選択(Pub 済みが複数あるとき) */}
      {pubBatches.length > 1 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {pubBatches.map((b) => (
            <button
              key={b.number}
              onClick={() => setSelected(b.number)}
              className={`rounded border px-3 py-1 text-sm ${
                shownBatch === b.number
                  ? "border-amber-400 bg-amber-900/40 text-amber-100"
                  : "border-amber-900/60 text-amber-200 hover:border-amber-600"
              }`}
            >
              バッチ{b.number}
            </button>
          ))}
        </div>
      )}

      {/* Pub レポート */}
      {report && shownBatch !== null && (
        <div className="mt-6">
          <h3 className="font-bold text-amber-100">
            バッチ{shownBatch} Pubレポート — {report.overall.toFixed(1)} / 5.0(客
            {report.personaResults.length}人)
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-amber-200">{report.summary}</p>

          <div className="mt-4 space-y-4">
            {report.personaResults.map((r, i) => (
              <div key={i} className="rounded-lg border border-amber-900/40 bg-black/20 p-4">
                <p className="font-bold text-amber-100">
                  {r.persona.name}
                  {r.persona.origin === "saved" && (
                    <span className="ml-2 rounded bg-amber-800 px-2 py-0.5 text-xs text-amber-100">
                      常連
                    </span>
                  )}
                  {r.status === "aborted" && (
                    <span className="ml-2 rounded bg-red-900 px-2 py-0.5 text-xs text-red-200">
                      中断
                    </span>
                  )}
                </p>
                <p className="text-sm text-amber-200/70">{r.persona.profile}</p>
                {r.status === "completed" ? (
                  <>
                    <p className="mt-2 text-amber-200">
                      {r.overall.toFixed(1)} / 5.0
                      <span className="ml-3 text-sm text-amber-300">
                        {r.scores.map((s) => `${s.name} ${s.score}`).join(" / ")}
                      </span>
                    </p>
                    <p className="mt-1 text-amber-100">「{r.comment}」</p>
                    <ul className="mt-2 space-y-1 text-sm text-amber-200">
                      {r.taskResults.map((t, j) => (
                        <li key={j}>
                          {t.achieved ? "○" : "✕"} {t.goal} — {t.note}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-red-300">{r.comment}</p>
                )}
                {screenshots?.batch === shownBatch &&
                  screenshots.names.includes(`persona-${i + 1}.png`) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/brews/${brew.id}/pub/screenshot?batch=${shownBatch}&name=persona-${i + 1}.png`}
                      alt={`${r.persona.name} の最終画面`}
                      className="mt-3 max-h-48 rounded border border-amber-900/60"
                    />
                  )}
                {r.steps.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-amber-300">
                      行動ログ({r.steps.length}件)
                    </summary>
                    <ol className="mt-2 space-y-1 text-sm text-amber-200/80">
                      {r.steps.map((s) => (
                        <li key={s.step}>
                          {s.step}. {s.action} → {s.observation}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
