# idea brewing 第3版(熟成・自己評価バッチループ)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ビルド済みバッチを LLM がルーブリックで自己評価し、改善指示から次バッチ(2nd、3rd…)を生成する「熟成」ループを実装する。

**Architecture:** サーバー側ジョブ方式(第2版のビルド工程と同じ「進捗を brew.json に永続化 + UI 1秒ポーリング + インメモリロック/キャンセルトークン」)。評価は設定済み LLM(`LlmClient`)、スクリーンショットは Playwright、次バッチ生成は既存 `runBuild` の一般化で行う。

**Tech Stack:** Next.js App Router / TypeScript / Vitest / Playwright(E2E + ランタイム撮影)/ `@cursor/sdk` / zod

**Spec:** `docs/superpowers/specs/2026-07-03-idea-brewing-phase3-design.md`(必読)

**前提:**

- ブランチ: `feat/phase2-tap` から `feat/phase3-mature` を切って作業する(`git switch -c feat/phase3-mature`)
- コマンドは PowerShell 前提。`&&` は使えないので `;` で連結するか個別に実行する
- テスト実行: `npx vitest run <file>`、全体は `npm test`。E2E は `npm run e2e`
- 既存のコード規約: エラーメッセージ・UI 文言は日本語。API エラーは `{ error }` JSON。ドメイン関数は新しい `Brew` を返す(不変更新)

---

## ファイル構成(全体マップ)

| ファイル | 種別 | 責務 |
|---|---|---|
| `src/lib/store/types.ts` | 変更 | `BatchEvaluation` / `MaturationProgress` 等の型追加 |
| `src/lib/store/index.ts` | 変更 | `createBrew` 初期値・`readBrew` バックフィル |
| `src/lib/tap/batches.ts` | 新規 | バッチ配列の純粋ユーティリティ(クライアントからも import 可) |
| `src/lib/llm/client.ts` | 変更 | `LlmTag` に `"evaluate"` 追加 |
| `src/lib/llm/fake-client.ts` | 変更 | `evaluate` タグのフェイク応答 |
| `src/lib/tap/template.ts` | 変更 | `prepareRepairDir` / `writeImprovementNotes` 追加 |
| `src/lib/tap/index.ts` | 変更 | `runBuild` の batch 番号 + improve モード対応 |
| `src/lib/tap/server-manager.ts` | 変更 | バッチ番号対応 |
| `src/lib/mature/screenshot.ts` | 新規 | Playwright 撮影(失敗しても空配列で続行) |
| `src/lib/mature/materials.ts` | 新規 | 評価素材収集(ルーブリック・コード・生成過程) |
| `src/lib/mature/evaluate.ts` | 新規 | LLM 採点 + evaluation.md 生成 |
| `src/lib/mature/index.ts` | 新規 | 熟成オーケストレータ(評価 / 次バッチ / auto) |
| `src/lib/mature/mature-state.ts` | 新規 | 熟成用ロック・キャンセルトークン・相互排他判定 |
| `src/lib/mature/resolve.ts` | 新規 | 設定から熟成用 deps を組み立て |
| `src/app/api/brews/[id]/mature/*/route.ts` | 新規 | evaluate / next / auto / cancel / report / screenshot |
| `src/app/api/brews/[id]/tap/{build,server,log}/route.ts` | 変更 | 相互ロック・バッチ番号対応 |
| `src/components/mature-panel.tsx` | 新規 | 熟成タブ UI |
| `src/components/{brew-workbench,tap-panel,tank-card}.tsx` | 変更 | タブ追加・バッチ番号表示 |
| `next.config.ts` / `package.json` | 変更 | `playwright` 依存 + `serverExternalPackages` |
| `tests/unit/mature-*.test.ts` ほか | 新規/変更 | 単体テスト |
| `tests/e2e/happy-path.spec.ts` | 変更 | 熟成ステップの追加 |

---

### Task 1: データモデル拡張とバッチユーティリティ

**Files:**
- Modify: `src/lib/store/types.ts`
- Modify: `src/lib/store/index.ts`
- Modify: `src/lib/llm/client.ts`
- Create: `src/lib/tap/batches.ts`
- Test: `tests/unit/mature-model.test.ts`

- [ ] **Step 1: ブランチ作成**

```powershell
git switch -c feat/phase3-mature
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/unit/mature-model.test.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { brewDir, createBrew, readBrew } from "@/lib/store";
import type { BatchRecord } from "@/lib/store/types";
import { latestSucceededBatch, maxBatchNumber, upsertBatch } from "@/lib/tap/batches";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function record(number: number, status: BatchRecord["status"]): BatchRecord {
  return {
    number,
    status,
    startedAt: "2026-07-03T00:00:00.000Z",
    finishedAt: null,
    error: null,
    evaluation: null,
  };
}

describe("batches ユーティリティ", () => {
  it("latestSucceededBatch は番号最大の成功バッチを返す", () => {
    const brew = { batches: [record(1, "succeeded"), record(2, "failed"), record(3, "succeeded")] };
    expect(latestSucceededBatch(brew as never)?.number).toBe(3);
  });

  it("成功バッチがなければ null", () => {
    const brew = { batches: [record(1, "failed")] };
    expect(latestSucceededBatch(brew as never)).toBeNull();
  });

  it("maxBatchNumber はバッチなしで 0、あれば最大番号", () => {
    expect(maxBatchNumber({ batches: [] } as never)).toBe(0);
    expect(maxBatchNumber({ batches: [record(2, "failed"), record(5, "succeeded")] } as never)).toBe(5);
  });

  it("upsertBatch は同番号を置換し番号順に並べる", () => {
    const result = upsertBatch([record(2, "failed"), record(1, "succeeded")], record(2, "succeeded"));
    expect(result.map((b) => b.number)).toEqual([1, 2]);
    expect(result[1].status).toBe("succeeded");
  });
});

describe("brew.json のバックフィル", () => {
  it("evaluation / maturationProgress の無い旧データを補完する", async () => {
    const brew = await createBrew("旧データ");
    const raw = JSON.parse(
      await fs.readFile(path.join(brewDir(brew.id), "brew.json"), "utf8"),
    ) as Record<string, unknown>;
    // 第2版時代の brew.json を再現(新フィールドを消す)
    delete raw.maturationProgress;
    raw.batches = [
      {
        number: 1,
        status: "succeeded",
        startedAt: "2026-06-13T00:00:00.000Z",
        finishedAt: "2026-06-13T00:01:00.000Z",
        error: null,
      },
    ];
    await fs.writeFile(path.join(brewDir(brew.id), "brew.json"), JSON.stringify(raw), "utf8");

    const loaded = await readBrew(brew.id);
    expect(loaded.maturationProgress).toBeNull();
    expect(loaded.batches[0].evaluation).toBeNull();
  });

  it("createBrew は maturationProgress: null で初期化する", async () => {
    const brew = await createBrew("新規");
    expect(brew.maturationProgress).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run tests/unit/mature-model.test.ts`
Expected: FAIL(`@/lib/tap/batches` が存在しない / `maturationProgress` プロパティがない)

- [ ] **Step 4: 型を追加**

`src/lib/store/types.ts` の `BuildProgress` 定義の後に追加し、`BatchRecord` と `Brew` を変更:

```ts
export interface AxisScore {
  name: string; // ルーブリックの観点名
  score: number; // 1〜5
  comment: string;
}

export type NextBatchStrategy = "repair" | "rebuild";

export interface BatchEvaluation {
  overall: number; // axes の平均(小数1桁)
  axes: AxisScore[];
  summary: string;
  improvements: string[]; // 次バッチへの改善指示
  strategy: NextBatchStrategy;
  screenshotsUsed: boolean; // スクリーンショットを採点に使えたか
  evaluatedAt: string;
}

export type MaturationPhase = "screenshotting" | "evaluating" | "planning" | "building";

export interface MaturationProgress {
  phase: MaturationPhase;
  detail: string;
  batch: number; // 対象バッチ番号
}
```

`BatchRecord` を変更(コメントも更新):

```ts
export interface BatchRecord {
  number: number; // 1始まり
  status: BatchStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  evaluation: BatchEvaluation | null;
}
```

`Brew` に `maturationProgress` を追加:

```ts
export interface Brew {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  stage: BrewStage;
  ingredients: Ingredient[];
  sheet: BrewSheet | null;
  grill: GrillState;
  recipeProgress: RecipeProgress | null;
  recipeGeneratedAt: string | null;
  batches: BatchRecord[];
  buildProgress: BuildProgress | null;
  maturationProgress: MaturationProgress | null;
}
```

- [ ] **Step 5: ストアの初期化とバックフィル**

`src/lib/store/index.ts` の `createBrew` のオブジェクトリテラルに `maturationProgress: null,` を追加(`buildProgress: null,` の直後)。

`readBrew` の return を差し替え:

```ts
export async function readBrew(id: string): Promise<Brew> {
  const raw = await fs.readFile(path.join(brewDir(id), "brew.json"), "utf8");
  const parsed = JSON.parse(raw) as Brew;
  // 旧バージョンの brew.json に無いフィールドを補完する
  return {
    ...parsed,
    batches: (parsed.batches ?? []).map((b) => ({ ...b, evaluation: b.evaluation ?? null })),
    buildProgress: parsed.buildProgress ?? null,
    maturationProgress: parsed.maturationProgress ?? null,
  };
}
```

- [ ] **Step 6: batches ユーティリティを作成**

`src/lib/tap/batches.ts` を新規作成。**Node API に依存しない純粋モジュール**にすること(クライアントコンポーネントからも import するため):

```ts
import type { BatchRecord, Brew } from "@/lib/store/types";

/** 最新(番号最大)の成功バッチ。なければ null */
export function latestSucceededBatch(brew: Brew): BatchRecord | null {
  let latest: BatchRecord | null = null;
  for (const b of brew.batches) {
    if (b.status === "succeeded" && (!latest || b.number > latest.number)) latest = b;
  }
  return latest;
}

/** 既存バッチの最大番号。バッチなしなら 0 */
export function maxBatchNumber(brew: Brew): number {
  return brew.batches.reduce((max, b) => Math.max(max, b.number), 0);
}

/** number をキーに追加/置換し、番号順に並べ直す */
export function upsertBatch(batches: BatchRecord[], record: BatchRecord): BatchRecord[] {
  return [...batches.filter((b) => b.number !== record.number), record].sort(
    (a, b) => a.number - b.number,
  );
}
```

- [ ] **Step 7: LlmTag に evaluate を追加**

`src/lib/llm/client.ts` の 3 行目を差し替え:

```ts
export type LlmTag = "mash" | "grill-next" | "grill-apply" | "recipe" | "evaluate" | "connection-test";
```

- [ ] **Step 8: テストと型チェック**

Run: `npx vitest run tests/unit/mature-model.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: エラーなし。**`BatchRecord` に必須フィールド `evaluation` を追加したため、既存コード・既存テストの `BatchRecord` オブジェクトリテラル(`src/lib/tap/index.ts` の `batches` 生成箇所、`tests/unit/tap.test.ts` / `tests/unit/api-tap-routes.test.ts` のテストデータなど)がエラーになる。該当リテラルに `evaluation: null,` を追加して通す**(`src/lib/tap/index.ts` のロジック自体は Task 2 で本格的に書き換える)。

- [ ] **Step 9: 既存の全テストが通ることを確認してコミット**

Run: `npm test`
Expected: 全 PASS

```powershell
git add -A; git commit -m "feat: 熟成用データモデル(BatchEvaluation/MaturationProgress)とバッチユーティリティを追加"
```

---

### Task 2: runBuild の一般化(バッチ番号 + improve モード)

**Files:**
- Modify: `src/lib/tap/template.ts`
- Modify: `src/lib/tap/index.ts`
- Modify: `src/app/api/brews/[id]/tap/build/route.ts`
- Test: `tests/unit/tap-improve.test.ts`(新規)、`tests/unit/tap.test.ts`(既存の呼び出し更新)

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/tap-improve.test.ts` を新規作成。既存 `tests/unit/tap.test.ts` のセットアップ(tmp データディレクトリ + `createBrew` + レシピファイル作成 + フェイクエンジン/ランナー)の流儀を踏襲する:

