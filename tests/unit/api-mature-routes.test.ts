import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew, readBrew, recipeDir, tapDir, writeBrew, writeSettings } from "@/lib/store";
import type { Brew, Settings } from "@/lib/store/types";
import { matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { buildingBrews } from "@/lib/tap/build-state";

let tmp: string;
let previousCursorApiKey: string | undefined;

const FAKE_SETTINGS: Settings = {
  provider: "fake",
  apiKey: "",
  baseUrl: "",
  model: "fake",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
  cursorEffort: "",
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
  previousCursorApiKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  await writeSettings(FAKE_SETTINGS);
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  if (previousCursorApiKey === undefined) {
    delete process.env.CURSOR_API_KEY;
  } else {
    process.env.CURSOR_API_KEY = previousCursorApiKey;
  }
  maturingBrews.clear();
  matureCancelTokens.clear();
  buildingBrews.clear();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function builtBrew(): Promise<Brew> {
  const brew = await createBrew("熟成ルート");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  await fs.writeFile(
    path.join(recipeDir(brew.id), "06-evaluation-criteria.md"),
    "# 自己評価基準\n観点X",
    "utf8",
  );
  await fs.writeFile(
    path.join(recipeDir(brew.id), "05-implementation-plan.md"),
    "## タスクA\n本文\n",
    "utf8",
  );
  await fs.mkdir(path.join(tapDir(brew.id, 1), "src"), { recursive: true });
  await fs.writeFile(path.join(tapDir(brew.id, 1), "src", "App.tsx"), "v1", "utf8");
  return writeBrew({
    ...brew,
    stage: "built",
    recipeGeneratedAt: new Date().toISOString(),
    batches: [
      {
        number: 1,
        status: "succeeded",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        error: null,
        evaluation: null,
        pub: null,
      },
    ],
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /mature/evaluate", () => {
  it("成功バッチを評価してBrewを返す", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.batches[0].evaluation?.overall).toBe(3);
    expect(json.maturationProgress).toBeNull();
  });

  it("ブリュー不在は404、成功バッチなしは400、実行中は409", async () => {
    const { POST } = await import("@/app/api/brews/[id]/mature/evaluate/route");

    const missing = await POST(
      new Request("http://test/"),
      ctx("00000000-0000-4000-8000-000000000000"),
    );
    expect(missing.status).toBe(404);

    const empty = await createBrew("空");
    const noBatch = await POST(new Request("http://test/"), ctx(empty.id));
    expect(noBatch.status).toBe(400);

    const brew = await builtBrew();
    maturingBrews.add(brew.id);
    const busy = await POST(new Request("http://test/"), ctx(brew.id));
    expect(busy.status).toBe(409);
  });

  it("ルーブリック欠落は400", async () => {
    const brew = await builtBrew();
    await fs.rm(path.join(recipeDir(brew.id), "06-evaluation-criteria.md"));
    const { POST } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(400);
  });
});

describe("POST /mature/next", () => {
  it("未評価は400、評価済みならバッチ2を生成する", async () => {
    const brew = await builtBrew();
    const { POST: evaluate } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    const { POST: next } = await import("@/app/api/brews/[id]/mature/next/route");

    const before = await next(new Request("http://test/"), ctx(brew.id));
    expect(before.status).toBe(400);

    await evaluate(new Request("http://test/"), ctx(brew.id));
    const res = await next(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.batches).toHaveLength(2);
    expect(json.batches[1].status).toBe("succeeded");
  });

  it("クラッシュ残留の building バッチを補正して次バッチを生成する", async () => {
    const brew = await builtBrew();
    const { POST: evaluate } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    const { POST: next } = await import("@/app/api/brews/[id]/mature/next/route");

    await evaluate(new Request("http://test/"), ctx(brew.id));
    const evaluated = await readBrew(brew.id);
    await writeBrew({
      ...evaluated,
      batches: [
        ...evaluated.batches,
        {
          number: 2,
          status: "building",
          startedAt: new Date(Date.now() - 60_000).toISOString(),
          finishedAt: null,
          error: null,
          evaluation: null,
          pub: null,
        },
      ],
    });

    const res = await next(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.batches).toHaveLength(3);
    const stale = json.batches.find((b) => b.number === 2)!;
    expect(stale.status).toBe("failed");
    expect(stale.error).toBe("中断されました(プロセス終了)");
    const newest = json.batches.find((b) => b.number === 3)!;
    expect(newest.status).toBe("succeeded");
  });
});

describe("POST /mature/auto", () => {
  it("バリデーション外は400", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/mature/auto/route");
    const res = await POST(
      new Request("http://test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetScore: 9, maxBatches: 3 }),
      }),
      ctx(brew.id),
    );
    expect(res.status).toBe(400);
  });

  it("目標達成までループしてBrewを返す", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/mature/auto/route");
    const res = await POST(
      new Request("http://test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetScore: 4, maxBatches: 5 }),
      }),
      ctx(brew.id),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.batches).toHaveLength(2);
    expect(json.batches[1].evaluation?.overall).toBe(5);
  });

  it("ボディなしはデフォルト値(targetScore 4 / maxBatches 3)で実行する", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/mature/auto/route");
    const res = await POST(new Request("http://test/", { method: "POST" }), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.batches).toHaveLength(2);
    expect(json.batches[1].evaluation?.overall).toBe(5);
  });
});

