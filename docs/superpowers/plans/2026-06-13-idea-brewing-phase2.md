# idea brewing 第2版(ビルド工程・タップ)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レシピ完成済みのブリューに対し、Cursor SDK のエージェントがコードを生成(ビルド)し、ローカル dev サーバーとして起動(タップ)できるようにする。

**Architecture:** 既存 Next.js アプリに `lib/tap` モジュール群を追加。`BuildEngine` 抽象(Cursor SDK 実装 + フェイク)+ テンプレートコピー + 検証/修理ループのオーケストレータ + dev サーバーマネージャ。進捗は brew.json 永続化 + 1 秒ポーリング(第1版のレシピ生成と同じパターン)。

**Tech Stack:** Next.js 16 / TypeScript / `@cursor/sdk`(1.0.x)/ Vite + React + Tailwind v4(生成物テンプレート)/ Vitest / Playwright

**設計書:** `docs/superpowers/specs/2026-06-13-idea-brewing-phase2-design.md`(必読)

---

## 環境上の注意(全タスク共通)

- シェルは Windows PowerShell 5.1。コマンド連結は `&&` ではなく `;` を使う。
- 日本語コミットメッセージが文字化けする場合は UTF-8 ファイル経由で `git commit -F <file>` を使う。
- `npm run e2e` は `npm run dev` 稼働中だと失敗する(Next 16 は同一ディレクトリの dev サーバー二重起動を禁止)。実行前に既存 dev サーバーを停止すること。
- 既存の UI ラベル(E2E が依存)は一切変更しない。
- 作業ブランチ: `feat/phase2-tap`(master から作成)。

## ファイル構成(新規/変更の全体像)

| パス | 種別 | 責務 |
|---|---|---|
| `src/lib/store/types.ts` | 変更 | `BatchRecord` / `BuildProgress` / stage `"built"` / `Settings` 拡張 |
| `src/lib/store/index.ts` | 変更 | `tapDir()` 追加、`readBrew` のデフォルト補完、`createBrew` 初期値 |
| `src/lib/tap/build-state.ts` | 新規 | `CancelToken` 型、インメモリのビルドロックと中断トークン |
| `src/lib/tap/engine.ts` | 新規 | `BuildEngine` / `BuildSession` インターフェース |
| `src/lib/tap/fake-engine.ts` | 新規 | テスト用フェイクエンジン |
| `src/lib/tap/cursor-engine.ts` | 新規 | `@cursor/sdk` 実装 |
| `src/lib/tap/resolve.ts` | 新規 | エンジン選択(`TapNotConfiguredError` 含む) |
| `src/lib/tap/runner.ts` | 新規 | `CommandRunner`(実 spawn + フェイク) |
| `src/lib/tap/tasks.ts` | 新規 | `05-implementation-plan.md` のタスク抽出 |
| `src/lib/tap/template.ts` | 新規 | テンプレートコピー・レシピ同梱・`tap.json` 読み込み |
| `src/lib/tap/index.ts` | 新規 | ビルドオーケストレータ `runBuild` |
| `src/lib/tap/server-manager.ts` | 新規 | 生成アプリ dev サーバーの起動/停止/状態 |
| `templates/tap-vite/` | 新規 | Vite + React + TS + Tailwind ひな形(本番用) |
| `templates/tap-fake/` | 新規 | 依存ゼロのフェイクひな形(テスト用) |
| `src/app/api/brews/[id]/tap/build/route.ts` | 新規 | ビルド開始 POST |
| `src/app/api/brews/[id]/tap/cancel/route.ts` | 新規 | ビルド中断 POST |
| `src/app/api/brews/[id]/tap/server/route.ts` | 新規 | サーバー状態 GET / 起動・停止 POST |
| `src/app/api/brews/[id]/tap/log/route.ts` | 新規 | build.log テール GET |
| `src/components/tap-panel.tsx` | 新規 | タップタブの UI |
| `src/components/brew-workbench.tsx` | 変更 | 「タップ」タブ追加 |
| `src/components/tank-card.tsx` | 変更 | `built` ステージ表示 |
| `src/app/settings/page.tsx` | 変更 | ビルドエンジン(Cursor)設定セクション |
| `tests/unit/store.test.ts` | 変更 | 設定デフォルト・旧 brew.json 補完テスト |
| `tests/unit/tasks.test.ts` | 新規 | タスク抽出テスト |
| `tests/unit/template.test.ts` | 新規 | テンプレートコピーテスト |
| `tests/unit/tap.test.ts` | 新規 | オーケストレータ状態遷移テスト |
| `tests/unit/server-manager.test.ts` | 新規 | サーバー起動/停止テスト(実 spawn) |
| `tests/e2e/happy-path.spec.ts` | 変更 | ビルド → 注ぐ → 停止まで延長 |
| `.gitignore` | 変更 | `templates/**/node_modules/` `templates/**/dist/` |
| `README.md` | 変更 | タップ工程・Cursor キー設定・手動確認手順 |

---

### タスク1: 依存追加と設定拡張(Cursor BYOK)

**Files:**
- Modify: `package.json`(`npm install @cursor/sdk` による)
- Modify: `src/lib/store/types.ts`
- Modify: `src/lib/store/index.ts`(DEFAULT_SETTINGS)
- Modify: `src/app/settings/page.tsx`
- Modify: `tests/unit/store.test.ts`

- [ ] **Step 1: ブランチ作成と依存追加**

```powershell
git checkout -b feat/phase2-tap; npm install @cursor/sdk
```

- [ ] **Step 2: 失敗するテストを追加**

`tests/unit/store.test.ts` に追加(既存の describe 内、既存のテスト環境セットアップに従う):

```ts
it("設定の既定値に Cursor 用フィールドが入る", async () => {
  const s = await readSettings();
  expect(s.cursorApiKey).toBe("");
  expect(s.cursorModel).toBe("composer-2.5");
});
```

Run: `npm run test` → Expected: FAIL(`cursorApiKey` が undefined / 型エラー)

- [ ] **Step 3: 型と既定値を実装**

`src/lib/store/types.ts` の `Settings` を:

```ts
export interface Settings {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Cursor SDK(タップ工程)のAPIキー。空なら環境変数 CURSOR_API_KEY にフォールバック */
  cursorApiKey: string;
  /** タップ工程で使うモデルID */
  cursorModel: string;
}
```

`src/lib/store/index.ts` の DEFAULT_SETTINGS を:

```ts
const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: "",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
};
```

Run: `npm run test` → Expected: PASS(既存テスト含む全件)

- [ ] **Step 4: 設定画面にセクション追加**

`src/app/settings/page.tsx` を読み、モデル名入力ブロックの直後・ボタン行の前に以下を追加する。**入力の className・状態変数名(`settings` / `setSettings` 等)は既存コードに正確に合わせる**(以下は構造の指定):

```tsx
<h2 className="mt-8 text-lg font-bold text-amber-100">ビルドエンジン(Cursor)</h2>
<p className="mt-1 text-sm text-amber-200/70">
  タップ工程(コード生成)で使う Cursor SDK の設定です。ビルドを使わない場合は未設定で構いません。
</p>
<div className="mt-3">
  <label htmlFor="cursorApiKey" className="block font-bold">Cursor APIキー</label>
  <input
    id="cursorApiKey"
    type="password"
    autoComplete="off"
    value={settings.cursorApiKey}
    onChange={(e) => setSettings({ ...settings, cursorApiKey: e.target.value })}
    placeholder="cursor_..."
  />
  <p className="text-xs text-amber-200/60">空の場合は環境変数 CURSOR_API_KEY を使います。</p>
</div>
<div className="mt-3">
  <label htmlFor="cursorModel" className="block font-bold">ビルドモデル名</label>
  <input
    id="cursorModel"
    type="text"
    value={settings.cursorModel}
    onChange={(e) => setSettings({ ...settings, cursorModel: e.target.value })}
    placeholder="composer-2.5"
  />
</div>
```

