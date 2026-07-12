import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { maturingBrews } from "@/lib/mature/mature-state";
import { pubbingBrews } from "@/lib/pub/pub-state";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { normalizeStaleBatch } from "@/lib/tap";
import { cancelTokens } from "@/lib/tap/build-state";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = cancelTokens.get(id);
  if (token) {
    token.cancelled = true;
    return NextResponse.json({ ok: true });
  }

  // 熟成中は runNextBatch が building 状態のバッチを永続化するため、
  // 残留補正で実行中のバッチを failed に書き換えないようガードする。
  if (maturingBrews.has(id)) {
    return NextResponse.json(
      { error: "熟成が実行中です。中断は熟成タブから行ってください。" },
      { status: 409 },
    );
  }
  // Pub中も進捗保存と残留補正の書き込みが競合するためガードする
  if (pubbingBrews.has(id)) {
    return NextResponse.json(
      { error: "Pubが実行中です。中断はPubタブから行ってください。" },
      { status: 409 },
    );
  }

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    // クラッシュで building 残留した場合の復旧経路。
    const normalized = normalizeStaleBatch(brew);
    if (normalized !== brew) {
      return NextResponse.json(await writeBrew(normalized));
    }

    return NextResponse.json({ error: "ビルドは実行されていません。" }, { status: 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
