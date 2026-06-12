# idea brewing 第1版(レシピ醸造)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テキスト・画像・URL・ファイルを原料に、仕込み(LLMによるブリューシート構造化)→ グリル(1問ずつの質問攻め、auto対応)→ レシピ生成(実装資料7ファイル)までを行うローカルWebアプリを構築する。

**Architecture:** Next.js(App Router)単一アプリ。LLM呼び出しは自前の `LlmClient` インターフェースで抽象化し、実装は Vercel AI SDK(OpenAI / Gemini / Ollama / OpenRouter)とテスト用フェイクの2系統。保存はDBなしのファイルベース(`data/brews/<id>/`)。

**Tech Stack:** Next.js + TypeScript + Tailwind CSS / Vercel AI SDK(`ai`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`)/ zod / cheerio / unpdf / react-markdown / Vitest / Playwright

**参照スペック:** `docs/superpowers/specs/2026-06-13-idea-brewing-phase1-design.md`

---

## 前提・環境メモ

- OS は Windows、シェルは PowerShell 5.1。**`&&` は使えない**ので、コマンドの連結は `;` を使うか1行ずつ実行する。
- 作業ディレクトリはリポジトリルート(`idea-brewing/`)。既に `docs/` と `.gitignore` がコミット済み。
- Node.js 20+ がインストール済みであること(`node -v` で確認)。
- 依存パッケージはバージョンを固定せず `npm install <pkg>` で最新を入れる。

## ファイル構成マップ(最終形)

```
src/
  app/
    layout.tsx                       # 共通レイアウト(ヘッダー・醸造所テーマ)
    globals.css                      # テーマCSS(銅・琥珀・泡アニメーション)
    page.tsx                         # ダッシュボード(醸造タンク一覧)
    settings/page.tsx                # 設定画面(BYOK)
    brews/new/page.tsx               # 新しい仕込み(原料投入フォーム)
    brews/[id]/page.tsx              # ブリュー詳細(ワークベンチのラッパー)
    api/settings/route.ts            # GET/PUT 設定
    api/settings/test/route.ts       # POST 接続テスト
    api/brews/route.ts               # GET 一覧 / POST 作成
    api/brews/[id]/route.ts          # GET 1件
    api/brews/[id]/ingredients/route.ts  # POST 原料追加(multipart)
    api/brews/[id]/mash/route.ts     # POST 仕込み実行
    api/brews/[id]/sheet/route.ts    # PUT シート手動編集
    api/brews/[id]/grill/route.ts    # POST グリル操作(next/answer/finish/auto)
    api/brews/[id]/recipe/route.ts   # POST レシピ生成 / GET ファイル一覧
    api/brews/[id]/recipe/[file]/route.ts  # GET レシピファイル本文
  components/
    tank-card.tsx                    # 醸造タンクカード
    brew-workbench.tsx               # 工程ステッパーとパネル切替
    ingredients-panel.tsx            # 原料パネル(追加・一覧・仕込み実行)
    sheet-panel.tsx                  # ブリューシートパネル(充足度・編集)
    grill-panel.tsx                  # グリルパネル(質問カード・auto)
    recipe-panel.tsx                 # レシピパネル(進捗・閲覧・再発酵)
  lib/
    store/types.ts                   # 全ドメイン型(Brew/BrewSheet/Settings...)
    store/index.ts                   # ファイルベース永続化
    llm/client.ts                    # LlmClient インターフェース
    llm/ai-sdk-client.ts             # Vercel AI SDK 実装(4プロバイダ)
    llm/fake-client.ts               # 決定論的フェイク(テスト・E2E用)
    llm/index.ts                     # 設定からのクライアント解決
    ingredients/extract-url.ts       # URL fetch + 本文抽出
    ingredients/extract-pdf.ts       # PDF テキスト抽出
    ingredients/index.ts             # 原料追加(text/url/file)
    brew-sheet/index.ts              # 仕込み(マッシュ)・シート編集
    grill/index.ts                   # 質問生成・回答反映・終了判定
    recipe/index.ts                  # レシピ7ファイル生成・履歴退避
tests/
  unit/store.test.ts
  unit/fake-client.test.ts
  unit/ingredients.test.ts
  unit/brew-sheet.test.ts
  unit/grill.test.ts
  unit/recipe.test.ts
  e2e/global-setup.ts
  e2e/happy-path.spec.ts
vitest.config.ts
playwright.config.ts
```

設計原則: `lib/` の各モジュールは LLM を `LlmClient` 引数として受け取る(注入)。Route Handler だけが設定からクライアントを解決する。これにより全ロジックがフェイクでテスト可能になる。

---

### Task 1: プロジェクトスキャフォールドとテスト基盤

**Files:**
- Create: Next.js 一式(create-next-app)
- Create: `vitest.config.ts`
- Modify: `.gitignore`, `package.json`(scripts)

- [ ] **Step 1: create-next-app を現ディレクトリに実行**

```powershell
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

`docs` と `.git` は create-next-app の許容リストにあるためそのまま進む。`.gitignore` が上書きされた場合に備え、次の Step で必要な行を追記する。

- [ ] **Step 2: .gitignore に必要行を追記**

`.gitignore` の末尾に以下が**無ければ**追記する:

```gitignore
# idea brewing local data
data/
.e2e-data/

# playwright
playwright-report/
test-results/
```

- [ ] **Step 3: 依存パッケージのインストール**

```powershell
npm install ai @ai-sdk/openai @ai-sdk/google @ai-sdk/openai-compatible zod cheerio unpdf react-markdown
npm install -D vitest vite-tsconfig-paths @playwright/test pdf-lib
```

- [ ] **Step 4: vitest.config.ts を作成**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: package.json の scripts に追記**

`package.json` の `"scripts"` に以下を追加(既存の dev/build/start/lint は残す):

```json
"test": "vitest run",
"test:watch": "vitest",
"e2e": "playwright test"
```

- [ ] **Step 6: 動作確認**

```powershell
npm run dev
```

ブラウザで http://localhost:3000 を開き、Next.js の初期画面が出ることを確認したら Ctrl+C で停止。

- [ ] **Step 7: コミット**

```powershell
git add -A; git commit -m "chore: Next.js スキャフォールドとテスト基盤を追加"
```

---

### Task 2: ドメイン型とファイルベースストア

**Files:**
- Create: `src/lib/store/types.ts`
- Create: `src/lib/store/index.ts`
- Test: `tests/unit/store.test.ts`

- [ ] **Step 1: 型定義を作成(`src/lib/store/types.ts`)**

```ts
export type Sufficiency = "full" | "thin" | "empty";

export const SHEET_KEYS = [
  "concept",
  "targetUsers",
  "features",
  "lookAndTone",
  "successCriteria",
  "constraints",
  "evaluationAxes",
] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export const SHEET_LABELS: Record<SheetKey, string> = {
  concept: "コンセプト",
  targetUsers: "ターゲットユーザーとコアジョブ",
  features: "主要機能(Must/Should/Could)",
  lookAndTone: "見た目とトーン",
  successCriteria: "成功基準",
  constraints: "制約",
  evaluationAxes: "自己評価の観点",
};

export interface SheetField {
  content: string;
  sufficiency: Sufficiency;
  userEdited: boolean;
}

export type BrewSheet = Record<SheetKey, SheetField>;

export type IngredientKind = "text" | "url" | "image" | "document";

export interface Ingredient {
  id: string;
  kind: IngredientKind;
  title: string;
  text?: string;
  filePath?: string;
  mimeType?: string;
  status: "ok" | "failed";
  error?: string;
  addedAt: string;
}

export interface GrillOption {
  label: string;
  recommended: boolean;
}

export interface GrillEntry {
  id: string;
  question: string;
  options: GrillOption[];
  answer?: string;
  answeredBy?: "user" | "auto";
  askedAt: string;
}

export interface GrillState {
  entries: GrillEntry[];
  auto: boolean;
  finished: boolean;
}

export interface RecipeProgress {
  current: number;
  total: number;
  file: string;
}

export type BrewStage = "ingredients" | "grilling" | "fermenting" | "done";

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
}

export type ProviderId = "openai" | "google" | "ollama" | "openrouter" | "fake";

export interface Settings {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
}
```

- [ ] **Step 2: 失敗するテストを書く(`tests/unit/store.test.ts`)**

```ts
import { beforeEach, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createBrew,
  listBrews,
  readBrew,
  readSettings,
  writeBrew,
  writeSettings,
} from "@/lib/store";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-store-"));
});

test("設定が無いときは既定値を返す", async () => {
  const s = await readSettings();
  expect(s.provider).toBe("openai");
  expect(s.model).toBe("");
});

test("設定の保存と読み出し", async () => {
  await writeSettings({
    provider: "ollama",
    apiKey: "",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3",
  });
  const s = await readSettings();
  expect(s.provider).toBe("ollama");
  expect(s.model).toBe("llama3");
});

test("ブリューの作成・読み出し・一覧", async () => {
  const brew = await createBrew("最高のtodoアプリ");
  const loaded = await readBrew(brew.id);
  expect(loaded.name).toBe("最高のtodoアプリ");
  expect(loaded.stage).toBe("ingredients");
  expect(loaded.grill).toEqual({ entries: [], auto: false, finished: false });
  const all = await listBrews();
  expect(all).toHaveLength(1);
});

test("ブリューの更新で updatedAt が進む", async () => {
  const brew = await createBrew("a");
  const before = brew.updatedAt;
  await new Promise((r) => setTimeout(r, 10));
  await writeBrew({ ...brew, stage: "grilling" });
  const loaded = await readBrew(brew.id);
  expect(loaded.stage).toBe("grilling");
  expect(loaded.updatedAt >= before).toBe(true);
});

test("brews フォルダが無ければ空一覧", async () => {
  expect(await listBrews()).toEqual([]);
});
```

- [ ] **Step 3: テストが失敗することを確認**

```powershell
npx vitest run tests/unit/store.test.ts
```

Expected: FAIL(`@/lib/store` が存在しない)

- [ ] **Step 4: ストアを実装(`src/lib/store/index.ts`)**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Brew, Settings } from "./types";

export function dataDir(): string {
  return process.env.IDEA_BREWING_DATA_DIR ?? path.join(process.cwd(), "data");
}

export function brewDir(id: string): string {
  return path.join(dataDir(), "brews", id);
}

export function recipeDir(id: string): string {
  return path.join(brewDir(id), "recipe");
}

const DEFAULT_SETTINGS: Settings = { provider: "openai", apiKey: "", baseUrl: "", model: "" };

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(path.join(dataDir(), "settings.json"), "utf8");
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(
    path.join(dataDir(), "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf8",
  );
}

export async function createBrew(name: string): Promise<Brew> {
  const now = new Date().toISOString();
  const brew: Brew = {
    schemaVersion: 1,
    id: randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    stage: "ingredients",
    ingredients: [],
    sheet: null,
    grill: { entries: [], auto: false, finished: false },
    recipeProgress: null,
    recipeGeneratedAt: null,
  };
  await fs.mkdir(path.join(brewDir(brew.id), "ingredients"), { recursive: true });
  await writeBrew(brew);
  return brew;
}

export async function readBrew(id: string): Promise<Brew> {
  const raw = await fs.readFile(path.join(brewDir(id), "brew.json"), "utf8");
  return JSON.parse(raw) as Brew;
}