注意: 既存の「保存」「接続テスト」ボタン・busy 制御はそのまま使う(保存は Settings 全体を PUT するため変更不要)。

- [ ] **Step 5: 検証**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run build` → Expected: すべて成功

- [ ] **Step 6: コミット**

```
feat: Cursor SDK依存とビルドエンジン設定(BYOK)を追加
```

---

### タスク2: ドメイン拡張(バッチ・ビルド進捗・builtステージ)

**Files:**
- Modify: `src/lib/store/types.ts`
- Modify: `src/lib/store/index.ts`
- Modify: `src/components/tank-card.tsx`
- Modify: `tests/unit/store.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`tests/unit/store.test.ts` に追加(`brewDir` を import に加える):

```ts
it("旧スキーマの brew.json に batches と buildProgress が補完される", async () => {
  const brew = await createBrew("旧データ");
  const file = path.join(brewDir(brew.id), "brew.json");
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  delete raw.batches;
  delete raw.buildProgress;
  await fs.writeFile(file, JSON.stringify(raw), "utf8");
  const loaded = await readBrew(brew.id);
  expect(loaded.batches).toEqual([]);
  expect(loaded.buildProgress).toBeNull();
});
```

Run: `npm run test` → Expected: FAIL

- [ ] **Step 2: 型を拡張**

`src/lib/store/types.ts` に追加し、`BrewStage` と `Brew` を変更:

```ts
export type BatchStatus = "building" | "succeeded" | "failed" | "cancelled";

export interface BatchRecord {
  number: number; // 1始まり。第2版では常に1
  status: BatchStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export type BuildPhase = "preparing" | "generating" | "verifying" | "repairing";

export interface BuildProgress {
  phase: BuildPhase;
  detail: string;
}

export type BrewStage = "ingredients" | "grilling" | "fermenting" | "done" | "built";

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
}
```

- [ ] **Step 3: ストアを実装**

`src/lib/store/index.ts`:

```ts
export function tapDir(id: string, batch: number): string {
  return path.join(brewDir(id), "taps", `batch-${batch}`);
}
```

`createBrew` の初期値に `batches: [], buildProgress: null,` を追加。

`readBrew` を旧データ補完つきに変更:

```ts
export async function readBrew(id: string): Promise<Brew> {
  const raw = await fs.readFile(path.join(brewDir(id), "brew.json"), "utf8");
  const parsed = JSON.parse(raw) as Brew;
  // 第1版で作られた brew.json には batches / buildProgress が無いので補完する
  return { batches: [], buildProgress: null, ...parsed };
}
```

- [ ] **Step 4: タンクカードに built を追加**

`src/components/tank-card.tsx` の `STAGE_INFO` に追加(型が `Record<Brew["stage"], ...>` のため追加しないとコンパイルエラーになる):

```ts
built: { label: "提供中(ビルド済み)", percent: 100 },
```

- [ ] **Step 5: 検証とコミット**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run build` → Expected: すべて成功

```
feat: バッチ記録・ビルド進捗・builtステージをドメインに追加
```

---

### タスク3: 生成物テンプレート(tap-vite / tap-fake)とコピー処理

**Files:**
- Create: `templates/tap-vite/`(下記一式)
- Create: `templates/tap-fake/`(下記一式)
- Create: `src/lib/tap/template.ts`
- Create: `tests/unit/template.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: .gitignore に追加**

```
# tap templates (作業時の生成物)
templates/**/node_modules/
templates/**/dist/
```

- [ ] **Step 2: tap-vite テンプレートを作成**

`templates/tap-vite/package.json`:

```json
{
  "name": "tap-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.1.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.0",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0"
  }
}
```

`templates/tap-vite/tap.json`(オーケストレータが読む検証マニフェスト):

```json
{
  "verify": ["npm install", "npx tsc --noEmit", "npx vite build"]
}
```

`templates/tap-vite/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

`templates/tap-vite/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

`templates/tap-vite/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tap App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`templates/tap-vite/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`templates/tap-vite/src/App.tsx`:

```tsx
export default function App() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-bold">ここにレシピが注がれます</h1>
    </main>
  );
}
```

`templates/tap-vite/src/index.css`:

```css
@import "tailwindcss";
```

`templates/tap-vite/.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 3: tap-vite の動作確認とロックファイル生成**

テンプレートの再現性のため、テンプレート内で一度 install + 検証を実行し、生成された `package-lock.json` をテンプレートの一部としてコミットする:

```powershell
cd templates/tap-vite; npm install; npx tsc --noEmit; npx vite build; cd ../..
```

Expected: すべて成功(`dist/` が生成される)。`node_modules/` と `dist/` は gitignore 済みであることを `git status` で確認。

- [ ] **Step 4: tap-fake テンプレートを作成**

`templates/tap-fake/package.json`:

```json
{
  "name": "tap-fake-app",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "node server.js"
  }
}
```

`templates/tap-fake/tap.json`:

```json
{
  "verify": ["node --version"]
}
```

`templates/tap-fake/server.js`:

```js
const http = require("node:http");

let port = 5173;
const idx = process.argv.indexOf("--port");
if (idx !== -1 && process.argv[idx + 1]) port = Number(process.argv[idx + 1]);

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html lang="ja"><body><h1>フェイクタップアプリ</h1></body></html>');
  })
  .listen(port, () => console.log(`fake tap app on http://localhost:${port}`));
```

- [ ] **Step 5: 失敗するテストを書く**

`tests/unit/template.test.ts`(既存テストの環境セットアップ方式 = `IDEA_BREWING_DATA_DIR` を一時ディレクトリへ向ける方式に従う):

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareBatchDir, readManifest } from "@/lib/tap/template";
import { createBrew, recipeDir } from "@/lib/store";
import { RECIPE_FILES } from "@/lib/recipe";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("prepareBatchDir", () => {
  it("フェイクテンプレートとレシピを配置する", async () => {
    const brew = await createBrew("テンプレ");
    await fs.mkdir(recipeDir(brew.id), { recursive: true });
    for (const def of RECIPE_FILES) {
      await fs.writeFile(path.join(recipeDir(brew.id), def.file), `# ${def.title}`, "utf8");
    }
    const dir = await prepareBatchDir(brew.id, 1, "tap-fake");
    const pkg = JSON.parse(await fs.readFile(path.join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("tap-fake-app");
    const overview = await fs.readFile(path.join(dir, "docs", "recipe", "00-overview.md"), "utf8");
    expect(overview).toContain("サービス概要");
    const manifest = await readManifest(dir);
    expect(Array.isArray(manifest.verify)).toBe(true);
    expect(manifest.verify.length).toBeGreaterThan(0);
  });

  it("再実行で前回の生成物が消える", async () => {
    const brew = await createBrew("テンプレ2");
    const dir = await prepareBatchDir(brew.id, 1, "tap-fake");
    await fs.writeFile(path.join(dir, "leftover.txt"), "old", "utf8");
    await prepareBatchDir(brew.id, 1, "tap-fake");
    await expect(fs.access(path.join(dir, "leftover.txt"))).rejects.toThrow();
  });
});
```

Run: `npm run test` → Expected: FAIL(モジュールなし)

- [ ] **Step 6: template.ts を実装**

`src/lib/tap/template.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { recipeDir, tapDir } from "@/lib/store";
import { RECIPE_FILES } from "@/lib/recipe";

