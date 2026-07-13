"use client";

import { useEffect, useRef } from "react";
import type { PubPersonaResult } from "@/lib/store/types";
import {
  BAYER,
  buildFigure,
  buildStool,
  drawDrink,
  guestSeed,
  guestTraits,
  moodFromResult,
  renderFigureInto,
  type Face,
} from "@/lib/pub/guest-visual";

const SCENE_W = 240;
const SCENE_H = 150;
const NEON = { x: 198, y: 16, w: 34, h: 15 };

// PS1 グラデはディザで階調化する(スムーズは使わない)
function ditherGlow(
  c: CanvasRenderingContext2D,
  cxp: number,
  cyp: number,
  rad: number,
  inten: number,
  ar: number,
  ag: number,
  ab: number,
): void {
  const region = Math.min(SCENE_H, Math.round(cyp + rad));
  const img = c.getImageData(0, 0, SCENE_W, region);
  const d = img.data;
  for (let y = 0; y < region; y++) {
    for (let x = 0; x < SCENE_W; x++) {
      const dx = x - cxp;
      const dy = y - cyp;
      const v = (1 - Math.sqrt(dx * dx + dy * dy) / rad) * inten;
      if (v <= 0) continue;
      if (v > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16) {
        const i = (y * SCENE_W + x) * 4;
        d[i] = Math.min(255, d[i] + ar);
        d[i + 1] = Math.min(255, d[i + 1] + ag);
        d[i + 2] = Math.min(255, d[i + 2] + ab);
      }
    }
  }
  c.putImageData(img, 0, 0);
}

function patron(c: CanvasRenderingContext2D, cx: number, cy: number, col: string): void {
  c.fillStyle = col;
  c.fillRect(cx - 7, cy, 14, 16);
  c.fillRect(cx - 4, cy - 9, 9, 9);
  c.fillRect(cx - 5, cy - 11, 11, 2);
}

/** 動かない背景(壁・棚・窓・ネオン枠・奥の常連)を一度だけ描いて使い回す */
function buildBackBuf(): HTMLCanvasElement | null {
  const bb = document.createElement("canvas");
  bb.width = SCENE_W;
  bb.height = SCENE_H;
  const c = bb.getContext("2d");
  if (!c) return null;
  c.imageSmoothingEnabled = false;
  c.fillStyle = "#080402";
  c.fillRect(0, 0, SCENE_W, SCENE_H);
  ditherGlow(c, SCENE_W / 2, 12, 78, 0.95, 120, 72, 14); // 暖色ランプ
  ditherGlow(c, 18, 34, 46, 0.7, 20, 44, 86); // 窓の寒色ムーンライト
  c.fillStyle = "#3a2a12";
  c.fillRect(SCENE_W / 2 - 1, 0, 2, 8);
  c.fillStyle = "#d98a12";
  c.fillRect(SCENE_W / 2 - 5, 8, 10, 4);
  c.fillStyle = "#ffd88a";
  c.fillRect(SCENE_W / 2 - 4, 11, 8, 1);
  const cols = ["#8a3a2a", "#3a6a3a", "#7a6a2a", "#4a3a7a", "#9a5a1a", "#3a5a6a", "#8a2a3a"];
  for (let s = 0; s < 2; s++) {
    const y = 24 + s * 22;
    c.fillStyle = "#1a1008";
    c.fillRect(16, y + 12, SCENE_W - 32, 2);
    for (let i = 0; i < 9; i++) {
      const bx = 26 + i * 22 + s * 9;
      if (bx > SCENE_W - 22) continue;
      const col = cols[(i + s * 3) % cols.length];
      const bh = 9 + ((i * 7 + s * 5) % 4);
      c.fillStyle = col;
      c.fillRect(bx, y + 12 - bh, 3, bh);
      c.fillStyle = "#080402";
      c.fillRect(bx + 1, y + 12 - bh - 2, 1, 2);
      c.fillStyle = "rgba(255,220,160,.22)";
      c.fillRect(bx, y + 12 - bh, 1, bh);
    }
  }
  for (let i = 0; i < 5; i++) {
    const gx = 150 + i * 13;
    c.fillStyle = "#2a3038";
    c.fillRect(gx, 20, 1, 4);
    c.fillRect(gx - 2, 24, 5, 1);
    c.fillRect(gx - 1, 25, 3, 2);
  }
  c.fillStyle = "#0a1620";
  c.fillRect(8, 20, 22, 28);
  c.strokeStyle = "#2a3038";
  c.lineWidth = 1;
  c.strokeRect(8, 20, 22, 28);
  c.fillStyle = "#1a2630";
  c.fillRect(18, 20, 1, 28);
  c.fillRect(8, 33, 22, 1);
  c.strokeStyle = "#2a6a72";
  c.lineWidth = 2;
  c.strokeRect(NEON.x, NEON.y, NEON.w, NEON.h);
  patron(c, 46, 96, "#160f09");
  patron(c, 205, 100, "#130d08");
  return bb;
}

function drawCounter(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#20140a";
  ctx.fillRect(0, SCENE_H - 24, SCENE_W, 24);
  ctx.fillStyle = "#3a2410";
  ctx.fillRect(0, SCENE_H - 24, SCENE_W, 2);
  ctx.fillStyle = "rgba(255,220,160,.12)";
  ctx.fillRect(0, SCENE_H - 23, SCENE_W, 1);
}

function drawRain(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.fillStyle = "rgba(150,190,235,.35)";
  for (let i = 0; i < 9; i++) {
    const x = 10 + ((i * 5) % 18);
    const y = 22 + ((t * 34 + i * 9) % 26);
    ctx.fillRect(x, y, 1, 3);
  }
}

