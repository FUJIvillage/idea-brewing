# idea brewing — 第3版(熟成・自己評価バッチループ)設計書

- 日付: 2026-07-03
- ステータス: 承認済み(設計)
- スコープ: 第3版「自己評価 → 自己改善 → 次バッチ生成」のバッチループ(熟成)
- 前提: 第2版(ビルド工程・タップ)は feat/phase2-tap で完成・検証済み

## 1. 概要

ビルド成功済みのバッチに対して「熟成」を実行すると、設定済み LLM(BYOK)が `06-evaluation-criteria.md` のルーブリックに沿って生成アプリを自己評価し、改善指示を作り、Cursor SDK で次のバッチ(2nd、3rd…)を生成する。醸造メタファーでは、若いビールを寝かせて品質を上げる「熟成」工程にあたる。

### 確定済みの方針(ユーザー回答)

- **評価対象**: コード + 実画面スクリーンショット + 生成過程(グリル回答・ビルドログ)の全体
- **次バッチ戦略**: LLM が評価結果から毎回判断(`repair` = 前バッチをコピーして修正 / `rebuild` = テンプレートからゼロで再生成)
- **ループ制御**: 手動ステップ(1バッチずつ)が基本 + auto モード(目標スコア・上限バッチ数で自動連鎖)
- **評価エンジン**: レシピ生成と同じ設定済み LLM(`LlmClient`)。vision 非対応や撮影失敗時はスクリーンショット採点を自動スキップ
- **UI**: ワークベンチに「熟成」タブを新設(タップタブはビルド・起動専用のまま)
- **アーキテクチャ**: サーバー側ジョブ方式(ビルド工程と同じ「進捗を brew.json に永続化 + UI 1秒ポーリング + インメモリロック/キャンセルトークン」パターン)

## 2. データモデルの拡張

`schemaVersion: 1` のまま、新フィールドはストア層でデフォルト補完する(後方互換)。

```ts
export interface AxisScore {
  name: string;      // ルーブリックの観点名
  score: number;     // 1〜5
  comment: string;   // 講評
}

export type NextBatchStrategy = "repair" | "rebuild";

export interface BatchEvaluation {
  overall: number;               // axes の平均(小数1桁)
  axes: AxisScore[];
  summary: string;               // 総評
  improvements: string[];        // 次バッチへの改善指示(番号付きで実行可能な粒度)
  strategy: NextBatchStrategy;   // LLM が推奨する次バッチの作り方
  screenshotsUsed: boolean;      // スクリーンショットを採点に使えたか
  evaluatedAt: string;
}

export interface BatchRecord {
  number: number;                // 1 始まり(第3版から 2 以降が現れる)
  status: BatchStatus;           // 既存: building | succeeded | failed | cancelled
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  evaluation: BatchEvaluation | null; // 既定 null(旧データはバックフィル)
}

export type MaturationPhase = "screenshotting" | "evaluating" | "planning" | "building";

export interface MaturationProgress {
  phase: MaturationPhase;
  detail: string;     // 例: "観点別に採点中" "バッチ2を生成中(タスク 3/8)"
  batch: number;      // 対象バッチ番号
}

export interface Brew {
  // ...既存フィールド...
  batches: BatchRecord[];                    // 複数要素になる
  maturationProgress: MaturationProgress | null; // 既定 null
}
```

- `BrewStage` は変更しない(`built` のまま)。タンクカードは `built` のとき「バッチN・スコアX.X」(最新成功バッチと最新評価)を表示する。
- `readBrew` は旧 brew.json に対して `batches[*].evaluation: null` / `maturationProgress: null` を補完する。
- ゾンビ進捗ゼロ原則: 熟成ジョブは終了時に必ず `maturationProgress: null` へ戻す。クラッシュ痕(`maturationProgress` 残留 + 実行ロックなし)は熟成系ルートが `null` に補正する(第2版の stale building 補正と同型)。

### ディスク配置

```
data/brews/<ID>/
  taps/
    batch-1/
      build.log
      evaluation.md          # 人間可読の評価レポート(採点表 + 総評 + 改善指示)
      screenshots/
        desktop.png          # 1280x800
        mobile.png           # 390x844
      ...                    # アプリ本体
    batch-2/                 # 熟成で生成された 2nd バッチ(構造は batch-1 と同じ)
      docs/recipe/
        07-improvement-notes.md  # 前バッチの評価に基づく改善指示(エージェントへの入力)
      ...
```

