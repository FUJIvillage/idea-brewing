import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation, runAutoMaturation } from "@/lib/mature";
import { isBrewBusy, matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveEvaluateDeps, resolveNextBatchDeps } from "@/lib/mature/resolve";
import { readRecipeFile } from "@/lib/recipe";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { TapNotConfiguredError } from "@/lib/tap/resolve";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  maturingBrews.add(id);
  const token = { cancelled: false };
  matureCancelTokens.set(id, token);

  try {
    let body: { targetScore?: unknown; maxBatches?: unknown } | null = null;
    try {
      body = (await req.json()) as { targetScore?: unknown; maxBatches?: unknown } | null;
    } catch {
      // ボディなしはデフォルト値で実行する
    }
    const targetScore = body?.targetScore ?? 4;
    const maxBatches = body?.maxBatches ?? 3;
    if (typeof targetScore !== "number" || Number.isNaN(targetScore) || targetScore < 1 || targetScore > 5) {
      return NextResponse.json(
        { error: "targetScore は1〜5の数値で指定してください。" },
        { status: 400 },
      );
    }
    if (typeof maxBatches !== "number" || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10) {
      return NextResponse.json(
        { error: "maxBatches は1〜10の整数で指定してください。" },
        { status: 400 },
      );
    }

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

    let nextDeps: Awaited<ReturnType<typeof resolveNextBatchDeps>>;
    try {
      nextDeps = await resolveNextBatchDeps();
    } catch (err) {
      if (err instanceof TapNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    const evalDeps = await resolveEvaluateDeps();

    const done = await runAutoMaturation(
      normalizeStaleMaturation(brew),
      {
        ...evalDeps,
        ...nextDeps,
        cancel: token,
        onProgress: async (b) => {
          await writeBrew(b);
        },
      },
      { targetScore, maxBatches },
    );
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    maturingBrews.delete(id);
    matureCancelTokens.delete(id);
  }
}
