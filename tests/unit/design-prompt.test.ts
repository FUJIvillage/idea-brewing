import { describe, expect, it } from "vitest";
import { buildMockPrompt, MAX_MOCK_SCREENS } from "@/lib/design/prompt";

describe("buildMockPrompt", () => {
  it("新規生成: 仕様準拠・装飾必須・ゴミ要素抑止を含む", () => {
    const p = buildMockPrompt({ refine: false });
    expect(p).toContain("高忠実度モックアップ");
    expect(p).toContain("デザイントークン");
    expect(p).toContain("装飾要素");
    expect(p).toContain("メインフレームの外に要素を残さない");
  });

  it("新規生成: 画面一覧の複数画面を1キャンバスに並べる指示を含む", () => {
    const p = buildMockPrompt({ refine: false });
    expect(p).toContain("画面一覧");
    expect(p).toContain("それぞれ独立したフレーム");
    expect(p).toContain(`最大${MAX_MOCK_SCREENS}画面`);
    expect(p).toContain("画面が1つだけのサービスは1フレーム");
  });

  it("新規生成: 追加指示があれば末尾に含める", () => {
    const p = buildMockPrompt({ refine: false, instruction: "ダークテーマにして" });
    expect(p).toContain("追加指示:");
    expect(p).toContain("ダークテーマにして");
  });

  it("差分修正: 指示なしなら品質向上の既定文", () => {
    const p = buildMockPrompt({ refine: true });
    expect(p).toContain("既存のモックアップ");
    expect(p).toContain("仕様との差分を修正して");
    expect(p).toContain("メインフレームの外に要素を残さない");
  });

  it("差分修正: 指示があればそれを使う", () => {
    const p = buildMockPrompt({ refine: true, instruction: "左上のゴミ要素を消して" });
    expect(p).toContain("左上のゴミ要素を消して");
    expect(p).not.toContain("仕様との差分を修正して");
  });
});
