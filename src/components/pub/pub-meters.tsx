"use client";

import type { PubPersonaResult } from "@/lib/store/types";

function pips(n: number) {
  const filled = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span className="text-[15px] tracking-[3px] text-[#f5a623]">
      {"■".repeat(filled)}
      <span className="text-[#4a381c]">{"□".repeat(5 - filled)}</span>
    </span>
  );
}

/** 客の評価をコースター風メーターで、目的の達成を ○/✕ で表示する */
export function PubMeters({ result }: { result: PubPersonaResult }) {
  if (result.status === "aborted") {
    return (
      <div className="border-2 border-[#3a2a12] bg-[#0e0804] p-4">
        <p className="m-0 text-[13px] text-[#ff8a8a]">席を立ってしまい、評価は付かず。</p>
        <p className="mt-1 mb-0 text-[13px] text-[rgba(255,220,160,.5)]">注文は通らなかった。</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="border-2 border-[#3a2a12] bg-[#0e0804] p-4">
        <h3 className="m-0 mb-2.5 text-[13px] font-normal tracking-[2px] text-[#f5b94a]">◆ この客の評価</h3>
        <div className="flex flex-col gap-1.5">
          {result.scores.map((s) => (
            <div key={s.name} className="grid grid-cols-[8.5em_1fr_auto] items-center gap-2.5 text-[13px]">
              <span className="text-[#ffe9c0]">{s.name}</span>
              {pips(s.score)}
              <span className="text-[12px] tabular-nums text-[#ffd88a]">{s.score}/5</span>
            </div>
          ))}
        </div>
      </div>
      <div className="border-2 border-[#3a2a12] bg-[#0e0804] p-4">
        <h3 className="m-0 mb-2.5 text-[13px] font-normal tracking-[2px] text-[#f5b94a]">◆ 目的の達成</h3>
        <div className="flex flex-col gap-1">
          {result.taskResults.map((t, i) => (
            <p key={i} className="m-0 text-[13px]">
              <span style={{ color: t.achieved ? "#8adc8a" : "#ff8a8a" }}>{t.achieved ? "○" : "✕"}</span> {t.goal}{" "}
              <span className="text-[rgba(255,220,160,.5)]">— {t.note}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
