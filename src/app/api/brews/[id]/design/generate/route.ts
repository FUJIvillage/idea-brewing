import { NextResponse } from "next/server";
import { brewNotFound, errorResponse, findBrew, withPhaseLock } from "@/lib/api";
import { generateDesignMock, hasDesignRecipe, normalizeStaleDesignMock } from "@/lib/design";
import { designCancelTokens, designingBrews } from "@/lib/design/design-state";
import { resolvePencilKey } from "@/lib/design/resolve";
import { readSettings, writeBrew } from "@/lib/store";
import { isFakeMode } from "@/lib/tap/resolve";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { instruction?: unknown };
  const instruction = typeof body.instruction === "string" ? body.instruction : undefined;

  return withPhaseLock(id, designingBrews, designCancelTokens, async (token) => {
    try {
      let brew = await findBrew(id);
      if (!brew) return brewNotFound();
      brew = normalizeStaleDesignMock(brew);

      if (!(await hasDesignRecipe(id))) {
        return NextResponse.json(
          { error: "レシピが未生成です。先に発酵(レシピ生成)を完了してください。" },
          { status: 400 },
        );
      }
      const settings = await readSettings();
      // キー未設定は生成を始める前に 400 で弾く(DesignNotConfiguredError → errorResponse)
      if (!isFakeMode(settings)) resolvePencilKey(settings);

      brew = await writeBrew({
        ...brew,
        designMock: {
          status: "generating",
          generatedAt: null,
          error: null,
          model: "",
          costUsd: null,
          durationMs: null,
        },
      });
      const record = await generateDesignMock(brew, settings, { instruction, token });
      return NextResponse.json(await writeBrew({ ...brew, designMock: record }));
    } catch (err) {
      return errorResponse(err);
    }
  });
}