export async function writeBrew(brew: Brew): Promise<void> {
  const next = { ...brew, updatedAt: new Date().toISOString() };
  await fs.mkdir(brewDir(brew.id), { recursive: true });
  await fs.writeFile(
    path.join(brewDir(brew.id), "brew.json"),
    JSON.stringify(next, null, 2),
    "utf8",
  );
}

export async function listBrews(): Promise<Brew[]> {
  const root = path.join(dataDir(), "brews");
  let ids: string[] = [];
  try {
    ids = await fs.readdir(root);
  } catch {
    return [];
  }
  const brews: Brew[] = [];
  for (const id of ids) {
    try {
      brews.push(await readBrew(id));
    } catch {
      // brew.json が無い/壊れたフォルダは一覧から除外する
    }
  }
  return brews.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readIngredientFile(brewId: string, relPath: string): Promise<Buffer> {
  return fs.readFile(path.join(brewDir(brewId), relPath));
}
```

- [ ] **Step 5: テストが通ることを確認**

```powershell
npx vitest run tests/unit/store.test.ts
```

Expected: PASS(5 tests)

- [ ] **Step 6: コミット**

```powershell
git add src/lib/store tests/unit/store.test.ts; git commit -m "feat: ドメイン型とファイルベースストアを追加"
```

---

### Task 3: LLM クライアント層(抽象化・AI SDK 実装・フェイク)

**Files:**
- Create: `src/lib/llm/client.ts`
- Create: `src/lib/llm/ai-sdk-client.ts`
- Create: `src/lib/llm/fake-client.ts`
- Create: `src/lib/llm/index.ts`
- Test: `tests/unit/fake-client.test.ts`

- [ ] **Step 1: インターフェース定義(`src/lib/llm/client.ts`)**

```ts
import type { z } from "zod";

export type LlmTag = "mash" | "grill-next" | "grill-apply" | "recipe" | "connection-test";

export interface LlmImage {
  data: Buffer;
  mimeType: string;
}

export interface GenerateOptions {
  tag: LlmTag;
  system: string;
  prompt: string;
  images?: LlmImage[];
}

export interface LlmClient {
  generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T>;
  generateText(opts: GenerateOptions): Promise<string>;
}
```

- [ ] **Step 2: 失敗するテストを書く(`tests/unit/fake-client.test.ts`)**

```ts
import { expect, test } from "vitest";
import { z } from "zod";
import { createFakeClient } from "@/lib/llm/fake-client";

const grillNextSchema = z.object({
  done: z.boolean(),
  question: z.string().nullable(),
  options: z
    .array(z.object({ label: z.string(), recommended: z.boolean() }))
    .nullable(),
});

test("フェイクは grill-next を2回まで質問し、3回目で done を返す", async () => {
  const fake = createFakeClient();
  const opts = { tag: "grill-next" as const, system: "", prompt: "" };
  const q1 = await fake.generateObject(grillNextSchema, opts);
  expect(q1.done).toBe(false);
  expect(q1.options?.some((o) => o.recommended)).toBe(true);
  const q2 = await fake.generateObject(grillNextSchema, opts);
  expect(q2.done).toBe(false);
  const q3 = await fake.generateObject(grillNextSchema, opts);
  expect(q3.done).toBe(true);
});

test("フェイクは呼び出し履歴を記録する", async () => {
  const fake = createFakeClient();
  await fake.generateText({ tag: "connection-test", system: "", prompt: "ping" });
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0].tag).toBe("connection-test");
});

test("connection-test は pong を返す", async () => {
  const fake = createFakeClient();
  const reply = await fake.generateText({ tag: "connection-test", system: "", prompt: "ping" });
  expect(reply).toBe("pong");
});
```

- [ ] **Step 3: テストが失敗することを確認**

```powershell
npx vitest run tests/unit/fake-client.test.ts
```

Expected: FAIL(`@/lib/llm/fake-client` が存在しない)

- [ ] **Step 4: フェイク実装(`src/lib/llm/fake-client.ts`)**

決定論的な応答を返す。単体テストと E2E の両方で使う。

```ts
import type { z } from "zod";
import { SHEET_KEYS } from "@/lib/store/types";
import type { GenerateOptions, LlmClient } from "./client";

export interface FakeLlm extends LlmClient {
  calls: GenerateOptions[];
}

export function createFakeClient(): FakeLlm {
  let grillCount = 0;
  const calls: GenerateOptions[] = [];

  const fakeObjectFor = (tag: string): unknown => {
    if (tag === "mash") {
      const field = (sufficiency: string, content: string) => ({ content, sufficiency });
      return {
        concept: field("thin", "原料から推定したコンセプト"),
        targetUsers: field("thin", "想定ユーザー(推定)"),
        features: field("thin", "Must: 中核機能 / Should: 補助機能 / Could: 発展機能"),
        lookAndTone: field("empty", ""),
        successCriteria: field("empty", ""),
        constraints: field("thin", "Webアプリとして実装する"),
        evaluationAxes: field("empty", ""),
      };
    }
    if (tag === "grill-next") {
      grillCount += 1;
      if (grillCount > 2) return { done: true, question: null, options: null };
      return {
        done: false,
        question: `フェイク質問${grillCount}: 方向性はどちらが近いですか?`,
        options: [
          { label: "シンプル重視", recommended: true },
          { label: "多機能重視", recommended: false },
        ],
      };
    }
    if (tag === "grill-apply") {
      return {
        updates: SHEET_KEYS.map((key) => ({
          key,
          content: `回答を反映した ${key} の内容`,
          sufficiency: "full",
        })),
      };
    }
    throw new Error(`fake client: 未対応の tag です: ${tag}`);
  };

  return {
    calls,
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      calls.push(opts);
      return schema.parse(fakeObjectFor(opts.tag));
    },
    async generateText(opts: GenerateOptions): Promise<string> {
      calls.push(opts);
      if (opts.tag === "connection-test") return "pong";
      return `# フェイク生成ドキュメント\n\n(tag=${opts.tag})\n\n入力の先頭: ${opts.prompt.slice(0, 200)}`;
    },
  };
}
```

- [ ] **Step 5: テストが通ることを確認**

```powershell
npx vitest run tests/unit/fake-client.test.ts
```

Expected: PASS(3 tests)

- [ ] **Step 6: AI SDK 実装(`src/lib/llm/ai-sdk-client.ts`)**

ネットワークを伴うため単体テストはしない(E2Eはフェイク、実機確認は設定画面の接続テストで行う)。構造化出力のパース失敗時は1回だけ自動リトライする(スペック7章)。

```ts
import { generateObject, generateText, type LanguageModel, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import type { Settings } from "@/lib/store/types";
import type { GenerateOptions, LlmClient } from "./client";

export function resolveModel(settings: Settings): LanguageModel {
  switch (settings.provider) {
    case "openai":
      return createOpenAI({ apiKey: settings.apiKey })(settings.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: settings.apiKey })(settings.model);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: settings.baseUrl || "http://localhost:11434/v1",
      })(settings.model);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: settings.apiKey,
      })(settings.model);
    default:
      throw new Error(`AI SDK では扱えないプロバイダです: ${settings.provider}`);
  }
}

function toMessages(opts: GenerateOptions): ModelMessage[] {
  if (!opts.images?.length) {
    return [{ role: "user", content: opts.prompt }];
  }
  return [
    {
      role: "user",
      content: [
        { type: "text", text: opts.prompt },
        ...opts.images.map((img) => ({
          type: "image" as const,
          image: img.data,
          mediaType: img.mimeType,
        })),
      ],
    },
  ];
}

export function createAiSdkClient(settings: Settings): LlmClient {
  const model = resolveModel(settings);
  return {
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      const run = async () => {
        const { object } = await generateObject({
          model,
          system: opts.system,
          messages: toMessages(opts),
          schema,
        });
        return object;
      };
      try {
        return await run();
      } catch {
        return await run(); // パース失敗等は1回だけ自動リトライ
      }
    },
    async generateText(opts: GenerateOptions): Promise<string> {
      const { text } = await generateText({
        model,
        system: opts.system,
        messages: toMessages(opts),
      });
      return text;
    },
  };
}
```

- [ ] **Step 7: クライアント解決(`src/lib/llm/index.ts`)**

```ts
import { readSettings } from "@/lib/store";
import type { Settings } from "@/lib/store/types";
import type { LlmClient } from "./client";
import { createAiSdkClient } from "./ai-sdk-client";
import { createFakeClient } from "./fake-client";

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("LLM が未設定です。設定画面でプロバイダとモデルを設定してください。");
    this.name = "LlmNotConfiguredError";
  }
}

export function clientForSettings(settings: Settings): LlmClient {
  if (settings.provider === "fake") return createFakeClient();
  return createAiSdkClient(settings);
}

export async function getConfiguredClient(): Promise<LlmClient> {
  const settings = await readSettings();
  const needsKey = settings.provider !== "ollama" && settings.provider !== "fake";
  if (settings.provider !== "fake" && (!settings.model || (needsKey && !settings.apiKey))) {
    throw new LlmNotConfiguredError();
  }
  return clientForSettings(settings);
}
```

- [ ] **Step 8: 型チェックと全テスト**

```powershell
npx tsc --noEmit; npm run test
```

Expected: 型エラーなし、全テスト PASS

- [ ] **Step 9: コミット**

```powershell
git add src/lib/llm tests/unit/fake-client.test.ts; git commit -m "feat: LLMクライアント層(AI SDK実装とフェイク)を追加"
```

---

### Task 4: 原料取り込み(テキスト・URL・画像・ドキュメント)

**Files:**
- Create: `src/lib/ingredients/extract-url.ts`
- Create: `src/lib/ingredients/extract-pdf.ts`
- Create: `src/lib/ingredients/index.ts`
- Test: `tests/unit/ingredients.test.ts`

- [ ] **Step 1: 失敗するテストを書く(`tests/unit/ingredients.test.ts`)**

```ts
import { beforeEach, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createBrew } from "@/lib/store";
import { extractReadableText } from "@/lib/ingredients/extract-url";
import { extractPdfText } from "@/lib/ingredients/extract-pdf";
import {
  addFileIngredient,
  addTextIngredient,
  addUrlIngredient,
} from "@/lib/ingredients";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-ing-"));
});

test("HTMLから本文とタイトルを抽出し、script等は除外する", () => {
  const html = `<html><head><title>参考LP</title><style>.x{}</style></head>
    <body><script>alert(1)</script><h1>最高のサービス</h1><p>説明文です。</p></body></html>`;
  const { title, text } = extractReadableText(html);
  expect(title).toBe("参考LP");
  expect(text).toContain("最高のサービス");
  expect(text).toContain("説明文です。");
  expect(text).not.toContain("alert");
});

test("テキスト原料を追加できる", async () => {
  const brew = await createBrew("t");
  const next = addTextIngredient(brew, "最高のtodoアプリ");
  expect(next.ingredients).toHaveLength(1);
  expect(next.ingredients[0]).toMatchObject({
    kind: "text",
    text: "最高のtodoアプリ",
    status: "ok",
  });
});

test("URL原料: 取得成功", async () => {
  const brew = await createBrew("t");
  const fakeFetch = (async () =>
    new Response("<html><head><title>LP</title></head><body>内容</body></html>", {
      status: 200,
    })) as typeof fetch;
  const next = await addUrlIngredient(brew, "https://example.com", fakeFetch);
  expect(next.ingredients[0]).toMatchObject({ kind: "url", title: "LP", status: "ok" });
  expect(next.ingredients[0].text).toContain("内容");
});

