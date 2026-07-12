import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation, runNextBatch } from "@/lib/mature";
import { isBrewBusy, matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveNextBatchDeps } from "@/lib/mature/resolve";
import { normalizeStalePub } from "@/lib/pub";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { normalizeStaleBatch } from "@/lib/tap";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { TapNotConfiguredError } from "@/lib/tap/resolve";

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
    brew = normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew)));

    if (!latestSucceededBatch(brew)?.evaluation) {
      return NextResponse.json(
        { error: "最新の成功バッチがまだ評価されていません。先に評価を実行してください。" },
        { status: 400 },
      );
    }

    let deps: Awaited<ReturnType<typeof resolveNextBatchDeps>>;
    try {
      deps = await resolveNextBatchDeps();
    } catch (err) {
      if (err instanceof TapNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

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
  } finally {
    maturingBrews.delete(id);
    matureCancelTokens.delete(id);
  }
}
