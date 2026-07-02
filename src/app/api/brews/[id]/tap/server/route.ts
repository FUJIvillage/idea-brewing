import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { readBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { serverStatus, startServer, stopServer } from "@/lib/tap/server-manager";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await readBrew(id);
  } catch {
    return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
  }
  return NextResponse.json(serverStatus(id));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    let action: unknown;
    try {
      const body = (await req.json()) as { action?: unknown } | null;
      action = body?.action;
    } catch {
      return NextResponse.json({ error: "不正なアクションです。" }, { status: 400 });
    }
    if (action === "start") {
      const target = latestSucceededBatch(brew);
      if (!target) {
        return NextResponse.json({ error: "ビルドが成功していません。" }, { status: 400 });
      }
      await startServer(id, target.number);
    } else if (action === "stop") {
      await stopServer(id);
    } else {
      return NextResponse.json({ error: "不正なアクションです。" }, { status: 400 });
    }

    return NextResponse.json(serverStatus(id));
  } catch (err) {
    return errorResponse(err);
  }
}