test("URL原料: 取得失敗でも brew は壊れず failed として記録される", async () => {
  const brew = await createBrew("t");
  const fakeFetch = (async () => new Response("ng", { status: 404 })) as typeof fetch;
  const next = await addUrlIngredient(brew, "https://example.com/x", fakeFetch);
  expect(next.ingredients[0].status).toBe("failed");
  expect(next.ingredients[0].error).toContain("404");
});

test("画像ファイル原料はファイル保存され kind=image になる", async () => {
  const brew = await createBrew("t");
  const next = await addFileIngredient(brew, "ref.png", "image/png", Buffer.from([1, 2, 3]));
  expect(next.ingredients[0]).toMatchObject({ kind: "image", status: "ok" });
  expect(next.ingredients[0].filePath).toContain("ref.png");
});

test("PDFからテキストを抽出できる", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello idea brewing", { x: 50, y: 700, size: 12, font });
  const buffer = Buffer.from(await doc.save());
  const text = await extractPdfText(buffer);
  expect(text).toContain("Hello idea brewing");
});

test("PDFドキュメント原料は text が抽出される", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Plan doc", { x: 50, y: 700, size: 12, font });
  const buffer = Buffer.from(await doc.save());
  const brew = await createBrew("t");
  const next = await addFileIngredient(brew, "plan.pdf", "application/pdf", buffer);
  expect(next.ingredients[0]).toMatchObject({ kind: "document", status: "ok" });
  expect(next.ingredients[0].text).toContain("Plan doc");
});
```

- [ ] **Step 2: テストが失敗することを確認**

```powershell
npx vitest run tests/unit/ingredients.test.ts
```

Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: URL抽出を実装(`src/lib/ingredients/extract-url.ts`)**

```ts
import * as cheerio from "cheerio";

const MAX_CHARS = 20000;

export function extractReadableText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe").remove();
  const title = $("title").first().text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  return { title, text };
}

export async function fetchUrlText(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ title: string; text: string }> {
  const res = await fetchFn(url, { headers: { "user-agent": "idea-brewing/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return extractReadableText(await res.text());
}
```

- [ ] **Step 4: PDF抽出を実装(`src/lib/ingredients/extract-pdf.ts`)**

```ts
import { extractText, getDocumentProxy } from "unpdf";

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}
```

- [ ] **Step 5: 原料追加を実装(`src/lib/ingredients/index.ts`)**

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { brewDir } from "@/lib/store";
import type { Brew, Ingredient } from "@/lib/store/types";
import { fetchUrlText } from "./extract-url";
import { extractPdfText } from "./extract-pdf";

function push(brew: Brew, ingredient: Ingredient): Brew {
  return { ...brew, ingredients: [...brew.ingredients, ingredient] };
}

export function addTextIngredient(brew: Brew, text: string): Brew {
  return push(brew, {
    id: randomUUID(),
    kind: "text",
    title: "テキストメモ",
    text,
    status: "ok",
    addedAt: new Date().toISOString(),
  });
}

export async function addUrlIngredient(
  brew: Brew,
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<Brew> {
  const id = randomUUID();
  const addedAt = new Date().toISOString();
  try {
    const { title, text } = await fetchUrlText(url, fetchFn);
    return push(brew, {
      id,
      kind: "url",
      title: title || url,
      text: `(URL: ${url})\n${text}`,
      status: "ok",
      addedAt,
    });
  } catch (err) {
    return push(brew, {
      id,
      kind: "url",
      title: url,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      addedAt,
    });
  }
}

export async function addFileIngredient(
  brew: Brew,
  fileName: string,
  mimeType: string,
  data: Buffer,
): Promise<Brew> {
  const id = randomUUID();
  const addedAt = new Date().toISOString();
  const relPath = path.join("ingredients", `${id}-${fileName}`);
  await fs.mkdir(path.join(brewDir(brew.id), "ingredients"), { recursive: true });
  await fs.writeFile(path.join(brewDir(brew.id), relPath), data);
  const base = { id, title: fileName, filePath: relPath, mimeType, addedAt };

  if (mimeType.startsWith("image/")) {
    return push(brew, { ...base, kind: "image", status: "ok" });
  }
  try {
    const text =
      mimeType === "application/pdf" ? await extractPdfText(data) : data.toString("utf8");
    return push(brew, { ...base, kind: "document", text, status: "ok" });
  } catch (err) {
    return push(brew, {
      ...base,
      kind: "document",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 6: テストが通ることを確認**

```powershell
npx vitest run tests/unit/ingredients.test.ts
```

Expected: PASS(7 tests)

- [ ] **Step 7: コミット**

```powershell
git add src/lib/ingredients tests/unit/ingredients.test.ts; git commit -m "feat: 原料取り込み(テキスト/URL/画像/PDF)を追加"
```

---

### Task 5: 仕込み(マッシュ)とシート編集

**Files:**
- Create: `src/lib/brew-sheet/index.ts`
- Test: `tests/unit/brew-sheet.test.ts`

- [ ] **Step 1: 失敗するテストを書く(`tests/unit/brew-sheet.test.ts`)**

```ts
import { beforeEach, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBrew } from "@/lib/store";
import { SHEET_KEYS } from "@/lib/store/types";
import { createFakeClient } from "@/lib/llm/fake-client";
import { addTextIngredient } from "@/lib/ingredients";
import { editSheetField, runMash } from "@/lib/brew-sheet";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-sheet-"));
});

test("マッシュでブリューシート7項目が生成され stage が grilling になる", async () => {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "最高のtodoアプリ");
  const next = await runMash(brew, fake);
  expect(next.sheet).not.toBeNull();
  for (const key of SHEET_KEYS) {
    expect(next.sheet![key].content).toBeDefined();
    expect(["full", "thin", "empty"]).toContain(next.sheet![key].sufficiency);
  }
  expect(next.stage).toBe("grilling");
  expect(fake.calls[0].tag).toBe("mash");
  expect(fake.calls[0].prompt).toContain("最高のtodoアプリ");
});

test("ユーザー確定済み項目は再マッシュで上書きされない", async () => {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "メモ");
  brew = await runMash(brew, fake);
  brew = editSheetField(brew, "concept", "ユーザーが確定したコンセプト");
  const again = await runMash(brew, fake);
  expect(again.sheet!.concept.content).toBe("ユーザーが確定したコンセプト");
  expect(again.sheet!.concept.userEdited).toBe(true);
  expect(again.sheet!.targetUsers.userEdited).toBe(false);
});

test("シート手動編集は userEdited を立て、充足度を再判定する", async () => {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "メモ");
  brew = await runMash(brew, fake);
  const edited = editSheetField(brew, "lookAndTone", "琥珀色で温かみのあるデザイン");
  expect(edited.sheet!.lookAndTone).toMatchObject({
    content: "琥珀色で温かみのあるデザイン",
    sufficiency: "full",
    userEdited: true,
  });
  const cleared = editSheetField(edited, "lookAndTone", "");
  expect(cleared.sheet!.lookAndTone.sufficiency).toBe("empty");
});
```

- [ ] **Step 2: テストが失敗することを確認**

```powershell
npx vitest run tests/unit/brew-sheet.test.ts
```

Expected: FAIL(`@/lib/brew-sheet` が存在しない)

- [ ] **Step 3: 実装(`src/lib/brew-sheet/index.ts`)**

```ts
import { z } from "zod";
import type { LlmClient, LlmImage } from "@/lib/llm/client";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type BrewSheet,
  type SheetKey,
} from "@/lib/store/types";

const fieldSchema = z.object({
  content: z.string(),
  sufficiency: z.enum(["full", "thin", "empty"]),
});

export const mashOutputSchema = z.object({
  concept: fieldSchema,
  targetUsers: fieldSchema,
  features: fieldSchema,
  lookAndTone: fieldSchema,
  successCriteria: fieldSchema,
  constraints: fieldSchema,
  evaluationAxes: fieldSchema,
});

const MASH_SYSTEM = [
  "あなたは idea brewing の醸造職人です。",
  "ユーザーが投入した原料(テキスト・URL本文・ドキュメント・画像)から、サービスのアイデアを7項目のブリューシートに構造化します。",
  "原料に根拠のない創作はせず、推定した部分は推定と分かる書き方をしてください。",
  "各項目に充足度を付けます: full=実装判断に十分 / thin=方向性はあるが詳細不足 / empty=情報なし。",
  "情報が無い項目は content を空文字、sufficiency を empty にしてください。",
  "出力はすべて日本語。",
].join("\n");

export function buildMashPrompt(brew: Brew): string {
  const parts: string[] = ["## 投入された原料"];
  let n = 0;
  for (const ing of brew.ingredients) {
    if (ing.status !== "ok") continue;
    n += 1;
    if (ing.kind === "image") {
      parts.push(`### 原料${n}(画像: ${ing.title})\n画像はメッセージに添付されています。`);
    } else {
      parts.push(`### 原料${n}(${ing.kind}: ${ing.title})\n${ing.text ?? ""}`);
    }
  }
  const locked = SHEET_KEYS.filter((k) => brew.sheet?.[k]?.userEdited);
  if (locked.length > 0) {
    parts.push("## ユーザー確定済み項目(この内容を前提として他項目を埋めること)");
    for (const key of locked) {
      parts.push(`- ${SHEET_LABELS[key]}: ${brew.sheet![key].content}`);
    }
  }
  parts.push("上記の原料からブリューシートを作成してください。");
  return parts.join("\n\n");
}

export async function runMash(
  brew: Brew,
  client: LlmClient,
  images: LlmImage[] = [],
): Promise<Brew> {
  const out = await client.generateObject(mashOutputSchema, {
    tag: "mash",
    system: MASH_SYSTEM,
    prompt: buildMashPrompt(brew),
    images,
  });
  const sheet = {} as BrewSheet;
  for (const key of SHEET_KEYS) {
    if (brew.sheet?.[key]?.userEdited) {
      sheet[key] = brew.sheet[key];
    } else {
      sheet[key] = { ...out[key], userEdited: false };
    }
  }
  return { ...brew, sheet, stage: "grilling" };
}

export function editSheetField(brew: Brew, key: SheetKey, content: string): Brew {
  if (!brew.sheet) throw new Error("シートがまだありません。先に仕込みを実行してください。");
  const sheet: BrewSheet = {
    ...brew.sheet,
    [key]: {
      content,
      sufficiency: content.trim() === "" ? "empty" : "full",
      userEdited: true,
    },
  };
  return { ...brew, sheet };
}
```

- [ ] **Step 4: テストが通ることを確認**

```powershell
npx vitest run tests/unit/brew-sheet.test.ts
```

Expected: PASS(3 tests)

- [ ] **Step 5: コミット**

```powershell
git add src/lib/brew-sheet tests/unit/brew-sheet.test.ts; git commit -m "feat: 仕込み(マッシュ)とブリューシート編集を追加"
```

---

### Task 6: グリル(質問生成・回答反映・終了判定)

**Files:**
- Create: `src/lib/grill/index.ts`
- Test: `tests/unit/grill.test.ts`

- [ ] **Step 1: 失敗するテストを書く(`tests/unit/grill.test.ts`)**

```ts
import { beforeEach, expect, test } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBrew } from "@/lib/store";
import { SHEET_KEYS, type Brew, type GrillEntry } from "@/lib/store/types";
import { createFakeClient } from "@/lib/llm/fake-client";
import { addTextIngredient } from "@/lib/ingredients";
import { runMash } from "@/lib/brew-sheet";
import { applyAnswer, MAX_QUESTIONS, nextQuestion } from "@/lib/grill";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-grill-"));
});

