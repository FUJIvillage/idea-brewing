import { NextResponse } from "next/server";
import { LlmNotConfiguredError } from "@/lib/llm";

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof LlmNotConfiguredError) {
    return NextResponse.json({ error: err.message, code: "not_configured" }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: 500 });
}