export type TemplateId = "tap-vite" | "tap-fake";

export interface TapManifest {
  /** シェルで順に実行する検証コマンド。1つでも失敗したら検証失敗 */
  verify: string[];
}

export function templateDir(template: TemplateId): string {
  return path.join(process.cwd(), "templates", template);
}

/**
 * バッチフォルダを作り直してテンプレートをコピーし、レシピ一式を docs/recipe/ に同梱する。
 * 既存のバッチフォルダは丸ごと削除する(第2版では batch-1 の再ビルド = 上書き)。
 */
export async function prepareBatchDir(
  brewId: string,
  batch: number,
  template: TemplateId,
): Promise<string> {
  const dest = tapDir(brewId, batch);
  await fs.rm(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fs.cp(templateDir(template), dest, {
    recursive: true,
    filter: (src) => !src.includes("node_modules") && !src.includes(`${path.sep}dist`),
  });
  const docsDir = path.join(dest, "docs", "recipe");
  await fs.mkdir(docsDir, { recursive: true });
  for (const def of RECIPE_FILES) {
    try {
      await fs.copyFile(path.join(recipeDir(brewId), def.file), path.join(docsDir, def.file));
    } catch {
      // 存在しないレシピファイルはスキップ(呼び出し側でレシピ生成済みを検証している)
    }
  }
  return dest;
}

export async function readManifest(batchDir: string): Promise<TapManifest> {
  const raw = await fs.readFile(path.join(batchDir, "tap.json"), "utf8");
  return JSON.parse(raw) as TapManifest;
}
```

Run: `npm run test` → Expected: PASS

- [ ] **Step 7: 検証とコミット**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run build` → Expected: すべて成功

```
feat: タップ用テンプレート(Vite/フェイク)とバッチ準備処理を追加
```

---

### タスク4: タスク抽出とエンジン層(インターフェース・フェイク・ランナー)

**Files:**
- Create: `src/lib/tap/tasks.ts`
- Create: `src/lib/tap/engine.ts`
- Create: `src/lib/tap/fake-engine.ts`
- Create: `src/lib/tap/runner.ts`
- Create: `src/lib/tap/build-state.ts`
- Create: `tests/unit/tasks.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractTasks } from "@/lib/tap/tasks";

describe("extractTasks", () => {
  it("第2レベル見出しをタスクとして抽出する", () => {
    const md = [
      "# 実装計画",
      "",
      "前置き",
      "",
      "## タスク1: 土台",
      "本文1",
      "",
      "### 詳細",
      "詳細本文",
      "",
      "## タスク2: 画面",
      "本文2",
    ].join("\n");
    const tasks = extractTasks(md);
    expect(tasks.map((t) => t.title)).toEqual(["タスク1: 土台", "タスク2: 画面"]);
    expect(tasks[0].body).toContain("本文1");
    expect(tasks[0].body).toContain("### 詳細");
    expect(tasks[1].body).toBe("本文2");
  });

  it("見出しが無ければ空配列(一括実装フォールバック)", () => {
    expect(extractTasks("ただの文章")).toEqual([]);
    expect(extractTasks("")).toEqual([]);
  });
});
```

Run: `npm run test` → Expected: FAIL

- [ ] **Step 2: tasks.ts を実装**

`src/lib/tap/tasks.ts`:

```ts
export interface PlanTask {
  title: string;
  body: string;
}

/** 05-implementation-plan.md の第2レベル見出し(## )を1タスクとして抽出する */
export function extractTasks(markdown: string): PlanTask[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: PlanTask[] = [];
  let current: PlanTask | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+)$/.exec(line);
    if (m) {
      if (current) tasks.push(current);
      current = { title: m[1].trim(), body: "" };
    } else if (current) {
      current.body += line + "\n";
    }
  }
  if (current) tasks.push(current);
  return tasks.map((t) => ({ ...t, body: t.body.trim() }));
}
```

Run: `npm run test` → Expected: PASS

- [ ] **Step 3: エンジンインターフェースとフェイクを実装**

`src/lib/tap/engine.ts`:

```ts
export interface BuildSendResult {
  ok: boolean;
  summary: string;
}

export interface BuildSession {
  send(prompt: string): Promise<BuildSendResult>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export interface BuildEngineOptions {
  cwd: string;
  onLog: (line: string) => void;
}

export interface BuildEngine {
  createSession(opts: BuildEngineOptions): Promise<BuildSession>;
}
```

`src/lib/tap/build-state.ts`:

```ts
export interface CancelToken {
  cancelled: boolean;
}

// ビルド実行中のブリューID(レシピ生成と同じインメモリロック方式。
// クラッシュ時の永久ロックを防ぎ、再起動でリセットされるのは許容)
export const buildingBrews = new Set<string>();

// ビルド中断用トークン(buildルートが登録し、cancelルートが立てる)
export const cancelTokens = new Map<string, CancelToken>();
```

`src/lib/tap/fake-engine.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BuildEngine, BuildSession } from "./engine";

export interface FakeBuildEngineOptions {
  /** 先頭から指定回数だけ send を失敗させる */
  failSends?: number;
  /** 各 send 完了後に呼ばれる(中断テスト用) */
  afterSend?: (count: number) => void;
}

/** SDKを呼ばない決定論的エンジン。プロンプトを記録し、cwd に痕跡ファイルを書く */
export function createFakeBuildEngine(
  opts?: FakeBuildEngineOptions,
): BuildEngine & { prompts: string[] } {
  const prompts: string[] = [];
  let remainingFailures = opts?.failSends ?? 0;
  return {
    prompts,
    async createSession({ cwd, onLog }) {
      const session: BuildSession = {
        async send(prompt: string) {
          prompts.push(prompt);
          onLog(`[fake-engine] send: ${prompt.slice(0, 60)}`);
          await fs.appendFile(path.join(cwd, "agent-log.txt"), prompt + "\n---\n", "utf8");
          opts?.afterSend?.(prompts.length);
          if (remainingFailures > 0) {
            remainingFailures--;
            return { ok: false, summary: "fake failure" };
          }
          return { ok: true, summary: "fake done" };
        },
        async cancel() {},
        async dispose() {},
      };
      return session;
    },
  };
}
```

- [ ] **Step 4: ランナーを実装**

`src/lib/tap/runner.ts`:

```ts
import { spawn } from "node:child_process";

export interface CommandResult {
  ok: boolean;
  output: string;
}

export interface RunOptions {
  cwd: string;
  onLog?: (line: string) => void;
  timeoutMs?: number;
}

export interface CommandRunner {
  run(command: string, opts: RunOptions): Promise<CommandResult>;
}

/**
 * 実コマンド実行。Windows互換のため文字列コマンド+shell実行。
 * command には固定文字列のみ渡すこと(ユーザー入力を混ぜない)。
 */
export const realRunner: CommandRunner = {
  run(command, { cwd, onLog, timeoutMs = 600_000 }) {
    return new Promise((resolve) => {
      const child = spawn(command, { cwd, shell: true });
      let output = "";
      const onData = (buf: Buffer) => {
        const text = buf.toString();
        output += text;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) onLog?.(line);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, output });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ ok: false, output: output + String(err) });
      });
    });
  },
};

export interface FakeRunnerStep {
  ok: boolean;
  output?: string;
}

/** 呼び出しごとに steps を先頭から消費するフェイク。steps が尽きたら成功を返す */
export function createFakeRunner(
  steps: FakeRunnerStep[] = [],
): CommandRunner & { commands: string[] } {
  const commands: string[] = [];
  const queue = [...steps];
  return {
    commands,
    async run(command) {
      commands.push(command);
      const step = queue.shift() ?? { ok: true };
      return { ok: step.ok, output: step.output ?? "" };
    },
  };
}
```

- [ ] **Step 5: 検証とコミット**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run build` → Expected: すべて成功

```
feat: ビルドエンジン抽象・フェイクエンジン・コマンドランナーを追加
```

---

### タスク5: ビルドオーケストレータ(runBuild)

**Files:**
- Create: `src/lib/tap/index.ts`
- Create: `tests/unit/tap.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/tap.test.ts`:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBuild, normalizeStaleBatch } from "@/lib/tap";
import { createFakeBuildEngine } from "@/lib/tap/fake-engine";
import { createFakeRunner } from "@/lib/tap/runner";
import { createBrew, recipeDir } from "@/lib/store";
import { RECIPE_FILES } from "@/lib/recipe";
import type { Brew } from "@/lib/store/types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true });
});

async function setupBrew(planMd: string): Promise<Brew> {
  const brew = await createBrew("ビルド対象");
  await fs.mkdir(recipeDir(brew.id), { recursive: true });
  for (const def of RECIPE_FILES) {
    const content = def.file === "05-implementation-plan.md" ? planMd : `# ${def.title}`;
    await fs.writeFile(path.join(recipeDir(brew.id), def.file), content, "utf8");
  }
  return { ...brew, stage: "done", recipeGeneratedAt: new Date().toISOString() };
}