async function mashedBrew() {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "最高のtodoアプリ");
  return { brew: await runMash(brew, fake), fake };
}

test("nextQuestion は質問エントリを追加して返す", async () => {
  const { brew, fake } = await mashedBrew();
  const { brew: next, entry } = await nextQuestion(brew, fake);
  expect(entry).not.toBeNull();
  expect(entry!.question).toContain("フェイク質問");
  expect(entry!.options.some((o) => o.recommended)).toBe(true);
  expect(next.grill.entries).toHaveLength(1);
  expect(next.grill.finished).toBe(false);
});

test("applyAnswer で回答が記録されシートが更新される", async () => {
  const { brew, fake } = await mashedBrew();
  const { brew: asked, entry } = await nextQuestion(brew, fake);
  const answered = await applyAnswer(asked, entry!.id, "シンプル重視", "user", fake);
  const saved = answered.grill.entries[0];
  expect(saved.answer).toBe("シンプル重視");
  expect(saved.answeredBy).toBe("user");
  for (const key of SHEET_KEYS) {
    expect(answered.sheet![key].sufficiency).toBe("full");
  }
});

test("全項目 full なら LLM を呼ばずに finished になる", async () => {
  const { brew, fake } = await mashedBrew();
  const { brew: asked, entry } = await nextQuestion(brew, fake);
  const answered = await applyAnswer(asked, entry!.id, "シンプル重視", "auto", fake);
  const callsBefore = fake.calls.length;
  const { brew: done, entry: none } = await nextQuestion(answered, fake);
  expect(none).toBeNull();
  expect(done.grill.finished).toBe(true);
  expect(fake.calls.length).toBe(callsBefore); // LLM 呼び出しなし
});

test("質問数が上限に達したら強制終了する", async () => {
  const { brew, fake } = await mashedBrew();
  const entries: GrillEntry[] = Array.from({ length: MAX_QUESTIONS }, (_, i) => ({
    id: String(i),
    question: `q${i}`,
    options: [],
    askedAt: new Date().toISOString(),
  }));
  const stuffed: Brew = { ...brew, grill: { ...brew.grill, entries } };
  const { brew: done, entry } = await nextQuestion(stuffed, fake);
  expect(entry).toBeNull();
  expect(done.grill.finished).toBe(true);
});
```

- [ ] **Step 2: テストが失敗することを確認**

```powershell
npx vitest run tests/unit/grill.test.ts
```

Expected: FAIL(`@/lib/grill` が存在しない)

- [ ] **Step 3: 実装(`src/lib/grill/index.ts`)**

```ts
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { LlmClient } from "@/lib/llm/client";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type BrewSheet,
  type GrillEntry,
} from "@/lib/store/types";

export const MAX_QUESTIONS = 20;

const nextSchema = z.object({
  done: z.boolean(),
  question: z.string().nullable(),
  options: z
    .array(z.object({ label: z.string(), recommended: z.boolean() }))
    .nullable(),
});

const applySchema = z.object({
  updates: z.array(
    z.object({
      key: z.enum(SHEET_KEYS),
      content: z.string(),
      sufficiency: z.enum(["full", "thin", "empty"]),
    }),
  ),
});

const GRILL_SYSTEM = [
  "あなたは idea brewing のグリル職人です。",
  "ブリューシートの不足項目・項目間の矛盾・曖昧な表現を1つ選び、それを解消する質問を1問だけ作ります。",
  "質問には2〜4個の選択肢を付け、最も推奨する選択肢1つだけ recommended を true にします。",
  "既に質問済みの内容を繰り返してはいけません。",
  "全項目が十分でこれ以上聞くことが無ければ done を true、question と options を null にします。",
  "出力はすべて日本語。",
].join("\n");

const APPLY_SYSTEM = [
  "あなたは idea brewing のグリル職人です。ユーザーの回答をブリューシートに反映します。",
  "回答によって内容が確定・具体化した項目だけを updates に含め、各項目の新しい全文と充足度(full/thin/empty)を返します。",
  "回答と無関係な項目は updates に含めないでください。",
  "出力はすべて日本語。",
].join("\n");

function sheetDump(sheet: BrewSheet): string {
  return SHEET_KEYS.map(
    (k) =>
      `### ${SHEET_LABELS[k]}(充足度: ${sheet[k].sufficiency})\n${sheet[k].content || "(空)"}`,
  ).join("\n\n");
}

function historyDump(entries: GrillEntry[]): string {
  if (entries.length === 0) return "(まだ質問していない)";
  return entries
    .map((e, i) => `Q${i + 1}: ${e.question}\nA${i + 1}: ${e.answer ?? "(未回答)"}`)
    .join("\n");
}

export async function nextQuestion(
  brew: Brew,
  client: LlmClient,
): Promise<{ brew: Brew; entry: GrillEntry | null }> {
  if (!brew.sheet) throw new Error("シートがまだありません。先に仕込みを実行してください。");
  const finish = (b: Brew): { brew: Brew; entry: null } => ({
    brew: { ...b, grill: { ...b.grill, finished: true } },
    entry: null,
  });

  if (brew.grill.finished) return { brew, entry: null };
  if (brew.grill.entries.length >= MAX_QUESTIONS) return finish(brew);
  if (SHEET_KEYS.every((k) => brew.sheet![k].sufficiency === "full")) return finish(brew);

  const out = await client.generateObject(nextSchema, {
    tag: "grill-next",
    system: GRILL_SYSTEM,
    prompt: `## 現在のブリューシート\n${sheetDump(brew.sheet)}\n\n## これまでの質疑\n${historyDump(brew.grill.entries)}\n\n次の質問を1問作ってください。`,
  });

  if (out.done || !out.question || !out.options) return finish(brew);

  const entry: GrillEntry = {
    id: randomUUID(),
    question: out.question,
    options: out.options,
    askedAt: new Date().toISOString(),
  };
  return {
    brew: { ...brew, grill: { ...brew.grill, entries: [...brew.grill.entries, entry] } },
    entry,
  };
}

export async function applyAnswer(
  brew: Brew,
  entryId: string,
  answer: string,
  by: "user" | "auto",
  client: LlmClient,
): Promise<Brew> {
  if (!brew.sheet) throw new Error("シートがまだありません。");
  const entry = brew.grill.entries.find((e) => e.id === entryId);
  if (!entry) throw new Error("質問が見つかりません。");

  const out = await client.generateObject(applySchema, {
    tag: "grill-apply",
    system: APPLY_SYSTEM,
    prompt: `## 現在のブリューシート\n${sheetDump(brew.sheet)}\n\n## 質問\n${entry.question}\n\n## ユーザーの回答\n${answer}\n\n回答をシートに反映してください。`,
  });

  const sheet: BrewSheet = { ...brew.sheet };
  for (const u of out.updates) {
    sheet[u.key] = {
      content: u.content,
      sufficiency: u.sufficiency,
      userEdited: sheet[u.key].userEdited,
    };
  }
  const entries = brew.grill.entries.map((e) =>
    e.id === entryId ? { ...e, answer, answeredBy: by } : e,
  );
  return { ...brew, sheet, grill: { ...brew.grill, entries } };
}

export function finishGrill(brew: Brew): Brew {
  return { ...brew, grill: { ...brew.grill, finished: true }, stage: "fermenting" };
}

export function setAutoMode(brew: Brew, auto: boolean): Brew {
  return { ...brew, grill: { ...brew.grill, auto } };
}
```

- [ ] **Step 4: テストが通ることを確認**

```powershell
npx vitest run tests/unit/grill.test.ts
```

Expected: PASS(4 tests)

- [ ] **Step 5: コミット**

```powershell
git add src/lib/grill tests/unit/grill.test.ts; git commit -m "feat: グリル工程(質問生成・回答反映・終了判定)を追加"
```

---

### Task 7: レシピ生成(発酵)

**Files:**
- Create: `src/lib/recipe/index.ts`
- Test: `tests/unit/recipe.test.ts`

- [ ] **Step 1: 失敗するテストを書く(`tests/unit/recipe.test.ts`)**

```ts
import { beforeEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBrew, recipeDir } from "@/lib/store";
import { createFakeClient } from "@/lib/llm/fake-client";
import { addTextIngredient } from "@/lib/ingredients";
import { runMash } from "@/lib/brew-sheet";
import { generateRecipe, listRecipeFiles, RECIPE_FILES, readRecipeFile } from "@/lib/recipe";

beforeEach(() => {
  process.env.IDEA_BREWING_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ib-recipe-"));
});

async function readyBrew() {
  const fake = createFakeClient();
  let brew = await createBrew("t");
  brew = addTextIngredient(brew, "最高のtodoアプリ");
  brew = await runMash(brew, fake);
  return { brew, fake };
}

test("レシピ7ファイルが生成され stage が done になる", async () => {
  const { brew, fake } = await readyBrew();
  const progress: string[] = [];
  const done = await generateRecipe(brew, fake, async (b) => {
    if (b.recipeProgress) progress.push(b.recipeProgress.file);
  });
  expect(RECIPE_FILES).toHaveLength(7);
  for (const f of RECIPE_FILES) {
    expect(existsSync(path.join(recipeDir(brew.id), f.file))).toBe(true);
  }
  expect(done.stage).toBe("done");
  expect(done.recipeGeneratedAt).not.toBeNull();
  expect(done.recipeProgress).toBeNull();
  expect(progress).toHaveLength(7);
  const files = await listRecipeFiles(brew.id);
  expect(files).toEqual(RECIPE_FILES.map((f) => f.file));
});

test("再発酵すると旧版が history に退避される", async () => {
  const { brew, fake } = await readyBrew();
  const first = await generateRecipe(brew, fake);
  await generateRecipe(first, fake);
  const historyRoot = path.join(recipeDir(brew.id), "history");
  const stamps = readdirSync(historyRoot);
  expect(stamps).toHaveLength(1);
  expect(readdirSync(path.join(historyRoot, stamps[0]))).toHaveLength(7);
});

