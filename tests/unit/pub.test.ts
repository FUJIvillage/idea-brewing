import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { GenerateOptions, LlmClient } from "@/lib/llm/client";
import { createFakeClient } from "@/lib/llm/fake-client";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { normalizeStalePub, pubDir, runPub, type PubDeps } from "@/lib/pub";
import { createFakePubDriver } from "@/lib/pub/fake-driver";
import { pubbingBrews } from "@/lib/pub/pub-state";
import { createBrew, writeBrew } from "@/lib/store";
import type { Brew, BrewSheet, SavedPersona } from "@/lib/store/types";
import { SHEET_KEYS } from "@/lib/store/types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  pubbingBrews.clear();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function sheet(): BrewSheet {
  return Object.fromEntries(
    SHEET_KEYS.map((key) => [
      key,
      { content: `${key}の内容`, sufficiency: "full", userEdited: false },
    ]),
  ) as BrewSheet;
}

async function builtBrew(): Promise<Brew> {
  const brew = await createBrew("パブ");
  return writeBrew({
    ...brew,
    stage: "built",
    sheet: sheet(),
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

function deps(overrides?: Partial<PubDeps>): PubDeps {
  return {
    client: createFakeClient(),
    startServer: async () => ({ port: 0 }),
    stopServer: async () => undefined,
    createDriver: async () => createFakePubDriver(),
    ...overrides,
  };
}

const regular: SavedPersona = { id: "r1", name: "常連A", profile: "毎日来る", goals: ["見る"] };

/** 特定タグで失敗するクライアント */
function failingClient(tag: string, times = Infinity): LlmClient {
  const base = createFakeClient();
  let failed = 0;
  return {
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      if (opts.tag === tag && failed < times) {
        failed += 1;
        throw new Error("LLM死亡");
      }
      return base.generateObject(schema, opts);
    },
    generateText: (opts) => base.generateText(opts),
  };
}

describe("runPub", () => {
  it("常連+自動生成で完走し、レポートを保存する", async () => {
    const brew = await builtBrew();
    const done = await runPub(brew, deps(), { autoCount: 1, savedPersonas: [regular] });
    const report = done.batches[0].pub;
    expect(report).not.toBeNull();
    expect(report!.personaResults).toHaveLength(2);
    expect(report!.personaResults[0].persona.origin).toBe("saved"); // 常連が先
    expect(report!.personaResults[1].persona.origin).toBe("auto");
    expect(report!.overall).toBe(3.9); // (4.5 + 3.3) / 2 → 3.9
    expect(report!.summary).toContain("フェイク総括");
    expect(done.pubProgress).toBeNull();
    expect(existsSync(path.join(pubDir(brew.id, 1), "report.md"))).toBe(true);
  });

  it("成功バッチがなければエラー", async () => {
    const brew = await createBrew("未ビルド");
    await expect(runPub(brew, deps(), { autoCount: 1, savedPersonas: [] })).rejects.toThrow(
      /成功したバッチ/,
    );
  });

  it("人数が範囲外ならエラー", async () => {
    const brew = await builtBrew();
    await expect(runPub(brew, deps(), { autoCount: 0, savedPersonas: [] })).rejects.toThrow(
      /1〜5/,
    );
    await expect(runPub(brew, deps(), { autoCount: 6, savedPersonas: [] })).rejects.toThrow(
      /1〜5/,
    );
  });

  it("サーバー起動失敗で Pub 全体が失敗し、進捗をクリアする", async () => {
    const brew = await builtBrew();
    const progress: Brew[] = [];
    await expect(
      runPub(
        brew,
        deps({
          startServer: async () => {
            throw new Error("起動失敗");
          },
          onProgress: (b) => void progress.push(b),
        }),
        { autoCount: 1, savedPersonas: [] },
      ),
    ).rejects.toThrow(/起動失敗/);
    expect(progress[progress.length - 1].pubProgress).toBeNull();
  });

  it("1人が破綻しても続行し、レポートには aborted で残る", async () => {
    const brew = await builtBrew();
    // 1人目の行動決定だけ失敗させる(1回で aborted になる)
    const done = await runPub(brew, deps({ client: failingClient("pub-action", 1) }), {
      autoCount: 0,
      savedPersonas: [regular, { ...regular, id: "r2", name: "常連B" }],
    });
    const report = done.batches[0].pub!;
    expect(report.personaResults[0].status).toBe("aborted");
    expect(report.personaResults[1].status).toBe("completed");
    expect(report.overall).toBe(4.5); // completed 1人だけで平均
  });

  it("全員破綻したら Pub 全体が失敗する", async () => {
    const brew = await builtBrew();
    await expect(
      runPub(brew, deps({ client: failingClient("pub-action") }), {
        autoCount: 0,
        savedPersonas: [regular],
      }),
    ).rejects.toThrow(/すべてのAI客/);
  });

  it("ペルソナ生成失敗で Pub 全体が失敗する", async () => {
    const brew = await builtBrew();
    await expect(
      runPub(brew, deps({ client: failingClient("pub-persona") }), {
        autoCount: 1,
        savedPersonas: [],
      }),
    ).rejects.toThrow();
  });

  it("キャンセルでレポートを保存せず進捗なしで返す", async () => {
    const brew = await builtBrew();
    const done = await runPub(brew, deps({ cancel: { cancelled: true } }), {
      autoCount: 1,
      savedPersonas: [],
    });
    expect(done.batches[0].pub).toBeNull();
    expect(done.pubProgress).toBeNull();
    expect(existsSync(path.join(pubDir(brew.id, 1), "report.md"))).toBe(false);
  });

  it("再実行でレポートを上書きする", async () => {
    const brew = await builtBrew();
    const once = await runPub(brew, deps(), { autoCount: 1, savedPersonas: [] });
    expect(once.batches[0].pub!.personaResults).toHaveLength(1);
    const twice = await runPub(once, deps(), { autoCount: 2, savedPersonas: [] });
    expect(twice.batches[0].pub!.personaResults).toHaveLength(2);
  });

  it("失敗した再実行では前回のレポートを保持し、中途半端な成果物を残さない", async () => {
    const brew = await builtBrew();
    const once = await runPub(brew, deps(), { autoCount: 1, savedPersonas: [] });
    expect(once.batches[0].pub).not.toBeNull();

    await expect(
      runPub(once, deps({ client: failingClient("pub-action") }), {
        autoCount: 0,
        savedPersonas: [regular],
      }),
    ).rejects.toThrow(/すべてのAI客/);

    // 前回の成果物はそのまま、今回のステージングは掃除されている
    expect(existsSync(path.join(pubDir(brew.id, 1), "report.md"))).toBe(true);
    expect(existsSync(`${pubDir(brew.id, 1)}-staging`)).toBe(false);
  });

  it("再実行時に前回のスクリーンショットを掃除する", async () => {
    const brew = await builtBrew();
    // 前回の実行痕(古いスクリーンショット)を仕込む
    await fs.mkdir(pubDir(brew.id, 1), { recursive: true });
    const stale = path.join(pubDir(brew.id, 1), "persona-3.png");
    await fs.writeFile(stale, Buffer.from([1]));
    await runPub(brew, deps(), { autoCount: 1, savedPersonas: [] });
    expect(existsSync(stale)).toBe(false); // 客1人の実行に persona-3.png は残らない
    expect(existsSync(path.join(pubDir(brew.id, 1), "report.md"))).toBe(true);
  });

  it("サーバーは成功・失敗どちらでも必ず停止される", async () => {
    const brew = await builtBrew();
    let stopped = 0;
    await runPub(brew, deps({ stopServer: async () => void (stopped += 1) }), {
      autoCount: 1,
      savedPersonas: [],
    });
    // 開店前の念のため停止 + finally の停止
    expect(stopped).toBeGreaterThanOrEqual(2);
  });
});

describe("normalizeStalePub / isBrewBusy", () => {
  it("pubProgress 残留を null に補正する(なければ同一参照)", async () => {
    const brew = await builtBrew();
    expect(normalizeStalePub(brew)).toBe(brew);
    const stale = { ...brew, pubProgress: { phase: "serving" as const, detail: "x", batch: 1 } };
    expect(normalizeStalePub(stale).pubProgress).toBeNull();
  });

  it("pubbingBrews も isBrewBusy に含まれる", async () => {
    const brew = await builtBrew();
    expect(isBrewBusy(brew.id)).toBe(false);
    pubbingBrews.add(brew.id);
    expect(isBrewBusy(brew.id)).toBe(true);
  });
});
