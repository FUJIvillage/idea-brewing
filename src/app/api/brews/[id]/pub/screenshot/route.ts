import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, parseBatchParam } from "@/lib/api";
import { pubDir } from "@/lib/pub";
import { PUB_SCREENSHOT_FILES } from "@/lib/pub/constants";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    if (!(await findBrew(id))) return brewNotFound();

    const url = new URL(req.url);
    const batch = parseBatchParam(req);
    const name = url.searchParams.get("name") ?? "";
    if (batch === null) {
      return NextResponse.json(
        { error: "batch は1以上の整数で指定してください。" },
        { status: 400 },
      );
    }
    if (!PUB_SCREENSHOT_FILES.includes(name)) {
      return NextResponse.json({ error: "不正なファイル名です。" }, { status: 400 });
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(path.join(pubDir(id, batch), name));
    } catch {
      return NextResponse.json({ error: "スクリーンショットが見つかりません。" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      // 再実行でスクリーンショットが上書きされるためキャッシュさせない
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