describe("POST /mature/cancel", () => {
  it("実行中トークンがあれば中断フラグを立てて200を返す", async () => {
    const brew = await builtBrew();
    const token = { cancelled: false };
    matureCancelTokens.set(brew.id, token);
    const { POST } = await import("@/app/api/brews/[id]/mature/cancel/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(token.cancelled).toBe(true);
  });

  it("実行中でなく残留progressがあれば補正して返す", async () => {
    const brew = await builtBrew();
    await writeBrew({
      ...brew,
      maturationProgress: { phase: "evaluating", detail: "x", batch: 1 },
    });
    const { POST } = await import("@/app/api/brews/[id]/mature/cancel/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.maturationProgress).toBeNull();
  });

  it("残留progressと一緒にbuildingのまま残ったバッチもfailedに補正する", async () => {
    const brew = await builtBrew();
    // 熟成中のクラッシュを再現: maturationProgress と building バッチが両方残る
    await writeBrew({
      ...brew,
      maturationProgress: { phase: "building", detail: "x", batch: 2 },
      batches: [
        ...brew.batches,
        {
          number: 2,
          status: "building",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
          evaluation: null,
          pub: null,
        },
      ],
    });
    const { POST } = await import("@/app/api/brews/[id]/mature/cancel/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.maturationProgress).toBeNull();
    expect(json.batches[1].status).toBe("failed");
  });

  it("ビルドが本当に実行中なら残留補正せず409を返す", async () => {
    const brew = await builtBrew();
    await writeBrew({
      ...brew,
      maturationProgress: { phase: "evaluating", detail: "x", batch: 1 },
    });
    buildingBrews.add(brew.id);
    const { POST } = await import("@/app/api/brews/[id]/mature/cancel/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(409);
    const stored = await readBrew(brew.id);
    expect(stored.maturationProgress).not.toBeNull();
  });

  it("実行中でも残留もなければ409", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/mature/cancel/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(409);
  });
});

describe("GET /mature/report と /mature/screenshot", () => {
  it("評価後にレポートを返す", async () => {
    const brew = await builtBrew();
    const { POST: evaluate } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    await evaluate(new Request("http://test/"), ctx(brew.id));

    const { GET } = await import("@/app/api/brews/[id]/mature/report/route");
    const res = await GET(new Request("http://test/?batch=1"), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { markdown: string | null; screenshots: string[] };
    expect(json.markdown).toContain("自己評価レポート");
    expect(json.screenshots).toEqual([]); // フェイク構成では撮影スキップ
  });

  it("batch不正は400、未知バッチは404", async () => {
    const brew = await builtBrew();
    const { GET } = await import("@/app/api/brews/[id]/mature/report/route");
    expect((await GET(new Request("http://test/?batch=zero"), ctx(brew.id))).status).toBe(400);
    expect((await GET(new Request("http://test/?batch=9"), ctx(brew.id))).status).toBe(404);
  });

  it("batchパラメータ未指定は400", async () => {
    const brew = await builtBrew();
    const { GET } = await import("@/app/api/brews/[id]/mature/report/route");
    expect((await GET(new Request("http://test/"), ctx(brew.id))).status).toBe(400);
  });

  it("screenshot: name不正は400、ファイルなしは404、あればPNGを返す", async () => {
    const brew = await builtBrew();
    const { GET } = await import("@/app/api/brews/[id]/mature/screenshot/route");
    expect(
      (await GET(new Request("http://test/?batch=1&name=evil.png"), ctx(brew.id))).status,
    ).toBe(400);
    expect(
      (await GET(new Request("http://test/?batch=1&name=desktop.png"), ctx(brew.id))).status,
    ).toBe(404);

    const dir = path.join(tapDir(brew.id, 1), "screenshots");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "desktop.png"), Buffer.from([0x89, 0x50]));
    const ok = await GET(new Request("http://test/?batch=1&name=desktop.png"), ctx(brew.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
  });
});

describe("相互ロック", () => {
  it("熟成中はtap/buildが409、tap/serverのstart/stopも409", async () => {
    const brew = await builtBrew();
    maturingBrews.add(brew.id);

    const { POST: build } = await import("@/app/api/brews/[id]/tap/build/route");
    expect((await build(new Request("http://test/"), ctx(brew.id))).status).toBe(409);

    const { POST: server } = await import("@/app/api/brews/[id]/tap/server/route");
    const startRes = await server(
      new Request("http://test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      }),
      ctx(brew.id),
    );
    expect(startRes.status).toBe(409);

    const stopRes = await server(
      new Request("http://test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      }),
      ctx(brew.id),
    );
    expect(stopRes.status).toBe(409);
  });

  it("熟成中はrecipe POSTが409", async () => {
    const brew = await builtBrew();
    maturingBrews.add(brew.id);
    const { POST } = await import("@/app/api/brews/[id]/recipe/route");
    expect((await POST(new Request("http://test/"), ctx(brew.id))).status).toBe(409);
  });

  it("ビルド中はmature/evaluateが409", async () => {
    const brew = await builtBrew();
    buildingBrews.add(brew.id);
    const { POST } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    expect((await POST(new Request("http://test/"), ctx(brew.id))).status).toBe(409);
  });

  it("熟成中のtap/cancelは409で、実行中のbuildingバッチを書き換えない", async () => {
    const brew = await builtBrew();
    // 熟成中に runNextBatch が永続化する building バッチを再現する
    await writeBrew({
      ...brew,
      batches: [
        ...brew.batches,
        {
          number: 2,
          status: "building",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          error: null,
          evaluation: null,
          pub: null,
        },
      ],
    });
    maturingBrews.add(brew.id);

    const { POST } = await import("@/app/api/brews/[id]/tap/cancel/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(409);

    const stored = await readBrew(brew.id);
    expect(stored.batches[1].status).toBe("building");
  });
});
