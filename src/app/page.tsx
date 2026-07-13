import Link from "next/link";
import { listBrews } from "@/lib/store";
import { TankCard } from "@/components/tank-card";

export const dynamic = "force-dynamic";

export default async function Home() {
  const brews = await listBrews();
  return (
    <main className="ps-page max-w-[1100px]">
      <div
        className="mb-2 flex flex-wrap items-end justify-between gap-4"
        style={{ marginBottom: 8 }}
      >
        <div>
          <div className="text-[13px] tracking-[4px]" style={{ color: "rgba(255,220,160,.5)" }}>
            TANK SELECT
          </div>
          <h1
            className="ps-chromatic m-0 text-[26px] font-normal tracking-[3px] text-[#ffe9c0]"
            style={{ marginTop: 2 }}
          >
            ◆ 醸造タンク
          </h1>
        </div>
        <div className="flex gap-3">
          <Link href="/leaderboard" className="ps-btn-secondary">
            リーダーボード
          </Link>
          <Link href="/brews/new" className="ps-btn">
            ＋ 新しい仕込み
          </Link>
        </div>
      </div>
      <p className="mb-5 mt-0 text-[14px]" style={{ color: "rgba(255,220,160,.55)" }}>
        タンクをえらんでください ▼
      </p>

      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}
      >
        {brews.map((b, i) => (
          <TankCard key={b.id} brew={b} index={i} />
        ))}
        <Link
          href="/brews/new"
          className="flex min-h-[240px] flex-col items-center justify-center gap-2.5 border-2 border-dashed border-[#5a4118] p-3.5 text-[rgba(255,220,160,.45)] shadow-[6px_6px_0_rgba(0,0,0,.35)] hover:border-[#f5b94a] hover:text-[#f5b94a]"
        >
          <span className="text-[34px]">＋</span>
          <span className="text-[14px] tracking-[2px]">― あきタンク ―</span>
          <span className="text-[13px]">あたらしく仕込む</span>
        </Link>
      </div>
    </main>
  );
}
