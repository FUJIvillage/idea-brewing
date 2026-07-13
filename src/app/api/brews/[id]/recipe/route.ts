import { NextResponse } from "next/server";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { generatingRecipeBrews } from "@/lib/recipe/recipe-state";
import { writeBrew } from "@/lib/store";
import { getConfiguredClient } from "@/lib/llm";
import { generateRecipe, listRecipeFiles } from "@/lib/recipe";
import { brewNotFound, errorResponse, findBrew } from "@/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ files: await listRecipeFiles(id) });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (generatingRecipeBrews.has(id)) {
    return NextResponse.json({ error: "レシピを生成中です。" }, { status: 409 });
  }
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  generatingRecipeBrews.add(id);
  try {
    const brew = await findBrew(id);
    if (!brew) return brewNotFound();
    if (!brew.boil.finished) {
      return NextResponse.json({ error: "煮沸が完了していません。" }, { status: 400 });
    }
    const client = await getConfiguredClient();
    const done = await generateRecipe(brew, client, async (b) => {
      await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
    });
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    generatingRecipeBrews.delete(id);
  }
}
