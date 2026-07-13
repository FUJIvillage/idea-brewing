"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { confirmSound } from "@/components/ps1/sound";

export default function NewBrewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [urls, setUrls] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    confirmSound();
    try {
      const res = await fetch("/api/brews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const brew = await res.json();
      if (!res.ok) throw new Error(brew.error ?? "エラーが発生しました。");
      if (text.trim() || urls.trim() || (files && files.length > 0)) {
        const form = new FormData();
        if (text.trim()) form.set("text", text);
        if (urls.trim()) form.set("urls", urls);
        for (const f of Array.from(files ?? [])) form.append("files", f);
        const ingRes = await fetch(`/api/brews/${brew.id}/ingredients`, {
          method: "POST",
          body: form,
        });
        if (!ingRes.ok) throw new Error((await ingRes.json()).error ?? "エラーが発生しました。");
      }
      router.push(`/brews/${brew.id}?tab=ingredients`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="ps-page max-w-[720px]">
      <Link href="/" className="ps-btn-ghost mb-4 inline-block">
        ◀ タンク一覧
      </Link>
      <div className="text-[13px] tracking-[4px]" style={{ color: "rgba(255,220,160,.5)" }}>
        NEW BREW
      </div>
      <h1 className="ps-chromatic mb-5 mt-0.5 text-[24px] font-normal tracking-[3px] text-[#ffe9c0]">
        ◆ 新しい仕込み
      </h1>

      <form onSubmit={submit} className="ps-panel flex flex-col gap-[18px] p-[22px]">
        <div>
          <label htmlFor="name" className="ps-label">
            ▸ ブリュー名
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 最高のtodoアプリ"
            className="ps-input"
            required
          />
        </div>
        <div>
          <label htmlFor="text" className="ps-label">
            ▸ アイデアメモ
          </label>
          <textarea
            id="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="雑な一言でもOK。思いつくまま書き込んでください。"
            className="ps-input"
          />
        </div>
        <div>
          <label htmlFor="urls" className="ps-label">
            ▸ 参考URL(1行に1つ)
          </label>
          <textarea
            id="urls"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={3}
            placeholder="https://example.com/reference-lp"
            className="ps-input"
          />
        </div>
        <div>
          <label htmlFor="files" className="ps-label">
            ▸ 画像・資料ファイル(.png / .jpg / .md / .txt / .pdf)
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="ps-btn-secondary"
              onClick={() => fileRef.current?.click()}
            >
              ファイルをえらぶ
            </button>
            <span className="text-[13px]" style={{ color: "rgba(255,220,160,.45)" }}>
              {files && files.length > 0
                ? `${files.length}件選択中`
                : "えらばれていません"}
            </span>
            <input
              id="files"
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => setFiles(e.target.files)}
            />
          </div>
        </div>
        {error && (
          <p className="text-[#ff8a8a]" aria-live="polite">
            {error}
          </p>
        )}
        <div className="border-t-2 border-[#3a2a12] pt-[18px]">
          <button type="submit" disabled={busy} className="ps-btn text-[17px] tracking-[3px]">
            {busy ? "仕込み中..." : "▶ 仕込みを始める"}
          </button>
        </div>
      </form>
    </main>
  );
}
