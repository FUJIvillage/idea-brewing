import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PersonaValidationError,
  brewDir,
  createBrew,
  dataDir,
  readBrew,
  readPersonas,
  writePersonas,
} from "@/lib/store";
import type { SavedPersona } from "@/lib/store/types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function persona(over?: Partial<SavedPersona>): SavedPersona {
  return { id: "", name: "常連A", profile: "毎日来る", goals: ["トップを見る"], ...over };
}

describe("常連客ストア", () => {
  it("ファイルがなければ空配列を返す", async () => {
    expect(await readPersonas()).toEqual([]);
  });

  it("壊れたJSONでも空配列を返す", async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(path.join(dataDir(), "personas.json"), "{not json", "utf8");
    expect(await readPersonas()).toEqual([]);
  });

  it("writePersonas は id を採番して保存し、読み戻せる", async () => {
    const saved = await writePersonas([persona()]);
    expect(saved[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readPersonas()).toEqual(saved);
  });

  it("既存の id は維持される", async () => {
    const first = await writePersonas([persona()]);
    const second = await writePersonas([{ ...first[0], profile: "更新" }]);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].profile).toBe("更新");
  });

  it("名前・プロフィール欠落と goals 件数違反は PersonaValidationError", async () => {
    await expect(writePersonas([persona({ name: " " })])).rejects.toThrow(PersonaValidationError);
    await expect(writePersonas([persona({ profile: "" })])).rejects.toThrow(
      PersonaValidationError,
    );
    await expect(writePersonas([persona({ goals: [] })])).rejects.toThrow(PersonaValidationError);
    await expect(writePersonas([persona({ goals: ["a", "b", "c", "d"] })])).rejects.toThrow(
      PersonaValidationError,
    );
  });

  it("21件以上は PersonaValidationError", async () => {
    const many = Array.from({ length: 21 }, (_, i) => persona({ name: `常連${i}` }));
    await expect(writePersonas(many)).rejects.toThrow(PersonaValidationError);
  });
});

describe("Brew の pub フィールド", () => {
  it("createBrew は pubProgress: null で初期化する", async () => {
    const brew = await createBrew("パブ");
    expect(brew.pubProgress).toBeNull();
  });

  it("readBrew は旧 brew.json に pub / pubProgress をバックフィルする", async () => {
    const brew = await createBrew("旧データ");
    // 第3版以前の形(pub / pubProgress なし)を直接書き込む
    const legacy = {
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: brew.createdAt,
          finishedAt: brew.createdAt,
          error: null,
          evaluation: null,
        },
      ],
    } as Record<string, unknown>;
    delete legacy.pubProgress;
    await fs.writeFile(
      path.join(brewDir(brew.id), "brew.json"),
      JSON.stringify(legacy, null, 2),
      "utf8",
    );
    const read = await readBrew(brew.id);
    expect(read.pubProgress).toBeNull();
    expect(read.batches[0].pub).toBeNull();
  });
});
