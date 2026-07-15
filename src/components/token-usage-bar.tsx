import {
  sumTokenUsage,
  USAGE_STAGE_KEYS,
  type TokenCounts,
  type UsageStageKey,
} from "@/lib/llm/usage";
import type { Brew, BrewTokenUsage } from "@/lib/store/types";

export const USAGE_STAGE_LABELS: Record<UsageStageKey, string> = {
  mash: "仕込み",
  boil: "煮沸",
  recipe: "レシピ",
  evaluate: "熟成",
  pub: "Pub",
  tap: "タップ",
  design: "デザイン",
};

export function formatTokenCount(n: number): string {
  return n.toLocaleString("ja-JP");
}

export function formatTokenCell(counts: TokenCounts | undefined): {
  input: string;
  output: string;
  total: string;
} {
  if (!counts) return { input: "—", output: "—", total: "—" };
  return {
    input: formatTokenCount(counts.input),
    output: formatTokenCount(counts.output),
    total: formatTokenCount(counts.total),
  };
}

export function hasAnyTokenUsage(usage: BrewTokenUsage | null | undefined): boolean {
  if (!usage) return false;
  return USAGE_STAGE_KEYS.some((key) => usage.byStage[key] != null);
}

export function TokenUsageBar({ brew }: { brew: Brew }) {
  const usage = brew.tokenUsage;
  const empty = !hasAnyTokenUsage(usage);
  const total = formatTokenCell(sumTokenUsage(usage));

  return (
    <section
      className="mt-3"
      data-testid="token-usage-bar"
      aria-label="工程別トークン消費"
    >
      <div
        className="px-3 py-2.5 text-[12px] leading-relaxed tracking-wide"
        style={{
          background: "#120c06",
          border: "1px solid #5a3e18",
          color: "rgba(255,220,160,.75)",
        }}
      >
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-[#ffe9c0]">◆ トークン消費</span>
          {!empty && (
            <span className="text-[#c8a060]">
              合計 入 {total.input} / 出 {total.output} / 計 {total.total}
            </span>
          )}
        </div>
        {empty ? (
          <p className="m-0 text-[12px]" style={{ color: "rgba(255,220,160,.45)" }}>
            まだトークン消費なし
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left">
              <thead>
                <tr style={{ color: "rgba(255,220,160,.5)" }}>
                  <th className="py-0.5 pr-2 font-normal">工程</th>
                  <th className="py-0.5 px-1 text-right font-normal">入力</th>
                  <th className="py-0.5 px-1 text-right font-normal">出力</th>
                  <th className="py-0.5 pl-1 text-right font-normal">合計</th>
                </tr>
              </thead>
              <tbody>
                {USAGE_STAGE_KEYS.map((key) => {
                  const cell = formatTokenCell(usage?.byStage[key]);
                  return (
                    <tr key={key}>
                      <td className="py-0.5 pr-2 text-[#e8c898]">{USAGE_STAGE_LABELS[key]}</td>
                      <td className="py-0.5 px-1 text-right tabular-nums">{cell.input}</td>
                      <td className="py-0.5 px-1 text-right tabular-nums">{cell.output}</td>
                      <td className="py-0.5 pl-1 text-right tabular-nums text-[#ffe9c0]">
                        {cell.total}
                      </td>
                    </tr>
                  );
                })}
                <tr
                  style={{
                    borderTop: "1px solid #3a2a12",
                    color: "#ffe9c0",
                  }}
                >
                  <td className="py-1 pr-2">合計</td>
                  <td className="py-1 px-1 text-right tabular-nums">{total.input}</td>
                  <td className="py-1 px-1 text-right tabular-nums">{total.output}</td>
                  <td className="py-1 pl-1 text-right tabular-nums">{total.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