```ts
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew, readBrew, recipeDir, tapDir, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { normalizeStaleBatch, runBuild } from "@/lib/tap";
import { createFakeBuildEngine } from "@/lib/tap/fake-engine";
import type { CommandRunner } from "@/lib/tap/runner";
import { prepareRepairDir, shouldCopyRepairPath, writeImprovementNotes } from "@/lib/tap/template";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const okRunner: CommandRunner = {
  async run() {
    return { ok: true, output: "" };
  },
};

async function readyBrew(): Promise<Brew> {
  const brew = await createBrew("熟成テスト");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  await fs.writeFile(path.join(recipeDir(brew.id), "05-implementation-plan.md"), "## タスクA\n本文A\n", "utf8");
  return writeBrew({ ...brew, recipeGeneratedAt: new Date().toISOString() });
}

describe("prepareRepairDir", () => {
  it("前バッチをコピーし、実行時生成物を除外する", async () => {
    const brew = await readyBrew();
    const src = tapDir(brew.id, 1);
    await fs.mkdir(path.join(src, "src"), { recursive: true });
    await fs.mkdir(path.join(src, "node_modules", "x"), { recursive: true });
    await fs.mkdir(path.join(src, "screenshots"), { recursive: true });
    await fs.writeFile(path.join(src, "src", "App.tsx"), "export {}", "utf8");
    await fs.writeFile(path.join(src, "build.log"), "log", "utf8");
    await fs.writeFile(path.join(src, "evaluation.md"), "report", "utf8");
    await fs.writeFile(path.join(src, "package.json"), "{}", "utf8");

    const dest = await prepareRepairDir(brew.id, 1, 2);

    expect(existsSync(path.join(dest, "src", "App.tsx"))).toBe(true);
    expect(existsSync(path.join(dest, "package.json"))).toBe(true);
    expect(existsSync(path.join(dest, "node_modules"))).toBe(false);
    expect(existsSync(path.join(dest, "screenshots"))).toBe(false);
    expect(existsSync(path.join(dest, "build.log"))).toBe(false);
    expect(existsSync(path.join(dest, "evaluation.md"))).toBe(false);
  });

  it("shouldCopyRepairPath は除外セグメントを判定する", () => {
    const root = path.join("C:", "root");
    expect(shouldCopyRepairPath(root, path.join(root, "src", "a.ts"))).toBe(true);
    expect(shouldCopyRepairPath(root, path.join(root, "node_modules", "y"))).toBe(false);
    expect(shouldCopyRepairPath(root, path.join(root, "build.log"))).toBe(false);
  });
});

describe("writeImprovementNotes", () => {
  it("docs/recipe/07-improvement-notes.md に番号付きで書く", async () => {
    const dir = path.join(tmp, "notes-test");
    await fs.mkdir(dir, { recursive: true });
    await writeImprovementNotes(dir, ["指示1", "指示2"]);
    const text = await fs.readFile(path.join(dir, "docs", "recipe", "07-improvement-notes.md"), "utf8");
    expect(text).toContain("1. 指示1");
    expect(text).toContain("2. 指示2");
  });
});

describe("runBuild improve モード", () => {
  it("repair 戦略: 前バッチをコピーして改善指示を1件ずつ送り、batch-2 レコードを追加する", async () => {
    const brew = await readyBrew();
    // 前バッチ(成功済みの想定)のフォルダを用意
    await fs.mkdir(path.join(tapDir(brew.id, 1), "src"), { recursive: true });
    await fs.writeFile(path.join(tapDir(brew.id, 1), "src", "App.tsx"), "old", "utf8");
    const withBatch1: Brew = {
      ...brew,
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
    };
    const engine = createFakeBuildEngine();

    const done = await runBuild(withBatch1, {
      engine,
      runner: okRunner,
      template: "tap-fake",
      batch: 2,
      mode: { kind: "improve", strategy: "repair", fromBatch: 1, instructions: ["指示A", "指示B"] },
    });

    expect(done.batches.map((b) => b.number)).toEqual([1, 2]);
    expect(done.batches[1].status).toBe("succeeded");
    expect(done.stage).toBe("built");
    // 前バッチのコードが引き継がれ、改善指示が同梱されている
    expect(existsSync(path.join(tapDir(brew.id, 2), "src", "App.tsx"))).toBe(true);
    expect(
      existsSync(path.join(tapDir(brew.id, 2), "docs", "recipe", "07-improvement-notes.md")),
    ).toBe(true);
    // intro + 指示2件 = 3 send
    expect(engine.prompts).toHaveLength(3);
    expect(engine.prompts[1]).toContain("指示A");
    expect(engine.prompts[2]).toContain("指示B");
  });

  it("rebuild 戦略: テンプレートから作り直し、introに改善指示への言及を含める", async () => {
    const brew = await readyBrew();
    const withBatch1: Brew = {
      ...brew,
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
    };
    const engine = createFakeBuildEngine();

    const done = await runBuild(withBatch1, {
      engine,
      runner: okRunner,
      template: "tap-fake",
      batch: 2,
      mode: { kind: "improve", strategy: "rebuild", fromBatch: 1, instructions: ["指示A"] },
    });

    expect(done.batches[1].status).toBe("succeeded");
    // テンプレート由来の server.js がある(tap-fake からのコピー)
    expect(existsSync(path.join(tapDir(brew.id, 2), "server.js"))).toBe(true);
    expect(
      existsSync(path.join(tapDir(brew.id, 2), "docs", "recipe", "07-improvement-notes.md")),
    ).toBe(true);
    expect(engine.prompts[0]).toContain("07-improvement-notes.md");
  });

  it("normalizeStaleBatch は複数バッチ中の building だけを failed に補正する", async () => {
    const brew = await readyBrew();
    const stale: Brew = {
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: "2026-07-03T00:00:00.000Z",
          finishedAt: "2026-07-03T00:01:00.000Z",
          error: null,
          evaluation: null,
        },
        {
          number: 2,
          status: "building",
          startedAt: "2026-07-03T00:02:00.000Z",
          finishedAt: null,
          error: null,
          evaluation: null,
        },
      ],
      buildProgress: { phase: "generating", detail: "x" },
    };
    const normalized = normalizeStaleBatch(stale);
    expect(normalized.batches[0].status).toBe("succeeded");
    expect(normalized.batches[1].status).toBe("failed");
    expect(normalized.buildProgress).toBeNull();
  });

  it("成功済みバッチがあるとき build ルートは 400 を返す", async () => {
    const brew = await readyBrew();
    await writeBrew({
      ...brew,
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
    const { POST } = await import("@/app/api/brews/[id]/tap/build/route");
    const res = await POST(new Request("http://test/"), {
      params: Promise.resolve({ id: brew.id }),
    });
    expect(res.status).toBe(400);
    // Cursor未設定の400と区別するため、理由(成功済みバッチガード)まで確認する
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("熟成タブ");
    const loaded = await readBrew(brew.id);
    expect(loaded.batches).toHaveLength(1); // 上書きされていない
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/unit/tap-improve.test.ts`
Expected: FAIL(`prepareRepairDir` 等が存在しない、`runBuild` が `batch`/`mode` を受けない)

- [ ] **Step 3: template.ts に repair 準備を実装**

`src/lib/tap/template.ts` の末尾に追加:

```ts
const REPAIR_EXCLUDES = new Set([
  "node_modules",
  "dist",
  "screenshots",
  "build.log",
  "evaluation.md",
  "agent-log.txt",
]);

/** 修理コピーで引き継がないパスを判定する(バッチ実行時の生成物・ログ類を除外) */
export function shouldCopyRepairPath(root: string, src: string): boolean {
  const segments = path.relative(root, src).split(path.sep).filter(Boolean);
  return !segments.some((s) => REPAIR_EXCLUDES.has(s));
}

/** 前バッチのフォルダを次バッチへコピーする(repair 戦略の準備) */
export async function prepareRepairDir(
  brewId: string,
  fromBatch: number,
  toBatch: number,
): Promise<string> {
  const src = tapDir(brewId, fromBatch);
  const dest = tapDir(brewId, toBatch);
  await fs.rm(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.cp(src, dest, {
    recursive: true,
    filter: (p) => shouldCopyRepairPath(src, p),
  });
  return dest;
}

/** 改善指示を docs/recipe/07-improvement-notes.md として書き込む */
export async function writeImprovementNotes(
  batchDir: string,
  instructions: string[],
): Promise<void> {
  const docsDir = path.join(batchDir, "docs", "recipe");
  await fs.mkdir(docsDir, { recursive: true });
  const body = [
    "# 改善指示(前バッチの自己評価より)",
    "",
    ...instructions.map((s, i) => `${i + 1}. ${s}`),
    "",
  ].join("\n");
  await fs.writeFile(path.join(docsDir, "07-improvement-notes.md"), body, "utf8");
}
```

- [ ] **Step 4: runBuild を一般化**

`src/lib/tap/index.ts` を変更する。

import に追加:

```ts
import type { NextBatchStrategy } from "@/lib/store/types";
import { upsertBatch } from "./batches";
import { prepareBatchDir, prepareRepairDir, readManifest, templateDir, writeImprovementNotes, type TemplateId } from "./template";
```

`BuildDeps` と `BuildMode` を差し替え:

```ts
export type BuildMode =
  | { kind: "initial" }
  | { kind: "improve"; strategy: NextBatchStrategy; fromBatch: number; instructions: string[] };

export interface BuildDeps {
  engine: BuildEngine;
  runner: CommandRunner;
  template: TemplateId;
  /** 対象バッチ番号(1始まり) */
  batch: number;
  mode: BuildMode;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}
```

プロンプト定義を追加(既存 `INTRO_PROMPT` / `taskPrompt` / `repairPrompt` はそのまま):

```ts
const IMPROVE_NOTES_SENTENCE =
  "docs/recipe/07-improvement-notes.md に前バッチの自己評価から得た改善指示があります。実装ではこの指示を必ず反映してください。";

const REPAIR_INTRO_PROMPT = [
  "あなたはこの作業ディレクトリの Web サービスを改善するエンジニアです。",
  "docs/recipe/ のレシピ(00〜06 の Markdown)と docs/recipe/07-improvement-notes.md の改善指示をすべて読んでください。",
  "このディレクトリには前バッチで実装済みのコードがあります。構成(Vite + React + TypeScript + Tailwind CSS)は変更せず、改善指示に従って既存コードを修正します。",
  "依存パッケージの追加は package.json の編集のみで行い、npm install は実行しないでください(検証工程で実行します)。",
  "dev サーバーの起動やビルドコマンドの実行もしないでください。",
  "まだコードは書かず、改善方針を5行以内で要約してください。",
].join("\n");

function improvementPrompt(index: number, total: number, instruction: string): string {
  return [
    `改善指示 ${index}/${total} を実施してください。`,
    instruction,
    "完了したら変更内容を3行以内で要約してください。",
  ].join("\n\n");
}
```

`finishBatch` を対象番号更新に変更:

```ts
function finishBatch(
  brew: Brew,
  batchNumber: number,
  status: BatchStatus,
  error: string | null,
): Brew {
  const target = brew.batches.find((b) => b.number === batchNumber);
  if (!target) return { ...brew, buildProgress: null };
  return {
    ...brew,
    stage: status === "succeeded" ? "built" : brew.stage,
    buildProgress: null,
    batches: upsertBatch(brew.batches, {
      ...target,
      status,
      finishedAt: new Date().toISOString(),
      error,
    }),
  };
}
```

`normalizeStaleBatch` を全バッチ対応に変更:

```ts
/** クラッシュで building のまま残ったバッチを failed に補正する。補正不要なら同一参照を返す */
export function normalizeStaleBatch(brew: Brew): Brew {
  if (!brew.batches.some((b) => b.status === "building")) return brew;
  return {
    ...brew,
    batches: brew.batches.map((b) =>
      b.status === "building"
        ? {
            ...b,
            status: "failed" as const,
            finishedAt: new Date().toISOString(),
            error: "中断されました(プロセス終了)",
          }
        : b,
    ),
    buildProgress: null,
  };
}
```

`runBuild` 本体を差し替え(検証・修理ループと catch/finally は既存のまま、`finishBatch` 呼び出しに `deps.batch` を追加):

