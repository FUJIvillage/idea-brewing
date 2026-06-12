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

## LLM設定(BYOK / ローカルLLM)

| プロバイダ | 必要な設定 |
|---|---|
| OpenAI | APIキー、モデル名 |
| Google (Gemini) | APIキー、モデル名 |
| Ollama(ローカル) | ベースURL(既定: http://localhost:11434/v1)、モデル名 |
| OpenRouter | APIキー、モデル名 |

APIキーは `data/settings.json` にのみ保存され、プロバイダAPI以外へ送信されません。

## 使い方

1. **新しい仕込み** — ブリュー名と原料(テキスト・URL・画像・.md/.txt/.pdf)を投入
2. **仕込み(マッシュ)** — LLMが原料をブリューシート7項目に構造化(充足度付き)
3. **グリル** — 不足項目への質問に1問ずつ回答。autoモードなら推奨回答で自動進行
4. **レシピ生成(発酵)** — 実装資料7ファイル(概要/要件/画面/デザイン/構成/実装計画/評価基準)を生成

成果物は `data/brews/<ID>/recipe/` に Markdown として保存され、エクスプローラーから直接読めます。

## テスト

```powershell
npm run test   # 単体テスト(Vitest)
npm run e2e    # E2E(Playwright + フェイクLLM)
```

## ロードマップ

- Phase 2: レシピを Cursor CLI/SDK に渡してコード生成(ビルド工程)
- Phase 3: 自己評価→自己改善のバッチループ(熟成)
- Phase 4: AIユーザーテスト環境「Pub」とリーダーボード
