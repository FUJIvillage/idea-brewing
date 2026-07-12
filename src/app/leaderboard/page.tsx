import Link from "next/link";
import { buildLeaderboard } from "@/lib/pub/leaderboard";
import { listBrews } from "@/lib/store";

export const dynamic = "force-dynamic";

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function Leaderboard() {
  const brews = await listBrews();
  const entries = buildLeaderboard(brews);
  const unpubbed = brews.length - entries.length;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-100">リーダーボード</h1>
        <Link href="/" className="text-amber-300 hover:text-amber-200">
          ← 醸造タンクへ戻る
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="text-amber-400">
          まだ開店したブリューがありません。ワークベンチの「Pub」タブから開店してください。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-amber-900/60">
          <table className="w-full text-left text-amber-100">
            <thead className="bg-black/40 text-sm text-amber-300">
              <tr>
                <th className="px-4 py-2">順位</th>
                <th className="px-4 py-2">ブリュー</th>
                <th className="px-4 py-2">バッチ</th>
                <th className="px-4 py-2">Pubスコア</th>
                <th className="px-4 py-2">自己評価</th>
                <th className="px-4 py-2">客数</th>
                <th className="px-4 py-2">実施日時</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.brewId} className="border-t border-amber-900/40 hover:bg-amber-900/20">
                  <td className="px-4 py-2">
                    {MEDALS[i] ?? ""} {i + 1}
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/brews/${e.brewId}`} className="font-bold hover:text-amber-300">
                      {e.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{e.batch}</td>
                  <td className="px-4 py-2 font-bold text-amber-200">{e.pubOverall.toFixed(1)}</td>
                  <td className="px-4 py-2">
                    {e.selfOverall !== null ? e.selfOverall.toFixed(1) : "—"}
                  </td>
                  <td className="px-4 py-2">{e.personaCount}</td>
                  <td className="px-4 py-2 text-sm text-amber-200/70">
                    {new Date(e.ranAt).toLocaleString("ja-JP")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unpubbed > 0 && (
        <p className="mt-4 text-sm text-amber-200/60">未開店のブリュー: {unpubbed}件</p>
      )}
    </main>
  );
}
