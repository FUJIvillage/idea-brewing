"use client";

import { useRef, useState } from "react";
import { confirmSound } from "@/components/ps1/sound";
import type { Brew } from "@/lib/store/types";

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      if (fileInputRef.current) fileInputRef.current.value = "";
      confirmSound();
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
    confirmSound();
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
    <div className="flex flex-col gap-[22px]">
      <section>
        <h2 className="mb-2.5 mt-0 text-[17px] font-normal tracking-[2px] text-[#f5b94a]">
          ◆ 投入済みの原料
        </h2>
        {brew.ingredients.length === 0 ? (
          <p className="m-0" style={{ color: "rgba(255,220,160,.45)" }}>
            まだ原料がありません。
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {brew.ingredients.map((ing) => (
              <li
                key={ing.id}
                className="flex items-center gap-2.5 border-2 border-[#3a2a12] bg-[#0e0804] px-3 py-2"
              >
                <span className="shrink-0 bg-[#4a3010] px-2 py-0.5 text-[12px] tracking-wide text-[#ffd88a]">
                  {KIND_LABEL[ing.kind]}
                </span>
                <span className="truncate text-[15px] text-[#ffe9c0]">{ing.title}</span>
                {ing.status === "failed" && (
                  <span className="ml-2 text-[13px] text-[#ff8a8a]">
                    取り込み失敗: {ing.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="m-0 text-[17px] font-normal tracking-[2px] text-[#f5b94a]">
          ◆ 原料を追加
        </h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="追加のテキストメモ"
          className="ps-input text-[15px]"
        />
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={2}
          placeholder="参考URL(1行に1つ)"
          className="ps-input text-[15px]"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="ps-btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            ファイルをえらぶ
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => setFiles(e.target.files)}
          />
          <span className="text-[13px]" style={{ color: "rgba(255,220,160,.45)" }}>
            {files && files.length > 0 ? `${files.length}件選択中` : "えらばれていません"}
          </span>
          <button onClick={addIngredients} disabled={busy} className="ps-btn-secondary">
            原料を追加
          </button>
        </div>
      </section>

      {error && (
        <p className="m-0 text-[#ff8a8a]" aria-live="polite">
          {error}
        </p>
      )}

      <div className="border-t-2 border-[#3a2a12] pt-4">
        <button onClick={mash} disabled={busy} className="ps-btn text-[16px] tracking-[2px]">
          {busy
            ? "仕込み中..."
            : brew.sheet
              ? "▶ 再仕込み(マッシュ)"
              : "▶ 仕込み開始(マッシュ)"}
        </button>
      </div>
    </div>
  );
}
