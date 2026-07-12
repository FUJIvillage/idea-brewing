# idea brewing 第4版(Pub・AI ユーザーテストとリーダーボード)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ビルド済みバッチに対して複数の AI 客(LLM ペルソナ)が Playwright で生成アプリを実操作し、固定 4 軸で評価する「Pub」と、全ブリュー横断のリーダーボードを実装する。

**Architecture:** サーバー側ジョブ方式(第2・3版と同じ「進捗を brew.json に永続化 + UI 1秒ポーリング + インメモリロック/キャンセルトークン」)。操作はテキストベース(ARIA スナップショット + 操作可能要素リスト → LLM が 1 手ずつ構造化出力)。ペルソナは自動生成(ブリューシート由来)と常連客(`data/personas.json`)の併用。

**Tech Stack:** Next.js App Router / TypeScript / Vitest / Playwright(E2E + ランタイム操作)/ zod

**Spec:** `docs/superpowers/specs/2026-07-12-idea-brewing-phase4-design.md`(必読)

**前提:**

- ブランチ: `master` から `feat/phase4-pub` を切って作業する(`git switch -c feat/phase4-pub`)
- コマンドは PowerShell 前提。`&&` は使えないので `;` で連結するか個別に実行する
- テスト実行: `npx vitest run <file>`、全体は `npm test`。E2E は `npm run e2e`
- 既存のコード規約: エラーメッセージ・UI 文言は日本語。API エラーは `{ error }` JSON。ドメイン関数は新しい `Brew` を返す(不変更新)
- コミットはタスクごと(日本語 Conventional Commits)
- Next.js 16 固有の作法に注意(`node_modules/next/dist/docs/` 参照)。ルートハンドラの `ctx.params` は Promise

---

## ファイル構成(全体マップ)

| ファイル | 種別 | 責務 |
|---|---|---|
| `src/lib/store/types.ts` | 変更 | `PubPersona` / `SavedPersona` / `PubReport` / `PubProgress` / `PUB_AXES` 等の型追加 |
| `src/lib/store/index.ts` | 変更 | `createBrew` 初期値・`readBrew` バックフィル・`readPersonas` / `writePersonas` |
| `src/lib/llm/client.ts` | 変更 | `LlmTag` に pub 系 4 タグ追加 |
| `src/lib/llm/fake-client.ts` | 変更 | pub 系タグのフェイク応答 |
| `src/lib/pub/personas.ts` | 新規 | ペルソナ自動生成 + 常連客変換 |
| `src/lib/pub/driver.ts` | 新規 | ブラウザ操作の抽象(状態要約 + アクション実行)+ Playwright 実装 |
| `src/lib/pub/fake-driver.ts` | 新規 | フェイクドライバ(実ブラウザなし) |
| `src/lib/pub/session.ts` | 新規 | 1 ペルソナのセッション(行動ループ + 評価聴取) |
| `src/lib/pub/index.ts` | 新規 | Pub オーケストレータ(`runPub` / `normalizeStalePub` / report.md) |
| `src/lib/pub/pub-state.ts` | 新規 | `pubbingBrews` / `pubCancelTokens` |
| `src/lib/pub/resolve.ts` | 新規 | Settings から deps 解決(fake 分岐) |
| `src/lib/pub/leaderboard.ts` | 新規 | リーダーボード構築(純粋関数 + 収集) |
| `src/lib/mature/mature-state.ts` | 変更 | `isBrewBusy` に `pubbingBrews` を追加 |
| `src/app/api/brews/[id]/pub/{run,cancel,report,screenshot}/route.ts` | 新規 | Pub 系ルート |
| `src/app/api/pub/leaderboard/route.ts` | 新規 | リーダーボード API |
| `src/app/api/personas/route.ts` | 新規 | 常連客 GET / PUT |
| `src/components/pub-panel.tsx` | 新規 | Pub タブ UI |
| `src/components/{brew-workbench,tank-card}.tsx` | 変更 | タブ追加・Pub スコア表示 |
| `src/app/leaderboard/page.tsx` | 新規 | リーダーボードページ |
| `src/app/page.tsx` | 変更 | ヘッダーにリーダーボードリンク |
| `tests/unit/pub-*.test.ts` ほか | 新規/変更 | 単体テスト |
| `tests/e2e/happy-path.spec.ts` | 変更 | Pub ステップの追加 |
| `README.md` | 変更 | Pub セクション + ロードマップ更新 |

---

### Task 1: データモデル拡張と常連客ストア

**Files:**
- Modify: `src/lib/store/types.ts`
- Modify: `src/lib/store/index.ts`
- Modify: `src/lib/llm/client.ts`
- Test: `tests/unit/pub-model.test.ts`

- [ ] **Step 1: ブランチ作成**

```powershell
git switch -c feat/phase4-pub
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/unit/pub-model.test.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PersonaValidationError,
  brewDir,
  createBrew,
  dataDir,
  readBrew,
  readPersonas,
  writePersonas,
} from "@/lib/store";
import type { SavedPersona } from "@/lib/store/types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function persona(over?: Partial<SavedPersona>): SavedPersona {
  return { id: "", name: "常連A", profile: "毎日来る", goals: ["トップを見る"], ...over };
}

describe("常連客ストア", () => {
  it("ファイルがなければ空配列を返す", async () => {
    expect(await readPersonas()).toEqual([]);
  });

  it("壊れたJSONでも空配列を返す", async () => {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(path.join(dataDir(), "personas.json"), "{not json", "utf8");
    expect(await readPersonas()).toEqual([]);
  });

  it("writePersonas は id を採番して保存し、読み戻せる", async () => {
    const saved = await writePersonas([persona()]);
    expect(saved[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readPersonas()).toEqual(saved);
  });

  it("既存の id は維持される", async () => {
    const first = await writePersonas([persona()]);
    const second = await writePersonas([{ ...first[0], profile: "更新" }]);
    expect(second[0].id).toBe(first[0].id);
  });

  it("名前・プロフィール欠落と goals 件数違反は PersonaValidationError", async () => {
    await expect(writePersonas([persona({ name: " " })])).rejects.toThrow(PersonaValidationError);
    await expect(writePersonas([persona({ profile: "" })])).rejects.toThrow(
      PersonaValidationError,
    );
    await expect(writePersonas([persona({ goals: [] })])).rejects.toThrow(PersonaValidationError);
    await expect(
      writePersonas([persona({ goals: ["a", "b", "c", "d"] })]),
    ).rejects.toThrow(PersonaValidationError);
  });

  it("21件以上は PersonaValidationError", async () => {
    const many = Array.from({ length: 21 }, (_, i) => persona({ name: `常連${i}` }));
    await expect(writePersonas(many)).rejects.toThrow(PersonaValidationError);
  });
});

describe("Brew の pub フィールド", () => {
  it("createBrew は pubProgress: null で初期化する", async () => {
    const brew = await createBrew("パブ");
    expect(brew.pubProgress).toBeNull();
  });

  it("readBrew は旧 brew.json に pub / pubProgress をバックフィルする", async () => {
    const brew = await createBrew("旧データ");
    const legacy = {
      ...brew,
      batches: [
        {
          number: 1,
          status: "succeeded",
          startedAt: brew.createdAt,
          finishedAt: brew.createdAt,
          error: null,
          evaluation: null,
        },
      ],
    } as Record<string, unknown>;
    delete legacy.pubProgress;
    delete (legacy.batches as Record<string, unknown>[])[0].pub;
    await fs.writeFile(
      path.join(brewDir(brew.id), "brew.json"),
      JSON.stringify(legacy, null, 2),
      "utf8",
    );
    const read = await readBrew(brew.id);
    expect(read.pubProgress).toBeNull();
    expect(read.batches[0].pub).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

```powershell
npx vitest run tests/unit/pub-model.test.ts
```

`readPersonas` 等が存在しないためコンパイルエラー/失敗になることを確認。

- [ ] **Step 4: 型を追加**

`src/lib/store/types.ts` — `MaturationProgress` の定義の後に追加:

```ts
export const PUB_AXES = ["目的達成", "使いやすさ", "見た目・第一印象", "また来たいか"] as const;

export interface PubPersona {
  name: string; // 例: "忙しい営業のさとみ"
  profile: string; // 属性・利用文脈・性格
  goals: string[]; // このアプリで達成したいこと(1〜3件)
  origin: "auto" | "saved"; // 自動生成 or 常連客
}

export interface SavedPersona {
  id: string;
  name: string;
  profile: string;
  goals: string[];
}

export interface PubTaskResult {
  goal: string;
  achieved: boolean;
  note: string; // 達成/断念の経緯
}

export interface PubStep {
  step: number; // 1始まり
  action: string; // 例: `click [3](追加ボタンを押す)`
  observation: string; // 実行結果の要約
}

export type PubPersonaStatus = "completed" | "aborted";

export interface PubPersonaResult {
  persona: PubPersona;
  status: PubPersonaStatus; // aborted = LLM失敗・連続操作失敗など
  taskResults: PubTaskResult[];
  scores: AxisScore[]; // PUB_AXES 固定4軸
  overall: number; // 4軸平均(小数1桁)。aborted 時は 0 で集計対象外
  comment: string; // 客の一言レビュー
  steps: PubStep[]; // 行動ログ
}

export interface PubReport {
  overall: number; // completed ペルソナの overall 平均(小数1桁)
  personaResults: PubPersonaResult[];
  summary: string; // 店主向け総括
  ranAt: string;
}

export type PubPhase = "opening" | "serving" | "closing";

export interface PubProgress {
  phase: PubPhase;
  detail: string; // 例: "ペルソナ 2/3「…」: ステップ 4"
  batch: number;
}
```

`BatchRecord` に `pub: PubReport | null;`(`evaluation` の直後)、`Brew` に `pubProgress: PubProgress | null;`(`maturationProgress` の直後)を追加。

- [ ] **Step 5: ストアの初期化・バックフィル・常連客ストア**

`src/lib/store/index.ts`:

1. `createBrew` の初期値に `pubProgress: null` を追加
2. `readBrew` のバックフィルを拡張:

```ts
  return {
    ...parsed,
    batches: (parsed.batches ?? []).map((b) => ({
      ...b,
      evaluation: b.evaluation ?? null,
      pub: b.pub ?? null,
    })),
    buildProgress: parsed.buildProgress ?? null,
    maturationProgress: parsed.maturationProgress ?? null,
    pubProgress: parsed.pubProgress ?? null,
  };
```

3. ファイル末尾に常連客ストアを追加(import に `SavedPersona` を足す):

```ts
export class PersonaValidationError extends Error {}

const MAX_PERSONAS = 20;

function personasPath(): string {
  return path.join(dataDir(), "personas.json");
}

/** 常連客リスト。ファイルなし・破損時は空配列(settings と同じ寛容な読み込み) */
export async function readPersonas(): Promise<SavedPersona[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(personasPath(), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedPersona[]) : [];
  } catch {
    return [];
  }
}

/** 常連客リストを全置換保存する。id が空の要素は採番する */
export async function writePersonas(personas: SavedPersona[]): Promise<SavedPersona[]> {
  if (personas.length > MAX_PERSONAS) {
    throw new PersonaValidationError(`常連客は最大${MAX_PERSONAS}件までです。`);
  }
  const normalized = personas.map((p) => {
    const name = (p.name ?? "").trim();
    const profile = (p.profile ?? "").trim();
    const goals = (p.goals ?? []).map((g) => g.trim()).filter((g) => g !== "");
    if (name === "" || profile === "") {
      throw new PersonaValidationError("常連客の名前とプロフィールは必須です。");
    }
    if (goals.length < 1 || goals.length > 3) {
      throw new PersonaValidationError("常連客の目的は1〜3件で指定してください。");
    }
    return { id: p.id?.trim() ? p.id : randomUUID(), name, profile, goals };
  });
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(personasPath(), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}
```

- [ ] **Step 6: LlmTag に pub 系タグを追加**

`src/lib/llm/client.ts`:

```ts
export type LlmTag =
  | "mash"
  | "grill-next"
  | "grill-apply"
  | "recipe"
  | "evaluate"
  | "pub-persona"
  | "pub-action"
  | "pub-feedback"
  | "pub-summary"
  | "connection-test";
```

- [ ] **Step 7: テストと型チェック**

```powershell
npx vitest run tests/unit/pub-model.test.ts
npx tsc --noEmit
```

- [ ] **Step 8: 既存の全テストが通ることを確認してコミット**

```powershell
npm test
git add -A
git commit -m "feat: Pubデータモデルと常連客ストアを追加"
```

---

### Task 2: フェイク LLM 応答(pub 系タグ)

**Files:**
- Modify: `src/lib/llm/fake-client.ts`
- Test: `tests/unit/pub-fake-client.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/pub-fake-client.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakeClient } from "@/lib/llm/fake-client";

