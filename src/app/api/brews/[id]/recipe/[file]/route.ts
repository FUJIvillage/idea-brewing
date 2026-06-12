import { NextResponse } from "next/server";
import { readRecipeFile } from "@/lib/recipe";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await ctx.params;
  try {
    return NextResponse.json({ file, content: await readRecipeFile(id, file) });
  } catch {
    return NextResponse.json({ error: "ファイルが見つかりません。" }, { status: 404 });
  }
}
