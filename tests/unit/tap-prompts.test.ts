import { describe, expect, it } from "vitest";
import {
  DESIGN_FIDELITY_SENTENCE,
  INTRO_PROMPT,
  REPAIR_INTRO_PROMPT,
  repairPrompt,
  resumeIntroPrompt,
} from "@/lib/tap";

describe("ビルド系プロンプトのデザイン必須実装指示", () => {
  it("初回ビルドのイントロに含まれる", () => {
    expect(INTRO_PROMPT).toContain(DESIGN_FIDELITY_SENTENCE);
  });

  it("修理(改善)のイントロに含まれる", () => {
    expect(REPAIR_INTRO_PROMPT).toContain(DESIGN_FIDELITY_SENTENCE);
  });

  it("再開のイントロに含まれる", () => {
    expect(resumeIntroPrompt(3, 10)).toContain(DESIGN_FIDELITY_SENTENCE);
    expect(resumeIntroPrompt(0, null)).toContain(DESIGN_FIDELITY_SENTENCE);
  });

  it("指示文が装飾要素の省略禁止に言及している", () => {
    expect(DESIGN_FIDELITY_SENTENCE).toContain("03-design-system.md");
    expect(DESIGN_FIDELITY_SENTENCE).toContain("最小実装");
  });

  it("構造仕様・ハンドオフ・画像を必読にし、仕様値と見た目の正を区別する", () => {
    expect(DESIGN_FIDELITY_SENTENCE).toContain("design-handoff.md");
    expect(DESIGN_FIDELITY_SENTENCE).toContain("design-spec.json");
    expect(DESIGN_FIDELITY_SENTENCE).toContain("design-mock.png");
    expect(DESIGN_FIDELITY_SENTENCE).toContain("正確な");
    expect(DESIGN_FIDELITY_SENTENCE).toContain("見た目");
  });

  it("検証失敗後の修理指示にも構造仕様の必読指示を含める", () => {
    expect(repairPrompt(1, "type error")).toContain(DESIGN_FIDELITY_SENTENCE);
  });
});