describe("runBuild", () => {
  it("成功パス: intro+タスクごとにsendされ、検証成功でbuiltになる", async () => {
    const brew = await setupBrew("## タスクA\n本文A\n## タスクB\n本文B");
    const engine = createFakeBuildEngine();
    const runner = createFakeRunner();
    const phases: string[] = [];
    const done = await runBuild(brew, {
      engine,
      runner,
      template: "tap-fake",
      onProgress: (b) => {
        if (b.buildProgress) phases.push(b.buildProgress.phase);
      },
    });
    expect(done.stage).toBe("built");
    expect(done.batches[0].status).toBe("succeeded");
    expect(done.buildProgress).toBeNull();
    expect(engine.prompts).toHaveLength(3); // intro + タスクA + タスクB
    expect(phases).toContain("preparing");
    expect(phases).toContain("generating");
    expect(phases).toContain("verifying");
    expect(runner.commands.length).toBeGreaterThan(0);
  });

  it("見出しの無い実装計画は一括実装の1sendにフォールバックする", async () => {
    const brew = await setupBrew("見出しのないプレーンな計画");
    const engine = createFakeBuildEngine();
    const done = await runBuild(brew, {
      engine,
      runner: createFakeRunner(),
      template: "tap-fake",
    });
    expect(done.batches[0].status).toBe("succeeded");
    expect(engine.prompts).toHaveLength(2); // intro + 一括実装
  });

  it("検証失敗で修理ラウンドが走り、成功すればsucceeded", async () => {
    const brew = await setupBrew("## タスクA\n本文A");
    const engine = createFakeBuildEngine();
    const runner = createFakeRunner([
      { ok: false, output: "TS2304: Cannot find name 'foo'" },
      { ok: true },
    ]);
    const done = await runBuild(brew, { engine, runner, template: "tap-fake" });
    expect(done.batches[0].status).toBe("succeeded");
    expect(engine.prompts.some((p) => p.includes("TS2304"))).toBe(true);
  });

  it("修理上限を超えるとfailedになりstageは変わらない", async () => {
    const brew = await setupBrew("## タスクA\nx");
    const runner = createFakeRunner([
      { ok: false, output: "e1" },
      { ok: false, output: "e2" },
      { ok: false, output: "e3" },
    ]);
    const done = await runBuild(brew, {
      engine: createFakeBuildEngine(),
      runner,
      template: "tap-fake",
    });
    expect(done.batches[0].status).toBe("failed");
    expect(done.batches[0].error).toContain("修理上限");
    expect(done.stage).toBe("done");
    expect(done.buildProgress).toBeNull();
  });

  it("エンジンのsend失敗でfailedになる", async () => {
    const brew = await setupBrew("## タスクA\nx");
    const done = await runBuild(brew, {
      engine: createFakeBuildEngine({ failSends: 1 }),
      runner: createFakeRunner(),
      template: "tap-fake",
    });
    expect(done.batches[0].status).toBe("failed");
    expect(done.batches[0].error).toBe("fake failure");
  });

  it("中断フラグでcancelledになる", async () => {
    const brew = await setupBrew("## タスクA\nx\n## タスクB\ny");
    const cancel = { cancelled: false };
    const engine = createFakeBuildEngine({
      afterSend: (count) => {
        if (count === 1) cancel.cancelled = true;
      },
    });
    const done = await runBuild(brew, {
      engine,
      runner: createFakeRunner(),
      template: "tap-fake",
      cancel,
    });
    expect(done.batches[0].status).toBe("cancelled");
    expect(engine.prompts).toHaveLength(1); // introの後で停止
  });
});

describe("normalizeStaleBatch", () => {
  it("building残留をfailedに補正する", async () => {
    const brew = await setupBrew("x");
    const stale: Brew = {
      ...brew,
      batches: [
        { number: 1, status: "building", startedAt: "2026-01-01T00:00:00Z", finishedAt: null, error: null },
      ],
      buildProgress: { phase: "generating", detail: "残留" },
    };
    const fixed = normalizeStaleBatch(stale);
    expect(fixed.batches[0].status).toBe("failed");
    expect(fixed.buildProgress).toBeNull();
  });

  it("building以外は同一オブジェクトを返す", async () => {
    const brew = await setupBrew("x");
    expect(normalizeStaleBatch(brew)).toBe(brew);
  });
});
```

Run: `npm run test` → Expected: FAIL

- [ ] **Step 2: オーケストレータを実装**

`src/lib/tap/index.ts`:

```ts
import { appendFileSync } from "node:fs";
import path from "node:path";
import type { BatchStatus, Brew, BuildPhase } from "@/lib/store/types";
import { readRecipeFile } from "@/lib/recipe";
import type { BuildEngine, BuildSession, BuildSendResult } from "./engine";
import type { CommandRunner } from "./runner";
import type { CancelToken } from "./build-state";
import { prepareBatchDir, readManifest, type TemplateId } from "./template";
import { extractTasks } from "./tasks";

export const MAX_REPAIR_ROUNDS = 2;

