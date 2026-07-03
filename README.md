# Idea Brewing

アイデアをビールの醸造のように仕込み、煮詰め、発酵させて「実装資料一式(レシピ)」に仕上げるローカルWebアプリ。

テキスト・画像・URL・ファイルを原料として投入すると、設定したLLMが7項目の「ブリューシート」に構造化し、
グリル工程(1問ずつの質問攻め、autoモードあり)で曖昧さを煮詰め、実装AIエージェントにそのまま渡せる
実装資料7ファイルを生成します。

## セットアップ

```powershell
npm install
npm run dev
```

http://localhost:3000 を開き、まず「設定」からLLMを設定します。
タップ工程(コード生成)も使う場合は、同じ設定画面の「ビルドエンジン(Cursor)」も設定します。

## LLM設定(BYOK / ローカルLLM)

| プロバイダ | 必要な設定 |
|---|---|
| OpenAI | APIキー、モデル名 |
| Google (Gemini) | APIキー、モデル名 |
| Ollama(ローカル) | ベースURL(既定: http://localhost:11434/v1)、モデル名 |
| OpenRouter | APIキー、モデル名 |

APIキーは `data/settings.json` にのみ保存され、プロバイダAPI以外へ送信されません。

## Cursor SDK設定(タップ工程)

レシピ完成後のタップ工程では Cursor SDK(`@cursor/sdk`)を使って生成アプリをビルドします。設定画面の「ビルドエンジン(Cursor)」で Cursor APIキーとモデル名(`cursorModel`)を設定してください。APIキーは [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations) で発行できます。

Cursor APIキーは設定画面に保存する代わりに、環境変数 `CURSOR_API_KEY` でも指定できます。E2Eやローカルの動作確認では、`IDEA_BREWING_FAKE_BUILD=1` を設定すると、Cursor SDKを呼ばずにフェイクエンジン + `tap-fake` テンプレートでビルドします。テスト用に `data/settings.json` を直接編集する場合は、`provider` を `fake` にしても同じフェイクビルド経路になります。

## 使い方

1. **新しい仕込み** — ブリュー名と原料(テキスト・URL・画像・.md/.txt/.pdf)を投入
2. **仕込み(マッシュ)** — LLMが原料をブリューシート7項目に構造化(充足度付き)
3. **グリル** — 不足項目への質問に1問ずつ回答。autoモードなら推奨回答で自動進行
4. **レシピ生成(発酵)** — 実装資料7ファイル(概要/要件/画面/デザイン/構成/実装計画/評価基準)を生成
5. **タップ** — 「タップ」タブで「ビルド開始(1stバッチ)」を押して生成アプリを作り、「注ぐ(サーバー起動)」でローカルdevサーバーを起動。確認後は「止める」で停止

成果物は `data/brews/<ID>/recipe/` に Markdown として保存され、エクスプローラーから直接読めます。
タップ工程の生成物は `data/brews/<ID>/taps/batch-1/` に Vite + React + TypeScript + Tailwind のアプリとして出力されます。ビルド後は `npm install --ignore-scripts` / `npx tsc --noEmit` / `npx vite build` で検証し、失敗時は最大2回の修理ラウンドが自動で走ります。ログは `data/brews/<ID>/taps/batch-1/build.log` に保存されます。

データ配置の概要:

```text
data/
  settings.json
  brews/
    <ID>/
      brew.json
      recipe/
      taps/
        batch-1/
```

データの保存先ディレクトリは環境変数 `IDEA_BREWING_DATA_DIR` で変更できます(既定: プロジェクト直下の `data/`)。

## 熟成(自己評価バッチループ)

ビルド成功済みのバッチを LLM が自己評価し、改善指示から次のバッチを生成できます。

1. ワークベンチの「熟成」タブを開く(成功バッチが1つ以上で有効)
2. 「このバッチを評価」— dev サーバーを一時起動して実画面を撮影(デスクトップ/モバイル)し、
   `06-evaluation-criteria.md` のルーブリックで観点別に採点します。
   結果は `data/brews/<ID>/taps/batch-<N>/evaluation.md` と `screenshots/` に保存されます。
3. 「改善して次のバッチへ」— 評価の改善指示から次バッチを生成します。
   LLM の判断で `repair`(前バッチをコピーして修正)か `rebuild`(テンプレートから再生成)が選ばれます。
   改善指示は次バッチの `docs/recipe/07-improvement-notes.md` に同梱されます。
4. 「自動で熟成」— 目標スコアと上限バッチ数を指定して、評価→改善→再評価を自動で回します。
   停止条件: 目標達成 / 上限到達 / ビルド失敗 / 中断。

補足:

- 評価は LLM プロバイダ設定(BYOK)を使います。vision 非対応モデルや Playwright の
  ブラウザ未導入環境ではスクリーンショットなしで評価が続行されます。
  撮影を有効にするには `npx playwright install chromium` を実行してください。
- 「注ぐ」は常に最新の成功バッチを配信します。
- フェイク構成(プロバイダ `fake` または `IDEA_BREWING_FAKE_BUILD=1`)では
  撮影をスキップし、決定論的な評価が返ります(動作確認用)。

## テスト

```powershell
npm run test   # 単体テスト(Vitest)
npm run e2e    # E2E(Playwright + フェイクLLM)
```

`npm run e2e` は内部で開発サーバーを起動するため、`npm run dev` の実行中に走らせると失敗します(Next 16 は同一ディレクトリでの開発サーバー二重起動を禁止しています)。先に dev サーバーを止めてください。

Windows/OneDrive環境で `npm run build` が `.next` 配下の `EPERM` で失敗する場合は、開発サーバーを止めてから、git管理外の `.next` を削除して再実行してください。

タップ工程で起動した生成アプリのdevサーバーは、idea brewing本体のプロセスから起動されます。本体終了後も残る場合は「止める」またはタスクマネージャー等で停止してください。

## ロードマップ

- Phase 2: レシピを Cursor SDK に渡してコード生成し、ローカルdevサーバーで確認(タップ工程)
- Phase 3: 自己評価→自己改善のバッチループ(熟成)
- Phase 4: AIユーザーテスト環境「Pub」とリーダーボード