## 3. モジュール構成

| モジュール | 責務 | 依存 |
|---|---|---|
| `lib/mature/screenshot.ts` | バッチの dev サーバーを起動し Playwright(chromium)で撮影、保存 | `lib/tap/server-manager`, `playwright` |
| `lib/mature/materials.ts` | 評価素材の収集(ルーブリック・コードダイジェスト・グリルQ&A要約・build.log 末尾) | `lib/store`, `lib/recipe` |
| `lib/mature/evaluate.ts` | LLM 採点(`generateObject`)→ `BatchEvaluation` + `evaluation.md` 生成 | `lib/llm` |
| `lib/mature/index.ts` | 熟成オーケストレータ(評価ジョブ / 次バッチジョブ / auto ループ) | 上記 + `lib/tap` |
| `lib/mature/mature-state.ts` | インメモリロック・キャンセルトークン(タップ工程と共有の排他) | `lib/tap/build-state` |

既存モジュールの一般化(第3版で必要な最小限):

- `lib/tap/index.ts` — `runBuild` に `batch: number` と `mode` を追加:
  - `mode: { kind: "initial" }` — 従来どおり(テンプレート準備 + 05 のタスクループ)
  - `mode: { kind: "improve"; strategy: NextBatchStrategy; instructions: string[] }` — 準備が異なる(4.2 節)。プロンプトは「07-improvement-notes.md の改善指示に従って修正/実装せよ」系に切替
  - `batches` 配列は「対象番号のレコードを追加/更新」方式に変更(現在は常に `batches[0]` を上書き)
- `lib/tap/template.ts` — `prepareRepairDir(brewId, fromBatch, toBatch)` を追加(前バッチを node_modules / dist 除外でコピーし、改善指示を同梱)。検証コマンドは従来どおり**テンプレート側の tap.json のみ**から読む(セキュリティ境界の維持)
- `lib/tap/server-manager.ts` — `startServer(brewId, batch)` にバッチ番号を追加。Map のキーは brewId のまま(1 ブリュー 1 サーバー)。別バッチのサーバーが稼働中なら停止してから起動。`serverStatus` は `{ running, port, batch }` を返す
- `lib/llm/client.ts` — `LlmTag` に `"evaluate"` を追加

### 3.1 スクリーンショット(`screenshot.ts`)

1. `startServer(brewId, batch)` で dev サーバー起動(既存の readiness 待ち込み)
2. `playwright` の `chromium.launch()` → デスクトップ 1280×800 とモバイル 390×844 の 2 枚を撮影(`networkidle` 待ち + 上限タイムアウト)して `taps/batch-N/screenshots/` に保存
3. `stopServer(brewId)` で必ず停止(finally)
4. Playwright / ブラウザ起動失敗・サーバー起動失敗は**熟成全体を失敗させず**、`screenshots: []` を返して評価は続行(レポートに「スクリーンショットなしで評価」と明記)

- `playwright` は既に devDependencies にある。ランタイム(API ルート)から使うため dependencies に移し、`next.config.ts` の `serverExternalPackages` に追加してバンドル対象外にする。ブラウザ未インストール環境向けに README へ `npx playwright install chromium` を記載。

### 3.2 評価素材(`materials.ts`)

| 素材 | 内容 | 上限 |
|---|---|---|
| ルーブリック | `06-evaluation-criteria.md` 全文 | なし(必須。欠落時はエラー) |
| コードダイジェスト | バッチフォルダのファイルツリー + `src/` 配下ソースの連結(node_modules / dist / docs / screenshots 除外) | 合計 60KB。超過分はファイル単位で「(省略)」注記 |
| 生成過程 | グリル Q&A(質問・回答・回答者)一覧 + `build.log` 末尾 4KB | — |
| 前回評価 | 直前バッチの `evaluation`(あれば。改善が反映されたかの検証用) | — |
| スクリーンショット | 3.1 の 2 枚(取得できた場合のみ `images` で添付) | — |

### 3.3 LLM 採点(`evaluate.ts`)

