import { beforeEach, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBrew } from "@/lib/store";
import { SHEET_KEYS } from "@/lib/store/types";
import { createFakeClient } from "@/lib/llm/fake-client";
import { addTextIngredient } from "@/lib/ingredients";
import { editSheetField, runMash } from "@/lib/brew-sheet";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-sheet-"));
});

test("マッシュでブリューシート7項目が生成され stage が boiling になる", async () => {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "最高のtodoアプリ");
  const next = await runMash(brew, fake);
  expect(next.sheet).not.toBeNull();
  for (const key of SHEET_KEYS) {
    expect(next.sheet![key].content).toBeDefined();
    expect(["full", "thin", "empty"]).toContain(next.sheet![key].sufficiency);
  }
  expect(next.stage).toBe("boiling");
  expect(fake.calls[0].tag).toBe("mash");
  expect(fake.calls[0].prompt).toContain("最高のtodoアプリ");
});

test("ユーザー確定済み項目は再マッシュで上書きされない", async () => {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "メモ");
  brew = await runMash(brew, fake);
  brew = editSheetField(brew, "concept", "ユーザーが確定したコンセプト");
  const again = await runMash(brew, fake);
  expect(again.sheet!.concept.content).toBe("ユーザーが確定したコンセプト");
  expect(again.sheet!.concept.userEdited).toBe(true);
  expect(again.sheet!.targetUsers.userEdited).toBe(false);
});

test("煮沸完了後の再マッシュで boil.finished がリセットされ stage が boiling になる", async () => {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "メモ");
  brew = await runMash(brew, fake);
  brew = { ...brew, boil: { ...brew.boil, finished: true } };
  const again = await runMash(brew, fake);
  expect(again.boil.finished).toBe(false);
  expect(again.stage).toBe("boiling");
});

test("シート手動編集は userEdited を立て、充足度を再判定する", async () => {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "メモ");
  brew = await runMash(brew, fake);
  const edited = editSheetField(brew, "lookAndTone", "琥珀色で温かみのあるデザイン");
  expect(edited.sheet!.lookAndTone).toMatchObject({
    content: "琥珀色で温かみのあるデザイン",
    sufficiency: "full",
    userEdited: true,
  });
  const cleared = editSheetField(edited, "lookAndTone", "");
  expect(cleared.sheet!.lookAndTone.sufficiency).toBe("empty");
});
