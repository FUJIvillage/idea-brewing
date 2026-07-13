/**
 * Pub工程のCoffee Talk風バー演出で使う、客(ペルソナ)のローポリ3D描画ロジック。
 * ps1-tank.tsx と同じ実時間フラットシェーディング方式を拡張し、PS1らしさとして
 * Bayer 4x4 オーダードディザ / 15bitカラー量子化 / 頂点ワブル / 二灯ライティングを足す。
 *
 * ここは framework 非依存の純ロジック。React には依存しない。
 * seed/traits/mood の各関数は決定論的で、ユニットテスト対象。
 * canvas を触る関数(renderFigureInto など)はクライアントでのみ呼ばれる。
 */

export type Mood = "happy" | "meh" | "gone";
export type RGB = [number, number, number];
export interface Face {
  v: [number, number, number][];
  tag: string;
}
export interface GuestTraits {
  hair: number; // 0 short / 1 bun / 2 ponytail / 3 cap
  glasses: boolean;
  drink: number; // 0 beer / 1 coffee / 2 wine
  sw: number; // 肩幅
  hr: number; // 頭の半径
  hcy: number; // 頭の中心Y
}

// ---- 決定論的な見た目の決定(テスト対象) ----

/** ペルソナ名から安定したシード値を作る(同じ名前なら毎回同じ顔) */
export function guestSeed(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100000;
}

export function guestTraits(seed: number): GuestTraits {
  return {
    hair: seed % 4,
    glasses: (seed >> 1) % 2 === 0,
    drink: seed % 3,
    sw: 0.58 + (seed % 3) * 0.055,
    hr: 0.4 + ((seed >> 2) % 2) * 0.045,
    hcy: 0.72,
  };
}

/** セッション結果から客の機嫌を決める。aborted は席を立った=gone */
export function moodFromResult(status: "completed" | "aborted", overall: number): Mood {
  if (status === "aborted") return "gone";
  return overall >= 4 ? "happy" : "meh";
}

// ---- パレット ----

const SKIN: RGB[] = [
  [230, 176, 136],
  [217, 154, 102],
  [201, 138, 90],
  [240, 195, 154],
  [184, 120, 72],
];
const HAIR: RGB[] = [
  [58, 42, 24],
  [90, 58, 26],
  [32, 20, 10],
  [107, 74, 34],
  [64, 42, 64],
  [150, 150, 158],
];
const CLOTH: RGB[] = [
  [122, 74, 154],
  [58, 106, 138],
  [138, 90, 42],
  [90, 122, 58],
  [154, 74, 74],
  [58, 90, 106],
];
const ACCENT: RGB[] = [
  [214, 138, 42],
  [90, 160, 180],
  [200, 90, 110],
  [120, 190, 120],
  [230, 200, 110],
];
const STOOL: RGB[] = [
  [90, 65, 24],
  [58, 42, 18],
];
const BANDS = [0.34, 0.56, 0.78, 1];
const RIM: RGB = [70, 120, 190]; // 窓からの寒色リム
const NS = 9; // リング分割数

export function colorFor(tag: string, seed: number): RGB {
  if (tag === "skin") return SKIN[seed % SKIN.length];
  if (tag === "hair" || tag === "hat") return HAIR[(seed * 3 + 1) % HAIR.length];
  if (tag === "glass") return [24, 20, 14];
  if (tag === "collar") return ACCENT[(seed * 5 + 1) % ACCENT.length];
  if (tag === "cloth") return CLOTH[(seed * 7 + 2) % CLOTH.length];
  if (tag === "eye") return [26, 20, 16];
  if (tag === "brow") return HAIR[(seed * 3 + 1) % HAIR.length];
  if (tag === "mouth") return [150, 72, 66];
  if (tag === "stool") return STOOL[0];
  if (tag === "stoolLeg") return STOOL[1];
  return [120, 100, 70];
}

// ---- ジオメトリ ----

function ringFaces(
  faces: Face[],
  y0: number,
  y1: number,
  r0: number,
  r1: number,
  tag: string,
  ox = 0,
  oz = 0,
): void {
  for (let i = 0; i < NS; i++) {
    const a0 = (i / NS) * Math.PI * 2;
    const a1 = ((i + 1) / NS) * Math.PI * 2;
    faces.push({
      v: [
        [ox + Math.cos(a0) * r0, y0, oz + Math.sin(a0) * r0],
        [ox + Math.cos(a1) * r0, y0, oz + Math.sin(a1) * r0],
        [ox + Math.cos(a1) * r1, y1, oz + Math.sin(a1) * r1],
        [ox + Math.cos(a0) * r1, y1, oz + Math.sin(a0) * r1],
      ],
      tag,
    });
  }
}

