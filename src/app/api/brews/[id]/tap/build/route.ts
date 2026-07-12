import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation } from "@/lib/mature";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { normalizeStalePub } from "@/lib/pub";
import { readBrew, readSettings, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { normalizeStaleBatch, runBuild } from "@/lib/tap";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { buildingBrews, cancelTokens } from "@/lib/tap/build-state";
import { resolveEngine, TapNotConfiguredError, type ResolvedEngine } from "@/lib/tap/resolve";
import { realRunner } from "@/lib/tap/runner";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }

  buildingBrews.add(id);
  const token = { cancelled: false };
  cancelTokens.set(id, token);

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    if (!brew.recipeGeneratedAt) {
      return NextResponse.json({ error: "レシピがまだ生成されていません。" }, { status: 400 });
    }

    if (latestSucceededBatch(brew)) {
      return NextResponse.json(
        { error: "成功済みのバッチがあります。次のバッチは熟成タブから作成してください。" },
        { status: 400 },
      );
    }

    const settings = await readSettings();
    let resolved: ResolvedEngine;
    try {
      resolved = await resolveEngine(settings);
    } catch (err) {
      if (err instanceof TapNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    // クラッシュ残留の進捗をまとめて掃除してから開始する(進捗保存で再永続化されるのを防ぐ)
    const done = await runBuild(normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew))), {
      engine: resolved.engine,
      template: resolved.template,
      runner: realRunner,
      batch: 1,
      mode: { kind: "initial" },
      cancel: token,
      onProgress: async (b) => {
        await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
      },
    });

    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    buildingBrews.delete(id);
    cancelTokens.delete(id);
  }
}
