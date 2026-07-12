import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakeClient } from "@/lib/llm/fake-client";

const personasSchema = z.object({
  personas: z.array(
    z.object({
      name: z.string().min(1),
      profile: z.string().min(1),
      goals: z.array(z.string().min(1)).min(1).max(3),
    }),
  ),
});

const actionSchema = z.object({
  kind: z.enum(["click", "fill", "select", "press", "goto", "finish"]),
  target: z.number().int().min(1).nullish(),
  value: z.string().nullish(),
  key: z.string().nullish(),
  path: z.string().nullish(),
  reason: z.string().min(1),
});

const feedbackSchema = z.object({
  taskResults: z.array(z.object({ achieved: z.boolean(), note: z.string() })).min(1).max(3),
  scores: z.object({
    purpose: z.number().int().min(1).max(5),
    usability: z.number().int().min(1).max(5),
    looks: z.number().int().min(1).max(5),
    revisit: z.number().int().min(1).max(5),
  }),
  comment: z.string().min(1),
});

describe("fake client の pub タグ", () => {
  it("pub-persona はプロンプトの人数指定どおりに返す", async () => {
    const client = createFakeClient();
    const res = await client.generateObject(personasSchema, {
      tag: "pub-persona",
      system: "s",
      prompt: "人数: 3\n\n## コンセプト\nテスト",
    });
    expect(res.personas).toHaveLength(3);
    expect(res.personas[0].goals.length).toBeGreaterThan(0);
  });

  it("pub-action は click → finish を繰り返す", async () => {
    const client = createFakeClient();
    const opts = { tag: "pub-action", system: "s", prompt: "p" } as const;
    const a1 = await client.generateObject(actionSchema, opts);
    const a2 = await client.generateObject(actionSchema, opts);
    const a3 = await client.generateObject(actionSchema, opts);
    expect(a1.kind).toBe("click");
    expect(a1.target).toBe(1);
    expect(a2.kind).toBe("finish");
    expect(a3.kind).toBe("click"); // 2人目のセッションも同じ運びになる
  });

  it("pub-feedback は1人目が4点台、2人目以降は3点台", async () => {
    const client = createFakeClient();
    const opts = { tag: "pub-feedback", system: "s", prompt: "p" } as const;
    const f1 = await client.generateObject(feedbackSchema, opts);
    const f2 = await client.generateObject(feedbackSchema, opts);
    expect(f1.scores.purpose).toBe(5);
    expect(f2.scores.purpose).toBe(4);
    expect(f2.scores.usability).toBe(3);
  });

  it("pub-summary は generateText で固定文を返す", async () => {
    const client = createFakeClient();
    const text = await client.generateText({ tag: "pub-summary", system: "s", prompt: "p" });
    expect(text).toContain("フェイク総括");
  });
});
