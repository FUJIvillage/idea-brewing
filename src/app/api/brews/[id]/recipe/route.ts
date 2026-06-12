import { NextResponse } from "next/server";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { getConfiguredClient } from "@/lib/llm";
import { generateRecipe, listRecipeFiles } from "@/lib/recipe";
import { errorResponse } from "@/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ files: await listRecipeFiles(id) });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let brew: Brew;
  try {
    brew = await readBrew(id);
  } catch {
    return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
  }
  try {
    if (!brew.grill.finished) {
      return NextResponse.json({ error: "グリルが完了していません。" }, { status: 400 });
    }
    const client = await getConfiguredClient();
    const done = await generateRecipe(brew, client, async (b) => {
      await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
    });
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  }
}
