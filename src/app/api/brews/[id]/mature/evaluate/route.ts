import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, withPhaseLock } from "@/lib/api";
import { normalizeStaleMaturation, runEvaluate } from "@/lib/mature";
import { hasRubric, RUBRIC_MISSING_ERROR } from "@/lib/mature/materials";
import { matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveEvaluateDeps } from "@/lib/mature/resolve";
import { writeBrew } from "@/lib/store";
import { normalizeStalePub } from "@/lib/pub";
import { normalizeStaleBatch } from "@/lib/tap";
import { latestSucceededBatch } from "@/lib/tap/batches";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withPhaseLock(id, maturingBrews, matureCancelTokens, async (token) => {
    try {
      let brew = await findBrew(id);
      if (!brew) return brewNotFound();
      brew = normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew)));

      if (!latestSucceededBatch(brew)) {
        return NextResponse.json({ error: "成功したバッチがありません。" }, { status: 400 });
      }
      if (!(await hasRubric(id))) {
        return NextResponse.json({ error: RUBRIC_MISSING_ERROR }, { status: 400 });
      }

      const deps = await resolveEvaluateDeps();
      const done = await runEvaluate(brew, {
        ...deps,
        cancel: token,
        onProgress: async (b) => {
          await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
        },
      });
      return NextResponse.json(await writeBrew(done));
    } catch (err) {
      return errorResponse(err);
    }
  });
}
