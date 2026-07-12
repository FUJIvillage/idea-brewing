import { describe, expect, it } from "vitest";
import { buildLeaderboard, latestPubBatch } from "@/lib/pub/leaderboard";
import type { BatchRecord, Brew, PubReport } from "@/lib/store/types";

function report(overall: number, ranAt: string): PubReport {
  return { overall, personaResults: [], summary: "総括", ranAt };
}

function batch(number: number, pub: PubReport | null, evaluationOverall?: number): BatchRecord {
  return {
    number,
    status: "succeeded",
    startedAt: "2026-07-12T00:00:00.000Z",
    finishedAt: "2026-07-12T00:00:00.000Z",
    error: null,
    evaluation:
      evaluationOverall === undefined
        ? null
        : {
            overall: evaluationOverall,
            axes: [],
            summary: "",
            improvements: ["x"],
            strategy: "repair",
            screenshotsUsed: false,
            evaluatedAt: "2026-07-12T00:00:00.000Z",
          },
    pub,
  };
}

function brew(id: string, name: string, batches: BatchRecord[]): Brew {
  return { id, name, batches } as unknown as Brew;
}

describe("latestPubBatch", () => {
  it("pub を持つ最大番号のバッチを返す(なければ null)", () => {
    const b = brew("a", "A", [batch(1, report(4.0, "2026-07-12T01:00:00.000Z")), batch(2, null)]);
    expect(latestPubBatch(b)?.number).toBe(1);
    expect(latestPubBatch(brew("b", "B", [batch(1, null)]))).toBeNull();
  });
});

describe("buildLeaderboard", () => {
  it("pubOverall 降順・同点は ranAt 新しい順で並べ、未実施は除外する", () => {
    const entries = buildLeaderboard([
      brew("a", "A", [batch(1, report(3.5, "2026-07-10T00:00:00.000Z"))]),
      brew("b", "B", [batch(1, report(4.5, "2026-07-11T00:00:00.000Z"), 4.0)]),
      brew("c", "C", [batch(1, null)]),
      brew("d", "D", [batch(1, report(3.5, "2026-07-12T00:00:00.000Z"))]),
    ]);
    expect(entries.map((e) => e.brewId)).toEqual(["b", "d", "a"]);
    expect(entries[0].selfOverall).toBe(4.0);
    expect(entries[1].selfOverall).toBeNull();
  });

  it("各ブリューは pub を持つ最新バッチだけが載る", () => {
    const entries = buildLeaderboard([
      brew("a", "A", [
        batch(1, report(2.0, "2026-07-10T00:00:00.000Z")),
        batch(2, report(4.0, "2026-07-11T00:00:00.000Z")),
      ]),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].batch).toBe(2);
    expect(entries[0].pubOverall).toBe(4.0);
  });
});
