# Token Usage UI Design

日付: 2026-07-15

## ゴール

ブリュー詳細のヘッダー付近に、各工程で消費した LLM トークン(入力 / 出力 / 合計)とその全体合計を常時表示する。

## 決定事項

| 項目 | 選択 |
|---|---|
| 配置 | ブリュー詳細ヘッダー付近(タブ直上/直下) |
| 粒度 | 工程ごとに input / output / total |
| 対象 | LLM 工程 + Cursor/Pencil で取れるもの |
| 集計 | そのブリュー内で累積 |
| 永続化 | `brew.json` の `tokenUsage` |

## データモデル

```ts
interface TokenCounts {
  input: number;
  output: number;
  total: number;
}

type UsageStageKey =
  | "mash"      // 仕込み
  | "boil"      // 煮沸 (boil-next + boil-apply)
  | "recipe"    // レシピ生成
  | "evaluate"  // 熟成評価
  | "pub"       // Pub 全 LLM 呼び出し
  | "tap"       // Cursor ビルド(取れた場合のみ)
  | "design";   // Pencil(トークンが取れた場合のみ)

interface BrewTokenUsage {
  byStage: Partial<Record<UsageStageKey, TokenCounts>>;
}

// Brew に追加
tokenUsage: BrewTokenUsage | null;
```

- 未計測の工程はキー欠落とみなし、UI では「—」
- `total` は呼び出し側で `input + output` を正規化した値を保存(プロバイダが total を返さない場合も同様)
- 旧 `brew.json`(フィールドなし)は `readBrew` で `tokenUsage: null` に補完

## LLM → 工程マッピング

| `LlmTag` | `UsageStageKey` |
|---|---|
| `mash` | `mash` |
| `boil-next`, `boil-apply` | `boil` |
| `recipe` | `recipe` |
| `evaluate` | `evaluate` |
| `pub-persona`, `pub-action`, `pub-feedback`, `pub-summary` | `pub` |
| `connection-test` | 記録しない |

## 取得経路

### AI SDK(仕込み〜Pub)

`LlmClient.generateObject` / `generateText` が `{ value, usage }` を返すよう変更する。AI SDK の `usage` から `inputTokens`/`outputTokens`(別名 `promptTokens`/`completionTokens` にも対応)を正規化する。

各パイプライン(`runMash` 等)は結果反映後に `addTokenUsage(brew, stage, usage)` で累積する。

### Cursor(タップ)

SDK の run 結果にトークン相当があれば `tap` に加算。無ければキーを付けず UI は「—」。

### Pencil(デザイン)

`usage.json` にトークンが無ければ `design` は「—」(既存の `costUsd` 表示はデザインタブ側のまま。ヘッダーのトークン表には混ぜない)。

### Fake

決定論的な固定 usage を返し、E2E/単体でヘッダー文言を検証できる。

## UI

- コンポーネント: `TokenUsageBar`(PS1 調の既存スタイルに合わせる)
- 場所: `BrewWorkbench` のタイトル行〜タブラインの間
- 表: 工程ラベル × 入力 / 出力 / 合計。最終行または右端に全工程合計
- 消費が一度も無い場合(`tokenUsage` が null/空):「まだトークン消費なし」程度の短い案内
- ポーリング/refresh で `brew` が更新されれば自動反映(追加 API は不要)

工程ラベル(日本語):

- mash → 仕込み
- boil → 煮沸
- recipe → レシピ
- evaluate → 熟成
- pub → Pub
- tap → タップ
- design → デザイン

## テスト

- `addTokenUsage` / tag→stage / usage 正規化の単体
- AI SDK / fake client が usage を返すこと
- `readBrew` / `createBrew` が `tokenUsage` を扱うこと
- ヘッダーコンポーネントの表示(ゼロ・一部のみ・合計)

## ドキュメント

README のデータ配置 / 使い方に「工程別トークン消費がヘッダーに表示される」旨を追記する。

## 非ゴール

- コスト($)換算
- 呼び出しごとの詳細ログ
- 設定画面での全体集計
- トークン上限アラーム
