import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LlmClient } from "@/lib/llm/client";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type BrewSheet,
  type BoilEntry,
} from "@/lib/store/types";

export const MAX_QUESTIONS = 20;

const nextSchema = z.object({
  done: z.boolean(),
  question: z.string().nullable(),
  options: z
    .array(z.object({ label: z.string(), recommended: z.boolean() }))
    .nullable(),
});

const applySchema = z.object({
  updates: z.array(
    z.object({
      key: z.enum(SHEET_KEYS),
      content: z.string(),
      sufficiency: z.enum(["full", "thin", "empty"]),
    }),
  ),
});

const BOIL_SYSTEM = [
  "あなたは idea brewing の煮沸職人です。",
  "ブリューシートの不足項目・項目間の矛盾・曖昧な表現を1つ選び、それを解消する質問を1問だけ作ります。",
  "質問には2〜4個の選択肢を付け、最も推奨する選択肢1つだけ recommended を true にします。",
  "既に質問済みの内容を繰り返してはいけません。",
  "全項目が十分でこれ以上聞くことが無ければ done を true、question と options を null にします。",
  "出力はすべて日本語。",
].join("\n");

const APPLY_SYSTEM = [
  "あなたは idea brewing の煮沸職人です。ユーザーの回答をブリューシートに反映します。",
  "回答によって内容が確定・具体化した項目だけを updates に含め、各項目の新しい全文と充足度(full/thin/empty)を返します。",
  "回答と無関係な項目は updates に含めないでください。",
  "出力はすべて日本語。",
].join("\n");

function sheetDump(sheet: BrewSheet): string {
  return SHEET_KEYS.map(
    (k) =>
      `### ${SHEET_LABELS[k]}(充足度: ${sheet[k].sufficiency})\n${sheet[k].content || "(空)"}`,
  ).join("\n\n");
}

function historyDump(entries: BoilEntry[]): string {
  if (entries.length === 0) return "(まだ質問していない)";
  return entries
    .map((e, i) => `Q${i + 1}: ${e.question}\nA${i + 1}: ${e.answer ?? "(未回答)"}`)
    .join("\n");
}

export async function nextQuestion(
  brew: Brew,
  client: LlmClient,
): Promise<{ brew: Brew; entry: BoilEntry | null }> {
  if (!brew.sheet) throw new Error("シートがまだありません。先に仕込みを実行してください。");
  const finish = (b: Brew): { brew: Brew; entry: null } => ({
    brew: { ...b, boil: { ...b.boil, finished: true } },
    entry: null,
  });

  if (brew.boil.finished) return { brew, entry: null };
  if (brew.boil.entries.length >= MAX_QUESTIONS) return finish(brew);
  if (SHEET_KEYS.every((k) => brew.sheet![k].sufficiency === "full")) return finish(brew);

  const out = await client.generateObject(nextSchema, {
    tag: "boil-next",
    system: BOIL_SYSTEM,
    prompt: `## 現在のブリューシート\n${sheetDump(brew.sheet)}\n\n## これまでの質疑\n${historyDump(brew.boil.entries)}\n\n次の質問を1問作ってください。`,
  });

  if (out.done || !out.question || !out.options) return finish(brew);

  const entry: BoilEntry = {
    id: randomUUID(),
    question: out.question,
    options: out.options,
    askedAt: new Date().toISOString(),
  };
  return {
    brew: { ...brew, boil: { ...brew.boil, entries: [...brew.boil.entries, entry] } },
    entry,
  };
}

export async function applyAnswer(
  brew: Brew,
  entryId: string,
  answer: string,
  by: "user" | "auto",
  client: LlmClient,
): Promise<Brew> {
  if (!brew.sheet) throw new Error("シートがまだありません。");
  const entry = brew.boil.entries.find((e) => e.id === entryId);
  if (!entry) throw new Error("質問が見つかりません。");

  const out = await client.generateObject(applySchema, {
    tag: "boil-apply",
    system: APPLY_SYSTEM,
    prompt: `## 現在のブリューシート\n${sheetDump(brew.sheet)}\n\n## 質問\n${entry.question}\n\n## ユーザーの回答\n${answer}\n\n回答をシートに反映してください。`,
  });

  const sheet: BrewSheet = { ...brew.sheet };
  for (const u of out.updates) {
    sheet[u.key] = {
      content: u.content,
      sufficiency: u.sufficiency,
      userEdited: sheet[u.key].userEdited,
    };
  }
  const entries = brew.boil.entries.map((e) =>
    e.id === entryId ? { ...e, answer, answeredBy: by } : e,
  );
  return { ...brew, sheet, boil: { ...brew.boil, entries } };
}

export function finishBoil(brew: Brew): Brew {
  return { ...brew, boil: { ...brew.boil, finished: true }, stage: "fermenting" };
}

export function setAutoMode(brew: Brew, auto: boolean): Brew {
  return { ...brew, boil: { ...brew.boil, auto } };
}