- `generateObject`(zod スキーマ)で構造化出力: `{ axes: { name, score(1〜5 整数), comment }[], summary, improvements: string[], strategy: "repair" | "rebuild" }`
- `overall` はアプリ側で平均を計算(LLM に計算させない)
- プロンプト方針: 「ルーブリックの観点ごとに採点。スクリーンショットがあれば UI/UX 観点は実画面を根拠に。生成過程(グリル回答・ビルドログ)から要求とズレた箇所や不安定な工程を指摘。improvements はエージェントが実行できる具体的指示(5〜10 個)。軽微な修正で済むなら repair、構造的問題なら rebuild を選べ」
- **画像フォールバック**: スクリーンショット付き呼び出しが失敗したら、画像なしで 1 回だけ再試行(vision 非対応モデル対策)。成功したら `screenshotsUsed: false`
- 結果は `taps/batch-N/evaluation.md`(採点表 + 総評 + 改善指示の Markdown)にも書き出す

## 4. 熟成オーケストレータ(`lib/mature/index.ts`)

3 つのジョブを提供する。いずれもサーバー側で完結し、進捗を `maturationProgress` として `writeBrew` で逐次永続化する。

### 4.1 評価ジョブ `runEvaluate(brew)`

対象: 最新の `status === "succeeded"` バッチ(対象選定はジョブ内で行う)。評価済みバッチの再評価も許可する(evaluation と evaluation.md を上書き)。

1. **screenshotting**: 稼働中の dev サーバーがあれば先に停止(撮影用の起動と競合するため)→ 3.1 の撮影(失敗しても続行)
2. **evaluating**: 3.2 → 3.3 の採点
3. **記録**: `batches[N].evaluation` を保存、`evaluation.md` 書き出し、`maturationProgress: null`

### 4.2 次バッチジョブ `runNextBatch(brew)`

対象: 最新成功バッチに `evaluation` があること(400)。

1. **planning**: 評価の `strategy` と `improvements` から次バッチの準備方法を決定
2. **building**: 一般化した `runBuild(batch=N+1, mode=improve)` を実行。準備(preparing 相当)は runBuild 内で mode に応じて切り替える:
   - `repair`: `prepareRepairDir` で前バッチをコピー(node_modules / dist / screenshots / build.log / evaluation.md は除外)+ `docs/recipe/07-improvement-notes.md` に改善指示を書き込み
   - `rebuild`: `prepareBatchDir` でテンプレートから新規作成 + レシピ同梱 + `07-improvement-notes.md` 同梱

   エージェントへの指示は「repair: 改善指示に従って既存コードを修正せよ / rebuild: レシピと改善指示に従って実装せよ」。検証・修理ループは既存どおり(テンプレートの verify コマンド、最大 2 ラウンド)。ネストされたビルドの進捗は `buildProgress` には書かず、`onProgress` をマップして `maturationProgress`(phase: "building")の detail に反映する(ロック判定を `maturationProgress` に一本化するため)
3. **記録**: `batches` に `batch-(N+1)` のレコードを追加して確定(succeeded / failed / cancelled)。成功しても自動では評価しない(手動モード)

- 次バッチ番号は**既存の最大バッチ番号 + 1**(failed / cancelled のバッチも番号を消費する)。失敗バッチのフォルダとレコードは調査可能性のためそのまま残す
- 次バッチが失敗した場合のリトライは「改善して次のバッチへ」をもう一度押す(同じ最新成功バッチの評価を使い、さらに次の番号で生成する)。失敗バッチの上書き再実行はしない

### 4.3 auto ループ `runAutoMaturation(brew, { targetScore, maxBatches })`

- 入力: 目標スコア(1.0〜5.0、既定 4.0)と上限バッチ数(累計、既定 3)
- ループ: 最新成功バッチが未評価なら評価 → `overall >= targetScore` なら停止(達成) → `batches.length >= maxBatches` なら停止(上限) → 次バッチ生成 → 失敗なら停止 → 評価 → …
- 停止条件は 4 つ: **目標達成 / 上限到達 / ビルド失敗 / ユーザー中断**。どこで止まっても `maturationProgress: null` に戻し、途中成果(評価・バッチ)はすべて保存済みの状態にする
- キャンセルトークンはネストされたビルド(`runBuild` の cancel)と LLM 呼び出し境界(各フェーズ開始前チェック)に伝搬する

