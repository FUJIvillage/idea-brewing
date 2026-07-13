import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew } from "@/lib/store";
import { buildingBrews } from "@/lib/tap/build-state";
import { POST as boilPost } from "@/app/api/brews/[id]/boil/route";
import { POST as ingredientsPost } from "@/app/api/brews/[id]/ingredients/route";
import { POST as mashPost } from "@/app/api/brews/[id]/mash/route";
import { PUT as sheetPut } from "@/app/api/brews/[id]/sheet/route";

// 実行中の工程(ビルド等)は進捗保存でBrew全体を上書きするため、
// 編集系ルートは並行編集を409で拒否する(でないと編集が黙って失われる)

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-guard-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
  buildingBrews.clear();
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  buildingBrews.clear();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe("編集系ルートの相互排他", () => {
  it("実行中はシート編集・煮沸・原料追加・マッシュがすべて409を返す", async () => {
    const brew = await createBrew("編集ガード");
    buildingBrews.add(brew.id);

    const cases: [string, Promise<Response>][] = [
      [
        "sheet",
        sheetPut(
          new Request("http://localhost", {
            method: "PUT",
            body: JSON.stringify({ key: "concept", content: "x" }),
          }),
          ctx(brew.id),
        ),
      ],
      [
        "boil",
        boilPost(
          new Request("http://localhost", {
            method: "POST",
            body: JSON.stringify({ action: "finish" }),
          }),
          ctx(brew.id),
        ),
      ],
      [
        "ingredients",
        ingredientsPost(
          new Request("http://localhost", { method: "POST", body: new FormData() }),
          ctx(brew.id),
        ),
      ],
      ["mash", mashPost(new Request("http://localhost", { method: "POST" }), ctx(brew.id))],
    ];
    for (const [name, resPromise] of cases) {
      const res = await resPromise;
      expect(res.status, name).toBe(409);
      expect(await res.json(), name).toEqual({ error: "実行中の工程があります。" });
    }
  });
});
