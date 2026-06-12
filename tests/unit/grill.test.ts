import { beforeEach, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBrew } from "@/lib/store";
import { SHEET_KEYS, type Brew, type GrillEntry } from "@/lib/store/types";
import { createFakeClient } from "@/lib/llm/fake-client";
import { addTextIngredient } from "@/lib/ingredients";
import { runMash } from "@/lib/brew-sheet";
import { applyAnswer, MAX_QUESTIONS, nextQuestion } from "@/lib/grill";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-grill-"));
});

async function mashedBrew() {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "最高のtodoアプリ");
  return { brew: await runMash(brew, fake), fake };
}

test("nextQuestion は質問エントリを追加して返す", async () => {
  const { brew, fake } = await mashedBrew();
  const { brew: next, entry } = await nextQuestion(brew, fake);
  expect(entry).not.toBeNull();
  expect(entry!.question).toContain("フェイク質問");
  expect(entry!.options.some((o) => o.recommended)).toBe(true);
  expect(next.grill.entries).toHaveLength(1);
  expect(next.grill.finished).toBe(false);
});

test("applyAnswer で回答が記録されシートが更新される", async () => {
  const { brew, fake } = await mashedBrew();
  const { brew: asked, entry } = await nextQuestion(brew, fake);
  const answered = await applyAnswer(asked, entry!.id, "シンプル重視", "user", fake);
  const saved = answered.grill.entries[0];
  expect(saved.answer).toBe("シンプル重視");
  expect(saved.answeredBy).toBe("user");
  for (const key of SHEET_KEYS) {
    expect(answered.sheet![key].sufficiency).toBe("full");
  }
});

test("全項目 full なら LLM を呼ばずに finished になる", async () => {
  const { brew, fake } = await mashedBrew();
  const { brew: asked, entry } = await nextQuestion(brew, fake);
  const answered = await applyAnswer(asked, entry!.id, "シンプル重視", "auto", fake);
  const callsBefore = fake.calls.length;
  const { brew: done, entry: none } = await nextQuestion(answered, fake);
  expect(none).toBeNull();
  expect(done.grill.finished).toBe(true);
  expect(fake.calls.length).toBe(callsBefore); // LLM 呼び出しなし
});

test("LLM が done を返したら finished になる", async () => {
  const { brew, fake } = await mashedBrew();
  const { brew: b1 } = await nextQuestion(brew, fake);
  const { brew: b2 } = await nextQuestion(b1, fake);
  const { brew: b3, entry } = await nextQuestion(b2, fake);
  expect(b2.grill.entries).toHaveLength(2);
  expect(entry).toBeNull();
  expect(b3.grill.finished).toBe(true);
});

test("質問数が上限に達したら強制終了する", async () => {
  const { brew, fake } = await mashedBrew();
  const entries: GrillEntry[] = Array.from({ length: MAX_QUESTIONS }, (_, i) => ({
    id: String(i),
    question: `q${i}`,
    options: [],
    askedAt: new Date().toISOString(),
  }));
  const stuffed: Brew = { ...brew, grill: { ...brew.grill, entries } };
  const { brew: done, entry } = await nextQuestion(stuffed, fake);
  expect(entry).toBeNull();
  expect(done.grill.finished).toBe(true);
});
