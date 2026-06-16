import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { tapDir } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const raw = await fs.readFile(path.join(tapDir(id, 1), "build.log"), "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return NextResponse.json({ lines: lines.slice(-200) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ lines: [] });
    }
    return errorResponse(err);
  }
}
