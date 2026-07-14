import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearBuildCheckpoint,
  checkpointPath,
  readBuildCheckpoint,
  writeBuildCheckpoint,
  type BuildCheckpoint,
} from "@/lib/tap/checkpoint";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ib-cp-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

const brewId = "11111111-1111-4111-8111-111111111111";

describe("build checkpoint", () => {
  it("無いときは null", async () => {
    expect(await readBuildCheckpoint(brewId, 1)).toBeNull();
  });

  it("書き込みと読み出し", async () => {
    const cp: BuildCheckpoint = {
      version: 1,
      phase: "generating",
      completedTasks: 2,
      totalTasks: 5,
      repairRound: 0,
      updatedAt: "2026-07-14T00:00:00.000Z",
    };
    await writeBuildCheckpoint(brewId, 1, cp);
    expect(await readBuildCheckpoint(brewId, 1)).toEqual(cp);
    expect(checkpointPath(brewId, 1)).toContain("build-checkpoint.json");
  });

  it("clear で消える", async () => {
    await writeBuildCheckpoint(brewId, 1, {
      phase: "verifying",
      completedTasks: 3,
      totalTasks: 3,
      repairRound: 0,
    });
    await clearBuildCheckpoint(brewId, 1);
    expect(await readBuildCheckpoint(brewId, 1)).toBeNull();
  });
});
