import Link from "next/link";
import { listBrews } from "@/lib/store";
import { TankCard } from "@/components/tank-card";

export const dynamic = "force-dynamic";

export default async function Home() {
  const brews = await listBrews();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-100">醸造タンク</h1>
        <div className="flex items-center gap-4">
          <Link href="/leaderboard" className="text-amber-300 hover:text-amber-200">
            リーダーボード
          </Link>
          <Link
            href="/brews/new"
            className="rounded-lg bg-amber-600 px-4 py-2 font-bold text-stone-950 hover:bg-amber-500"
          >
            新しい仕込み
          </Link>
        </div>
      </div>
      {brews.length === 0 ? (
        <p className="text-amber-400">
          タンクは空です。「新しい仕込み」からアイデアの原料を投入してください。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brews.map((b) => (
            <TankCard key={b.id} brew={b} />
          ))}
        </div>
      )}
    </main>
  );
}
