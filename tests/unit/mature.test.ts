import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GenerateOptions, LlmClient } from "@/lib/llm/client";
import { createFakeClient } from "@/lib/llm/fake-client";
import {
  normalizeStaleMaturation,
  runAutoMaturation,
  runEvaluate,
  runNextBatch,
  type MatureDeps,
} from "@/lib/mature";
import { createBrew, recipeDir, tapDir, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import type { BuildEngine } from "@/lib/tap/engine";
import { createFakeBuildEngine } from "@/lib/tap/fake-engine";
import type { CommandRunner } from "@/lib/tap/runner";

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

async function builtBrew(): Promise<Brew> {
  const brew = await createBrew("熟成");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  await fs.writeFile(
    path.join(recipeDir(brew.id), "06-evaluation-criteria.md"),
    "# 自己評価基準\n観点X",
    "utf8",
  );
  await fs.writeFile(
    path.join(recipeDir(brew.id), "05-implementation-plan.md"),
    "## タスクA\n本文\n",
    "utf8",
  );
  await fs.mkdir(path.join(tapDir(brew.id, 1), "src"), { recursive: true });
  await fs.writeFile(path.join(tapDir(brew.id, 1), "src", "App.tsx"), "v1", "utf8");
  return writeBrew({
    ...brew,
    stage: "built",
    recipeGeneratedAt: new Date().toISOString(),
    batches: [
      {
        number: 1,
        status: "succeeded",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: null,
        evaluation: null,
        pub: null,
      },
    ],
  });
}

function deps(overrides?: Partial<MatureDeps>): MatureDeps {
  return {
    client: createFakeClient(),
    capture: async () => [],
    engine: createFakeBuildEngine(),
    runner: okRunner,
    template: "tap-fake",
    ...overrides,
  };
}

/** generateObject の呼び出しに割り込んでから base に委譲するスパイクライアント */
function spyClient(base: LlmClient, onGenerateObject: (opts: GenerateOptions) => void): LlmClient {
  return {
    async generateObject(schema, opts) {
      onGenerateObject(opts);
      return base.generateObject(schema, opts);
    },
    generateText: (opts) => base.generateText(opts),
  };
}

describe("runEvaluate", () => {
  it("最新成功バッチを評価してevaluationとレポートを保存する", async () => {
    const brew = await builtBrew();
    const done = await runEvaluate(brew, deps());
    expect(done.batches[0].evaluation?.overall).toBe(3);
    expect(done.maturationProgress).toBeNull();
    expect(existsSync(path.join(tapDir(brew.id, 1), "evaluation.md"))).toBe(true);
  });

  it("成功バッチがなければエラー", async () => {
    const brew = await createBrew("未ビルド");
    await expect(runEvaluate(brew, deps())).rejects.toThrow(/成功したバッチ/);
  });

  it("エラー時はonProgressで進捗をクリアして再throwする", async () => {
    const brew = await builtBrew();
    // ルーブリックを消して素材収集を失敗させる
    await fs.rm(path.join(recipeDir(brew.id), "06-evaluation-criteria.md"));
    const progress: Brew[] = [];
    await expect(
      runEvaluate(brew, deps({ onProgress: (b) => void progress.push(b) })),
    ).rejects.toThrow(/06-evaluation-criteria/);
    expect(progress[progress.length - 1].maturationProgress).toBeNull();
  });

  it("進捗クリアのonProgressが失敗しても元のエラーを維持する", async () => {
    const brew = await builtBrew();
    // ルーブリックを消して素材収集を失敗させる
    await fs.rm(path.join(recipeDir(brew.id), "06-evaluation-criteria.md"));
    await expect(
      runEvaluate(
        brew,
        deps({
          onProgress: (b) => {
            // catch節の進捗クリア呼び出し(maturationProgress: null)だけを失敗させる
            if (b.maturationProgress === null) throw new Error("進捗の保存に失敗");
          },
        }),
      ),
    ).rejects.toThrow(/06-evaluation-criteria/);
  });

  it("読めるスクリーンショットだけをLLMに渡す(読めないパスはスキップ)", async () => {
    const brew = await builtBrew();
    const realShot = path.join(tmp, "shot.png");
    await fs.writeFile(realShot, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const missingShot = path.join(tmp, "no-such-dir", "missing.png");
    const imageCounts: number[] = [];
    const client = spyClient(createFakeClient(), (opts) => {
      imageCounts.push(opts.images?.length ?? 0);
    });
    const done = await runEvaluate(
      brew,
      deps({ client, capture: async () => [realShot, missingShot] }),
    );
    expect(imageCounts).toEqual([1]);
    expect(done.batches[0].evaluation?.screenshotsUsed).toBe(true);
  });

  it("キャンセル済みなら評価を保存せず進捗なしで返す", async () => {
    const brew = await builtBrew();
    const done = await runEvaluate(brew, deps({ cancel: { cancelled: true } }));
    expect(done.batches[0].evaluation).toBeNull();
    expect(done.maturationProgress).toBeNull();
  });

  it("採点後・保存前にキャンセルされたら評価もレポートも保存しない", async () => {
    const brew = await builtBrew();
    const cancel = { cancelled: false };
    // 採点(generateObject)の完了と同時に中断を要求する
    const client = spyClient(createFakeClient(), () => {
      cancel.cancelled = true;
    });
    const done = await runEvaluate(brew, deps({ client, cancel }));
    expect(done.batches[0].evaluation).toBeNull();
    expect(existsSync(path.join(tapDir(brew.id, 1), "evaluation.md"))).toBe(false);
    expect(done.maturationProgress).toBeNull();
  });
});

describe("runNextBatch", () => {
  it("評価済みバッチからrepairで次バッチを作る", async () => {
    const brew = await builtBrew();
    const evaluated = await runEvaluate(brew, deps());
    const done = await runNextBatch(evaluated, deps());
    expect(done.batches.map((b) => b.number)).toEqual([1, 2]);
    expect(done.batches[1].status).toBe("succeeded");
    expect(done.maturationProgress).toBeNull();
    // repair: 前バッチのコードが引き継がれている
    expect(existsSync(path.join(tapDir(brew.id, 2), "src", "App.tsx"))).toBe(true);
  });

  it("未評価ならエラー", async () => {
    const brew = await builtBrew();
    await expect(runNextBatch(brew, deps())).rejects.toThrow(/評価/);
  });

  it("ネストされたビルド進捗はmaturationProgressに載る", async () => {
    const brew = await builtBrew();
    const evaluated = await runEvaluate(brew, deps());
    const progress: Brew[] = [];
    await runNextBatch(evaluated, deps({ onProgress: (b) => void progress.push(b) }));
    const building = progress.filter((b) => b.maturationProgress?.phase === "building");
    expect(building.length).toBeGreaterThan(0);
    expect(building.every((b) => b.buildProgress === null)).toBe(true);
  });

  it("エラー時はonProgressで進捗をクリアして再throwする", async () => {
    const brew = await builtBrew();
    const evaluated = await runEvaluate(brew, deps());
    // プログラマーエラー(TypeError)は runBuild が失敗バッチに変換せずそのまま投げる
    const engine: BuildEngine = {
      async createSession() {
        throw new TypeError("エンジンが壊れています");
      },
    };
    const progress: Brew[] = [];
    await expect(
      runNextBatch(evaluated, deps({ engine, onProgress: (b) => void progress.push(b) })),
    ).rejects.toThrow(/エンジンが壊れています/);
    expect(progress[progress.length - 1].maturationProgress).toBeNull();
  });

  it("キャンセル済みなら次バッチを作らず進捗なしで返す", async () => {
    const brew = await builtBrew();
    const evaluated = await runEvaluate(brew, deps());
    const done = await runNextBatch(evaluated, deps({ cancel: { cancelled: true } }));
    expect(done.batches.map((b) => b.number)).toEqual([1]);
    expect(done.maturationProgress).toBeNull();
  });
});

describe("runAutoMaturation", () => {
  it("目標達成で停止する(フェイクは2回目の評価で5.0)", async () => {
    const brew = await builtBrew();
    const done = await runAutoMaturation(brew, deps(), { targetScore: 4, maxBatches: 5 });
    // バッチ1評価(3.0) → バッチ2生成 → バッチ2評価(5.0) → 目標達成で停止
    expect(done.batches).toHaveLength(2);
    expect(done.batches[1].evaluation?.overall).toBe(5);
    expect(done.maturationProgress).toBeNull();
  });

  it("上限バッチ数で停止する", async () => {
    const brew = await builtBrew();
    const done = await runAutoMaturation(brew, deps(), { targetScore: 6, maxBatches: 1 });
    // targetScore 6 は到達不能だが maxBatches=1 で次バッチを作らない
    expect(done.batches).toHaveLength(1);
    expect(done.batches[0].evaluation).not.toBeNull();
  });

  it("次バッチのビルド失敗で停止する", async () => {
    const brew = await builtBrew();
    const done = await runAutoMaturation(
      brew,
      deps({ engine: createFakeBuildEngine({ failSends: 10 }) }),
      { targetScore: 6, maxBatches: 5 },
    );
    expect(done.batches).toHaveLength(2);
    expect(done.batches[1].status).toBe("failed");
    expect(done.maturationProgress).toBeNull();
  });

  it("キャンセルで停止する", async () => {
    const brew = await builtBrew();
    const cancel = { cancelled: false };
    const done = await runAutoMaturation(
      brew,
      deps({
        cancel,
        onProgress: (b) => {
          // 次バッチのビルドが始まったら中断を要求する
          if (b.maturationProgress?.phase === "building") cancel.cancelled = true;
        },
      }),
      { targetScore: 6, maxBatches: 5 },
    );
    expect(done.maturationProgress).toBeNull();
    // バッチ2は中断で確定し、ループが停止している
    const batch2 = done.batches.find((b) => b.number === 2);
    expect(batch2?.status).toBe("cancelled");
  });
});

describe("normalizeStaleMaturation", () => {
  it("残留progressをnullに補正し、なければ同一参照を返す", async () => {
    const brew = await builtBrew();
    expect(normalizeStaleMaturation(brew)).toBe(brew);
    const stale: Brew = {
      ...brew,
      maturationProgress: { phase: "evaluating", detail: "x", batch: 1 },
    };
    expect(normalizeStaleMaturation(stale).maturationProgress).toBeNull();
  });
});
