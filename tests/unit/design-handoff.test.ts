import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDesignHandoff,
  DESIGN_HANDOFF_MD,
  DESIGN_SPEC_JSON,
  writeDesignHandoff,
} from "@/lib/design/handoff";

const penDocument = {
  version: "2.14",
  children: [
    {
      type: "frame",
      id: "screen-home",
      name: "Home",
      width: 1280,
      height: 720,
      layout: "vertical",
      children: [
        {
          type: "frame",
          id: "button-primary",
          name: "Primary Button",
          reusable: true,
          width: 160,
          height: 44,
          children: [],
        },
      ],
    },
  ],
  variables: {
    primary: { type: "color", value: "#B93832" },
    "space-4": { type: "number", value: 16 },
    "font-sans": { type: "string", value: "Inter" },
  },
};

describe("buildDesignHandoff", () => {
  it("Pencil原本の全構造をdesign-spec.jsonへ保持する", () => {
    const result = buildDesignHandoff(JSON.stringify(penDocument));
    expect(JSON.parse(result.specJson)).toEqual(penDocument);
    expect(result.specJson.endsWith("\n")).toBe(true);
  });

  it("画面・変数・再利用コンポーネントをMarkdownへ要約する", () => {
    const result = buildDesignHandoff(JSON.stringify(penDocument));
    expect(result.handoffMarkdown).toContain("# Pencil デザインハンドオフ");
    expect(result.handoffMarkdown).toContain("Home");
    expect(result.handoffMarkdown).toContain("1280 × 720");
    expect(result.handoffMarkdown).toContain("primary");
    expect(result.handoffMarkdown).toContain("#B93832");
    expect(result.handoffMarkdown).toContain("space-4");
    expect(result.handoffMarkdown).toContain("Primary Button");
    expect(result.handoffMarkdown).toContain("design-spec.json");
    expect(result.handoffMarkdown).toContain("design-mock.png");
  });

  it("不正JSONまたはchildrenがない文書を拒否する", () => {
    expect(() => buildDesignHandoff("not json")).toThrow("mock.pen");
    expect(() => buildDesignHandoff(JSON.stringify({ version: "2.14" }))).toThrow("children");
  });

  it("成果物のファイル名を固定する", () => {
    expect(DESIGN_SPEC_JSON).toBe("design-spec.json");
    expect(DESIGN_HANDOFF_MD).toBe("design-handoff.md");
  });

  it("designディレクトリへ2つの成果物を書き出す", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "design-handoff-"));
    try {
      await fs.writeFile(path.join(dir, "mock.pen"), JSON.stringify(penDocument), "utf8");
      await writeDesignHandoff(dir);
      expect(JSON.parse(await fs.readFile(path.join(dir, DESIGN_SPEC_JSON), "utf8"))).toEqual(
        penDocument,
      );
      expect(await fs.readFile(path.join(dir, DESIGN_HANDOFF_MD), "utf8")).toContain(
        "Primary Button",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
