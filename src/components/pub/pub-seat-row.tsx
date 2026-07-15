"use client";

import { useEffect, useRef } from "react";
import type { PubPersonaResult } from "@/lib/store/types";
import {
  buildGuestGrid,
  buildStoolGrid,
  drawGridInto,
  GUEST_H,
  GUEST_W,
  guestPalette,
  guestSeed,
  moodFromResult,
  STOOL_H,
  STOOL_W,
} from "@/lib/pub/guest-visual";
import { cursorSound } from "@/components/ps1/sound";

/** 客席チップの小さなドット絵肖像(静止1コマ) */
function GuestChip({ result }: { result: PubPersonaResult }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const seed = guestSeed(result.persona.name);
    if (result.status === "aborted") {
      drawGridInto(
        ctx,
        buildStoolGrid(),
        guestPalette(seed),
        Math.floor((GUEST_W - STOOL_W) / 2),
        GUEST_H - STOOL_H - 2,
        1,
      );
    } else {
      const grid = buildGuestGrid(seed, moodFromResult(result.status, result.overall), 0);
      drawGridInto(ctx, grid, guestPalette(seed), 0, 0, 1);
    }
  }, [result]);
  return (
    <canvas
      ref={ref}
      width={GUEST_W}
      height={GUEST_H}
      style={{ width: 56, height: 68, imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}

/** 本日の客席。チップをクリックして注目する客を切り替える */
export function PubSeatRow({
  results,
  active,
  onSelect,
}: {
  results: PubPersonaResult[];
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="border-2 border-[#8a6428] bg-[#150d05] p-3.5" style={{ boxShadow: "inset 0 0 0 2px #050302, 6px 6px 0 rgba(0,0,0,.55)" }}>
      <h3 className="m-0 mb-2.5 text-[12px] font-normal tracking-[2px] text-[rgba(255,220,160,.5)]">
        本日の客席 — クリックで切り替え
      </h3>
      <div className="flex flex-wrap gap-2.5">
        {results.map((r, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              cursorSound();
              onSelect(i);
            }}
            data-active={i === active ? "true" : "false"}
            className="flex min-w-[76px] cursor-pointer flex-col items-center gap-1 border-2 border-[#3a2a12] bg-[#0d0904] px-2 pt-1.5 pb-1 data-[active=true]:border-[#f5b94a] data-[active=true]:bg-[#241505]"
          >
            <GuestChip result={r} />
            <span className="text-[11px] tracking-wide text-[rgba(255,220,160,.5)]" data-active={i === active}>
              {r.persona.name.replace(/^.*の/, "")}
            </span>
            <span className="text-[10px]">
              {r.status === "aborted" ? (
                <span className="text-[#ff8a8a]">中断</span>
              ) : (
                <span className="text-[#f5a623]">{r.overall.toFixed(1)}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
