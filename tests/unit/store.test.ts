import { beforeEach, expect, test } from "vitest";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  brewDir,
  createBrew,
  dataDir,
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

test("設定の既定値に Cursor 用フィールドが入る", async () => {
  const s = await readSettings();
  expect(s.cursorApiKey).toBe("");
  expect(s.cursorModel).toBe("composer-2.5");
});

test("設定の保存と読み出し", async () => {
  await writeSettings({
    provider: "ollama",
    apiKey: "",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3",
    cursorApiKey: "",
    cursorModel: "composer-2.5",
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
  expect(loaded.updatedAt > before).toBe(true);
});

test("brews フォルダが無ければ空一覧", async () => {
  expect(await listBrews()).toEqual([]);
});

test("旧スキーマの brew.json に batches と buildProgress が補完される", async () => {
  const brew = await createBrew("旧データ");
  const file = path.join(brewDir(brew.id), "brew.json");
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  delete raw.batches;
  delete raw.buildProgress;
  await fs.writeFile(file, JSON.stringify(raw), "utf8");
  const loaded = await readBrew(brew.id);
  expect(loaded.batches).toEqual([]);
  expect(loaded.buildProgress).toBeNull();
});

test("旧形式 settings.json でも Cursor フィールドが補完される", async () => {
  const old = {
    provider: "ollama",
    apiKey: "",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3",
  };
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(path.join(dataDir(), "settings.json"), JSON.stringify(old), "utf8");
  const s = await readSettings();
  expect(s.provider).toBe("ollama");
  expect(s.cursorApiKey).toBe("");
  expect(s.cursorModel).toBe("composer-2.5");
});