const personasSchema = z.object({
  personas: z.array(
    z.object({
      name: z.string().min(1),
      profile: z.string().min(1),
      goals: z.array(z.string().min(1)).min(1).max(3),
    }),
  ),
});

const actionSchema = z.object({
  kind: z.enum(["click", "fill", "select", "press", "goto", "finish"]),
  target: z.number().int().min(1).nullish(),
  value: z.string().nullish(),
  key: z.string().nullish(),
  path: z.string().nullish(),
  reason: z.string().min(1),
});

const feedbackSchema = z.object({
  taskResults: z.array(z.object({ achieved: z.boolean(), note: z.string() })).min(1).max(3),
  scores: z.object({
    purpose: z.number().int().min(1).max(5),
    usability: z.number().int().min(1).max(5),
    looks: z.number().int().min(1).max(5),
    revisit: z.number().int().min(1).max(5),
  }),
  comment: z.string().min(1),
});

describe("fake client の pub タグ", () => {
  it("pub-persona はプロンプトの人数指定どおりに返す", async () => {
    const client = createFakeClient();
    const res = await client.generateObject(personasSchema, {
      tag: "pub-persona",
      system: "s",
      prompt: "人数: 3\n\n## コンセプト\nテスト",
    });
    expect(res.personas).toHaveLength(3);
    expect(res.personas[0].goals.length).toBeGreaterThan(0);
  });

  it("pub-action は click → finish を繰り返す", async () => {
    const client = createFakeClient();
    const opts = { tag: "pub-action", system: "s", prompt: "p" } as const;
    const a1 = await client.generateObject(actionSchema, opts);
    const a2 = await client.generateObject(actionSchema, opts);
    const a3 = await client.generateObject(actionSchema, opts);
    expect(a1.kind).toBe("click");
    expect(a1.target).toBe(1);
    expect(a2.kind).toBe("finish");
    expect(a3.kind).toBe("click"); // 2人目のセッションも同じ運びになる
  });

  it("pub-feedback は1人目が4点台、2人目以降は3点台", async () => {
    const client = createFakeClient();
    const opts = { tag: "pub-feedback", system: "s", prompt: "p" } as const;
    const f1 = await client.generateObject(feedbackSchema, opts);
    const f2 = await client.generateObject(feedbackSchema, opts);
    expect(f1.scores.purpose).toBe(5);
    expect(f2.scores.purpose).toBe(4);
    expect(f2.scores.usability).toBe(3);
  });

  it("pub-summary は generateText で固定文を返す", async () => {
    const client = createFakeClient();
    const text = await client.generateText({ tag: "pub-summary", system: "s", prompt: "p" });
    expect(text).toContain("フェイク総括");
  });
});
```

- [ ] **Step 2: フェイククライアントを拡張**

`src/lib/llm/fake-client.ts` — `fakeObjectFor` がプロンプトを参照できるよう引数を `opts` に変更し、pub 系分岐を追加:

```ts
export function createFakeClient(): FakeLlm {
  let grillCount = 0;
  let evaluateCount = 0;
  let pubActionCount = 0;
  let pubFeedbackCount = 0;
  const calls: GenerateOptions[] = [];

  const fakeObjectFor = (opts: GenerateOptions): unknown => {
    const tag = opts.tag;
    // ...既存の mash / grill-next / grill-apply / evaluate 分岐は tag 参照のまま...
    if (tag === "pub-persona") {
      const count = Number(/人数: (\d+)/.exec(opts.prompt)?.[1] ?? "2");
      return {
        personas: Array.from({ length: count }, (_, i) => ({
          name: `フェイク客${i + 1}`,
          profile: "フェイクのペルソナ(自動生成)",
          goals: ["トップページを確認する", "主要機能をひとつ試す"],
        })),
      };
    }
    if (tag === "pub-action") {
      pubActionCount += 1;
      if (pubActionCount % 2 === 1) {
        return { kind: "click", target: 1, reason: `フェイク操作${pubActionCount}` };
      }
      return { kind: "finish", reason: "目的を確認できたので終了" };
    }
    if (tag === "pub-feedback") {
      pubFeedbackCount += 1;
      const high = pubFeedbackCount === 1; // 1人目は高評価(リーダーボード検証を決定論化)
      return {
        taskResults: [
          { achieved: true, note: "フェイクで達成" },
          { achieved: high, note: "フェイクの経緯" },
        ],
        scores: high
          ? { purpose: 5, usability: 4, looks: 4, revisit: 5 }
          : { purpose: 4, usability: 3, looks: 3, revisit: 3 },
        comment: `フェイク客レビュー(${pubFeedbackCount}人目)`,
      };
    }
    throw new Error(`fake client: 未対応の tag です: ${tag}`);
  };

  return {
    calls,
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      calls.push(opts);
      return schema.parse(fakeObjectFor(opts));
    },
    async generateText(opts: GenerateOptions): Promise<string> {
      calls.push(opts);
      if (opts.tag === "connection-test") return "pong";
      if (opts.tag === "pub-summary") return "フェイク総括: 客の評判は上々です。";
      return `# フェイク生成ドキュメント\n\n(tag=${opts.tag})\n\n入力の先頭: ${opts.prompt.slice(0, 200)}`;
    },
  };
}
```

既存分岐の中身は変更しない(`if (tag === "mash")` などの条件はそのまま)。

- [ ] **Step 3: テスト実行とコミット**

```powershell
npx vitest run tests/unit/pub-fake-client.test.ts tests/unit/fake-client.test.ts
npm test
git add -A
git commit -m "feat: フェイクLLMにPub系タグの応答を追加"
```

---

### Task 3: ペルソナ自動生成と常連客変換(personas.ts)

**Files:**
- Create: `src/lib/pub/personas.ts`
- Test: `tests/unit/pub-personas.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/pub-personas.test.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeClient } from "@/lib/llm/fake-client";
import { buildPersonaPrompt, generatePersonas, savedToPersona } from "@/lib/pub/personas";
import { createBrew } from "@/lib/store";
import type { Brew, BrewSheet } from "@/lib/store/types";
import { SHEET_KEYS } from "@/lib/store/types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function sheet(): BrewSheet {
  return Object.fromEntries(
    SHEET_KEYS.map((key) => [key, { content: `${key}の内容`, sufficiency: "full", userEdited: false }]),
  ) as unknown as BrewSheet;
}

async function sheetedBrew(): Promise<Brew> {
  const brew = await createBrew("ペルソナ");
  return { ...brew, sheet: sheet() };
}

describe("buildPersonaPrompt", () => {
  it("人数とシートの主要3項目を含む", async () => {
    const brew = await sheetedBrew();
    const prompt = buildPersonaPrompt(brew, 3);
    expect(prompt).toContain("人数: 3");
    expect(prompt).toContain("conceptの内容");
    expect(prompt).toContain("targetUsersの内容");
    expect(prompt).toContain("featuresの内容");
  });

  it("シートがなければエラー", async () => {
    const brew = await createBrew("シートなし");
    expect(() => buildPersonaPrompt(brew, 1)).toThrow(/ブリューシート/);
  });
});

describe("generatePersonas", () => {
  it("指定人数のペルソナを origin: auto で返す", async () => {
    const brew = await sheetedBrew();
    const personas = await generatePersonas(createFakeClient(), brew, 2);
    expect(personas).toHaveLength(2);
    expect(personas.every((p) => p.origin === "auto")).toBe(true);
    expect(personas[0].goals.length).toBeGreaterThanOrEqual(1);
  });
});

describe("savedToPersona", () => {
  it("常連客を origin: saved の PubPersona に変換する", () => {
    const p = savedToPersona({ id: "x", name: "常連A", profile: "毎日来る", goals: ["見る"] });
    expect(p).toEqual({ name: "常連A", profile: "毎日来る", goals: ["見る"], origin: "saved" });
  });
});
```

- [ ] **Step 2: personas.ts を実装**

`src/lib/pub/personas.ts` を新規作成:

```ts
import { z } from "zod";
import type { LlmClient } from "@/lib/llm/client";
import type { Brew, PubPersona, SavedPersona } from "@/lib/store/types";
import { SHEET_LABELS } from "@/lib/store/types";

const personasSchema = z.object({
  personas: z
    .array(
      z.object({
        name: z.string().min(1),
        profile: z.string().min(1),
        goals: z.array(z.string().min(1)).min(1).max(3),
      }),
    )
    .min(1)
    .max(5),
});

const PERSONA_SYSTEM = [
  "あなたは idea brewing の Pub の店主です。生成された Web サービスを試してくれる「AI客」を招きます。",
  "ブリューシートのターゲットユーザー像に合い、互いに個性・習熟度の異なるペルソナを指定人数ちょうど作ってください。",
  "goals はこのアプリを実際に操作して達成できる具体的な目的(1〜3件)にします。",
].join("\n");

export function buildPersonaPrompt(brew: Brew, count: number): string {
  const sheet = brew.sheet;
  if (!sheet) throw new Error("ブリューシートがありません。");
  return [
    `人数: ${count}`,
    `## ${SHEET_LABELS.concept}`,
    sheet.concept.content,
    `## ${SHEET_LABELS.targetUsers}`,
    sheet.targetUsers.content,
    `## ${SHEET_LABELS.features}`,
    sheet.features.content,
  ].join("\n\n");
}

/** ブリューシートから AI 客を自動生成する(origin: "auto") */
export async function generatePersonas(
  client: LlmClient,
  brew: Brew,
  count: number,
): Promise<PubPersona[]> {
  const prompt = buildPersonaPrompt(brew, count);
  const raw = await client.generateObject(personasSchema, {
    tag: "pub-persona",
    system: PERSONA_SYSTEM,
    prompt,
  });
  return raw.personas.slice(0, count).map((p) => ({ ...p, origin: "auto" as const }));
}

/** 常連客を Pub 参加用の PubPersona に変換する */
export function savedToPersona(saved: SavedPersona): PubPersona {
  return { name: saved.name, profile: saved.profile, goals: saved.goals, origin: "saved" };
}
```

注意: `BrewSheet` のフィールドは `SheetField`(`content` / `sufficiency` / `userEdited`)。`sheet.concept.content` の形でアクセスできることを `src/lib/store/types.ts` で確認すること。

- [ ] **Step 3: テスト実行とコミット**

```powershell
npx vitest run tests/unit/pub-personas.test.ts
npm test
git add -A
git commit -m "feat: Pubペルソナの自動生成と常連客変換を追加"
```

---

### Task 4: ブラウザドライバ(driver.ts + fake-driver.ts)

**Files:**
- Create: `src/lib/pub/driver.ts`
- Create: `src/lib/pub/fake-driver.ts`
- Test: `tests/unit/pub-driver.test.ts`

Playwright 実機部分(`createPlaywrightPubDriver`)は第3版の `launchChromium` と同様に単体テスト対象外(手動確認 + 実キー確認でカバー)。純粋関数(`truncateSnapshot` / `isFailureObservation`)とフェイクドライバをテストする。

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/pub-driver.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import { isFailureObservation, truncateSnapshot } from "@/lib/pub/driver";
import { createFakePubDriver } from "@/lib/pub/fake-driver";

describe("truncateSnapshot", () => {
  it("上限以下はそのまま", () => {
    expect(truncateSnapshot("abc")).toBe("abc");
  });

  it("8KBを超えると切り詰めて省略注記を付ける", () => {
    const long = "あ".repeat(10_000);
    const out = truncateSnapshot(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("(以下省略)");
  });
});

describe("isFailureObservation", () => {
  it("失敗プレフィックスを判定する", () => {
    expect(isFailureObservation("操作に失敗しました: 要素なし")).toBe(true);
    expect(isFailureObservation("操作に成功しました。")).toBe(false);
  });
});

describe("fake driver", () => {
  it("固定のページ状態を返し、アクションを記録する", async () => {
    const driver = createFakePubDriver();
    await driver.open("/");
    const state = await driver.readState();
    expect(state.title).toContain("フェイク");
    expect(state.elements[0].index).toBe(1);
    const obs = await driver.act({ kind: "click", target: 1, reason: "テスト" });
    expect(obs).toBe("操作に成功しました。");
    expect(driver.actions).toHaveLength(1);
    await driver.screenshot("unused.png"); // 何もしない(例外を投げない)
    await driver.close();
  });
});
```

