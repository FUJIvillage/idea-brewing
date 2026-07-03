import { NextResponse } from "next/server";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { getConfiguredClient } from "@/lib/llm";
import { generateRecipe, listRecipeFiles } from "@/lib/recipe";
import { errorResponse } from "@/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ files: await listRecipeFiles(id) });
}

// 生成中ロックはディスク(recipeProgress)ではなくメモリで持つ。
// クラッシュ時にフラグが残留してブリューが永久ロックされるのを防ぎ、
// 最初の進捗書き込みまでの数msの隙間も塞ぐ(再起動でリセットされるのは許容)。
const generating = new Set<string>();

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  if (generating.has(id)) {
    return NextResponse.json({ error: "レシピを生成中です。" }, { status: 409 });
  }
  generating.add(id);
  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }
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
  } finally {
    generating.delete(id);
  }
}