export interface BuildDeps {
  engine: BuildEngine;
  runner: CommandRunner;
  template: TemplateId;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

const INTRO_PROMPT = [
  "あなたはこの作業ディレクトリに Web サービスを実装するエンジニアです。",
  "docs/recipe/ ディレクトリにあるレシピ(00〜06 の Markdown)をすべて読んでください。",
  "このディレクトリは Vite + React + TypeScript + Tailwind CSS のひな形です。この構成は変更せず、この上にレシピのサービスを実装します。",
  "依存パッケージの追加は package.json の編集のみで行い、npm install は実行しないでください(検証工程で実行します)。",
  "dev サーバーの起動やビルドコマンドの実行もしないでください。",
  "まだコードは書かず、レシピを読んで実装方針を5行以内で要約してください。",
].join("\n");

function taskPrompt(index: number, total: number, title: string, body: string): string {
  return [
    `実装計画のタスク ${index}/${total} を実装してください。`,
    `## ${title}`,
    body || "(詳細はレシピ本文を参照)",
    "完了したら変更内容を3行以内で要約してください。",
  ].join("\n\n");
}

function repairPrompt(round: number, output: string): string {
  return [
    `検証コマンドが失敗しました(修理ラウンド ${round}/${MAX_REPAIR_ROUNDS})。`,
    "以下のエラー出力を読み、原因を修正してください。npm install やビルドの実行は不要です。",
    "```",
    output.slice(-4000),
    "```",
  ].join("\n");
}

function withProgress(brew: Brew, phase: BuildPhase, detail: string): Brew {
  return { ...brew, buildProgress: { phase, detail } };
}

function finishBatch(brew: Brew, status: BatchStatus, error: string | null): Brew {
  const [batch] = brew.batches;
  return {
    ...brew,
    stage: status === "succeeded" ? "built" : brew.stage,
    buildProgress: null,
    batches: [{ ...batch, status, finishedAt: new Date().toISOString(), error }],
  };
}

/** クラッシュで building のまま残ったバッチを failed に補正する。補正不要なら同一参照を返す */
export function normalizeStaleBatch(brew: Brew): Brew {
  const [first] = brew.batches;
  if (!first || first.status !== "building") return brew;
  return {
    ...brew,
    batches: [
      {
        ...first,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: "中断されました(プロセス終了)",
      },
    ],
    buildProgress: null,
  };
}

async function sendWithCancel(
  session: BuildSession,
  prompt: string,
  cancel?: CancelToken,
): Promise<BuildSendResult> {
  if (cancel?.cancelled) return { ok: false, summary: "中断されました" };
  if (!cancel) return session.send(prompt);
  // send中の中断要求をSDK側のrunキャンセルへ伝える
  const watcher = setInterval(() => {
    if (cancel.cancelled) void session.cancel();
  }, 500);
  try {
    return await session.send(prompt);
  } finally {
    clearInterval(watcher);
  }
}

async function runVerify(
  runner: CommandRunner,
  commands: string[],
  cwd: string,
  log: (line: string) => void,
): Promise<{ command: string; output: string } | null> {
  for (const command of commands) {
    log(`[verify] ${command}`);
    const result = await runner.run(command, { cwd, onLog: log });
    if (!result.ok) return { command, output: result.output };
  }
  return null;
}

export async function runBuild(brew: Brew, deps: BuildDeps): Promise<Brew> {
  if (!brew.recipeGeneratedAt) {
    throw new Error("レシピがまだ生成されていません。");
  }

  let current: Brew = {
    ...brew,
    batches: [
      {
        number: 1,
        status: "building",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
      },
    ],
  };
  current = withProgress(current, "preparing", "テンプレートを準備しています");
  await deps.onProgress?.(current);

  const batchDir = await prepareBatchDir(brew.id, 1, deps.template);
  const logPath = path.join(batchDir, "build.log");
  const log = (line: string) => {
    appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  };

  const session = await deps.engine.createSession({ cwd: batchDir, onLog: log });
  try {
    const planMd = await readRecipeFile(brew.id, "05-implementation-plan.md").catch(() => "");
    const tasks = extractTasks(planMd);

    current = withProgress(current, "generating", "レシピを読み込んでいます");
    await deps.onProgress?.(current);
    log("[build] レシピ読み込みを指示");
    let res = await sendWithCancel(session, INTRO_PROMPT, deps.cancel);
    if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
    if (!res.ok) return finishBatch(current, "failed", res.summary);

    if (tasks.length === 0) {
      current = withProgress(current, "generating", "レシピ全体を一括実装中");
      await deps.onProgress?.(current);
      log("[build] 一括実装を指示");
      res = await sendWithCancel(
        session,
        "docs/recipe/ のレシピ全体を、このひな形の上に一括で実装してください。完了したら変更内容を3行以内で要約してください。",
        deps.cancel,
      );
      if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
      if (!res.ok) return finishBatch(current, "failed", res.summary);
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
        if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
        if (!res.ok) return finishBatch(current, "failed", res.summary);
      }
    }

    const manifest = await readManifest(batchDir);
    for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
      current = withProgress(
        current,
        "verifying",
        round === 0 ? "検証コマンドを実行中" : `再検証中(修理ラウンド ${round}/${MAX_REPAIR_ROUNDS})`,
      );
      await deps.onProgress?.(current);
      const failure = await runVerify(deps.runner, manifest.verify, batchDir, log);
      if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
      if (!failure) return finishBatch(current, "succeeded", null);
      if (round === MAX_REPAIR_ROUNDS) {
        return finishBatch(current, "failed", `検証失敗(修理上限超過): ${failure.command}`);
      }
      current = withProgress(current, "repairing", `修理ラウンド ${round + 1}/${MAX_REPAIR_ROUNDS}`);
      await deps.onProgress?.(current);
      log(`[build] 修理ラウンド ${round + 1}: ${failure.command} が失敗`);
      res = await sendWithCancel(session, repairPrompt(round + 1, failure.output), deps.cancel);
      if (deps.cancel?.cancelled) return finishBatch(current, "cancelled", null);
      if (!res.ok) return finishBatch(current, "failed", res.summary);
    }
    return finishBatch(current, "failed", "不明な状態");
  } finally {
    await session.dispose();
  }
}
```

Run: `npm run test` → Expected: PASS(全件)

- [ ] **Step 3: 検証とコミット**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run build` → Expected: すべて成功

```
feat: ビルドオーケストレータ(生成・検証・修理・中断)を追加
```

---

### タスク6: Cursor SDKエンジンとエンジン選択

**Files:**
- Create: `src/lib/tap/cursor-engine.ts`
- Create: `src/lib/tap/resolve.ts`

注意: 実 SDK を叩く自動テストは書かない(APIキー・課金が必要)。型チェックとビルドで検証し、実走確認はタスク11の手動確認に委ねる。`@cursor/sdk` の API は `node_modules/@cursor/sdk/dist/` の型定義で確認できる。以下のコードはドキュメント記載の API(`Agent.create` / `agent.send` / `run.stream()` / `run.wait()` / `CursorAgentError` / `Symbol.asyncDispose`)に基づく。型が合わない箇所があれば d.ts を読んで調整し、逸脱として報告すること。

- [ ] **Step 1: cursor-engine.ts を実装**