test("readRecipeFile は許可されたファイル名のみ読める", async () => {
  const { brew, fake } = await readyBrew();
  await generateRecipe(brew, fake);
  const text = await readRecipeFile(brew.id, "00-overview.md");
  expect(text).toContain("フェイク生成ドキュメント");
  await expect(readRecipeFile(brew.id, "../brew.json")).rejects.toThrow();
});
```

- [ ] **Step 2: テストが失敗することを確認**

```powershell
npx vitest run tests/unit/recipe.test.ts
```

Expected: FAIL(`@/lib/recipe` が存在しない)

- [ ] **Step 3: 実装(`src/lib/recipe/index.ts`)**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LlmClient } from "@/lib/llm/client";
import { recipeDir } from "@/lib/store";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type BrewSheet,
  type GrillEntry,
} from "@/lib/store/types";

export interface RecipeFileDef {
  file: string;
  title: string;
  instructions: string;
}

export const RECIPE_FILES: RecipeFileDef[] = [
  {
    file: "00-overview.md",
    title: "サービス概要",
    instructions:
      "サービスの概要とエレベーターピッチ。何を・誰のために・なぜ作るのか、提供価値の核を簡潔にまとめる。",
  },
  {
    file: "01-requirements.md",
    title: "要件定義",
    instructions:
      "機能要件(Must/Should/Couldごとにユーザーストーリー形式)と非機能要件(性能・セキュリティ・対応環境)。受け入れ条件を箇条書きで付ける。",
  },
  {
    file: "02-screens.md",
    title: "画面設計",
    instructions:
      "画面一覧、各画面の構成要素(セクション・主要コンポーネント)、画面間の遷移とUXフロー。主要ユースケースごとのユーザー動線を含める。",
  },
  {
    file: "03-design-system.md",
    title: "デザインシステム",
    instructions:
      "UI/UXデザイン指針。カラーパレット(HEX値)、タイポグラフィ、余白とレイアウト原則、コンポーネントのスタイル方針、インタラクション。参考ビジュアルがあればその特徴を言語化して反映する。",
  },
  {
    file: "04-architecture.md",
    title: "技術構成",
    instructions:
      "推奨技術スタックと選定理由、データモデル、ディレクトリ構成、外部依存。ローカルで dev サーバーを起動してブラウザで動く Web アプリであることを前提にする。",
  },
  {
    file: "05-implementation-plan.md",
    title: "実装計画",
    instructions:
      "実装AIエージェント(コーディングエージェント)にそのまま渡せる粒度のタスク分解。各タスクに対象ファイル・実装内容・完了条件を付け、依存順に並べる。",
  },
  {
    file: "06-evaluation-criteria.md",
    title: "自己評価基準",
    instructions:
      "ブリューシートの成功基準と自己評価の観点を、観点×5段階の採点ルーブリックに展開する。観点ごとに1点と5点の具体的な状態を記述し、機能面とUI/UX面の両方を含める。",
  },
];

const RECIPE_SYSTEM = [
  "あなたは idea brewing の発酵職人です。",
  "確定したブリューシートとグリルでの質疑応答をもとに、後続の実装AIエージェントがそのまま使える実装資料を Markdown で書きます。",
  "資料は日本語。見出し構造を明確にし、曖昧な表現を避け、具体的に書きます。",
  "ファイルの先頭は「# <資料タイトル>」の見出しで始めてください。",
].join("\n");

function sheetDump(sheet: BrewSheet): string {
  return SHEET_KEYS.map((k) => `### ${SHEET_LABELS[k]}\n${sheet[k].content || "(空)"}`).join(
    "\n\n",
  );
}

function qaDump(entries: GrillEntry[]): string {
  const answered = entries.filter((e) => e.answer);
  if (answered.length === 0) return "(質疑なし)";
  return answered.map((e, i) => `Q${i + 1}: ${e.question}\nA${i + 1}: ${e.answer}`).join("\n");
}

export async function generateRecipe(
  brew: Brew,
  client: LlmClient,
  onProgress?: (brew: Brew) => Promise<void> | void,
): Promise<Brew> {
  if (!brew.sheet) throw new Error("シートがまだありません。先に仕込みを実行してください。");
  await archiveExistingRecipe(brew.id);
  await fs.mkdir(recipeDir(brew.id), { recursive: true });

  let current: Brew = { ...brew, stage: "fermenting" };
  const generated: string[] = [];

  for (let i = 0; i < RECIPE_FILES.length; i++) {
    const def = RECIPE_FILES[i];
    current = {
      ...current,
      recipeProgress: { current: i + 1, total: RECIPE_FILES.length, file: def.file },
    };
    await onProgress?.(current);

    const prompt = [
      `## 作成する資料`,
      `ファイル名: ${def.file}`,
      `タイトル: ${def.title}`,
      `指示: ${def.instructions}`,
      `## ブリューシート(確定版)`,
      sheetDump(current.sheet!),
      `## グリルでの質疑応答`,
      qaDump(current.grill.entries),
      `## 生成済みの資料`,
      generated.length > 0 ? generated.join(", ") : "(なし)",
    ].join("\n\n");

    const text = await client.generateText({ tag: "recipe", system: RECIPE_SYSTEM, prompt });
    await fs.writeFile(path.join(recipeDir(brew.id), def.file), text, "utf8");
    generated.push(def.file);
  }

  return {
    ...current,
    stage: "done",
    recipeProgress: null,
    recipeGeneratedAt: new Date().toISOString(),
  };
}

async function archiveExistingRecipe(brewId: string): Promise<void> {
  const dir = recipeDir(brewId);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return;
  }
  if (files.length === 0) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, "history", stamp);
  await fs.mkdir(dest, { recursive: true });
  for (const f of files) {
    await fs.rename(path.join(dir, f), path.join(dest, f));
  }
}

export async function listRecipeFiles(brewId: string): Promise<string[]> {
  try {
    const files = await fs.readdir(recipeDir(brewId));
    return RECIPE_FILES.map((d) => d.file).filter((f) => files.includes(f));
  } catch {
    return [];
  }
}

export async function readRecipeFile(brewId: string, file: string): Promise<string> {
  if (!RECIPE_FILES.some((d) => d.file === file)) {
    throw new Error(`不正なファイル名です: ${file}`);
  }
  return fs.readFile(path.join(recipeDir(brewId), file), "utf8");
}
```

- [ ] **Step 4: テストが通ることを確認**

```powershell
npx vitest run tests/unit/recipe.test.ts
```

Expected: PASS(3 tests)

- [ ] **Step 5: 全テストと型チェック**

```powershell
npm run test; npx tsc --noEmit
```

Expected: 全テスト PASS、型エラーなし

- [ ] **Step 6: コミット**

```powershell
git add src/lib/recipe tests/unit/recipe.test.ts; git commit -m "feat: レシピ生成(7ファイル・履歴退避)を追加"
```

---

### Task 8: API ルート(設定・ブリュー・原料)

API ルートはロジックを持たず `lib/` を呼ぶだけの薄い層なので、単体テストは書かない(ロジックは Task 2〜7 でテスト済み、結合は Task 13 の E2E で検証)。検証は型チェックとビルドで行う。

**Files:**
- Create: `src/lib/api.ts`
- Create: `src/app/api/settings/route.ts`
- Create: `src/app/api/settings/test/route.ts`
- Create: `src/app/api/brews/route.ts`
- Create: `src/app/api/brews/[id]/route.ts`
- Create: `src/app/api/brews/[id]/ingredients/route.ts`

- [ ] **Step 1: エラー変換ヘルパー(`src/lib/api.ts`)**

```ts
import { NextResponse } from "next/server";
import { LlmNotConfiguredError } from "@/lib/llm";

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof LlmNotConfiguredError) {
    return NextResponse.json({ error: err.message, code: "not_configured" }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: 500 });
}
```

- [ ] **Step 2: 設定ルート(`src/app/api/settings/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { readSettings, writeSettings } from "@/lib/store";
import type { Settings } from "@/lib/store/types";

export async function GET() {
  return NextResponse.json(await readSettings());
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Settings;
  await writeSettings(body);
  return NextResponse.json(body);
}
```

- [ ] **Step 3: 接続テストルート(`src/app/api/settings/test/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { clientForSettings } from "@/lib/llm";
import type { Settings } from "@/lib/store/types";

