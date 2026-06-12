import { NextResponse } from "next/server";
import { readBrew } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await readBrew(id));
  } catch {
    return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
  }
}
