import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, withPhaseLock } from "@/lib/api";
import { normalizeStaleMaturation } from "@/lib/mature";
import { normalizeStalePub, runPub } from "@/lib/pub";
import { MAX_PUB_GUESTS } from "@/lib/pub/constants";
import { pubbingBrews, pubCancelTokens } from "@/lib/pub/pub-state";
import { resolvePubDeps } from "@/lib/pub/resolve";
import { readPersonas, writeBrew } from "@/lib/store";
import type { SavedPersona } from "@/lib/store/types";
import { normalizeStaleBatch } from "@/lib/tap";
import { latestSucceededBatch } from "@/lib/tap/batches";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withPhaseLock(id, pubbingBrews, pubCancelTokens, async (token) => {
    try {
      let brew = await findBrew(id);
      if (!brew) return brewNotFound();
      brew = normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew)));

      const body = (await req.json().catch(() => ({}))) as {
        autoCount?: unknown;
        savedPersonaIds?: unknown;
      };
      const autoCount = body.autoCount === undefined ? 3 : body.autoCount;
      const savedPersonaIds = body.savedPersonaIds === undefined ? [] : body.savedPersonaIds;
      if (
        typeof autoCount !== "number" ||
        !Number.isInteger(autoCount) ||
        autoCount < 0 ||
        autoCount > MAX_PUB_GUESTS
      ) {
        return NextResponse.json(
          { error: `autoCount は0〜${MAX_PUB_GUESTS}の整数で指定してください。` },
          { status: 400 },
        );
      }
      if (!Array.isArray(savedPersonaIds) || savedPersonaIds.some((x) => typeof x !== "string")) {
        return NextResponse.json(
          { error: "savedPersonaIds は文字列の配列で指定してください。" },
          { status: 400 },
        );
      }
      if (new Set(savedPersonaIds).size !== savedPersonaIds.length) {
        return NextResponse.json({ error: "常連客が重複しています。" }, { status: 400 });
      }
      const all = await readPersonas();
      const savedPersonas: SavedPersona[] = [];
      for (const pid of savedPersonaIds) {
        const found = all.find((p) => p.id === pid);
        if (!found) {
          return NextResponse.json(
            { error: "存在しない常連客が指定されています。" },
            { status: 400 },
          );
        }
        savedPersonas.push(found);
      }
      const total = autoCount + savedPersonas.length;
      if (total < 1 || total > MAX_PUB_GUESTS) {
        return NextResponse.json(
          { error: `客の人数は合計1〜${MAX_PUB_GUESTS}にしてください。` },
          { status: 400 },
        );
      }
      if (!latestSucceededBatch(brew)) {
        return NextResponse.json({ error: "成功したバッチがありません。" }, { status: 400 });
      }
      if (autoCount > 0 && !brew.sheet) {
        return NextResponse.json(
          { error: "ブリューシートがありません。ペルソナの自動生成には仕込みが必要です。" },
          { status: 400 },
        );
      }

      const deps = await resolvePubDeps();
      const done = await runPub(
        brew,
        {
          ...deps,
          cancel: token,
          onProgress: async (b) => {
            await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
          },
        },
        { autoCount, savedPersonas },
      );
      return NextResponse.json(await writeBrew(done));
    } catch (err) {
      return errorResponse(err);
    }
  });
}
