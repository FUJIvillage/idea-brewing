"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const inputCls =
  "w-full rounded-lg border border-amber-900/60 bg-black/30 p-3 text-amber-50 placeholder:text-amber-200/30";

export default function NewBrewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [urls, setUrls] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
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
      router.push(`/brews/${brew.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-amber-100">新しい仕込み</h1>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label htmlFor="name" className="mb-1 block font-bold text-amber-200">
            ブリュー名
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 最高のtodoアプリ"
            className={inputCls}
            required
          />
        </div>
        <div>
          <label htmlFor="text" className="mb-1 block font-bold text-amber-200">
            アイデアメモ
          </label>
          <textarea
            id="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="雑な一言でもOK。思いつくまま書き込んでください。"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="urls" className="mb-1 block font-bold text-amber-200">
            参考URL(1行に1つ)
          </label>
          <textarea
            id="urls"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={3}
            placeholder="https://example.com/reference-lp"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="files" className="mb-1 block font-bold text-amber-200">
            画像・資料ファイル(.png / .jpg / .md / .txt / .pdf)
          </label>
          <input
            id="files"
            type="file"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            className="block w-full text-amber-200"
          />
        </div>
        {error && (
          <p className="text-red-400" aria-live="polite">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? "仕込み中..." : "仕込みを始める"}
        </button>
      </form>
    </main>
  );
}
