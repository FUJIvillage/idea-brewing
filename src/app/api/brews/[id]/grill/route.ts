import { NextResponse } from "next/server";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { writeBrew } from "@/lib/store";
import { getConfiguredClient } from "@/lib/llm";
import { applyAnswer, finishGrill, nextQuestion, setAutoMode } from "@/lib/grill";
import { brewNotFound, errorResponse, findBrew } from "@/lib/api";
import type { Brew } from "@/lib/store/types";

type GrillRequest =
  | { action: "next" }
  | { action: "answer"; entryId: string; answer: string; by: "user" | "auto" }
  | { action: "finish" }
  | { action: "auto"; auto: boolean };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // 実行中の工程が進捗保存でBrew全体を上書きするため、並行編集は失われる前に拒否する
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  const brew = await findBrew(id);
  if (!brew) return brewNotFound();
  try {
    const body = (await req.json()) as GrillRequest;

    if (body.action === "auto") {
      const next = setAutoMode(brew, body.auto);
      const saved = await writeBrew(next);
      return NextResponse.json({ brew: saved, entry: null });
    }
    if (body.action === "finish") {
      const next = finishGrill(brew);
      const saved = await writeBrew(next);
      return NextResponse.json({ brew: saved, entry: null });
    }

    const client = await getConfiguredClient();
    if (body.action === "next") {
      const { brew: asked, entry } = await nextQuestion(brew, client);
      // LLM 側の判断でグリルが終わったら発酵待ちステージへ進める
      const next: Brew =
        asked.grill.finished && asked.stage === "grilling"
          ? { ...asked, stage: "fermenting" }
          : asked;
      const saved = await writeBrew(next);
      return NextResponse.json({ brew: saved, entry });
    }
    const next = await applyAnswer(brew, body.entryId, body.answer, body.by, client);
    const saved = await writeBrew(next);
    return NextResponse.json({ brew: saved, entry: null });
  } catch (err) {
    return errorResponse(err);
  }
}
