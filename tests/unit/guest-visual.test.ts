import { describe, expect, it } from "vitest";
import {
  buildFigure,
  buildStool,
  colorFor,
  guestSeed,
  guestTraits,
  moodFromResult,
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

describe("geometry", () => {
  it("buildFigure は面を持ち、各面は4頂点の三次元座標", () => {
    const faces = buildFigure(guestSeed("アヤ"), "happy");
    expect(faces.length).toBeGreaterThan(0);
    for (const f of faces) {
      expect(f.v).toHaveLength(4);
      for (const v of f.v) expect(v).toHaveLength(3);
      expect(typeof f.tag).toBe("string");
    }
  });
  it("表情で口の面数が変わる(happy は口角が増える)", () => {
    const happy = buildFigure(42, "happy").filter((f) => f.tag === "mouth").length;
    const meh = buildFigure(42, "meh").filter((f) => f.tag === "mouth").length;
    expect(happy).toBeGreaterThan(meh);
  });
  it("buildStool は空きスツールの面を返す", () => {
    const faces = buildStool();
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((f) => f.tag === "stool" || f.tag === "stoolLeg")).toBe(true);
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
