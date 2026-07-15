# デザイン工程(Pencil モック生成)+ デザイン忠実度評価 設計書

Date: 2026-07-15
Status: approved(2026-07-15 ユーザー承認)

## Goal

タップ工程の生成アプリの「デザインの弱さ」を解消する。PoC(2026-07-15)で確認した根本原因は、
レシピのデザイン仕様(`03-design-system.md`)が十分詳細であるにもかかわらず、

1. ビルドエージェントが「任意」と書かれた装飾要素(円形進捗・バッジ・アイコン等)を省略して最小実装で止まる
2. 熟成のルーブリックに「デザイン仕様をどこまで再現したか」を測る観点がない

の2点により、デザイン忠実度への圧力が工程のどこにも存在しないこと。

対策は3本柱:

- **(a) デザイン工程(任意)** — 発酵完了後、Pencil CLI でレシピから高忠実度モックアップ(PNG)を生成できる
- **(b) 熟成のデザイン忠実度評価** — モックがあれば「モック vs 実画面」の一致度を評価観点に追加し、差分を改善指示に流す
- **(c) ビルドプロンプトの必須実装化** — デザイン仕様の装飾要素を「原則実装」とする一文を追加(Pencil 不要・無料の根本対策)

## Non-goals

- 熟成ループ内でのモック自動生成(1回 $2+/約5分 のため、生成は常にユーザーの明示操作)
- 複数画面のモック生成(v1 はメイン画面1枚。将来拡張)
- `.pen` ファイルの編集 UI / Pencil MCP の対話的統合
- Cursor SDK への画像添付(`send(prompt: string)` はテキスト専用。モックの消費は熟成の vision 評価経由)
- モックからの直接コード生成(design-to-code)

## PoC で確認済みの前提

- `@pencil.dev/cli` はヘッドレスで動作する(GUI・デスクトップアプリ不要、Node.js 18+)
- 認証は `PENCIL_CLI_KEY`(CI/CD 用キー)で非対話的に可能
- `--prompt-file` でレシピ Markdown を添付でき、デザイントークンを忠実に反映したモックが得られる
- `--export` で PNG 出力、`--usage` でコスト JSON が得られる(実測: claude-opus-4-6 経由 $2.18 / 304秒 / 24ターン)
- 既知の不具合: キャンバス外にゴミ要素が残ることがある → プロンプトで抑止を指示(完全解決は保証しない)

## 設定(Settings)

`Settings`(`src/lib/store/types.ts`)に追加:

```ts
/** Pencil CLI(デザイン工程)のAPIキー。空なら環境変数 PENCIL_CLI_KEY にフォールバック */
pencilCliKey: string;
/** デザイン工程で使うモデルID(pencil --model)。空なら CLI 既定 */
pencilModel: string;
```

- 設定画面に「デザインエンジン(Pencil)」セクションを追加(ビルドエンジン(Cursor)と同じ並び)
- キー未設定かつ環境変数もなし → デザインタブに設定誘導を表示(タップの `TapNotConfiguredError` と同じパターン)
- 既存 `settings.json` は読み込み時にフィールド欠落を既定値 `""` で補完(既存のマイグレーション方式に従う)

## データ配置

```text
data/brews/<ID>/
  design/
    mock.pen        … Pencil デザインファイル(再生成の --in 入力にも使う)
    mock.png        … エクスポート画像(UI 表示・熟成評価に使用)
    usage.json      … トークン使用量・コスト(CLI --usage 出力)
    design.log      … CLI 実行ログ
```

`Brew`(brew.json)に追加:

```ts
export interface DesignMockRecord {
  status: "generating" | "succeeded" | "failed" | "cancelled";
  generatedAt: string | null;   // 成功時 ISO
  error: string | null;
  model: string;                // 実際に使われたモデル(usage.json から)
  costUsd: number | null;       // usage.json の totalCostUsd
  durationMs: number | null;
}

// Brew に追加
designMock: DesignMockRecord | null;
```

- `BrewStage` は変更しない(モックは任意の副産物で、工程遷移をゲートしない)
- schemaVersion は 1 のまま(欠落フィールドは null 補完)