### 4.4 排他とロック

- 熟成ジョブ実行中の brewId はタップのビルド・再ビルドを 409 にする(逆も同様)。実装は `buildingBrews` と同型の `maturingBrews` Set を追加し、**両ルートが両方の Set をチェック**する
- 熟成中の「注ぐ」(dev サーバー起動)も 409(スクリーンショット工程とポート・プロセスが競合するため)
- 中断は `cancelTokens` と同型の熟成用トークンで行う

## 5. API ルート

| ルート | メソッド | 動作 |
|---|---|---|
| `/api/brews/[id]/mature/evaluate` | POST | 最新成功バッチを評価。404(ブリュー不在)/ 400(成功バッチなし・ルーブリック欠落)/ 409(熟成中・ビルド中) |
| `/api/brews/[id]/mature/next` | POST | 次バッチ生成。400(最新成功バッチが未評価)/ 404 / 409 |
| `/api/brews/[id]/mature/auto` | POST | `{ targetScore, maxBatches }` で auto ループ開始。バリデーション外は 400 |
| `/api/brews/[id]/mature/cancel` | POST | 熟成中断。実行中でなく `maturationProgress` 残留があれば `null` に補正(復旧動作)。どちらでもなければ 409 |
| `/api/brews/[id]/mature/report?batch=N` | GET | `{ markdown, evaluation, screenshots: ["desktop.png", ...] }`。N のバリデーション(正の整数)+ 404 |
| `/api/brews/[id]/mature/screenshot?batch=N&name=desktop.png` | GET | スクリーンショット PNG を返す。`name` はホワイトリスト(desktop.png / mobile.png)方式 |
| `/api/brews/[id]/tap/log` | GET | 既存ルートを `?batch=N` 対応に拡張(省略時は最新バッチ) |

- エラー契約は既存どおり全ルート `{ error }` JSON(400 / 404 / 409 / 500)
- evaluate / next / auto は同期実行 + 進捗ポーリング方式(ビルドと同じ)。UI は `maturationProgress` を 1 秒ポーリング
- タップの `/server` GET / POST はバッチ番号対応: GET は `{ running, port, batch }`、POST start は最新成功バッチを起動

## 6. UI

### 6.1 「熟成」タブ(MaturePanel)

活性条件: 成功バッチが 1 つ以上あること。構成:

- **バッチ一覧**: バッチごとにカード(番号・状態・総合スコア・評価日時)。スコアは「4.2 / 5.0」形式 + 観点数ぶんの簡易バー。バッチが 2 件以上あればスコア推移(前バッチ比の増減)を表示
- **評価レポート**: 選択したバッチの `evaluation.md` を prose 表示 + スクリーンショット 2 枚をサムネイル表示(クリックで原寸)
- **操作**:
  - 「このバッチを評価」(最新成功バッチが未評価のとき)
  - 「改善して次のバッチへ」(最新成功バッチが評価済みのとき。strategy と改善指示の要約を添える)
  - 「自動で熟成」: 目標スコア(数値入力、既定 4.0)+ 上限バッチ数(既定 3)を指定して開始
  - 実行中: フェーズ表示(撮影 → 採点 → 準備 → ビルド)+ 対象バッチ番号 + 「中断」ボタン
- ビルドフェーズ中のログはタップタブと同じ `/tap/log` 相当をバッチ番号付きで参照(`/api/brews/[id]/tap/log?batch=N` に拡張)

### 6.2 既存 UI の変更

- `BrewWorkbench`: タブ配列に「熟成」を追加。`maturationProgress !== null` のときは熟成タブを強制表示 + 全タブロック(`buildProgress` と同じ扱い)
- `TapPanel`: 「注ぐ」は最新成功バッチを起動し、稼働中表示に「バッチN を提供中」を追記。「ビルド開始 / 再ビルド」(initial モード)は**成功バッチが 1 つもないときだけ**表示し、batch-1 を上書き再実行する(従来動作)。成功バッチができた後の作り直しはすべて熟成タブの「改善して次のバッチへ」(新番号)に一本化し、評価済みバッチが上書きで消えないようにする
- タンクカード: `built` のとき「提供中(バッチN・スコアX.X)」。評価がまだなら「提供中(バッチN)」