- [ ] **Step 2: driver.ts を実装**

`src/lib/pub/driver.ts` を新規作成:

```ts
export interface PubElement {
  index: number; // 1始まり。アクションの target に使う
  kind: string; // button / link / textbox など
  label: string; // アクセシブルネーム(なければ表示テキスト)
  value?: string; // 入力系の現在値
}

export interface PubPageState {
  url: string;
  title: string;
  snapshot: string; // ARIAスナップショット等のテキスト要約
  elements: PubElement[];
}

export interface PubAction {
  kind: "click" | "fill" | "select" | "press" | "goto" | "finish";
  target?: number;
  value?: string;
  key?: string;
  path?: string;
  reason: string;
}

export interface PubDriver {
  open(path: string): Promise<void>;
  readState(): Promise<PubPageState>;
  /** アクションを実行し observation を返す。失敗も例外でなく文字列で返す契約 */
  act(action: PubAction): Promise<string>;
  screenshot(filePath: string): Promise<void>;
  close(): Promise<void>;
}

const SNAPSHOT_LIMIT = 8 * 1024;
const MAX_ELEMENTS = 50;
const ACTION_TIMEOUT = 5_000;
const SETTLE_TIMEOUT = 10_000;
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
].join(", ");

const FAILURE_PREFIX = "操作に失敗しました";

export function isFailureObservation(observation: string): boolean {
  return observation.startsWith(FAILURE_PREFIX);
}

export function truncateSnapshot(text: string): string {
  if (text.length <= SNAPSHOT_LIMIT) return text;
  return `${text.slice(0, SNAPSHOT_LIMIT)}\n(以下省略)`;
}

/** 生成アプリを操作する Playwright ドライバ。ページは 1280x800 の 1 枚を使い回す */
export async function createPlaywrightPubDriver(baseUrl: string): Promise<PubDriver> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let handles: Awaited<ReturnType<typeof page.locator>>[] = [];

  async function settle(): Promise<void> {
    await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT }).catch(() => undefined);
  }

  return {
    async open(pathname: string): Promise<void> {
      await page.goto(baseUrl + pathname, { timeout: 15_000 });
      await settle();
    },

    async readState(): Promise<PubPageState> {
      const all = await page.locator(INTERACTIVE_SELECTOR).all();
      handles = [];
      const elements: PubElement[] = [];
      for (const h of all) {
        if (elements.length >= MAX_ELEMENTS) break;
        if (!(await h.isVisible().catch(() => false))) continue;
        const kind = await h
          .evaluate((el) => el.getAttribute("role") ?? el.tagName.toLowerCase())
          .catch(() => "unknown");
        const aria = await h.getAttribute("aria-label").catch(() => null);
        const text = aria ?? (await h.innerText().catch(() => "")).trim();
        const placeholder = await h.getAttribute("placeholder").catch(() => null);
        const label = (text || placeholder || "").slice(0, 60);
        const value = await h.inputValue().catch(() => undefined);
        handles.push(h);
        elements.push({
          index: handles.length,
          kind,
          label,
          ...(value !== undefined ? { value } : {}),
        });
      }
      let snapshot = "";
      try {
        snapshot = await page.locator("body").ariaSnapshot();
      } catch {
        snapshot = await page.locator("body").innerText().catch(() => "");
      }
      return {
        url: page.url(),
        title: await page.title().catch(() => ""),
        snapshot: truncateSnapshot(snapshot),
        elements,
      };
    },

    async act(action: PubAction): Promise<string> {
      try {
        switch (action.kind) {
          case "click":
          case "fill":
          case "select": {
            const h = handles[(action.target ?? 0) - 1];
            if (!h) return `${FAILURE_PREFIX}: 対象の要素が見つかりません。`;
            if (action.kind === "click") await h.click({ timeout: ACTION_TIMEOUT });
            if (action.kind === "fill") await h.fill(action.value ?? "", { timeout: ACTION_TIMEOUT });
            if (action.kind === "select")
              await h.selectOption(action.value ?? "", { timeout: ACTION_TIMEOUT });
            break;
          }
          case "press":
            await page.keyboard.press(action.key || "Enter");
            break;
          case "goto": {
            const p = action.path ?? "";
            if (!p.startsWith("/")) return `${FAILURE_PREFIX}: 外部URLへは移動できません。`;
            await page.goto(baseUrl + p, { timeout: 15_000 });
            break;
          }
          case "finish":
            return "セッションを終了しました。";
        }
        await settle();
        return "操作に成功しました。";
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
        return `${FAILURE_PREFIX}: ${message}`;
      }
    },

    async screenshot(filePath: string): Promise<void> {
      await page.screenshot({ path: filePath });
    },

    async close(): Promise<void> {
      await browser.close();
    },
  };
}
```

注意:
- `ariaSnapshot()` は Playwright 1.49+ の API(本リポジトリは 1.61)。実行時エラーに備えて `innerText` フォールバックを入れている
- `handles` は直近の `readState()` の結果に対応する。LLM が見た番号と実行対象が一致する(`act` の前に必ず `readState` を呼ぶのは session 側の責務)

- [ ] **Step 3: fake-driver.ts を実装**

`src/lib/pub/fake-driver.ts` を新規作成:

```ts
import type { PubAction, PubDriver, PubPageState } from "./driver";

export interface FakePubDriver extends PubDriver {
  actions: PubAction[];
}

/** 実ブラウザを起動しないフェイクドライバ(fake モード・単体テスト用) */
export function createFakePubDriver(): FakePubDriver {
  const actions: PubAction[] = [];
  const state: PubPageState = {
    url: "http://localhost:0/",
    title: "フェイクタップアプリ",
    snapshot: "heading: フェイクタップアプリ",
    elements: [{ index: 1, kind: "button", label: "フェイクボタン" }],
  };
  return {
    actions,
    async open(): Promise<void> {},
    async readState(): Promise<PubPageState> {
      return state;
    },
    async act(action: PubAction): Promise<string> {
      actions.push(action);
      return "操作に成功しました。";
    },
    async screenshot(): Promise<void> {
      // fake モードではスクリーンショットを保存しない(設計 §7)
    },
    async close(): Promise<void> {},
  };
}
```

- [ ] **Step 4: テスト実行とコミット**

```powershell
npx vitest run tests/unit/pub-driver.test.ts
npx tsc --noEmit
npm test
git add -A
git commit -m "feat: Pubブラウザドライバ(Playwright実装+フェイク)を追加"
```

---

### Task 5: AI 客セッション(session.ts)

**Files:**
- Create: `src/lib/pub/session.ts`
- Test: `tests/unit/pub-session.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/pub-session.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { GenerateOptions, LlmClient } from "@/lib/llm/client";
import { createFakeClient } from "@/lib/llm/fake-client";
import { createFakePubDriver } from "@/lib/pub/fake-driver";
import { MAX_SESSION_STEPS, alignTaskResults, runPersonaSession } from "@/lib/pub/session";
import type { PubPersona } from "@/lib/store/types";
import { PUB_AXES } from "@/lib/store/types";

const persona: PubPersona = {
  name: "テスト客",
  profile: "せっかち",
  goals: ["トップを見る", "ボタンを押す"],
  origin: "auto",
};

/** 特定タグの generateObject を差し替えるクライアント */
function stubClient(overrides: Partial<Record<string, () => unknown>>): LlmClient {
  const base = createFakeClient();
  return {
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      const over = overrides[opts.tag];
      if (over) return schema.parse(over());
      return base.generateObject(schema, opts);
    },
    generateText: (opts) => base.generateText(opts),
  };
}

describe("runPersonaSession", () => {
  it("finish で終了し、評価聴取で completed になる", async () => {
    const driver = createFakePubDriver();
    const result = await runPersonaSession(createFakeClient(), driver, persona);
    expect(result.status).toBe("completed");
    expect(result.steps.length).toBe(2); // click + finish
    expect(result.scores.map((s) => s.name)).toEqual([...PUB_AXES]);
    expect(result.overall).toBe(4.5); // (5+4+4+5)/4
    expect(result.taskResults).toHaveLength(2); // goals と同数に揃う
    expect(result.taskResults[0].goal).toBe("トップを見る");
    expect(driver.actions).toHaveLength(1); // finish はドライバに送らない
  });

  it("ステップ上限で打ち切っても評価聴取して completed になる", async () => {
    const client = stubClient({
      "pub-action": () => ({ kind: "click", target: 1, reason: "延々押す" }),
    });
    const result = await runPersonaSession(client, createFakePubDriver(), persona);
    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(MAX_SESSION_STEPS);
  });

  it("操作失敗が3連続でセッション中断(aborted)", async () => {
    const driver = createFakePubDriver();
    driver.act = async () => "操作に失敗しました: フェイク失敗";
    const client = stubClient({
      "pub-action": () => ({ kind: "click", target: 1, reason: "押す" }),
    });
    const result = await runPersonaSession(client, driver, persona);
    expect(result.status).toBe("aborted");
    expect(result.steps).toHaveLength(3);
    expect(result.comment).toContain("失敗が続き");
  });

  it("行動決定のLLM失敗で aborted", async () => {
    const client = stubClient({
      "pub-action": () => {
        throw new Error("LLM死亡");
      },
    });
    const result = await runPersonaSession(client, createFakePubDriver(), persona);
    expect(result.status).toBe("aborted");
    expect(result.comment).toContain("次の操作");
  });

  it("評価聴取のLLM失敗で aborted", async () => {
    const client = stubClient({
      "pub-feedback": () => {
        throw new Error("LLM死亡");
      },
    });
    const result = await runPersonaSession(client, createFakePubDriver(), persona);
    expect(result.status).toBe("aborted");
    expect(result.comment).toContain("評価の聴取");
  });

  it("target が必要なアクションに target がなければ失敗として数える", async () => {
    let calls = 0;
    const client = stubClient({
      "pub-action": () => {
        calls += 1;
        return { kind: "fill", value: "x", reason: "対象指定漏れ" };
      },
    });
    const driver = createFakePubDriver();
    const result = await runPersonaSession(client, driver, persona);
    expect(result.status).toBe("aborted"); // 3連続の不正アクションで中断
    expect(driver.actions).toHaveLength(0); // ドライバには送られない
    expect(calls).toBe(3);
  });

  it("キャンセルで aborted(以降のLLM呼び出しをしない)", async () => {
    const result = await runPersonaSession(createFakeClient(), createFakePubDriver(), persona, {
      cancel: { cancelled: true },
    });
    expect(result.status).toBe("aborted");
    expect(result.comment).toContain("中断");
  });

  it("onStep がステップ番号つきで呼ばれる", async () => {
    const steps: number[] = [];
    await runPersonaSession(createFakeClient(), createFakePubDriver(), persona, {
      onStep: (s) => void steps.push(s),
    });
    expect(steps).toEqual([1, 2]);
  });
});

describe("alignTaskResults", () => {
  it("goals と件数を揃える(不足は未回答、超過は捨てる)", () => {
    const aligned = alignTaskResults(
      ["a", "b", "c"],
      [{ achieved: true, note: "済" }],
    );
    expect(aligned).toHaveLength(3);
    expect(aligned[0]).toEqual({ goal: "a", achieved: true, note: "済" });
    expect(aligned[1].achieved).toBe(false);
    expect(aligned[1].note).toContain("回答があり");
  });
});
```

- [ ] **Step 2: session.ts を実装**

`src/lib/pub/session.ts` を新規作成:

