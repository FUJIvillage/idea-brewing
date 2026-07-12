import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, parseBatchParam } from "@/lib/api";
import { SCREENSHOT_FILES } from "@/lib/mature/screenshot";
import { tapDir } from "@/lib/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    if (!(await findBrew(id))) return brewNotFound();

    const batch = parseBatchParam(req);
    const name = new URL(req.url).searchParams.get("name") ?? "";
    if (batch === null) {
      return NextResponse.json(
        { error: "batch は1以上の整数で指定してください。" },
        { status: 400 },
      );
    }
    if (!(SCREENSHOT_FILES as readonly string[]).includes(name)) {
      return NextResponse.json({ error: "不正なファイル名です。" }, { status: 400 });
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(path.join(tapDir(id, batch), "screenshots", name));
    } catch {
      return NextResponse.json({ error: "スクリーンショットが見つかりません。" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      // 再評価でスクリーンショットが上書きされるためキャッシュさせない
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
