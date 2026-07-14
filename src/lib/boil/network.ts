import type { BoilEntry, Brew } from "@/lib/store/types";

export function isNetworkFetchError(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /failed to fetch|networkerror|load failed|network request failed/i.test(err.message)
  );
}

export type BoilPostResult = { brew: Brew; entry: BoilEntry | null; recovered?: boolean };

/** 長時間LLM呼び出しで接続が切れても、最新Brewを再取得してauto継続できるようにする */
export async function postBoilOrRecover(
  brewId: string,
  body: unknown,
  deps: {
    post: (brewId: string, body: unknown) => Promise<{ brew: Brew; entry: BoilEntry | null }>;
    load: (brewId: string) => Promise<Brew>;
  },
): Promise<BoilPostResult> {
  try {
    return await deps.post(brewId, body);
  } catch (err) {
    if (!isNetworkFetchError(err)) throw err;
    const brew = await deps.load(brewId);
    return { brew, entry: null, recovered: true };
  }
}
