import { z } from "zod";
import type { LlmClient, LlmImage } from "@/lib/llm/client";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type BrewSheet,
  type SheetKey,
} from "@/lib/store/types";

const fieldSchema = z.object({
  content: z.string(),
  sufficiency: z.enum(["full", "thin", "empty"]),
});

const mashOutputSchema = z.object({
  concept: fieldSchema,
  targetUsers: fieldSchema,
  features: fieldSchema,
  lookAndTone: fieldSchema,
  successCriteria: fieldSchema,
  constraints: fieldSchema,
  evaluationAxes: fieldSchema,
});

const MASH_SYSTEM = [
  "あなたは idea brewing の醸造職人です。",
  "ユーザーが投入した原料(テキスト・URL本文・ドキュメント・画像)から、サービスのアイデアを7項目のブリューシートに構造化します。",
  "原料に根拠のない創作はせず、推定した部分は推定と分かる書き方をしてください。",
  "各項目に充足度を付けます: full=実装判断に十分 / thin=方向性はあるが詳細不足 / empty=情報なし。",
  "情報が無い項目は content を空文字、sufficiency を empty にしてください。",
  "出力はすべて日本語。",
].join("\n");

export function buildMashPrompt(brew: Brew): string {
  const parts: string[] = ["## 投入された原料"];
  let n = 0;
  for (const ing of brew.ingredients) {
    if (ing.status !== "ok") continue;
    n += 1;
    if (ing.kind === "image") {
      parts.push(`### 原料${n}(画像: ${ing.title})\n画像はメッセージに添付されています。`);
    } else {
      parts.push(`### 原料${n}(${ing.kind}: ${ing.title})\n${ing.text ?? ""}`);
    }
  }
  const locked = SHEET_KEYS.filter((k) => brew.sheet?.[k]?.userEdited);
  if (locked.length > 0) {
    parts.push("## ユーザー確定済み項目(この内容を前提として他項目を埋めること)");
    for (const key of locked) {
      parts.push(`- ${SHEET_LABELS[key]}: ${brew.sheet![key].content}`);
    }
  }
  parts.push("上記の原料からブリューシートを作成してください。");
  return parts.join("\n\n");
}

export async function runMash(
  brew: Brew,
  client: LlmClient,
  images: LlmImage[] = [],
): Promise<Brew> {
  const out = await client.generateObject(mashOutputSchema, {
    tag: "mash",
    system: MASH_SYSTEM,
    prompt: buildMashPrompt(brew),
    images,
  });
  const sheet = {} as BrewSheet;
  for (const key of SHEET_KEYS) {
    if (brew.sheet?.[key]?.userEdited) {
      sheet[key] = brew.sheet[key];
    } else {
      sheet[key] = { ...out[key], userEdited: false };
    }
  }
  // 再マッシュ時に前回のグリル完了状態が残ると質問が再開できないため、finished を戻す
  return {
    ...brew,
    sheet,
    stage: "grilling",
    grill: { ...brew.grill, finished: false },
  };
}

export function editSheetField(brew: Brew, key: SheetKey, content: string): Brew {
  if (!brew.sheet) throw new Error("シートがまだありません。先に仕込みを実行してください。");
  const sheet: BrewSheet = {
    ...brew.sheet,
    [key]: {
      content,
      sufficiency: content.trim() === "" ? "empty" : "full",
      userEdited: true,
    },
  };
  return { ...brew, sheet };
}