function addSphere(
  faces: Face[],
  cx: number,
  cy: number,
  cz: number,
  r: number,
  tag: string,
  lb = 4,
): void {
  for (let k = 0; k < lb; k++) {
    const l0 = -Math.PI / 2 + Math.PI * (k / lb);
    const l1 = -Math.PI / 2 + Math.PI * ((k + 1) / lb);
    ringFaces(faces, cy + Math.sin(l0) * r, cy + Math.sin(l1) * r, Math.cos(l0) * r, Math.cos(l1) * r, tag, cx, cz);
  }
}

function addQuad(faces: Face[], cx: number, cy: number, cz: number, w: number, h: number, tag: string): void {
  faces.push({
    v: [
      [cx - w, cy - h, cz],
      [cx + w, cy - h, cz],
      [cx + w, cy + h, cz],
      [cx - w, cy + h, cz],
    ],
    tag,
  });
}

/** 客のローポリ・バスト(胴+首+頭+髪型+顔+小道具のシード差分)を組み立てる */
export function buildFigure(seed: number, mood: Mood): Face[] {
  const f: Face[] = [];
  const tr = guestTraits(seed);
  const { sw, hr, hcy } = tr;
  ringFaces(f, -0.95, -0.45, 0.46, 0.5, "cloth");
  ringFaces(f, -0.45, -0.05, 0.5, sw, "cloth");
  ringFaces(f, -0.05, 0.1, sw, 0.3, "collar");
  ringFaces(f, 0.1, 0.3, 0.15, 0.15, "skin"); // neck
  const lb = 5;
  for (let k = 0; k < lb; k++) {
    const l0 = -Math.PI / 2 + Math.PI * (k / lb);
    const l1 = -Math.PI / 2 + Math.PI * ((k + 1) / lb);
    ringFaces(
      f,
      hcy + Math.sin(l0) * hr,
      hcy + Math.sin(l1) * hr,
      Math.cos(l0) * hr,
      Math.cos(l1) * hr,
      k >= lb - 2 ? "hair" : "skin",
    );
  }
  // 髪型
  if (tr.hair === 1) {
    addSphere(f, 0, hcy + hr * 0.55, -hr * 0.55, hr * 0.42, "hair", 4);
  } else if (tr.hair === 2) {
    for (let s = 0; s < 3; s++) addSphere(f, 0, hcy - 0.05 - s * 0.24, -hr * 0.72, hr * (0.3 - s * 0.05), "hair", 4);
  } else if (tr.hair === 3) {
    ringFaces(f, hcy + hr * 0.62, hcy + hr * 0.98, hr * 1.02, hr * 0.5, "hat");
    ringFaces(f, hcy + hr * 0.55, hcy + hr * 0.62, hr * 1.18, hr * 1.18, "hat", 0, 0.2);
  } else {
    for (let s = 0; s < 2; s++) ringFaces(f, hcy - 0.02 - s * 0.14, hcy + 0.1 - s * 0.14, hr * 0.9, hr * 0.7, "hair", 0, -hr * 0.35);
  }
  // 顔(前面に少し浮かせて配置。横を向くと自然に隠れる)
  const ez = hr * 1.02;
  const ey = hcy + hr * 0.1;
  const ex = hr * 0.36;
  const es = hr * 0.12;
  addQuad(f, -ex, ey, ez, es * 0.9, es, "eye");
  addQuad(f, ex, ey, ez, es * 0.9, es, "eye");
  addQuad(f, -ex, ey + es * 1.7, ez, es * 1.1, es * 0.35, "brow");
  addQuad(f, ex, ey + es * 1.7, ez, es * 1.1, es * 0.35, "brow");
  const my = hcy - hr * 0.3;
  const mw = mood === "happy" ? hr * 0.3 : hr * 0.18;
  addQuad(f, 0, my, ez, mw, hr * 0.055, "mouth");
  if (mood === "happy") {
    addQuad(f, -mw, my + hr * 0.07, ez, hr * 0.05, hr * 0.05, "mouth");
    addQuad(f, mw, my + hr * 0.07, ez, hr * 0.05, hr * 0.05, "mouth");
  }
  if (tr.glasses) {
    ringFaces(f, hcy + hr * 0.02, hcy + hr * 0.2, hr * 1.03, hr * 1.03, "glass");
  }
  return f;
}

/** 中断した客の空きスツール */
export function buildStool(): Face[] {
  const f: Face[] = [];
  ringFaces(f, -0.95, -0.3, 0.1, 0.1, "stoolLeg");
  ringFaces(f, -0.3, -0.24, 0.42, 0.42, "stool");
  ringFaces(f, -0.24, -0.2, 0.42, 0.36, "stool");
  return f;
}

// ---- PS1 シグネチャ: 15bit量子化 + Bayer 4x4 ディザ ----

export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const q5 = (c: number): number => {
  const v = c < 0 ? 0 : c > 255 ? 255 : c | 0;
  return (v >> 3) << 3;
};

