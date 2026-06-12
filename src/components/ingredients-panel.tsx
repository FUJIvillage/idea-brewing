"use client";

import { useState } from "react";
import type { Brew } from "@/lib/store/types";

const inputCls =
  "w-full rounded-lg border border-amber-900/60 bg-black/30 p-3 text-amber-50 placeholder:text-amber-200/30";

const KIND_LABEL: Record<string, string> = {
  text: "テキスト",
  url: "URL",
  image: "画像",
  document: "資料",
};

export function IngredientsPanel({
  brew,
  onUpdate,
  onMashed,
  onBusyChange,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
  onMashed: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [urls, setUrls] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addIngredients() {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const form = new FormData();
      if (text.trim()) form.set("text", text);
      if (urls.trim()) form.set("urls", urls);
      for (const f of Array.from(files ?? [])) form.append("files", f);
      const res = await fetch(`/api/brews/${brew.id}/ingredients`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "エラーが発生しました。");
      onUpdate(json);
      setText("");
      setUrls("");
      setFiles(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function mash() {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/mash`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "エラーが発生しました。");
      onUpdate(json);
      onMashed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 font-bold text-amber-200">投入済みの原料</h2>
        {brew.ingredients.length === 0 ? (
          <p className="text-amber-200/60">まだ原料がありません。</p>
        ) : (
          <ul className="space-y-1">
            {brew.ingredients.map((ing) => (
              <li key={ing.id} className="rounded border border-amber-900/40 bg-black/20 p-2">
                <span className="mr-2 rounded bg-amber-900/60 px-2 py-0.5 text-xs">
                  {KIND_LABEL[ing.kind]}
                </span>
                <span className="text-amber-100">{ing.title}</span>
                {ing.status === "failed" && (
                  <span className="ml-2 text-sm text-red-400">取り込み失敗: {ing.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-bold text-amber-200">原料を追加</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="追加のテキストメモ"
          className={inputCls}
        />
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={2}
          placeholder="参考URL(1行に1つ)"
          className={inputCls}
        />
        <input
          type="file"
          multiple
          onChange={(e) => setFiles(e.target.files)}
          className="block w-full text-amber-200"
        />
        <button
          onClick={addIngredients}
          disabled={busy}
          className="rounded-lg border border-amber-600 px-4 py-2 font-bold text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
        >
          原料を追加
        </button>
      </section>

      {error && <p className="text-red-400">{error}</p>}

      <button
        onClick={mash}
        disabled={busy}
        className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
      >
        {busy ? "仕込み中..." : brew.sheet ? "再仕込み(マッシュ)" : "仕込み開始(マッシュ)"}
      </button>
    </div>
  );
}
