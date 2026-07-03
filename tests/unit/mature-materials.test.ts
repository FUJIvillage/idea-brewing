import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew, recipeDir, tapDir, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { buildCodeDigest, collectMaterials, grillDump } from "@/lib/mature/materials";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function batchWithFiles(brew: Brew): Promise<string> {
  const dir = tapDir(brew.id, 1);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "App.tsx"), "export const App = 1;", "utf8");
  await fs.writeFile(path.join(dir, "index.html"), "<html></html>", "utf8");
  await fs.writeFile(path.join(dir, "node_modules", "pkg", "x.js"), "x", "utf8");
  await fs.writeFile(path.join(dir, "build.log"), "verify ok", "utf8");
  return dir;
}

describe("buildCodeDigest", () => {
  it("ツリーには対象ファイルを載せ、node_modules等は除外し、src配下の本文を含める", async () => {
    const brew = await createBrew("素材");
    const dir = await batchWithFiles(brew);

    const digest = await buildCodeDigest(dir);

    expect(digest).toContain("src/App.tsx");
    expect(digest).toContain("index.html");
    expect(digest).toContain("export const App = 1;");
    expect(digest).not.toContain("node_modules");
    expect(digest).not.toContain("build.log");
  });

  it("サイズ上限を超えたファイルは省略注記になる", async () => {
    const brew = await createBrew("素材上限");
    const dir = tapDir(brew.id, 1);
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "big.ts"), "a".repeat(70 * 1024), "utf8");

    const digest = await buildCodeDigest(dir);

    expect(digest).toContain("src/big.ts");
    expect(digest).toContain("(サイズ上限のため省略)");
    expect(digest.length).toBeLessThan(65 * 1024);
  });
});

describe("grillDump", () => {
  it("回答済みQ&Aを回答者付きで整形する", () => {
    const dump = grillDump([
      {
        id: "1",
        question: "Q?",
        options: [],
        answer: "A",
        answeredBy: "auto",
        askedAt: "2026-07-03T00:00:00.000Z",
      },
    ]);
    expect(dump).toContain("Q1: Q?");
    expect(dump).toContain("(自動): A");
  });
});

describe("collectMaterials", () => {
  it("ルーブリック欠落はエラー", async () => {
    const brew = await createBrew("素材欠落");
    await batchWithFiles(brew);
    await expect(collectMaterials(brew, 1)).rejects.toThrow(/06-evaluation-criteria/);
  });

  it("ルーブリック・コード・生成過程・前回評価を集める", async () => {
    const brew = await createBrew("素材一式");
    await batchWithFiles(brew);
    await fs.mkdir(recipeDir(brew.id), { recursive: true });
    await fs.writeFile(
      path.join(recipeDir(brew.id), "06-evaluation-criteria.md"),
      "# 自己評価基準\n観点X",
      "utf8",
    );
    const withEval: Brew = await writeBrew({
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: "2026-07-03T00:00:00.000Z",
          finishedAt: "2026-07-03T00:01:00.000Z",
          error: null,
          evaluation: {
            overall: 3,
            axes: [{ name: "観点X", score: 3, comment: "c" }],
            summary: "前回総評",
            improvements: ["改善1"],
            strategy: "repair",
            screenshotsUsed: false,
            evaluatedAt: "2026-07-03T00:02:00.000Z",
          },
        },
      ],
    });

    // バッチ2の素材収集: バッチ1の評価が「前回評価」として入る
    const dir2 = tapDir(withEval.id, 2);
    await fs.mkdir(path.join(dir2, "src"), { recursive: true });
    await fs.writeFile(path.join(dir2, "src", "App.tsx"), "v2", "utf8");

    const materials = await collectMaterials(withEval, 2);

    expect(materials.rubric).toContain("観点X");
    expect(materials.codeDigest).toContain("v2");
    expect(materials.process).toContain("グリルでの質疑応答");
    expect(materials.previousEvaluation?.summary).toBe("前回総評");
  });
});
