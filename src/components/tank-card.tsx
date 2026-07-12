import Link from "next/link";
import { latestPubBatch } from "@/lib/pub/leaderboard";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";

const STAGE_INFO: Record<Brew["stage"], { label: string; percent: number }> = {
  ingredients: { label: "原料投入中", percent: 20 },
  grilling: { label: "グリル中", percent: 55 },
  fermenting: { label: "発酵待ち", percent: 85 },
  done: { label: "レシピ完成", percent: 100 },
  built: { label: "提供中(ビルド済み)", percent: 100 },
};

function stageLabel(brew: Brew): string {
  if (brew.stage !== "built") return STAGE_INFO[brew.stage].label;
  const latest = latestSucceededBatch(brew);
  if (!latest) return STAGE_INFO.built.label;
  const pub = latestPubBatch(brew)?.pub;
  const pubSuffix = pub ? `・Pub ${pub.overall.toFixed(1)}` : "";
  return latest.evaluation
    ? `提供中(バッチ${latest.number}・スコア${latest.evaluation.overall.toFixed(1)}${pubSuffix})`
    : `提供中(バッチ${latest.number}${pubSuffix})`;
}

export function TankCard({ brew }: { brew: Brew }) {
  const stage = STAGE_INFO[brew.stage];
  return (
    <Link
      href={`/brews/${brew.id}`}
      className="block rounded-xl border border-amber-900/60 bg-[var(--tank)] p-4 transition hover:border-amber-500"
    >
      <div className="relative h-40 overflow-hidden rounded-lg border border-amber-950 bg-black/40">
        <div
          className="absolute bottom-0 w-full bg-gradient-to-t from-amber-700 to-amber-500/80 transition-all"
          style={{ height: `${stage.percent}%` }}
        >
          <span className="bubble absolute bottom-2 left-1/4 h-2 w-2 rounded-full bg-amber-200/60" />
          <span className="bubble absolute bottom-4 left-2/3 h-1.5 w-1.5 rounded-full bg-amber-100/50 [animation-delay:0.8s]" />
          <span className="bubble absolute bottom-3 left-1/2 h-1 w-1 rounded-full bg-amber-100/40 [animation-delay:1.6s]" />
        </div>
      </div>
      <h2 className="mt-3 truncate font-bold text-amber-100">{brew.name}</h2>
      <p className="text-sm text-amber-400">{stageLabel(brew)}</p>
    </Link>
  );
}
