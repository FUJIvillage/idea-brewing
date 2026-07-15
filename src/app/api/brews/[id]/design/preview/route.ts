import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { brewNotFound, findBrew } from "@/lib/api";
import { PREVIEW_PNG, isValidPreviewPngSize } from "@/lib/design";
import { designDir } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const brew = await findBrew(id);
  if (!brew) return brewNotFound();

  try {
    const filePath = path.join(designDir(id), PREVIEW_PNG);
    const png = await fs.readFile(filePath);
    if (!isValidPreviewPngSize(png.byteLength)) {
      return NextResponse.json({ error: "プレビューがありません。" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "プレビューがありません。" }, { status: 404 });
  }
}
