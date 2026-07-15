/**
 * Pub工程のバー演出で使う、客(ペルソナ)のドット絵描画ロジック。
 * 以前はローポリ3D(回転バスト)だったが、待ち工程アニメ「真夜中の醸造所」と
 * 世界観を揃えるため本物のドット絵(整数グリッド・限定パレット)に置き換えた。
 *
 * ここは framework 非依存の純ロジック。React には依存しない。
 * seed/traits/mood/grid の各関数は決定論的で、ユニットテスト対象。
 * canvas を触る関数(drawGridInto / drawDrink)はクライアントでのみ呼ばれる。
 */

export type Mood = "happy" | "meh" | "gone";
export type RGB = [number, number, number];
export interface GuestTraits {
  hair: number; // 0 short / 1 bun / 2 ponytail / 3 cap / 4 long / 5 hood / 6 spiky / 7 buzz
  glasses: boolean;
  facial: number; // 0-1 なし / 2 口ひげ / 3 あごひげ
  eyeStyle: number; // 0 丸目 / 1 細目
  accessory: number; // 0 なし / 1 イヤリング / 2 ネクタイ
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
    hair: seed % 8,
    glasses: (seed >> 1) % 2 === 0,
    facial: (seed >> 3) % 4,
    eyeStyle: (seed >> 5) % 2,
    accessory: (seed >> 4) % 3,
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

export function colorFor(tag: string, seed: number): RGB {
  if (tag === "skin") return SKIN[seed % SKIN.length];
  if (tag === "hair" || tag === "hat") return HAIR[(seed * 3 + 1) % HAIR.length];
  if (tag === "glass") return [196, 186, 164]; // 明るい金属フレーム(暗い目と分離して見せる)
  if (tag === "collar") return ACCENT[(seed * 5 + 1) % ACCENT.length];
  if (tag === "cloth") return CLOTH[(seed * 7 + 2) % CLOTH.length];
  if (tag === "eye") return [26, 20, 16];
  if (tag === "brow") return HAIR[(seed * 3 + 1) % HAIR.length];
  if (tag === "mouth") return [150, 72, 66];
  if (tag === "stool") return [90, 65, 24];
  if (tag === "stoolLeg") return [58, 42, 18];
  return [120, 100, 70];
}

// ---- ドット絵グリッド ----

export const GUEST_W = 28;
export const GUEST_H = 34;
export const STOOL_W = 20;
export const STOOL_H = 26;

/** グリッドの色キー → 実色(seed でパレットが決まる)。"." は透過 */
export function guestPalette(seed: number): Record<string, RGB> {
  return {
    K: [15, 10, 6], // 輪郭
    S: colorFor("skin", seed),
    H: colorFor("hair", seed),
    C: colorFor("cloth", seed),
    A: colorFor("collar", seed),
    E: colorFor("eye", seed),
    M: colorFor("mouth", seed),
    G: colorFor("glass", seed),
    W: colorFor("stool", seed),
    L: colorFor("stoolLeg", seed),
  };
}

/** 客の1フレーム(0=通常 / 1=呼吸で1px上がる / 2=瞬き)をドット絵グリッドで返す純関数 */
export function buildGuestGrid(seed: number, mood: Mood, frame = 0): string[] {
  const tr = guestTraits(seed);
  const g: string[][] = Array.from({ length: GUEST_H }, () => Array<string>(GUEST_W).fill("."));
  const put = (x: number, y: number, c: string): void => {
    if (x >= 0 && x < GUEST_W && y >= 0 && y < GUEST_H) g[y][x] = c;
  };
  const hline = (x0: number, x1: number, y: number, c: string): void => {
    for (let x = x0; x <= x1; x++) put(x, y, c);
  };

  const cx = 14;
  const up = frame === 1 ? 1 : 0; // 吸うと上半身が1px上がる
  const hw = 7 + (seed % 3); // 胴の半幅(traits.sw と同じ3段階)
  const hr = 5 + ((seed >> 2) % 2); // 頭の半径(traits.hr と同じ2段階)

  // 胴(下端は固定、肩だけ呼吸で上下)
  const shoulderY = 25 - up;
  for (let y = shoulderY; y < GUEST_H; y++) {
    const t = Math.min(1, (y - shoulderY) / 6);
    const w = Math.round(hw * (0.72 + 0.28 * t));
    hline(cx - w, cx + w, y, "C");
    put(cx - w, y, "K");
    put(cx + w, y, "K");
  }
  hline(cx - Math.round(hw * 0.72), cx + Math.round(hw * 0.72), shoulderY - 1, "K");
  // 襟(差し色)と首
  hline(cx - 3, cx + 3, shoulderY, "A");
  hline(cx - 2, cx + 2, shoulderY + 1, "A");
  hline(cx - 1, cx + 1, shoulderY - 3, "S");
  hline(cx - 1, cx + 1, shoulderY - 2, "S");

  // 頭(ピクセル円+輪郭)。髪の生え際は髪型で変わる
  const headCy = shoulderY - 4 - hr;
  // 生え際のしきい値: 通常は上部40%、刈り上げはてっぺんだけ、フードは髪を描かない
  const hairline = tr.hair === 7 ? -hr * 0.55 : tr.hair === 5 ? -hr - 9 : -hr * 0.2;
  for (let dy = -hr; dy <= hr; dy++) {
    const w = Math.round(Math.sqrt(hr * hr - dy * dy) * 1.05);
    const y = headCy + dy;
    hline(cx - w, cx + w, y, dy < hairline ? "H" : "S");
    put(cx - w - 1, y, "K");
    put(cx + w + 1, y, "K");
  }
  hline(cx - Math.round(hr * 0.6), cx + Math.round(hr * 0.6), headCy - hr - 1, "K");
  hline(cx - Math.round(hr * 0.6), cx + Math.round(hr * 0.6), headCy + hr + 1, "K");
  // もみあげ(髪の側面)。刈り上げとフードでは描かない
  if (tr.hair !== 5 && tr.hair !== 7) {
    put(cx - hr, headCy, "H");
    put(cx + hr, headCy, "H");
  }

  // 髪型の差分
  if (tr.hair === 1) {
    // お団子
    for (let dy = -2; dy <= 0; dy++) {
      const w = 2 - Math.abs(dy);
      hline(cx - w, cx + w, headCy - hr - 2 + dy, "H");
    }
  } else if (tr.hair === 2) {
    // ポニーテール(右側に垂れる)
    for (let y = headCy; y <= shoulderY - 1; y++) {
      put(cx + hr + 1, y, "H");
      put(cx + hr + 2, y, "H");
    }
    put(cx + hr + 1, shoulderY, "H");
  } else if (tr.hair === 3) {
    // 帽子(つば+クラウン)
    hline(cx - hr - 2, cx + hr + 2, headCy - Math.round(hr * 0.4), "H");
    for (let y = headCy - hr - 2; y < headCy - Math.round(hr * 0.4); y++) {
      hline(cx - Math.round(hr * 0.8), cx + Math.round(hr * 0.8), y, "H");
    }
  } else if (tr.hair === 4) {
    // ロング(両サイドに肩まで垂れる)
    for (let y = headCy - 1; y <= shoulderY; y++) {
      put(cx - hr - 1, y, "H");
      put(cx - hr, y, "H");
      put(cx + hr, y, "H");
      put(cx + hr + 1, y, "H");
    }
    hline(cx - hr - 1, cx + hr + 1, headCy - hr, "H");
  } else if (tr.hair === 5) {
    // フード(服と同じ色。頭頂と側面を覆い、顔だけのぞく)
    for (let dy = -hr - 2; dy <= Math.round(hr * 0.7); dy++) {
      const y = headCy + dy;
      const w = Math.round(Math.sqrt(Math.max(0, (hr + 2) * (hr + 2) - dy * dy)));
      if (dy < -hr * 0.35) {
        hline(cx - w, cx + w, y, "C");
      } else {
        put(cx - w, y, "C");
        put(cx - w + 1, y, "C");
        put(cx + w - 1, y, "C");
        put(cx + w, y, "C");
      }
      put(cx - w - 1, y, "K");
      put(cx + w + 1, y, "K");
    }
  } else if (tr.hair === 6) {
    // ツンツン(頭頂にギザギザ)
    for (const [dx, h] of [
      [-4, 1],
      [-2, 2],
      [0, 3],
      [2, 2],
      [4, 1],
    ] as const) {
      for (let i = 0; i < h; i++) put(cx + dx, headCy - hr - 1 - i, "H");
    }
  }

  // 目・眉・口
  const ey = headCy + 1;
  const ex = Math.max(2, hr - 3) + 1;
  if (frame === 2) {
    // 瞬き(閉じ目)
    hline(cx - ex - 1, cx - ex, ey + 1, "E");
    hline(cx + ex, cx + ex + 1, ey + 1, "E");
  } else if (tr.eyeStyle === 1) {
    // 細目(横1列)
    hline(cx - ex - 1, cx - ex, ey, "E");
    hline(cx + ex, cx + ex + 1, ey, "E");
  } else {
    // 丸目(2x2)
    for (const sx of [cx - ex - 1, cx + ex]) {
      put(sx, ey, "E");
      put(sx + 1, ey, "E");
      put(sx, ey + 1, "E");
      put(sx + 1, ey + 1, "E");
    }
  }
  hline(cx - ex - 1, cx - ex + 1, ey - 2, "H");
  hline(cx + ex - 1, cx + ex + 1, ey - 2, "H");
  const my = headCy + hr - 1;
  // ひげ(口より先に描き、口が上書きする)
  if (tr.facial === 2) {
    // 口ひげ
    hline(cx - 2, cx + 2, my - 1, "H");
  } else if (tr.facial === 3) {
    // あごひげ(あごを覆って1px下まで)
    hline(cx - 3, cx + 3, my + 1, "H");
    hline(cx - 2, cx + 2, my + 2, "H");
  }
  if (mood === "happy") {
    // 笑顔(U字)+頬
    put(cx - 2, my - 1, "M");
    put(cx + 2, my - 1, "M");
    hline(cx - 1, cx + 1, my, "M");
    put(cx - ex - 2, my - 2, "M");
    put(cx + ex + 2, my - 2, "M");
  } else {
    hline(cx - 1, cx + 1, my, "M");
  }
  // アクセサリー
  if (tr.accessory === 1) {
    // イヤリング(両耳の下に差し色)
    put(cx - hr - 1, headCy + 2, "A");
    put(cx + hr + 1, headCy + 2, "A");
  } else if (tr.accessory === 2) {
    // ネクタイ(襟から胸へ)
    hline(cx - 1, cx + 1, shoulderY + 2, "A");
    for (let y = shoulderY + 3; y <= shoulderY + 6; y++) put(cx, y, "A");
    put(cx - 1, shoulderY + 4, "A");
    put(cx + 1, shoulderY + 4, "A");
  }
  if (tr.glasses) {
    // 細い縁(上下ライン+外側の縦だけ)にして、目を覆い隠さない
    const lgx = cx - ex - 2;
    const rgx = cx + ex - 1;
    hline(lgx, lgx + 3, ey - 1, "G");
    hline(lgx, lgx + 3, ey + 2, "G");
    hline(rgx, rgx + 3, ey - 1, "G");
    hline(rgx, rgx + 3, ey + 2, "G");
    put(lgx, ey, "G");
    put(lgx, ey + 1, "G");
    put(rgx + 3, ey, "G");
    put(rgx + 3, ey + 1, "G");
    put(cx, ey, "G"); // ブリッジ
  }

  return g.map((row) => row.join(""));
}

/** 中断した客の空きスツール(ドット絵グリッド) */
export function buildStoolGrid(): string[] {
  const g: string[][] = Array.from({ length: STOOL_H }, () => Array<string>(STOOL_W).fill("."));
  const put = (x: number, y: number, c: string): void => {
    if (x >= 0 && x < STOOL_W && y >= 0 && y < STOOL_H) g[y][x] = c;
  };
  const hline = (x0: number, x1: number, y: number, c: string): void => {
    for (let x = x0; x <= x1; x++) put(x, y, c);
  };
  // 座面
  hline(2, 17, 6, "K");
  hline(1, 18, 7, "W");
  hline(1, 18, 8, "W");
  hline(2, 17, 9, "K");
  // 脚(ハの字)+貫
  for (let y = 10; y < STOOL_H - 1; y++) {
    const spread = Math.round((y - 10) / 6);
    put(4 - spread, y, "L");
    put(5 - spread, y, "L");
    put(14 + spread, y, "L");
    put(15 + spread, y, "L");
  }
  hline(5, 14, 17, "L");
  hline(3, 16, STOOL_H - 1, "K");
  return g.map((row) => row.join(""));
}

// ---- canvas 描画(クライアント専用) ----

/** 色キーグリッドを fillRect で描く(クリアはしない=背景の上に重ねる) */
export function drawGridInto(
  ctx: CanvasRenderingContext2D,
  grid: string[],
  palette: Record<string, RGB>,
  x: number,
  y: number,
  scale: number,
): void {
  for (let gy = 0; gy < grid.length; gy++) {
    const row = grid[gy];
    for (let gx = 0; gx < row.length; gx++) {
      const key = row[gx];
      if (key === ".") continue;
      const c = palette[key];
      if (!c) continue;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(x + gx * scale, y + gy * scale, scale, scale);
    }
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