```ts
import { Agent, CursorAgentError } from "@cursor/sdk";
import type { BuildEngine, BuildSession } from "./engine";

export interface CursorEngineOptions {
  apiKey: string;
  model: string;
}

/** @cursor/sdk によるビルドエンジン。1セッション = 1エージェント(コンテキスト維持) */
export function createCursorEngine(opts: CursorEngineOptions): BuildEngine {
  return {
    async createSession({ cwd, onLog }) {
      const agent = await Agent.create({
        apiKey: opts.apiKey,
        model: { id: opts.model },
        local: { cwd },
      });
      let currentRun: Awaited<ReturnType<typeof agent.send>> | null = null;

      const session: BuildSession = {
        async send(prompt) {
          try {
            const run = await agent.send(prompt);
            currentRun = run;
            onLog(`[cursor] run開始: ${run.id}`);
            for await (const event of run.stream()) {
              if (event.type === "assistant") {
                for (const block of event.message.content) {
                  if (block.type === "text" && block.text.trim()) onLog(block.text);
                }
              }
            }
            const result = await run.wait();
            if (result.status === "error") {
              return { ok: false, summary: `エージェント実行失敗 (run: ${run.id})` };
            }
            if (result.status === "cancelled") {
              return { ok: false, summary: "中断されました" };
            }
            return { ok: true, summary: "" };
          } catch (err) {
            if (err instanceof CursorAgentError) {
              return {
                ok: false,
                summary: `エージェント起動失敗: ${err.message} (retryable=${err.isRetryable})`,
              };
            }
            throw err;
          } finally {
            currentRun = null;
          }
        },
        async cancel() {
          const run = currentRun;
          if (run?.supports("cancel")) await run.cancel();
        },
        async dispose() {
          await agent[Symbol.asyncDispose]();
        },
      };
      return session;
    },
  };
}
```

- [ ] **Step 2: resolve.ts を実装**

```ts
import type { Settings } from "@/lib/store/types";
import type { BuildEngine } from "./engine";
import type { TemplateId } from "./template";
import { createCursorEngine } from "./cursor-engine";
import { createFakeBuildEngine } from "./fake-engine";

export class TapNotConfiguredError extends Error {}

export interface ResolvedEngine {
  engine: BuildEngine;
  template: TemplateId;
}

/**
 * 設定からビルドエンジンとテンプレートを決める。
 * フェイクプロバイダ設定時(E2E)と IDEA_BREWING_FAKE_BUILD=1 のときはフェイク。
 */
export function resolveEngine(settings: Settings): ResolvedEngine {
  if (settings.provider === "fake" || process.env.IDEA_BREWING_FAKE_BUILD === "1") {
    return { engine: createFakeBuildEngine(), template: "tap-fake" };
  }
  const apiKey = settings.cursorApiKey || process.env.CURSOR_API_KEY || "";
  if (!apiKey) {
    throw new TapNotConfiguredError(
      "Cursor APIキーが未設定です。設定画面の「ビルドエンジン(Cursor)」で設定してください。",
    );
  }
  return {
    engine: createCursorEngine({ apiKey, model: settings.cursorModel || "composer-2.5" }),
    template: "tap-vite",
  };
}
```

- [ ] **Step 3: 検証とコミット**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run build` → Expected: すべて成功(SDK の型が合わない場合はここで調整)

```
feat: Cursor SDKビルドエンジンとエンジン選択を追加
```

---

### タスク7: devサーバーマネージャ

**Files:**
- Create: `src/lib/tap/server-manager.ts`
- Create: `tests/unit/server-manager.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/server-manager.test.ts`(実プロセス spawn を含むためタイムアウト長め):

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serverStatus, startServer, stopServer } from "@/lib/tap/server-manager";
import { createBrew, tapDir } from "@/lib/store";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe("server-manager", () => {
  it("フェイクテンプレートのdevサーバーを起動・停止できる", async () => {
    const brew = await createBrew("サーバー");
    await fs.cp(path.join(process.cwd(), "templates", "tap-fake"), tapDir(brew.id, 1), {
      recursive: true,
    });
    const { port } = await startServer(brew.id);
    expect(serverStatus(brew.id).running).toBe(true);
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.ok).toBe(true);
    expect(await res.text()).toContain("フェイクタップアプリ");
    await stopServer(brew.id);
    expect(serverStatus(brew.id).running).toBe(false);
    // プロセス終了を待ってから一時ディレクトリを消す(Windowsのファイルロック対策)
    await new Promise((r) => setTimeout(r, 1500));
  }, 60_000);
});
```

Run: `npm run test` → Expected: FAIL

- [ ] **Step 2: server-manager.ts を実装**

```ts
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { tapDir } from "@/lib/store";

interface RunningServer {
  child: ChildProcess;
  pid: number;
  port: number;
  startedAt: string;
}

// モジュールスコープで管理(Next.jsプロセス内のみ。再起動で消えるのは許容)
const servers = new Map<string, RunningServer>();

async function findFreePort(start = 5173): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
    });
    if (free) return port;
  }
  throw new Error("空きポートが見つかりません。");
}

export async function startServer(brewId: string): Promise<{ port: number }> {
  const existing = serverStatus(brewId);
  if (existing.running && existing.port !== null) return { port: existing.port };

  const cwd = tapDir(brewId, 1);
  const port = await findFreePort();
  // --strictPort: Viteがポートをずらして起動した場合の記録ずれを防ぐ(フェイクserver.jsは未知の引数を無視する)
  const child = spawn(`npm run dev -- --port ${port} --strictPort`, { cwd, shell: true });
  servers.set(brewId, {
    child,
    pid: child.pid ?? -1,
    port,
    startedAt: new Date().toISOString(),
  });
  child.on("exit", () => {
    if (servers.get(brewId)?.child === child) servers.delete(brewId);
  });

  // 起動確認(最大30秒)
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) return { port };
    } catch {
      // まだ起動していない
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await stopServer(brewId);
  throw new Error("devサーバーが30秒以内に応答しませんでした。build.logと taps/batch-1 を確認してください。");
}

export async function stopServer(brewId: string): Promise<void> {
  const entry = servers.get(brewId);
  if (!entry) return;
  servers.delete(brewId);
  if (process.platform === "win32") {
    // shell経由のため子プロセスツリーごと止める
    spawn(`taskkill /pid ${entry.pid} /T /F`, { shell: true });
  } else {
    entry.child.kill("SIGTERM");
  }
}

export function serverStatus(brewId: string): { running: boolean; port: number | null } {
  const entry = servers.get(brewId);
  if (!entry || entry.child.exitCode !== null) return { running: false, port: null };
  return { running: true, port: entry.port };
}
```

Run: `npm run test` → Expected: PASS

