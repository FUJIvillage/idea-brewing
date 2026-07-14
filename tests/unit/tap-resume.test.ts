import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECIPE_FILES } from "@/lib/recipe";
import { createBrew, recipeDir, tapDir } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { createFakeBuildEngine } from "@/lib/tap/fake-engine";
import { runBuild } from "@/lib/tap";
import { writeBuildCheckpoint, readBuildCheckpoint } from "@/lib/tap/checkpoint";
import { createFakeRunner } from "@/lib/tap/runner";
import { prepareBatchDir } from "@/lib/tap/template";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-resume-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function setupBrew(planMd: string): Promise<Brew> {
  const brew = await createBrew("再開対象");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  for (const def of RECIPE_FILES) {
    const content = def.file === "05-implementation-plan.md" ? planMd : `# ${def.title}`;
    await fs.writeFile(path.join(recipeDir(brew.id), def.file), content, "utf8");
  }
  return { ...brew, stage: "done", recipeGeneratedAt: new Date().toISOString() };
}

describe("runBuild resume", () => {
  it("再開時はバッチフォルダを消さず、完了タスクをスキップする", async () => {
    const brew = await setupBrew("## タスクA\n本文A\n## タスクB\n本文B\n## タスクC\n本文C");
    await prepareBatchDir(brew.id, 1, "tap-fake");
    const marker = path.join(tapDir(brew.id, 1), "KEEP_ME.txt");
    await fs.writeFile(marker, "important", "utf8");
    await writeBuildCheckpoint(brew.id, 1, {
      phase: "generating",
      completedTasks: 2,
      totalTasks: 3,
      repairRound: 0,
    });

    const engine = createFakeBuildEngine();
    const done = await runBuild(brew, {
      engine,
      runner: createFakeRunner(),
      template: "tap-fake",
      batch: 1,
      mode: { kind: "resume" },
    });

    expect(done.batches[0].status).toBe("succeeded");
    expect(await fs.readFile(marker, "utf8")).toBe("important");
    // resume intro + task C only (+ no bulk)
    expect(engine.prompts.some((p) => p.includes("再開") || p.includes("完了済み"))).toBe(true);
    expect(engine.prompts.some((p) => p.includes("タスクC") || p.includes("タスク 3/"))).toBe(true);
    expect(engine.prompts.some((p) => p.includes("タスクA"))).toBe(false);
    expect(await readBuildCheckpoint(brew.id, 1)).toBeNull();
  });

  it("fresh はマーカーを消して最初からやり直す", async () => {
    const brew = await setupBrew("## タスクA\n本文A");
    await prepareBatchDir(brew.id, 1, "tap-fake");
    const marker = path.join(tapDir(brew.id, 1), "KEEP_ME.txt");
    await fs.writeFile(marker, "important", "utf8");
    await writeBuildCheckpoint(brew.id, 1, {
      phase: "generating",
      completedTasks: 1,
      totalTasks: 1,
      repairRound: 0,
    });

    await runBuild(brew, {
      engine: createFakeBuildEngine(),
      runner: createFakeRunner(),
      template: "tap-fake",
      batch: 1,
      mode: { kind: "initial" },
    });

    await expect(fs.access(marker)).rejects.toThrow();
  });

  it("checkpoint 無しの resume は failed になる", async () => {
    const brew = await setupBrew("## タスクA\n本文A");
    const done = await runBuild(brew, {
      engine: createFakeBuildEngine(),
      runner: createFakeRunner(),
      template: "tap-fake",
      batch: 1,
      mode: { kind: "resume" },
    });
    expect(done.batches[0].status).toBe("failed");
    expect(done.batches[0].error).toMatch(/checkpoint|再開/);
  });
});
