import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew, recipeDir, tapDir, writeBrew, writeSettings } from "@/lib/store";
import type { Brew, Settings } from "@/lib/store/types";
import { maturingBrews } from "@/lib/mature/mature-state";
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
});

describe("POST /mature/cancel", () => {
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
  it("熟成中はtap/buildが409、tap/serverのstartも409", async () => {
    const brew = await builtBrew();
    maturingBrews.add(brew.id);

    const { POST: build } = await import("@/app/api/brews/[id]/tap/build/route");
    expect((await build(new Request("http://test/"), ctx(brew.id))).status).toBe(409);

    const { POST: server } = await import("@/app/api/brews/[id]/tap/server/route");
    const res = await server(
      new Request("http://test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      }),
      ctx(brew.id),
    );
    expect(res.status).toBe(409);
  });

  it("ビルド中はmature/evaluateが409", async () => {
    const brew = await builtBrew();
    buildingBrews.add(brew.id);
    const { POST } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    expect((await POST(new Request("http://test/"), ctx(brew.id))).status).toBe(409);
  });
});
