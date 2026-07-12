"use client";

import { useState } from "react";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type SheetKey,
  type Sufficiency,
} from "@/lib/store/types";

const BADGE: Record<Sufficiency, { label: string; cls: string }> = {
  full: { label: "充足", cls: "bg-emerald-700/60 text-emerald-100" },
  thin: { label: "薄い", cls: "bg-amber-700/60 text-amber-100" },
  empty: { label: "空", cls: "bg-stone-700/60 text-stone-200" },
};

export function SheetPanel({
  brew,
  onUpdate,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
}) {
  if (!brew.sheet) {
    return <p className="text-amber-300">先に仕込みを実行してください。</p>;
  }
  return (
    <div className="space-y-4">
      {SHEET_KEYS.map((key) => (
        <FieldCard key={key} brew={brew} fieldKey={key} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function FieldCard({
  brew,
  fieldKey,
  onUpdate,
}: {
  brew: Brew;
  fieldKey: SheetKey;
  onUpdate: (b: Brew) => void;
}) {
  const field = brew.sheet![fieldKey];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.content);
  const [error, setError] = useState<string | null>(null);
  const badge = BADGE[field.sufficiency];

  async function save() {
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/sheet`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: fieldKey, content: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "エラーが発生しました。");
      onUpdate(json);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-lg border border-amber-900/50 bg-black/20 p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-bold text-amber-200">{SHEET_LABELS[fieldKey]}</h3>
        <span className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
        {field.userEdited && (
          <span className="rounded bg-sky-800/60 px-2 py-0.5 text-xs text-sky-100">
            ユーザー確定
          </span>
        )}
        <button
          onClick={() => {
            setDraft(field.content);
            setEditing(!editing);
          }}
          className="ml-auto text-sm text-amber-400 hover:text-amber-300"
        >
          {editing ? "キャンセル" : "編集"}
        </button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-amber-900/60 bg-black/30 p-3 text-amber-50"
          />
          <button
            onClick={save}
            className="rounded bg-amber-600 px-4 py-1.5 font-bold text-stone-950 hover:bg-amber-500"
          >
            保存
          </button>
          {error && (
            <p className="text-red-400" aria-live="polite">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-amber-50/90">
          {field.content || "(まだ情報がありません)"}
        </p>
      )}
    </section>
  );
}
