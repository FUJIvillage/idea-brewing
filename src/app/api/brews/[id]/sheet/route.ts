import { NextResponse } from "next/server";
import { readBrew, writeBrew } from "@/lib/store";
import { SHEET_KEYS, type Brew, type SheetKey } from "@/lib/store/types";
import { editSheetField } from "@/lib/brew-sheet";
import { errorResponse } from "@/lib/api";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let brew: Brew;
  try {
    brew = await readBrew(id);
  } catch {
    return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
  }
  try {
    const { key, content } = (await req.json()) as { key: SheetKey; content: string };
    if (!SHEET_KEYS.includes(key)) {
      return NextResponse.json({ error: `不正な項目です: ${key}` }, { status: 400 });
    }
    const next = editSheetField(brew, key, content);
    const saved = await writeBrew(next);
    return NextResponse.json(saved);
  } catch (err) {
    return errorResponse(err);
  }
}
