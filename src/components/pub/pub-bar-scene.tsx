"use client";

import { useEffect, useRef } from "react";
import type { PubPersonaResult } from "@/lib/store/types";
import {
  buildGuestGrid,
  buildStoolGrid,
  drawDrink,
  drawGridInto,
  GUEST_H,
  GUEST_W,
  guestPalette,
  guestSeed,
  guestTraits,
  moodFromResult,
  STOOL_H,
  STOOL_W,
  type RGB,
} from "@/lib/pub/guest-visual";

const SCENE_W = 240;
const SCENE_H = 150;
// bg_pub_bar(public/pub/bar-bg.png)の metadata と一致させる
const COUNTER_Y = 126;
const FLAME = { x: 120, y: 21 };
const GUEST_SCALE = 2;

interface FigureState {
  /** 3フレーム分(通常/呼吸/瞬き)を事前に組んでおく。客なし・空席時は null */
  grids: [string[], string[], string[]] | null;
  stool: boolean;
  palette: Record<string, RGB>;
  drink: number;
}

function figureStateFor(result: PubPersonaResult | null): FigureState {
  if (!result) return { grids: null, stool: false, palette: guestPalette(0), drink: -1 };
  const seed = guestSeed(result.persona.name);
  if (result.status === "aborted") {
    return { grids: null, stool: true, palette: guestPalette(seed), drink: -1 };
  }
  const mood = moodFromResult(result.status, result.overall);
  return {
    grids: [
      buildGuestGrid(seed, mood, 0),
      buildGuestGrid(seed, mood, 1),
      buildGuestGrid(seed, mood, 2),
    ],
    stool: false,
    palette: guestPalette(seed),
    drink: guestTraits(seed).drink,
  };
}

/** ランタンの炎の明滅(背景に焼き込まれた基準の炎の上に描き足す) */
function drawFlame(ctx: CanvasRenderingContext2D, t: number): void {
  const phase = Math.floor(t * 3) % 3;
  const px = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };
  px(FLAME.x, FLAME.y, "#f5b94a");
  px(FLAME.x + 1, FLAME.y, "#ef7d57");
  px(FLAME.x, FLAME.y + 1, "#ffd88a");
  px(FLAME.x + 1, FLAME.y + 1, "#f5b94a");
  if (phase === 1) px(FLAME.x + 1, FLAME.y - 1, "#ef7d57");
  if (phase === 2) {
    px(FLAME.x, FLAME.y - 1, "#f5b94a");
    px(FLAME.x + 1, FLAME.y - 1, "#ffd88a");
  }
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
  // 瞬きの位相を客ごとにずらす
  const seedRef = useRef<number>(result ? guestSeed(result.persona.name) : 0);

  // 描画ループから最新の客を読むための ref(レンダー中の書き込み不可なので effect で同期)
  useEffect(() => {
    figRef.current = figureStateFor(result);
    seedRef.current = result ? guestSeed(result.persona.name) : 0;
  }, [result]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const bg = new Image();
    let bgReady = false;
    bg.onload = () => {
      bgReady = true;
    };
    bg.src = "/pub/bar-bg.png";

    const reduce =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let running = true;
    let t = 0.4;
    let last = performance.now();

    const draw = () => {
      if (bgReady) ctx.drawImage(bg, 0, 0);
      else {
        ctx.fillStyle = "#080402";
        ctx.fillRect(0, 0, SCENE_W, SCENE_H);
      }
      const fig = figRef.current;
      if (fig.stool) {
        // 空席のスツール: 座面がカウンターの少し上に見え、脚はカウンターの奥に隠れる
        drawGridInto(
          ctx,
          buildStoolGrid(),
          fig.palette,
          SCENE_W / 2 - STOOL_W,
          COUNTER_Y - STOOL_H * 2 + 22,
          2,
        );
      } else if (fig.grids) {
        // 呼吸(2秒周期)+ときどき瞬き。位相は客ごとにずらす
        const blink = !reduce && (t + (seedRef.current % 7)) % 4.3 < 0.18;
        const frame = blink ? 2 : t % 2 < 1 ? 0 : 1;
        // 胸から上がカウンターの上に見える高さ(下端はカウンターの奥に少し沈む)
        drawGridInto(
          ctx,
          fig.grids[reduce ? 0 : frame],
          fig.palette,
          SCENE_W / 2 - GUEST_W,
          COUNTER_Y + 8 - GUEST_H * GUEST_SCALE,
          GUEST_SCALE,
        );
      }
      // カウンター帯を背景から再ブリットして客の下半身を隠す(客はカウンターの奥)
      if (bgReady) {
        ctx.drawImage(
          bg,
          0,
          COUNTER_Y,
          SCENE_W,
          SCENE_H - COUNTER_Y,
          0,
          COUNTER_Y,
          SCENE_W,
          SCENE_H - COUNTER_Y,
        );
      }
      if (!fig.stool && fig.drink >= 0) {
        drawDrink(ctx, Math.round(SCENE_W * 0.62), SCENE_H - 23, 2, fig.drink);
      }
      drawFlame(ctx, reduce ? 0 : t);
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
    else bg.onload = () => draw(); // 静止でも背景ロード後に一度描き直す

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
