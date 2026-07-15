import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { brewNotFound, findBrew } from "@/lib/api";
import { MOCK_PNG } from "@/lib/design";
import { designDir } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const brew = await findBrew(id);
  if (!brew) return brewNotFound();

  try {
    const png = await fs.readFile(path.join(designDir(id), MOCK_PNG));
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        // 再生成で同じパスの中身が変わるためキャッシュさせない
        "cache-control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "モックがありません。" }, { status: 404 });
  }
}
