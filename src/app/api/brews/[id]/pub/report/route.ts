import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, parseBatchParam } from "@/lib/api";
import { pubDir } from "@/lib/pub";
import { PUB_SCREENSHOT_FILES } from "@/lib/pub/constants";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const brew = await findBrew(id);
    if (!brew) return brewNotFound();

    const batch = parseBatchParam(req);
    if (batch === null) {
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
    for (const name of PUB_SCREENSHOT_FILES) {
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