```ts
import { z } from "zod";
import type { LlmClient } from "@/lib/llm/client";
import type { PubPersona, PubPersonaResult, PubStep, PubTaskResult } from "@/lib/store/types";
import { PUB_AXES } from "@/lib/store/types";
import type { CancelToken } from "@/lib/tap/build-state";
import { isFailureObservation, type PubAction, type PubDriver, type PubPageState } from "./driver";

export const MAX_SESSION_STEPS = 15;
const MAX_CONSECUTIVE_FAILURES = 3;

const actionSchema = z.object({
  kind: z.enum(["click", "fill", "select", "press", "goto", "finish"]),
  target: z.number().int().min(1).nullish(),
  value: z.string().nullish(),
  key: z.string().nullish(),
  path: z.string().nullish(),
  reason: z.string().min(1),
});

const feedbackSchema = z.object({
  taskResults: z
    .array(z.object({ achieved: z.boolean(), note: z.string() }))
    .min(1)
    .max(3),
  scores: z.object({
    purpose: z.number().int().min(1).max(5),
    usability: z.number().int().min(1).max(5),
    looks: z.number().int().min(1).max(5),
    revisit: z.number().int().min(1).max(5),
  }),
  comment: z.string().min(1),
});

const ACTION_SYSTEM = [
  "あなたは Pub に招かれた客として、目の前の Web アプリを実際に操作します。",
  "与えられたペルソナになりきり、goals を達成するために次の 1 手だけを決めてください。",
  "操作対象はページ状態の要素番号(target)で指定します。",
  "goals を達成できた、またはこれ以上進められないと判断したら kind: finish を選びます。",
].join("\n");

const FEEDBACK_SYSTEM = [
  "あなたは Pub でアプリを試し終えた客です。ペルソナとして正直に評価してください。",
  "taskResults は goals と同じ順番で、達成できたかと経緯を書きます。",
  "scores は 1〜5 の整数(purpose=目的達成 / usability=使いやすさ / looks=見た目・第一印象 / revisit=また来たいか)。",
  "comment は客としての一言レビューです。",
].join("\n");

function personaSection(persona: PubPersona): string {
  return [
    `## あなたのペルソナ`,
    `名前: ${persona.name}`,
    `プロフィール: ${persona.profile}`,
    "goals:",
    ...persona.goals.map((g, i) => `${i + 1}. ${g}`),
  ].join("\n");
}

function renderState(state: PubPageState): string {
  return [
    "## 現在のページ",
    `URL: ${state.url}`,
    `タイトル: ${state.title}`,
    "### 操作可能な要素",
    ...(state.elements.length > 0
      ? state.elements.map(
          (e) => `[${e.index}] ${e.kind}「${e.label}」${e.value !== undefined ? `(値: ${e.value})` : ""}`,
        )
      : ["(操作可能な要素が見つかりません)"]),
    "### ページ内容",
    state.snapshot,
  ].join("\n");
}

function buildActionPrompt(persona: PubPersona, steps: PubStep[], state: PubPageState): string {
  const history =
    steps.length > 0
      ? ["## これまでの行動", ...steps.slice(-5).map((s) => `${s.step}. ${s.action} → ${s.observation}`)]
      : [];
  return [personaSection(persona), ...history, renderState(state)].join("\n\n");
}

function buildFeedbackPrompt(persona: PubPersona, steps: PubStep[]): string {
  return [
    personaSection(persona),
    "## セッションの行動ログ",
    ...steps.map((s) => `${s.step}. ${s.action} → ${s.observation}`),
  ].join("\n");
}

function describeAction(action: PubAction): string {
  const target = action.target != null ? ` [${action.target}]` : "";
  const value = action.value ? ` "${action.value}"` : "";
  const extra = action.key ? ` ${action.key}` : action.path ? ` ${action.path}` : "";
  return `${action.kind}${target}${value}${extra}(${action.reason})`;
}

function toAction(raw: z.infer<typeof actionSchema>): PubAction {
  return {
    kind: raw.kind,
    target: raw.target ?? undefined,
    value: raw.value ?? undefined,
    key: raw.key ?? undefined,
    path: raw.path ?? undefined,
    reason: raw.reason,
  };
}

/** feedback の taskResults を goals と同数・同順に揃える */
export function alignTaskResults(
  goals: string[],
  results: { achieved: boolean; note: string }[],
): PubTaskResult[] {
  return goals.map((goal, i) => ({
    goal,
    achieved: results[i]?.achieved ?? false,
    note: results[i]?.note ?? "回答がありませんでした",
  }));
}

export interface SessionHooks {
  cancel?: CancelToken;
  onStep?: (step: number) => Promise<void> | void;
}

/** 1 ペルソナのセッション(観察→行動ループ→評価聴取)。例外を投げず必ず結果を返す */
export async function runPersonaSession(
  client: LlmClient,
  driver: PubDriver,
  persona: PubPersona,
  hooks: SessionHooks = {},
): Promise<PubPersonaResult> {
  const steps: PubStep[] = [];
  const aborted = (comment: string): PubPersonaResult => ({
    persona,
    status: "aborted",
    taskResults: [],
    scores: [],
    overall: 0,
    comment,
    steps,
  });

  try {
    await driver.open("/");
  } catch {
    return aborted("セッション中断(ページを開けませんでした)");
  }

  let failures = 0;
  for (let step = 1; step <= MAX_SESSION_STEPS; step++) {
    if (hooks.cancel?.cancelled) return aborted("セッション中断(ユーザー中断)");
    await hooks.onStep?.(step);

    let action: PubAction;
    try {
      const state = await driver.readState();
      const raw = await client.generateObject(actionSchema, {
        tag: "pub-action",
        system: ACTION_SYSTEM,
        prompt: buildActionPrompt(persona, steps, state),
      });
      action = toAction(raw);
    } catch {
      return aborted("セッション中断(次の操作を決められませんでした)");
    }

    if (action.kind === "finish") {
      steps.push({ step, action: describeAction(action), observation: "客が操作を終えました。" });
      break;
    }

    const needsTarget = action.kind === "click" || action.kind === "fill" || action.kind === "select";
    const observation =
      needsTarget && action.target == null
        ? "操作に失敗しました: 対象の要素が指定されていません。"
        : await driver.act(action);
    steps.push({ step, action: describeAction(action), observation });

    failures = isFailureObservation(observation) ? failures + 1 : 0;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      return aborted("セッション中断(操作の失敗が続きました)");
    }
  }

  if (hooks.cancel?.cancelled) return aborted("セッション中断(ユーザー中断)");

  try {
    const raw = await client.generateObject(feedbackSchema, {
      tag: "pub-feedback",
      system: FEEDBACK_SYSTEM,
      prompt: buildFeedbackPrompt(persona, steps),
    });
    const scores = [
      { name: PUB_AXES[0], score: raw.scores.purpose, comment: "" },
      { name: PUB_AXES[1], score: raw.scores.usability, comment: "" },
      { name: PUB_AXES[2], score: raw.scores.looks, comment: "" },
      { name: PUB_AXES[3], score: raw.scores.revisit, comment: "" },
    ];
    const overall =
      Math.round((scores.reduce((sum, s) => sum + s.score, 0) / scores.length) * 10) / 10;
    return {
      persona,
      status: "completed",
      taskResults: alignTaskResults(persona.goals, raw.taskResults),
      scores,
      overall,
      comment: raw.comment,
      steps,
    };
  } catch {
    return aborted("セッション中断(評価の聴取に失敗しました)");
  }
}
```

- [ ] **Step 3: テスト実行とコミット**

```powershell
npx vitest run tests/unit/pub-session.test.ts
npm test
git add -A
git commit -m "feat: AI客セッション(行動ループと評価聴取)を追加"
```

---

### Task 6: Pub オーケストレータ・ロック・deps 解決

**Files:**
- Create: `src/lib/pub/pub-state.ts`
- Create: `src/lib/pub/index.ts`
- Create: `src/lib/pub/resolve.ts`
- Modify: `src/lib/mature/mature-state.ts`
- Test: `tests/unit/pub.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/pub.test.ts` を新規作成:

```ts
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { GenerateOptions, LlmClient } from "@/lib/llm/client";
import { createFakeClient } from "@/lib/llm/fake-client";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { normalizeStalePub, pubDir, runPub, type PubDeps } from "@/lib/pub";
import { createFakePubDriver } from "@/lib/pub/fake-driver";
import { pubbingBrews } from "@/lib/pub/pub-state";
import { createBrew, writeBrew } from "@/lib/store";
import type { Brew, BrewSheet, SavedPersona } from "@/lib/store/types";
import { SHEET_KEYS } from "@/lib/store/types";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "idea-brewing-test-"));
  process.env.IDEA_BREWING_DATA_DIR = tmp;
});