function drawNeon(ctx: CanvasRenderingContext2D, t: number): void {
  const on = ((t * 9) | 0) % 37 !== 0;
  const a = on ? 0.85 : 0.35;
  ctx.fillStyle = `rgba(90,208,224,${a * 0.5})`;
  ctx.fillRect(NEON.x - 2, NEON.y - 2, NEON.w + 4, NEON.h + 4);
  ctx.fillStyle = `rgba(150,235,245,${a})`;
  ctx.fillRect(NEON.x + 4, NEON.y + 4, 2, NEON.h - 8);
  ctx.fillRect(NEON.x + 4, NEON.y + 4, 10, 2);
  ctx.fillRect(NEON.x + 4, NEON.y + Math.floor(NEON.h / 2) - 1, 8, 2);
  ctx.fillRect(NEON.x + 18, NEON.y + 4, 2, NEON.h - 8);
  ctx.fillRect(NEON.x + 26, NEON.y + 4, 2, NEON.h - 8);
  ctx.fillRect(NEON.x + 18, NEON.y + NEON.h - 6, 10, 2);
}

interface FigureState {
  faces: Face[];
  seed: number;
  drink: number;
  active: boolean;
}

function figureStateFor(result: PubPersonaResult | null): FigureState {
  if (!result) return { faces: [], seed: 0, drink: -1, active: false };
  const seed = guestSeed(result.persona.name);
  if (result.status === "aborted") return { faces: buildStool(), seed, drink: -1, active: false };
  const mood = moodFromResult(result.status, result.overall);
  return { faces: buildFigure(seed, mood), seed, drink: guestTraits(seed).drink, active: true };
}

const MOOD_EMOJI: Record<string, string> = { happy: "♪", meh: "…", gone: "✕" };

export function PubBarScene({
  result,
  sign,
}: {
  result: PubPersonaResult | null;
  sign: { overall: number; count: number; batch: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const figRef = useRef<FigureState>(figureStateFor(result));

  // 描画ループから最新の focus を読むための ref(レンダー中の書き込み不可なので effect で同期)
  useEffect(() => {
    figRef.current = figureStateFor(result);
  }, [result]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const back = buildBackBuf();
    const reduce =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let running = true;
    let t = 0.4;
    let last = performance.now();

    const draw = () => {
      if (back) ctx.drawImage(back, 0, 0);
      else {
        ctx.fillStyle = "#080402";
        ctx.fillRect(0, 0, SCENE_W, SCENE_H);
      }
      drawRain(ctx, reduce ? 0 : t);
      drawNeon(ctx, reduce ? 1 : t);
      const fig = figRef.current;
      if (fig.faces.length > 0) {
        renderFigureInto(ctx, fig.faces, fig.seed, fig.active ? t : 0.5, SCENE_W * 0.5, 92, 150);
      }
      drawCounter(ctx);
      if (fig.active && fig.drink >= 0) {
        drawDrink(ctx, Math.round(SCENE_W * 0.62), SCENE_H - 23, 2, fig.drink);
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!reduce) t += dt * 0.6;
      draw();
      requestAnimationFrame(loop);
    };
    draw();
    if (!reduce) requestAnimationFrame(loop);

    return () => {
      running = false;
    };
  }, []);

  const stars = sign ? "★★★★★☆☆☆☆☆".slice(5 - Math.round(sign.overall), 10 - Math.round(sign.overall)) : "";
  const mood = result && result.status !== "aborted" ? moodFromResult(result.status, result.overall) : result ? "gone" : "";

  return (
    <div className="stage relative overflow-hidden border-2 border-[#8a6428]">
      {sign && (
        <div
          className="absolute top-3 right-3.5 z-[5] text-center"
          style={{ background: "#0d0904", border: "2px solid #5a4118", boxShadow: "4px 4px 0 rgba(0,0,0,.6)", padding: "6px 12px" }}
        >
          <div className="text-[10px] tracking-[2px] text-[rgba(255,220,160,.5)]">本日の評判</div>
          <div className="text-[15px] tracking-[2px] text-[#f5a623]">{stars || "☆☆☆☆☆"}</div>
          <div className="text-[12px] text-[#ffd88a]">
            {sign.overall.toFixed(1)} / 5.0 ・ 客{sign.count}人
          </div>
        </div>
      )}
      <span className="absolute top-3 left-3.5 z-[5] px-2.5 py-1 text-[11px] tracking-[2px] text-[#ffd88a]" style={{ background: "#0d0904", border: "2px solid #5a4118" }}>
        ▸ バッチ{sign?.batch ?? "-"} の来店記録
      </span>
      <div className="relative block leading-[0]">
        <canvas
          ref={canvasRef}
          width={SCENE_W}
          height={SCENE_H}
          className="block w-full"
          style={{ imageRendering: "pixelated", height: "auto" }}
          aria-hidden
        />
        {mood && (
          <span
            className="pointer-events-none absolute left-1/2 z-[4] -translate-x-1/2 text-[16px] tracking-[2px]"
            style={{ bottom: "52%", color: mood === "happy" ? "#8adc8a" : mood === "gone" ? "#ff8a8a" : "rgba(255,220,160,.5)" }}
          >
            {MOOD_EMOJI[mood]}
          </span>
        )}
        <div
          className="pointer-events-none absolute inset-0 z-[2]"
          style={{ background: "radial-gradient(ellipse 78% 70% at 50% 42%, transparent 46%, rgba(0,0,0,.55) 100%)" }}
        />
      </div>
    </div>
  );
}