- [ ] **Step 3: 検証とコミット**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run build` → Expected: すべて成功

```
feat: 生成アプリのdevサーバー起動・停止マネージャを追加
```

---

### タスク8: APIルート(build / cancel / server / log)

**Files:**
- Create: `src/app/api/brews/[id]/tap/build/route.ts`
- Create: `src/app/api/brews/[id]/tap/cancel/route.ts`
- Create: `src/app/api/brews/[id]/tap/server/route.ts`
- Create: `src/app/api/brews/[id]/tap/log/route.ts`

エラー契約は既存ルートと同一: すべて `{ error }` JSON。`readBrew` 失敗は 404「ブリューが見つかりません。」。

- [ ] **Step 1: build ルート**

`src/app/api/brews/[id]/tap/build/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readBrew, readSettings, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { errorResponse } from "@/lib/api";
import { normalizeStaleBatch, runBuild } from "@/lib/tap";
import { resolveEngine, TapNotConfiguredError, type ResolvedEngine } from "@/lib/tap/resolve";
import { realRunner } from "@/lib/tap/runner";
import { buildingBrews, cancelTokens } from "@/lib/tap/build-state";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (buildingBrews.has(id)) {
    return NextResponse.json({ error: "ビルド中です。" }, { status: 409 });
  }
  buildingBrews.add(id);
  const token = { cancelled: false };
  cancelTokens.set(id, token);
  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }
    if (!brew.recipeGeneratedAt) {
      return NextResponse.json({ error: "レシピがまだ生成されていません。" }, { status: 400 });
    }
    const settings = await readSettings();
    let resolved: ResolvedEngine;
    try {
      resolved = resolveEngine(settings);
    } catch (err) {
      if (err instanceof TapNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
    const done = await runBuild(normalizeStaleBatch(brew), {
      engine: resolved.engine,
      template: resolved.template,
      runner: realRunner,
      cancel: token,
      onProgress: async (b) => {
        await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
      },
    });
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    buildingBrews.delete(id);
    cancelTokens.delete(id);
  }
}
```

- [ ] **Step 2: cancel ルート**

`src/app/api/brews/[id]/tap/cancel/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { errorResponse } from "@/lib/api";
import { normalizeStaleBatch } from "@/lib/tap";
import { cancelTokens } from "@/lib/tap/build-state";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = cancelTokens.get(id);
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
    // クラッシュでbuilding残留した場合の復旧経路(normalizeStaleBatchは補正不要なら同一参照を返す)
    const normalized = normalizeStaleBatch(brew);
    if (normalized !== brew) {
      return NextResponse.json(await writeBrew(normalized));
    }
    return NextResponse.json({ error: "ビルドは実行されていません。" }, { status: 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: server ルート**

`src/app/api/brews/[id]/tap/server/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";
import { errorResponse } from "@/lib/api";
import { serverStatus, startServer, stopServer } from "@/lib/tap/server-manager";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(serverStatus(id));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }
    const { action } = (await req.json()) as { action: "start" | "stop" };
    if (action === "start") {
      if (brew.batches[0]?.status !== "succeeded") {
        return NextResponse.json({ error: "ビルドが成功していません。" }, { status: 400 });
      }
      await startServer(id);
    } else if (action === "stop") {
      await stopServer(id);
    } else {
      return NextResponse.json({ error: "不正なアクションです。" }, { status: 400 });
    }
    return NextResponse.json(serverStatus(id));
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: log ルート**

`src/app/api/brews/[id]/tap/log/route.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { tapDir } from "@/lib/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const raw = await fs.readFile(path.join(tapDir(id, 1), "build.log"), "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return NextResponse.json({ lines: lines.slice(-200) });
  } catch {
    return NextResponse.json({ lines: [] });
  }
}
```

- [ ] **Step 5: 手動スモークと検証**

```powershell
npx tsc --noEmit; npm run lint; npm run test; npm run build
```

Expected: すべて成功。続いて dev サーバーでスモーク:

1. `npm run dev` を起動
2. `Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/brews -ContentType "application/json; charset=utf-8" -Body '{"name":"tapcheck"}'` でブリュー作成
3. `Invoke-WebRequest -Method Post -Uri http://localhost:3000/api/brews/<id>/tap/build` → 400(レシピ未生成)を確認
4. `Invoke-WebRequest -Uri http://localhost:3000/api/brews/<id>/tap/log` → `{"lines":[]}` を確認
5. dev サーバー停止、`data/brews/<id>` を削除

- [ ] **Step 6: コミット**

```
feat: タップ工程のAPIルート(ビルド・中断・サーバー・ログ)を追加
```

---

### タスク9: タップパネルUIとワークベンチ統合

**Files:**
- Create: `src/components/tap-panel.tsx`
- Modify: `src/components/brew-workbench.tsx`

E2E が依存するラベル(正確に): 「タップ」(タブ)、「ビルド開始(1stバッチ)」「ビルド中断」「再ビルド」「注ぐ(サーバー起動)」「止める」。

- [ ] **Step 1: tap-panel.tsx を作成**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { Brew, BuildPhase } from "@/lib/store/types";

const PHASE_LABELS: Record<BuildPhase, string> = {
  preparing: "準備",
  generating: "生成",
  verifying: "検証",
  repairing: "修理",
};

