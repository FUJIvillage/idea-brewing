import { NextResponse } from "next/server";
import { brewNotFound, findBrew, parseBatchParam } from "@/lib/api";
import { maxBatchNumber } from "@/lib/tap/batches";
import { readBuildCheckpoint } from "@/lib/tap/checkpoint";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const brew = await findBrew(id);
  if (!brew) return brewNotFound();
  const batchParam = parseBatchParam(req);
  const batch = batchParam ?? Math.max(1, maxBatchNumber(brew));
  const checkpoint = await readBuildCheckpoint(id, batch);
  return NextResponse.json({
    batch,
    resumable: checkpoint !== null,
    checkpoint,
  });
}
