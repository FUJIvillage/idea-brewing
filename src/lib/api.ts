import { NextResponse } from "next/server";
import { DesignNotConfiguredError } from "@/lib/design/resolve";
import { LlmNotConfiguredError } from "@/lib/llm";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { readBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import type { CancelToken } from "@/lib/tap/build-state";
import { TapNotConfiguredError } from "@/lib/tap/resolve";

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof LlmNotConfiguredError) {
    return NextResponse.json({ error: err.message, code: "not_configured" }, { status: 400 });
  }
  if (err instanceof TapNotConfiguredError || err instanceof DesignNotConfiguredError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** brew.json が無い・壊れている・IDが不正なら null(ルートは brewNotFound() を返す) */
export async function findBrew(id: string): Promise<Brew | null> {
  try {
    return await readBrew(id);
  } catch {
    return null;
  }
}

export function brewNotFound(): NextResponse {
  return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
}

/** クエリの batch を検証して返す。1以上の整数でなければ null */
export function parseBatchParam(req: Request): number | null {
  const batch = Number(new URL(req.url).searchParams.get("batch"));
  return Number.isInteger(batch) && batch >= 1 ? batch : null;
}

/**
 * 実行系工程(ビルド・熟成・Pub)の相互排他ロックとキャンセルトークンの
 * 登録・解放を共通化する。ここの手順が工程間でずれるとロック漏れの温床になる
 */
export async function withPhaseLock(
  id: string,
  lock: Set<string>,
  tokens: Map<string, CancelToken>,
  handler: (token: CancelToken) => Promise<NextResponse>,
): Promise<NextResponse> {
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  lock.add(id);
  const token: CancelToken = { cancelled: false };
  tokens.set(id, token);
  try {
    return await handler(token);
  } finally {
    lock.delete(id);
    tokens.delete(id);
  }
}
