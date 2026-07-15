# デザイン工程(Pencil モック生成)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書 `docs/superpowers/specs/2026-07-15-design-mock-pencil-design.md` の3本柱を実装する。
(a) 任意のデザイン工程(Pencil CLI でモック生成)、(b) 熟成のデザイン忠実度評価、(c) ビルドプロンプトの必須実装化。

**Architecture:** `src/lib/design/`(CLI spawn + フェイク)、`data/brews/<ID>/design/`、
API `design/{generate,cancel,mock}`(withPhaseLock 相互排他)、ワークベンチに「デザイン」タブ、
熟成 materials/evaluate にモック画像を追加。

**Tech Stack:** Next.js App Router, `@pencil.dev/cli`(exact pin, dependencies), Vitest, Playwright(fake)

**Branch:** `feature/design-mock-pencil`(タスクごとにコミット、完了後 master へマージ)

---

### Task 1: ビルドプロンプト強化(Pencil 非依存・即効)

**Files:**
- Modify: `src/lib/tap/index.ts`(`INTRO_PROMPT` / `REPAIR_INTRO_PROMPT` / `resumeIntroPrompt`)
- Test: `tests/unit/tap.test.ts`(既存プロンプト検証があれば追随、なければ追加)

- [ ] 3つのプロンプトに「03-design-system.md の装飾要素(円形進捗・バッジ・アイコン・アクセントバー等)は『任意』とあっても原則実装する」旨の一文を追加
- [ ] `npx vitest run` 緑を確認
- [ ] Commit: `feat: ビルドプロンプトにデザイン装飾要素の必須実装指示を追加`

### Task 2: Settings 拡張(pencilCliKey / pencilModel)

**Files:**
- Modify: `src/lib/store/types.ts`(Settings に2フィールド)
- Modify: `src/lib/store/index.ts`(`DEFAULT_SETTINGS` に既定値 `""`。merge 方式なので既存 settings.json はそのまま補完される)
- Modify: `src/app/settings/page.tsx`(「デザインエンジン(Pencil)」セクション: キー・モデル入力。Cursor セクションの隣に同じ作法で)
- Test: `tests/unit/store.test.ts` 等の既存 Settings テストに追随

- [ ] 型・既定値・設定画面フォームを追加(キーは password input、環境変数フォールバックの説明文つき)
- [ ] Commit: `feat: 設定にデザインエンジン(Pencil)のキーとモデルを追加`

### Task 3: Brew 状態(DesignMockRecord)+ ディレクトリヘルパ

**Files:**
- Modify: `src/lib/store/types.ts`(`DesignMockRecord`、`Brew.designMock: DesignMockRecord | null`)
- Modify: `src/lib/store/index.ts`(`designDir(brewId)` ヘルパ、readBrew の欠落フィールド null 補完)
- Test: `tests/unit/store.test.ts`

- [ ] 失敗するテスト: 旧 brew.json(designMock なし)を読むと null 補完される
- [ ] 型とヘルパを実装
- [ ] Commit: `feat: ブリューにデザインモック状態(designMock)を追加`

### Task 4: lib/design 本体(CLI spawn + フェイク + プロンプト)

**Files:**
- Modify: `package.json`(`@pencil.dev/cli` を dependencies に **exact pin** で追加)
- Create: `src/lib/design/resolve.ts`(`DesignNotConfiguredError`、キー解決: settings → `PENCIL_CLI_KEY`、`isFakeMode` は `@/lib/tap/resolve` を共用)
- Create: `src/lib/design/prompt.ts`(生成/再生成プロンプト組み立て。ゴミ要素抑止の指示を含む)
- Create: `src/lib/design/pencil-cli.ts`(`node_modules/.bin/pencil(.cmd)` 解決、spawn、15分タイムアウト、CancelToken で kill、stdout/stderr→design.log)
- Create: `src/lib/design/index.ts`(`generateDesignMock(brew, { instruction?, token, onProgress })`: 前提チェック→spawn→mock.png 確認→usage.json 読取→DesignMockRecord 確定。再生成は mock.pen があれば `--in`、なければ新規にフォールバック)
- Create: `templates/design-fake/mock.png`(小さな固定 PNG)+ フェイク経路(CLI を呼ばずコピー+ダミー usage)
- Test: `tests/unit/design-prompt.test.ts`(プロンプト組み立て)、`tests/unit/design-generate.test.ts`(フェイク経路で mock.png 生成・record 確定・usage 変換)

- [ ] 失敗するテストから TDD(プロンプト・フェイク生成・usage.json → record 変換・--in フォールバック)
- [ ] 実装(実 CLI 経路は spawn 引数の組み立てまでを単体テスト対象にし、実行はしない)
- [ ] Commit: `feat: Pencil CLI によるデザインモック生成ライブラリを追加`

