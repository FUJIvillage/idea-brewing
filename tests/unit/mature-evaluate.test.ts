import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFakeClient } from "@/lib/llm/fake-client";
import type { GenerateOptions, LlmClient } from "@/lib/llm/client";
import { createBrew, tapDir } from "@/lib/store";
import {
  evaluateBatch,
  renderEvaluationMarkdown,
  writeEvaluationReport,
} from "@/lib/mature/evaluate";
import type { EvaluationMaterials } from "@/lib/mature/materials";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const materials: EvaluationMaterials = {
  rubric: "# ルーブリック",
  codeDigest: "code",
  process: "process",
  previousEvaluation: null,
};

describe("evaluateBatch", () => {
  it("フェイクLLMで観点別スコアとoverallを得る", async () => {
    const client = createFakeClient();
    const ev = await evaluateBatch(client, materials, []);
    expect(ev.axes.length).toBeGreaterThan(0);
    expect(ev.overall).toBe(3); // フェイク1回目は全観点3点
    expect(ev.strategy).toBe("repair");
    expect(ev.screenshotsUsed).toBe(false);
    expect(ev.improvements.length).toBeGreaterThan(0);
  });

  it("画像付き呼び出しが失敗したら画像なしで再試行し screenshotsUsed=false", async () => {
    const inner = createFakeClient();
    let callCount = 0;
    const flaky: LlmClient = {
      async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
        callCount += 1;
        if (opts.images && opts.images.length > 0) throw new Error("vision非対応");
        return inner.generateObject(schema, opts);
      },
      generateText: (opts) => inner.generateText(opts),
    };

    const ev = await evaluateBatch(flaky, materials, [
      { data: Buffer.from("png"), mimeType: "image/png" },
    ]);

    expect(callCount).toBe(2);
    expect(ev.screenshotsUsed).toBe(false);
  });

  it("画像付きで成功したら screenshotsUsed=true", async () => {
    const client = createFakeClient();
    const ev = await evaluateBatch(client, materials, [
      { data: Buffer.from("png"), mimeType: "image/png" },
    ]);
    expect(ev.screenshotsUsed).toBe(true);
  });

  it("フェイクは2回目以降のスコアが上がる(autoループ用)", async () => {
    const client = createFakeClient();
    const first = await evaluateBatch(client, materials, []);
    const second = await evaluateBatch(client, materials, []);
    expect(first.overall).toBeLessThan(second.overall);
  });
});

describe("レポート出力", () => {
  it("evaluation.md を書き出す", async () => {
    const brew = await createBrew("レポート");
    await fs.mkdir(tapDir(brew.id, 1), { recursive: true });
    const client = createFakeClient();
    const ev = await evaluateBatch(client, materials, []);

    await writeEvaluationReport(brew.id, 1, ev);

    const text = await fs.readFile(path.join(tapDir(brew.id, 1), "evaluation.md"), "utf8");
    expect(text).toContain("バッチ1 自己評価レポート");
    expect(text).toContain("観点別スコア");
    expect(text).toContain("改善指示");
  });

  it("renderEvaluationMarkdown は採点表と改善指示を含む", () => {
    const md = renderEvaluationMarkdown(2, {
      overall: 4.5,
      axes: [{ name: "観点A", score: 5, comment: "良い" }],
      summary: "総評",
      improvements: ["直す"],
      strategy: "rebuild",
      screenshotsUsed: true,
      evaluatedAt: "2026-07-03T00:00:00.000Z",
    });
    expect(md).toContain("バッチ2 自己評価レポート");
    expect(md).toContain("4.5 / 5.0");
    expect(md).toContain("| 観点A | 5 | 良い |");
    expect(md).toContain("1. 直す");
    expect(md).toContain("rebuild");
  });
});