```ts
export async function runBuild(brew: Brew, deps: BuildDeps): Promise<Brew> {
  if (!brew.recipeGeneratedAt) {
    throw new Error("レシピがまだ生成されていません。");
  }

  let current: Brew = {
    ...brew,
    batches: upsertBatch(brew.batches, {
      number: deps.batch,
      status: "building",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      evaluation: null,
    }),
  };

  current = withProgress(current, "preparing", "作業フォルダを準備しています");
  await deps.onProgress?.(current);

  let session: BuildSession | null = null;
  let log: ((line: string) => void) | null = null;
  try {
    const manifest = await readManifest(templateDir(deps.template));
    const batchDir =
      deps.mode.kind === "improve" && deps.mode.strategy === "repair"
        ? await prepareRepairDir(brew.id, deps.mode.fromBatch, deps.batch)
        : await prepareBatchDir(brew.id, deps.batch, deps.template);
    if (deps.mode.kind === "improve") {
      await writeImprovementNotes(batchDir, deps.mode.instructions);
    }
    const logPath = path.join(batchDir, "build.log");
    log = (line: string) => {
      appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
    };

    log(`[build] バッチ${deps.batch} のビルドを開始(${deps.mode.kind})`);
    session = await deps.engine.createSession({ cwd: batchDir, onLog: log });

    if (deps.mode.kind === "improve" && deps.mode.strategy === "repair") {
      current = withProgress(current, "generating", "改善指示を読み込んでいます");
      await deps.onProgress?.(current);
      log("[build] 改善指示の読み込みを指示");
      let res = await sendWithCancel(session, REPAIR_INTRO_PROMPT, deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);

      const instructions = deps.mode.instructions;
      for (let i = 0; i < instructions.length; i++) {
        current = withProgress(current, "generating", `改善 ${i + 1}/${instructions.length}`);
        await deps.onProgress?.(current);
        log(`[build] 改善指示 ${i + 1}/${instructions.length}`);
        res = await sendWithCancel(
          session,
          improvementPrompt(i + 1, instructions.length, instructions[i]),
          deps.cancel,
        );
        if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
        if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);
      }
    } else {
      const planMd = await readRecipeFile(brew.id, "05-implementation-plan.md").catch(() => "");
      const tasks = extractTasks(planMd);
      const intro =
        deps.mode.kind === "improve" ? `${INTRO_PROMPT}\n${IMPROVE_NOTES_SENTENCE}` : INTRO_PROMPT;

      current = withProgress(current, "generating", "レシピを読み込んでいます");
      await deps.onProgress?.(current);
      log("[build] レシピ読み込みを指示");
      let res = await sendWithCancel(session, intro, deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);

      if (tasks.length === 0) {
        current = withProgress(current, "generating", "レシピ全体を一括実装中");
        await deps.onProgress?.(current);
        log("[build] 一括実装を指示");
        res = await sendWithCancel(
          session,
          "docs/recipe/ のレシピ全体を、このひな形の上に一括で実装してください。完了したら変更内容を3行以内で要約してください。",
          deps.cancel,
        );
        if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
        if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);
      } else {
        for (let i = 0; i < tasks.length; i++) {
          current = withProgress(
            current,
            "generating",
            `タスク ${i + 1}/${tasks.length}: ${tasks[i].title}`,
          );
          await deps.onProgress?.(current);
          log(`[build] タスク ${i + 1}/${tasks.length}: ${tasks[i].title}`);
          res = await sendWithCancel(
            session,
            taskPrompt(i + 1, tasks.length, tasks[i].title, tasks[i].body),
            deps.cancel,
          );
          if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
          if (!res.ok) return finishBatch(current, deps.batch, "failed", res.summary);
        }
      }
    }

    for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
      current = withProgress(
        current,
        "verifying",
        round === 0 ? "検証コマンドを実行中" : `再検証中(修理ラウンド ${round}/${MAX_REPAIR_ROUNDS})`,
      );
      await deps.onProgress?.(current);
      const failure = await runVerify(deps.runner, manifest.verify, batchDir, log, deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!failure) return finishBatch(current, deps.batch, "succeeded", null);
      if (round === MAX_REPAIR_ROUNDS) {
        return finishBatch(current, deps.batch, "failed", `検証失敗(修理上限超過): ${failure.command}`);
      }

      current = withProgress(current, "repairing", `修理ラウンド ${round + 1}/${MAX_REPAIR_ROUNDS}`);
      await deps.onProgress?.(current);
      log(`[build] 修理ラウンド ${round + 1}: ${failure.command} が失敗`);
      const repairRes = await sendWithCancel(
        session,
        repairPrompt(round + 1, failure.output),
        deps.cancel,
      );
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!repairRes.ok) return finishBatch(current, deps.batch, "failed", repairRes.summary);
    }

    return finishBatch(current, deps.batch, "failed", "不明な状態");
  } catch (err) {
    if (isProgrammerError(err)) throw err;
    const status: BatchStatus = deps.cancel?.cancelled ? "cancelled" : "failed";
    return finishBatch(current, deps.batch, status, status === "cancelled" ? null : errorMessage(err));
  } finally {
    try {
      await session?.dispose();
    } catch (err) {
      try {
        log?.(`[build] セッション破棄に失敗: ${errorMessage(err)}`);
      } catch {
        // dispose失敗で本来のビルド結果を上書きしない
      }
    }
  }
}
```

注意: 検証ループ内の `res` は repair 分岐スコープの `let res` が使えないため、ループ手前で `let res: BuildSendResult;` を宣言し直すか、修理ラウンドの send 結果を `const repairRes` で受けて判定する。TypeScript のスコープエラーが出たら修理ラウンド部分を次のように直す:

```ts
      const repairRes = await sendWithCancel(session, repairPrompt(round + 1, failure.output), deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, deps.batch, "cancelled", null);
      if (!repairRes.ok) return finishBatch(current, deps.batch, "failed", repairRes.summary);
```

- [ ] **Step 5: build ルートを更新**

`src/app/api/brews/[id]/tap/build/route.ts` を変更。import に `latestSucceededBatch` を追加:

```ts
import { latestSucceededBatch } from "@/lib/tap/batches";
```

`recipeGeneratedAt` チェックの直後に成功バッチガードを追加:

```ts
    if (latestSucceededBatch(brew)) {
      return NextResponse.json(
        { error: "成功済みのバッチがあります。次のバッチは熟成タブから作成してください。" },
        { status: 400 },
      );
    }
```

`runBuild` 呼び出しに `batch: 1, mode: { kind: "initial" }` を追加:

```ts
    const done = await runBuild(normalizeStaleBatch(brew), {
      engine: resolved.engine,
      template: resolved.template,
      runner: realRunner,
      batch: 1,
      mode: { kind: "initial" },
      cancel: token,
      onProgress: async (b) => {
        await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
      },
    });
```

- [ ] **Step 6: 既存テストの呼び出しを更新**

`tests/unit/tap.test.ts` 内のすべての `runBuild(brew, { ... })` 呼び出しに `batch: 1, mode: { kind: "initial" },` を追加する。`batches[0]` を組み立てているテストデータがあれば `evaluation: null` を追加する。`tests/unit/api-tap-routes.test.ts` で「ビルド成功後に再度ビルド」を試みるテストがあれば、期待値を 400 に変更する(なければそのまま)。

- [ ] **Step 7: テスト実行**

Run: `npx vitest run tests/unit/tap-improve.test.ts tests/unit/tap.test.ts tests/unit/api-tap-routes.test.ts`
Expected: 全 PASS

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 8: コミット**

```powershell
git add -A; git commit -m "feat: runBuildをバッチ番号+improveモード対応に一般化しrepair準備を追加"
```

---

### Task 3: server-manager とタップ系ルートのバッチ番号対応

**Files:**
- Modify: `src/lib/tap/server-manager.ts`
- Modify: `src/app/api/brews/[id]/tap/server/route.ts`
- Modify: `src/app/api/brews/[id]/tap/log/route.ts`
- Test: `tests/unit/server-manager.test.ts`(既存更新 + バッチ切替テスト追加)

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/server-manager.test.ts` の既存の `startServer(brew.id)` 呼び出しをすべて `startServer(brew.id, 1)` に変更し、`serverStatus` の期待値に `batch` を追加(`toEqual({ running: true, port: first.port })` → `toEqual({ running: true, port: first.port, batch: 1 })`)。さらに describe 内に追加:

```ts
  it("別バッチを指定すると旧サーバーを止めて起動し直す", async () => {
    const brew = await createBrew("バッチ切替");
    brewId = brew.id;
    await fs.cp(path.join(process.cwd(), "templates", "tap-fake"), tapDir(brew.id, 1), {
      recursive: true,
    });
    await fs.cp(path.join(process.cwd(), "templates", "tap-fake"), tapDir(brew.id, 2), {
      recursive: true,
    });

    await startServer(brew.id, 1);
    expect(serverStatus(brew.id).batch).toBe(1);

    const { port } = await startServer(brew.id, 2);
    const status = serverStatus(brew.id);
    expect(status).toEqual({ running: true, port, batch: 2 });

    await stopServer(brew.id);
    brewId = null;
  }, 60_000);
```

Run: `npx vitest run tests/unit/server-manager.test.ts`
Expected: FAIL(引数の数・`batch` プロパティ)

- [ ] **Step 2: server-manager を実装**

`src/lib/tap/server-manager.ts` を変更:

`RunningServer` に `batch: number;` を追加。`ServerStatus` を差し替え:

```ts
export interface ServerStatus {
  running: boolean;
  port: number | null;
  batch: number | null;
}
```

`startServer` を差し替え:

```ts
export async function startServer(brewId: string, batch: number): Promise<{ port: number }> {
  const starting = startPromises.get(brewId);
  if (starting) {
    // 起動途中のサーバーがあれば完了(または失敗)を待ってから判断する
    await starting.catch(() => undefined);
  }

  const existing = servers.get(brewId);
  if (existing && !hasExited(existing.child)) {
    if (existing.batch === batch) return existing.readyPromise;
    // 別バッチのサーバーは止めてから起動し直す(1ブリュー1サーバー)
    await stopEntryIfCurrent(brewId, existing);
  } else if (existing) {
    servers.delete(brewId);
  }

  const promise = startFreshServer(brewId, batch);
  startPromises.set(brewId, promise);
  try {
    return await promise;
  } finally {
    if (startPromises.get(brewId) === promise) startPromises.delete(brewId);
  }
}
```

`startFreshServer` のシグネチャを `async function startFreshServer(brewId: string, batch: number)` にし、`const cwd = tapDir(brewId, 1);` を `const cwd = tapDir(brewId, batch);` に変更。`entry` の生成に `batch,` を追加。30秒タイムアウトのエラーメッセージを `taps/batch-${batch} を確認してください。` に変更。

`serverStatus` を差し替え:

```ts
export function serverStatus(brewId: string): ServerStatus {
  const entry = servers.get(brewId);
  if (!entry) return { running: false, port: null, batch: null };
  if (hasExited(entry.child)) {
    servers.delete(brewId);
    return { running: false, port: null, batch: null };
  }
  return { running: true, port: entry.port, batch: entry.batch };
}
```

- [ ] **Step 3: tap/server ルートを更新**

`src/app/api/brews/[id]/tap/server/route.ts` の import に追加:

```ts
import { latestSucceededBatch } from "@/lib/tap/batches";
```

POST の `start` 分岐を差し替え:

```ts
    if (action === "start") {
      const target = latestSucceededBatch(brew);
      if (!target) {
        return NextResponse.json({ error: "ビルドが成功していません。" }, { status: 400 });
      }
      await startServer(id, target.number);
    } else if (action === "stop") {
```

- [ ] **Step 4: tap/log ルートを ?batch=N 対応に**

`src/app/api/brews/[id]/tap/log/route.ts` の GET を差し替え(import に `maxBatchNumber` と `Brew` 型を追加):

```ts
import { maxBatchNumber } from "@/lib/tap/batches";
import type { Brew } from "@/lib/store/types";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    const batchParam = new URL(req.url).searchParams.get("batch");
    let batch: number;
    if (batchParam === null) {
      batch = Math.max(maxBatchNumber(brew), 1); // 省略時は最新バッチ
    } else {
      batch = Number(batchParam);
      if (!Number.isInteger(batch) || batch < 1) {
        return NextResponse.json(
          { error: "batch は1以上の整数で指定してください。" },
          { status: 400 },
        );
      }
    }
    return NextResponse.json({ lines: await readLogTail(path.join(tapDir(id, batch), "build.log")) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ lines: [] });
    }
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: テスト実行とコミット**

Run: `npx vitest run tests/unit/server-manager.test.ts tests/unit/api-tap-routes.test.ts`
Expected: 全 PASS(api-tap-routes に `serverStatus` の形を検証するテストがあれば `batch` を追加)

Run: `npx tsc --noEmit` → エラーなし

```powershell
git add -A; git commit -m "feat: server-managerとタップ系ルートをバッチ番号対応にする"
```

---

### Task 4: スクリーンショット撮影(screenshot.ts)

**Files:**
- Modify: `package.json`(playwright を dependencies へ)
- Modify: `next.config.ts`
- Create: `src/lib/mature/screenshot.ts`
- Test: `tests/unit/mature-screenshot.test.ts`

- [ ] **Step 1: playwright を dependencies に追加**

```powershell
npm install "playwright@^1.60.0"
```

`@playwright/test`(devDependencies: `^1.60.0`)と同じバージョンレンジで揃えること(型・ブラウザバイナリの不一致を防ぐ)。`package.json` の dependencies に入ったことを確認する。

`next.config.ts` を差し替え:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright はネイティブ資産を含むためサーバーバンドルに含めない
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/unit/mature-screenshot.test.ts` を新規作成。実 Playwright は使わず、フェイクの browser / server-manager で契約(失敗時に空配列・サーバー必ず停止)を検証する:

```ts
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew, tapDir } from "@/lib/store";
import {
  captureScreenshots,
  SCREENSHOT_FILES,
  type ScreenshotBrowser,
  type ScreenshotDeps,
} from "@/lib/mature/screenshot";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function fakeBrowser(log: string[]): ScreenshotBrowser {
  return {
    async newPage() {
      return {
        async goto(url: string) {
          log.push(`goto:${url}`);
        },
        async screenshot({ path: file }: { path: string }) {
          await fs.writeFile(file, "png", "utf8");
          log.push(`shot:${path.basename(file)}`);
        },
        async close() {},
      };
    },
    async close() {
      log.push("browser-closed");
    },
  };
}

describe("captureScreenshots", () => {
  it("2枚撮影して保存パスを返し、サーバーを停止する", async () => {
    const brew = await createBrew("撮影");
    const log: string[] = [];
    const deps: ScreenshotDeps = {
      startServer: async () => {
        log.push("server-start");
        return { port: 12345 };
      },
      stopServer: async () => {
        log.push("server-stop");
      },
      launch: async () => fakeBrowser(log),
    };

    const saved = await captureScreenshots(brew.id, 1, deps);

    expect(saved).toHaveLength(2);
    for (const name of SCREENSHOT_FILES) {
      expect(existsSync(path.join(tapDir(brew.id, 1), "screenshots", name))).toBe(true);
    }
    expect(log).toContain("server-stop");
    expect(log).toContain("browser-closed");
    expect(log[0]).toBe("server-start");
  });

  it("サーバー起動に失敗したら空配列(例外なし)", async () => {
    const brew = await createBrew("撮影失敗1");
    const saved = await captureScreenshots(brew.id, 1, {
      startServer: async () => {
        throw new Error("起動失敗");
      },
      stopServer: async () => {},
      launch: async () => fakeBrowser([]),
    });
    expect(saved).toEqual([]);
  });

  it("ブラウザ起動に失敗したら空配列を返しサーバーは停止する", async () => {
    const brew = await createBrew("撮影失敗2");
    const log: string[] = [];
    const saved = await captureScreenshots(brew.id, 1, {
      startServer: async () => ({ port: 12345 }),
      stopServer: async () => {
        log.push("server-stop");
      },
      launch: async () => {
        throw new Error("playwright未インストール");
      },
    });
    expect(saved).toEqual([]);
    expect(log).toContain("server-stop");
  });
});
```

Run: `npx vitest run tests/unit/mature-screenshot.test.ts`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: screenshot.ts を実装**

`src/lib/mature/screenshot.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { tapDir } from "@/lib/store";

