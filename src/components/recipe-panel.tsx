"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Brew } from "@/lib/store/types";
import { useBrewAction } from "./use-brew-action";
import { blip, confirmSound } from "@/components/ps1/sound";

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

  const generating = brew.recipeProgress !== null;
  const { busy, error, setError, post: postAction } = useBrewAction({
    brewId: brew.id,
    base: "recipe",
    running: generating,
    onUpdate,
    refresh,
    onBusyChange,
  });

  const [prevGeneratedAt, setPrevGeneratedAt] = useState(brew.recipeGeneratedAt);
  if (prevGeneratedAt !== brew.recipeGeneratedAt) {
    setPrevGeneratedAt(brew.recipeGeneratedAt);
    setSelected(null);
    setContent("");
  }

  useEffect(() => {
    let cancelled = false;
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
  }, [brew.id, brew.recipeGeneratedAt, setError]);

  async function generate() {
    confirmSound();
    await postAction("");
  }

  async function open(file: string) {
    setError(null);
    blip(560);
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={generate}
          disabled={busy || generating}
          className="ps-btn text-[15px] tracking-[2px]"
        >
          {busy || generating
            ? "発酵中..."
            : brew.recipeGeneratedAt
              ? "▶ 再発酵(レシピ再生成)"
              : "▶ レシピ生成"}
        </button>
        {brew.recipeGeneratedAt && !generating && (
          <span className="text-[13px]" style={{ color: "rgba(255,220,160,.45)" }}>
            前回: {new Date(brew.recipeGeneratedAt).toLocaleString("ja-JP")}
          </span>
        )}
        {brew.recipeProgress && (
          <p className="m-0 text-[#e0a83c]" aria-live="polite">
            {brew.recipeProgress.current}/{brew.recipeProgress.total}:{" "}
            {brew.recipeProgress.file} を生成中...
          </p>
        )}
      </div>

      {error && (
        <p className="m-0 text-[#ff8a8a]" aria-live="polite">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "minmax(200px,250px) 1fr" }}
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {files.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => open(f)}
                  className="ps-select-item text-[13px]"
                  data-active={selected === f ? "true" : "false"}
                >
                  {selected === f ? "▶ " : "・ "}
                  {f}
                </button>
              </li>
            ))}
          </ul>
          <article
            className="prose prose-invert max-w-none border-2 border-[#3a2a12] p-5 text-[15px] leading-[1.9]"
            style={{ background: "#040201" }}
          >
            {selected ? (
              <ReactMarkdown>{content}</ReactMarkdown>
            ) : (
              <p style={{ color: "rgba(255,220,160,.45)" }}>
                左の一覧からファイルを選択してください。
              </p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