afterEach(async () => {
  delete process.env.IDEA_BREWING_DATA_DIR;
  pubbingBrews.clear();
  await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function sheet(): BrewSheet {
  return Object.fromEntries(
    SHEET_KEYS.map((key) => [key, { content: `${key}の内容`, sufficiency: "full", userEdited: false }]),
  ) as unknown as BrewSheet;
}

async function builtBrew(): Promise<Brew> {
  const brew = await createBrew("パブ");
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

function deps(overrides?: Partial<PubDeps>): PubDeps {
  return {
    client: createFakeClient(),
    startServer: async () => ({ port: 0 }),
    stopServer: async () => undefined,
    createDriver: async () => createFakePubDriver(),
    ...overrides,
  };
}

const regular: SavedPersona = { id: "r1", name: "常連A", profile: "毎日来る", goals: ["見る"] };

/** 特定タグで失敗するクライアント */
function failingClient(tag: string, times = Infinity): LlmClient {
  const base = createFakeClient();
  let failed = 0;
  return {
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      if (opts.tag === tag && failed < times) {
        failed += 1;
        throw new Error("LLM死亡");
      }
      return base.generateObject(schema, opts);
    },
    generateText: (opts) => base.generateText(opts),
  };
}

describe("runPub", () => {
  it("常連+自動生成で完走し、レポートを保存する", async () => {
    const brew = await builtBrew();
    const done = await runPub(brew, deps(), { autoCount: 1, savedPersonas: [regular] });
    const report = done.batches[0].pub;
    expect(report).not.toBeNull();
    expect(report!.personaResults).toHaveLength(2);
    expect(report!.personaResults[0].persona.origin).toBe("saved"); // 常連が先
    expect(report!.personaResults[1].persona.origin).toBe("auto");
    expect(report!.overall).toBe(3.9); // (4.5 + 3.3) / 2 → 3.9
    expect(report!.summary).toContain("フェイク総括");
    expect(done.pubProgress).toBeNull();
    expect(existsSync(path.join(pubDir(brew.id, 1), "report.md"))).toBe(true);
  });

  it("成功バッチがなければエラー", async () => {
    const brew = await createBrew("未ビルド");
    await expect(runPub(brew, deps(), { autoCount: 1, savedPersonas: [] })).rejects.toThrow(
      /成功したバッチ/,
    );
  });

  it("サーバー起動失敗で Pub 全体が失敗し、進捗をクリアする", async () => {
    const brew = await builtBrew();
    const progress: Brew[] = [];
    await expect(
      runPub(
        brew,
        deps({
          startServer: async () => {
            throw new Error("起動失敗");
          },
          onProgress: (b) => void progress.push(b),
        }),
        { autoCount: 1, savedPersonas: [] },
      ),
    ).rejects.toThrow(/起動失敗/);
    expect(progress[progress.length - 1].pubProgress).toBeNull();
  });

  it("1人が破綻しても続行し、レポートには aborted で残る", async () => {
    const brew = await builtBrew();
    // 1人目の行動決定だけ失敗させる(1回で aborted になる)
    const done = await runPub(brew, deps({ client: failingClient("pub-action", 1) }), {
      autoCount: 0,
      savedPersonas: [regular, { ...regular, id: "r2", name: "常連B" }],
    });
    const report = done.batches[0].pub!;
    expect(report.personaResults[0].status).toBe("aborted");
    expect(report.personaResults[1].status).toBe("completed");
    expect(report.overall).toBe(4.5); // completed 1人だけで平均
  });

  it("全員破綻したら Pub 全体が失敗する", async () => {
    const brew = await builtBrew();
    await expect(
      runPub(brew, deps({ client: failingClient("pub-action") }), {
        autoCount: 0,
        savedPersonas: [regular],
      }),
    ).rejects.toThrow(/すべてのAI客/);
  });

  it("ペルソナ生成失敗で Pub 全体が失敗する", async () => {
    const brew = await builtBrew();
    await expect(
      runPub(brew, deps({ client: failingClient("pub-persona") }), {
        autoCount: 1,
        savedPersonas: [],
      }),
    ).rejects.toThrow();
  });

  it("キャンセルでレポートを保存せず進捗なしで返す", async () => {
    const brew = await builtBrew();
    const done = await runPub(brew, deps({ cancel: { cancelled: true } }), {
      autoCount: 1,
      savedPersonas: [],
    });
    expect(done.batches[0].pub).toBeNull();
    expect(done.pubProgress).toBeNull();
  });

  it("再実行でレポートを上書きする", async () => {
    const brew = await builtBrew();
    const once = await runPub(brew, deps(), { autoCount: 1, savedPersonas: [] });
    const twice = await runPub(once, deps(), { autoCount: 2, savedPersonas: [] });
    expect(twice.batches[0].pub!.personaResults).toHaveLength(2);
  });

  it("サーバーは成功・失敗どちらでも必ず停止される", async () => {
    const brew = await builtBrew();
    let stopped = 0;
    await runPub(brew, deps({ stopServer: async () => void (stopped += 1) }), {
      autoCount: 1,
      savedPersonas: [],
    });
    // 開店前の念のため停止 + finally の停止
    expect(stopped).toBeGreaterThanOrEqual(2);
  });
});

describe("normalizeStalePub / isBrewBusy", () => {
  it("pubProgress 残留を null に補正する(なければ同一参照)", async () => {
    const brew = await builtBrew();
    expect(normalizeStalePub(brew)).toBe(brew);
    const stale = { ...brew, pubProgress: { phase: "serving" as const, detail: "x", batch: 1 } };
    expect(normalizeStalePub(stale).pubProgress).toBeNull();
  });

  it("pubbingBrews も isBrewBusy に含まれる", async () => {
    const brew = await builtBrew();
    expect(isBrewBusy(brew.id)).toBe(false);
    pubbingBrews.add(brew.id);
    expect(isBrewBusy(brew.id)).toBe(true);
  });
});
```

- [ ] **Step 2: pub-state.ts を実装**

`src/lib/pub/pub-state.ts` を新規作成(依存なし。循環 import を避けるため他モジュールを import しない):

```ts
import type { CancelToken } from "@/lib/tap/build-state";

// Pub 実行中のブリューID(ビルド・熟成と同じインメモリロック方式)
export const pubbingBrews = new Set<string>();

// Pub 中断用トークン(pub/run が登録し、pub/cancel が立てる)
export const pubCancelTokens = new Map<string, CancelToken>();
```

(`CancelToken` は型 import のみなので実行時の循環は生じない)

- [ ] **Step 3: isBrewBusy に pubbingBrews を追加**

`src/lib/mature/mature-state.ts`:

```ts
import type { CancelToken } from "@/lib/tap/build-state";
import { buildingBrews } from "@/lib/tap/build-state";
import { pubbingBrews } from "@/lib/pub/pub-state";

// 熟成実行中のブリューID(ビルド工程と同じインメモリロック方式)
export const maturingBrews = new Set<string>();

// 熟成中断用トークン(mature系ルートが登録し、cancelルートが立てる)
export const matureCancelTokens = new Map<string, CancelToken>();

/** ビルド・熟成・Pub いずれかが実行中か(相互排他の判定に使う) */
export function isBrewBusy(brewId: string): boolean {
  return buildingBrews.has(brewId) || maturingBrews.has(brewId) || pubbingBrews.has(brewId);
}
```

既存の tap / mature / recipe 系ルートは `isBrewBusy` を参照しているため、この 1 箇所の変更で「Pub 実行中は 409」が全ルートに波及する。

- [ ] **Step 4: pub/index.ts(オーケストレータ)を実装**

`src/lib/pub/index.ts` を新規作成:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LlmClient } from "@/lib/llm/client";
import { tapDir } from "@/lib/store";
import type {
  Brew,
  PubPersona,
  PubPersonaResult,
  PubPhase,
  PubReport,
  SavedPersona,
} from "@/lib/store/types";
import { latestSucceededBatch, upsertBatch } from "@/lib/tap/batches";
import type { CancelToken } from "@/lib/tap/build-state";
import type { PubDriver } from "./driver";
import { generatePersonas, savedToPersona } from "./personas";
import { runPersonaSession } from "./session";

export interface PubDeps {
  client: LlmClient;
  startServer: (brewId: string, batch: number) => Promise<{ port: number }>;
  stopServer: (brewId: string) => Promise<void>;
  createDriver: (baseUrl: string) => Promise<PubDriver>;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}

export interface PubOptions {
  autoCount: number; // 自動生成の人数(0〜5)
  savedPersonas: SavedPersona[]; // 参加する常連客(ルート層でID解決済み)
}

const SUMMARY_SYSTEM = [
  "あなたは Pub の店主です。AI客たちの評価とセッションの様子から、開発者向けに評判を総括します。",
  "良かった点・共通する不満・目立った行動のつまずきを簡潔にまとめてください。",
].join("\n");

function withPub(brew: Brew, phase: PubPhase, detail: string, batch: number): Brew {
  return { ...brew, pubProgress: { phase, detail, batch } };
}

/** クラッシュで残った pubProgress を消す。補正不要なら同一参照を返す */
export function normalizeStalePub(brew: Brew): Brew {
  if (brew.pubProgress === null) return brew;
  return { ...brew, pubProgress: null };
}

export function pubDir(brewId: string, batch: number): string {
  return path.join(tapDir(brewId, batch), "pub");
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildSummaryPrompt(results: PubPersonaResult[]): string {
  const sections = results.map((r) => {
    const head = `## ${r.persona.name}(${r.persona.origin === "saved" ? "常連" : "自動生成"} / ${
      r.status === "completed" ? `総合 ${r.overall.toFixed(1)}` : "セッション中断"
    })`;
    const body =
      r.status === "completed"
        ? [
            ...r.scores.map((s) => `- ${s.name}: ${s.score}`),
            `- レビュー: ${r.comment}`,
            ...r.taskResults.map((t) => `- [${t.achieved ? "達成" : "未達"}] ${t.goal}: ${t.note}`),
          ]
        : [`- ${r.comment}`];
    return [head, ...body].join("\n");
  });
  return sections.join("\n\n");
}

export function renderPubMarkdown(batch: number, report: PubReport): string {
  const completed = report.personaResults.filter((r) => r.status === "completed").length;
  const lines: string[] = [
    `# バッチ${batch} Pubレポート`,
    "",
    `- 総合スコア: ${report.overall.toFixed(1)} / 5.0`,
    `- 実施日時: ${report.ranAt}`,
    `- 客数: ${report.personaResults.length}(完走 ${completed})`,
    "",
    "## 総括",
    "",
    report.summary,
    "",
  ];
  for (const r of report.personaResults) {
    lines.push(`## ${r.persona.name}${r.persona.origin === "saved" ? "(常連)" : ""}`, "");
    lines.push(r.persona.profile, "");
    if (r.status === "aborted") {
      lines.push(`(${r.comment})`, "");
    } else {
      lines.push(
        `- 総合: ${r.overall.toFixed(1)} / 5.0`,
        ...r.scores.map((s) => `- ${s.name}: ${s.score}`),
        "",
        `> ${r.comment}`,
        "",
        "### タスク結果",
        "",
        ...r.taskResults.map((t) => `- [${t.achieved ? "x" : " "}] ${t.goal} — ${t.note}`),
        "",
      );
    }
    lines.push("### 行動ログ", "", ...r.steps.map((s) => `${s.step}. ${s.action} → ${s.observation}`), "");
  }
  return lines.join("\n");
}

async function writePubReport(brewId: string, batch: number, report: PubReport): Promise<void> {
  await fs.mkdir(pubDir(brewId, batch), { recursive: true });
  await fs.writeFile(path.join(pubDir(brewId, batch), "report.md"), renderPubMarkdown(batch, report), "utf8");
}

/** 最新成功バッチに AI 客を招いて Pub を実行し、PubReport を保存した Brew を返す */
export async function runPub(brew: Brew, deps: PubDeps, opts: PubOptions): Promise<Brew> {
  const target = latestSucceededBatch(brew);
  if (!target) throw new Error("成功したバッチがありません。先にビルドを完了してください。");
  const total = opts.autoCount + opts.savedPersonas.length;
  if (total < 1 || total > 5) throw new Error("客の人数は合計1〜5にしてください。");

  let current = withPub(brew, "opening", "生成アプリを起動しています", target.number);
  try {
    await deps.onProgress?.(current);
    if (deps.cancel?.cancelled) return { ...current, pubProgress: null };

    // 撮影と同じ理由で、稼働中の「注ぐ」サーバーがあれば止めてから開店する
    await deps.stopServer(brew.id).catch(() => undefined);
    const { port } = await deps.startServer(brew.id, target.number);
    try {
      current = withPub(current, "opening", "AI客のペルソナを準備しています", target.number);
      await deps.onProgress?.(current);
      const personas: PubPersona[] = opts.savedPersonas.map(savedToPersona);
      if (opts.autoCount > 0) {
        personas.push(...(await generatePersonas(deps.client, current, opts.autoCount)));
      }
      if (deps.cancel?.cancelled) return { ...current, pubProgress: null };

      await fs.mkdir(pubDir(brew.id, target.number), { recursive: true });
      const results: PubPersonaResult[] = [];
      for (let i = 0; i < personas.length; i++) {
        if (deps.cancel?.cancelled) return { ...current, pubProgress: null };
        const persona = personas[i];
        const label = `ペルソナ ${i + 1}/${personas.length}「${persona.name}」`;
        current = withPub(current, "serving", `${label}: セッション開始`, target.number);
        await deps.onProgress?.(current);

        const driver = await deps.createDriver(`http://localhost:${port}`);
        try {
          const result = await runPersonaSession(deps.client, driver, persona, {
            cancel: deps.cancel,
            onStep: async (step) => {
              current = withPub(current, "serving", `${label}: ステップ ${step}`, target.number);
              await deps.onProgress?.(current);
            },
          });
          await driver
            .screenshot(path.join(pubDir(brew.id, target.number), `persona-${i + 1}.png`))
            .catch(() => undefined);
          results.push(result);
        } finally {
          await driver.close().catch(() => undefined);
        }
      }
      if (deps.cancel?.cancelled) return { ...current, pubProgress: null };

      const completed = results.filter((r) => r.status === "completed");
      if (completed.length === 0) {
        throw new Error("すべてのAI客のセッションが失敗しました。設定を確認して再実行してください。");
      }

      current = withPub(current, "closing", "客の評判をまとめています", target.number);
      await deps.onProgress?.(current);
      const summary = await deps.client.generateText({
        tag: "pub-summary",
        system: SUMMARY_SYSTEM,
        prompt: buildSummaryPrompt(results),
      });
      const report: PubReport = {
        overall: round1(completed.reduce((sum, r) => sum + r.overall, 0) / completed.length),
        personaResults: results,
        summary,
        ranAt: new Date().toISOString(),
      };
      await writePubReport(brew.id, target.number, report);
      return {
        ...current,
        batches: upsertBatch(current.batches, { ...target, pub: report }),
        pubProgress: null,
      };
    } finally {
      await deps.stopServer(brew.id).catch(() => undefined);
    }
  } catch (err) {
    try {
      await deps.onProgress?.({ ...current, pubProgress: null });
    } catch {
      // 進捗クリアの失敗より元のエラーを優先する
    }
    throw err;
  }
}
```

- [ ] **Step 5: resolve.ts を実装**

`src/lib/pub/resolve.ts` を新規作成:

```ts
import { getConfiguredClient } from "@/lib/llm";
import { readSettings } from "@/lib/store";
import type { Settings } from "@/lib/store/types";
import { startServer, stopServer } from "@/lib/tap/server-manager";
import { createPlaywrightPubDriver } from "./driver";
import { createFakePubDriver } from "./fake-driver";
import type { PubDeps } from "./index";

function isFakeMode(settings: Settings): boolean {
  return settings.provider === "fake" || process.env.IDEA_BREWING_FAKE_BUILD === "1";
}

/** Pub 用 deps。フェイク構成ではサーバー起動・実ブラウザ・撮影をすべてスキップする */
export async function resolvePubDeps(): Promise<
  Pick<PubDeps, "client" | "startServer" | "stopServer" | "createDriver">