## 7. フェイク実装(テスト用)

- `FakeClient` に `tag === "evaluate"` を追加: 1 回目は `overall 3.0` 相当(各観点 3 点)+ `strategy: "repair"` + 改善指示 2 件、2 回目以降は各観点 4〜5 点(auto ループの「目標達成で停止」を決定論的にテストできるようにカウンタで制御)
- スクリーンショット工程は `IDEA_BREWING_FAKE_BUILD=1` またはプロバイダ `fake` のときスキップ(`screenshotsUsed: false`)。E2E の実行時間と Playwright 依存を避ける
- 次バッチ生成はフェイクエンジン + tap-fake テンプレートの既存経路をバッチ番号対応でそのまま使う

## 8. エラー処理

- ルーブリック(06)欠落: evaluate は 400(「レシピを再生成してください」)
- スクリーンショット失敗(Playwright 不在・サーバー起動失敗・タイムアウト): 評価は続行、`screenshotsUsed: false`、レポートに明記
- LLM 呼び出し失敗(画像なし再試行も失敗): 評価ジョブは失敗。`maturationProgress: null` に戻し、`{ error }` を UI に表示。バッチの `evaluation` は未設定のまま(再実行可能)
- 次バッチのビルド失敗: `batches` に failed レコードとして残す(調査可能性優先)。auto ループは停止。**最新の成功バッチは無傷**なので「注ぐ」は引き続き可能
- プロセスクラッシュ: インメモリロック消滅 + `maturationProgress` 残留 → 次回の熟成系 POST または cancel で `null` に補正
- 中断: 実行中フェーズを問わず、確定済みの評価・バッチはそのまま残す。ビルド中のバッチは `cancelled` で確定

## 9. テスト方針

- **Vitest(単体)**:
  - `materials.ts`: コードダイジェストの除外・上限、グリル Q&A 整形
  - `evaluate.ts`: 構造化出力 → `BatchEvaluation` 変換、overall 計算、画像なし再試行フォールバック
  - `screenshot.ts`: 失敗時に空配列で続行(server-manager / Playwright をフェイク化)
  - オーケストレータ: 評価成功 / ルーブリック欠落 / repair・rebuild 分岐 / auto ループの停止条件 4 種 / 中断時の `maturationProgress` クリア / stale 補正
  - `runBuild` 一般化: batch=2 のレコード追加、improve モードのプロンプト切替、既存 initial 経路の回帰
  - server-manager: バッチ番号切替(別バッチ起動時に旧サーバー停止)
  - API ルート: 各ルートの 400 / 404 / 409 契約、report / screenshot の入力バリデーション
- **Playwright(E2E)**: フェイク構成で「ビルド済み → 熟成タブ → 評価 → スコア表示 → 改善して次のバッチへ → バッチ 2 件表示 → 注ぐ(バッチ2)」を 1 本。auto ループは単体テストでカバーし E2E には含めない
- 既存テスト(第1版・第2版)がすべて通り続けること

## 10. スコープ外(Phase 4 以降)

- Pub(AI ユーザーテスト・リーダーボード)
- バッチ間の画面 diff 比較 UI・スクリーンショットギャラリー
- レシピ自体の自動改訂(評価がレシピの欠陥を指摘しても、レシピ再生成はユーザー操作)
- 工程別モデル使い分け・クラウド実行

## 11. 第3版の完了条件

1. ビルド済みブリューで「このバッチを評価」→ 観点別スコアと改善指示が表示され、`evaluation.md` とスクリーンショットが保存される(実キーでの手動確認)
2. 「改善して次のバッチへ」→ batch-2 が生成・検証され、成功後に「注ぐ」で batch-2 が配信される
3. 「自動で熟成」が 4 つの停止条件(目標達成 / 上限 / 失敗 / 中断)すべてで正しく止まり、途中成果が保存されている
4. vision 非対応モデル・Playwright 不在環境でもスクリーンショットなしで評価が完走する
5. フェイク構成の E2E(評価 → 次バッチ → 2 件表示)が通る
6. 既存の第1版・第2版テストがすべて通り続け、旧 brew.json がそのまま読める(後方互換)
