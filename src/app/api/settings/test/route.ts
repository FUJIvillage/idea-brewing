import { NextResponse } from "next/server";
import { clientForSettings } from "@/lib/llm";
import type { Settings } from "@/lib/store/types";
import { errorResponse } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const settings = (await req.json()) as Settings;
    try {
      const client = clientForSettings(settings);
      const { value: reply } = await client.generateText({
        tag: "connection-test",
        system: "あなたは接続テストに応答するアシスタントです。",
        prompt: "「pong」とだけ返答してください。",
      });
      return NextResponse.json({ ok: true, reply });
    } catch (err) {
      // LLM 呼び出しの失敗は接続テストの結果として 200 で返す
      return NextResponse.json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    return errorResponse(err);
  }
}
