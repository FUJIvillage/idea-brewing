import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStalePub } from "@/lib/pub";
import { pubCancelTokens } from "@/lib/pub/pub-state";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = pubCancelTokens.get(id);
  if (token) {
    token.cancelled = true;
    return NextResponse.json({ ok: true });
  }

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    // クラッシュで pubProgress が残留した場合の復旧経路。
    const normalized = normalizeStalePub(brew);
    if (normalized !== brew) {
      return NextResponse.json(await writeBrew(normalized));
    }

    return NextResponse.json({ error: "Pubは実行されていません。" }, { status: 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
