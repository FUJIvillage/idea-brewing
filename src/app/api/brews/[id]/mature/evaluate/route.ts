import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation, runEvaluate } from "@/lib/mature";
import { isBrewBusy, matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveEvaluateDeps } from "@/lib/mature/resolve";
import { readRecipeFile } from "@/lib/recipe";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  maturingBrews.add(id);
  const token = { cancelled: false };
  matureCancelTokens.set(id, token);

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    if (!latestSucceededBatch(brew)) {
      return NextResponse.json({ error: "成功したバッチがありません。" }, { status: 400 });
    }
    try {
      await readRecipeFile(id, "06-evaluation-criteria.md");
    } catch {
      return NextResponse.json(
        { error: "自己評価基準(06-evaluation-criteria.md)がありません。レシピを再生成してください。" },
        { status: 400 },
      );
    }

    const deps = await resolveEvaluateDeps();
    const done = await runEvaluate(normalizeStaleMaturation(brew), {
      ...deps,
      cancel: token,
      onProgress: async (b) => {
        await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
      },
    });
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    maturingBrews.delete(id);
    matureCancelTokens.delete(id);
  }
}
