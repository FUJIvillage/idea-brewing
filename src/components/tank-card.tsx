"use client";

import Link from "next/link";
import { Ps1Tank } from "@/components/ps1/ps1-tank";
import {
  defaultTabForBrew,
  progressBlocks,
  progressPercent,
  tankLabel,
} from "@/components/ps1/brew-ui";
import { confirmSound } from "@/components/ps1/sound";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";

const STAGE_INFO: Record<Brew["stage"], { label: string; percent: number }> = {
  ingredients: { label: "原料投入中", percent: 20 },
  boiling: { label: "煮沸中", percent: 55 },
  fermenting: { label: "発酵待ち", percent: 85 },
  done: { label: "レシピ完成", percent: 100 },
  built: { label: "提供中(ビルド済み)", percent: 100 },
};

function stageLabel(brew: Brew): string {
  if (brew.stage !== "built") return STAGE_INFO[brew.stage].label;
  const latest = latestSucceededBatch(brew);
  if (!latest) return STAGE_INFO.built.label;
  const pubSuffix = latest.pub ? `・Pub ${latest.pub.overall.toFixed(1)}` : "";
  return latest.evaluation
    ? `提供中(バッチ${latest.number}・スコア${latest.evaluation.overall.toFixed(1)}${pubSuffix})`
    : `提供中(バッチ${latest.number}${pubSuffix})`;
}

export function TankCard({ brew, index }: { brew: Brew; index: number }) {
  const pct = progressPercent(brew.stage);
  const tab = defaultTabForBrew(brew);

  return (
    <Link
      href={`/brews/${brew.id}?tab=${tab}`}
      onClick={() => confirmSound()}
      className="ps-panel block p-3.5 hover:border-[#f5b94a]"
    >
      <div
        className="relative flex h-[150px] items-end justify-center overflow-hidden border-2 border-[#3a2a12]"
        style={{ background: "#040201" }}
      >
        <Ps1Tank fill={pct} size={142} />
        <span
          className="absolute top-1.5 right-2 text-[12px]"
          style={{ color: "rgba(255,220,160,.5)" }}
        >
          {tankLabel(index)}
        </span>
      </div>
      <h2 className="mt-3 mb-0.5 truncate text-[17px] font-normal tracking-wide text-[#ffe9c0]">
        ▶ {brew.name}
      </h2>
      <p className="m-0 text-[13px] text-[#e0a83c]">{stageLabel(brew)}</p>
      <p className="mt-2 mb-0 text-[14px] tracking-[2px] text-[#f5a623]">
        {progressBlocks(pct)}{" "}
        <span className="text-[12px]" style={{ color: "rgba(255,220,160,.5)" }}>
          {pct}%
        </span>
      </p>
    </Link>
  );
}