export async function POST(req: Request) {
  const settings = (await req.json()) as Settings;
  try {
    const client = clientForSettings(settings);
    const reply = await client.generateText({
      tag: "connection-test",
      system: "あなたは接続テストに応答するアシスタントです。",
      prompt: "「pong」とだけ返答してください。",
    });
    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 4: ブリュー一覧/作成(`src/app/api/brews/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { createBrew, listBrews } from "@/lib/store";

export async function GET() {
  return NextResponse.json(await listBrews());
}

export async function POST(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "ブリュー名を入力してください。" }, { status: 400 });
  }
  const brew = await createBrew(name.trim());
  return NextResponse.json(brew, { status: 201 });
}
```

- [ ] **Step 5: ブリュー1件(`src/app/api/brews/[id]/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { readBrew } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await readBrew(id));
  } catch {
    return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
  }
}
```

- [ ] **Step 6: 原料追加(`src/app/api/brews/[id]/ingredients/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { readBrew, writeBrew } from "@/lib/store";
import { addFileIngredient, addTextIngredient, addUrlIngredient } from "@/lib/ingredients";
import { errorResponse } from "@/lib/api";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    let brew = await readBrew(id);
    if (brew.recipeGeneratedAt) {
      return NextResponse.json(
        { error: "レシピ生成後の原料追加はできません。ブリューシートを編集して再発酵してください。" },
        { status: 409 },
      );
    }
    const form = await req.formData();
    const text = form.get("text");
    if (typeof text === "string" && text.trim()) {
      brew = addTextIngredient(brew, text.trim());
    }
    const urls = form.get("urls");
    if (typeof urls === "string") {
      for (const url of urls.split("\n").map((u) => u.trim()).filter(Boolean)) {
        brew = await addUrlIngredient(brew, url);
      }
    }
    for (const file of form.getAll("files")) {
      if (file instanceof File) {
        const data = Buffer.from(await file.arrayBuffer());
        brew = await addFileIngredient(
          brew,
          file.name,
          file.type || "application/octet-stream",
          data,
        );
      }
    }
    const saved = await writeBrew(brew);
    return NextResponse.json(saved);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 7: 型チェック**

```powershell
npx tsc --noEmit
```

Expected: エラーなし

- [ ] **Step 8: コミット**

```powershell
git add src/lib/api.ts src/app/api; git commit -m "feat: 設定・ブリュー・原料のAPIルートを追加"
```

---

### Task 9: API ルート(仕込み・シート・グリル・レシピ)

**Files:**
- Create: `src/app/api/brews/[id]/mash/route.ts`
- Create: `src/app/api/brews/[id]/sheet/route.ts`
- Create: `src/app/api/brews/[id]/grill/route.ts`
- Create: `src/app/api/brews/[id]/recipe/route.ts`
- Create: `src/app/api/brews/[id]/recipe/[file]/route.ts`

- [ ] **Step 1: 仕込みルート(`src/app/api/brews/[id]/mash/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { readBrew, readIngredientFile, writeBrew } from "@/lib/store";
import { getConfiguredClient } from "@/lib/llm";
import type { LlmImage } from "@/lib/llm/client";
import { runMash } from "@/lib/brew-sheet";
import { errorResponse } from "@/lib/api";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const brew = await readBrew(id);
    if (brew.ingredients.filter((i) => i.status === "ok").length === 0) {
      return NextResponse.json(
        { error: "原料がありません。先に原料を投入してください。" },
        { status: 400 },
      );
    }
    const client = await getConfiguredClient();
    const images: LlmImage[] = [];
    for (const ing of brew.ingredients) {
      if (ing.kind === "image" && ing.status === "ok" && ing.filePath) {
        images.push({
          data: await readIngredientFile(brew.id, ing.filePath),
          mimeType: ing.mimeType ?? "image/png",
        });
      }
    }
    const next = await runMash(brew, client, images);
    const saved = await writeBrew(next);
    return NextResponse.json(saved);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: シート編集ルート(`src/app/api/brews/[id]/sheet/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { readBrew, writeBrew } from "@/lib/store";
import { SHEET_KEYS, type SheetKey } from "@/lib/store/types";
import { editSheetField } from "@/lib/brew-sheet";
import { errorResponse } from "@/lib/api";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { key, content } = (await req.json()) as { key: SheetKey; content: string };
    if (!SHEET_KEYS.includes(key)) {
      return NextResponse.json({ error: `不正な項目です: ${key}` }, { status: 400 });
    }
    const next = editSheetField(await readBrew(id), key, content);
    const saved = await writeBrew(next);
    return NextResponse.json(saved);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: グリルルート(`src/app/api/brews/[id]/grill/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { readBrew, writeBrew } from "@/lib/store";
import { getConfiguredClient } from "@/lib/llm";
import { applyAnswer, finishGrill, nextQuestion, setAutoMode } from "@/lib/grill";
import { errorResponse } from "@/lib/api";
import type { Brew } from "@/lib/store/types";

type GrillRequest =
  | { action: "next" }
  | { action: "answer"; entryId: string; answer: string; by: "user" | "auto" }
  | { action: "finish" }
  | { action: "auto"; auto: boolean };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as GrillRequest;
    const brew = await readBrew(id);

    if (body.action === "auto") {
      const next = setAutoMode(brew, body.auto);
      const saved = await writeBrew(next);
      return NextResponse.json({ brew: saved, entry: null });
    }
    if (body.action === "finish") {
      const next = finishGrill(brew);
      const saved = await writeBrew(next);
      return NextResponse.json({ brew: saved, entry: null });
    }

    const client = await getConfiguredClient();
    if (body.action === "next") {
      const { brew: asked, entry } = await nextQuestion(brew, client);
      // LLM 側の判断でグリルが終わったら発酵待ちステージへ進める
      const next: Brew =
        asked.grill.finished && asked.stage === "grilling"
          ? { ...asked, stage: "fermenting" }
          : asked;
      const saved = await writeBrew(next);
      return NextResponse.json({ brew: saved, entry });
    }
    const next = await applyAnswer(brew, body.entryId, body.answer, body.by, client);
    const saved = await writeBrew(next);
    return NextResponse.json({ brew: saved, entry: null });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: レシピルート(`src/app/api/brews/[id]/recipe/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { readBrew, writeBrew } from "@/lib/store";
import { getConfiguredClient } from "@/lib/llm";
import { generateRecipe, listRecipeFiles } from "@/lib/recipe";
import { errorResponse } from "@/lib/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json({ files: await listRecipeFiles(id) });
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const brew = await readBrew(id);
    if (!brew.grill.finished) {
      return NextResponse.json({ error: "グリルが完了していません。" }, { status: 400 });
    }
    const client = await getConfiguredClient();
    const done = await generateRecipe(brew, client, async (b) => {
      await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
    });
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: レシピ本文ルート(`src/app/api/brews/[id]/recipe/[file]/route.ts`)**

```ts
import { NextResponse } from "next/server";
import { readRecipeFile } from "@/lib/recipe";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await ctx.params;
  try {
    return NextResponse.json({ file, content: await readRecipeFile(id, file) });
  } catch {
    return NextResponse.json({ error: "ファイルが見つかりません。" }, { status: 404 });
  }
}
```

- [ ] **Step 6: 型チェックとビルド**

```powershell
npx tsc --noEmit; npm run build
```

Expected: エラーなし、ビルド成功

- [ ] **Step 7: コミット**

```powershell
git add src/app/api; git commit -m "feat: 仕込み・シート・グリル・レシピのAPIルートを追加"
```

---

### Task 10: UIテーマ・ダッシュボード・新しい仕込み

UI コンポーネントはロジックを `lib/` と API に寄せた薄い層なので単体テストは書かず、Task 13 の E2E で検証する。各 Step 後に `npx tsc --noEmit` が通ること。

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/components/tank-card.tsx`
- Modify: `src/app/page.tsx`(create-next-app の初期内容を置き換え)
- Create: `src/app/brews/new/page.tsx`

- [ ] **Step 1: テーマCSS(`src/app/globals.css` を置き換え)**

```css
@import "tailwindcss";

:root {
  --copper: #b87333;
  --amber: #f59e0b;
  --foam: #fef3c7;
  --tank: #2a1a0a;
}

body {
  background: linear-gradient(180deg, #140d05 0%, #1c1208 100%);
  color: var(--foam);
  min-height: 100vh;
}

@keyframes bubble-rise {
  0% {
    transform: translateY(0);
    opacity: 0.7;
  }
  100% {
    transform: translateY(-72px);
    opacity: 0;
  }
}
.bubble {
  animation: bubble-rise 2.4s linear infinite;
}
```

- [ ] **Step 2: 共通レイアウト(`src/app/layout.tsx` を置き換え)**

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Idea Brewing",
  description: "アイデアを醸造してサービスに仕上げるローカル醸造所",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className="antialiased">
        <header className="border-b border-amber-900/50 bg-black/30">
          <nav className="mx-auto flex max-w-5xl items-center justify-between p-4">
            <Link href="/" className="text-xl font-black tracking-wide text-amber-400">
              Idea Brewing
            </Link>
            <Link href="/settings" className="text-amber-200 hover:text-amber-400">
              設定
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: タンクカード(`src/components/tank-card.tsx`)**

```tsx
import Link from "next/link";
import type { Brew } from "@/lib/store/types";

const STAGE_INFO: Record<Brew["stage"], { label: string; percent: number }> = {
  ingredients: { label: "原料投入中", percent: 20 },
  grilling: { label: "グリル中", percent: 55 },
  fermenting: { label: "発酵待ち", percent: 85 },
  done: { label: "レシピ完成", percent: 100 },
};

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
      <p className="text-sm text-amber-400">{stage.label}</p>
    </Link>
  );
}
```

- [ ] **Step 4: ダッシュボード(`src/app/page.tsx` を置き換え)**

```tsx
import Link from "next/link";
import { listBrews } from "@/lib/store";
import { TankCard } from "@/components/tank-card";

export const dynamic = "force-dynamic";

export default async function Home() {
  const brews = await listBrews();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-100">醸造タンク</h1>
        <Link
          href="/brews/new"
          className="rounded-lg bg-amber-600 px-4 py-2 font-bold text-stone-950 hover:bg-amber-500"
        >
          新しい仕込み
        </Link>
      </div>
      {brews.length === 0 ? (
        <p className="text-amber-400">
          タンクは空です。「新しい仕込み」からアイデアの原料を投入してください。
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brews.map((b) => (
            <TankCard key={b.id} brew={b} />
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 5: 新しい仕込みページ(`src/app/brews/new/page.tsx`)**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const inputCls =
  "w-full rounded-lg border border-amber-900/60 bg-black/30 p-3 text-amber-50 placeholder:text-amber-200/30";

export default function NewBrewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [urls, setUrls] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/brews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const brew = await res.json();
      if (!res.ok) throw new Error(brew.error);
      if (text.trim() || urls.trim() || (files && files.length > 0)) {
        const form = new FormData();
        if (text.trim()) form.set("text", text);
        if (urls.trim()) form.set("urls", urls);
        for (const f of Array.from(files ?? [])) form.append("files", f);
        const ingRes = await fetch(`/api/brews/${brew.id}/ingredients`, {
          method: "POST",
          body: form,
        });
        if (!ingRes.ok) throw new Error((await ingRes.json()).error);
      }
      router.push(`/brews/${brew.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-amber-100">新しい仕込み</h1>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label htmlFor="name" className="mb-1 block font-bold text-amber-200">
            ブリュー名
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 最高のtodoアプリ"
            className={inputCls}
            required
          />
        </div>
        <div>
          <label htmlFor="text" className="mb-1 block font-bold text-amber-200">
            アイデアメモ
          </label>
          <textarea
            id="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="雑な一言でもOK。思いつくまま書き込んでください。"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="urls" className="mb-1 block font-bold text-amber-200">
            参考URL(1行に1つ)
          </label>
          <textarea
            id="urls"
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            rows={3}
            placeholder="https://example.com/reference-lp"
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="files" className="mb-1 block font-bold text-amber-200">
            画像・資料ファイル(.png / .jpg / .md / .txt / .pdf)
          </label>
          <input
            id="files"
            type="file"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            className="block w-full text-amber-200"
          />
        </div>
        {error && <p className="text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? "仕込み中..." : "仕込みを始める"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: 型チェックと目視確認**

```powershell
npx tsc --noEmit; npm run dev
```

http://localhost:3000 でダッシュボード(空状態)と「新しい仕込み」フォームの表示を確認し、Ctrl+C で停止。

- [ ] **Step 7: コミット**

```powershell
git add src/app src/components; git commit -m "feat: 醸造所テーマUI・ダッシュボード・新しい仕込み画面を追加"
```

---

### Task 11: ブリュー詳細ワークベンチ(4パネル)

**Files:**
- Create: `src/app/brews/[id]/page.tsx`
- Create: `src/components/brew-workbench.tsx`
- Create: `src/components/ingredients-panel.tsx`
- Create: `src/components/sheet-panel.tsx`
- Create: `src/components/grill-panel.tsx`
- Create: `src/components/recipe-panel.tsx`

- [ ] **Step 1: 詳細ページ(`src/app/brews/[id]/page.tsx`)**

```tsx
import { notFound } from "next/navigation";
import { readBrew } from "@/lib/store";
import { BrewWorkbench } from "@/components/brew-workbench";

export const dynamic = "force-dynamic";

export default async function BrewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  try {
    const brew = await readBrew(id);
    return <BrewWorkbench initial={brew} />;
  } catch {
    notFound();
  }
}
```

- [ ] **Step 2: ワークベンチ(`src/components/brew-workbench.tsx`)**

```tsx
"use client";

import { useCallback, useState } from "react";
import type { Brew } from "@/lib/store/types";
import { IngredientsPanel } from "./ingredients-panel";
import { SheetPanel } from "./sheet-panel";
import { GrillPanel } from "./grill-panel";
import { RecipePanel } from "./recipe-panel";

const TABS = [
  { id: "ingredients", label: "原料" },
  { id: "sheet", label: "ブリューシート" },
  { id: "grill", label: "グリル" },
  { id: "recipe", label: "レシピ" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function BrewWorkbench({ initial }: { initial: Brew }) {
  const [brew, setBrew] = useState(initial);
  const [tab, setTab] = useState<TabId>(initial.sheet ? "sheet" : "ingredients");

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/brews/${initial.id}`);
    if (res.ok) setBrew(await res.json());
  }, [initial.id]);

  const enabled: Record<TabId, boolean> = {
    ingredients: true,
    sheet: brew.sheet !== null,
    grill: brew.sheet !== null,
    recipe: brew.grill.finished,
  };

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold text-amber-100">{brew.name}</h1>
      <nav className="mt-4 flex gap-2 border-b border-amber-900/60">
        {TABS.map((t) => (
          <button
            key={t.id}
            disabled={!enabled[t.id]}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 font-bold ${
              tab === t.id
                ? "border-b-2 border-amber-400 text-amber-300"
                : "text-amber-200/70"
            } disabled:opacity-30`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="mt-6">
        {tab === "ingredients" && (
          <IngredientsPanel brew={brew} onUpdate={setBrew} onMashed={() => setTab("sheet")} />
        )}
        {tab === "sheet" && <SheetPanel brew={brew} onUpdate={setBrew} />}
        {tab === "grill" && <GrillPanel brew={brew} onUpdate={setBrew} />}
        {tab === "recipe" && (
          <RecipePanel brew={brew} onUpdate={setBrew} refresh={refresh} />
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: 原料パネル(`src/components/ingredients-panel.tsx`)**

```tsx
"use client";

import { useState } from "react";
import type { Brew } from "@/lib/store/types";

const inputCls =
  "w-full rounded-lg border border-amber-900/60 bg-black/30 p-3 text-amber-50 placeholder:text-amber-200/30";

const KIND_LABEL: Record<string, string> = {
  text: "テキスト",
  url: "URL",
  image: "画像",
  document: "資料",
};

export function IngredientsPanel({
  brew,
  onUpdate,
  onMashed,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
  onMashed: () => void;
}) {
  const [text, setText] = useState("");
  const [urls, setUrls] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addIngredients() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (text.trim()) form.set("text", text);
      if (urls.trim()) form.set("urls", urls);
      for (const f of Array.from(files ?? [])) form.append("files", f);
      const res = await fetch(`/api/brews/${brew.id}/ingredients`, {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onUpdate(json);
      setText("");
      setUrls("");
      setFiles(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function mash() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/mash`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onUpdate(json);
      onMashed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 font-bold text-amber-200">投入済みの原料</h2>
        {brew.ingredients.length === 0 ? (
          <p className="text-amber-200/60">まだ原料がありません。</p>
        ) : (
          <ul className="space-y-1">
            {brew.ingredients.map((ing) => (
              <li key={ing.id} className="rounded border border-amber-900/40 bg-black/20 p-2">
                <span className="mr-2 rounded bg-amber-900/60 px-2 py-0.5 text-xs">
                  {KIND_LABEL[ing.kind]}
                </span>
                <span className="text-amber-100">{ing.title}</span>
                {ing.status === "failed" && (
                  <span className="ml-2 text-sm text-red-400">取り込み失敗: {ing.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-bold text-amber-200">原料を追加</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="追加のテキストメモ"
          className={inputCls}
        />
        <textarea
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={2}
          placeholder="参考URL(1行に1つ)"
          className={inputCls}
        />
        <input
          type="file"
          multiple
          onChange={(e) => setFiles(e.target.files)}
          className="block w-full text-amber-200"
        />
        <button
          onClick={addIngredients}
          disabled={busy}
          className="rounded-lg border border-amber-600 px-4 py-2 font-bold text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
        >
          原料を追加
        </button>
      </section>

      {error && <p className="text-red-400">{error}</p>}

      <button
        onClick={mash}
        disabled={busy}
        className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
      >
        {busy ? "仕込み中..." : brew.sheet ? "再仕込み(マッシュ)" : "仕込み開始(マッシュ)"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: シートパネル(`src/components/sheet-panel.tsx`)**

```tsx
"use client";

import { useState } from "react";
import {
  SHEET_KEYS,
  SHEET_LABELS,
  type Brew,
  type SheetKey,
  type Sufficiency,
} from "@/lib/store/types";

const BADGE: Record<Sufficiency, { label: string; cls: string }> = {
  full: { label: "充足", cls: "bg-emerald-700/60 text-emerald-100" },
  thin: { label: "薄い", cls: "bg-amber-700/60 text-amber-100" },
  empty: { label: "空", cls: "bg-stone-700/60 text-stone-200" },
};

export function SheetPanel({
  brew,
  onUpdate,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
}) {
  if (!brew.sheet) {
    return <p className="text-amber-300">先に仕込みを実行してください。</p>;
  }
  return (
    <div className="space-y-4">
      {SHEET_KEYS.map((key) => (
        <FieldCard key={key} brew={brew} fieldKey={key} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function FieldCard({
  brew,
  fieldKey,
  onUpdate,
}: {
  brew: Brew;
  fieldKey: SheetKey;
  onUpdate: (b: Brew) => void;
}) {
  const field = brew.sheet![fieldKey];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field.content);
  const [error, setError] = useState<string | null>(null);
  const badge = BADGE[field.sufficiency];

  async function save() {
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/sheet`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: fieldKey, content: draft }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onUpdate(json);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="rounded-lg border border-amber-900/50 bg-black/20 p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-bold text-amber-200">{SHEET_LABELS[fieldKey]}</h3>
        <span className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
        {field.userEdited && (
          <span className="rounded bg-sky-800/60 px-2 py-0.5 text-xs text-sky-100">
            ユーザー確定
          </span>
        )}
        <button
          onClick={() => {
            setDraft(field.content);
            setEditing(!editing);
          }}
          className="ml-auto text-sm text-amber-400 hover:text-amber-300"
        >
          {editing ? "キャンセル" : "編集"}
        </button>
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-amber-900/60 bg-black/30 p-3 text-amber-50"
          />
          <button
            onClick={save}
            className="rounded bg-amber-600 px-4 py-1.5 font-bold text-stone-950 hover:bg-amber-500"
          >
            保存
          </button>
          {error && <p className="text-red-400">{error}</p>}
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-amber-50/90">
          {field.content || "(まだ情報がありません)"}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: グリルパネル(`src/components/grill-panel.tsx`)**

```tsx
"use client";

import { useState } from "react";
import type { Brew, GrillEntry } from "@/lib/store/types";

async function postGrill(
  brewId: string,
  body: unknown,
): Promise<{ brew: Brew; entry: GrillEntry | null }> {
  const res = await fetch(`/api/brews/${brewId}/grill`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "グリル操作に失敗しました");
  return json;
}

export function GrillPanel({
  brew,
  onUpdate,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(brew.grill.auto);
  const [freeText, setFreeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pending = brew.grill.entries.find((e) => !e.answer) ?? null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const next = () =>
    run(async () => {
      const { brew: b } = await postGrill(brew.id, { action: "next" });
      onUpdate(b);
    });

  const answer = (text: string, by: "user" | "auto") =>
    run(async () => {
      if (!pending) return;
      const { brew: b } = await postGrill(brew.id, {
        action: "answer",
        entryId: pending.id,
        answer: text,
        by,
      });
      onUpdate(b);
      setFreeText("");
    });

  const runAuto = () =>
    run(async () => {
      let current = (await postGrill(brew.id, { action: "auto", auto: true })).brew;
      onUpdate(current);
      let guard = 0;
      while (!current.grill.finished && guard < 50) {
        guard += 1;
        const pendingEntry = current.grill.entries.find((e) => !e.answer);
        if (pendingEntry) {
          const rec =
            pendingEntry.options.find((o) => o.recommended) ?? pendingEntry.options[0];
          current = (
            await postGrill(brew.id, {
              action: "answer",
              entryId: pendingEntry.id,
              answer: rec?.label ?? "おまかせ",
              by: "auto",
            })
          ).brew;
        } else {
          current = (await postGrill(brew.id, { action: "next" })).brew;
        }
        onUpdate(current);
      }
    });

  const finish = () =>
    run(async () => {
      const { brew: b } = await postGrill(brew.id, { action: "finish" });
      onUpdate(b);
    });

  const answered = brew.grill.entries.filter((e) => e.answer);

  return (
    <div className="space-y-6">
      {brew.grill.finished ? (
        <p className="rounded-lg border border-emerald-700/60 bg-emerald-900/30 p-4 font-bold text-emerald-200">
          煮詰め完了。「レシピ」タブから発酵(資料生成)に進めます。
        </p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-amber-200">
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />
            autoモード(推奨回答を自動選択して連続進行)
          </label>

          {pending && !auto && (
            <section className="rounded-lg border border-amber-700/60 bg-black/30 p-4">
              <p className="mb-3 font-bold text-amber-100">{pending.question}</p>
              <div className="space-y-2">
                {pending.options.map((o) => (
                  <button
                    key={o.label}
                    disabled={busy}
                    onClick={() => answer(o.label, "user")}
                    className="block w-full rounded border border-amber-800/60 p-2 text-left text-amber-50 hover:bg-amber-900/40 disabled:opacity-50"
                  >
                    {o.label}
                    {o.recommended && (
                      <span className="ml-2 rounded bg-amber-600 px-1.5 text-xs font-bold text-stone-950">
                        推奨
                      </span>
                    )}
                  </button>
                ))}
                <div className="flex gap-2">
                  <input
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    placeholder="自由記述で回答"
                    className="flex-1 rounded border border-amber-900/60 bg-black/30 p-2 text-amber-50"
                  />
                  <button
                    disabled={busy || !freeText.trim()}
                    onClick={() => answer(freeText.trim(), "user")}
                    className="rounded bg-amber-600 px-4 font-bold text-stone-950 disabled:opacity-50"
                  >
                    回答する
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className="flex gap-3">
            <button
              disabled={busy || (pending !== null && !auto)}
              onClick={() => (auto ? runAuto() : next())}
              className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
            >
              {busy
                ? "グリル中..."
                : brew.grill.entries.length === 0
                  ? "グリル開始"
                  : "次の質問"}
            </button>
            <button
              disabled={busy}
              onClick={finish}
              className="rounded-lg border border-amber-600 px-6 py-3 font-bold text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
            >
              煮詰め完了にする
            </button>
          </div>
        </div>
      )}

      {answered.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold text-amber-200">質疑の履歴</h2>
          <ul className="space-y-2">
            {answered.map((e, i) => (
              <li key={e.id} className="rounded border border-amber-900/40 bg-black/20 p-3">
                <p className="text-amber-100">
                  Q{i + 1}: {e.question}
                </p>
                <p className="text-amber-300">
                  A: {e.answer}
                  {e.answeredBy === "auto" && (
                    <span className="ml-2 rounded bg-stone-700 px-1.5 text-xs">auto</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 6: レシピパネル(`src/components/recipe-panel.tsx`)**

```tsx
"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Brew } from "@/lib/store/types";

export function RecipePanel({
  brew,
  onUpdate,
  refresh,
}: {
  brew: Brew;
  onUpdate: (b: Brew) => void;
  refresh: () => Promise<void>;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/brews/${brew.id}/recipe`);
      const json = await res.json();
      if (!cancelled) setFiles(json.files ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [brew.id, brew.recipeGeneratedAt]);

  async function generate() {
    setBusy(true);
    setError(null);
    const poll = setInterval(() => void refresh(), 1000);
    try {
      const res = await fetch(`/api/brews/${brew.id}/recipe`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      onUpdate(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(poll);
      setBusy(false);
    }
  }

  async function open(file: string) {
    const res = await fetch(`/api/brews/${brew.id}/recipe/${file}`);
    const json = await res.json();
    if (res.ok) {
      setSelected(file);
      setContent(json.content);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={generate}
          disabled={busy}
          className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
        >
          {busy
            ? "発酵中..."
            : brew.recipeGeneratedAt
              ? "再発酵(レシピ再生成)"
              : "レシピ生成"}
        </button>
        {brew.recipeProgress && (
          <p className="text-amber-300">
            {brew.recipeProgress.current}/{brew.recipeProgress.total}:{" "}
            {brew.recipeProgress.file} を生成中...
          </p>
        )}
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {files.length > 0 && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f}>
                <button
                  onClick={() => open(f)}
                  className={`w-full rounded p-2 text-left text-sm ${
                    selected === f
                      ? "bg-amber-900/60 text-amber-100"
                      : "text-amber-300 hover:bg-amber-900/30"
                  }`}
                >
                  {f}
                </button>
              </li>
            ))}
          </ul>
          <article className="prose prose-invert prose-amber max-w-none rounded-lg border border-amber-900/40 bg-black/20 p-6">
            {selected ? (
              <ReactMarkdown>{content}</ReactMarkdown>
            ) : (
              <p className="text-amber-200/60">左の一覧からファイルを選択してください。</p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: 型チェックとフェイクLLMでの手動確認**

```powershell
npx tsc --noEmit
New-Item -ItemType Directory -Force data | Out-Null
Set-Content data/settings.json '{"provider":"fake","apiKey":"","baseUrl":"","model":"fake"}'
npm run dev
```

ブラウザで「新しい仕込み」→ テキスト投入 → 仕込み → グリル(auto)→ 煮詰め完了 → レシピ生成まで一周し、`data/brews/<id>/recipe/` に7ファイルできることを確認。確認後 `data/settings.json` は実プロバイダ設定に戻すか削除してよい。

- [ ] **Step 8: コミット**

```powershell
git add src/app/brews src/components; git commit -m "feat: ブリュー詳細ワークベンチ(原料/シート/グリル/レシピ)を追加"
```

---

### Task 12: 設定画面(BYOK)

**Files:**
- Create: `src/app/settings/page.tsx`

- [ ] **Step 1: 設定ページを実装**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/store/types";

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
  { id: "ollama", label: "Ollama(ローカル)" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

const inputCls =
  "w-full rounded-lg border border-amber-900/60 bg-black/30 p-3 text-amber-50";

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  if (!settings) {
    return <main className="p-6 text-amber-300">読み込み中...</main>;
  }
  const s = settings;

  async function save() {
    setStatus(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    setStatus(res.ok ? "保存しました。" : "保存に失敗しました。");
  }

  async function testConnection() {
    setStatus("接続テスト中...");
    const res = await fetch("/api/settings/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(s),
    });
    const json = await res.json();
    setStatus(json.ok ? `接続OK: ${json.reply}` : `接続失敗: ${json.error}`);
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-2 text-2xl font-bold text-amber-100">設定</h1>
      <p className="mb-6 text-sm text-amber-200/70">
        APIキーはこのPCの data/settings.json にのみ保存され、プロバイダAPI以外に送信されません。
      </p>
      <div className="space-y-5">
        <div>
          <label htmlFor="provider" className="mb-1 block font-bold text-amber-200">
            プロバイダ
          </label>
          <select
            id="provider"
            value={s.provider}
            onChange={(e) =>
              setSettings({ ...s, provider: e.target.value as Settings["provider"] })
            }
            className={inputCls}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {s.provider !== "ollama" && (
          <div>
            <label htmlFor="apiKey" className="mb-1 block font-bold text-amber-200">
              APIキー
            </label>
            <input
              id="apiKey"
              type="password"
              value={s.apiKey}
              onChange={(e) => setSettings({ ...s, apiKey: e.target.value })}
              className={inputCls}
            />
          </div>
        )}
        {s.provider === "ollama" && (
          <div>
            <label htmlFor="baseUrl" className="mb-1 block font-bold text-amber-200">
              ベースURL
            </label>
            <input
              id="baseUrl"
              value={s.baseUrl}
              onChange={(e) => setSettings({ ...s, baseUrl: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label htmlFor="model" className="mb-1 block font-bold text-amber-200">
            モデル名
          </label>
          <input
            id="model"
            value={s.model}
            onChange={(e) => setSettings({ ...s, model: e.target.value })}
            placeholder="例: gpt-5.3 / gemini-2.5-pro / llama3"
            className={inputCls}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={save}
            className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500"
          >
            保存
          </button>
          <button
            onClick={testConnection}
            className="rounded-lg border border-amber-600 px-6 py-3 font-bold text-amber-300 hover:bg-amber-900/40"
          >
            接続テスト
          </button>
        </div>
        {status && <p className="text-amber-200">{status}</p>}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: 型チェックとビルド**

```powershell
npx tsc --noEmit; npm run build
```

Expected: エラーなし、ビルド成功

- [ ] **Step 3: コミット**

```powershell
git add src/app/settings; git commit -m "feat: BYOK設定画面(プロバイダ・キー・モデル・接続テスト)を追加"
```

---

### Task 13: E2E ハッピーパス(Playwright + フェイクLLM)

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/global-setup.ts`
- Create: `tests/e2e/happy-path.spec.ts`

- [ ] **Step 1: Playwright のブラウザをインストール**

```powershell
npx playwright install chromium
```

- [ ] **Step 2: グローバルセットアップ(`tests/e2e/global-setup.ts`)**

E2E 用データディレクトリを毎回作り直し、フェイクプロバイダ設定を書き込む。

```ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), ".e2e-data");

export default function globalSetup() {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    path.join(dataDir, "settings.json"),
    JSON.stringify({ provider: "fake", apiKey: "", baseUrl: "", model: "fake" }),
  );
}
```

- [ ] **Step 3: Playwright 設定(`playwright.config.ts`)**

```ts
import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  use: { baseURL: "http://localhost:3105" },
  webServer: {
    command: "npm run dev -- --port 3105",
    url: "http://localhost:3105",
    env: { IDEA_BREWING_DATA_DIR: path.join(process.cwd(), ".e2e-data") },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

- [ ] **Step 4: ハッピーパステスト(`tests/e2e/happy-path.spec.ts`)**

```ts
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("原料投入からレシピ生成までのハッピーパス", async ({ page }) => {
  // 1. 新しい仕込み
  await page.goto("/");
  await page.getByRole("link", { name: "新しい仕込み" }).click();
  await page.getByLabel("ブリュー名").fill("最高のtodoアプリ");
  await page.getByLabel("アイデアメモ").fill("最高のtodoアプリ");
  await page.getByRole("button", { name: "仕込みを始める" }).click();

  // 2. 仕込み(マッシュ)
  await page.getByRole("button", { name: "仕込み開始(マッシュ)" }).click();
  await expect(page.getByRole("heading", { name: "コンセプト", exact: true })).toBeVisible();

  // 3. グリル(auto)
  await page.getByRole("button", { name: "グリル", exact: true }).click();
  await page.getByLabel("autoモード", { exact: false }).check();
  await page.getByRole("button", { name: "グリル開始" }).click();
  // 「煮詰め完了にする」ボタンと区別するため句点付きの完了メッセージで待つ
  await expect(page.getByText("煮詰め完了。")).toBeVisible({ timeout: 30_000 });

  // 4. レシピ生成(発酵)
  await page.getByRole("button", { name: "レシピ", exact: true }).click();
  await page.getByRole("button", { name: "レシピ生成" }).click();
  await expect(page.getByText("06-evaluation-criteria.md")).toBeVisible({
    timeout: 60_000,
  });

  // 5. ファイルが実際にディスクへ出力されている
  const brewsDir = path.join(process.cwd(), ".e2e-data", "brews");
  const ids = readdirSync(brewsDir);
  expect(ids).toHaveLength(1);
  for (const f of [
    "00-overview.md",
    "01-requirements.md",
    "02-screens.md",
    "03-design-system.md",
    "04-architecture.md",
    "05-implementation-plan.md",
    "06-evaluation-criteria.md",
  ]) {
    expect(existsSync(path.join(brewsDir, ids[0], "recipe", f))).toBe(true);
  }
});
```

注意: グリルタブのタブボタンとレシピタブのタブボタンは `getByRole("button")` でマッチさせている。「レシピ生成」ボタンと「レシピ」タブが部分一致で衝突するため、タブ側は `exact: true` を使う。実装後にセレクタが曖昧でエラーになる場合は `page.locator("nav button", { hasText: "レシピ" })` のようにタブのスコープを絞ること。

- [ ] **Step 5: E2E 実行**

```powershell
npm run e2e
```

Expected: 1 passed

- [ ] **Step 6: コミット**

```powershell
git add playwright.config.ts tests/e2e; git commit -m "test: フェイクLLMによるE2Eハッピーパスを追加"
```

---

### Task 14: README と最終確認

**Files:**
- Modify: `README.md`(create-next-app の初期内容を置き換え)

- [ ] **Step 1: README.md を置き換え**

```markdown
# Idea Brewing

アイデアをビールの醸造のように仕込み、煮詰め、発酵させて「実装資料一式(レシピ)」に仕上げるローカルWebアプリ。

テキスト・画像・URL・ファイルを原料として投入すると、設定したLLMが7項目の「ブリューシート」に構造化し、
グリル工程(1問ずつの質問攻め、autoモードあり)で曖昧さを煮詰め、実装AIエージェントにそのまま渡せる
実装資料7ファイルを生成します。

## セットアップ

\`\`\`powershell
npm install
npm run dev
\`\`\`

http://localhost:3000 を開き、まず「設定」からLLMを設定します。

## LLM設定(BYOK / ローカルLLM)

| プロバイダ | 必要な設定 |
|---|---|
| OpenAI | APIキー、モデル名 |
| Google (Gemini) | APIキー、モデル名 |
| Ollama(ローカル) | ベースURL(既定: http://localhost:11434/v1)、モデル名 |
| OpenRouter | APIキー、モデル名 |

APIキーは `data/settings.json` にのみ保存され、プロバイダAPI以外へ送信されません。

## 使い方

1. **新しい仕込み** — ブリュー名と原料(テキスト・URL・画像・.md/.txt/.pdf)を投入
2. **仕込み(マッシュ)** — LLMが原料をブリューシート7項目に構造化(充足度付き)
3. **グリル** — 不足項目への質問に1問ずつ回答。autoモードなら推奨回答で自動進行
4. **レシピ生成(発酵)** — 実装資料7ファイル(概要/要件/画面/デザイン/構成/実装計画/評価基準)を生成

成果物は `data/brews/<ID>/recipe/` に Markdown として保存され、エクスプローラーから直接読めます。

## テスト

\`\`\`powershell
npm run test   # 単体テスト(Vitest)
npm run e2e    # E2E(Playwright + フェイクLLM)
\`\`\`

## ロードマップ

- Phase 2: レシピを Cursor CLI/SDK に渡してコード生成(ビルド工程)
- Phase 3: 自己評価→自己改善のバッチループ(熟成)
- Phase 4: AIユーザーテスト環境「Pub」とリーダーボード
```

(コードブロック内の `\`\`\`` は実際にはエスケープなしの ``` で書くこと)

- [ ] **Step 2: 最終確認(全テスト・型・ビルド・E2E)**

```powershell
npm run test; npx tsc --noEmit; npm run build; npm run e2e
```

Expected: すべて成功

- [ ] **Step 3: スペックの完了条件チェック**

スペック10章の完了条件を確認:

1. 「最高のtodoアプリ」一言 → レシピ7ファイル生成: E2E でカバー済み
2. 画像+URL+テキストの組み合わせ: フェイク設定の dev サーバーで手動確認(画像とURLを含めて一周)
3. Ollama / OpenAI どちらでも動作: 実キーまたはローカル Ollama で設定画面の接続テスト→1ブリュー実走
4. レシピがエクスプローラーから直接読める: 手動確認
5. 単体テスト・E2E が通る: Step 2 でカバー済み

- [ ] **Step 4: コミット**

```powershell
git add README.md; git commit -m "docs: READMEを整備"
```

---

## セルフレビュー記録

- **スペック網羅**: 原料投入(5.1→Task 4,8,10,11)、仕込み(5.2→Task 5,9)、グリル(5.3→Task 6,9,11)、レシピ生成(5.4→Task 7,9,11)、設定(5.5→Task 8,12)、エラー処理(7章→`errorResponse`/各パネルのエラー表示/原料の failed 記録)、テスト方針(8章→Task 2〜7,13)。
- **グリルの巻き戻し(5.3)**: 第1版スコープから外し、履歴閲覧のみとする(質問のやり直しは将来拡張)。スペックの「遡って回答をやり直せる」は auto の一時停止と手動回答切替で部分カバー。実装中に余裕があっても追加しないこと(YAGNI)。
- **型整合**: `Brew`/`BrewSheet`/`Settings`/`GrillEntry` は Task 2 の定義を全タスクで参照。グリルAPIの応答形 `{ brew, entry }` は Task 9 と Task 11 で一致。レシピAPIの応答形(POST=Brew、GET=`{files}`、`[file]`=`{file,content}`)は Task 9 と Task 11 で一致。





