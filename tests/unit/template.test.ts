import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareBatchDir, readManifest, shouldCopyTemplatePath } from "@/lib/tap/template";
import { createBrew, designDir, recipeDir } from "@/lib/store";
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
  it("テンプレート内の node_modules と dist だけを除外する", () => {
    const root = path.join("C:", "work", "dist", "idea-brewing", "templates", "tap-fake");
    expect(shouldCopyTemplatePath(root, root)).toBe(true);
    expect(shouldCopyTemplatePath(root, path.join(root, "package.json"))).toBe(true);
    expect(shouldCopyTemplatePath(root, path.join(root, "node_modules", "x.js"))).toBe(false);
    expect(shouldCopyTemplatePath(root, path.join(root, "dist", "index.html"))).toBe(false);
    expect(shouldCopyTemplatePath(root, path.join(root, "src", "dist-utils.ts"))).toBe(true);
  });

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

  it("デザインモックがあれば docs/recipe/design-mock.png として同梱する", async () => {
    const brew = await createBrew("モック同梱");
    await fs.mkdir(designDir(brew.id), { recursive: true });
    await fs.writeFile(path.join(designDir(brew.id), "mock.png"), Buffer.from("png-bytes"));
    const dir = await prepareBatchDir(brew.id, 1, "tap-fake");
    const copied = await fs.readFile(path.join(dir, "docs", "recipe", "design-mock.png"));
    expect(copied.toString()).toBe("png-bytes");
  });

  it("デザインモックがなくても失敗しない", async () => {
    const brew = await createBrew("モックなし");
    const dir = await prepareBatchDir(brew.id, 1, "tap-fake");
    await expect(
      fs.access(path.join(dir, "docs", "recipe", "design-mock.png")),
    ).rejects.toThrow();
  });

  it("再実行で前回の生成物が消える", async () => {
    const brew = await createBrew("テンプレ2");
    const dir = await prepareBatchDir(brew.id, 1, "tap-fake");
    await fs.writeFile(path.join(dir, "leftover.txt"), "old", "utf8");
    await prepareBatchDir(brew.id, 1, "tap-fake");
    await expect(fs.access(path.join(dir, "leftover.txt"))).rejects.toThrow();
  });

  it("不正な tap.json を拒否する", async () => {
    const brew = await createBrew("不正マニフェスト");
    const dir = await prepareBatchDir(brew.id, 1, "tap-fake");
    await fs.writeFile(path.join(dir, "tap.json"), JSON.stringify({ verify: "npm install" }), "utf8");
    await expect(readManifest(dir)).rejects.toThrow("文字列配列");
  });
});
