import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareBatchDir, readManifest } from "@/lib/tap/template";
import { createBrew, recipeDir } from "@/lib/store";
import { RECIPE_FILES } from "@/lib/recipe";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("prepareBatchDir", () => {
  it("フェイクテンプレートとレシピを配置する", async () => {
    const brew = await createBrew("テンプレ");
    await fs.mkdir(recipeDir(brew.id), { recursive: true });
    for (const def of RECIPE_FILES) {
      await fs.writeFile(path.join(recipeDir(brew.id), def.file), `# ${def.title}`, "utf8");
    }
    const dir = await prepareBatchDir(brew.id, 1, "tap-fake");
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("tap-fake-app");
    const overview = await fs.readFile(path.join(dir, "docs", "recipe", "00-overview.md"), "utf8");
    expect(overview).toContain("サービス概要");
    const manifest = await readManifest(dir);
    expect(Array.isArray(manifest.verify)).toBe(true);
    expect(manifest.verify.length).toBeGreaterThan(0);
  });

  it("再実行で前回の生成物が消える", async () => {
    const brew = await createBrew("テンプレ2");
    const dir = await prepareBatchDir(brew.id, 1, "tap-fake");
    await fs.writeFile(path.join(dir, "leftover.txt"), "old", "utf8");
    await prepareBatchDir(brew.id, 1, "tap-fake");
    await expect(fs.access(path.join(dir, "leftover.txt"))).rejects.toThrow();
  });
});
