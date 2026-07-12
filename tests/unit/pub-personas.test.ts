import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeClient } from "@/lib/llm/fake-client";
import { buildPersonaPrompt, generatePersonas, savedToPersona } from "@/lib/pub/personas";
import { createBrew } from "@/lib/store";
import type { Brew, BrewSheet } from "@/lib/store/types";
import { SHEET_KEYS } from "@/lib/store/types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function sheet(): BrewSheet {
  return Object.fromEntries(
    SHEET_KEYS.map((key) => [
      key,
      { content: `${key}の内容`, sufficiency: "full", userEdited: false },
    ]),
  ) as BrewSheet;
}

async function sheetedBrew(): Promise<Brew> {
  const brew = await createBrew("ペルソナ");
  return { ...brew, sheet: sheet() };
}

describe("buildPersonaPrompt", () => {
  it("人数とシートの主要3項目を含む", async () => {
    const brew = await sheetedBrew();
    const prompt = buildPersonaPrompt(brew, 3);
    expect(prompt).toContain("人数: 3");
    expect(prompt).toContain("conceptの内容");
    expect(prompt).toContain("targetUsersの内容");
    expect(prompt).toContain("featuresの内容");
  });

  it("シートがなければエラー", async () => {
    const brew = await createBrew("シートなし");
    expect(() => buildPersonaPrompt(brew, 1)).toThrow(/ブリューシート/);
  });
});

describe("generatePersonas", () => {
  it("指定人数のペルソナを origin: auto で返す", async () => {
    const brew = await sheetedBrew();
    const personas = await generatePersonas(createFakeClient(), brew, 2);
    expect(personas).toHaveLength(2);
    expect(personas.every((p) => p.origin === "auto")).toBe(true);
    expect(personas[0].goals.length).toBeGreaterThanOrEqual(1);
  });
});

describe("savedToPersona", () => {
  it("常連客を origin: saved の PubPersona に変換する", () => {
    const p = savedToPersona({ id: "x", name: "常連A", profile: "毎日来る", goals: ["見る"] });
    expect(p).toEqual({ name: "常連A", profile: "毎日来る", goals: ["見る"], origin: "saved" });
  });
});