export const SCREENSHOT_FILES = ["desktop.png", "mobile.png"] as const;
export type ScreenshotFile = (typeof SCREENSHOT_FILES)[number];

const VIEWPORTS: Record<ScreenshotFile, { width: number; height: number }> = {
  "desktop.png": { width: 1280, height: 800 },
  "mobile.png": { width: 390, height: 844 },
};

export interface ScreenshotPage {
  goto(url: string, opts: { waitUntil: "networkidle"; timeout: number }): Promise<unknown>;
  screenshot(opts: { path: string }): Promise<unknown>;
  close(): Promise<void>;
}

export interface ScreenshotBrowser {
  newPage(opts: { viewport: { width: number; height: number } }): Promise<ScreenshotPage>;
  close(): Promise<void>;
}

export interface ScreenshotDeps {
  startServer: (brewId: string, batch: number) => Promise<{ port: number }>;
  stopServer: (brewId: string) => Promise<void>;
  launch: () => Promise<ScreenshotBrowser>;
}

export async function launchChromium(): Promise<ScreenshotBrowser> {
  const { chromium } = await import("playwright");
  return chromium.launch();
}

/**
 * バッチの dev サーバーを起動して実画面を撮影する。
 * 撮影は評価の補助情報なので、失敗しても例外を投げず空配列を返す(熟成全体を止めない契約)。
 * 戻り値は保存できたスクリーンショットの絶対パス。
 */
export async function captureScreenshots(
  brewId: string,
  batch: number,
  deps: ScreenshotDeps,
): Promise<string[]> {
  let port: number;
  try {
    ({ port } = await deps.startServer(brewId, batch));
  } catch {
    return [];
  }

  try {
    const browser = await deps.launch();
    try {
      const dir = path.join(tapDir(brewId, batch), "screenshots");
      await fs.mkdir(dir, { recursive: true });
      const saved: string[] = [];
      for (const name of SCREENSHOT_FILES) {
        const page = await browser.newPage({ viewport: VIEWPORTS[name] });
        try {
          await page.goto(`http://localhost:${port}/`, {
            waitUntil: "networkidle",
            timeout: 15_000,
          });
          const file = path.join(dir, name);
          await page.screenshot({ path: file });
          saved.push(file);
        } finally {
          await page.close();
        }
      }
      return saved;
    } finally {
      await browser.close();
    }
  } catch {
    return [];
  } finally {
    await deps.stopServer(brewId).catch(() => undefined);
  }
}
```

- [ ] **Step 4: テスト実行とコミット**

Run: `npx vitest run tests/unit/mature-screenshot.test.ts`
Expected: PASS

Run: `npx tsc --noEmit` → エラーなし(`chromium.launch()` の戻りが `ScreenshotBrowser` に構造的に代入できない場合は `return chromium.launch() as unknown as ScreenshotBrowser;` ではなく、`ScreenshotPage`/`ScreenshotBrowser` のメソッドシグネチャを Playwright の実型に合わせて緩める。安易なキャストは避ける)

```powershell
git add -A; git commit -m "feat: Playwrightによるバッチ画面のスクリーンショット撮影を追加"
```

---

### Task 5: 評価素材収集(materials.ts)

**Files:**
- Create: `src/lib/mature/materials.ts`
- Test: `tests/unit/mature-materials.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/mature-materials.test.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrew, recipeDir, tapDir, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { buildCodeDigest, collectMaterials, grillDump } from "@/lib/mature/materials";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

async function batchWithFiles(brew: Brew): Promise<string> {
  const dir = tapDir(brew.id, 1);
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true });
  await fs.writeFile(path.join(dir, "src", "App.tsx"), "export const App = 1;", "utf8");
  await fs.writeFile(path.join(dir, "index.html"), "<html></html>", "utf8");
  await fs.writeFile(path.join(dir, "node_modules", "pkg", "x.js"), "x", "utf8");
  await fs.writeFile(path.join(dir, "build.log"), "verify ok", "utf8");
  return dir;
}

describe("buildCodeDigest", () => {
  it("ツリーには対象ファイルを載せ、node_modules等は除外し、src配下の本文を含める", async () => {
    const brew = await createBrew("素材");
    const dir = await batchWithFiles(brew);

    const digest = await buildCodeDigest(dir);

    expect(digest).toContain("src/App.tsx");
    expect(digest).toContain("index.html");
    expect(digest).toContain("export const App = 1;");
    expect(digest).not.toContain("node_modules");
    expect(digest).not.toContain("build.log");
  });

  it("サイズ上限を超えたファイルは省略注記になる", async () => {
    const brew = await createBrew("素材上限");
    const dir = tapDir(brew.id, 1);
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "big.ts"), "a".repeat(70 * 1024), "utf8");

    const digest = await buildCodeDigest(dir);

    expect(digest).toContain("src/big.ts");
    expect(digest).toContain("(サイズ上限のため省略)");
    expect(digest.length).toBeLessThan(65 * 1024);
  });
});

describe("grillDump", () => {
  it("回答済みQ&Aを回答者付きで整形する", () => {
    const dump = grillDump([
      {
        id: "1",
        question: "Q?",
        options: [],
        answer: "A",
        answeredBy: "auto",
        askedAt: "2026-07-03T00:00:00.000Z",
      },
    ]);
    expect(dump).toContain("Q1: Q?");
    expect(dump).toContain("(自動): A");
  });
});

describe("collectMaterials", () => {
  it("ルーブリック欠落はエラー", async () => {
    const brew = await createBrew("素材欠落");
    await batchWithFiles(brew);
    await expect(collectMaterials(brew, 1)).rejects.toThrow(/06-evaluation-criteria/);
  });

  it("ルーブリック・コード・生成過程・前回評価を集める", async () => {
    const brew = await createBrew("素材一式");
    await batchWithFiles(brew);
    await fs.mkdir(recipeDir(brew.id), { recursive: true });
    await fs.writeFile(
      path.join(recipeDir(brew.id), "06-evaluation-criteria.md"),
      "# 自己評価基準\n観点X",
      "utf8",
    );
    const withEval: Brew = await writeBrew({
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: "2026-07-03T00:00:00.000Z",
          finishedAt: "2026-07-03T00:01:00.000Z",
          error: null,
          evaluation: {
            overall: 3,
            axes: [{ name: "観点X", score: 3, comment: "c" }],
            summary: "前回総評",
            improvements: ["改善1"],
            strategy: "repair",
            screenshotsUsed: false,
            evaluatedAt: "2026-07-03T00:02:00.000Z",
          },
        },
      ],
    });

    // バッチ2の素材収集: バッチ1の評価が「前回評価」として入る
    const dir2 = tapDir(withEval.id, 2);
    await fs.mkdir(path.join(dir2, "src"), { recursive: true });
    await fs.writeFile(path.join(dir2, "src", "App.tsx"), "v2", "utf8");

    const materials = await collectMaterials(withEval, 2);

    expect(materials.rubric).toContain("観点X");
    expect(materials.codeDigest).toContain("v2");
    expect(materials.process).toContain("グリルでの質疑応答");
    expect(materials.previousEvaluation?.summary).toBe("前回総評");
  });
});
```

Run: `npx vitest run tests/unit/mature-materials.test.ts`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 2: materials.ts を実装**

`src/lib/mature/materials.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { readRecipeFile } from "@/lib/recipe";
import { tapDir } from "@/lib/store";
import type { BatchEvaluation, Brew, GrillEntry } from "@/lib/store/types";

const DIGEST_LIMIT = 60 * 1024; // コードダイジェストの合計上限(バイトではなく文字数で近似)
const LOG_TAIL_CHARS = 4 * 1024;

const DIGEST_EXCLUDES = new Set([
  "node_modules",
  "dist",
  "docs",
  "screenshots",
  "build.log",
  "evaluation.md",
  "agent-log.txt",
  "package-lock.json",
]);

export interface EvaluationMaterials {
  rubric: string;
  codeDigest: string;
  process: string;
  previousEvaluation: BatchEvaluation | null;
}

async function listDigestFiles(batchDir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await fs.readdir(path.join(batchDir, rel), { withFileTypes: true });
    for (const entry of entries) {
      if (DIGEST_EXCLUDES.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(childRel);
      else results.push(childRel);
    }
  }
  await walk("");
  return results.sort();
}

export async function buildCodeDigest(batchDir: string): Promise<string> {
  const files = await listDigestFiles(batchDir);
  let remaining = DIGEST_LIMIT;
  const chunks: string[] = [];
  for (const rel of files) {
    if (!rel.startsWith("src/")) continue;
    const content = await fs.readFile(path.join(batchDir, rel), "utf8");
    const header = `\n===== ${rel} =====\n`;
    if (header.length + content.length > remaining) {
      chunks.push(`${header}(サイズ上限のため省略)`);
      continue;
    }
    remaining -= header.length + content.length;
    chunks.push(header + content);
  }
  return [
    "### ファイルツリー",
    files.join("\n") || "(なし)",
    "",
    "### ソースコード(src/ 配下)",
    chunks.join("\n") || "(なし)",
  ].join("\n");
}

export function grillDump(entries: GrillEntry[]): string {
  const answered = entries.filter((e) => e.answer);
  if (answered.length === 0) return "(質疑なし)";
  return answered
    .map(
      (e, i) =>
        `Q${i + 1}: ${e.question}\nA${i + 1}(${e.answeredBy === "auto" ? "自動" : "ユーザー"}): ${e.answer}`,
    )
    .join("\n");
}

async function readBuildLogTail(brewId: string, batch: number): Promise<string> {
  try {
    const raw = await fs.readFile(path.join(tapDir(brewId, batch), "build.log"), "utf8");
    return raw.slice(-LOG_TAIL_CHARS);
  } catch {
    return "(build.log なし)";
  }
}

export async function collectMaterials(brew: Brew, batch: number): Promise<EvaluationMaterials> {
  let rubric: string;
  try {
    rubric = await readRecipeFile(brew.id, "06-evaluation-criteria.md");
  } catch {
    throw new Error(
      "自己評価基準(06-evaluation-criteria.md)がありません。レシピを再生成してください。",
    );
  }

  const codeDigest = await buildCodeDigest(tapDir(brew.id, batch));

  const previous = [...brew.batches]
    .filter((b) => b.number < batch && b.evaluation !== null)
    .sort((a, b) => b.number - a.number)[0];

  const process = [
    "### グリルでの質疑応答",
    grillDump(brew.grill.entries),
    "",
    "### ビルドログ(末尾)",
    await readBuildLogTail(brew.id, batch),
  ].join("\n");

  return {
    rubric,
    codeDigest,
    process,
    previousEvaluation: previous?.evaluation ?? null,
  };
}
```

- [ ] **Step 3: テスト実行とコミット**

Run: `npx vitest run tests/unit/mature-materials.test.ts`
Expected: PASS

```powershell
git add -A; git commit -m "feat: 自己評価の素材収集(ルーブリック・コードダイジェスト・生成過程)を追加"
```

---

### Task 6: LLM 採点(evaluate.ts)とフェイク応答

**Files:**
- Create: `src/lib/mature/evaluate.ts`
- Modify: `src/lib/llm/fake-client.ts`
- Test: `tests/unit/mature-evaluate.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/mature-evaluate.test.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createFakeClient } from "@/lib/llm/fake-client";
import type { GenerateOptions, LlmClient } from "@/lib/llm/client";
import { createBrew, tapDir } from "@/lib/store";
import {
  evaluateBatch,
  renderEvaluationMarkdown,
  writeEvaluationReport,
} from "@/lib/mature/evaluate";
import type { EvaluationMaterials } from "@/lib/mature/materials";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const materials: EvaluationMaterials = {
  rubric: "# ルーブリック",
  codeDigest: "code",
  process: "process",
  previousEvaluation: null,
};

describe("evaluateBatch", () => {
  it("フェイクLLMで観点別スコアとoverallを得る", async () => {
    const client = createFakeClient();
    const ev = await evaluateBatch(client, materials, []);
    expect(ev.axes.length).toBeGreaterThan(0);
    expect(ev.overall).toBe(3); // フェイク1回目は全観点3点
    expect(ev.strategy).toBe("repair");
    expect(ev.screenshotsUsed).toBe(false);
    expect(ev.improvements.length).toBeGreaterThan(0);
  });

  it("画像付き呼び出しが失敗したら画像なしで再試行し screenshotsUsed=false", async () => {
    const inner = createFakeClient();
    let callCount = 0;
    const flaky: LlmClient = {
      async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
        callCount += 1;
        if (opts.images && opts.images.length > 0) throw new Error("vision非対応");
        return inner.generateObject(schema, opts);
      },
      generateText: (opts) => inner.generateText(opts),
    };

    const ev = await evaluateBatch(flaky, materials, [
      { data: Buffer.from("png"), mimeType: "image/png" },
    ]);

    expect(callCount).toBe(2);
    expect(ev.screenshotsUsed).toBe(false);
  });

  it("画像付きで成功したら screenshotsUsed=true", async () => {
    const client = createFakeClient();
    const ev = await evaluateBatch(client, materials, [
      { data: Buffer.from("png"), mimeType: "image/png" },
    ]);
    expect(ev.screenshotsUsed).toBe(true);
  });

  it("フェイクは2回目以降のスコアが上がる(autoループ用)", async () => {
    const client = createFakeClient();
    const first = await evaluateBatch(client, materials, []);
    const second = await evaluateBatch(client, materials, []);
    expect(first.overall).toBeLessThan(second.overall);
  });
});

