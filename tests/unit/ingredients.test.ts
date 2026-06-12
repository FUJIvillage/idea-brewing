import { beforeEach, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createBrew } from "@/lib/store";
import { extractReadableText } from "@/lib/ingredients/extract-url";
import { extractPdfText } from "@/lib/ingredients/extract-pdf";
import {
  addFileIngredient,
  addTextIngredient,
  addUrlIngredient,
} from "@/lib/ingredients";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-ing-"));
});

test("HTMLから本文とタイトルを抽出し、script等は除外する", () => {
  const html = `<html><head><title>参考LP</title><style>.x{}</style></head>
    <body><script>alert(1)</script><h1>最高のサービス</h1><p>説明文です。</p></body></html>`;
  const { title, text } = extractReadableText(html);
  expect(title).toBe("参考LP");
  expect(text).toContain("最高のサービス");
  expect(text).toContain("説明文です。");
  expect(text).not.toContain("alert");
});

test("テキスト原料を追加できる", async () => {
  const brew = await createBrew("t");
  const next = addTextIngredient(brew, "最高のtodoアプリ");
  expect(next.ingredients).toHaveLength(1);
  expect(next.ingredients[0]).toMatchObject({
    kind: "text",
    text: "最高のtodoアプリ",
    status: "ok",
  });
});

test("URL原料: 取得成功", async () => {
  const brew = await createBrew("t");
  const fakeFetch = (async () =>
    new Response("<html><head><title>LP</title></head><body>内容</body></html>", {
      status: 200,
    })) as typeof fetch;
  const next = await addUrlIngredient(brew, "https://example.com", fakeFetch);
  expect(next.ingredients[0]).toMatchObject({ kind: "url", title: "LP", status: "ok" });
  expect(next.ingredients[0].text).toContain("内容");
});

test("URL原料: 取得失敗でも brew は壊れず failed として記録される", async () => {
  const brew = await createBrew("t");
  const fakeFetch = (async () => new Response("ng", { status: 404 })) as typeof fetch;
  const next = await addUrlIngredient(brew, "https://example.com/x", fakeFetch);
  expect(next.ingredients[0].status).toBe("failed");
  expect(next.ingredients[0].error).toContain("404");
});

test("画像ファイル原料はファイル保存され kind=image になる", async () => {
  const brew = await createBrew("t");
  const next = await addFileIngredient(brew, "ref.png", "image/png", Buffer.from([1, 2, 3]));
  expect(next.ingredients[0]).toMatchObject({ kind: "image", status: "ok" });
  expect(next.ingredients[0].filePath).toContain("ref.png");
});

test("PDFからテキストを抽出できる", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello idea brewing", { x: 50, y: 700, size: 12, font });
  const buffer = Buffer.from(await doc.save());
  const text = await extractPdfText(buffer);
  expect(text).toContain("Hello idea brewing");
});

test("PDFドキュメント原料は text が抽出される", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Plan doc", { x: 50, y: 700, size: 12, font });
  const buffer = Buffer.from(await doc.save());
  const brew = await createBrew("t");
  const next = await addFileIngredient(brew, "plan.pdf", "application/pdf", buffer);
  expect(next.ingredients[0]).toMatchObject({ kind: "document", status: "ok" });
  expect(next.ingredients[0].text).toContain("Plan doc");
});
