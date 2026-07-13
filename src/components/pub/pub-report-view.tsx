"use client";

import { useState } from "react";
import { pubScreenshotName } from "@/lib/pub/constants";
import type { PubPersonaResult, PubReport } from "@/lib/store/types";
import { PubBarScene } from "@/components/pub/pub-bar-scene";
import { PubVnBox } from "@/components/pub/pub-vn-box";
import { PubMeters } from "@/components/pub/pub-meters";
import { PubSeatRow } from "@/components/pub/pub-seat-row";

/** 行動ログから VN 用の一行サマリを作る */
function stepSummary(r: PubPersonaResult): string | undefined {
  if (r.status === "aborted" || r.steps.length === 0) return undefined;
  const last = r.steps[r.steps.length - 1];
  return `行動ログ: 全${r.steps.length}手 / 最後は「${last.action} → ${last.observation}」`;
}

/**
 * 1バッチ分の Pub レポートをバーシーンで見せる。
 * 注目する客(focusIdx)を内部に持つので、親では key={batch} でリマウントさせて
 * バッチ切替時に先頭客へリセットする(エフェクトでの setState を避けるため)。
 */
export function PubReportView({
  report,
  batch,
  brewId,
  screenshots,
}: {
  report: PubReport;
  batch: number;
  brewId: string;
  screenshots: { batch: number; names: string[] } | null;
}) {
  const [focusIdx, setFocusIdx] = useState(0);
  const focused = report.personaResults[focusIdx] ?? report.personaResults[0];
  if (!focused) return null;

  const hasShot =
    screenshots?.batch === batch && screenshots.names.includes(pubScreenshotName(focusIdx + 1));

  return (
    <div className="flex flex-col gap-4">
      <PubBarScene
        result={focused}
        sign={{ overall: report.overall, count: report.personaResults.length, batch }}
      />
      <PubVnBox
        key={`${focusIdx}:${focused.comment}`}
        name={focused.persona.name}
        origin={focused.persona.origin}
        line={focused.comment}
        sub={stepSummary(focused)}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex-1">
          <PubMeters result={focused} />
        </div>
        {hasShot && (
          <div className="shrink-0 border-2 border-[#c9a15c] bg-[#efe6d0] p-1.5 pb-4 shadow-[4px_4px_0_rgba(0,0,0,.5)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/brews/${brewId}/pub/screenshot?batch=${batch}&name=${pubScreenshotName(focusIdx + 1)}`}
              alt={`${focused.persona.name} の最終画面`}
              className="block max-h-44 border border-[#8a7a55]"
            />
            <p className="m-0 mt-1.5 text-center text-[11px] tracking-wide text-[#5a4a2a]">
              スナップ ／ {focused.persona.name}
            </p>
          </div>
        )}
      </div>

      <PubSeatRow results={report.personaResults} active={focusIdx} onSelect={setFocusIdx} />

      {focused.steps.length > 0 && (
        <details className="border-2 border-[#3a2a12] bg-[#0e0804] p-3">
          <summary className="cursor-pointer text-[13px] text-[#e0a83c]">
            客の動き({focused.steps.length}件)
          </summary>
          <ol className="mt-2 space-y-1 text-[13px]" style={{ color: "rgba(255,220,160,.7)" }}>
            {focused.steps.map((s) => (
              <li key={s.step}>
                {s.step}. {s.action} → {s.observation}
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="border-2 border-[#3a2a12] bg-[#0e0804] p-4">
        <h3 className="m-0 mb-2 text-[13px] font-normal tracking-[2px] text-[#f5b94a]">
          ◆ 店主メモ(バッチ{batch}・客{report.personaResults.length}人)
        </h3>
        <p className="m-0 whitespace-pre-wrap text-[14px] text-[#e8c07a]">{report.summary}</p>
      </div>
    </div>
  );
}
