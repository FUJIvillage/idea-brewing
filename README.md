# Idea Brewing

アイデアをビールの醸造のように仕込み、煮沸し、発酵させて「実装資料一式(レシピ)」に仕上げるローカルWebアプリ。

テキスト・画像・URL・ファイルを原料として投入すると、設定したLLMが7項目の「ブリューシート」に構造化し、
煮沸工程(1問ずつの質問攻め、autoモードあり)で曖昧さを解消し、実装AIエージェントにそのまま渡せる
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

任意で **Effort**(none/minimal/low/medium/high/xhigh/max)を指定できます。OpenAI / OpenRouter には `reasoningEffort`、Google には `thinkingLevel` として渡されます(max/xhigh は high 扱い)。未指定ならモデル既定のままです。

## Cursor SDK設定(タップ工程)

レシピ完成後のタップ工程では Cursor SDK(`@cursor/sdk`)を使って生成アプリをビルドします。設定画面の「ビルドエンジン(Cursor)」で Cursor APIキーとモデル名(`cursorModel`)を設定してください。APIキーは [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations) で発行できます。

任意で **Effort**(low/medium/high/xhigh/max)と **Fast**(on/off)も指定でき、Cursor SDK の params にそのまま渡されます。未指定ならモデル既定です。

Cursor APIキーは設定画面に保存する代わりに、環境変数 `CURSOR_API_KEY` でも指定できます。E2Eやローカルの動作確認では、`IDEA_BREWING_FAKE_BUILD=1` を設定すると、Cursor SDKを呼ばずにフェイクエンジン + `tap-fake` テンプレートでビルドします。テスト用に `data/settings.json` を直接編集する場合は、`provider` を `fake` にしても同じフェイクビルド経路になります。

## Pencil CLI設定(デザイン工程・任意)

