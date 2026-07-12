import { z } from "zod";
import type { LlmClient } from "@/lib/llm/client";
import type { Brew, PubPersona, SavedPersona } from "@/lib/store/types";
import { SHEET_LABELS } from "@/lib/store/types";
import { MAX_PUB_GUESTS } from "./constants";

const personasSchema = z.object({
  personas: z
    .array(
      z.object({
        name: z.string().min(1),
        profile: z.string().min(1),
        goals: z.array(z.string().min(1)).min(1).max(3),
      }),
    )
    .min(1)
    .max(MAX_PUB_GUESTS),
});

const PERSONA_SYSTEM = [
  "あなたは idea brewing の Pub の店主です。生成された Web サービスを試してくれる「AI客」を招きます。",
  "ブリューシートのターゲットユーザー像に合い、互いに個性・習熟度の異なるペルソナを指定人数ちょうど作ってください。",
  "goals はこのアプリを実際に操作して達成できる具体的な目的(1〜3件)にします。",
].join("\n");

export function buildPersonaPrompt(brew: Brew, count: number): string {
  const sheet = brew.sheet;
  if (!sheet) throw new Error("ブリューシートがありません。");
  return [
    `人数: ${count}`,
    `## ${SHEET_LABELS.concept}`,
    sheet.concept.content,
    `## ${SHEET_LABELS.targetUsers}`,
    sheet.targetUsers.content,
    `## ${SHEET_LABELS.features}`,
    sheet.features.content,
  ].join("\n\n");
}

/** ブリューシートから AI 客を自動生成する(origin: "auto") */
export async function generatePersonas(
  client: LlmClient,
  brew: Brew,
  count: number,
): Promise<PubPersona[]> {
  const prompt = buildPersonaPrompt(brew, count);
  const raw = await client.generateObject(personasSchema, {
    tag: "pub-persona",
    system: PERSONA_SYSTEM,
    prompt,
  });
  return raw.personas.slice(0, count).map((p) => ({ ...p, origin: "auto" as const }));
}

/** 常連客を Pub 参加用の PubPersona に変換する */
export function savedToPersona(saved: SavedPersona): PubPersona {
  return { name: saved.name, profile: saved.profile, goals: saved.goals, origin: "saved" };
}
