import { NextResponse } from "next/server";
import { readBrew, readIngredientFile, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { getConfiguredClient } from "@/lib/llm";
import type { LlmImage } from "@/lib/llm/client";
import { runMash } from "@/lib/brew-sheet";
import { errorResponse } from "@/lib/api";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let brew: Brew;
  try {
    brew = await readBrew(id);
  } catch {
    return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
  }
  try {
    if (brew.ingredients.filter((i) => i.status === "ok").length === 0) {
      return NextResponse.json(
        { error: "原料がありません。先に原料を投入してください。" },
        { status: 400 },
      );
    }
    const client = await getConfiguredClient();
    const images: LlmImage[] = [];
    for (const ing of brew.ingredients) {
      if (ing.kind === "image" && ing.status === "ok" && ing.filePath) {
        images.push({
          data: await readIngredientFile(brew.id, ing.filePath),
          mimeType: ing.mimeType ?? "image/png",
        });
      }
    }
    const next = await runMash(brew, client, images);
    const saved = await writeBrew(next);
    return NextResponse.json(saved);
  } catch (err) {
    return errorResponse(err);
  }
}
