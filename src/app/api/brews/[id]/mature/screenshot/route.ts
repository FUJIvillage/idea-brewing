import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { SCREENSHOT_FILES } from "@/lib/mature/screenshot";
import { readBrew, tapDir } from "@/lib/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    try {
      await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    const url = new URL(req.url);
    const batch = Number(url.searchParams.get("batch"));
    const name = url.searchParams.get("name") ?? "";
    if (!Number.isInteger(batch) || batch < 1) {
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
      headers: { "content-type": "image/png" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