> {
  const settings = await readSettings();
  const client = await getConfiguredClient();
  if (isFakeMode(settings)) {
    return {
      client,
      startServer: async () => ({ port: 0 }),
      stopServer: async () => undefined,
      createDriver: async () => createFakePubDriver(),
    };
  }
  return { client, startServer, stopServer, createDriver: createPlaywrightPubDriver };
}
```

- [ ] **Step 6: テスト実行とコミット**

```powershell
npx vitest run tests/unit/pub.test.ts
npx tsc --noEmit
npm test
git add -A
git commit -m "feat: Pubオーケストレータと相互ロックを追加"
```

---

### Task 7: リーダーボード構築(leaderboard.ts)

**Files:**
- Create: `src/lib/pub/leaderboard.ts`
- Test: `tests/unit/pub-leaderboard.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/pub-leaderboard.test.ts` を新規作成:

```ts
import { describe, expect, it } from "vitest";
import { buildLeaderboard, latestPubBatch } from "@/lib/pub/leaderboard";
import type { BatchRecord, Brew, PubReport } from "@/lib/store/types";

function report(overall: number, ranAt: string): PubReport {
  return { overall, personaResults: [], summary: "総括", ranAt };
}

function batch(number: number, pub: PubReport | null, evaluationOverall?: number): BatchRecord {
  return {
    number,
    status: "succeeded",
    startedAt: "2026-07-12T00:00:00.000Z",
    finishedAt: "2026-07-12T00:00:00.000Z",
    error: null,
    evaluation:
      evaluationOverall === undefined
        ? null
        : {
            overall: evaluationOverall,
            axes: [],
            summary: "",
            improvements: ["x"],
            strategy: "repair",
            screenshotsUsed: false,
            evaluatedAt: "2026-07-12T00:00:00.000Z",
          },
    pub,
  };
}

function brew(id: string, name: string, batches: BatchRecord[]): Brew {
  return { id, name, batches } as unknown as Brew;
}

describe("latestPubBatch", () => {
  it("pub を持つ最大番号のバッチを返す(なければ null)", () => {
    const b = brew("a", "A", [
      batch(1, report(4.0, "2026-07-12T01:00:00.000Z")),
      batch(2, null),
    ]);
    expect(latestPubBatch(b)?.number).toBe(1);
    expect(latestPubBatch(brew("b", "B", [batch(1, null)]))).toBeNull();
  });
});

describe("buildLeaderboard", () => {
  it("pubOverall 降順・同点は ranAt 新しい順で並べ、未実施は除外する", () => {
    const entries = buildLeaderboard([
      brew("a", "A", [batch(1, report(3.5, "2026-07-10T00:00:00.000Z"))]),
      brew("b", "B", [batch(1, report(4.5, "2026-07-11T00:00:00.000Z"), 4.0)]),
      brew("c", "C", [batch(1, null)]),
      brew("d", "D", [batch(1, report(3.5, "2026-07-12T00:00:00.000Z"))]),
    ]);
    expect(entries.map((e) => e.brewId)).toEqual(["b", "d", "a"]);
    expect(entries[0].selfOverall).toBe(4.0);
    expect(entries[1].selfOverall).toBeNull();
  });

  it("各ブリューは pub を持つ最新バッチだけが載る", () => {
    const entries = buildLeaderboard([
      brew("a", "A", [
        batch(1, report(2.0, "2026-07-10T00:00:00.000Z")),
        batch(2, report(4.0, "2026-07-11T00:00:00.000Z")),
      ]),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].batch).toBe(2);
    expect(entries[0].pubOverall).toBe(4.0);
  });
});
```

- [ ] **Step 2: leaderboard.ts を実装**

`src/lib/pub/leaderboard.ts` を新規作成:

```ts
import { listBrews } from "@/lib/store";
import type { BatchRecord, Brew } from "@/lib/store/types";

export interface LeaderboardEntry {
  brewId: string;
  name: string;
  batch: number; // Pub レポートを持つ最新バッチ
  pubOverall: number;
  selfOverall: number | null; // 同バッチの自己評価(あれば)
  personaCount: number;
  ranAt: string;
}

/** pub を持つ最大番号のバッチ(タンクカード表示にも使う) */
export function latestPubBatch(brew: Brew): BatchRecord | null {
  let found: BatchRecord | null = null;
  for (const b of brew.batches) {
    if (b.pub !== null && (found === null || b.number > found.number)) found = b;
  }
  return found;
}

/** Pub スコア降順(同点は実施日時の新しい順)のランキングを作る純粋関数 */
export function buildLeaderboard(brews: Brew[]): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  for (const brew of brews) {
    const batch = latestPubBatch(brew);
    if (!batch?.pub) continue;
    entries.push({
      brewId: brew.id,
      name: brew.name,
      batch: batch.number,
      pubOverall: batch.pub.overall,
      selfOverall: batch.evaluation?.overall ?? null,
      personaCount: batch.pub.personaResults.length,
      ranAt: batch.pub.ranAt,
    });
  }
  return entries.sort((a, b) => b.pubOverall - a.pubOverall || b.ranAt.localeCompare(a.ranAt));
}

