import { describe, expect, it } from "vitest";
import {
  buildGuestGrid,
  buildStoolGrid,
  colorFor,
  GUEST_H,
  GUEST_W,
  guestPalette,
  guestSeed,
  guestTraits,
  moodFromResult,
  STOOL_H,
  STOOL_W,
} from "@/lib/pub/guest-visual";

describe("guestSeed", () => {
  it("同じ名前なら毎回同じシード(決定論)", () => {
    expect(guestSeed("毎日メモ魔のアヤ")).toBe(guestSeed("毎日メモ魔のアヤ"));
  });
  it("違う名前は基本的に違うシード", () => {
    expect(guestSeed("アヤ")).not.toBe(guestSeed("ケンジ"));
  });
  it("非負整数を返す", () => {
    const s = guestSeed("テスト常連");
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

describe("guestTraits", () => {
  it("各特徴が想定レンジに収まる", () => {
    for (let seed = 0; seed < 200; seed++) {
      const t = guestTraits(seed);
      expect(t.hair).toBeGreaterThanOrEqual(0);
      expect(t.hair).toBeLessThanOrEqual(3);
      expect(t.drink).toBeGreaterThanOrEqual(0);
      expect(t.drink).toBeLessThanOrEqual(2);
      expect(typeof t.glasses).toBe("boolean");
      expect(t.sw).toBeGreaterThan(0);
      expect(t.hr).toBeGreaterThan(0);
    }
  });
});

describe("moodFromResult", () => {
  it("中断は gone", () => {
    expect(moodFromResult("aborted", 0)).toBe("gone");
    expect(moodFromResult("aborted", 4.9)).toBe("gone");
  });
  it("完走かつ 4 以上は happy", () => {
    expect(moodFromResult("completed", 4)).toBe("happy");
    expect(moodFromResult("completed", 5)).toBe("happy");
  });
  it("完走かつ 4 未満は meh", () => {
    expect(moodFromResult("completed", 3.9)).toBe("meh");
    expect(moodFromResult("completed", 0)).toBe("meh");
  });
});

function countKey(grid: string[], key: string): number {
  return grid.join("").split("").filter((c) => c === key).length;
}

describe("buildGuestGrid(ドット絵)", () => {
  it("寸法が正しく、既知の色キーだけを使う", () => {
    for (const seed of [0, 1, 2, 3, 42, 999]) {
      const grid = buildGuestGrid(seed, "happy");
      expect(grid).toHaveLength(GUEST_H);
      const pal = guestPalette(seed);
      for (const row of grid) {
        expect(row).toHaveLength(GUEST_W);
        for (const c of row) {
          if (c !== ".") expect(pal[c]).toBeDefined();
        }
      }
    }
  });

  it("決定論: 同じ入力なら同じグリッド", () => {
    expect(buildGuestGrid(42, "happy", 0)).toEqual(buildGuestGrid(42, "happy", 0));
  });

  it("表情で口のドット数が変わる(happy は口角+頬が増える)", () => {
    const happy = countKey(buildGuestGrid(42, "happy"), "M");
    const meh = countKey(buildGuestGrid(42, "meh"), "M");
    expect(happy).toBeGreaterThan(meh);
  });

  it("瞬きフレームは目のドットが減る", () => {
    const open = countKey(buildGuestGrid(42, "meh", 0), "E");
    const blink = countKey(buildGuestGrid(42, "meh", 2), "E");
    expect(blink).toBeLessThan(open);
    expect(blink).toBeGreaterThan(0);
  });

  it("呼吸フレームはグリッドが変わる(1px上がる)", () => {
    expect(buildGuestGrid(42, "meh", 1)).not.toEqual(buildGuestGrid(42, "meh", 0));
  });

  it("髪型のシード差分でグリッドが変わる", () => {
    // seed % 4 が髪型。0..3 で互いに異なる見た目になる
    const grids = [0, 1, 2, 3].map((h) => buildGuestGrid(h, "meh").join("\n"));
    expect(new Set(grids).size).toBe(4);
  });

  it("眼鏡のシードでは G キーが使われる", () => {
    // guestTraits: (seed >> 1) % 2 === 0 で眼鏡
    const withGlasses = [...Array(50).keys()].find((s) => guestTraits(s).glasses)!;
    const without = [...Array(50).keys()].find((s) => !guestTraits(s).glasses)!;
    expect(countKey(buildGuestGrid(withGlasses, "meh"), "G")).toBeGreaterThan(0);
    expect(countKey(buildGuestGrid(without, "meh"), "G")).toBe(0);
  });
});

describe("buildStoolGrid", () => {
  it("寸法とキー(W/L/K)が正しい", () => {
    const grid = buildStoolGrid();
    expect(grid).toHaveLength(STOOL_H);
    for (const row of grid) {
      expect(row).toHaveLength(STOOL_W);
      for (const c of row) expect([".", "K", "W", "L"]).toContain(c);
    }
    expect(countKey(grid, "W")).toBeGreaterThan(0);
    expect(countKey(grid, "L")).toBeGreaterThan(0);
  });
});

describe("guestPalette", () => {
  it("全キーが RGB 3要素を返し、seed で服の色が変わりうる", () => {
    const pal = guestPalette(7);
    for (const key of ["K", "S", "H", "C", "A", "E", "M", "G", "W", "L"]) {
      expect(pal[key]).toHaveLength(3);
    }
    const cloths = new Set([0, 1, 2, 3, 4, 5].map((s) => guestPalette(s).C.join(",")));
    expect(cloths.size).toBeGreaterThan(1);
  });
});

describe("colorFor", () => {
  it("既知タグは RGB 3要素を返す", () => {
    for (const tag of ["skin", "hair", "cloth", "collar", "eye", "mouth", "glass", "stool"]) {
      const c = colorFor(tag, 7);
      expect(c).toHaveLength(3);
      for (const ch of c) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });
});