## lib 設計: `src/lib/design/`

```text
src/lib/design/
  index.ts      … generateDesignMock(brewId): 全体オーケストレーション
  pencil-cli.ts … CLI 解決・spawn・タイムアウト・キャンセル
  resolve.ts    … isFakeMode 分岐・キー解決(TapNotConfiguredError 相当の DesignNotConfiguredError)
  prompt.ts     … プロンプト組み立て
```

### CLI の解決

`@pencil.dev/cli` を **dependencies に追加**し、`node_modules/.bin/pencil`(win32 は `pencil.cmd`)を
子プロセスとして spawn する。グローバルインストール不要で `npm install` だけで動く。
クローズドソースのためバージョンは **固定(exact pin)** し、更新は手動で行う。

### 生成フロー

1. 前提チェック: レシピ生成済み(`02-screens.md` / `03-design-system.md` が存在)、他ジョブ非実行
2. `data/brews/<ID>/design/` を用意(再生成時は前回ファイルを上書き)
3. spawn:

```text
pencil --out design/mock.pen
       --prompt <組み立てプロンプト>
       --prompt-file recipe/02-screens.md
       --prompt-file recipe/03-design-system.md
       --export design/mock.png --export-scale 2
       --usage design/usage.json
       [--model <settings.pencilModel>]
```

- env: `PENCIL_CLI_KEY`(設定 or 環境変数)
- タイムアウト: 15分(PoC 実測5分の3倍)。超過で kill → `failed`
- キャンセル: 既存の CancelToken パターンで kill → `cancelled`
- stdout/stderr は `design.log` へ

4. 終了後: `mock.png` の存在を確認 → `usage.json` を読んで `DesignMockRecord` を確定 → brew.json 保存

### プロンプト(prompt.ts)

PoC で使ったものをベースに、ゴミ要素対策を追加:

- 添付のスクリーン仕様とデザインシステムに厳密に従い、メイン画面1枚の高忠実度モックを作る
- デザイントークン(色・余白・角丸・タイポ)をそのまま使う
- 「任意」とされる装飾要素(進捗リング・バッジ・アイコン等)も必ず描く
- **メインフレームの外に要素を残さない。作業用の一時要素は削除してから完了する**

### 再生成

「再生成」ボタンは既存 `mock.pen` があれば `--in design/mock.pen` を付けて差分修正モードにし、
ユーザーが任意の追加指示(テキスト)を添えられるようにする(空なら「仕様との差分を修正して品質を上げる」)。

## API

既存の mature/pub と同じ配置・相互排他パターン:

```text
POST /api/brews/[id]/design/generate   … 生成開始(body: { instruction?: string })
POST /api/brews/[id]/design/cancel     … キャンセル
GET  /api/brews/[id]/design/mock       … mock.png を返す(image/png)
```

- 実行中はビルド・熟成・Pub と相互排他(実行中は 409。既存の実行状態管理に design ジョブを追加)
- レシピ未生成: 400、キー未設定: 400(設定誘導メッセージ)

## UI(ワークベンチ)

- 「レシピ」と「タップ」の間に **「デザイン」タブ** を追加(レシピ生成済みで有効)
- 内容:
  - 未生成: 説明+「モックを生成」ボタン(所要目安と概算コストを添える)
  - 生成中: 進捗表示(経過時間+ design.log 末尾)+「キャンセル」
  - 生成済み: mock.png 表示、生成日時・モデル・コスト、「再生成」(追加指示の任意入力付き)
  - 失敗: エラー+ログ抜粋+「再試行」
- タップ/熟成には手を入れない(モックの有無で挙動が変わるのは熟成の評価のみ)

## 熟成統合(デザイン忠実度評価)

`src/lib/mature/`:

- `materials.ts`: `EvaluationMaterials` に `mockImage: LlmImage | null` を追加(`design/mock.png` があれば読む)
- `evaluate.ts`:
  - 画像の並び: **1枚目=モック、2枚目以降=実画面スクリーンショット**とし、プロンプトに画像の役割を明記
  - システムプロンプトに追加: 「デザインモックが与えられた場合、観点『デザイン忠実度』を必ず axes に含め、
    実画面がモックのレイアウト・配色・装飾要素をどこまで再現しているかを採点する。
    差分(欠けている装飾要素・色ズレ・配置ズレ)は improvements に具体的に列挙する」
  - vision 失敗時のフォールバック(画像なし再試行)は既存のまま。モックなし時の挙動は完全に従来どおり
