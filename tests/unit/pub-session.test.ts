import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { GenerateOptions, LlmClient } from "@/lib/llm/client";
import { createFakeClient } from "@/lib/llm/fake-client";
import { createFakePubDriver } from "@/lib/pub/fake-driver";
import { MAX_SESSION_STEPS, alignTaskResults, runPersonaSession } from "@/lib/pub/session";
import type { PubPersona } from "@/lib/store/types";
import { PUB_AXES } from "@/lib/store/types";

const persona: PubPersona = {
  name: "テスト客",
  profile: "せっかち",
  goals: ["トップを見る", "ボタンを押す"],
  origin: "auto",
};

/** 特定タグの generateObject を差し替えるクライアント */
function stubClient(overrides: Partial<Record<string, () => unknown>>): LlmClient {
  const base = createFakeClient();
  return {
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      const over = overrides[opts.tag];
      if (over) return schema.parse(over());
      return base.generateObject(schema, opts);
    },
    generateText: (opts) => base.generateText(opts),
  };
}

describe("runPersonaSession", () => {
  it("finish で終了し、評価聴取で completed になる", async () => {
    const driver = createFakePubDriver();
    const result = await runPersonaSession(createFakeClient(), driver, persona);
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBe(2); // click + finish
    expect(result.scores.map((s) => s.name)).toEqual([...PUB_AXES]);
    expect(result.overall).toBe(4.5); // (5+4+4+5)/4
    expect(result.taskResults).toHaveLength(2); // goals と同数に揃う
    expect(result.taskResults[0].goal).toBe("トップを見る");
    expect(driver.actions).toHaveLength(1); // finish はドライバに送らない
  });

  it("ステップ上限で打ち切っても評価聴取して completed になる", async () => {
    const client = stubClient({
      "pub-action": () => ({ kind: "click", target: 1, reason: "延々押す" }),
    });
    const result = await runPersonaSession(client, createFakePubDriver(), persona);
    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(MAX_SESSION_STEPS);
  });

  it("操作失敗が3連続でセッション中断(aborted)", async () => {
    const driver = createFakePubDriver();
    driver.act = async () => "操作に失敗しました: フェイク失敗";
    const client = stubClient({
      "pub-action": () => ({ kind: "click", target: 1, reason: "押す" }),
    });
    const result = await runPersonaSession(client, driver, persona);
    expect(result.status).toBe("aborted");
    expect(result.steps).toHaveLength(3);
    expect(result.comment).toContain("失敗が続き");
  });

  it("行動決定のLLM失敗で aborted", async () => {
    const client = stubClient({
      "pub-action": () => {
        throw new Error("LLM死亡");
      },
    });
    const result = await runPersonaSession(client, createFakePubDriver(), persona);
    expect(result.status).toBe("aborted");
    expect(result.comment).toContain("次の操作");
  });

  it("評価聴取のLLM失敗で aborted", async () => {
    const client = stubClient({
      "pub-feedback": () => {
        throw new Error("LLM死亡");
      },
    });
    const result = await runPersonaSession(client, createFakePubDriver(), persona);
    expect(result.status).toBe("aborted");
    expect(result.comment).toContain("評価の聴取");
  });

  it("target が必要なアクションに target がなければ失敗として数える", async () => {
    let calls = 0;
    const client = stubClient({
      "pub-action": () => {
        calls += 1;
        return { kind: "fill", value: "x", reason: "対象指定漏れ" };
      },
    });
    const driver = createFakePubDriver();
    const result = await runPersonaSession(client, driver, persona);
    expect(result.status).toBe("aborted"); // 3連続の不正アクションで中断
    expect(driver.actions).toHaveLength(0); // ドライバには送られない
    expect(calls).toBe(3);
  });

  it("キャンセルで aborted(以降のLLM呼び出しをしない)", async () => {
    const result = await runPersonaSession(createFakeClient(), createFakePubDriver(), persona, {
      cancel: { cancelled: true },
    });
    expect(result.status).toBe("aborted");
    expect(result.comment).toContain("中断");
  });

  it("onStep がステップ番号つきで呼ばれる", async () => {
    const steps: number[] = [];
    await runPersonaSession(createFakeClient(), createFakePubDriver(), persona, {
      onStep: (s) => void steps.push(s),
    });
    expect(steps).toEqual([1, 2]);
  });
});

describe("alignTaskResults", () => {
  it("goals と件数を揃える(不足は未回答、超過は捨てる)", () => {
    const aligned = alignTaskResults(["a", "b", "c"], [{ achieved: true, note: "済" }]);
    expect(aligned).toHaveLength(3);
    expect(aligned[0]).toEqual({ goal: "a", achieved: true, note: "済" });
    expect(aligned[1].achieved).toBe(false);
    expect(aligned[1].note).toContain("回答があり");
  });
});
