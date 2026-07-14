import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, withPhaseLock } from "@/lib/api";
import { normalizeStaleMaturation } from "@/lib/mature";
import { normalizeStalePub } from "@/lib/pub";
import { readSettings, writeBrew } from "@/lib/store";
import { normalizeStaleBatch, runBuild } from "@/lib/tap";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { buildingBrews, cancelTokens } from "@/lib/tap/build-state";
import { readBuildCheckpoint } from "@/lib/tap/checkpoint";
import { resolveEngine } from "@/lib/tap/resolve";
import { realRunner } from "@/lib/tap/runner";

type BuildBody = { mode?: "resume" | "fresh" };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withPhaseLock(id, buildingBrews, cancelTokens, async (token) => {
    try {
      const brew = await findBrew(id);
      if (!brew) return brewNotFound();

      if (!brew.recipeGeneratedAt) {
        return NextResponse.json({ error: "レシピがまだ生成されていません。" }, { status: 400 });
      }

      if (latestSucceededBatch(brew)) {
        return NextResponse.json(
          { error: "成功済みのバッチがあります。次のバッチは熟成タブから作成してください。" },
          { status: 400 },
        );
      }

      const body = (await req.json().catch(() => ({}))) as BuildBody;
      const existingCheckpoint = await readBuildCheckpoint(id, 1);
      let modeKind: "initial" | "resume";
      if (body.mode === "fresh") {
        modeKind = "initial";
      } else if (body.mode === "resume") {
        if (!existingCheckpoint) {
          return NextResponse.json(
            { error: "再開用の checkpoint がありません。最初からビルドしてください。" },
            { status: 400 },
          );
        }
        modeKind = "resume";
      } else {
        modeKind = existingCheckpoint ? "resume" : "initial";
      }

      const resolved = await resolveEngine(await readSettings());

      // クラッシュ残留の進捗をまとめて掃除してから開始する(進捗保存で再永続化されるのを防ぐ)
      const done = await runBuild(
        normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew))),
        {
          engine: resolved.engine,
          template: resolved.template,
          runner: realRunner,
          batch: 1,
          mode: { kind: modeKind },
          cancel: token,
          onProgress: async (b) => {
            await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
          },
        },
      );

      return NextResponse.json(await writeBrew(done));
    } catch (err) {
      return errorResponse(err);
    }
  });
}
