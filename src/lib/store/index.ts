import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Brew, Settings } from "./types";

export function dataDir(): string {
  return process.env.IDEA_BREWING_DATA_DIR ?? path.join(process.cwd(), "data");
}

function assertBrewId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("不正なブリューIDです。");
  }
}

export function brewDir(id: string): string {
  assertBrewId(id);
  return path.join(dataDir(), "brews", id);
}

export function recipeDir(id: string): string {
  return path.join(brewDir(id), "recipe");
}

export function tapDir(id: string, batch: number): string {
  return path.join(brewDir(id), "taps", `batch-${batch}`);
}

const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: "",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
};

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(path.join(dataDir(), "settings.json"), "utf8");
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(
    path.join(dataDir(), "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf8",
  );
}

export async function createBrew(name: string): Promise<Brew> {
  const now = new Date().toISOString();
  const brew: Brew = {
    schemaVersion: 1,
    id: randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    stage: "ingredients",
    ingredients: [],
    sheet: null,
    grill: { entries: [], auto: false, finished: false },
    recipeProgress: null,
    recipeGeneratedAt: null,
    batches: [],
    buildProgress: null,
    maturationProgress: null,
  };
  await fs.mkdir(path.join(brewDir(brew.id), "ingredients"), { recursive: true });
  return writeBrew(brew);
}

export async function readBrew(id: string): Promise<Brew> {
  const raw = await fs.readFile(path.join(brewDir(id), "brew.json"), "utf8");
  const parsed = JSON.parse(raw) as Brew;
  // 旧バージョンの brew.json に無いフィールドを補完する
  return {
    ...parsed,
    batches: (parsed.batches ?? []).map((b) => ({ ...b, evaluation: b.evaluation ?? null })),
    buildProgress: parsed.buildProgress ?? null,
    maturationProgress: parsed.maturationProgress ?? null,
  };
}

export async function writeBrew(brew: Brew): Promise<Brew> {
  const next = { ...brew, updatedAt: new Date().toISOString() };
  await fs.mkdir(brewDir(brew.id), { recursive: true });
  await fs.writeFile(
    path.join(brewDir(brew.id), "brew.json"),
    JSON.stringify(next, null, 2),
    "utf8",
  );
  return next;
}

export async function listBrews(): Promise<Brew[]> {
  const root = path.join(dataDir(), "brews");
  let ids: string[] = [];
  try {
    ids = await fs.readdir(root);
  } catch {
    return [];
  }
  const brews: Brew[] = [];
  for (const id of ids) {
    try {
      brews.push(await readBrew(id));
    } catch {
      // brew.json が無い/壊れたフォルダは一覧から除外する
    }
  }
  return brews.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readIngredientFile(brewId: string, relPath: string): Promise<Buffer> {
  return fs.readFile(path.join(brewDir(brewId), relPath));
}
