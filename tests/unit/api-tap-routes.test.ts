import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECIPE_FILES } from "@/lib/recipe";
import { createBrew, recipeDir, tapDir, writeBrew, writeSettings } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { POST as buildPost } from "@/app/api/brews/[id]/tap/build/route";
import { POST as cancelPost } from "@/app/api/brews/[id]/tap/cancel/route";
import { GET as logGet } from "@/app/api/brews/[id]/tap/log/route";
import { GET as serverGet, POST as serverPost } from "@/app/api/brews/[id]/tap/server/route";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-api-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  delete process.env.IDEA_BREWING_FAKE_BUILD;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

async function createRecipeReadyBrew(): Promise<Brew> {
  const brew = await createBrew("タップAPI");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  for (const def of RECIPE_FILES) {
    const content = def.file === "05-implementation-plan.md" ? "## タスクA\n本文A" : `# ${def.title}`;
    await fs.writeFile(path.join(recipeDir(brew.id), def.file), content, "utf8");
  }
  return writeBrew({ ...brew, stage: "done", recipeGeneratedAt: new Date().toISOString() });
}

describe("tap build route", () => {
  it("レシピ未生成なら400を返す", async () => {
    const brew = await createBrew("未生成");

    const res = await buildPost(new Request("http://localhost"), ctx(brew.id));

    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "レシピがまだ生成されていません。" });
  });

  it("Cursor未設定なら日本語メッセージの400を返す", async () => {
    const brew = await createRecipeReadyBrew();

    const res = await buildPost(new Request("http://localhost"), ctx(brew.id));

    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({
      error: "Cursor APIキーが未設定です。設定画面の「ビルドエンジン(Cursor)」で設定してください。",
    });
  });

  it("フェイクビルド成功時に最終Brewを保存して返す", async () => {
    const brew = await createRecipeReadyBrew();
    await writeSettings({
      provider: "fake",
      apiKey: "",
      baseUrl: "",
      model: "fake",
      cursorApiKey: "",
      cursorModel: "composer-2.5",
    });

    const res = await buildPost(new Request("http://localhost"), ctx(brew.id));
    const body = (await json(res)) as Brew;

    expect(res.status).toBe(200);
    expect(body.stage).toBe("built");
    expect(body.batches[0].status).toBe("succeeded");
    expect(body.buildProgress).toBeNull();
    await expect(fs.access(path.join(tapDir(brew.id, 1), "build.log"))).resolves.toBeUndefined();
  });
});

describe("tap cancel route", () => {
  it("トークンが無くstale buildingなら正規化して保存する", async () => {
    const brew = await createRecipeReadyBrew();
    await writeBrew({
      ...brew,
      batches: [
        {
          number: 1,
          status: "building",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: null,
          error: null,
        },
      ],
      buildProgress: { phase: "generating", detail: "残留" },
    });

    const res = await cancelPost(new Request("http://localhost"), ctx(brew.id));
    const body = (await json(res)) as Brew;

    expect(res.status).toBe(200);
    expect(body.batches[0].status).toBe("failed");
    expect(body.buildProgress).toBeNull();
  });

  it("トークンもstale buildingも無ければ409を返す", async () => {
    const brew = await createBrew("通常");

    const res = await cancelPost(new Request("http://localhost"), ctx(brew.id));

    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "ビルドは実行されていません。" });
  });
});

describe("tap server route", () => {
  it("GETはブリューを読まずサーバー状態を返す", async () => {
    const res = await serverGet(new Request("http://localhost"), ctx("missing"));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ running: false, port: null });
  });

  it("POSTはブリューが無ければ404を返す", async () => {
    const req = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ action: "stop" }),
    });

    const res = await serverPost(req, ctx("missing"));

    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "ブリューが見つかりません。" });
  });
});

describe("tap log route", () => {
  it("ログが無ければ空配列を返す", async () => {
    const res = await logGet(new Request("http://localhost"), ctx("missing"));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ lines: [] });
  });

  it("build.logの末尾200行を返す", async () => {
    const brew = await createBrew("ログ");
    const dir = tapDir(brew.id, 1);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "build.log"),
      Array.from({ length: 205 }, (_, i) => `line-${i + 1}`).join("\n"),
      "utf8",
    );

    const res = await logGet(new Request("http://localhost"), ctx(brew.id));
    const body = (await json(res)) as { lines: string[] };

    expect(body.lines).toHaveLength(200);
    expect(body.lines[0]).toBe("line-6");
    expect(body.lines[199]).toBe("line-205");
  });
});