レシピ完成後の「デザイン」タブでは、Pencil CLI(`@pencil.dev/cli`)で画面仕様とデザインシステムから高忠実度モックアップ(PNG)を生成できます。設定画面の「デザインエンジン(Pencil)」でCLIキーを設定してください([pencil.dev](https://www.pencil.dev/) の組織設定 → Developer Keys で発行。環境変数 `PENCIL_CLI_KEY` でも指定可)。

デザインモデル(`pencilModel`)は任意です。空の場合はLLMプロバイダに合わせて自動選択します(OpenAI/OpenRouter → `gpt-5.4`、Google → `gemini-3.5-flash`、それ以外はCLI既定のClaude)。OpenAI/Google系モデルはLLMプロバイダのAPIキーをエージェント認証(`PENCIL_AGENT_API_KEY`)として使い、Claude系は `ANTHROPIC_API_KEY` かClaude Codeログインが別途必要です。

- 生成は1回あたり数分・$2前後かかります(モデルによる)。実行は常に手動で、熟成の自動ループには組み込まれません
- 生成中は約12秒間隔で途中経過のプレビュー画像が表示されます(最初の有効フレームまでは「キャンバス準備中…」)
- 生成したモックは熟成の評価で「デザイン忠実度」の採点基準になり、差分は改善指示として次バッチに反映されます。バッチには `docs/recipe/design-mock.png` として同梱されます
- Pencil は早期アクセス中のクローズドソースサービスです。料金体系・CLI仕様は変わる可能性があります
- フェイク構成(`IDEA_BREWING_FAKE_BUILD=1` またはプロバイダ `fake`)ではCLIを呼ばず、同梱の固定モックをコピーします(動作確認用)

## 使い方

1. **新しい仕込み** — ブリュー名と原料(テキスト・URL・画像・.md/.txt/.pdf)を投入
2. **仕込み(マッシュ)** — LLMが原料をブリューシート7項目に構造化(充足度付き)
3. **煮沸** — 不足項目への質問に1問ずつ回答。autoモードなら推奨回答で自動進行。
   質問数の上限は設定画面から変更できます(1〜100、既定20。達すると自動完了)
4. **レシピ生成(発酵)** — 実装資料7ファイル(概要/要件/画面/デザイン/構成/実装計画/評価基準)を生成
5. **デザイン(任意)** — 「デザイン」タブで「モックを生成」を押すと、Pencil CLI がレシピから高忠実度モックアップを生成。追加指示つきの「再生成」もできる(要 Pencil CLIキー)
6. **タップ** — 「タップ」タブで「ビルド開始(1stバッチ)」を押して生成アプリを作り、「注ぐ(サーバー起動)」でローカルdevサーバーを起動。確認後は「止める」で停止

成果物は `data/brews/<ID>/recipe/` に Markdown として保存され、エクスプローラーから直接読めます。
タップ工程の生成物は `data/brews/<ID>/taps/batch-1/` に Vite + React + TypeScript + Tailwind のアプリとして出力されます。ビルド後は `npm install --ignore-scripts` / `npx tsc --noEmit` / `npx vite build` で検証し、失敗時は最大2回の修理ラウンドが自動で走ります。ログは `data/brews/<ID>/taps/batch-1/build.log` に保存されます。

1stバッチのビルドが失敗・中断した場合、完了済みタスクまでを保った状態(`build-checkpoint.json`)から「▶ 再開」できます。チェックポイントが無ければ「最初から」しか選べません。

データ配置の概要:

```text
data/
  settings.json                … LLM/Cursor の設定・APIキー
  personas.json                … 保存済みの常連客(上限20件)
  brews/
    <ID>/
      brew.json                … そのブリューの全状態(工程・シート・バッチ等)
      ingredients/             … 投入した原料ファイル
      recipe/                  … 発酵で生成した実装資料(Markdown 7ファイル)
      design/                  … デザイン工程のモック(mock.pen / mock.png / usage.json / design.log)
      taps/
        batch-<N>/             … タップ工程で生成したアプリ(Vite+React)+ tap.json / build.log
          evaluation.md        … 熟成の評価(実行時)
          screenshots/         … 熟成の撮影(実行時)
          pub/                 … Pub の report.md と persona-*.png(実行時)
```

データの保存先ディレクトリは環境変数 `IDEA_BREWING_DATA_DIR` で変更できます(既定: プロジェクト直下の `data/`)。`data/` は `.gitignore` 済みです。

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
   未指定時の既定値: 目標スコア 4 / 上限バッチ数 3。
   停止条件: 目標達成 / 上限到達 / ビルド失敗 / 中断。

補足:

- 評価は LLM プロバイダ設定(BYOK)を使います。vision 非対応モデルや Playwright の
  ブラウザ未導入環境ではスクリーンショットなしで評価が続行されます。
  撮影を有効にするには `npx playwright install chromium` を実行してください。
- デザイン工程のモックがあると、評価の観点に「デザイン忠実度」が追加され、
  モックと実画面の差分(欠けている装飾要素・色ズレ等)が改善指示に反映されます。
- 「注ぐ」は常に最新の成功バッチを配信します。
- フェイク構成(プロバイダ `fake` または `IDEA_BREWING_FAKE_BUILD=1`)では
  撮影をスキップし、決定論的な評価が返ります(動作確認用)。

## Pub(AIユーザーテスト)

ビルド成功済みのブリューは、ワークベンチの「Pub」タブから AI 客に試してもらえます。

1. **開店する** — ブリューシートから自動生成した AI 客(0〜5人)と、保存済みの常連客を
   組み合わせて開店します(合計 1〜5 人)。各客は Playwright で実際にアプリを操作し、
   自分の目的(goals)を達成できたか試します。
2. **Pub レポート** — 客ごとに固定 4 軸(目的達成 / 使いやすさ / 見た目・第一印象 / また来たいか)の
   採点・一言レビュー・タスク結果・行動ログ・最終画面が記録されます
   (`data/brews/<ID>/taps/batch-<N>/pub/report.md`)。
3. **常連客の管理** — 名前・プロフィール・目的を書いて保存すると、次回以降の開店に
   参加させられます(`data/personas.json`、上限20件)。
4. **リーダーボード** — トップページの「リーダーボード」から、全ブリューを Pub スコア順で
   比較できます。リリース判断の参考にしてください。

補足:

- 操作はテキストベース(ページ構造の要約 + 操作可能要素リスト)で行うため、
  vision 非対応モデルでも動作します。
- 実ブラウザでの操作には `npx playwright install chromium` が必要です。
- フェイク構成(`IDEA_BREWING_FAKE_BUILD=1` またはプロバイダ `fake`)ではブラウザを
  起動せず決定論的に完走します(動作確認用)。
- Pub 実行中はビルド・熟成・サーバー操作と相互排他になります(実行中は 409)。
- 1 人が途中で破綻しても残りの客で続行し、全員破綻したときだけ失敗になります。

## テスト

```powershell
npm run test   # 単体テスト(Vitest)
npm run e2e    # E2E(Playwright + フェイクLLM)
npm run lint   # ESLint(生成物 data/・templates・デザインハンドオフは対象外)
```

`npm run e2e` は内部で開発サーバーを起動するため、`npm run dev` の実行中に走らせると失敗します(Next 16 は同一ディレクトリでの開発サーバー二重起動を禁止しています)。先に dev サーバーを止めてください。

Windows/OneDrive環境で `npm run build` が `.next` 配下の `EPERM` で失敗する場合は、開発サーバーを止めてから、git管理外の `.next` を削除して再実行してください。

タップ工程で起動した生成アプリのdevサーバーは、idea brewing本体のプロセスから起動されます。本体終了後も残る場合は「止める」またはタスクマネージャー等で停止してください。

## ロードマップ

- ~~Phase 2: レシピを Cursor SDK に渡してコード生成し、ローカルdevサーバーで確認(タップ工程)~~ 完了
- ~~Phase 3: 自己評価→自己改善のバッチループ(熟成)~~ 完了
- ~~Phase 4: AIユーザーテスト環境「Pub」とリーダーボード~~ 完了
- Phase 5 以降(候補): Pub フィードバックの熟成への自動連携、バッチ間比較UI、レシピ自動改訂、工程別モデル使い分け
