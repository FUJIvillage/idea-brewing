"use client";

import { useEffect, useState } from "react";
import { blip } from "@/components/ps1/sound";

/**
 * バーテンダー視点のビジュアルノベル調ダイアログ。台詞は1文字ずつタイプ表示する。
 * 台詞が変わったら親側で key を変えてリマウントする前提(count を 0 初期化で済ませ、
 * エフェクト本体での同期 setState を避ける)。
 */
export function PubVnBox({
  name,
  origin,
  line,
  sub,
}: {
  name: string;
  origin: "auto" | "saved";
  line: string;
  sub?: string;
}) {
  const full = `「${line}」`;
  const [count, setCount] = useState(0);

  useEffect(() => {
    const reduce =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      // setState はコールバック内でのみ呼ぶ(エフェクト本体での同期 setState を避ける)
      const id = window.setTimeout(() => setCount(full.length), 0);
      return () => window.clearTimeout(id);
    }
    const id = window.setInterval(() => {
      setCount((c) => {
        const n = c + 1;
        if (n % 2 === 0) blip(560 + (n % 4) * 40, 0.02);
        if (n >= full.length) window.clearInterval(id);
        return Math.min(n, full.length);
      });
    }, 34);
    return () => window.clearInterval(id);
  }, [full]);

  const shown = full.slice(0, count);
  const done = count >= full.length;

  return (
    <section
      className="relative border-2 border-[#f5b94a] px-[18px] pt-4 pb-5"
      style={{ background: "linear-gradient(180deg,#12100a,#0a0804)", boxShadow: "inset 0 0 0 2px #050302, 4px 4px 0 rgba(0,0,0,.55)" }}
    >
      <div
        className="absolute -top-[15px] left-3.5 border-2 border-[#ffd88a] px-3 py-[3px] text-[13px] tracking-wide text-[#140a02]"
        style={{ background: "#d98a12", boxShadow: "2px 2px 0 #000" }}
      >
        {name}
        <span
          className="ml-2 px-1.5 text-[11px]"
          style={
            origin === "saved"
              ? { background: "#140a02", color: "#ffd88a" }
              : { background: "#3a2a12", color: "#c9a15c" }
          }
        >
          {origin === "saved" ? "常連" : "一見"}
        </span>
      </div>
      <p className="mt-2 min-h-[1.6em] text-[17px] text-[#ffd88a]" aria-live="polite">
        {shown}
        {!done && <span className="text-[#f5a623]">_</span>}
      </p>
      {sub && <p className="mt-2.5 mb-0 text-[12px] text-[rgba(255,220,160,.5)]">{sub}</p>}
      <span className="ps-blink absolute right-3.5 bottom-2 text-[15px] text-[#f5a623]">▼</span>
    </section>
  );
}