### Task 5: 相互排他 + API ルート

**Files:**
- Create: `src/lib/design/design-state.ts`(`designingBrews: Set<string>`、`designCancelTokens: Map`)
- Modify: `src/lib/mature/mature-state.ts`(`isBrewBusy` に designingBrews を追加)
- Create: `src/app/api/brews/[id]/design/generate/route.ts`(POST。`withPhaseLock` 使用。レシピ未生成 400 / キー未設定 400)
- Create: `src/app/api/brews/[id]/design/cancel/route.ts`(POST。mature/cancel と同じ作法)
- Create: `src/app/api/brews/[id]/design/mock/route.ts`(GET。mock.png を image/png で返す。なければ 404)
- Modify: `src/lib/api.ts`(`errorResponse` に `DesignNotConfiguredError` → 400 を追加)
- Modify: 残留 status 補正 — `normalizeStaleBatch`(tap/index.ts:134)と同じ方針で `designMock.status === "generating"` を failed に倒す補正を追加し、同じ呼び出し箇所に組み込む
- Test: `tests/unit/api-design-routes.test.ts`(生成成功(fake)/レシピなし 400/実行中 409/cancel/mock 配信)

- [ ] 失敗するテストから TDD
- [ ] 実装
- [ ] Commit: `feat: デザインモック生成のAPIルートと相互排他を追加`

### Task 6: UI(デザインタブ)

**Files:**
- Modify: `src/components/brew-workbench.tsx`(タブ定義 `{ id: "design", label: "デザイン" }` を「レシピ」と「タップ」の間に追加。有効条件: レシピ生成済み)
- Create: `src/components/design-panel.tsx`(未生成/生成中(経過時間+キャンセル)/成功(画像表示・日時・モデル・コスト・追加指示つき再生成)/失敗(エラー+再試行)。`use-brew-action` の既存パターンを踏襲)

- [ ] パネル実装(mock 画像は `/api/brews/<id>/design/mock?t=<generatedAt>` でキャッシュバスト)
- [ ] 「モックを生成」ボタンに所要目安(約5分)と概算コスト($2前後)の注記
- [ ] Commit: `feat: ワークベンチにデザインタブ(モック生成UI)を追加`

### Task 7: 熟成統合(デザイン忠実度評価 + モック同梱)

**Files:**
- Modify: `src/lib/mature/materials.ts`(`EvaluationMaterials.mockImage: LlmImage | null`。`design/mock.png` があれば読み込む)
- Modify: `src/lib/mature/evaluate.ts`(モックあり時: 画像1枚目=モック(目標)/2枚目以降=実画面と明記、システムプロンプトに「デザイン忠実度」観点の必須化と差分の improvements 列挙を追加)
- Modify: `src/lib/tap/template.ts`(バッチ準備時に `design/mock.png` → `docs/recipe/design-mock.png` 同梱。improvement notes からの参照が成立)
- Test: `tests/unit/mature-evaluate.test.ts` / `tests/unit/mature-materials.test.ts`(モックあり/なしで画像順序とプロンプト分岐)

- [ ] 失敗するテストから TDD
- [ ] 実装(モックなし時の挙動が完全に従来どおりであることをテストで固定)
- [ ] Commit: `feat: 熟成評価にデザイン忠実度(モック比較)を追加`

### Task 8: E2E + README + 検証

**Files:**
- Create: `tests/e2e/design.spec.ts`(fake 構成: レシピ生成済み → デザインタブ → 生成 → mock 表示。熟成評価に観点が乗ることは unit でカバー済みのため E2E は生成フロー中心)
- Modify: `README.md`(使い方に「デザイン(任意)」、データ配置に `design/`、設定表に Pencil、コスト目安と早期アクセス注意)
- Modify: `AGENTS.md`(必要ならフェイク経路の説明に design を追記)

- [ ] E2E 追加(`npm run dev` 停止確認後 `npm run e2e`)
- [ ] `npm run lint` / `npx tsc --noEmit` / `npx vitest run` すべて緑
- [ ] README 更新(/docs-sync の観点で差分確認)
- [ ] Commit: `docs: READMEにデザイン工程を追記` ほか
- [ ] master へマージ・push(ユーザー確認後)

---

## 実装時の注意

- Windows: `.bin/pencil.cmd` の spawn は `shell: true` か `cmd` 直指定が必要な場合あり(server-manager.ts の既存 spawn 作法を踏襲)
- `PENCIL_CLI_KEY` は spawn の env にのみ渡し、design.log にキーを書かない
- usage.json が欠けていても成功扱い(costUsd: null)— CLI の将来変更に耐える
- E2E は既存 global-setup(fake settings)をそのまま使う。pencilCliKey 不要(fake 経路)
