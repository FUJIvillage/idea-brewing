# Pencil Design Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pencil の構造化デザイン仕様と実装向け要約を、画像とともにタップビルドへ渡す。

**Architecture:** `mock.pen` を原本として完全な `design-spec.json` と要約 `design-handoff.md` を決定論的に生成する。デザイン生成成功時に保存し、既存モックはバッチ準備時に自動バックフィルする。

**Tech Stack:** TypeScript, Node.js fs, Next.js, Vitest

---

### Task 1: ハンドオフ生成器

**Files:**
- Create: `src/lib/design/handoff.ts`
- Test: `tests/unit/design-handoff.test.ts`

- [ ] `.pen` の完全コピーとMarkdown要約を検証する失敗テストを書く
- [ ] テストが期待どおり失敗することを確認する
- [ ] variables・画面・reusable components を抽出する最小実装
- [ ] テストを通す

### Task 2: デザイン生成フローへの接続

**Files:**
- Modify: `src/lib/design/index.ts`
- Test: `tests/unit/design-generate.test.ts`

- [ ] 生成成功時にハンドオフ成果物が作られる失敗テスト
- [ ] 実装してテストを通す

### Task 3: ビルドバッチ同梱とプロンプト

**Files:**
- Modify: `src/lib/tap/template.ts`
- Modify: `src/lib/tap/index.ts`
- Modify: `tests/unit/template.test.ts`
- Modify: `tests/unit/tap-prompts.test.ts`

- [ ] PNG・JSON・Markdown同梱と既存モックバックフィルの失敗テスト
- [ ] 初回・再開・修理の必読プロンプト失敗テスト
- [ ] 実装して関連テストを通す

### Task 4: 検証と提出

- [ ] design / template / prompt 関連テストを実行
- [ ] lint と全ユニットテストを実行
- [ ] コミット・push・PR作成
