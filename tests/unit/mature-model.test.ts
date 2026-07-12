import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { brewDir, createBrew, readBrew } from "@/lib/store";
import type { BatchRecord } from "@/lib/store/types";
import { latestSucceededBatch, maxBatchNumber, upsertBatch } from "@/lib/tap/batches";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function record(number: number, status: BatchRecord["status"]): BatchRecord {
  return {
    number,
    status,
    startedAt: "2026-07-03T00:00:00.000Z",
    finishedAt: null,
    error: null,
    evaluation: null,
    pub: null,
  };
}

describe("batches ユーティリティ", () => {
  it("latestSucceededBatch は番号最大の成功バッチを返す", () => {
    const brew = { batches: [record(1, "succeeded"), record(2, "failed"), record(3, "succeeded")] };
    expect(latestSucceededBatch(brew as never)?.number).toBe(3);
  });

  it("成功バッチがなければ null", () => {
    const brew = { batches: [record(1, "failed")] };
    expect(latestSucceededBatch(brew as never)).toBeNull();
  });

  it("maxBatchNumber はバッチなしで 0、あれば最大番号", () => {
    expect(maxBatchNumber({ batches: [] } as never)).toBe(0);
    expect(maxBatchNumber({ batches: [record(2, "failed"), record(5, "succeeded")] } as never)).toBe(5);
  });

  it("upsertBatch は同番号を置換し番号順に並べる", () => {
    const result = upsertBatch([record(2, "failed"), record(1, "succeeded")], record(2, "succeeded"));
    expect(result.map((b) => b.number)).toEqual([1, 2]);
    expect(result[1].status).toBe("succeeded");
  });
});

describe("brew.json のバックフィル", () => {
  it("evaluation / maturationProgress の無い旧データを補完する", async () => {
    const brew = await createBrew("旧データ");
    const raw = JSON.parse(
      await fs.readFile(path.join(brewDir(brew.id), "brew.json"), "utf8"),
    ) as Record<string, unknown>;
    // 第2版時代の brew.json を再現(新フィールドを消す)
    delete raw.maturationProgress;
    raw.batches = [
      {
        number: 1,
        status: "succeeded",
        startedAt: "2026-06-13T00:00:00.000Z",
        finishedAt: "2026-06-13T00:01:00.000Z",
        error: null,
      },
    ];
    await fs.writeFile(path.join(brewDir(brew.id), "brew.json"), JSON.stringify(raw), "utf8");

    const loaded = await readBrew(brew.id);
    expect(loaded.maturationProgress).toBeNull();
    expect(loaded.batches[0].evaluation).toBeNull();
  });

  it("createBrew は maturationProgress: null で初期化する", async () => {
    const brew = await createBrew("新規");
    expect(brew.maturationProgress).toBeNull();
  });
});
