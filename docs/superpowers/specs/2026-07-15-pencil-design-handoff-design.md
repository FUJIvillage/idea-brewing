# Pencil デザイン仕様ハンドオフ

日付: 2026-07-15

## 目的

Pencil モックを画像だけでなく、構造化されたデザイン仕様としてタップビルドへ渡す。
実装エージェントが寸法・余白・配色・文字・コンポーネント階層を推測せずに再現できる状態にする。

## 成果物

Pencil 生成成功後、`data/brews/<id>/design/` に次を保持する。

- `mock.png`: 視覚上の正解（既存）
- `mock.pen`: Pencil 原本（既存）
- `design-spec.json`: `mock.pen` の完全なJSON構造（機械可読仕様）
- `design-handoff.md`: 実装者向け要約

`design-handoff.md` は以下を含む。

- 実装時の優先順位
- トップレベル画面名と寸法
- Pencil variables（色・余白・角丸・フォント等）
- reusable ノードのコンポーネント一覧
- `design-spec.json` の主なプロパティの読み方

## ビルドへの受け渡し

`prepareBatchDir` はモックがある場合、次の3ファイルを `docs/recipe/` へ同梱する。

- `design-mock.png`
- `design-spec.json`
- `design-handoff.md`

既存モックにも対応するため、`design-spec.json` / `design-handoff.md` が未生成でも
`mock.pen` からビルド開始時に自動生成（バックフィル）する。

初回・再開・修理の全プロンプトに以下の優先順位を明記する。

1. `design-handoff.md` を最初に読む
2. 正確な数値・階層・トークンは `design-spec.json` を正とする
3. 見た目・全体構成は `design-mock.png` を正とする
4. レシピとモックが矛盾する場合は、デザインに関してはモック成果物を優先する

## エラー方針

- `mock.pen` がない: デザイン工程は任意なので従来どおりビルド可能
- `mock.pen` が不正JSON: モックがあるのに仕様を渡せないため、明示エラーでビルド準備を止める
- PNGだけの旧データ: PNGは同梱し、仕様成果物は作らない（互換性維持）

## テスト

- `.pen` から完全な `design-spec.json` と要約Markdownが生成される
- variables・画面・reusable components が要約に含まれる
- `prepareBatchDir` が3成果物を同梱する
- 既存 `mock.pen` のバックフィルが動く
- 全ビルドプロンプトに必読指示が含まれる