describe("レポート出力", () => {
  it("evaluation.md を書き出す", async () => {
    const brew = await createBrew("レポート");
    await fs.mkdir(tapDir(brew.id, 1), { recursive: true });
    const client = createFakeClient();
    const ev = await evaluateBatch(client, materials, []);

    await writeEvaluationReport(brew.id, 1, ev);

    const text = await fs.readFile(path.join(tapDir(brew.id, 1), "evaluation.md"), "utf8");
    expect(text).toContain("バッチ1 自己評価レポート");
    expect(text).toContain("観点別スコア");
    expect(text).toContain("改善指示");
  });

  it("renderEvaluationMarkdown は採点表と改善指示を含む", () => {
    const md = renderEvaluationMarkdown(2, {
      overall: 4.5,
      axes: [{ name: "観点A", score: 5, comment: "良い" }],
      summary: "総評",
      improvements: ["直す"],
      strategy: "rebuild",
      screenshotsUsed: true,
      evaluatedAt: "2026-07-03T00:00:00.000Z",
    });
    expect(md).toContain("バッチ2 自己評価レポート");
    expect(md).toContain("4.5 / 5.0");
    expect(md).toContain("| 観点A | 5 | 良い |");
    expect(md).toContain("1. 直す");
    expect(md).toContain("rebuild");
  });
});
```

Run: `npx vitest run tests/unit/mature-evaluate.test.ts`
Expected: FAIL

- [ ] **Step 2: フェイククライアントに evaluate タグを追加**

`src/lib/llm/fake-client.ts` の `createFakeClient` 内、`let grillCount = 0;` の下に `let evaluateCount = 0;` を追加し、`fakeObjectFor` の `grill-apply` 分岐の後に追加:

```ts
    if (tag === "evaluate") {
      evaluateCount += 1;
      const score = evaluateCount === 1 ? 3 : 5; // 2回目以降は改善済みとして高評価(autoループの停止テスト用)
      return {
        axes: [
          { name: "機能完成度", score, comment: `フェイク講評(${evaluateCount}回目)` },
          { name: "UI/UX", score, comment: `フェイク講評(${evaluateCount}回目)` },
        ],
        summary: `フェイク総評(${evaluateCount}回目)`,
        improvements: ["見出しの階層を整理する", "主要ボタンのコントラストを上げる"],
        strategy: "repair",
      };
    }
```

- [ ] **Step 3: evaluate.ts を実装**

`src/lib/mature/evaluate.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GenerateOptions, LlmClient, LlmImage } from "@/lib/llm/client";
import { tapDir } from "@/lib/store";
import type { BatchEvaluation } from "@/lib/store/types";
import type { EvaluationMaterials } from "./materials";

const evaluationSchema = z.object({
  axes: z
    .array(
      z.object({
        name: z.string().min(1),
        score: z.number().int().min(1).max(5),
        comment: z.string(),
      }),
    )
    .min(1),
  summary: z.string().min(1),
  improvements: z.array(z.string().min(1)).min(1).max(10),
  strategy: z.enum(["repair", "rebuild"]),
});

const EVALUATE_SYSTEM = [
  "あなたは idea brewing の熟成職人です。生成された Web サービスをルーブリックに沿って厳密に自己評価します。",
  "ルーブリックの観点ごとに1〜5点で採点し、根拠を簡潔な講評として書きます。",
  "スクリーンショットが与えられた場合、UI/UX の観点は実画面を根拠に採点します。",
  "生成過程(グリルの質疑応答・ビルドログ)から、要求とのズレや不安定な工程も指摘します。",
  "improvements は後続のコーディングエージェントがそのまま実行できる具体的な指示にします(5〜10個)。",
  "軽微な修正で改善できるなら strategy は repair、構造的な作り直しが必要なら rebuild を選びます。",
].join("\n");

export function buildEvaluatePrompt(materials: EvaluationMaterials): string {
  const sections = [
    "## 採点ルーブリック",
    materials.rubric,
    "## 生成されたコード",
    materials.codeDigest,
    "## 生成過程",
    materials.process,
  ];
  if (materials.previousEvaluation) {
    sections.push(
      "## 前回の評価(改善指示が反映されたかも確認すること)",
      JSON.stringify(materials.previousEvaluation, null, 2),
    );
  }
  return sections.join("\n\n");
}

export async function evaluateBatch(
  client: LlmClient,
  materials: EvaluationMaterials,
  screenshots: LlmImage[],
): Promise<BatchEvaluation> {
  const opts: GenerateOptions = {
    tag: "evaluate",
    system: EVALUATE_SYSTEM,
    prompt: buildEvaluatePrompt(materials),
  };

  let raw: z.infer<typeof evaluationSchema> | null = null;
  let screenshotsUsed = screenshots.length > 0;
  if (screenshotsUsed) {
    try {
      raw = await client.generateObject(evaluationSchema, { ...opts, images: screenshots });
    } catch {
      screenshotsUsed = false; // vision 非対応モデルの可能性。画像なしで1回だけ再試行する
    }
  }
  if (!raw) raw = await client.generateObject(evaluationSchema, opts);

  const overall =
    Math.round((raw.axes.reduce((sum, a) => sum + a.score, 0) / raw.axes.length) * 10) / 10;
  return {
    overall,
    axes: raw.axes,
    summary: raw.summary,
    improvements: raw.improvements,
    strategy: raw.strategy,
    screenshotsUsed,
    evaluatedAt: new Date().toISOString(),
  };
}

export function renderEvaluationMarkdown(batch: number, ev: BatchEvaluation): string {
  return [
    `# バッチ${batch} 自己評価レポート`,
    "",
    `- 総合スコア: ${ev.overall.toFixed(1)} / 5.0`,
    `- 評価日時: ${ev.evaluatedAt}`,
    `- スクリーンショット: ${ev.screenshotsUsed ? "採点に使用" : "なしで評価"}`,
    `- 次バッチ戦略: ${ev.strategy}`,
    "",
    "## 観点別スコア",
    "",
    "| 観点 | スコア | 講評 |",
    "|---|---|---|",
    ...ev.axes.map((a) => `| ${a.name} | ${a.score} | ${a.comment} |`),
    "",
    "## 総評",
    "",
    ev.summary,
    "",
    "## 改善指示",
    "",
    ...ev.improvements.map((s, i) => `${i + 1}. ${s}`),
    "",
  ].join("\n");
}

