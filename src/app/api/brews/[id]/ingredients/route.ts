import { NextResponse } from "next/server";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { writeBrew } from "@/lib/store";
import { addFileIngredient, addTextIngredient, addUrlIngredient } from "@/lib/ingredients";
import { brewNotFound, errorResponse, findBrew } from "@/lib/api";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // レシピ生成中などの並行編集はBrew上書きで失われるため拒否する
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  let brew = await findBrew(id);
  if (!brew) return brewNotFound();
  try {
    if (brew.recipeGeneratedAt) {
      return NextResponse.json(
        { error: "レシピ生成後の原料追加はできません。ブリューシートを編集して再発酵してください。" },
        { status: 409 },
      );
    }
    const form = await req.formData();
    const text = form.get("text");
    if (typeof text === "string" && text.trim()) {
      brew = addTextIngredient(brew, text.trim());
    }
    const urls = form.get("urls");
    if (typeof urls === "string") {
      for (const url of urls.split("\n").map((u) => u.trim()).filter(Boolean)) {
        brew = await addUrlIngredient(brew, url);
      }
    }
    for (const file of form.getAll("files")) {
      if (file instanceof File) {
        const data = Buffer.from(await file.arrayBuffer());
        brew = await addFileIngredient(
          brew,
          file.name,
          file.type || "application/octet-stream",
          data,
        );
      }
    }
    const saved = await writeBrew(brew);
    return NextResponse.json(saved);
  } catch (err) {
    return errorResponse(err);
  }
}
