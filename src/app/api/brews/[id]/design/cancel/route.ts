import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew } from "@/lib/api";
import { normalizeStaleDesignMock } from "@/lib/design";
import { designCancelTokens } from "@/lib/design/design-state";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { writeBrew } from "@/lib/store";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = designCancelTokens.get(id);
  if (token) {
    token.cancelled = true;
    return NextResponse.json({ ok: true });
  }

  // 別工程が本当に実行中なら、残留補正の書き込みが進捗保存と競合するため何もしない
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }

  try {
    const brew = await findBrew(id);
    if (!brew) return brewNotFound();

    // クラッシュで generating が残留した場合の復旧経路
    const normalized = normalizeStaleDesignMock(brew);
    if (normalized !== brew) {
      return NextResponse.json(await writeBrew(normalized));
    }

    return NextResponse.json({ error: "デザイン生成は実行されていません。" }, { status: 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