const ditherCache: Record<string, CanvasPattern | null> = {};
function ditherPattern(ctx: CanvasRenderingContext2D, c0: number[], c1: number[], lvl: number): CanvasPattern | null {
  const key = `${c0[0]},${c0[1]},${c0[2]}|${c1[0]},${c1[1]},${c1[2]}|${lvl}`;
  const cached = ditherCache[key];
  if (cached !== undefined) return cached;
  const tile = document.createElement("canvas");
  tile.width = 4;
  tile.height = 4;
  const tctx = tile.getContext("2d");
  if (!tctx) return null;
  const img = tctx.createImageData(4, 4);
  for (let i = 0; i < 16; i++) {
    const c = BAYER[i] < lvl ? c1 : c0;
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  const pat = ctx.createPattern(tile, "repeat");
  ditherCache[key] = pat;
  return pat;
}

function mix(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * ローポリの客を ctx に描く(クリアはしない=背景の上に重ねる)。
 * cx,cy は画面上の中心、focal は焦点距離。回転角 t。
 */
export function renderFigureInto(
  ctx: CanvasRenderingContext2D,
  faces: Face[],
  seed: number,
  t: number,
  cx: number,
  cy: number,
  focal: number,
): void {
  const ct = Math.cos(t);
  const st = Math.sin(t);
  const tilt = 0.18;
  const cT = Math.cos(tilt);
  const sT = Math.sin(tilt);
  const d = 3.4;
  const lx = 0.45;
  const ly = 0.68;
  const lz = -0.55;
  const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const rx = -0.6;
  const ry = 0.25;
  const rz = 0.5;
  const rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
  const xform = (p: number[]): [number, number, number] => {
    const x = p[0] * ct + p[2] * st;
    const z = -p[0] * st + p[2] * ct;
    const y = p[1];
    return [x, y * cT - z * sT, y * sT + z * cT];
  };
  const proj = (v: [number, number, number]): [number, number] => [
    Math.round(cx + (v[0] * focal) / (v[2] + d)),
    Math.round(cy - (v[1] * focal) / (v[2] + d)),
  ];
  const polys: { pts: [number, number][]; base: RGB; shade: number; rim: number; depth: number }[] = [];
  for (const face of faces) {
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
    const rim = Math.max(0, (nx * rx + ny * ry + nz * rz) / rl);
    polys.push({
      pts: pv.map(proj),
      base: colorFor(face.tag, seed),
      shade,
      rim,
      depth: (pv[0][2] + pv[1][2] + pv[2][2] + pv[3][2]) / 4,
    });
  }
  polys.sort((a, b) => b.depth - a.depth);
  for (const p of polys) {
    ctx.beginPath();
    ctx.moveTo(p.pts[0][0], p.pts[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
    ctx.closePath();
    const bf = Math.min(3, p.shade * 3);
    const lo = Math.floor(bf);
    const hi = Math.min(3, lo + 1);
    const frac = bf - lo;
    const rimT = p.rim * p.rim * 0.55;
    const c0 = mix(p.base.map((c) => c * BANDS[lo]), RIM, rimT).map(q5);
    const c1 = mix(p.base.map((c) => c * BANDS[hi]), RIM, rimT).map(q5);
    const lvl = Math.round(frac * 16);
    const solid0 = `rgb(${c0[0]},${c0[1]},${c0[2]})`;
    ctx.fillStyle =
      lvl <= 0 ? solid0 : lvl >= 16 ? `rgb(${c1[0]},${c1[1]},${c1[2]})` : ditherPattern(ctx, c0, c1, lvl) ?? solid0;
    ctx.strokeStyle = solid0;
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  }
}

/** カウンターに置く飲み物(0=ビール / 1=コーヒー / 2=ワイン)をピクセルで描く */
export function drawDrink(ctx: CanvasRenderingContext2D, bx: number, by: number, u: number, kind: number): void {
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(bx + x * u, by - y * u, w * u, h * u);
  };
  if (kind === 0) {
    px(0, 0, 4, 5, "#7a4a06");
    px(0, 1, 4, 3, "#e59b12");
    px(0, 3, 4, 2, "#c8860f");
    px(0, 4, 4, 1, "#f7f0d8");
    px(4, 1, 1, 3, "#5a3a06");
  } else if (kind === 1) {
    px(-1, 0, 6, 1, "#c9a15c");
    px(0, 1, 4, 3, "#efe6d0");
    px(0, 2, 4, 2, "#4a2a12");
    px(4, 2, 1, 2, "#efe6d0");
    ctx.fillStyle = "rgba(255,243,214,.5)";
    ctx.fillRect(bx + 1 * u, by - 6 * u, u, u);
    ctx.fillRect(bx + 2 * u, by - 7 * u, u, u);
  } else {
    px(1, 0, 2, 1, "#7a4a06");
    px(1, 1, 2, 2, "#c9a15c");
    px(0, 3, 4, 3, "#efe6d0");
    px(1, 3, 2, 2, "#7a1030");
  }
}
