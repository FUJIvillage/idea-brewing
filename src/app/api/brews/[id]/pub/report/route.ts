import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { pubDir } from "@/lib/pub";
import { readBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";

const SCREENSHOT_NAMES = [
  "persona-1.png",
  "persona-2.png",
  "persona-3.png",
  "persona-4.png",
  "persona-5.png",
];

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    const batch = Number(new URL(req.url).searchParams.get("batch"));
    if (!Number.isInteger(batch) || batch < 1) {
      return NextResponse.json(
        { error: "batch は1以上の整数で指定してください。" },
        { status: 400 },
      );
    }
    const record = brew.batches.find((b) => b.number === batch);
    if (!record) {
      return NextResponse.json({ error: "バッチが見つかりません。" }, { status: 404 });
    }

    const markdown = await fs
      .readFile(path.join(pubDir(id, batch), "report.md"), "utf8")
      .catch(() => null);
    const screenshots: string[] = [];
    for (const name of SCREENSHOT_NAMES) {
      try {
        await fs.access(path.join(pubDir(id, batch), name));
        screenshots.push(name);
      } catch {
        // 存在しないスクリーンショットは一覧に含めない
      }
    }
    return NextResponse.json({ markdown, report: record.pub, screenshots });
  } catch (err) {
    return errorResponse(err);
  }
}
