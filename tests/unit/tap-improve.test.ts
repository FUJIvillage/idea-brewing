import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew, readBrew, recipeDir, tapDir, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { normalizeStaleBatch, runBuild } from "@/lib/tap";
import { createFakeBuildEngine } from "@/lib/tap/fake-engine";
import type { CommandRunner } from "@/lib/tap/runner";
import { prepareRepairDir, shouldCopyRepairPath, writeImprovementNotes } from "@/lib/tap/template";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const okRunner: CommandRunner = {
  async run() {
    return { ok: true, output: "" };
  },
};

async function readyBrew(): Promise<Brew> {
  const brew = await createBrew("熟成テスト");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  await fs.writeFile(path.join(recipeDir(brew.id), "05-implementation-plan.md"), "## タスクA\n本文A\n", "utf8");
  return writeBrew({ ...brew, recipeGeneratedAt: new Date().toISOString() });
}

describe("prepareRepairDir", () => {
  it("前バッチをコピーし、実行時生成物を除外する", async () => {
    const brew = await readyBrew();
    const src = tapDir(brew.id, 1);
    await fs.mkdir(path.join(src, "src"), { recursive: true });
    await fs.mkdir(path.join(src, "node_modules", "x"), { recursive: true });
    await fs.mkdir(path.join(src, "screenshots"), { recursive: true });
    await fs.writeFile(path.join(src, "src", "App.tsx"), "export {}", "utf8");
    await fs.writeFile(path.join(src, "build.log"), "log", "utf8");
    await fs.writeFile(path.join(src, "evaluation.md"), "report", "utf8");
    await fs.writeFile(path.join(src, "package.json"), "{}", "utf8");

    const dest = await prepareRepairDir(brew.id, 1, 2);

    expect(existsSync(path.join(dest, "src", "App.tsx"))).toBe(true);
    expect(existsSync(path.join(dest, "package.json"))).toBe(true);
    expect(existsSync(path.join(dest, "node_modules"))).toBe(false);
    expect(existsSync(path.join(dest, "screenshots"))).toBe(false);
    expect(existsSync(path.join(dest, "build.log"))).toBe(false);
    expect(existsSync(path.join(dest, "evaluation.md"))).toBe(false);
  });

  it("shouldCopyRepairPath は除外セグメントを判定する", () => {
    const root = path.join("C:", "root");
    expect(shouldCopyRepairPath(root, path.join(root, "src", "a.ts"))).toBe(true);
    expect(shouldCopyRepairPath(root, path.join(root, "node_modules", "y"))).toBe(false);
    expect(shouldCopyRepairPath(root, path.join(root, "build.log"))).toBe(false);
  });
});

describe("writeImprovementNotes", () => {
  it("docs/recipe/07-improvement-notes.md に番号付きで書く", async () => {
    const dir = path.join(tmp, "notes-test");
    await fs.mkdir(dir, { recursive: true });
    await writeImprovementNotes(dir, ["指示1", "指示2"]);
    const text = await fs.readFile(path.join(dir, "docs", "recipe", "07-improvement-notes.md"), "utf8");
    expect(text).toContain("1. 指示1");
    expect(text).toContain("2. 指示2");
  });
});

describe("runBuild improve モード", () => {
  it("repair 戦略: 前バッチをコピーして改善指示を1件ずつ送り、batch-2 レコードを追加する", async () => {
    const brew = await readyBrew();
    // 前バッチ(成功済みの想定)のフォルダを用意
    await fs.mkdir(path.join(tapDir(brew.id, 1), "src"), { recursive: true });
    await fs.writeFile(path.join(tapDir(brew.id, 1), "src", "App.tsx"), "old", "utf8");
    const withBatch1: Brew = {
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: null,
          evaluation: null,
        },
      ],
    };
    const engine = createFakeBuildEngine();

    const done = await runBuild(withBatch1, {
      engine,
      runner: okRunner,
      template: "tap-fake",
      batch: 2,
      mode: { kind: "improve", strategy: "repair", fromBatch: 1, instructions: ["指示A", "指示B"] },
    });

    expect(done.batches.map((b) => b.number)).toEqual([1, 2]);
    expect(done.batches[1].status).toBe("succeeded");
    expect(done.stage).toBe("built");
    // 前バッチのコードが引き継がれ、改善指示が同梱されている
    expect(existsSync(path.join(tapDir(brew.id, 2), "src", "App.tsx"))).toBe(true);
    expect(
      existsSync(path.join(tapDir(brew.id, 2), "docs", "recipe", "07-improvement-notes.md")),
    ).toBe(true);
    // intro + 指示2件 = 3 send
    expect(engine.prompts).toHaveLength(3);
    expect(engine.prompts[1]).toContain("指示A");
    expect(engine.prompts[2]).toContain("指示B");
  });

  it("rebuild 戦略: テンプレートから作り直し、introに改善指示への言及を含める", async () => {
    const brew = await readyBrew();
    const withBatch1: Brew = {
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: null,
          evaluation: null,
        },
      ],
    };
    const engine = createFakeBuildEngine();

    const done = await runBuild(withBatch1, {
      engine,
      runner: okRunner,
      template: "tap-fake",
      batch: 2,
      mode: { kind: "improve", strategy: "rebuild", fromBatch: 1, instructions: ["指示A"] },
    });

    expect(done.batches[1].status).toBe("succeeded");
    // テンプレート由来の server.js がある(tap-fake からのコピー)
    expect(existsSync(path.join(tapDir(brew.id, 2), "server.js"))).toBe(true);
    expect(
      existsSync(path.join(tapDir(brew.id, 2), "docs", "recipe", "07-improvement-notes.md")),
    ).toBe(true);
    expect(engine.prompts[0]).toContain("07-improvement-notes.md");
  });

  it("normalizeStaleBatch は複数バッチ中の building だけを failed に補正する", async () => {
    const brew = await readyBrew();
    const stale: Brew = {
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: "2026-07-03T00:00:00.000Z",
          finishedAt: "2026-07-03T00:01:00.000Z",
          error: null,
          evaluation: null,
        },
        {
          number: 2,
          status: "building",
          startedAt: "2026-07-03T00:02:00.000Z",
          finishedAt: null,
          error: null,
          evaluation: null,
        },
      ],
      buildProgress: { phase: "generating", detail: "x" },
    };
    const normalized = normalizeStaleBatch(stale);
    expect(normalized.batches[0].status).toBe("succeeded");
    expect(normalized.batches[1].status).toBe("failed");
    expect(normalized.buildProgress).toBeNull();
  });

  it("成功済みバッチがあるとき build ルートは 400 を返す", async () => {
    const brew = await readyBrew();
    await writeBrew({
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: null,
          evaluation: null,
        },
      ],
    });
    const { POST } = await import("@/app/api/brews/[id]/tap/build/route");
    const res = await POST(new Request("http://test/"), {
      params: Promise.resolve({ id: brew.id }),
    });
    expect(res.status).toBe(400);
    // Cursor未設定の400と区別するため、理由(成功済みバッチガード)まで確認する
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("熟成タブ");
    const loaded = await readBrew(brew.id);
    expect(loaded.batches).toHaveLength(1); // 上書きされていない
  });
});
