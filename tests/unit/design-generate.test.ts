import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildPencilArgs,
  generateDesignMock,
  hasDesignRecipe,
  parsePencilUsage,
} from "@/lib/design";
import { DesignNotConfiguredError, resolvePencilKey } from "@/lib/design/resolve";
import { createBrew, designDir, recipeDir } from "@/lib/store";
import type { Settings } from "@/lib/store/types";

const fakeSettings: Settings = {
  provider: "fake",
  apiKey: "",
  baseUrl: "",
  model: "",
  effort: "",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
  cursorEffort: "",
  cursorFast: "",
  pencilCliKey: "",
  pencilModel: "",
  boilMaxQuestions: 20,
};

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-design-"));
  delete process.env.PENCIL_CLI_KEY;
});

describe("parsePencilUsage", () => {
  it("PoC 実測形式の usage.json を読める", () => {
    const raw = JSON.stringify({
      agentType: "claude",
      model: "claude-opus-4-6",
      reason: "finished",
      usage: { totalCostUsd: 2.1763, durationMs: 304180, numTurns: 24 },
    });
    expect(parsePencilUsage(raw)).toEqual({
      model: "claude-opus-4-6",
      costUsd: 2.1763,
      durationMs: 304180,
    });
  });

  it("壊れた JSON や欠落フィールドでも失敗にしない", () => {
    expect(parsePencilUsage("not json")).toEqual({ model: "", costUsd: null, durationMs: null });
    expect(parsePencilUsage("{}")).toEqual({ model: "", costUsd: null, durationMs: null });
  });
});

describe("buildPencilArgs", () => {
  const base = { dir: "/d/design", recipe: "/d/recipe", prompt: "P", model: "" };

  it("新規生成の引数一式(--in なし)", () => {
    const args = buildPencilArgs({ ...base, refine: false });
    expect(args).not.toContain("--in");
    expect(args).toContain("--out");
    expect(args).toContain(path.join("/d/design", "mock.pen"));
    expect(args).toContain(path.join("/d/recipe", "02-screens.md"));
    expect(args).toContain(path.join("/d/recipe", "03-design-system.md"));
    expect(args).toContain("--export");
    expect(args).toContain("--usage");
    expect(args).not.toContain("--model");
  });

  it("差分修正では --in を先頭に付ける", () => {
    const args = buildPencilArgs({ ...base, refine: true });
    expect(args[0]).toBe("--in");
    expect(args[1]).toBe(path.join("/d/design", "mock.pen"));
  });

  it("モデル指定があれば --model を付ける", () => {
    const args = buildPencilArgs({ ...base, refine: false, model: " gpt-5.5 " });
    expect(args).toContain("--model");
    expect(args).toContain("gpt-5.5");
  });
});

describe("resolvePencilKey", () => {
  it("設定のキーを優先する", () => {
    expect(resolvePencilKey({ ...fakeSettings, pencilCliKey: "pencil_cli_abc" })).toBe(
      "pencil_cli_abc",
    );
  });

  it("設定が空なら環境変数へフォールバック", () => {
    process.env.PENCIL_CLI_KEY = "pencil_cli_env";
    expect(resolvePencilKey(fakeSettings)).toBe("pencil_cli_env");
  });

  it("どちらも無ければ DesignNotConfiguredError", () => {
    expect(() => resolvePencilKey(fakeSettings)).toThrow(DesignNotConfiguredError);
  });
});

describe("hasDesignRecipe", () => {
  it("02/03 が揃っていれば true、欠けていれば false", async () => {
    const brew = await createBrew("テスト");
    expect(await hasDesignRecipe(brew.id)).toBe(false);
    await fs.mkdir(recipeDir(brew.id), { recursive: true });
    await fs.writeFile(path.join(recipeDir(brew.id), "02-screens.md"), "# 画面", "utf8");
    expect(await hasDesignRecipe(brew.id)).toBe(false);
    await fs.writeFile(path.join(recipeDir(brew.id), "03-design-system.md"), "# DS", "utf8");
    expect(await hasDesignRecipe(brew.id)).toBe(true);
  });
});

describe("generateDesignMock(フェイク構成)", () => {
  it("CLI を呼ばずテンプレートをコピーして成功する", async () => {
    const brew = await createBrew("フェイク");
    const record = await generateDesignMock(brew, fakeSettings);
    expect(record.status).toBe("succeeded");
    expect(record.model).toBe("fake");
    expect(record.costUsd).toBe(0);
    expect(record.generatedAt).not.toBeNull();
    const png = await fs.readFile(path.join(designDir(brew.id), "mock.png"));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const usage = JSON.parse(
      await fs.readFile(path.join(designDir(brew.id), "usage.json"), "utf8"),
    ) as { model: string };
    expect(usage.model).toBe("fake");
  });

  it("IDEA_BREWING_FAKE_BUILD=1 でもフェイク経路になる", async () => {
    process.env.IDEA_BREWING_FAKE_BUILD = "1";
    try {
      const brew = await createBrew("フェイク2");
      const record = await generateDesignMock(brew, { ...fakeSettings, provider: "openai" });
      expect(record.status).toBe("succeeded");
    } finally {
      delete process.env.IDEA_BREWING_FAKE_BUILD;
    }
  });
});
