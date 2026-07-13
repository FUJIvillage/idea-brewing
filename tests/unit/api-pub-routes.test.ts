import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maturingBrews } from "@/lib/mature/mature-state";
import { pubDir } from "@/lib/pub";
import { pubbingBrews, pubCancelTokens } from "@/lib/pub/pub-state";
import { createBrew, writeBrew, writePersonas, writeSettings } from "@/lib/store";
import type { Brew, BrewSheet, Settings } from "@/lib/store/types";
import { SHEET_KEYS } from "@/lib/store/types";
import { buildingBrews } from "@/lib/tap/build-state";

let tmp: string;

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
  boilMaxQuestions: 20,
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
  await writeSettings(FAKE_SETTINGS);
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  pubbingBrews.clear();
  pubCancelTokens.clear();
  maturingBrews.clear();
  buildingBrews.clear();
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

async function builtBrew(): Promise<Brew> {
  const brew = await createBrew("パブルート");
  return writeBrew({
    ...brew,
    stage: "built",
    sheet: sheet(),
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
const post = (body?: unknown) =>
  new Request("http://test/", {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });

describe("POST /pub/run", () => {
  it("フェイク構成で完走して Brew を返す", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/pub/run/route");
    const res = await POST(post({ autoCount: 2 }), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.batches[0].pub?.personaResults).toHaveLength(2);
    expect(json.pubProgress).toBeNull();
  });

  it("body なしは既定(自動3人)で動く", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/pub/run/route");
    const res = await POST(post(), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.batches[0].pub?.personaResults).toHaveLength(3);
  });

  it("常連客IDを解決して参加させる", async () => {
    const brew = await builtBrew();
    const saved = await writePersonas([
      { id: "", name: "常連A", profile: "毎日来る", goals: ["見る"] },
    ]);
    const { POST } = await import("@/app/api/brews/[id]/pub/run/route");
    const res = await POST(post({ autoCount: 0, savedPersonaIds: [saved[0].id] }), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as Brew;
    expect(json.batches[0].pub?.personaResults[0].persona.origin).toBe("saved");
  });

  it("404 / 400(バリデーション)/ 409(busy)", async () => {
    const { POST } = await import("@/app/api/brews/[id]/pub/run/route");

    const missing = await POST(post(), ctx("00000000-0000-4000-8000-000000000000"));
    expect(missing.status).toBe(404);

    const brew = await builtBrew();
    expect((await POST(post({ autoCount: 0 }), ctx(brew.id))).status).toBe(400); // 合計0人
    expect((await POST(post({ autoCount: 6 }), ctx(brew.id))).status).toBe(400);
    expect((await POST(post({ autoCount: 1.5 }), ctx(brew.id))).status).toBe(400);
    expect(
      (await POST(post({ autoCount: 0, savedPersonaIds: ["ghost"] }), ctx(brew.id))).status,
    ).toBe(400); // 未知の常連客
    const dup = await writePersonas([
      { id: "", name: "重複用", profile: "p", goals: ["g"] },
    ]);
    expect(
      (
        await POST(
          post({ autoCount: 0, savedPersonaIds: [dup[0].id, dup[0].id] }),
          ctx(brew.id),
        )
      ).status,
    ).toBe(400); // 常連客の重複
    expect((await POST(post({ autoCount: 3, savedPersonaIds: [1] }), ctx(brew.id))).status).toBe(
      400,
    ); // 型違い

    const empty = await createBrew("空");
    expect((await POST(post(), ctx(empty.id))).status).toBe(400); // 成功バッチなし

    const noSheet = await writeBrew({ ...(await builtBrew()), sheet: null });
    expect((await POST(post({ autoCount: 1 }), ctx(noSheet.id))).status).toBe(400); // シートなし

    maturingBrews.add(brew.id);
    expect((await POST(post(), ctx(brew.id))).status).toBe(409); // 熟成中
    maturingBrews.clear();
    buildingBrews.add(brew.id);
    expect((await POST(post(), ctx(brew.id))).status).toBe(409); // ビルド中
  });

  it("Pub 実行中は熟成系も 409(相互排他)", async () => {
    const brew = await builtBrew();
    pubbingBrews.add(brew.id);
    const { POST: evaluate } = await import("@/app/api/brews/[id]/mature/evaluate/route");
    expect((await evaluate(new Request("http://test/"), ctx(brew.id))).status).toBe(409);
  });
});

describe("POST /pub/cancel", () => {
  it("実行中ならトークンを立てる", async () => {
    const brew = await builtBrew();
    const token = { cancelled: false };
    pubCancelTokens.set(brew.id, token);
    const { POST } = await import("@/app/api/brews/[id]/pub/cancel/route");
    const res = await POST(new Request("http://test/"), ctx(brew.id));
    expect(res.status).toBe(200);
    expect(token.cancelled).toBe(true);
  });

  it("stale な pubProgress を補正し、どちらでもなければ 409", async () => {
    const brew = await builtBrew();
    await writeBrew({ ...brew, pubProgress: { phase: "serving", detail: "残留", batch: 1 } });
    const { POST } = await import("@/app/api/brews/[id]/pub/cancel/route");
    const fixed = await POST(new Request("http://test/"), ctx(brew.id));
    expect(fixed.status).toBe(200);
    expect(((await fixed.json()) as Brew).pubProgress).toBeNull();

    const idle = await POST(new Request("http://test/"), ctx(brew.id));
    expect(idle.status).toBe(409);
  });
});

describe("GET /pub/report と /pub/screenshot", () => {
  it("report は markdown・report・スクリーンショット一覧を返す", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/pub/run/route");
    await POST(post({ autoCount: 1 }), ctx(brew.id));
    await fs.writeFile(path.join(pubDir(brew.id, 1), "persona-1.png"), Buffer.from([1]));

    const { GET } = await import("@/app/api/brews/[id]/pub/report/route");
    const res = await GET(new Request("http://test/?batch=1"), ctx(brew.id));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      markdown: string | null;
      report: unknown;
      screenshots: string[];
    };
    expect(json.markdown).toContain("Pubレポート");
    expect(json.report).not.toBeNull();
    expect(json.screenshots).toEqual(["persona-1.png"]);
  });

  it("report のバリデーション(batch 不正 400 / バッチなし 404)", async () => {
    const brew = await builtBrew();
    const { GET } = await import("@/app/api/brews/[id]/pub/report/route");
    expect((await GET(new Request("http://test/?batch=0"), ctx(brew.id))).status).toBe(400);
    expect((await GET(new Request("http://test/?batch=9"), ctx(brew.id))).status).toBe(404);
  });

  it("screenshot は name をホワイトリストで検証する", async () => {
    const brew = await builtBrew();
    await fs.mkdir(pubDir(brew.id, 1), { recursive: true });
    await fs.writeFile(path.join(pubDir(brew.id, 1), "persona-1.png"), Buffer.from([1]));
    const { GET } = await import("@/app/api/brews/[id]/pub/screenshot/route");

    const ok = await GET(new Request("http://test/?batch=1&name=persona-1.png"), ctx(brew.id));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");

    const bad = await GET(new Request("http://test/?batch=1&name=../brew.json"), ctx(brew.id));
    expect(bad.status).toBe(400);

    const missing = await GET(
      new Request("http://test/?batch=1&name=persona-2.png"),
      ctx(brew.id),
    );
    expect(missing.status).toBe(404);
  });
});

describe("/api/personas と /api/pub/leaderboard", () => {
  it("personas GET/PUT(バリデーション違反は 400)", async () => {
    const { GET, PUT } = await import("@/app/api/personas/route");
    expect(await (await GET()).json()).toEqual([]);

    const put = await PUT(
      new Request("http://test/", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ id: "", name: "常連A", profile: "毎日", goals: ["見る"] }]),
      }),
    );
    expect(put.status).toBe(200);

    const invalid = await PUT(
      new Request("http://test/", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ id: "", name: "", profile: "毎日", goals: ["見る"] }]),
      }),
    );
    expect(invalid.status).toBe(400);

    const notArray = await PUT(
      new Request("http://test/", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(notArray.status).toBe(400);
  });

  it("leaderboard は Pub 済みブリューを返す", async () => {
    const brew = await builtBrew();
    const { POST } = await import("@/app/api/brews/[id]/pub/run/route");
    await POST(post({ autoCount: 1 }), ctx(brew.id));

    const { GET } = await import("@/app/api/pub/leaderboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { entries: { brewId: string; pubOverall: number }[] };
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].brewId).toBe(brew.id);
  });
});