export function TapPanel({
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
  const [logLines, setLogLines] = useState<string[]>([]);
  const [server, setServer] = useState<{ running: boolean; port: number | null }>({
    running: false,
    port: null,
  });

  const batch = brew.batches[0] ?? null;

  const fetchServer = useCallback(async () => {
    try {
      const res = await fetch(`/api/brews/${brew.id}/tap/server`);
      if (res.ok) setServer(await res.json());
    } catch {
      // 表示用の取得失敗は無視する
    }
  }, [brew.id]);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/brews/${brew.id}/tap/log`);
      if (res.ok) setLogLines((await res.json()).lines);
    } catch {
      // 表示用の取得失敗は無視する
    }
  }, [brew.id]);

  useEffect(() => {
    void fetchServer();
    void fetchLog();
  }, [fetchServer, fetchLog]);

  // ページ再読み込み後など、このコンポーネント外で始まったビルドの進捗を追従する
  const hasProgress = brew.buildProgress !== null;
  useEffect(() => {
    if (!hasProgress || busy) return;
    const timer = setInterval(() => {
      void refresh();
      void fetchLog();
    }, 1000);
    return () => clearInterval(timer);
  }, [hasProgress, busy, refresh, fetchLog]);

  const build = async () => {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    const timer = setInterval(() => {
      void refresh();
      void fetchLog();
    }, 1000);
    try {
      const res = await fetch(`/api/brews/${brew.id}/tap/build`, { method: "POST" });
      clearInterval(timer);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "エラーが発生しました。");
      onUpdate(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
      try {
        await refresh();
      } catch {
        // busy解除を保証する
      }
      void fetchLog();
      setBusy(false);
      onBusyChange(false);
    }
  };

  const cancelBuild = async () => {
    try {
      const res = await fetch(`/api/brews/${brew.id}/tap/cancel`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "エラーが発生しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const serverAction = async (action: "start" | "stop") => {
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/tap/server`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "エラーが発生しました。");
      setServer(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  const building = busy || brew.buildProgress !== null;

  return (
    <section>
      <h2 className="text-lg font-bold text-amber-100">タップ(1stバッチ)</h2>

      {brew.buildProgress && (
        <p className="mt-2 text-amber-200" aria-live="polite">
          {PHASE_LABELS[brew.buildProgress.phase]}: {brew.buildProgress.detail}
        </p>
      )}

      {!building && !batch && (
        <button
          onClick={build}
          className="mt-4 rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
        >
          ビルド開始(1stバッチ)
        </button>
      )}

      {building && (
        <button
          onClick={cancelBuild}
          className="mt-4 rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500"
        >
          ビルド中断
        </button>
      )}

      {!building && batch?.status === "failed" && (
        <div className="mt-4">
          <p className="text-red-400">ビルド失敗: {batch.error}</p>
          <button
            onClick={build}
            className="mt-2 rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
          >
            再ビルド
          </button>
        </div>
      )}

      {!building && batch?.status === "cancelled" && (
        <div className="mt-4">
          <p className="text-amber-200/70">ビルドは中断されました。</p>
          <button
            onClick={build}
            className="mt-2 rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500"
          >
            ビルド開始(1stバッチ)
          </button>
        </div>
      )}

      {!building && batch?.status === "succeeded" && (
        <div className="mt-4 space-y-3">
          <p className="text-amber-200">
            1stバッチ完成(
            {batch.finishedAt
              ? `${Math.round((Date.parse(batch.finishedAt) - Date.parse(batch.startedAt)) / 1000)}秒`
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

      {error && (
        <p className="mt-3 text-red-400" aria-live="polite">
          {error}
        </p>
      )}

      {logLines.length > 0 && (
        <pre className="mt-4 max-h-64 overflow-auto rounded border border-amber-900/60 bg-black/40 p-3 text-xs text-amber-100/80">
          {logLines.join("\n")}
        </pre>
      )}
    </section>
  );
}
```

- [ ] **Step 2: ワークベンチにタブを追加**

`src/components/brew-workbench.tsx`:

- import に `TapPanel` を追加
- `TABS` に `{ id: "tap", label: "タップ" }` を追加
- `enabled` に `tap: brew.recipeGeneratedAt !== null,` を追加
- レンダリングに追加:

```tsx
{tab === "tap" && (
  <TapPanel brew={brew} onUpdate={setBrew} refresh={refresh} onBusyChange={setBusy} />
)}
```

注意: 既存のタブ・ラベル・パネル渡しは一切変更しない。

- [ ] **Step 3: 検証**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run build` → Expected: すべて成功

dev サーバーで目視スモーク: レシピ完成済みブリューが無い場合は、`npm run dev` + 第1版フローを LLM 設定なしで進められないため、ここでは `/brews/<id>` が 200 で「タップ」タブが表示される(レシピ未生成なら disabled)ことの確認まででよい。

- [ ] **Step 4: コミット**

```
feat: タップパネルUI(ビルド・進捗ログ・サーバー操作)を追加
```

---

### タスク10: E2Eハッピーパス延長(ビルド → 注ぐ → 停止)

**Files:**
- Modify: `tests/e2e/happy-path.spec.ts`

エンジン選択は設定の `provider: "fake"`(global-setup が書く)で自動的にフェイクになるため、Playwright 設定の変更は不要。

- [ ] **Step 1: スペックを延長**

`tests/e2e/happy-path.spec.ts` のテスト名を「原料投入からタップ提供までのハッピーパス」に変更し、既存のステップ5(ファイル確認)の後に追加:

```ts
  // 6. ビルド(タップ・フェイクエンジン)
  await page.getByRole("button", { name: "タップ", exact: true }).click();
  await page.getByRole("button", { name: "ビルド開始(1stバッチ)" }).click();
  await expect(page.getByRole("button", { name: "注ぐ(サーバー起動)" })).toBeVisible({
    timeout: 60_000,
  });
  expect(existsSync(path.join(brewsDir, ids[0], "taps", "batch-1", "tap.json"))).toBe(true);
  expect(existsSync(path.join(brewsDir, ids[0], "taps", "batch-1", "build.log"))).toBe(true);

  // 7. 注ぐ(devサーバー起動)
  await page.getByRole("button", { name: "注ぐ(サーバー起動)" }).click();
  const link = page.getByRole("link", { name: /localhost:\d+/ });
  await expect(link).toBeVisible({ timeout: 60_000 });
  const href = await link.getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.ok()).toBe(true);
  expect(await res.text()).toContain("フェイクタップアプリ");

  // 8. 止める
  await page.getByRole("button", { name: "止める" }).click();
  await expect(page.getByRole("button", { name: "注ぐ(サーバー起動)" })).toBeVisible({
    timeout: 30_000,
  });
```

注意: `brewsDir` と `ids` は既存ステップ5で定義済みのものを使う。

- [ ] **Step 2: 実行**

```powershell
npm run e2e
```

Expected: 1 passed。失敗した場合は Playwright レポートとログ(`.e2e-data/brews/<id>/taps/batch-1/build.log`)で原因を確認する。テストやセレクタが実装の実際の描画とずれている場合のみテスト側を修正し、アプリ側のバグと思われる場合は報告する。

- [ ] **Step 3: 全体検証とコミット**

Run: `npx tsc --noEmit; npm run lint; npm run test; npm run e2e; npm run build` → Expected: すべて成功

```
test: E2Eハッピーパスをタップ提供(ビルド・注ぐ・停止)まで延長
```

---

### タスク11: READMEと最終確認

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README にタップ工程を追記**

既存の構成に合わせ、以下の内容を適切なセクションに追加する(文言は現状のコードと一致させること):

1. **工程の説明**: レシピ完成後、「タップ」タブからビルド(コード生成)を実行できる。生成エンジンは Cursor SDK(`@cursor/sdk`)で、生成物は Vite + React + TypeScript + Tailwind のアプリとして `data/brews/<ID>/taps/batch-1/` に出力される。「注ぐ」でローカル dev サーバーとして起動し、ブラウザで確認できる。
2. **設定**: 設定画面の「ビルドエンジン(Cursor)」に Cursor APIキー(または環境変数 `CURSOR_API_KEY`)とモデル名を設定する。キーは [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations) で発行できる。
3. **検証と修理**: ビルド後に `npm install` / `tsc` / `vite build` で検証し、失敗時は最大2回の修理ラウンドが自動で走る。ログは `taps/batch-1/build.log` に保存される。
4. **注意**: 生成アプリの dev サーバーは idea brewing 本体のプロセスから起動される。本体を終了しても生成アプリのサーバーが残る場合はタスクマネージャ等で停止すること。`IDEA_BREWING_FAKE_BUILD=1` を設定すると SDK を呼ばないフェイクビルドになる(開発・テスト用)。
5. **データ配置**: 既存のデータ配置ツリーに `taps/batch-1/` を追記。

- [ ] **Step 2: 最終チェックリスト**

```powershell
npx tsc --noEmit; npm run lint; npm run test; npm run e2e; npm run build
```

Expected: すべて成功(unit 全件 + E2E 1 本)。

加えて新規確認:
1. 旧データ互換: 第1版で作った `data/brews/` のブリュー(あれば)がダッシュボード・詳細で開けること
2. `/settings` に「ビルドエンジン(Cursor)」セクションが表示され、保存できること
3. レシピ未生成のブリューで「タップ」タブが disabled であること

- [ ] **Step 3: コミット**

```
docs: READMEにタップ工程(ビルド・注ぐ)とCursor設定を追記
```

---

### タスク12(任意・実キー手動確認)

実 Cursor API キーがある場合のみ。自動化しない:

1. 設定画面で Cursor APIキーを設定
2. 第1版フローでレシピを生成(実 LLM 設定が必要)
3. 「ビルド開始(1stバッチ)」を実行し、進捗とログが流れること、完了後「注ぐ」で生成アプリが表示されることを確認
4. 結果(成功/失敗、所要時間、気づき)を `docs/superpowers/specs/2026-06-13-idea-brewing-phase2-design.md` の末尾に「実走メモ」として追記

---

## 計画セルフレビュー済み事項

- スペックカバレッジ: 設計書の全セクション(設定拡張・データモデル・モジュール・API・UI・テンプレート・エラー処理・テスト)に対応するタスクがある。設計書 8 章の「SDK 起動失敗/実行失敗の区別」は cursor-engine の summary 文言で、「building 残留補正」は normalizeStaleBatch + build/cancel ルートで実装される。
- 型整合: `BuildSendResult` / `CancelToken` / `TemplateId` / `TapManifest` / `BatchStatus` / `BuildPhase` は定義タスク(2〜6)と使用タスク(5〜9)で同名・同形。
- E2E ラベルは タスク9 の JSX とタスク10 のセレクタで一致(「ビルド開始(1stバッチ)」は全角括弧)。
- 既存テスト(30件)と E2E への影響: 既存ラベル変更なし。`readBrew` の補完は既存テストを壊さない(追加フィールドのみ)。
