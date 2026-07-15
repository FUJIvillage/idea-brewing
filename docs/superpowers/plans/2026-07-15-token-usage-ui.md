# Token Usage UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ブリュー詳細ヘッダーに工程別トークン(入力/出力/合計)と全体合計を累積表示する。

**Architecture:** `LlmClient` が usage を返し、各パイプラインが `addTokenUsage` で `brew.tokenUsage` に累積。Cursor/Pencil は取れた場合のみ加算。UI は `TokenUsageBar` を `BrewWorkbench` に配置。

**Tech Stack:** Next.js、Vitest、AI SDK (`ai`)、既存 PS1 UI

## Global Constraints

- 日本語 UI 文言
- 既存 PS1 スタイルに合わせる(新規カードデザインは作らない)
- README のユーザー向け事実を変えたら同じ作業で更新
- schemaVersion は 1 のまま(フィールド追加は `readBrew` で補完)

## File Structure

| File | Role |
|---|---|
| `src/lib/store/types.ts` | `TokenCounts` / `BrewTokenUsage` / `Brew.tokenUsage` |
| `src/lib/llm/usage.ts` | 正規化・tag→stage・`addTokenUsage`・合計 |
| `src/lib/llm/client.ts` | 戻り値を `LlmResult<T>` に変更 |
| `src/lib/llm/ai-sdk-client.ts` | usage 抽出 |
| `src/lib/llm/fake-client.ts` | 固定 usage |
| 各パイプライン | 累積を brew に反映 |
| `src/components/token-usage-bar.tsx` | ヘッダー UI |
| `src/components/brew-workbench.tsx` | 埋め込み |
| `README.md` | 追記 |
| `tests/unit/token-usage.test.ts` ほか | 単体 |

---

### Task 1: Usage helpers + types

**Files:**
- Create: `src/lib/llm/usage.ts`
- Modify: `src/lib/store/types.ts`
- Modify: `src/lib/store/index.ts` (`createBrew` / `readBrew`)
- Test: `tests/unit/token-usage.test.ts`

- [ ] **Step 1: Write failing tests for helpers**

```ts
import { describe, expect, it } from "vitest";
import {
  addTokenUsage,
  normalizeUsage,
  stageForTag,
  sumTokenUsage,
  USAGE_STAGE_KEYS,
} from "@/lib/llm/usage";
import type { Brew } from "@/lib/store/types";

describe("stageForTag", () => {
  it("maps tags to stages and ignores connection-test", () => {
    expect(stageForTag("mash")).toBe("mash");
    expect(stageForTag("boil-next")).toBe("boil");
    expect(stageForTag("boil-apply")).toBe("boil");
    expect(stageForTag("recipe")).toBe("recipe");
    expect(stageForTag("evaluate")).toBe("evaluate");
    expect(stageForTag("pub-action")).toBe("pub");
    expect(stageForTag("connection-test")).toBeNull();
  });
});

describe("normalizeUsage", () => {
  it("reads inputTokens/outputTokens", () => {
    expect(normalizeUsage({ inputTokens: 10, outputTokens: 5 })).toEqual({
      input: 10,
      output: 5,
      total: 15,
    });
  });
  it("falls back to prompt/completion aliases", () => {
    expect(normalizeUsage({ promptTokens: 3, completionTokens: 7 })).toEqual({
      input: 3,
      output: 7,
      total: 10,
    });
  });
  it("treats missing as 0", () => {
    expect(normalizeUsage(undefined)).toEqual({ input: 0, output: 0, total: 0 });
  });
});

describe("addTokenUsage / sumTokenUsage", () => {
  const empty = { tokenUsage: null } as Brew;
  it("accumulates per stage", () => {
    const once = addTokenUsage(empty, "mash", { input: 1, output: 2, total: 3 });
    const twice = addTokenUsage(once, "mash", { input: 4, output: 5, total: 9 });
    expect(twice.tokenUsage?.byStage.mash).toEqual({ input: 5, output: 7, total: 12 });
    const withBoil = addTokenUsage(twice, "boil", { input: 1, output: 1, total: 2 });
    expect(sumTokenUsage(withBoil.tokenUsage)).toEqual({ input: 6, output: 8, total: 14 });
  });
});
```

- [ ] **Step 2: Implement types + usage.ts + store defaults**

- [ ] **Step 3: Run `npx vitest run tests/unit/token-usage.test.ts` — PASS**

- [ ] **Step 4: Commit** `feat: add brew token usage types and helpers`

---

### Task 2: LlmClient returns usage

**Files:**
- Modify: `src/lib/llm/client.ts`, `ai-sdk-client.ts`, `fake-client.ts`
- Update all call sites that use generateObject/generateText
- Test: extend `tests/unit/fake-client.test.ts` / token-usage

- [ ] **Step 1: Change interface to**

```ts
export interface LlmResult<T> {
  value: T;
  usage: TokenCounts;
}
// generateObject -> Promise<LlmResult<T>>
// generateText -> Promise<LlmResult<string>>
```

- [ ] **Step 2: Fake returns fixed usage; AI SDK extracts `result.usage`**

- [ ] **Step 3: Update all call sites to use `.value` and `addTokenUsage` where brew is returned**

Pipelines to update:
- `brew-sheet/index.ts` (mash)
- `boil/index.ts`
- `recipe/index.ts`
- `mature/evaluate.ts`
- `pub/personas.ts`, `pub/session.ts`, `pub/index.ts`
- `app/api/settings/test/route.ts` (usage discard OK)

- [ ] **Step 4: Run related unit tests — PASS**

- [ ] **Step 5: Commit** `feat: plumb LLM token usage into brew stages`

---

### Task 3: Optional tap/design capture

**Files:**
- Modify tap/design paths only if usage is available without invasive refactors
- If Cursor/Pencil にトークンが無い: skip and leave UI 「—」(spec 通り)

- [ ] Inspect Cursor run result / Pencil usage.json for token fields
- [ ] If present, accumulate into `tap` / `design`
- [ ] Commit if any: `feat: record tap/design tokens when available`

---

### Task 4: TokenUsageBar UI + README

**Files:**
- Create: `src/components/token-usage-bar.tsx`
- Modify: `src/components/brew-workbench.tsx`
- Modify: `README.md`
- Test: `tests/unit/token-usage-bar.test.ts` (render logic helper or pure format function)

- [ ] Pure `formatTokenRow` / labels export for testability
- [ ] Embed bar between title and tabs
- [ ] README: brew.json に tokenUsage、ヘッダー表示の旨
- [ ] `npm run test` + `npm run lint`
- [ ] Commit `feat: show per-stage token usage in brew header`

---

## Spec coverage

- Header placement → Task 4
- input/output/total → Tasks 1–2, 4
- LLM + optional Cursor/Pencil → Tasks 2–3
- Cumulative → Task 1 `addTokenUsage`
- brew.json persist → Task 1 store + Task 2 pipelines
- README → Task 4
