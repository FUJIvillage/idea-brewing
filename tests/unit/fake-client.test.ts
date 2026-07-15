import { expect, test } from "vitest";
import { z } from "zod";
import { createFakeClient } from "@/lib/llm/fake-client";

const boilNextSchema = z.object({
  done: z.boolean(),
  question: z.string().nullable(),
  options: z
    .array(z.object({ label: z.string(), recommended: z.boolean() }))
    .nullable(),
});

test("フェイクは boil-next を2回まで質問し、3回目で done を返す", async () => {
  const fake = createFakeClient();
  const opts = { tag: "boil-next" as const, system: "", prompt: "" };
  const q1 = (await fake.generateObject(boilNextSchema, opts)).value;
  expect(q1.done).toBe(false);
  expect(q1.options?.some((o) => o.recommended)).toBe(true);
  const q2 = (await fake.generateObject(boilNextSchema, opts)).value;
  expect(q2.done).toBe(false);
  const q3 = (await fake.generateObject(boilNextSchema, opts)).value;
  expect(q3.done).toBe(true);
});

test("フェイクは呼び出し履歴を記録する", async () => {
  const fake = createFakeClient();
  await fake.generateText({ tag: "connection-test", system: "", prompt: "ping" });
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0].tag).toBe("connection-test");
});

test("connection-test は pong を返す", async () => {
  const fake = createFakeClient();
  const reply = await fake.generateText({ tag: "connection-test", system: "", prompt: "ping" });
  expect(reply.value).toBe("pong");
});

test("フェイクは固定 usage を返す", async () => {
  const fake = createFakeClient();
  const res = await fake.generateText({ tag: "connection-test", system: "", prompt: "ping" });
  expect(res.usage).toEqual({ input: 11, output: 22, total: 33 });
});
