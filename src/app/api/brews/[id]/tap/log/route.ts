import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { readBrew, tapDir } from "@/lib/store";

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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    try {
      await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }
    return NextResponse.json({ lines: await readLogTail(path.join(tapDir(id, 1), "build.log")) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ lines: [] });
    }
    return errorResponse(err);
  }
}
