import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pubbingBrews } from "@/lib/pub/pub-state";
import { RECIPE_FILES } from "@/lib/recipe";
import { generatingRecipeBrews } from "@/lib/recipe/recipe-state";
import { createBrew, recipeDir, tapDir, writeBrew, writeSettings } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { POST as buildPost } from "@/app/api/brews/[id]/tap/build/route";
import { POST as cancelPost } from "@/app/api/brews/[id]/tap/cancel/route";
import { GET as logGet } from "@/app/api/brews/[id]/tap/log/route";
import { GET as serverGet, POST as serverPost } from "@/app/api/brews/[id]/tap/server/route";

let tmp: string;
let previousCursorApiKey: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-api-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
  previousCursorApiKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  delete process.env.IDEA_BREWING_FAKE_BUILD;
  if (previousCursorApiKey === undefined) {
    delete process.env.CURSOR_API_KEY;
  } else {
    process.env.CURSOR_API_KEY = previousCursorApiKey;
  }
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

  it("レシピ生成中なら409を返す(生成ロックも相互排他に含まれる)", async () => {
    const brew = await createRecipeReadyBrew();
    generatingRecipeBrews.add(brew.id);
    try {
      const res = await buildPost(new Request("http://localhost"), ctx(brew.id));

      expect(res.status).toBe(409);
      expect(await json(res)).toEqual({ error: "実行中の工程があります。" });
    } finally {
      generatingRecipeBrews.delete(brew.id);
    }
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
      cursorEffort: "",
      cursorFast: "",
      effort: "",
      boilMaxQuestions: 20,
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
          evaluation: null,
          pub: null,
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
  it("GETはブリューが無ければ404を返す", async () => {
    const res = await serverGet(new Request("http://localhost"), ctx("missing"));

    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "ブリューが見つかりません。" });
  });

  it("GETはブリューがあればサーバー状態を返す", async () => {
    const brew = await createBrew("状態");

    const res = await serverGet(new Request("http://localhost"), ctx(brew.id));

    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ running: false, port: null, batch: null });
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

  it("POSTのJSONが壊れていれば400を返す", async () => {
    const brew = await createBrew("不正JSON");
    const req = new Request("http://localhost", {
      method: "POST",
      body: "{",
    });

    const res = await serverPost(req, ctx(brew.id));

    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ error: "不正なアクションです。" });
  });

  it("POSTはPub実行中なら409を返す(テスト対象アプリを止めさせない)", async () => {
    const brew = await createBrew("Pub中");
    pubbingBrews.add(brew.id);
    try {
      const req = new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "stop" }),
      });

      const res = await serverPost(req, ctx(brew.id));

      expect(res.status).toBe(409);
      expect(await json(res)).toEqual({
        error: "実行中の工程があるため、サーバーを操作できません。",
      });
    } finally {
      pubbingBrews.delete(brew.id);
    }
  });
});

describe("tap log route", () => {
  it("ブリューが無ければ404を返す", async () => {
    const res = await logGet(new Request("http://localhost"), ctx("missing"));

    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: "ブリューが見つかりません。" });
  });

  it("ログが無ければ空配列を返す", async () => {
    const brew = await createBrew("ログなし");

    const res = await logGet(new Request("http://localhost"), ctx(brew.id));

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

  it("batchが不正なら400を返す", async () => {
    const brew = await createBrew("不正batch");

    for (const value of ["0", "abc"]) {
      const res = await logGet(new Request(`http://localhost?batch=${value}`), ctx(brew.id));

      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ error: "batch は1以上の整数で指定してください。" });
    }
  });

  it("batch指定はそのバッチのログを、省略時は最新バッチのログを返す", async () => {
    const brew = await createBrew("バッチ別ログ");
    for (const batch of [1, 2]) {
      const dir = tapDir(brew.id, batch);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "build.log"), `batch-${batch}-log`, "utf8");
    }
    await writeBrew({
      ...brew,
      batches: [1, 2].map((number) => ({
        number,
        status: "succeeded" as const,
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:01:00.000Z",
        error: null,
        evaluation: null,
        pub: null,
      })),
    });

    const batch1 = await logGet(new Request("http://localhost?batch=1"), ctx(brew.id));
    expect(await json(batch1)).toEqual({ lines: ["batch-1-log"] });

    const batch2 = await logGet(new Request("http://localhost?batch=2"), ctx(brew.id));
    expect(await json(batch2)).toEqual({ lines: ["batch-2-log"] });

    const omitted = await logGet(new Request("http://localhost"), ctx(brew.id));
    expect(await json(omitted)).toEqual({ lines: ["batch-2-log"] });
  });
});
