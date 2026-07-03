import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { readBrew, tapDir } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { maxBatchNumber } from "@/lib/tap/batches";

const TAIL_BYTES = 64 * 1024;

async function readLogTail(file: string): Promise<string[]> {
  const stat = await fs.stat(file);
  const length = Math.min(stat.size, TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const handle = await fs.open(file, "r");
  try {
    await handle.read(buffer, 0, length, stat.size - length);
  } finally {
    await handle.close();
  }
  return buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-200);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    const batchParam = new URL(req.url).searchParams.get("batch");
    let batch: number;
    if (batchParam === null) {
      batch = Math.max(maxBatchNumber(brew), 1); // 省略時は最新バッチ
    } else {
      batch = Number(batchParam);
      if (!Number.isInteger(batch) || batch < 1) {
        return NextResponse.json(
          { error: "batch は1以上の整数で指定してください。" },
          { status: 400 },
        );
      }
    }
    return NextResponse.json({
      lines: await readLogTail(path.join(tapDir(id, batch), "build.log")),
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ lines: [] });
    }
    return errorResponse(err);
  }
}