export async function collectLeaderboard(): Promise<LeaderboardEntry[]> {
  return buildLeaderboard(await listBrews());
}
```

- [ ] **Step 3: テスト実行とコミット**

```powershell
npx vitest run tests/unit/pub-leaderboard.test.ts
npm test
git add -A
git commit -m "feat: Pubリーダーボード構築を追加"
```

---

### Task 8: API ルート(pub 系 + personas + leaderboard)

**Files:**
- Create: `src/app/api/brews/[id]/pub/run/route.ts`
- Create: `src/app/api/brews/[id]/pub/cancel/route.ts`
- Create: `src/app/api/brews/[id]/pub/report/route.ts`
- Create: `src/app/api/brews/[id]/pub/screenshot/route.ts`
- Create: `src/app/api/pub/leaderboard/route.ts`
- Create: `src/app/api/personas/route.ts`
- Test: `tests/unit/api-pub-routes.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/api-pub-routes.test.ts` を新規作成:

```ts
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
  cursorApiKey: "",
  cursorModel: "composer-2.5",
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
    SHEET_KEYS.map((key) => [key, { content: `${key}の内容`, sufficiency: "full", userEdited: false }]),
  ) as unknown as BrewSheet;
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
    const res = await POST(
      post({ autoCount: 0, savedPersonaIds: [saved[0].id] }),
      ctx(brew.id),
    );
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
    expect(
      (await POST(post({ autoCount: 3, savedPersonaIds: [1] }), ctx(brew.id))).status,
    ).toBe(400); // 型違い

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

  it("Pub 実行中は熟成・ビルド系も 409(相互排他)", async () => {
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

    const bad = await GET(
      new Request("http://test/?batch=1&name=../brew.json"),
      ctx(brew.id),
    );
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

  it("leaderboard は Pub 済みブリューを降順で返す", async () => {
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
```

- [ ] **Step 2: run ルートを実装**

`src/app/api/brews/[id]/pub/run/route.ts` を新規作成:

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStaleMaturation } from "@/lib/mature";
import { isBrewBusy } from "@/lib/mature/mature-state";
import { normalizeStalePub, runPub } from "@/lib/pub";
import { pubbingBrews, pubCancelTokens } from "@/lib/pub/pub-state";
import { resolvePubDeps } from "@/lib/pub/resolve";
import { readBrew, readPersonas, writeBrew } from "@/lib/store";
import type { Brew, SavedPersona } from "@/lib/store/types";
import { normalizeStaleBatch } from "@/lib/tap";
import { latestSucceededBatch } from "@/lib/tap/batches";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isBrewBusy(id)) {
    return NextResponse.json({ error: "実行中の工程があります。" }, { status: 409 });
  }
  pubbingBrews.add(id);
  const token = { cancelled: false };
  pubCancelTokens.set(id, token);

  try {
    let brew: Brew;
    try {
      brew = await readBrew(id);
    } catch {
      return NextResponse.json({ error: "ブリューが見つかりません。" }, { status: 404 });
    }
    brew = normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew)));

    const body = (await req.json().catch(() => ({}))) as {
      autoCount?: unknown;
      savedPersonaIds?: unknown;
    };
    const autoCount = body.autoCount === undefined ? 3 : body.autoCount;
    const savedPersonaIds = body.savedPersonaIds === undefined ? [] : body.savedPersonaIds;
    if (
      typeof autoCount !== "number" ||
      !Number.isInteger(autoCount) ||
      autoCount < 0 ||
      autoCount > 5
    ) {
      return NextResponse.json(
        { error: "autoCount は0〜5の整数で指定してください。" },
        { status: 400 },
      );
    }
    if (!Array.isArray(savedPersonaIds) || savedPersonaIds.some((x) => typeof x !== "string")) {
      return NextResponse.json(
        { error: "savedPersonaIds は文字列の配列で指定してください。" },
        { status: 400 },
      );
    }
    const all = await readPersonas();
    const savedPersonas: SavedPersona[] = [];
    for (const pid of savedPersonaIds) {
      const found = all.find((p) => p.id === pid);
      if (!found) {
        return NextResponse.json({ error: "存在しない常連客が指定されています。" }, { status: 400 });
      }
      savedPersonas.push(found);
    }
    const total = autoCount + savedPersonas.length;
    if (total < 1 || total > 5) {
      return NextResponse.json({ error: "客の人数は合計1〜5にしてください。" }, { status: 400 });
    }
    if (!latestSucceededBatch(brew)) {
      return NextResponse.json({ error: "成功したバッチがありません。" }, { status: 400 });
    }
    if (autoCount > 0 && !brew.sheet) {
      return NextResponse.json(
        { error: "ブリューシートがありません。ペルソナの自動生成には仕込みが必要です。" },
        { status: 400 },
      );
    }

    const deps = await resolvePubDeps();
    const done = await runPub(
      brew,
      {
        ...deps,
        cancel: token,
        onProgress: async (b) => {
          await writeBrew(b); // 進捗をポーリングで見えるように都度保存する
        },
      },
      { autoCount, savedPersonas },
    );
    return NextResponse.json(await writeBrew(done));
  } catch (err) {
    return errorResponse(err);
  } finally {
    pubbingBrews.delete(id);
    pubCancelTokens.delete(id);
  }
}
```

- [ ] **Step 3: cancel ルートを実装**

`src/app/api/brews/[id]/pub/cancel/route.ts`(mature/cancel と同型):

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { normalizeStalePub } from "@/lib/pub";
import { pubCancelTokens } from "@/lib/pub/pub-state";
import { readBrew, writeBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = pubCancelTokens.get(id);
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

    // クラッシュで pubProgress が残留した場合の復旧経路。
    const normalized = normalizeStalePub(brew);
    if (normalized !== brew) {
      return NextResponse.json(await writeBrew(normalized));
    }

    return NextResponse.json({ error: "Pubは実行されていません。" }, { status: 409 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: report / screenshot ルートを実装**

`src/app/api/brews/[id]/pub/report/route.ts`:

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { pubDir } from "@/lib/pub";
import { readBrew } from "@/lib/store";
import type { Brew } from "@/lib/store/types";

const SCREENSHOT_NAMES = ["persona-1.png", "persona-2.png", "persona-3.png", "persona-4.png", "persona-5.png"];

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
      .readFile(path.join(pubDir(id, batch), "report.md"), "utf8")
      .catch(() => null);
    const screenshots: string[] = [];
    for (const name of SCREENSHOT_NAMES) {
      try {
        await fs.access(path.join(pubDir(id, batch), name));
        screenshots.push(name);
      } catch {
        // 存在しないスクリーンショットは一覧に含めない
      }
    }
    return NextResponse.json({ markdown, report: record.pub, screenshots });
  } catch (err) {
    return errorResponse(err);
  }
}
```

`src/app/api/brews/[id]/pub/screenshot/route.ts`(mature/screenshot と同型。ホワイトリストは `persona-[1-5].png`):

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { pubDir } from "@/lib/pub";
import { readBrew } from "@/lib/store";

const NAME_PATTERN = /^persona-[1-5]\.png$/;

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
    if (!NAME_PATTERN.test(name)) {
      return NextResponse.json({ error: "不正なファイル名です。" }, { status: 400 });
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(path.join(pubDir(id, batch), name));
    } catch {
      return NextResponse.json({ error: "スクリーンショットが見つかりません。" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(buffer), {
      // 再実行でスクリーンショットが上書きされるためキャッシュさせない
      headers: { "content-type": "image/png", "cache-control": "no-store" },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: leaderboard / personas ルートを実装**

`src/app/api/pub/leaderboard/route.ts`:

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { collectLeaderboard } from "@/lib/pub/leaderboard";

export async function GET() {
  try {
    return NextResponse.json({ entries: await collectLeaderboard() });
  } catch (err) {
    return errorResponse(err);
  }
}
```

`src/app/api/personas/route.ts`(settings ルートと同型 + バリデーション 400):

```ts
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { PersonaValidationError, readPersonas, writePersonas } from "@/lib/store";
import type { SavedPersona } from "@/lib/store/types";

export async function GET() {
  return NextResponse.json(await readPersonas());
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "常連客は配列で指定してください。" }, { status: 400 });
    }
    return NextResponse.json(await writePersonas(body as SavedPersona[]));
  } catch (err) {
    if (err instanceof PersonaValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: テスト実行とコミット**

```powershell
npx vitest run tests/unit/api-pub-routes.test.ts
npx tsc --noEmit
npm test
git add -A
git commit -m "feat: Pub APIルート(run/cancel/report/screenshot/leaderboard/personas)を追加"
```

---

### Task 9: Pub タブ UI(PubPanel)

**Files:**
- Create: `src/components/pub-panel.tsx`

UI はフェイク構成の手動スモークと E2E(Task 11)で検証する(コンポーネント単体テストは既存方針どおり作らない)。文言・スタイルは `mature-panel.tsx` の作法(amber 系 Tailwind、`aria-live`、1 秒ポーリング、`inFlightRef` ガード)に合わせる。

- [ ] **Step 1: PubPanel を作成**

`src/components/pub-panel.tsx` を新規作成:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Brew, PubPhase, SavedPersona } from "@/lib/store/types";
import { latestSucceededBatch } from "@/lib/tap/batches";

const PHASE_LABELS: Record<PubPhase, string> = {
  opening: "開店準備",
  serving: "接客中",
  closing: "閉店作業",
};

type ReportResponse = {
  markdown: string | null;
  report: NonNullable<Brew["batches"][number]["pub"]>;
  screenshots: string[];
};

type ErrorBody = { error?: string };

export function PubPanel({
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
  const [autoCount, setAutoCount] = useState("3");
  const [personas, setPersonas] = useState<SavedPersona[]>([]);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [newProfile, setNewProfile] = useState("");
  const [newGoals, setNewGoals] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [screenshots, setScreenshots] = useState<{ batch: number; names: string[] } | null>(null);

  const inFlightRef = useRef(false);

  const latest = latestSucceededBatch(brew);
  const running = brew.pubProgress !== null;
  const working = busy || running;
  const pubBatches = brew.batches.filter((b) => b.pub !== null).sort((a, b) => a.number - b.number);
  const auto = Number(autoCount);
  const total = (Number.isInteger(auto) ? auto : NaN) + checkedIds.length;
  const totalValid = Number.isInteger(auto) && auto >= 0 && auto <= 5 && total >= 1 && total <= 5;

  const loadPersonas = useCallback(async () => {
    try {
      const res = await fetch("/api/personas");
      if (res.ok) setPersonas((await res.json()) as SavedPersona[]);
    } catch {
      // 表示用の取得失敗は無視する
    }
  }, []);

  useEffect(() => {
    void loadPersonas();
  }, [loadPersonas]);

  // 初期表示: Pub 済みの最新バッチを選択する
  useEffect(() => {
    if (selected !== null || pubBatches.length === 0) return;
    setSelected(pubBatches[pubBatches.length - 1].number);
  }, [selected, pubBatches]);

  // 選択バッチのスクリーンショット一覧を取得する
  useEffect(() => {
    if (selected === null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/brews/${brew.id}/pub/report?batch=${selected}`);
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as ReportResponse;
        setScreenshots({ batch: selected, names: json.screenshots });
      } catch {
        // 表示用の取得失敗は無視する
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, brew.id, brew.updatedAt]);

  // リモートで Pub が進行中でもポーリングして追従する
  useEffect(() => {
    if (!running || busy) return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [running, busy, refresh]);

  async function savePersonas(next: SavedPersona[]) {
    setError(null);
    try {
      const res = await fetch("/api/personas", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      const json = (await res.json()) as SavedPersona[] | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      setPersonas(json as SavedPersona[]);
      setCheckedIds((ids) => ids.filter((id) => (json as SavedPersona[]).some((p) => p.id === id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function addPersona() {
    const goals = newGoals
      .split("\n")
      .map((g) => g.trim())
      .filter((g) => g !== "");
    void savePersonas([...personas, { id: "", name: newName, profile: newProfile, goals }]).then(
      () => {
        setNewName("");
        setNewProfile("");
        setNewGoals("");
      },
    );
  }

  async function openPub() {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    const timer = setInterval(() => void refresh(), 1000);
    let updatedBrew: Brew | null = null;
    try {
      const res = await fetch(`/api/brews/${brew.id}/pub/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoCount: auto, savedPersonaIds: checkedIds }),
      });
      clearInterval(timer);
      const json = (await res.json()) as Brew | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      updatedBrew = json as Brew;
      onUpdate(updatedBrew);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
      try {
        await refresh();
      } catch {
        // refreshが失敗してもbusy解除は必ず行う(タブが永久ロックされるのを防ぐ)
      }
      if (updatedBrew) {
        const latestPub = [...updatedBrew.batches].reverse().find((b) => b.pub !== null);
        if (latestPub) setSelected(latestPub.number);
      }
      inFlightRef.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function cancelPub() {
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brew.id}/pub/cancel`, { method: "POST" });
      const json = (await res.json()) as Brew | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      if ("schemaVersion" in json) onUpdate(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      try {
        await refresh();
      } catch {
        // キャンセル後の再同期失敗は無視する
      }
    }
  }

  const report = selected !== null ? brew.batches.find((b) => b.number === selected)?.pub : null;

  return (
    <section>
      <h2 className="text-lg font-bold text-amber-100">Pub(AIユーザーテスト)</h2>

      {brew.pubProgress && (
        <p className="mt-2 text-amber-200" aria-live="polite">
          {PHASE_LABELS[brew.pubProgress.phase]}(バッチ{brew.pubProgress.batch}):{" "}
          {brew.pubProgress.detail}
        </p>
      )}

      {/* 開店フォーム */}
      {!working && latest && (
        <div className="mt-4 rounded-lg border border-amber-900/60 bg-black/20 p-4">
          <p className="text-sm text-amber-300">対象: バッチ{latest.number}(最新の成功バッチ)</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-amber-200">
              自動生成の人数
              <input
                value={autoCount}
                onChange={(e) => setAutoCount(e.target.value)}
                className="mt-1 block w-24 rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
              />
            </label>
            <button
              onClick={() => void openPub()}
              disabled={!totalValid}
              className="rounded bg-amber-600 px-4 py-2 font-bold text-black hover:bg-amber-500 disabled:opacity-30"
            >
              開店する
            </button>
            <p className="text-sm text-amber-200/60">合計 {Number.isNaN(total) ? "-" : total} 人(1〜5)</p>
          </div>
          {personas.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-amber-200">参加する常連客</p>
              <div className="mt-1 flex flex-wrap gap-3">
                {personas.map((p) => (
                  <label key={p.id} className="flex items-center gap-1 text-sm text-amber-100">
                    <input
                      type="checkbox"
                      checked={checkedIds.includes(p.id)}
                      onChange={(e) =>
                        setCheckedIds((ids) =>
                          e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id),
                        )
                      }
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 常連客の管理 */}
      {!working && (
        <details className="mt-4 rounded-lg border border-amber-900/60 bg-black/20 p-4">
          <summary className="cursor-pointer font-bold text-amber-200">常連客の管理</summary>
          {personas.length > 0 && (
            <ul className="mt-3 space-y-2">
              {personas.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-amber-100">
                    <span className="font-bold">{p.name}</span> — {p.profile}
                    <span className="block text-amber-200/60">目的: {p.goals.join(" / ")}</span>
                  </span>
                  <button
                    onClick={() => void savePersonas(personas.filter((x) => x.id !== p.id))}
                    className="shrink-0 rounded border border-amber-700 px-2 py-1 text-amber-200 hover:border-amber-500"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-sm text-amber-200">
              名前
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 block w-full rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
              />
            </label>
            <label className="text-sm text-amber-200">
              プロフィール
              <input
                value={newProfile}
                onChange={(e) => setNewProfile(e.target.value)}
                className="mt-1 block w-full rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
              />
            </label>
            <label className="text-sm text-amber-200 sm:col-span-2">
              目的(1行に1件)
              <textarea
                value={newGoals}
                onChange={(e) => setNewGoals(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded border border-amber-900/60 bg-black/40 px-2 py-1 text-amber-100"
              />
            </label>
          </div>
          <button
            onClick={addPersona}
            className="mt-2 rounded border border-amber-700 px-4 py-2 font-bold text-amber-200 hover:border-amber-500"
          >
            常連客を追加
          </button>
        </details>
      )}

      {working && (
        <button
          onClick={() => void cancelPub()}
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

      {/* バッチ選択(Pub 済みが複数あるとき) */}
      {pubBatches.length > 1 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {pubBatches.map((b) => (
            <button
              key={b.number}
              onClick={() => setSelected(b.number)}
              className={`rounded border px-3 py-1 text-sm ${
                selected === b.number
                  ? "border-amber-400 bg-amber-900/40 text-amber-100"
                  : "border-amber-900/60 text-amber-200 hover:border-amber-600"
              }`}
            >
              バッチ{b.number}
            </button>
          ))}
        </div>
      )}

      {/* Pub レポート */}
      {report && selected !== null && (
        <div className="mt-6">
          <h3 className="font-bold text-amber-100">
            バッチ{selected} Pubレポート — {report.overall.toFixed(1)} / 5.0(客
            {report.personaResults.length}人)
          </h3>
          <p className="mt-2 whitespace-pre-wrap text-amber-200">{report.summary}</p>

          <div className="mt-4 space-y-4">
            {report.personaResults.map((r, i) => (
              <div key={i} className="rounded-lg border border-amber-900/40 bg-black/20 p-4">
                <p className="font-bold text-amber-100">
                  {r.persona.name}
                  {r.persona.origin === "saved" && (
                    <span className="ml-2 rounded bg-amber-800 px-2 py-0.5 text-xs text-amber-100">
                      常連
                    </span>
                  )}
                  {r.status === "aborted" && (
                    <span className="ml-2 rounded bg-red-900 px-2 py-0.5 text-xs text-red-200">
                      中断
                    </span>
                  )}
                </p>
                <p className="text-sm text-amber-200/70">{r.persona.profile}</p>
                {r.status === "completed" ? (
                  <>
                    <p className="mt-2 text-amber-200">
                      {r.overall.toFixed(1)} / 5.0
                      <span className="ml-3 text-sm text-amber-300">
                        {r.scores.map((s) => `${s.name} ${s.score}`).join(" / ")}
                      </span>
                    </p>
                    <p className="mt-1 text-amber-100">「{r.comment}」</p>
                    <ul className="mt-2 space-y-1 text-sm text-amber-200">
                      {r.taskResults.map((t, j) => (
                        <li key={j}>
                          {t.achieved ? "○" : "✕"} {t.goal} — {t.note}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-red-300">{r.comment}</p>
                )}
                {screenshots?.batch === selected &&
                  screenshots.names.includes(`persona-${i + 1}.png`) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/brews/${brew.id}/pub/screenshot?batch=${selected}&name=persona-${i + 1}.png`}
                      alt={`${r.persona.name} の最終画面`}
                      className="mt-3 max-h-48 rounded border border-amber-900/60"
                    />
                  )}
                {r.steps.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-amber-300">
                      行動ログ({r.steps.length}件)
                    </summary>
                    <ol className="mt-2 space-y-1 text-sm text-amber-200/80">
                      {r.steps.map((s) => (
                        <li key={s.step}>
                          {s.step}. {s.action} → {s.observation}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: lint と型チェック**

```powershell
npm run lint
npx tsc --noEmit
```

- [ ] **Step 3: コミット**

```powershell
git add -A
git commit -m "feat: PubタブUI(開店フォーム・常連客管理・レポート表示)を追加"
```

---

### Task 10: ワークベンチ・タンクカード・リーダーボードページ

**Files:**
- Modify: `src/components/brew-workbench.tsx`
- Modify: `src/components/tank-card.tsx`
- Create: `src/app/leaderboard/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: ワークベンチに Pub タブを追加**

`src/components/brew-workbench.tsx`:

1. `import { PubPanel } from "./pub-panel";` を追加
2. `TABS` の末尾(熟成の後)に `{ id: "pub", label: "Pub" }` を追加
3. 初期タブ判定の先頭に `pubProgress` を追加:

```ts
  const [tab, setTab] = useState<TabId>(
    initial.pubProgress !== null
      ? "pub"
      : initial.maturationProgress !== null
        ? "mature"
        : initial.buildProgress !== null
          ? "tap"
          : initial.sheet
            ? "sheet"
            : "ingredients",
  );
```

4. `enabled` に `pub: brew.batches.some((b) => b.status === "succeeded"),` を追加
5. `tabsBusy` と `visibleTab` を拡張:

```ts
  const tabsBusy =
    busy ||
    brew.buildProgress !== null ||
    brew.maturationProgress !== null ||
    brew.pubProgress !== null;
  const visibleTab: TabId =
    brew.pubProgress !== null
      ? "pub"
      : brew.maturationProgress !== null
        ? "mature"
        : brew.buildProgress !== null
          ? "tap"
          : tab;
```

6. パネル描画に追加:

```tsx
        {visibleTab === "pub" && (
          <PubPanel
            brew={brew}
            onUpdate={setBrew}
            refresh={refresh}
            onBusyChange={setBusy}
          />
        )}
```

- [ ] **Step 2: タンクカードに Pub スコアを表示**

`src/components/tank-card.tsx` — `stageLabel` を拡張(`latestPubBatch` は `@/lib/pub/leaderboard` から import):

```ts
import { latestPubBatch } from "@/lib/pub/leaderboard";

function stageLabel(brew: Brew): string {
  if (brew.stage !== "built") return STAGE_INFO[brew.stage].label;
  const latest = latestSucceededBatch(brew);
  if (!latest) return STAGE_INFO.built.label;
  const pub = latestPubBatch(brew)?.pub;
  const pubSuffix = pub ? `・Pub ${pub.overall.toFixed(1)}` : "";
  return latest.evaluation
    ? `提供中(バッチ${latest.number}・スコア${latest.evaluation.overall.toFixed(1)}${pubSuffix})`
    : `提供中(バッチ${latest.number}${pubSuffix})`;
}
```

- [ ] **Step 3: リーダーボードページを作成**

`src/app/leaderboard/page.tsx` を新規作成(トップページと同じサーバーコンポーネント方式):

```tsx
import Link from "next/link";
import { buildLeaderboard } from "@/lib/pub/leaderboard";
import { listBrews } from "@/lib/store";

export const dynamic = "force-dynamic";

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function Leaderboard() {
  const brews = await listBrews();
  const entries = buildLeaderboard(brews);
  const unpubbed = brews.length - entries.length;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-amber-100">リーダーボード</h1>
        <Link href="/" className="text-amber-300 hover:text-amber-200">
          ← 醸造タンクへ戻る
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="text-amber-400">
          まだ開店したブリューがありません。ワークベンチの「Pub」タブから開店してください。
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-amber-900/60">
          <table className="w-full text-left text-amber-100">
            <thead className="bg-black/40 text-sm text-amber-300">
              <tr>
                <th className="px-4 py-2">順位</th>
                <th className="px-4 py-2">ブリュー</th>
                <th className="px-4 py-2">バッチ</th>
                <th className="px-4 py-2">Pubスコア</th>
                <th className="px-4 py-2">自己評価</th>
                <th className="px-4 py-2">客数</th>
                <th className="px-4 py-2">実施日時</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.brewId} className="border-t border-amber-900/40 hover:bg-amber-900/20">
                  <td className="px-4 py-2">
                    {MEDALS[i] ?? ""} {i + 1}
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/brews/${e.brewId}`} className="font-bold hover:text-amber-300">
                      {e.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{e.batch}</td>
                  <td className="px-4 py-2 font-bold text-amber-200">{e.pubOverall.toFixed(1)}</td>
                  <td className="px-4 py-2">{e.selfOverall !== null ? e.selfOverall.toFixed(1) : "—"}</td>
                  <td className="px-4 py-2">{e.personaCount}</td>
                  <td className="px-4 py-2 text-sm text-amber-200/70">
                    {new Date(e.ranAt).toLocaleString("ja-JP")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {unpubbed > 0 && (
        <p className="mt-4 text-sm text-amber-200/60">未開店のブリュー: {unpubbed}件</p>
      )}
    </main>
  );
}
```

- [ ] **Step 4: トップページにリンクを追加**

`src/app/page.tsx` — ヘッダーの「新しい仕込み」の左にリンクを追加:

```tsx
        <div className="flex items-center gap-4">
          <Link href="/leaderboard" className="text-amber-300 hover:text-amber-200">
            リーダーボード
          </Link>
          <Link
            href="/brews/new"
            className="rounded-lg bg-amber-600 px-4 py-2 font-bold text-stone-950 hover:bg-amber-500"
          >
            新しい仕込み
          </Link>
        </div>
```

- [ ] **Step 5: lint・型チェック・ビルド確認**

```powershell
npm run lint
npx tsc --noEmit
npm run build   # EPERM なら .next を削除して再実行
```

- [ ] **Step 6: 手動スモーク(フェイク構成)**

```powershell
$env:IDEA_BREWING_FAKE_BUILD = "1"
npm run dev
```

ブラウザで確認: ビルド済みブリュー → Pub タブ → 常連客を 1 人登録 → チェック + 自動生成 1 人で「開店する」→ レポート(スコア・常連バッジ・行動ログ)→ トップの「リーダーボード」リンク → 順位表示 → タンクカードに「Pub X.X」。確認後:

```powershell
Remove-Item Env:IDEA_BREWING_FAKE_BUILD
```

- [ ] **Step 7: コミット**

```powershell
git add -A
git commit -m "feat: リーダーボードページとPubタブのワークベンチ統合"
```

---

### Task 11: E2E ハッピーパスの拡張

**Files:**
- Modify: `tests/e2e/happy-path.spec.ts`

- [ ] **Step 1: Pub ステップを追加**

`tests/e2e/happy-path.spec.ts` — ステップ 11(バッチ2 を注いで止める)の後に追加:

```ts
    // 12. Pub: 常連客を登録して開店(フェイクLLM+フェイクドライバ)
    await page.getByRole("button", { name: "Pub", exact: true }).click();
    await page.getByText("常連客の管理").click();
    await page.getByLabel("名前").fill("テスト常連");
    await page.getByLabel("プロフィール").fill("毎日来る");
    await page.getByLabel("目的(1行に1件)").fill("トップページを見る");
    await page.getByRole("button", { name: "常連客を追加", exact: true }).click();
    const regularCheckbox = page.getByRole("checkbox", { name: "テスト常連" });
    await expect(regularCheckbox).toBeVisible({ timeout: 30_000 });
    await regularCheckbox.check();
    await page.getByLabel("自動生成の人数").fill("1");
    await page.getByRole("button", { name: "開店する", exact: true }).click();

    // 常連(1人目=高評価4.5) + 自動生成(2人目=3.3) → 総合 3.9
    await expect(page.getByText(/3\.9 \/ 5\.0/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("常連", { exact: true })).toBeVisible();
    expect(
      existsSync(path.join(brewsDir, brewId, "taps", "batch-2", "pub", "report.md")),
    ).toBe(true);

    // 13. リーダーボードに載る
    await page.goto("/leaderboard");
    await expect(page.getByRole("link", { name: "最高のtodoアプリ" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("3.9", { exact: true })).toBeVisible();
```

`finally` 節に Pub のクリーンアップも追加:

```ts
      await page.request.post(`/api/brews/${brewId}/pub/cancel`).catch(() => undefined);
```

注意:
- Pub の対象はステップ 10 で作られた batch-2(最新成功バッチ)
- フェイク経路では常連が 1 人目に接客されるため `pub-feedback` の 1 回目(4.5)が常連、2 回目(3.3)が自動生成になり、総合は (4.5 + 3.3) / 2 = 3.9 で決定論的
- セレクタが UI 実装(Task 9)の label / button 文言と一致していることを確認しながら書くこと

- [ ] **Step 2: E2E 実行**

```powershell
npm run e2e   # 実行中の npm run dev があると失敗する(止めてから)
```

- [ ] **Step 3: コミット**

```powershell
git add -A
git commit -m "test: E2EハッピーパスをPub(開店→レポート→リーダーボード)まで延長"
```

---

### Task 12: README 更新と最終検証

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README に Pub セクションを追加**

「熟成(自己評価バッチループ)」セクションの後に追加:

```markdown
## Pub(AIユーザーテスト)

ビルド成功済みのブリューは、ワークベンチの「Pub」タブから AI 客に試してもらえます。

1. **開店する** — ブリューシートから自動生成した AI 客(0〜5人)と、保存済みの常連客を組み合わせて開店します(合計 1〜5 人)。各客は Playwright で実際にアプリを操作し、目的を達成できたか試します
2. **Pub レポート** — 客ごとに固定 4 軸(目的達成 / 使いやすさ / 見た目・第一印象 / また来たいか)の採点・一言レビュー・行動ログ・最終画面が記録されます(`taps/batch-N/pub/report.md`)
3. **常連客の管理** — 名前・プロフィール・目的を書いて保存すると、次回以降の開店に参加させられます(`data/personas.json`)
4. **リーダーボード** — トップページの「リーダーボード」から、全ブリューを Pub スコア順で比較できます

補足:

- 操作はテキストベース(ページ構造の要約)で行うため、vision 非対応モデルでも動作します
- 実ブラウザでの操作には `npx playwright install chromium` が必要です
- フェイク構成(`IDEA_BREWING_FAKE_BUILD=1` またはプロバイダ `fake`)ではブラウザを起動せず決定論的に完走します
- Pub 実行中はビルド・熟成・サーバー操作と相互排他になります(409)
```

- [ ] **Step 2: ロードマップを更新**

README の「ロードマップ」を実態に合わせる(Phase 2〜4 を完了扱いに):

```markdown
## ロードマップ

- ~~Phase 2: レシピを Cursor CLI/SDK に渡してコード生成(タップ)~~ 完了
- ~~Phase 3: 自己評価→自己改善のバッチループ(熟成)~~ 完了
- ~~Phase 4: AIユーザーテスト環境「Pub」とリーダーボード~~ 完了
- Phase 5 以降(候補): Pub フィードバックの熟成への自動連携、バッチ間比較 UI、レシピ自動改訂、工程別モデル使い分け
```

- [ ] **Step 3: 最終検証(全部)**

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build   # EPERM なら .next を削除して再実行
npm run e2e
```

- [ ] **Step 4: コミット**

```powershell
git add -A
git commit -m "docs: READMEにPub(AIユーザーテスト)とリーダーボードを追記"
```

---

## セルフレビュー結果(計画作成時に確認済み)

- **設計書との整合**: データモデル(§2)・モジュール構成(§3)・オーケストレータ(§4)・API(§5)・UI(§6)・フェイク(§7)・エラー処理(§8)・テスト(§9)の全項目をタスクに割り付けた
- **相互排他**: `isBrewBusy` の 1 箇所変更で既存の tap / mature / recipe / server ルートに波及することを `mature-state.ts` の現実装で確認済み。逆方向(Pub 中の他工程 409)もテストに含めた
- **フェイクの決定論**: `pub-feedback` は呼び出し順で 4.5 → 3.3 を返すため、E2E の総合スコア 3.9 は安定。常連が自動生成より先に接客される順序も `runPub` の実装で保証
- **循環 import**: `pub-state.ts` は型 import のみ(実行時依存なし)なので `mature-state.ts` → `pub-state.ts` は安全
- **後方互換**: 旧 brew.json は `readBrew` バックフィルで `pub` / `pubProgress` が補完される(Task 1 でテスト)
- **既知の注意点**: `ariaSnapshot()` は Playwright 1.49+(本リポジトリ 1.61)。万一実行時に使えない場合も `innerText` フォールバックで続行する




