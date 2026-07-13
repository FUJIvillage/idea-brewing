import Link from "next/link";
import { buildLeaderboard } from "@/lib/pub/leaderboard";
import { listBrews } from "@/lib/store";

export const dynamic = "force-dynamic";

function rankLabel(i: number): { text: string; color: string } {
  if (i === 0) return { text: "1ST", color: "#ffd700" };
  if (i === 1) return { text: "2ND", color: "#c0c0c0" };
  if (i === 2) return { text: "3RD", color: "#cd7f32" };
  return { text: String(i + 1), color: "rgba(255,220,160,.6)" };
}

export default async function Leaderboard() {
  const brews = await listBrews();
  const entries = buildLeaderboard(brews);
  const unpubbed = brews.length - entries.length;

  return (
    <main className="ps-page max-w-[900px]">
      <Link href="/" className="ps-btn-ghost mb-4 inline-block">
        ◀ 醸造タンクへ戻る
      </Link>
      <div className="mb-6 text-center">
        <div className="text-[13px] tracking-[6px]" style={{ color: "rgba(255,220,160,.5)" }}>
          RANKING
        </div>
        <h1
          className="ps-chromatic-rank m-0 mt-0.5 text-[28px] font-normal tracking-[4px] text-[#ffe9c0]"
        >
          ◆ リーダーボード ◆
        </h1>
      </div>

      {entries.length === 0 ? (
        <p className="text-center text-[#e0a83c]">
          まだ開店したブリューがありません。ワークベンチの「Pub」タブから開店してください。
        </p>
      ) : (
        <div className="ps-panel px-[18px] pt-1.5 pb-[18px]">
          <div
            className="grid gap-2 border-b-2 border-[#3a2a12] px-2 py-3 text-[12px] tracking-wide"
            style={{
              gridTemplateColumns: "76px 1fr 70px 110px 90px 60px 150px",
              color: "rgba(255,220,160,.5)",
            }}
          >
            <span>順位</span>
            <span>ブリュー</span>
            <span>バッチ</span>
            <span>Pubスコア</span>
            <span>自己評価</span>
            <span>客数</span>
            <span>実施日時</span>
          </div>
          {entries.map((e, i) => {
            const rank = rankLabel(i);
            return (
              <Link
                key={e.brewId}
                href={`/brews/${e.brewId}?tab=pub`}
                className="grid items-baseline gap-2 border-b-2 border-[#221507] px-2 py-3.5 hover:bg-[#241505]"
                style={{
                  gridTemplateColumns: "76px 1fr 70px 110px 90px 60px 150px",
                  color: "#ffe9c0",
                }}
              >
                <span style={{ color: rank.color, fontSize: 17, letterSpacing: 1 }}>
                  {rank.text}
                </span>
                <span className="truncate text-[16px]">▶ {e.name}</span>
                <span className="text-[14px]" style={{ color: "rgba(255,233,192,.75)" }}>
                  {e.batch}
                </span>
                <span className="text-[18px] text-[#f5a623]">{e.pubOverall.toFixed(1)}</span>
                <span className="text-[14px]" style={{ color: "rgba(255,233,192,.75)" }}>
                  {e.selfOverall !== null ? e.selfOverall.toFixed(1) : "—"}
                </span>
                <span className="text-[14px]" style={{ color: "rgba(255,233,192,.75)" }}>
                  {e.personaCount}
                </span>
                <span className="text-[13px]" style={{ color: "rgba(255,220,160,.5)" }}>
                  {new Date(e.ranAt).toLocaleString("ja-JP")}
                </span>
              </Link>
            );
          })}
          {unpubbed > 0 && (
            <p className="mt-3.5 mb-0 text-[13px]" style={{ color: "rgba(255,220,160,.45)" }}>
              未開店のブリュー: {unpubbed}件
            </p>
          )}
        </div>
      )}
      {entries.length === 0 && unpubbed > 0 && (
        <p className="mt-4 text-[13px]" style={{ color: "rgba(255,220,160,.45)" }}>
          未開店のブリュー: {unpubbed}件
        </p>
      )}
    </main>
  );
}
