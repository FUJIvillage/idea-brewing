import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, withPhaseLock } from "@/lib/api";
import { normalizeStaleMaturation, runAutoMaturation } from "@/lib/mature";
import { hasRubric, RUBRIC_MISSING_ERROR } from "@/lib/mature/materials";
import { matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveEvaluateDeps, resolveNextBatchDeps } from "@/lib/mature/resolve";
import { normalizeStalePub } from "@/lib/pub";
import { writeBrew } from "@/lib/store";
import { normalizeStaleBatch } from "@/lib/tap";
import { latestSucceededBatch } from "@/lib/tap/batches";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withPhaseLock(id, maturingBrews, matureCancelTokens, async (token) => {
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

      let brew = await findBrew(id);
      if (!brew) return brewNotFound();
      brew = normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew)));

      if (!latestSucceededBatch(brew)) {
        return NextResponse.json({ error: "成功したバッチがありません。" }, { status: 400 });
      }
      if (!(await hasRubric(id))) {
        return NextResponse.json({ error: RUBRIC_MISSING_ERROR }, { status: 400 });
      }

      const nextDeps = await resolveNextBatchDeps();
      const evalDeps = await resolveEvaluateDeps();

      const done = await runAutoMaturation(
        brew,
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
    }
  });
}
