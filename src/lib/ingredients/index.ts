import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { brewDir } from "@/lib/store";
import type { Brew, Ingredient } from "@/lib/store/types";
import { fetchUrlText } from "./extract-url";
import { extractPdfText } from "./extract-pdf";

function push(brew: Brew, ingredient: Ingredient): Brew {
  return { ...brew, ingredients: [...brew.ingredients, ingredient] };
}

export function addTextIngredient(brew: Brew, text: string): Brew {
  return push(brew, {
    id: randomUUID(),
    kind: "text",
    title: "テキストメモ",
    text,
    status: "ok",
    addedAt: new Date().toISOString(),
  });
}

export async function addUrlIngredient(
  brew: Brew,
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<Brew> {
  const id = randomUUID();
  const addedAt = new Date().toISOString();
  try {
    const { title, text } = await fetchUrlText(url, fetchFn);
    return push(brew, {
      id,
      kind: "url",
      title: title || url,
      text: `(URL: ${url})\n${text}`,
      status: "ok",
      addedAt,
    });
  } catch (err) {
    return push(brew, {
      id,
      kind: "url",
      title: url,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      addedAt,
    });
  }
}

export async function addFileIngredient(
  brew: Brew,
  fileName: string,
  mimeType: string,
  data: Buffer,
): Promise<Brew> {
  const id = randomUUID();
  const addedAt = new Date().toISOString();
  const kind = mimeType.startsWith("image/") ? ("image" as const) : ("document" as const);
  // パストラバーサル対策: ディレクトリ成分を除去したファイル名のみ保存パスに使う
  const safeName = path.basename(fileName) || "file";
  const relPath = path.join("ingredients", `${id}-${safeName}`);
  try {
    await fs.mkdir(path.join(brewDir(brew.id), "ingredients"), { recursive: true });
    await fs.writeFile(path.join(brewDir(brew.id), relPath), data);
  } catch (err) {
    return push(brew, {
      id,
      kind,
      title: fileName,
      mimeType,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      addedAt,
    });
  }
  const base = { id, title: fileName, filePath: relPath, mimeType, addedAt };

  if (kind === "image") {
    return push(brew, { ...base, kind: "image", status: "ok" });
  }
  try {
    const text =
      mimeType === "application/pdf" ? await extractPdfText(data) : data.toString("utf8");
    return push(brew, { ...base, kind: "document", text, status: "ok" });
  } catch (err) {
    return push(brew, {
      ...base,
      kind: "document",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
