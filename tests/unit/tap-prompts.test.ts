import { describe, expect, it } from "vitest";
import {
  DESIGN_FIDELITY_SENTENCE,
  INTRO_PROMPT,
  REPAIR_INTRO_PROMPT,
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
});
