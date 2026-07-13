import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Brew, SavedPersona, Settings } from "./types";

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
  effort: "",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
  cursorEffort: "",
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
    boil: { entries: [], auto: false, finished: false },
    recipeProgress: null,
    recipeGeneratedAt: null,
    batches: [],
    buildProgress: null,
    maturationProgress: null,
    pubProgress: null,
  };
  await fs.mkdir(path.join(brewDir(brew.id), "ingredients"), { recursive: true });
  return writeBrew(brew);
}

export async function readBrew(id: string): Promise<Brew> {
  const raw = await fs.readFile(path.join(brewDir(id), "brew.json"), "utf8");
  // 旧名(grill/grilling)で保存された brew.json も読めるよう、boil/boiling へ寄せる
  const legacy = JSON.parse(raw) as Omit<Brew, "stage"> & {
    grill?: Brew["boil"];
    stage: Brew["stage"] | "grilling";
  };
  const { grill, ...parsed } = legacy;
  // 旧バージョンの brew.json に無いフィールドを補完する
  return {
    ...parsed,
    stage: parsed.stage === "grilling" ? "boiling" : parsed.stage,
    boil: parsed.boil ?? grill ?? { entries: [], auto: false, finished: false },
    batches: (parsed.batches ?? []).map((b) => ({
      ...b,
      evaluation: b.evaluation ?? null,
      pub: b.pub ?? null,
    })),
    buildProgress: parsed.buildProgress ?? null,
    maturationProgress: parsed.maturationProgress ?? null,
    pubProgress: parsed.pubProgress ?? null,
  };
}

/**
 * rename を EPERM/EACCES で少しリトライする。
 * Windows ではウイルススキャン等が宛先を一瞬開いていると rename が失敗するため
 * (進捗保存のような高頻度書き込みで実際に発生する)
 */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EACCES") || attempt >= 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export async function writeBrew(brew: Brew): Promise<Brew> {
  const next = { ...brew, updatedAt: new Date().toISOString() };
  await fs.mkdir(brewDir(brew.id), { recursive: true });
  // ビルド中は数秒おきに上書きされるため、書き込み途中のクラッシュで
  // brew.json が壊れないよう一時ファイル経由で原子的に置き換える
  const tmpPath = path.join(brewDir(brew.id), `brew.json.${randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
  try {
    await renameWithRetry(tmpPath, path.join(brewDir(brew.id), "brew.json"));
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
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

export class PersonaValidationError extends Error {}

const MAX_PERSONAS = 20;

function personasPath(): string {
  return path.join(dataDir(), "personas.json");
}

/** 保存形式として妥当な常連客か(手編集・破損データの防御) */
function isValidPersona(p: unknown): p is SavedPersona {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    (o.id === undefined || typeof o.id === "string") &&
    typeof o.name === "string" &&
    typeof o.profile === "string" &&
    Array.isArray(o.goals) &&
    o.goals.every((g) => typeof g === "string")
  );
}

/** 常連客リスト。ファイルなし・破損時は空配列、形の壊れた要素は読み飛ばす(settings と同じ寛容な読み込み) */
export async function readPersonas(): Promise<SavedPersona[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(personasPath(), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPersona).map((p) => ({ ...p, id: p.id ?? "" }));
  } catch {
    return [];
  }
}

/** 常連客リストを全置換保存する。id が空の要素は採番する */
export async function writePersonas(personas: SavedPersona[]): Promise<SavedPersona[]> {
  if (personas.length > MAX_PERSONAS) {
    throw new PersonaValidationError(`常連客は最大${MAX_PERSONAS}件までです。`);
  }
  const normalized = personas.map((p) => {
    if (!isValidPersona(p)) {
      throw new PersonaValidationError("常連客の形式が不正です。");
    }
    const name = p.name.trim();
    const profile = p.profile.trim();
    const goals = p.goals.map((g) => g.trim()).filter((g) => g !== "");
    if (name === "" || profile === "") {
      throw new PersonaValidationError("常連客の名前とプロフィールは必須です。");
    }
    if (goals.length < 1 || goals.length > 3) {
      throw new PersonaValidationError("常連客の目的は1〜3件で指定してください。");
    }
    return { id: p.id?.trim() ? p.id : randomUUID(), name, profile, goals };
  });
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(personasPath(), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}
