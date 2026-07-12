import { listBrews } from "@/lib/store";
import type { BatchRecord, Brew } from "@/lib/store/types";

export interface LeaderboardEntry {
  brewId: string;
  name: string;
  batch: number; // Pub レポートを持つ最新バッチ
  pubOverall: number;
  selfOverall: number | null; // 同バッチの自己評価(あれば)
  personaCount: number;
  ranAt: string;
}

/** pub を持つ最大番号のバッチ(タンクカード表示にも使う) */
export function latestPubBatch(brew: Brew): BatchRecord | null {
  let found: BatchRecord | null = null;
  for (const b of brew.batches) {
    if (b.pub !== null && (found === null || b.number > found.number)) found = b;
  }
  return found;
}

/** Pub スコア降順(同点は実施日時の新しい順)のランキングを作る純粋関数 */
export function buildLeaderboard(brews: Brew[]): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  for (const brew of brews) {
    const batch = latestPubBatch(brew);
    if (!batch?.pub) continue;
    entries.push({
      brewId: brew.id,
      name: brew.name,
      batch: batch.number,
      pubOverall: batch.pub.overall,
      selfOverall: batch.evaluation?.overall ?? null,
      personaCount: batch.pub.personaResults.length,
      ranAt: batch.pub.ranAt,
    });
  }
  return entries.sort((a, b) => b.pubOverall - a.pubOverall || b.ranAt.localeCompare(a.ranAt));
}

export async function collectLeaderboard(): Promise<LeaderboardEntry[]> {
  return buildLeaderboard(await listBrews());
}
