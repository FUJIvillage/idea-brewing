import { NextResponse } from "next/server";
import { clientForSettings } from "@/lib/llm";
import type { Settings } from "@/lib/store/types";

export async function POST(req: Request) {
  const settings = (await req.json()) as Settings;
  try {
    const client = clientForSettings(settings);
    const reply = await client.generateText({
      tag: "connection-test",
      system: "あなたは接続テストに応答するアシスタントです。",
      prompt: "「pong」とだけ返答してください。",
    });
    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
