import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, withPhaseLock } from "@/lib/api";
import { normalizeStaleMaturation, runNextBatch } from "@/lib/mature";
import { matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveNextBatchDeps } from "@/lib/mature/resolve";
import { normalizeStalePub } from "@/lib/pub";
import { writeBrew } from "@/lib/store";
import { normalizeStaleBatch } from "@/lib/tap";
import { latestSucceededBatch } from "@/lib/tap/batches";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withPhaseLock(id, maturingBrews, matureCancelTokens, async (token) => {
    try {
      let brew = await findBrew(id);
      if (!brew) return brewNotFound();
      brew = normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew)));

      if (!latestSucceededBatch(brew)?.evaluation) {
        return NextResponse.json(
          { error: "最新の成功バッチがまだ評価されていません。先に評価を実行してください。" },
          { status: 400 },
        );
      }

      const deps = await resolveNextBatchDeps();
      const done = await runNextBatch(brew, {
        ...deps,
        cancel: token,
        onProgress: async (b) => {
          await writeBrew(b);
        },
      });
      return NextResponse.json(await writeBrew(done));
    } catch (err) {
      return errorResponse(err);
    }
  });
}
