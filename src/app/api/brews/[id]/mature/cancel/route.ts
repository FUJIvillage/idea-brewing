import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation } from "@/lib/mature";
import { isBrewBusy, matureCancelTokens } from "@/lib/mature/mature-state";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { normalizeStaleBatch } from "@/lib/tap";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = matureCancelTokens.get(id);
  if (token) {
    token.cancelled = true;
    return NextResponse.json({ ok: true });
  }

  // 別工程が本当に実行中なら、残留補正の書き込みが進捗保存と競合するため何もしない
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    // クラッシュで maturationProgress が残留した場合の復旧経路。
    // 熟成はビルドを内包し building バッチも永続化するため、バッチの残留補正もあわせて行う
    const normalized = normalizeStaleBatch(normalizeStaleMaturation(brew));
    if (normalized !== brew) {
      return NextResponse.json(await writeBrew(normalized));
    }

    return NextResponse.json({ error: "熟成は実行されていません。" }, { status: 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
