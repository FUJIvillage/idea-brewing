"use client";

import { useEffect, useRef, useState } from "react";
import type { Brew, GrillEntry } from "@/lib/store/types";

async function postGrill(
  brewId: string,
  body: unknown,
): Promise<{ brew: Brew; entry: GrillEntry | null }> {
  const res = await fetch(`/api/brews/${brewId}/grill`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "グリル操作に失敗しました");
  return json;
}

export function GrillPanel({
  brew,
  onUpdate,
  onBusyChange,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(brew.grill.auto);
  const [freeText, setFreeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // ループ中断の理由: "auto-off"=ユーザーがチェック解除(サーバーへauto:falseを送る)、"unmount"=画面離脱(送らない)
  const cancelRef = useRef<false | "auto-off" | "unmount">(false);
  const pending = brew.grill.entries.find((e) => !e.answer) ?? null;

  // アンマウント時はautoループを止める(チェック解除済みの場合はその要求を優先)
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

  const next = () =>
    run(async () => {
      const { brew: b } = await postGrill(brew.id, { action: "next" });
      onUpdate(b);
    });

  const answer = (text: string, by: "user" | "auto") =>
    run(async () => {
      if (!pending) return;
      const { brew: b } = await postGrill(brew.id, {
        action: "answer",
        entryId: pending.id,
        answer: text,
        by,
      });
      onUpdate(b);
      setFreeText("");
    });

  const runAuto = () => {
    cancelRef.current = false;
    return run(async () => {
      let current = (await postGrill(brew.id, { action: "auto", auto: true })).brew;
      onUpdate(current);
      let guard = 0;
      while (!cancelRef.current && !current.grill.finished && guard < 50) {
        guard += 1;
        const pendingEntry = current.grill.entries.find((e) => !e.answer);
        if (pendingEntry) {
          const rec =
            pendingEntry.options.find((o) => o.recommended) ?? pendingEntry.options[0];
          current = (
            await postGrill(brew.id, {
              action: "answer",
              entryId: pendingEntry.id,
              answer: rec?.label ?? "おまかせ",
              by: "auto",
            })
          ).brew;
        } else {
          current = (await postGrill(brew.id, { action: "next" })).brew;
        }
        onUpdate(current);
      }
      // チェック解除によるauto:falseの書き込みは、ループ内のanswer/nextの
      // read-modify-writeと競合しないようループ終了後にここで一度だけ行う
      if (cancelRef.current === "auto-off") {
        const { brew: b } = await postGrill(brew.id, { action: "auto", auto: false });
        onUpdate(b);
      }
    });
  };

  const finish = () =>
    run(async () => {
      const { brew: b } = await postGrill(brew.id, { action: "finish" });
      onUpdate(b);
    });

  const answered = brew.grill.entries.filter((e) => e.answer);

  return (
    <div className="space-y-6">
      {brew.grill.finished ? (
        <p className="rounded-lg border border-emerald-700/60 bg-emerald-900/30 p-4 font-bold text-emerald-200">
          煮詰め完了。「レシピ」タブから発酵(資料生成)に進めます。
        </p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-amber-200">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                const checked = e.target.checked;
                setAuto(checked);
                if (!checked) {
                  if (busy) {
                    // ループ実行中はフラグだけ立て、auto:falseの送信はループ終了後に任せる
                    cancelRef.current = "auto-off";
                  } else {
                    void run(async () => {
                      const { brew: b } = await postGrill(brew.id, {
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
            <section className="rounded-lg border border-amber-700/60 bg-black/30 p-4">
              <p className="mb-3 font-bold text-amber-100">{pending.question}</p>
              <div className="space-y-2">
                {pending.options.map((o) => (
                  <button
                    key={o.label}
                    disabled={busy}
                    onClick={() => answer(o.label, "user")}
                    className="block w-full rounded border border-amber-800/60 p-2 text-left text-amber-50 hover:bg-amber-900/40 disabled:opacity-50"
                  >
                    {o.label}
                    {o.recommended && (
                      <span className="ml-2 rounded bg-amber-600 px-1.5 text-xs font-bold text-stone-950">
                        推奨
                      </span>
                    )}
                  </button>
                ))}
                <div className="flex gap-2">
                  <input
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder="自由記述で回答"
                    className="flex-1 rounded border border-amber-900/60 bg-black/30 p-2 text-amber-50"
                  />
                  <button
                    disabled={busy || !freeText.trim()}
                    onClick={() => answer(freeText.trim(), "user")}
                    className="rounded bg-amber-600 px-4 font-bold text-stone-950 disabled:opacity-50"
                  >
                    回答する
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className="flex gap-3">
            <button
              disabled={busy || (pending !== null && !auto)}
              onClick={() => (auto ? runAuto() : next())}
              className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
            >
              {busy
                ? "グリル中..."
                : brew.grill.entries.length === 0
                  ? "グリル開始"
                  : "次の質問"}
            </button>
            <button
              disabled={busy}
              onClick={finish}
              className="rounded-lg border border-amber-600 px-6 py-3 font-bold text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
            >
              煮詰め完了にする
            </button>
          </div>
        </div>
      )}

      {answered.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold text-amber-200">質疑の履歴</h2>
          <ul className="space-y-2">
            {answered.map((e, i) => (
              <li key={e.id} className="rounded border border-amber-900/40 bg-black/20 p-3">
                <p className="text-amber-100">
                  Q{i + 1}: {e.question}
                </p>
                <p className="text-amber-300">
                  A: {e.answer}
                  {e.answeredBy === "auto" && (
                    <span className="ml-2 rounded bg-stone-700 px-1.5 text-xs">auto</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
