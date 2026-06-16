import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { realRunner } from "@/lib/tap/runner";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-runner-test-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("realRunner", () => {
  it("timeout時は失敗として返し、ログにtimeoutを残す", async () => {
    const logs: string[] = [];
    const result = await realRunner.run('node -e "setTimeout(() => {}, 5000)"', {
      cwd: tmp,
      timeoutMs: 200,
      onLog: (line) => logs.push(line),
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain("Command timed out");
    expect(logs.some((line) => line.includes("Command timed out"))).toBe(true);
  }, 10_000);
});
