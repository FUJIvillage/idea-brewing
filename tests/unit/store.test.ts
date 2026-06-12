import { beforeEach, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBrew,
  listBrews,
  readBrew,
  readSettings,
  writeBrew,
  writeSettings,
} from "@/lib/store";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-store-"));
});

test("設定が無いときは既定値を返す", async () => {
  const s = await readSettings();
  expect(s.provider).toBe("openai");
  expect(s.model).toBe("");
});

test("設定の保存と読み出し", async () => {
  await writeSettings({
    provider: "ollama",
    apiKey: "",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3",
  });
  const s = await readSettings();
  expect(s.provider).toBe("ollama");
  expect(s.model).toBe("llama3");
});

test("ブリューの作成・読み出し・一覧", async () => {
  const brew = await createBrew("最高のtodoアプリ");
  const loaded = await readBrew(brew.id);
  expect(loaded.name).toBe("最高のtodoアプリ");
  expect(loaded.stage).toBe("ingredients");
  expect(loaded.grill).toEqual({ entries: [], auto: false, finished: false });
  const all = await listBrews();
  expect(all).toHaveLength(1);
});

test("ブリューの更新で updatedAt が進む", async () => {
  const brew = await createBrew("a");
  const before = brew.updatedAt;
  await new Promise((r) => setTimeout(r, 10));
  await writeBrew({ ...brew, stage: "grilling" });
  const loaded = await readBrew(brew.id);
  expect(loaded.stage).toBe("grilling");
  expect(loaded.updatedAt >= before).toBe(true);
});

test("brews フォルダが無ければ空一覧", async () => {
  expect(await listBrews()).toEqual([]);
});
