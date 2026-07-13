"use client";

import { useEffect, useRef } from "react";

const N = 9;
const R = 6;
const BODY_H = 1.35;

type Face = { v: [number, number, number][]; tag: string };

function buildFaces(): Face[] {
  const faces: Face[] = [];
  const ring = (y0: number, y1: number, r0: number, r1: number, tag: string) => {
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      faces.push({
        v: [
          [Math.cos(a0) * r0, y0, Math.sin(a0) * r0],
          [Math.cos(a1) * r0, y0, Math.sin(a1) * r0],
          [Math.cos(a1) * r1, y1, Math.sin(a1) * r1],
          [Math.cos(a0) * r1, y1, Math.sin(a0) * r1],
        ],
        tag,
      });
    }
  };
  ring(-0.16, 0, 0.7, 0.62, "dark");
  for (let k = 0; k < R; k++) {
    ring((k / R) * BODY_H, ((k + 1) / R) * BODY_H, 0.58, 0.58, `body${k}`);
  }
  ring(BODY_H, 1.64, 0.58, 0.2, "steel");
  ring(1.64, 1.9, 0.2, 0.2, "steel");
  ring(1.9, 1.98, 0.25, 0.25, "dark");
  return faces;
}

const COLORS: Record<string, [number, number, number]> = {
  liquid: [235, 152, 30],
  steel: [128, 126, 140],
  dark: [86, 72, 56],
};
const BANDS = [0.34, 0.56, 0.78, 1];
const FACES = buildFaces();

export function Ps1Tank({
  fill = 0,
  size = 130,
  speed = 0.85,
  className,
}: {
  fill?: number;
  size?: number;
  speed?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tRef = useRef(Math.random() * Math.PI * 2);
  const lastRef = useRef(0);
  const fillRef = useRef(fill);
  const speedRef = useRef(speed);

  fillRef.current = fill;
  speedRef.current = speed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let running = true;
    lastRef.current = performance.now();

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const fillPct = Math.max(0, Math.min(100, fillRef.current));
      const t = tRef.current;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const tilt = 0.34;
      const cT = Math.cos(tilt);
      const sT = Math.sin(tilt);
      const d = 3.3;
      const f = 50;
      const lx = 0.45;
      const ly = 0.68;
      const lz = -0.55;
      const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);

      const xform = (p: [number, number, number]): [number, number, number] => {
        const x = p[0] * ct + p[2] * st;
        const z = -p[0] * st + p[2] * ct;
        const y = p[1] - 0.92;
        return [x, y * cT - z * sT, y * sT + z * cT];
      };
      const proj = (v: [number, number, number]): [number, number] => [
        Math.round(W / 2 + (v[0] * f) / (v[2] + d)),
        Math.round(H * 0.55 - (v[1] * f) / (v[2] + d)),
      ];

      const polys: { pts: [number, number][]; col: number[]; depth: number }[] = [];
      for (const face of FACES) {
        const pv = face.v.map(xform);
        const e1 = [pv[1][0] - pv[0][0], pv[1][1] - pv[0][1], pv[1][2] - pv[0][2]];
        const e2 = [pv[3][0] - pv[0][0], pv[3][1] - pv[0][1], pv[3][2] - pv[0][2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let nz = e1[0] * e2[1] - e1[1] * e2[0];
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl;
        ny /= nl;
        nz /= nl;
        if (nz > 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const shade = Math.max(0.05, (nx * lx + ny * ly + nz * lz) / ll);
        const q = BANDS[Math.min(3, Math.floor(shade * 4))];

        let base: [number, number, number];
        if (face.tag.indexOf("body") === 0) {
          const k = parseInt(face.tag.slice(4), 10);
          base = ((k + 0.5) / R) * 100 <= fillPct ? COLORS.liquid : COLORS.steel;
        } else {
          base = COLORS[face.tag] ?? COLORS.dark;
        }
        const col = base.map((c) => Math.round(c * q));
        const depth = (pv[0][2] + pv[1][2] + pv[2][2] + pv[3][2]) / 4;
        polys.push({ pts: pv.map(proj), col, depth });
      }

      polys.sort((a, b) => b.depth - a.depth);
      for (const p of polys) {
        ctx.beginPath();
        ctx.moveTo(p.pts[0][0], p.pts[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = `rgb(${p.col[0]},${p.col[1]},${p.col[2]})`;
        ctx.strokeStyle = `rgb(${Math.round(p.col[0] * 0.5)},${Math.round(p.col[1] * 0.5)},${Math.round(p.col[2] * 0.5)})`;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }

      if (fillPct > 0) {
        for (let i = 0; i < 3; i++) {
          const pr = (t * 0.35 + i / 3) % 1;
          const p = proj(xform([0, 2.05 + pr * 0.6, 0]));
          ctx.globalAlpha = Math.max(0, 1 - pr);
          ctx.fillStyle = i === 1 ? "#fff3d6" : "#ffd88a";
          ctx.fillRect(p[0] + (i - 1) * 3, p[1], 2, 2);
        }
        ctx.globalAlpha = 1;
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - lastRef.current) / 1000);
      lastRef.current = now;
      tRef.current += dt * speedRef.current;
      draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => {
      running = false;
    };
  }, []);

  const width = (size * 84) / 104;

  return (
    <canvas
      ref={canvasRef}
      width={84}
      height={104}
      className={className}
      style={{
        imageRendering: "pixelated",
        display: "block",
        height: size,
        width,
      }}
      aria-hidden
    />
  );
}
