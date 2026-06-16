import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECIPE_FILES } from "@/lib/recipe";
import { createBrew, recipeDir } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { createFakeBuildEngine } from "@/lib/tap/fake-engine";
import { normalizeStaleBatch, runBuild } from "@/lib/tap";
import { createFakeRunner } from "@/lib/tap/runner";
import type { BuildEngine, BuildSession } from "@/lib/tap/engine";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function setupBrew(planMd: string): Promise<Brew> {
  const brew = await createBrew("ビルド対象");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  for (const def of RECIPE_FILES) {
    const content = def.file === "05-implementation-plan.md" ? planMd : `# ${def.title}`;
    await fs.writeFile(path.join(recipeDir(brew.id), def.file), content, "utf8");
  }
  return { ...brew, stage: "done", recipeGeneratedAt: new Date().toISOString() };
}

describe("runBuild", () => {
  it("成功パス: intro+タスクごとにsendされ、検証成功でbuiltになる", async () => {
    const brew = await setupBrew("## タスクA\n本文A\n## タスクB\n本文B");
    const engine = createFakeBuildEngine();
    const runner = createFakeRunner();
    const phases: string[] = [];

    const done = await runBuild(brew, {
      engine,
      runner,
      template: "tap-fake",
      onProgress: (b) => {
        if (b.buildProgress) phases.push(b.buildProgress.phase);
      },
    });

    expect(done.stage).toBe("built");
    expect(done.batches[0].status).toBe("succeeded");
    expect(done.buildProgress).toBeNull();
    expect(engine.prompts).toHaveLength(3);
    expect(phases).toContain("preparing");
    expect(phases).toContain("generating");
    expect(phases).toContain("verifying");
    expect(runner.commands.length).toBeGreaterThan(0);
  });

  it("見出しの無い実装計画は一括実装の1sendにフォールバックする", async () => {
    const brew = await setupBrew("見出しのないプレーンな計画");
    const engine = createFakeBuildEngine();

    const done = await runBuild(brew, {
      engine,
      runner: createFakeRunner(),
      template: "tap-fake",
    });

    expect(done.batches[0].status).toBe("succeeded");
    expect(engine.prompts).toHaveLength(2);
  });

  it("検証失敗で修理ラウンドが走り、成功すればsucceeded", async () => {
    const brew = await setupBrew("## タスクA\n本文A");
    const engine = createFakeBuildEngine();
    const runner = createFakeRunner([
      { ok: false, output: "TS2304: Cannot find name 'foo'" },
      { ok: true },
    ]);

    const done = await runBuild(brew, { engine, runner, template: "tap-fake" });

    expect(done.batches[0].status).toBe("succeeded");
    expect(engine.prompts.some((p) => p.includes("TS2304"))).toBe(true);
  });

  it("修理上限を超えるとfailedになりstageは変わらない", async () => {
    const brew = await setupBrew("## タスクA\nx");
    const runner = createFakeRunner([
      { ok: false, output: "e1" },
      { ok: false, output: "e2" },
      { ok: false, output: "e3" },
    ]);

    const done = await runBuild(brew, {
      engine: createFakeBuildEngine(),
      runner,
      template: "tap-fake",
    });

    expect(done.batches[0].status).toBe("failed");
    expect(done.batches[0].error).toContain("修理上限");
    expect(done.stage).toBe("done");
    expect(done.buildProgress).toBeNull();
  });

  it("エンジンのsend失敗でfailedになる", async () => {
    const brew = await setupBrew("## タスクA\nx");

    const done = await runBuild(brew, {
      engine: createFakeBuildEngine({ failSends: 1 }),
      runner: createFakeRunner(),
      template: "tap-fake",
    });

    expect(done.batches[0].status).toBe("failed");
    expect(done.batches[0].error).toBe("fake failure");
  });

  it("中断フラグでcancelledになる", async () => {
    const brew = await setupBrew("## タスクA\nx\n## タスクB\ny");
    const cancel = { cancelled: false };
    const engine = createFakeBuildEngine({
      afterSend: (count) => {
        if (count === 1) cancel.cancelled = true;
      },
    });

    const done = await runBuild(brew, {
      engine,
      runner: createFakeRunner(),
      template: "tap-fake",
      cancel,
    });

    expect(done.batches[0].status).toBe("cancelled");
    expect(engine.prompts).toHaveLength(1);
  });

  it("disposeが失敗してもterminal Brewを返す", async () => {
    const brew = await setupBrew("## タスクA\nx");
    const engine: BuildEngine = {
      async createSession() {
        const session: BuildSession = {
          async send() {
            return { ok: true, summary: "ok" };
          },
          async cancel() {},
          async dispose() {
            throw new Error("dispose failed");
          },
        };
        return session;
      },
    };

    const done = await runBuild(brew, {
      engine,
      runner: createFakeRunner(),
      template: "tap-fake",
    });

    expect(done.stage).toBe("built");
    expect(done.batches[0].status).toBe("succeeded");
    expect(done.buildProgress).toBeNull();
  });

  it("プログラマエラーはfailed Brewに変換せず再throwする", async () => {
    const brew = await setupBrew("## タスクA\nx");
    await expect(
      runBuild(brew, {
        engine: createFakeBuildEngine(),
        runner: {
          async run() {
            throw new TypeError("programmer bug");
          },
        },
        template: "tap-fake",
      }),
    ).rejects.toThrow("programmer bug");
  });
});

describe("normalizeStaleBatch", () => {
  it("building残留をfailedに補正する", async () => {
    const brew = await setupBrew("x");
    const stale: Brew = {
      ...brew,
      batches: [
        {
          number: 1,
          status: "building",
          startedAt: "2026-01-01T00:00:00Z",
          finishedAt: null,
          error: null,
        },
      ],
      buildProgress: { phase: "generating", detail: "残留" },
    };

    const fixed = normalizeStaleBatch(stale);

    expect(fixed.batches[0].status).toBe("failed");
    expect(fixed.buildProgress).toBeNull();
  });

  it("building以外は同一オブジェクトを返す", async () => {
    const brew = await setupBrew("x");

    expect(normalizeStaleBatch(brew)).toBe(brew);
  });
});
