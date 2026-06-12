"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Brew } from "@/lib/store/types";

export function RecipePanel({
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
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 再生成後はファイル名が同一のままなので、古い本文を表示し続けないようクリアする
    setSelected(null);
    setContent("");
    (async () => {
      try {
        const res = await fetch(`/api/brews/${brew.id}/recipe`);
        const json = await res.json();
        if (!cancelled) setFiles(json.files ?? []);
      } catch {
        if (!cancelled) setError("レシピ一覧の取得に失敗しました。");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brew.id, brew.recipeGeneratedAt]);

  async function generate() {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    const poll = setInterval(() => void refresh(), 1000);
    try {
      const res = await fetch(`/api/brews/${brew.id}/recipe`, { method: "POST" });
      // 進行中ポーリングの古い応答が最新状態を上書きしないよう、
      // 応答処理の前に止めてから最後に1回だけ取り直す
      clearInterval(poll);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "エラーが発生しました。");
      onUpdate(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(poll);
      try {
        await refresh();
      } catch {
        // refreshが失敗してもbusy解除は必ず行う(タブが永久ロックされるのを防ぐ)
      }
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function open(file: string) {
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/recipe/${file}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "エラーが発生しました。");
      setSelected(file);
      setContent(json.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
        >
          {busy
            ? "発酵中..."
            : brew.recipeGeneratedAt
              ? "再発酵(レシピ再生成)"
              : "レシピ生成"}
        </button>
        {brew.recipeProgress && (
          <p className="text-amber-300">
            {brew.recipeProgress.current}/{brew.recipeProgress.total}:{" "}
            {brew.recipeProgress.file} を生成中...
          </p>
        )}
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {files.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f}>
                <button
                  onClick={() => open(f)}
                  className={`w-full rounded p-2 text-left text-sm ${
                    selected === f
                      ? "bg-amber-900/60 text-amber-100"
                      : "text-amber-300 hover:bg-amber-900/30"
                  }`}
                >
                  {f}
                </button>
              </li>
            ))}
          </ul>
          <article className="prose prose-invert max-w-none rounded-lg border border-amber-900/40 bg-black/20 p-6">
            {selected ? (
              <ReactMarkdown>{content}</ReactMarkdown>
            ) : (
              <p className="text-amber-200/60">左の一覧からファイルを選択してください。</p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
