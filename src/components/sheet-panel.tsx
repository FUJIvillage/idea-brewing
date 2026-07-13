"use client";

import { useState } from "react";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type SheetKey,
  type Sufficiency,
} from "@/lib/store/types";
import { confirmSound } from "@/components/ps1/sound";

const BADGE: Record<Sufficiency, { label: string; color: string; border: string }> = {
  full: { label: "充足", color: "#8adc8a", border: "#4a8a4a" },
  thin: { label: "薄い", color: "#f5c96a", border: "#8a6428" },
  empty: { label: "空", color: "#9a9a9a", border: "#4a4a4a" },
};

export function SheetPanel({
  brew,
  onUpdate,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
}) {
  if (!brew.sheet) {
    return <p className="text-[#e0a83c]">先に仕込みを実行してください。</p>;
  }
  return (
    <div className="flex flex-col gap-3.5">
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
    confirmSound();
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
    <section className="border-2 border-[#3a2a12] bg-[#0e0804] px-4 py-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <h3 className="m-0 text-[15px] font-normal tracking-wide text-[#ffd88a]">
          ▸ {SHEET_LABELS[fieldKey]}
        </h3>
        <span
          className="px-2 py-px text-[12px] tracking-wide"
          style={{ border: `1px solid ${badge.border}`, color: badge.color }}
        >
          {badge.label}
        </span>
        {field.userEdited && (
          <span
            className="px-2 py-px text-[12px] tracking-wide"
            style={{ border: "1px solid #4a7ac0", color: "#8ab8ff" }}
          >
            ユーザー確定
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(field.content);
            setEditing(!editing);
          }}
          className="ml-auto cursor-pointer border-0 bg-transparent font-[inherit] text-[13px] tracking-wide text-[#e0a83c] hover:text-[#ffd88a]"
        >
          {editing ? "[キャンセル]" : "[編集]"}
        </button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="ps-input"
          />
          <button onClick={save} className="ps-btn">
            保存
          </button>
          {error && (
            <p className="text-[#ff8a8a]" aria-live="polite">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p
          className="m-0 whitespace-pre-wrap text-[15px] leading-[1.7]"
          style={{ color: "rgba(255,233,192,.9)" }}
        >
          {field.content || "(まだ情報がありません)"}
        </p>
      )}
    </section>
  );
}
