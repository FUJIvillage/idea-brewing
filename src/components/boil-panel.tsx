"use client";

import { useEffect, useRef, useState } from "react";
import type { Brew, BoilEntry } from "@/lib/store/types";
import { postBoilOrRecover } from "@/lib/boil/network";
import { blip, confirmSound } from "@/components/ps1/sound";

async function postBoil(
  brewId: string,
  body: unknown,
): Promise<{ brew: Brew; entry: BoilEntry | null }> {
  const res = await fetch(`/api/brews/${brewId}/boil`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "煮沸操作に失敗しました");
  return json;
}

async function loadBrew(brewId: string): Promise<Brew> {
  const res = await fetch(`/api/brews/${brewId}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "ブリューの再取得に失敗しました");
  return json;
}

export function BoilPanel({
  brew,
  onUpdate,
  onBusyChange,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(brew.boil.auto);
  const [freeText, setFreeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<false | "auto-off" | "unmount">(false);
  const pending = brew.boil.entries.find((e) => !e.answer) ?? null;

  useEffect(() => {
    return () => {
      if (cancelRef.current === false) cancelRef.current = "unmount";
    };
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  const resilientPost = (body: unknown) =>
    postBoilOrRecover(brew.id, body, { post: postBoil, load: loadBrew });

  const next = () =>
    run(async () => {
      const { brew: b } = await resilientPost({ action: "next" });
      onUpdate(b);
      confirmSound();
    });

  const answer = (text: string, by: "user" | "auto") =>
    run(async () => {
      if (!pending) return;
      const { brew: b } = await resilientPost({
        action: "answer",
        entryId: pending.id,
        answer: text,
        by,
      });
      onUpdate(b);
      setFreeText("");
      confirmSound();
    });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runAuto = () => {
    cancelRef.current = false;
    return run(async () => {
      let current = (await resilientPost({ action: "auto", auto: true })).brew;
      onUpdate(current);
      let guard = 0;
      let networkHits = 0;
      let maxSteps = 50;
      try {
        const settingsRes = await fetch("/api/settings");
        if (settingsRes.ok) {
          const settings = (await settingsRes.json()) as { boilMaxQuestions?: number };
          const maxQ =
            typeof settings.boilMaxQuestions === "number" ? settings.boilMaxQuestions : 20;
          maxSteps = Math.max(50, maxQ * 2 + 10);
        }
      } catch {
        // 設定取得失敗時は既定のガードを使う
      }
      while (!cancelRef.current && !current.boil.finished && guard < maxSteps) {
        guard += 1;
        const pendingEntry = current.boil.entries.find((e) => !e.answer);
        const beforeUpdatedAt = current.updatedAt;
        if (pendingEntry) {
          await sleep(900);
          if (cancelRef.current) break;
          const rec =
            pendingEntry.options.find((o) => o.recommended) ?? pendingEntry.options[0];
          const result = await resilientPost({
            action: "answer",
            entryId: pendingEntry.id,
            answer: rec?.label ?? "おまかせ",
            by: "auto",
          });
          current = result.brew;
          if (result.recovered) {
            if (current.updatedAt === beforeUpdatedAt) {
              networkHits += 1;
              if (networkHits >= 3) {
                throw new Error(
                  "通信が何度も切れました。サーバー側は進んでいることがあります。ページを再読み込みして続行してください。",
                );
              }
            } else {
              networkHits = 0;
            }
          } else {
            networkHits = 0;
          }
        } else {
          const result = await resilientPost({ action: "next" });
          current = result.brew;
          if (result.recovered) {
            if (current.updatedAt === beforeUpdatedAt) {
              networkHits += 1;
              if (networkHits >= 3) {
                throw new Error(
                  "通信が何度も切れました。サーバー側は進んでいることがあります。ページを再読み込みして続行してください。",
                );
              }
            } else {
              networkHits = 0;
            }
          } else {
            networkHits = 0;
          }
        }
        onUpdate(current);
      }
      if (cancelRef.current === "auto-off") {
        const { brew: b } = await resilientPost({ action: "auto", auto: false });
        onUpdate(b);
      }
    });
  };

  const finish = () =>
    run(async () => {
      const { brew: b } = await resilientPost({ action: "finish" });
      onUpdate(b);
      confirmSound();
    });

  const answered = brew.boil.entries.filter((e) => e.answer);

  return (
    <div className="flex flex-col gap-5">
      {brew.boil.finished ? (
        <p
          className="m-0 border-2 px-4 py-3.5 text-[15px] tracking-wide"
          style={{
            borderColor: "#4a8a4a",
            background: "rgba(30,80,30,.25)",
            color: "#8adc8a",
          }}
        >
          ★ 煮沸完了。「レシピ」タブから発酵(資料生成)に進めます。
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-[15px] text-[#e8c07a]">
            <input
              type="checkbox"
              checked={auto}
              style={{ width: 18, height: 18, accentColor: "#f5a623" }}
              onChange={(e) => {
                const checked = e.target.checked;
                setAuto(checked);
                blip(checked ? 700 : 320);
                if (!checked) {
                  if (busy) {
                    cancelRef.current = "auto-off";
                  } else {
                    void run(async () => {
                      const { brew: b } = await resilientPost({
                        action: "auto",
                        auto: false,
                      });
                      onUpdate(b);
                    });
                  }
                }
              }}
            />
            autoモード(推奨回答を自動選択して連続進行)
          </label>

          {pending && !auto && (
            <section
              className="relative border-2 p-[18px]"
              style={{
                borderColor: "#c8922e",
                background: "#0a0603",
                boxShadow: "inset 0 0 0 2px #050302",
              }}
            >
              <p className="mb-3.5 mt-0 text-[17px] leading-[1.6] text-[#ffe9c0]">
                {pending.question}
              </p>
              <div className="flex flex-col gap-2">
                {pending.options.map((o) => (
                  <button
                    key={o.label}
                    disabled={busy}
                    onClick={() => answer(o.label, "user")}
                    className="ps-option"
                  >
                    {o.label}
                    {o.recommended && (
                      <span className="ml-2.5 bg-[#d98a12] px-2 py-px text-[12px] tracking-wide text-[#140a02]">
                        推奨
                      </span>
                    )}
                  </button>
                ))}
                <div className="mt-1 flex gap-2">
                  <input
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder="自由記述で回答"
                    className="ps-input flex-1 text-[15px]"
                  />
                  <button
                    disabled={busy || !freeText.trim()}
                    onClick={() => answer(freeText.trim(), "user")}
                    className="ps-btn"
                  >
                    回答する
                  </button>
                </div>
              </div>
              <span className="ps-blink absolute right-3 bottom-2 text-[#f5a623]">▼</span>
            </section>
          )}

          <div className="flex gap-3">
            <button
              disabled={busy || (pending !== null && !auto)}
              onClick={() => (auto ? runAuto() : next())}
              className="ps-btn text-[15px] tracking-[2px]"
            >
              {busy
                ? "煮沸中..."
                : brew.boil.entries.length === 0
                  ? "▶ 煮沸開始"
                  : "▶ 次の質問"}
            </button>
            <button
              disabled={busy}
              onClick={finish}
              className="ps-btn-secondary text-[15px] tracking-[2px]"
            >
              煮沸完了にする
            </button>
          </div>
        </div>
      )}

      {answered.length > 0 && (
        <section>
          <h2 className="mb-2.5 mt-0 text-[17px] font-normal tracking-[2px] text-[#f5b94a]">
            ◆ 質疑の履歴
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {answered.map((e, i) => (
              <li key={e.id} className="border-2 border-[#3a2a12] bg-[#0e0804] p-3">
                <p className="m-0 text-[#ffe9c0]">
                  Q{i + 1}: {e.question}
                </p>
                <p className="mt-1 mb-0 text-[#e0a83c]">
                  A: {e.answer}
                  {e.answeredBy === "auto" && (
                    <span className="ml-2 bg-[#3a3a3a] px-1.5 text-[12px] text-[#9a9a9a]">
                      auto
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p className="m-0 text-[#ff8a8a]" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
