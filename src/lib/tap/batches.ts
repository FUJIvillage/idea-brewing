import type { BatchRecord, Brew } from "@/lib/store/types";

/** 最新(番号最大)の成功バッチ。なければ null */
export function latestSucceededBatch(brew: Brew): BatchRecord | null {
  let latest: BatchRecord | null = null;
  for (const b of brew.batches) {
    if (b.status === "succeeded" && (!latest || b.number > latest.number)) latest = b;
  }
  return latest;
}

/** 既存バッチの最大番号。バッチなしなら 0 */
export function maxBatchNumber(brew: Brew): number {
  return brew.batches.reduce((max, b) => Math.max(max, b.number), 0);
}

/** number をキーに追加/置換し、番号順に並べ直す */
export function upsertBatch(batches: BatchRecord[], record: BatchRecord): BatchRecord[] {
  return [...batches.filter((b) => b.number !== record.number), record].sort(
    (a, b) => a.number - b.number,
  );
}
