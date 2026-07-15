# Design Live Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** デザインモック生成中に、約12秒間隔の途中プレビュー画像を UI に表示する。

**Architecture:** 生成本体の Pencil と並列で、隔離 HOME 上の export-only プロセスが `mock.pen` → `preview.png` を書き出す。UI は `GET /design/preview` をポーリングし、有効フレームまではプレースホルダ。

**Tech Stack:** Next.js App Router, `@pencil.dev/cli` export-only, Vitest, 既存 DesignPanel / useBrewAction

---

### Task 1: プレビュー定数・export ヘルパ・有効判定

**Files:**
- Modify: `src/lib/design/pencil-cli.ts`
- Modify: `src/lib/design/index.ts`（定数 export）
- Test: `tests/unit/design-preview.test.ts`

- [ ] **Step 1: 失敗するテストを書く**（`buildPreviewExportArgs` / `isValidPreviewPng`）
- [ ] **Step 2: 実装してテスト緑**
- [ ] **Step 3: コミット**

### Task 2: プレビューループを generateDesignMock に接続

**Files:**
- Modify: `src/lib/design/index.ts`
- Modify: `src/lib/design/pencil-cli.ts`（`exportPencilPreview` / `startPreviewLoop`）
- Test: `tests/unit/design-preview.test.ts`（ループの開始停止をモック）

- [ ] **Step 1: 失敗するテスト**
- [ ] **Step 2: 実装（cancel で停止、開始時に旧 preview 削除、fake は短時間 preview コピー）**
- [ ] **Step 3: コミット**

### Task 3: GET preview API + DesignPanel UI

**Files:**
- Create: `src/app/api/brews/[id]/design/preview/route.ts`
- Modify: `src/components/design-panel.tsx`
- Test: `tests/unit/api-design-routes.test.ts`

- [ ] **Step 1: API テスト → 実装**
- [ ] **Step 2: DesignPanel にプレースホルダ + img ポーリング**
- [ ] **Step 3: 関連ユニットテスト通過・コミット・PR**
