import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { designCancelTokens, designingBrews } from "@/lib/design/design-state";
import { maturingBrews } from "@/lib/mature/mature-state";
import { createBrew, designDir, readBrew, recipeDir, writeBrew, writeSettings } from "@/lib/store";
import type { Brew, Settings } from "@/lib/store/types";

let tmp: string;
let previousPencilKey: string | undefined;

const FAKE_SETTINGS: Settings = {
  provider: "fake",
  apiKey: "",
  baseUrl: "",
  model: "fake",
  effort: "",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
  cursorEffort: "",
  cursorFast: "",
  pencilCliKey: "",
  pencilModel: "",
  boilMaxQuestions: 20,
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-design-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
  previousPencilKey = process.env.PENCIL_CLI_KEY;
  delete process.env.PENCIL_CLI_KEY;
  await writeSettings(FAKE_SETTINGS);
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  if (previousPencilKey === undefined) {
    delete process.env.PENCIL_CLI_KEY;
  } else {
    process.env.PENCIL_CLI_KEY = previousPencilKey;
  }
  designingBrews.clear();
  designCancelTokens.clear();
  maturingBrews.clear();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function recipeReadyBrew(): Promise<Brew> {
  const brew = await createBrew("デザインルート");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  await fs.writeFile(path.join(recipeDir(brew.id), "02-screens.md"), "# 画面仕様", "utf8");
  await fs.writeFile(path.join(recipeDir(brew.id), "03-design-system.md"), "# DS", "utf8");
  return writeBrew({ ...brew, stage: "done", recipeGeneratedAt: new Date().toISOString() });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new Request("http://test/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe("POST /design/generate", () => {
  it("フェイク構成でモックを生成して designMock succeeded を返す", async () => {
    const brew = await recipeReadyBrew();
    const { POST } = await import("@/app/api/brews/[id]/design/generate/route");
    const res = await POST(post(), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.designMock?.status).toBe("succeeded");
    expect(json.designMock?.model).toBe("fake");
    await fs.access(path.join(designDir(brew.id), "mock.png"));
  });

  it("ブリュー不在は404、レシピ未生成は400、実行中は409", async () => {
    const { POST } = await import("@/app/api/brews/[id]/design/generate/route");

    const missing = await POST(post(), ctx("00000000-0000-4000-8000-000000000000"));
    expect(missing.status).toBe(404);

    const empty = await createBrew("レシピなし");
    const noRecipe = await POST(post(), ctx(empty.id));
    expect(noRecipe.status).toBe(400);

    const brew = await recipeReadyBrew();
    maturingBrews.add(brew.id);
    const busy = await POST(post(), ctx(brew.id));
    expect(busy.status).toBe(409);
  });

  it("実構成でキー未設定なら400(設定誘導)", async () => {
    await writeSettings({ ...FAKE_SETTINGS, provider: "openai" });
    const brew = await recipeReadyBrew();
    const { POST } = await import("@/app/api/brews/[id]/design/generate/route");
    const res = await POST(post(), ctx(brew.id));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Pencil CLIキーが未設定");
  });

  it("残留 generating を補正してから生成する", async () => {
    const brew = await recipeReadyBrew();
    await writeBrew({
      ...brew,
      designMock: {
        status: "generating",
        generatedAt: null,
        error: null,
        model: "",
        costUsd: null,
        durationMs: null,
      },
    });
    const { POST } = await import("@/app/api/brews/[id]/design/generate/route");
    const res = await POST(post(), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.designMock?.status).toBe("succeeded");
  });
});

describe("POST /design/cancel", () => {
  it("実行中トークンがあれば中断フラグを立てて200を返す", async () => {
    const brew = await recipeReadyBrew();
    const token = { cancelled: false };
    designCancelTokens.set(brew.id, token);
    const { POST } = await import("@/app/api/brews/[id]/design/cancel/route");
    const res = await POST(post(), ctx(brew.id));
    expect(res.status).toBe(200);
    expect(token.cancelled).toBe(true);
  });

  it("残留 generating があれば failed に補正して返す", async () => {
    const brew = await recipeReadyBrew();
    await writeBrew({
      ...brew,
      designMock: {
        status: "generating",
        generatedAt: null,
        error: null,
        model: "",
        costUsd: null,
        durationMs: null,
      },
    });
    const { POST } = await import("@/app/api/brews/[id]/design/cancel/route");
    const res = await POST(post(), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.designMock?.status).toBe("failed");
    expect(json.designMock?.error).toContain("中断されました");
  });

  it("実行中でも残留もなければ409", async () => {
    const brew = await recipeReadyBrew();
    const { POST } = await import("@/app/api/brews/[id]/design/cancel/route");
    expect((await POST(post(), ctx(brew.id))).status).toBe(409);
  });
});

describe("GET /design/mock", () => {
  it("モックがなければ404、あればPNGを返す", async () => {
    const brew = await recipeReadyBrew();
    const { GET } = await import("@/app/api/brews/[id]/design/mock/route");
    expect((await GET(new Request("http://test/"), ctx(brew.id))).status).toBe(404);

    const { POST } = await import("@/app/api/brews/[id]/design/generate/route");
    await POST(post(), ctx(brew.id));

    const ok = await GET(new Request("http://test/"), ctx(brew.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
  });
});

describe("GET /design/preview", () => {
  it("プレビューがなければ404、有効サイズならPNGを返す", async () => {
    const brew = await recipeReadyBrew();
    const { GET } = await import("@/app/api/brews/[id]/design/preview/route");
    expect((await GET(new Request("http://test/"), ctx(brew.id))).status).toBe(404);

    await fs.mkdir(designDir(brew.id), { recursive: true });
    await fs.writeFile(path.join(designDir(brew.id), "preview.png"), "tiny", "utf8");
    expect((await GET(new Request("http://test/"), ctx(brew.id))).status).toBe(404);

    const fixture = await fs.readFile(path.join(process.cwd(), "templates", "design-fake", "mock.png"));
    await fs.writeFile(path.join(designDir(brew.id), "preview.png"), fixture);
    const ok = await GET(new Request("http://test/"), ctx(brew.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
  });
});

describe("相互ロック(デザイン)", () => {
  it("デザイン生成中は mature/evaluate と tap/build が409", async () => {
    const brew = await recipeReadyBrew();
    designingBrews.add(brew.id);

    const { POST: evaluate } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    expect((await evaluate(new Request("http://test/"), ctx(brew.id))).status).toBe(409);

    const { POST: build } = await import("@/app/api/brews/[id]/tap/build/route");
    expect((await build(new Request("http://test/"), ctx(brew.id))).status).toBe(409);
  });

  it("生成後の brew.json に記録が永続化される", async () => {
    const brew = await recipeReadyBrew();
    const { POST } = await import("@/app/api/brews/[id]/design/generate/route");
    await POST(post({ instruction: "青系で" }), ctx(brew.id));
    const stored = await readBrew(brew.id);
    expect(stored.designMock?.status).toBe("succeeded");
    expect(stored.designMock?.generatedAt).not.toBeNull();
  });
});