export async function writeEvaluationReport(
  brewId: string,
  batch: number,
  ev: BatchEvaluation,
): Promise<void> {
  await fs.writeFile(
    path.join(tapDir(brewId, batch), "evaluation.md"),
    renderEvaluationMarkdown(batch, ev),
    "utf8",
  );
}
```

- [ ] **Step 4: テスト実行とコミット**

Run: `npx vitest run tests/unit/mature-evaluate.test.ts`
Expected: PASS(既存の fake-client を使うテストも回帰確認: `npx vitest run tests/unit`)

```powershell
git add -A; git commit -m "feat: ルーブリックに沿ったLLM採点とevaluation.mdレポート出力を追加"
```

---

### Task 7: 熟成オーケストレータ(評価 / 次バッチ / auto ループ)

**Files:**
- Create: `src/lib/mature/mature-state.ts`
- Create: `src/lib/mature/index.ts`
- Create: `src/lib/mature/resolve.ts`
- Test: `tests/unit/mature.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/mature.test.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeClient } from "@/lib/llm/fake-client";
import {
  normalizeStaleMaturation,
  runAutoMaturation,
  runEvaluate,
  runNextBatch,
  type MatureDeps,
} from "@/lib/mature";
import { createBrew, recipeDir, tapDir, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { createFakeBuildEngine } from "@/lib/tap/fake-engine";
import type { CommandRunner } from "@/lib/tap/runner";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const okRunner: CommandRunner = {
  async run() {
    return { ok: true, output: "" };
  },
};

async function builtBrew(): Promise<Brew> {
  const brew = await createBrew("熟成");
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

function deps(overrides?: Partial<MatureDeps>): MatureDeps {
  return {
    client: createFakeClient(),
    capture: async () => [],
    engine: createFakeBuildEngine(),
    runner: okRunner,
    template: "tap-fake",
    ...overrides,
  };
}

describe("runEvaluate", () => {
  it("最新成功バッチを評価してevaluationとレポートを保存する", async () => {
    const brew = await builtBrew();
    const done = await runEvaluate(brew, deps());
    expect(done.batches[0].evaluation?.overall).toBe(3);
    expect(done.maturationProgress).toBeNull();
    expect(existsSync(path.join(tapDir(brew.id, 1), "evaluation.md"))).toBe(true);
  });

  it("成功バッチがなければエラー", async () => {
    const brew = await createBrew("未ビルド");
    await expect(runEvaluate(brew, deps())).rejects.toThrow(/成功したバッチ/);
  });

  it("エラー時はonProgressで進捗をクリアして再throwする", async () => {
    const brew = await builtBrew();
    // ルーブリックを消して素材収集を失敗させる
    await fs.rm(path.join(recipeDir(brew.id), "06-evaluation-criteria.md"));
    const progress: Brew[] = [];
    await expect(
      runEvaluate(brew, deps({ onProgress: (b) => void progress.push(b) })),
    ).rejects.toThrow(/06-evaluation-criteria/);
    expect(progress[progress.length - 1].maturationProgress).toBeNull();
  });

  it("キャンセル済みなら評価を保存せず進捗なしで返す", async () => {
    const brew = await builtBrew();
    const done = await runEvaluate(brew, deps({ cancel: { cancelled: true } }));
    expect(done.batches[0].evaluation).toBeNull();
    expect(done.maturationProgress).toBeNull();
  });
});

describe("runNextBatch", () => {
  it("評価済みバッチからrepairで次バッチを作る", async () => {
    const brew = await builtBrew();
    const evaluated = await runEvaluate(brew, deps());
    const done = await runNextBatch(evaluated, deps());
    expect(done.batches.map((b) => b.number)).toEqual([1, 2]);
    expect(done.batches[1].status).toBe("succeeded");
    expect(done.maturationProgress).toBeNull();
    // repair: 前バッチのコードが引き継がれている
    expect(existsSync(path.join(tapDir(brew.id, 2), "src", "App.tsx"))).toBe(true);
  });

  it("未評価ならエラー", async () => {
    const brew = await builtBrew();
    await expect(runNextBatch(brew, deps())).rejects.toThrow(/評価/);
  });

  it("ネストされたビルド進捗はmaturationProgressに載る", async () => {
    const brew = await builtBrew();
    const evaluated = await runEvaluate(brew, deps());
    const progress: Brew[] = [];
    await runNextBatch(evaluated, deps({ onProgress: (b) => void progress.push(b) }));
    const building = progress.filter((b) => b.maturationProgress?.phase === "building");
    expect(building.length).toBeGreaterThan(0);
    expect(building.every((b) => b.buildProgress === null)).toBe(true);
  });
});

describe("runAutoMaturation", () => {
  it("目標達成で停止する(フェイクは2回目の評価で5.0)", async () => {
    const brew = await builtBrew();
    const done = await runAutoMaturation(brew, deps(), { targetScore: 4, maxBatches: 5 });
    // バッチ1評価(3.0) → バッチ2生成 → バッチ2評価(5.0) → 目標達成で停止
    expect(done.batches).toHaveLength(2);
    expect(done.batches[1].evaluation?.overall).toBe(5);
    expect(done.maturationProgress).toBeNull();
  });

  it("上限バッチ数で停止する", async () => {
    const brew = await builtBrew();
    const done = await runAutoMaturation(brew, deps(), { targetScore: 6, maxBatches: 1 });
    // targetScore 6 は到達不能だが maxBatches=1 で次バッチを作らない
    expect(done.batches).toHaveLength(1);
    expect(done.batches[0].evaluation).not.toBeNull();
  });

  it("次バッチのビルド失敗で停止する", async () => {
    const brew = await builtBrew();
    const done = await runAutoMaturation(
      brew,
      deps({ engine: createFakeBuildEngine({ failSends: 10 }) }),
      { targetScore: 6, maxBatches: 5 },
    );
    expect(done.batches).toHaveLength(2);
    expect(done.batches[1].status).toBe("failed");
    expect(done.maturationProgress).toBeNull();
  });

  it("キャンセルで停止する", async () => {
    const brew = await builtBrew();
    const cancel = { cancelled: false };
    const done = await runAutoMaturation(
      brew,
      deps({
        cancel,
        onProgress: (b) => {
          // 次バッチのビルドが始まったら中断を要求する
          if (b.maturationProgress?.phase === "building") cancel.cancelled = true;
        },
      }),
      { targetScore: 6, maxBatches: 5 },
    );
    expect(done.maturationProgress).toBeNull();
    // バッチ2は中断で確定し、ループが停止している
    const batch2 = done.batches.find((b) => b.number === 2);
    expect(batch2?.status).toBe("cancelled");
  });
});

describe("normalizeStaleMaturation", () => {
  it("残留progressをnullに補正し、なければ同一参照を返す", async () => {
    const brew = await builtBrew();
    expect(normalizeStaleMaturation(brew)).toBe(brew);
    const stale: Brew = {
      ...brew,
      maturationProgress: { phase: "evaluating", detail: "x", batch: 1 },
    };
    expect(normalizeStaleMaturation(stale).maturationProgress).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/mature.test.ts`
Expected: FAIL(`@/lib/mature` が存在しない)

- [ ] **Step 2: mature-state.ts を実装**

`src/lib/mature/mature-state.ts` を新規作成:

```ts
import type { CancelToken } from "@/lib/tap/build-state";
import { buildingBrews } from "@/lib/tap/build-state";

// 熟成実行中のブリューID(ビルド工程と同じインメモリロック方式)
export const maturingBrews = new Set<string>();

// 熟成中断用トークン(mature系ルートが登録し、cancelルートが立てる)
export const matureCancelTokens = new Map<string, CancelToken>();

/** ビルド・熟成いずれかが実行中か(相互排他の判定に使う) */
export function isBrewBusy(brewId: string): boolean {
  return buildingBrews.has(brewId) || maturingBrews.has(brewId);
}
```

- [ ] **Step 3: mature/index.ts を実装**

`src/lib/mature/index.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import type { LlmClient, LlmImage } from "@/lib/llm/client";
import type { Brew, BuildPhase, MaturationPhase } from "@/lib/store/types";
import { runBuild } from "@/lib/tap";
import { latestSucceededBatch, maxBatchNumber, upsertBatch } from "@/lib/tap/batches";
import type { CancelToken } from "@/lib/tap/build-state";
import type { BuildEngine } from "@/lib/tap/engine";
import type { CommandRunner } from "@/lib/tap/runner";
import type { TemplateId } from "@/lib/tap/template";
import { evaluateBatch, writeEvaluationReport } from "./evaluate";
import { collectMaterials } from "./materials";

export interface EvaluateDeps {
  client: LlmClient;
  /** スクリーンショットを撮って保存パスを返す。失敗時は空配列(例外を投げない契約) */
  capture: (brewId: string, batch: number) => Promise<string[]>;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

export interface NextBatchDeps {
  engine: BuildEngine;
  runner: CommandRunner;
  template: TemplateId;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

export type MatureDeps = EvaluateDeps & NextBatchDeps;

export interface AutoOptions {
  targetScore: number; // 1〜5
  maxBatches: number; // 累計バッチ数の上限
}

const BUILD_PHASE_LABELS: Record<BuildPhase, string> = {
  preparing: "準備",
  generating: "生成",
  verifying: "検証",
  repairing: "修理",
};

function withMaturation(brew: Brew, phase: MaturationPhase, detail: string, batch: number): Brew {
  return { ...brew, maturationProgress: { phase, detail, batch } };
}

/** クラッシュで残った maturationProgress を消す。補正不要なら同一参照を返す */
export function normalizeStaleMaturation(brew: Brew): Brew {
  if (brew.maturationProgress === null) return brew;
  return { ...brew, maturationProgress: null };
}

async function loadImages(paths: string[]): Promise<LlmImage[]> {
  const images: LlmImage[] = [];
  for (const p of paths) {
    try {
      images.push({ data: await fs.readFile(p), mimeType: "image/png" });
    } catch {
      // 読めないスクリーンショットは採点対象から外す
    }
  }
  return images;
}

/** 最新成功バッチを評価し、evaluation と evaluation.md を保存した Brew を返す */
export async function runEvaluate(brew: Brew, deps: EvaluateDeps): Promise<Brew> {
  const target = latestSucceededBatch(brew);
  if (!target) throw new Error("成功したバッチがありません。先にビルドを完了してください。");

  let current = withMaturation(brew, "screenshotting", "実画面を撮影しています", target.number);
  try {
    await deps.onProgress?.(current);
    const shots = deps.cancel?.cancelled ? [] : await deps.capture(brew.id, target.number);
    if (deps.cancel?.cancelled) return { ...current, maturationProgress: null };

    current = withMaturation(current, "evaluating", "ルーブリックに沿って採点しています", target.number);
    await deps.onProgress?.(current);
    const materials = await collectMaterials(current, target.number);
    const images = await loadImages(shots);
    const evaluation = await evaluateBatch(deps.client, materials, images);
    if (deps.cancel?.cancelled) return { ...current, maturationProgress: null };

    await writeEvaluationReport(brew.id, target.number, evaluation);
    return {
      ...current,
      batches: upsertBatch(current.batches, { ...target, evaluation }),
      maturationProgress: null,
    };
  } catch (err) {
    await deps.onProgress?.({ ...current, maturationProgress: null });
    throw err;
  }
}

/** 最新成功バッチの評価から次バッチを生成する */
export async function runNextBatch(brew: Brew, deps: NextBatchDeps): Promise<Brew> {
  const base = latestSucceededBatch(brew);
  if (!base?.evaluation) {
    throw new Error("最新の成功バッチがまだ評価されていません。先に評価を実行してください。");
  }
  const nextNumber = maxBatchNumber(brew) + 1;
  const { strategy, improvements } = base.evaluation;

  let current = withMaturation(
    brew,
    "planning",
    `バッチ${nextNumber} を${strategy === "repair" ? "修正" : "再ビルド"}方式で準備しています`,
    nextNumber,
  );
  try {
    await deps.onProgress?.(current);
    if (deps.cancel?.cancelled) return { ...current, maturationProgress: null };

    const done = await runBuild(current, {
      engine: deps.engine,
      runner: deps.runner,
      template: deps.template,
      batch: nextNumber,
      mode: { kind: "improve", strategy, fromBatch: base.number, instructions: improvements },
      cancel: deps.cancel,
      onProgress: async (b) => {
        // ネストされたビルドの進捗は maturationProgress に載せ替える(ロック判定の一本化)
        const detail = b.buildProgress
          ? `${BUILD_PHASE_LABELS[b.buildProgress.phase]}: ${b.buildProgress.detail}`
          : "ビルド中";
        await deps.onProgress?.({
          ...b,
          buildProgress: null,
          maturationProgress: { phase: "building", detail, batch: nextNumber },
        });
      },
    });
    return { ...done, buildProgress: null, maturationProgress: null };
  } catch (err) {
    await deps.onProgress?.({ ...current, maturationProgress: null });
    throw err;
  }
}

/** 評価→次バッチ→評価…を停止条件(目標達成/上限/失敗/中断)まで自動で回す */
export async function runAutoMaturation(
  brew: Brew,
  deps: MatureDeps,
  opts: AutoOptions,
): Promise<Brew> {
  let current = brew;
  for (;;) {
    if (deps.cancel?.cancelled) break;

    let latest = latestSucceededBatch(current);
    if (!latest) break;
    if (!latest.evaluation) {
      current = await runEvaluate(current, deps);
      latest = latestSucceededBatch(current);
      if (!latest?.evaluation) break; // 中断などで評価が確定しなかった
    }
    if (latest.evaluation.overall >= opts.targetScore) break; // 目標達成
    if (maxBatchNumber(current) >= opts.maxBatches) break; // 上限到達
    if (deps.cancel?.cancelled) break;

    current = await runNextBatch(current, deps);
    const newest = current.batches.find((b) => b.number === maxBatchNumber(current));
    if (newest?.status !== "succeeded") break; // ビルド失敗・中断
  }
  return { ...current, maturationProgress: null };
}
```

- [ ] **Step 4: resolve.ts を実装**

`src/lib/mature/resolve.ts` を新規作成:

```ts
import { getConfiguredClient } from "@/lib/llm";
import { readSettings } from "@/lib/store";
import type { Settings } from "@/lib/store/types";
import { resolveEngine } from "@/lib/tap/resolve";
import { realRunner } from "@/lib/tap/runner";
import { startServer, stopServer } from "@/lib/tap/server-manager";
import type { EvaluateDeps, NextBatchDeps } from "./index";
import { captureScreenshots, launchChromium } from "./screenshot";

function isFakeMode(settings: Settings): boolean {
  return settings.provider === "fake" || process.env.IDEA_BREWING_FAKE_BUILD === "1";
}

/** 評価用deps。フェイク構成ではスクリーンショット工程をスキップする */
export async function resolveEvaluateDeps(): Promise<Pick<EvaluateDeps, "client" | "capture">> {
  const settings = await readSettings();
  const client = await getConfiguredClient();
  const capture = isFakeMode(settings)
    ? async () => [] as string[]
    : (brewId: string, batch: number) =>
        captureScreenshots(brewId, batch, { startServer, stopServer, launch: launchChromium });
  return { client, capture };
}

/** 次バッチ生成用deps。Cursor未設定時は TapNotConfiguredError を投げる */
export async function resolveNextBatchDeps(): Promise<
  Pick<NextBatchDeps, "engine" | "runner" | "template">
> {
  const settings = await readSettings();
  const { engine, template } = await resolveEngine(settings);
  return { engine, runner: realRunner, template };
}
```

- [ ] **Step 5: テスト実行とコミット**

Run: `npx vitest run tests/unit/mature.test.ts`
Expected: PASS

Run: `npm test` → 全 PASS、`npx tsc --noEmit` → エラーなし

```powershell
git add -A; git commit -m "feat: 熟成オーケストレータ(評価/次バッチ/autoループ)を追加"
```

---

### Task 8: 熟成 API ルートと相互ロック

**Files:**
- Create: `src/app/api/brews/[id]/mature/evaluate/route.ts`
- Create: `src/app/api/brews/[id]/mature/next/route.ts`
- Create: `src/app/api/brews/[id]/mature/auto/route.ts`
- Create: `src/app/api/brews/[id]/mature/cancel/route.ts`
- Create: `src/app/api/brews/[id]/mature/report/route.ts`
- Create: `src/app/api/brews/[id]/mature/screenshot/route.ts`
- Modify: `src/app/api/brews/[id]/tap/build/route.ts`(相互ロック)
- Modify: `src/app/api/brews/[id]/tap/server/route.ts`(熟成中の start 409)
- Test: `tests/unit/api-mature-routes.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/api-mature-routes.test.ts` を新規作成。既存 `tests/unit/api-tap-routes.test.ts` と同じセットアップ流儀(tmp データディレクトリ + フェイク設定 + `CURSOR_API_KEY` 退避)に従う:

```ts
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
```

Run: `npx vitest run tests/unit/api-mature-routes.test.ts`
Expected: FAIL(ルートが存在しない)

- [ ] **Step 2: evaluate ルートを実装**

`src/app/api/brews/[id]/mature/evaluate/route.ts` を新規作成:

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation, runEvaluate } from "@/lib/mature";
import { isBrewBusy, matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveEvaluateDeps } from "@/lib/mature/resolve";
import { readRecipeFile } from "@/lib/recipe";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  maturingBrews.add(id);
  const token = { cancelled: false };
  matureCancelTokens.set(id, token);

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    if (!latestSucceededBatch(brew)) {
      return NextResponse.json({ error: "成功したバッチがありません。" }, { status: 400 });
    }
    try {
      await readRecipeFile(id, "06-evaluation-criteria.md");
    } catch {
      return NextResponse.json(
        { error: "自己評価基準(06-evaluation-criteria.md)がありません。レシピを再生成してください。" },
        { status: 400 },
      );
    }

    const deps = await resolveEvaluateDeps();
    const done = await runEvaluate(normalizeStaleMaturation(brew), {
      ...deps,
      cancel: token,
      onProgress: async (b) => {
        await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
      },
    });
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    maturingBrews.delete(id);
    matureCancelTokens.delete(id);
  }
}
```

- [ ] **Step 3: next ルートを実装**

`src/app/api/brews/[id]/mature/next/route.ts` を新規作成:

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation, runNextBatch } from "@/lib/mature";
import { isBrewBusy, matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveNextBatchDeps } from "@/lib/mature/resolve";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { TapNotConfiguredError } from "@/lib/tap/resolve";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  maturingBrews.add(id);
  const token = { cancelled: false };
  matureCancelTokens.set(id, token);

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    if (!latestSucceededBatch(brew)?.evaluation) {
      return NextResponse.json(
        { error: "最新の成功バッチがまだ評価されていません。先に評価を実行してください。" },
        { status: 400 },
      );
    }

    let deps: Awaited<ReturnType<typeof resolveNextBatchDeps>>;
    try {
      deps = await resolveNextBatchDeps();
    } catch (err) {
      if (err instanceof TapNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const done = await runNextBatch(normalizeStaleMaturation(brew), {
      ...deps,
      cancel: token,
      onProgress: async (b) => {
        await writeBrew(b);
      },
    });
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    maturingBrews.delete(id);
    matureCancelTokens.delete(id);
  }
}
```

- [ ] **Step 4: auto ルートを実装**

`src/app/api/brews/[id]/mature/auto/route.ts` を新規作成:

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation, runAutoMaturation } from "@/lib/mature";
import { isBrewBusy, matureCancelTokens, maturingBrews } from "@/lib/mature/mature-state";
import { resolveEvaluateDeps, resolveNextBatchDeps } from "@/lib/mature/resolve";
import { readRecipeFile } from "@/lib/recipe";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";
import { TapNotConfiguredError } from "@/lib/tap/resolve";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  maturingBrews.add(id);
  const token = { cancelled: false };
  matureCancelTokens.set(id, token);

  try {
    let body: { targetScore?: unknown; maxBatches?: unknown } | null = null;
    try {
      body = (await req.json()) as { targetScore?: unknown; maxBatches?: unknown } | null;
    } catch {
      // ボディなしはデフォルト値で実行する
    }
    const targetScore = body?.targetScore ?? 4;
    const maxBatches = body?.maxBatches ?? 3;
    if (typeof targetScore !== "number" || Number.isNaN(targetScore) || targetScore < 1 || targetScore > 5) {
      return NextResponse.json(
        { error: "targetScore は1〜5の数値で指定してください。" },
        { status: 400 },
      );
    }
    if (typeof maxBatches !== "number" || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10) {
      return NextResponse.json(
        { error: "maxBatches は1〜10の整数で指定してください。" },
        { status: 400 },
      );
    }

    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }
    if (!latestSucceededBatch(brew)) {
      return NextResponse.json({ error: "成功したバッチがありません。" }, { status: 400 });
    }
    try {
      await readRecipeFile(id, "06-evaluation-criteria.md");
    } catch {
      return NextResponse.json(
        { error: "自己評価基準(06-evaluation-criteria.md)がありません。レシピを再生成してください。" },
        { status: 400 },
      );
    }

    let nextDeps: Awaited<ReturnType<typeof resolveNextBatchDeps>>;
    try {
      nextDeps = await resolveNextBatchDeps();
    } catch (err) {
      if (err instanceof TapNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    const evalDeps = await resolveEvaluateDeps();

    const done = await runAutoMaturation(
      normalizeStaleMaturation(brew),
      {
        ...evalDeps,
        ...nextDeps,
        cancel: token,
        onProgress: async (b) => {
          await writeBrew(b);
        },
      },
      { targetScore, maxBatches },
    );
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    maturingBrews.delete(id);
    matureCancelTokens.delete(id);
  }
}
```

- [ ] **Step 5: cancel ルートを実装**

`src/app/api/brews/[id]/mature/cancel/route.ts` を新規作成:

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation } from "@/lib/mature";
import { matureCancelTokens } from "@/lib/mature/mature-state";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = matureCancelTokens.get(id);
  if (token) {
    token.cancelled = true;
    return NextResponse.json({ ok: true });
  }

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    // クラッシュで maturationProgress が残留した場合の復旧経路。
    const normalized = normalizeStaleMaturation(brew);
    if (normalized !== brew) {
      return NextResponse.json(await writeBrew(normalized));
    }

    return NextResponse.json({ error: "熟成は実行されていません。" }, { status: 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: report / screenshot ルートを実装**

`src/app/api/brews/[id]/mature/report/route.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { SCREENSHOT_FILES } from "@/lib/mature/screenshot";
import { readBrew, tapDir } from "@/lib/store";
import type { Brew } from "@/lib/store/types";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    const batch = Number(new URL(req.url).searchParams.get("batch"));
    if (!Number.isInteger(batch) || batch < 1) {
      return NextResponse.json(
        { error: "batch は1以上の整数で指定してください。" },
        { status: 400 },
      );
    }
    const record = brew.batches.find((b) => b.number === batch);
    if (!record) {
      return NextResponse.json({ error: "バッチが見つかりません。" }, { status: 404 });
    }

    const markdown = await fs
      .readFile(path.join(tapDir(id, batch), "evaluation.md"), "utf8")
      .catch(() => null);
    const screenshots: string[] = [];
    for (const name of SCREENSHOT_FILES) {
      try {
        await fs.access(path.join(tapDir(id, batch), "screenshots", name));
        screenshots.push(name);
      } catch {
        // 存在しないスクリーンショットは一覧に含めない
      }
    }
    return NextResponse.json({ markdown, evaluation: record.evaluation, screenshots });
  } catch (err) {
    return errorResponse(err);
  }
}
```

`src/app/api/brews/[id]/mature/screenshot/route.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { SCREENSHOT_FILES } from "@/lib/mature/screenshot";
import { readBrew, tapDir } from "@/lib/store";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    try {
      await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }

    const url = new URL(req.url);
    const batch = Number(url.searchParams.get("batch"));
    const name = url.searchParams.get("name") ?? "";
    if (!Number.isInteger(batch) || batch < 1) {
      return NextResponse.json(
        { error: "batch は1以上の整数で指定してください。" },
        { status: 400 },
      );
    }
    if (!(SCREENSHOT_FILES as readonly string[]).includes(name)) {
      return NextResponse.json({ error: "不正なファイル名です。" }, { status: 400 });
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(path.join(tapDir(id, batch), "screenshots", name));
    } catch {
      return NextResponse.json({ error: "スクリーンショットが見つかりません。" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "content-type": "image/png" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 7: 相互ロックを既存ルートに追加**

`src/app/api/brews/[id]/tap/build/route.ts`:

```ts
import { isBrewBusy } from "@/lib/mature/mature-state";
```

を import に追加し、冒頭のガードを差し替え:

```ts
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
```

`src/app/api/brews/[id]/tap/server/route.ts` の import に追加:

```ts
import { maturingBrews } from "@/lib/mature/mature-state";
```

POST の `start` 分岐の先頭にガードを追加:

```ts
    if (action === "start") {
      if (maturingBrews.has(id)) {
        return NextResponse.json(
          { error: "熟成中はサーバーを起動できません。" },
          { status: 409 },
        );
      }
      const target = latestSucceededBatch(brew);
```

- [ ] **Step 8: テスト実行とコミット**

Run: `npx vitest run tests/unit/api-mature-routes.test.ts tests/unit/api-tap-routes.test.ts`
Expected: 全 PASS

Run: `npm test` → 全 PASS、`npx tsc --noEmit` → エラーなし

```powershell
git add -A; git commit -m "feat: 熟成APIルート一式とビルド/熟成の相互ロックを追加"
```

---

### Task 9: UI(熟成タブ・ワークベンチ・タンクカード・タップ)

**Files:**
- Create: `src/components/mature-panel.tsx`
- Modify: `src/components/brew-workbench.tsx`
- Modify: `src/components/tank-card.tsx`
- Modify: `src/components/tap-panel.tsx`

- [ ] **Step 1: MaturePanel を作成**

`src/components/mature-panel.tsx` を新規作成:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { BatchEvaluation, BatchStatus, Brew, MaturationPhase } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";

const STATUS_LABELS: Record<BatchStatus, string> = {
  building: "ビルド中",
  succeeded: "成功",
  failed: "失敗",
  cancelled: "中断",
};

const PHASE_LABELS: Record<MaturationPhase, string> = {
  screenshotting: "撮影",
  evaluating: "採点",
  planning: "準備",
  building: "ビルド",
};

type Report = {
  markdown: string | null;
  evaluation: BatchEvaluation | null;
  screenshots: string[];
};

type ErrorBody = { error?: string };

export function MaturePanel({
  brew,
  onUpdate,
  refresh,
  onBusyChange,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
  refresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [targetScore, setTargetScore] = useState("4.0");
  const [maxBatches, setMaxBatches] = useState("3");

  const latest = latestSucceededBatch(brew);
  const running = brew.maturationProgress !== null;
  const working = busy || running;

  const fetchReport = useCallback(
    async (batch: number) => {
      try {
        const res = await fetch(`/api/brews/${brew.id}/mature/report?batch=${batch}`);
        if (res.ok) setReport((await res.json()) as Report);
      } catch {
        // 表示用の取得失敗は無視する
      }
    },
    [brew.id],
  );

  // 初期表示: 評価済みの最新成功バッチを選択する
  useEffect(() => {
    if (selected !== null) return;
    if (latest?.evaluation) {
      setSelected(latest.number);
      void fetchReport(latest.number);
    }
  }, [selected, latest, fetchReport]);

  // リモートで熟成が進行中でもポーリングして追従する
  useEffect(() => {
    if (!running || busy) return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [running, busy, refresh]);

  async function selectBatch(batch: number) {
    setSelected(batch);
    await fetchReport(batch);
  }

  async function post(pathSuffix: string, body?: unknown) {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    const timer = setInterval(() => void refresh(), 1000);
    try {
      const res = await fetch(`/api/brews/${brew.id}/mature/${pathSuffix}`, {
        method: "POST",
        ...(body !== undefined
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      clearInterval(timer);
      const json = (await res.json()) as Brew | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      onUpdate(json as Brew);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
      try {
        await refresh();
      } catch {
        // refreshが失敗してもbusy解除は必ず行う(タブが永久ロックされるのを防ぐ)
      }
      if (selected !== null) void fetchReport(selected);
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function cancelMaturation() {
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/mature/cancel`, { method: "POST" });
      const json = (await res.json()) as Brew | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      if ("schemaVersion" in json) onUpdate(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function startAuto() {
    const score = Number(targetScore);
    const max = Number(maxBatches);
    if (Number.isNaN(score) || score < 1 || score > 5) {
      setError("目標スコアは1〜5で指定してください。");
      return;
    }
    if (!Number.isInteger(max) || max < 1 || max > 10) {
      setError("上限バッチ数は1〜10の整数で指定してください。");
      return;
    }
    void post("auto", { targetScore: score, maxBatches: max });
  }

  const sorted = [...brew.batches].sort((a, b) => a.number - b.number);
  const evaluated = sorted.filter((b) => b.evaluation !== null);

  function trendFor(batchNumber: number): string | null {
    const idx = evaluated.findIndex((b) => b.number === batchNumber);
    if (idx <= 0) return null;
    const diff = evaluated[idx].evaluation!.overall - evaluated[idx - 1].evaluation!.overall;
    if (diff === 0) return "±0.0";
    return `${diff > 0 ? "+" : ""}${diff.toFixed(1)}`;
  }

  return (
    <section>
      <h2 className="text-lg font-bold text-amber-100">熟成(自己評価バッチループ)</h2>

      {brew.maturationProgress && (
        <p className="mt-2 text-amber-200" aria-live="polite">
          {PHASE_LABELS[brew.maturationProgress.phase]}(バッチ{brew.maturationProgress.batch}):{" "}
          {brew.maturationProgress.detail}
        </p>
      )}

      {/* バッチ一覧 */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {sorted.map((b) => (
          <button
            key={b.number}
            onClick={() => void selectBatch(b.number)}
            className={`rounded-lg border p-3 text-left ${
              selected === b.number
                ? "border-amber-400 bg-amber-900/40"
                : "border-amber-900/60 bg-black/20 hover:border-amber-600"
            }`}
          >
            <p className="font-bold text-amber-100">バッチ{b.number}</p>
            <p className="text-sm text-amber-300">{STATUS_LABELS[b.status]}</p>
            {b.evaluation ? (
              <p className="mt-1 text-amber-200">
                {b.evaluation.overall.toFixed(1)} / 5.0
                {trendFor(b.number) && (
                  <span className="ml-2 text-sm text-amber-400">{trendFor(b.number)}</span>
                )}
              </p>
            ) : (
              b.status === "succeeded" && <p className="mt-1 text-sm text-amber-200/60">未評価</p>
            )}
          </button>
        ))}
      </div>

      {/* 操作 */}
      {!working && latest && !latest.evaluation && (
        <button
          onClick={() => void post("evaluate")}
          className="mt-4 rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
        >
          このバッチを評価
        </button>
      )}

      {!working && latest?.evaluation && (
        <div className="mt-4 space-y-2">
          <button
            onClick={() => void post("next")}
            className="rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
          >
            改善して次のバッチへ(
            {latest.evaluation.strategy === "repair" ? "修正" : "再ビルド"}・指示
            {latest.evaluation.improvements.length}件)
          </button>
        </div>
      )}

      {!working && latest && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-amber-900/60 bg-black/20 p-4">
          <label className="text-sm text-amber-200">
            目標スコア
            <input
              value={targetScore}
              onChange={(e) => setTargetScore(e.target.value)}
              className="mt-1 block w-24 rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
            />
          </label>
          <label className="text-sm text-amber-200">
            上限バッチ数
            <input
              value={maxBatches}
              onChange={(e) => setMaxBatches(e.target.value)}
              className="mt-1 block w-24 rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
            />
          </label>
          <button
            onClick={startAuto}
            className="rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500"
          >
            自動で熟成
          </button>
        </div>
      )}

      {working && (
        <button
          onClick={() => void cancelMaturation()}
          className="mt-4 rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500"
        >
          中断
        </button>
      )}

      {error && (
        <p className="mt-3 text-red-400" aria-live="polite">
          {error}
        </p>
      )}

      {/* 評価レポート */}
      {selected !== null && report && (
        <div className="mt-6">
          <h3 className="font-bold text-amber-100">バッチ{selected} 評価レポート</h3>
          {report.screenshots.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-3">
              {report.screenshots.map((name) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={name}
                  src={`/api/brews/${brew.id}/mature/screenshot?batch=${selected}&name=${name}`}
                  alt={`バッチ${selected} ${name}`}
                  className="max-h-48 rounded border border-amber-900/60"
                />
              ))}
            </div>
          )}
          {report.markdown ? (
            <article className="prose prose-invert mt-4 max-w-none rounded-lg border border-amber-900/40 bg-black/20 p-6">
              <ReactMarkdown>{report.markdown}</ReactMarkdown>
            </article>
          ) : (
            <p className="mt-3 text-amber-200/60">このバッチはまだ評価されていません。</p>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: ワークベンチに熟成タブを追加**

`src/components/brew-workbench.tsx` を変更:

```tsx
import { MaturePanel } from "./mature-panel";

const TABS = [
  { id: "ingredients", label: "原料" },
  { id: "sheet", label: "ブリューシート" },
  { id: "grill", label: "グリル" },
  { id: "recipe", label: "レシピ" },
  { id: "tap", label: "タップ" },
  { id: "mature", label: "熟成" },
] as const;
```

初期タブと表示制御を差し替え:

```tsx
  const [tab, setTab] = useState<TabId>(
    initial.maturationProgress !== null
      ? "mature"
      : initial.buildProgress !== null
        ? "tap"
        : initial.sheet
          ? "sheet"
          : "ingredients",
  );
```

```tsx
  const enabled: Record<TabId, boolean> = {
    ingredients: true,
    sheet: brew.sheet !== null,
    grill: brew.sheet !== null,
    recipe: brew.grill.finished,
    tap: brew.recipeGeneratedAt !== null,
    mature: brew.batches.some((b) => b.status === "succeeded"),
  };
  const tabsBusy = busy || brew.buildProgress !== null || brew.maturationProgress !== null;
  const visibleTab: TabId =
    brew.maturationProgress !== null ? "mature" : brew.buildProgress !== null ? "tap" : tab;
```

パネル描画に追加(TapPanel の直後):

```tsx
        {visibleTab === "mature" && (
          <MaturePanel
            brew={brew}
            onUpdate={setBrew}
            refresh={refresh}
            onBusyChange={setBusy}
          />
        )}
```

- [ ] **Step 3: タンクカードにバッチ・スコア表示**

`src/components/tank-card.tsx` を差し替え:

```tsx
import Link from "next/link";
import type { Brew } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";

const STAGE_INFO: Record<Brew["stage"], { label: string; percent: number }> = {
  ingredients: { label: "原料投入中", percent: 20 },
  grilling: { label: "グリル中", percent: 55 },
  fermenting: { label: "発酵待ち", percent: 85 },
  done: { label: "レシピ完成", percent: 100 },
  built: { label: "提供中(ビルド済み)", percent: 100 },
};

function stageLabel(brew: Brew): string {
  if (brew.stage !== "built") return STAGE_INFO[brew.stage].label;
  const latest = latestSucceededBatch(brew);
  if (!latest) return STAGE_INFO.built.label;
  return latest.evaluation
    ? `提供中(バッチ${latest.number}・スコア${latest.evaluation.overall.toFixed(1)})`
    : `提供中(バッチ${latest.number})`;
}

export function TankCard({ brew }: { brew: Brew }) {
  const stage = STAGE_INFO[brew.stage];
  return (
    <Link
      href={`/brews/${brew.id}`}
      className="block rounded-xl border border-amber-900/60 bg-[var(--tank)] p-4 transition hover:border-amber-500"
    >
      <div className="relative h-40 overflow-hidden rounded-lg border border-amber-950 bg-black/40">
        <div
          className="absolute bottom-0 w-full bg-gradient-to-t from-amber-700 to-amber-500/80 transition-all"
          style={{ height: `${stage.percent}%` }}
        >
          <span className="bubble absolute bottom-2 left-1/4 h-2 w-2 rounded-full bg-amber-200/60" />
          <span className="bubble absolute bottom-4 left-2/3 h-1.5 w-1.5 rounded-full bg-amber-100/50 [animation-delay:0.8s]" />
          <span className="bubble absolute bottom-3 left-1/2 h-1 w-1 rounded-full bg-amber-100/40 [animation-delay:1.6s]" />
        </div>
      </div>
      <h2 className="mt-3 truncate font-bold text-amber-100">{brew.name}</h2>
      <p className="text-sm text-amber-400">{stageLabel(brew)}</p>
    </Link>
  );
}
```

- [ ] **Step 4: TapPanel をバッチ番号対応に**

`src/components/tap-panel.tsx` を変更:

import に追加:

```tsx
import { latestSucceededBatch } from "@/lib/tap/batches";
```

`ServerState` 型と対象バッチの導出を差し替え(`const batch = brew.batches[0] ?? null;` を置き換え):

```tsx
type ServerState = {
  running: boolean;
  port: number | null;
  batch: number | null;
};
```

```tsx
  const newest =
    brew.batches.length > 0
      ? brew.batches.reduce((a, b) => (b.number > a.number ? b : a))
      : null;
  const succeeded = latestSucceededBatch(brew);
```

`setServer` の初期値に `batch: null` を追加:

```tsx
  const [server, setServer] = useState<ServerState>({
    running: false,
    port: null,
    batch: null,
  });
```

JSX を次の方針で書き換える(構造は既存のまま、条件と文言だけ変更):

- 見出し: `タップ(1stバッチ)` → `タップ`
- ビルド開始ボタン: 条件を `!building && !newest`(従来どおり文言「ビルド開始(1stバッチ)」)
- 失敗表示 + 再ビルド: 条件を `!building && !succeeded && newest?.status === "failed"`
- 中断表示: 条件を `!building && !succeeded && newest?.status === "cancelled"`
- 成功表示: 条件を `!building && succeeded` にし、文言を差し替え:

```tsx
      {!building && succeeded && (
        <div className="mt-4 space-y-3">
          <p className="text-amber-200">
            バッチ{succeeded.number} 完成(
            {succeeded.finishedAt
              ? `${Math.round((Date.parse(succeeded.finishedAt) - Date.parse(succeeded.startedAt)) / 1000)}秒`
              : "-"}
            )
          </p>
          {server.running && server.port !== null ? (
            <div className="flex items-center gap-3">
              <a
                href={`http://localhost:${server.port}`}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-amber-300 underline"
              >
                http://localhost:{server.port}
              </a>
              {server.batch !== null && (
                <span className="text-sm text-amber-200/70">バッチ{server.batch} を提供中</span>
              )}
              <button
                onClick={() => serverAction("stop")}
                disabled={busy}
                className="rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500 disabled:opacity-50"
              >
                止める
              </button>
            </div>
          ) : (
            <button
              onClick={() => serverAction("start")}
              disabled={busy}
              className="rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500 disabled:opacity-50"
            >
              注ぐ(サーバー起動)
            </button>
          )}
        </div>
      )}
```

既存 JSX 内の `batch?.status` / `batch.error` / `batch.finishedAt` 参照はそれぞれ `newest` / `succeeded` ベースに置き換わることに注意(`batch` 変数は削除)。

- [ ] **Step 5: lint・型チェック・ビルド確認**

Run: `npx tsc --noEmit` → エラーなし
Run: `npm run lint` → エラーなし(`no-img-element` が出る場合は MaturePanel の該当行に disable コメントを付けたままにする)
Run: `npm run build` → 成功(Windows/OneDrive で EPERM が出る場合は `.next` を削除してリトライ)

- [ ] **Step 6: 手動スモーク(フェイク構成)**

```powershell
$env:IDEA_BREWING_FAKE_BUILD = "1"; npm run dev
```

ブラウザで確認: 設定をフェイクにしたブリューで 原料→仕込み→グリル→レシピ→タップ(ビルド・注ぐ)→熟成タブで「このバッチを評価」→スコア表示→「改善して次のバッチへ」→バッチ2が成功→タップで注ぐ。確認後サーバー停止、`$env:IDEA_BREWING_FAKE_BUILD = $null`。

- [ ] **Step 7: コミット**

```powershell
git add -A; git commit -m "feat: 熟成タブUIとバッチ番号表示(ワークベンチ/タンク/タップ)を追加"
```

---

### Task 10: E2E ハッピーパスの拡張

**Files:**
- Modify: `tests/e2e/happy-path.spec.ts`

- [ ] **Step 1: 既存アサーションの文言追従**

`tests/e2e/happy-path.spec.ts` を変更:

- `test.setTimeout(180_000);` → `test.setTimeout(240_000);`
- ステップ6の `await expect(page.getByText(/1stバッチ完成/)).toBeVisible({ timeout: 60_000 });` → `await expect(page.getByText(/バッチ1 完成/)).toBeVisible({ timeout: 60_000 });`

- [ ] **Step 2: 熟成ステップを追加**

ステップ8(止める)の後、`finally` の前に追加:

```ts
    // 9. 熟成: 評価(フェイクLLM・スクリーンショットはスキップされる)
    await page.getByRole("button", { name: "熟成", exact: true }).click();
    await page.getByRole("button", { name: "このバッチを評価", exact: true }).click();
    await expect(page.getByText("3.0 / 5.0").first()).toBeVisible({ timeout: 60_000 });
    expect(existsSync(path.join(brewsDir, brewId, "taps", "batch-1", "evaluation.md"))).toBe(true);

    // 10. 改善して次のバッチへ(repair)
    await page.getByRole("button", { name: /改善して次のバッチへ/ }).click();
    await expect(page.getByText("バッチ2", { exact: true })).toBeVisible({ timeout: 60_000 });
    expect(
      existsSync(
        path.join(brewsDir, brewId, "taps", "batch-2", "docs", "recipe", "07-improvement-notes.md"),
      ),
    ).toBe(true);

    // 11. タップに戻るとバッチ2が提供対象になっている
    await page.getByRole("button", { name: "タップ", exact: true }).click();
    await expect(page.getByText(/バッチ2 完成/)).toBeVisible({ timeout: 30_000 });
    tapServerStartRequested = true;
    await page.getByRole("button", { name: "注ぐ(サーバー起動)", exact: true }).click();
    const link2 = page.getByRole("link", { name: /^http:\/\/localhost:\d+$/ });
    await expect(link2).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "止める", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "注ぐ(サーバー起動)", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    tapServerStartRequested = false;
```

`finally` 内の tap/cancel 呼び出しの下に追加:

```ts
    if (brewId) {
      await page.request.post(`/api/brews/${brewId}/mature/cancel`).catch(() => undefined);
    }
```

注意: 「バッチ2」の exact テキストはバッチ一覧カードの見出し `<p>バッチ2</p>` にマッチする。もし他要素と衝突して strict mode violation になる場合は `page.getByText("バッチ2", { exact: true }).first()` を使う。

- [ ] **Step 3: E2E 実行**

Run: `npm run e2e`
Expected: PASS(初回はコンパイルで時間がかかる。失敗したら `npx playwright show-report` で該当ステップのスクリーンショットを確認して文言ズレを直す)

- [ ] **Step 4: コミット**

```powershell
git add -A; git commit -m "test: E2Eハッピーパスを熟成(評価→次バッチ→注ぐ)まで延長"
```

---

### Task 11: README 更新と最終検証

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README に熟成セクションを追加**

「タップ」セクションの後に追加(既存の文体・見出しレベルに合わせる):

```markdown
## 熟成(自己評価バッチループ)

ビルド成功済みのバッチを LLM が自己評価し、改善指示から次のバッチを生成できます。

1. ワークベンチの「熟成」タブを開く(成功バッチが1つ以上で有効)
2. 「このバッチを評価」— dev サーバーを一時起動して実画面を撮影(デスクトップ/モバイル)し、
   `06-evaluation-criteria.md` のルーブリックで観点別に採点します。
   結果は `data/brews/<ID>/taps/batch-<N>/evaluation.md` と `screenshots/` に保存されます。
3. 「改善して次のバッチへ」— 評価の改善指示から次バッチを生成します。
   LLM の判断で `repair`(前バッチをコピーして修正)か `rebuild`(テンプレートから再生成)が選ばれます。
   改善指示は次バッチの `docs/recipe/07-improvement-notes.md` に同梱されます。
4. 「自動で熟成」— 目標スコアと上限バッチ数を指定して、評価→改善→再評価を自動で回します。
   停止条件: 目標達成 / 上限到達 / ビルド失敗 / 中断。

補足:

- 評価は LLM プロバイダ設定(BYOK)を使います。vision 非対応モデルや Playwright の
  ブラウザ未導入環境ではスクリーンショットなしで評価が続行されます。
  撮影を有効にするには `npx playwright install chromium` を実行してください。
- 「注ぐ」は常に最新の成功バッチを配信します。
- フェイク構成(プロバイダ `fake` または `IDEA_BREWING_FAKE_BUILD=1`)では
  撮影をスキップし、決定論的な評価が返ります(動作確認用)。
```

- [ ] **Step 2: 最終検証(全部)**

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
npm run e2e
```

Expected: すべて成功。

- [ ] **Step 3: コミット**

```powershell
git add -A; git commit -m "docs: READMEに熟成(自己評価バッチループ)の使い方を追記"
```

---

## セルフレビュー結果(計画作成時に確認済み)

1. **スペックカバレッジ**: 設計書 §2(データモデル)→Task 1、§3.1(撮影)→Task 4、§3.2-3.3(素材・採点)→Task 5-6、§4(オーケストレータ)→Task 7、§5(API)→Task 8 + Task 3(log拡張)、§6(UI)→Task 9、§7(フェイク)→Task 6-7、§9(テスト)→各タスク + Task 10。runBuild 一般化と repair 準備(§3・§4.2)→Task 2。
2. **型整合**: `BuildMode.improve` は `{ kind, strategy, fromBatch, instructions }` で Task 2 定義・Task 7 使用が一致。`ServerStatus.batch` は Task 3 定義・Task 9 UI 使用が一致。`SCREENSHOT_FILES` は Task 4 定義・Task 8 ルート使用が一致。
3. **注意点**: Task 2 の検証ループ内 `res` 変数のスコープは実装時に TypeScript エラーが出たら `repairRes` に分離する(手順に記載済み)。