- 改善指示は既存の `07-improvement-notes.md` 経由で repair バッチに流れる(追加実装不要)
- `template.ts`: バッチ準備時に `design/mock.png` があれば `docs/recipe/design-mock.png` として同梱し、
  改善指示から参照可能にする(エージェントが画像を読めるかはモデル依存だが、同梱は無害)

## ビルドプロンプト強化(Pencil 非依存の根本対策)

`src/lib/tap/index.ts` の `INTRO_PROMPT` / `REPAIR_INTRO_PROMPT` / `resumeIntroPrompt` に1文追加:

> 03-design-system.md はデザイン仕様です。「任意」「表示する場合」と書かれた装飾要素
> (円形進捗・バッジ・アイコン・アクセントバー等)も原則実装し、最小実装で済ませないでください。

## フェイクモード・テスト

- `isFakeMode(settings)`(tap/resolve.ts のものを共用)のとき、Pencil CLI を呼ばず
  `templates/design-fake/mock.png`(リポジトリ同梱の固定 PNG)をコピーして即時成功にする
  (`usage.json` はダミー値)。E2E・オフライン動作確認用
- 単体テスト(Vitest): prompt 組み立て、usage.json → DesignMockRecord 変換、
  materials の mockImage 読み込み、evaluate の画像順序・システムプロンプト分岐
- E2E(Playwright + fake): レシピ生成済みブリューで「モックを生成」→ 成功表示 → mock.png が配信される、
  熟成評価に「デザイン忠実度」観点が含まれる

## エッジケース

| ケース | 挙動 |
|---|---|
| レシピ未生成で generate | 400 |
| キー未設定(設定・環境変数とも) | 400 + 設定誘導。タブには誘導表示 |
| CLI がタイムアウト(15分) | kill → status "failed"、ログ保全 |
| mock.png が出力されない(CLI 異常終了) | "failed" + design.log 末尾をエラーに |
| 生成中にビルド/熟成/Pub 開始 | 409(相互排他) |
| モックなしで熟成評価 | 従来どおり(観点追加なし) |
| 再生成で .pen が壊れている/ない | --in を付けず新規生成にフォールバック |
| アプリ再起動時に status "generating" が残留 | 起動時に "failed"(中断)へ倒す(既存ビルドの残留対策と同じ方針) |

## README 更新(AGENTS.md の規約)

- 使い方に「デザイン(任意)」工程を追加(位置: レシピ生成とタップの間)
- データ配置図に `design/` を追加
- 設定表に Pencil(キー・モデル・環境変数 `PENCIL_CLI_KEY`)を追加
- コスト・所要時間の目安と「早期アクセス期間のサービスである」注意書き

## リスクと対策

| リスク | 対策 |
|---|---|
| Pencil は早期アクセス・クローズドソース(将来有料化/仕様変更) | 依存を exact pin。工程は任意なので外れても本体は無傷。README に注意書き |
| 1回 $2+ のコスト | 自動実行しない(ユーザー明示操作のみ)。UI に概算コスト表示。usage.json を保存し実績表示 |
| キャンバス外ゴミ要素 | プロンプトで抑止指示+「再生成(追加指示付き)」で人間が修正依頼できる |
| 課金実態の不透明さ(Pencil 側プロキシ課金) | 導入前にユーザーがダッシュボードで請求有無を確認する(実装とは独立の確認事項) |
| チャットに貼られた CLI キー | ダッシュボードで失効・再発行を推奨(実装とは独立) |

## 実装順序(概要)

1. (c) ビルドプロンプト強化 — 最小・独立・即効
2. Settings + lib/design + フェイクモード
3. API + UI(デザインタブ)
4. 熟成統合(materials / evaluate / template 同梱)
5. README・テスト整備
