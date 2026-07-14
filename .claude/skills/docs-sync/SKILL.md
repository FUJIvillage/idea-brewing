---
name: docs-sync
description: idea-brewing の README.md がコードの実態とズレていないか監査し、漏れていれば更新する。工程・データ配置・定数・レシピ構成・LLMプロバイダ・Pub/熟成のパラメータを変更した後や、「ドキュメントは最新か」を確認したいときに使う。
---

# ドキュメント整合チェック(idea-brewing)

`README.md` がユーザー向けの唯一の living doc。これをコードの実態に合わせて保つ。
`docs/superpowers/**`(日付入りの設計・計画スナップショット)と `docs/**/design_handoff_ps1_ui/**`(生成バンドル)は**過去の記録/生成物なので据え置き**、更新対象にしない。

## 手順

1. 下の対応表の各行について **source-of-truth のファイルを読み**、`README.md` の該当記述と突き合わせる。
2. ズレていたら **README.md を実態に合わせて更新する**(コードが正。README に合わせてコードを変えない)。
3. 変更した箇所を要点で報告する。ズレが無ければ「README は最新」と報告する。
4. 機能に影響しない装飾(UIの見た目・演出など)は無理に書き足さない。README は使い方の事実を書く場所。

## 対応表(README の記述 ↔ source of truth)

| README の記述 | 確認するファイル / 記号 |
|---|---|
| 工程名・ワークベンチのタブ(原料/ブリューシート/煮沸/レシピ/タップ/熟成/Pub)、ステージ遷移 | `src/lib/store/types.ts`(`BrewStage`, `SHEET_KEYS`, `SHEET_LABELS`)、`src/components/brew-workbench.tsx`(`TABS`)、`src/components/ps1/brew-ui.ts`(`WorkbenchTab`) |
| データ配置ツリー(`data/…`) | `src/lib/store/index.ts`(`dataDir` / `brewDir` / `recipeDir` / `tapDir` / `createBrew` の `ingredients/` / `personasPath`)、`src/lib/pub/index.ts`(`pubDir`)、`src/lib/mature/evaluate.ts`(`evaluation.md`)、`src/lib/mature/screenshot.ts`(`screenshots/`) |
| レシピ 7 ファイル(概要/要件/画面/デザイン/構成/実装計画/評価基準) | `src/lib/recipe/index.ts`(`RECIPE_FILES`) |
| LLM プロバイダ一覧 | `src/lib/store/types.ts`(`ProviderId`) |
| Pub の人数上限・評価4軸 | `src/lib/pub/constants.ts`(`MAX_PUB_GUESTS`)、`src/lib/store/types.ts`(`PUB_AXES`) |
| 常連客の保存上限 | `src/lib/store/index.ts`(`MAX_PERSONAS`) |
| 熟成 auto の既定値・範囲(目標スコア 4 / 上限バッチ 3、範囲) | `src/app/api/brews/[id]/mature/auto/route.ts` |
| 設定画面の全項目(プロバイダ・APIキー・モデル・Effort・Cursorの既定モデル/Effort/Fast・煮沸の質問上限) | `src/lib/store/types.ts`(`Settings`)、`src/lib/store/index.ts`(`DEFAULT_SETTINGS`)、`src/app/settings/page.tsx` |
| 煮沸の質問上限の既定値・範囲・設定可否 | `src/lib/boil/index.ts`(`MAX_QUESTIONS`, `MIN_BOIL_MAX_QUESTIONS`, `ABS_MAX_BOIL_MAX_QUESTIONS`, `clampBoilMaxQuestions`) |
| タップビルドの再開(失敗/中断後にタスク単位で再開できるか) | `src/lib/tap/checkpoint.ts`、`src/app/api/brews/[id]/tap/checkpoint/route.ts`、`src/components/tap-panel.tsx` |
| npm スクリプト・ポート・E2E 構成 | `package.json`(`scripts`)、`playwright.config.ts`、`tests/e2e/global-setup.ts` |
| フェイク構成の入り方(`IDEA_BREWING_FAKE_BUILD` / provider `fake`) | `src/lib/llm/fake-client.ts`、`src/lib/tap/*`、`tests/e2e/global-setup.ts` |
| 相互排他(実行中は 409) | `src/lib/mature/mature-state.ts`(`isBrewBusy`)、各編集系ルート |

## 補足

- この対応表に無い新機能を README に足す必要が出たら、まず対応表にも1行足してから README を直す(次回以降も追随できるように)。
- 表の行を検証したら、代表的な数値(例: `MAX_PUB_GUESTS`, `RECIPE_FILES.length`, 熟成の既定値)は README の文言と一字一句合っているか確認する。
