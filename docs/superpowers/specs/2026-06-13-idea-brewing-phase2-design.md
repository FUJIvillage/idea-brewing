# idea brewing — 第2版(ビルド工程・タップ)設計書

- 日付: 2026-06-13
- ステータス: 承認済み(設計)
- スコープ: 第2版「レシピ → コード生成(ビルド) → ローカル起動(タップ)」まで
- 前提: 第1版(原料投入 → 仕込み → グリル → レシピ生成)は master にマージ済み

## 1. 概要

レシピ完成済みのブリューに対し「ビルド」を実行すると、Cursor SDK のエージェントがレシピ 7 ファイルを読んで実際に動く Web アプリを生成し、ローカル dev サーバーとして起動・ブラウザで確認できるようにする。醸造メタファーでは、発酵を終えたビールを「タップから注ぐ」工程にあたる。

### 確定済みの方針

- **実行エンジン**: `@cursor/sdk`(TypeScript SDK)をアプリに組み込む。CLI 子プロセス方式は採用しない。
- **生成物のスタック**: Vite + React + TypeScript + Tailwind に固定。スキャフォールドは idea-brewing 側が決定論的に行い、エージェントには「このひな形の上にレシピを実装せよ」と指示する。
- **配置**: 第1版設計書のロードマップどおり `data/brews/<ID>/taps/batch-1/`。フォルダ構造は複数バッチ前提だが、第2版で作るのは 1st バッチのみ(バッチループは Phase 3)。

## 2. 設定の拡張(BYOK)

`Settings` に以下を追加する。既存の `readSettings` はデフォルトマージ方式なので旧 `settings.json` もそのまま読める。

| フィールド | 既定値 | 用途 |
|---|---|---|
| `cursorApiKey` | `""` | Cursor SDK の認証。空のときは環境変数 `CURSOR_API_KEY` にフォールバック |
| `cursorModel` | `"composer-2.5"` | ビルドエージェントのモデル ID |

設定画面に「ビルドエンジン(Cursor)」セクションを追加し、API キー(password 入力)とモデル名を編集できるようにする。LLM プロバイダ設定とは独立しており、ビルドを使わない限り未設定でよい。ビルド開始時にキーが未設定(設定・環境変数とも空)なら 400 を返し、設定画面へ誘導する。

## 3. データモデルの拡張

`Brew`(schemaVersion 1 のまま、新フィールドは省略可能としてストア層でデフォルト補完)に以下を追加する。

```ts
export type BatchStatus = "building" | "succeeded" | "failed" | "cancelled";

export interface BatchRecord {
  number: number;              // 1 始まり。第2版では常に 1
  status: BatchStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;        // 失敗時の要約
}

export interface BuildProgress {
  phase: "preparing" | "generating" | "verifying" | "repairing";
  detail: string;              // 例: "タスク 3/8: 画面実装" "修理ラウンド 1/2"
}

export interface Brew {
  // ...既存フィールド...
  batches: BatchRecord[];      // 既定 []
  buildProgress: BuildProgress | null; // 既定 null
}
```

- `BrewStage` に `"built"` を追加する(`done` = レシピ完成、`built` = 1st バッチのビルド成功)。タンクカードの `STAGE_INFO` にも対応エントリを足す(`done` の percent は 100 のまま、`built` は満タン + 泡演出の差別化)。
- `readBrew` で旧 brew.json に対して `batches: []` / `buildProgress: null` を補完する。

### ディスク配置

```
data/brews/<ID>/
  taps/
    batch-1/
      docs/recipe/        # レシピ 7 ファイルのコピー(エージェントへの入力)
      build.log           # 生成・検証・修理の全ログ(追記式)
      ...                 # Vite アプリ本体(テンプレート + 生成コード)
```

## 4. モジュール構成

| モジュール | 責務 | 依存 |
|---|---|---|
| `lib/tap/engine.ts` | `BuildEngine` インターフェース定義 | なし |
| `lib/tap/cursor-engine.ts` | `@cursor/sdk` による実装(Agent.create → send → dispose) | `@cursor/sdk` |
| `lib/tap/fake-engine.ts` | テスト用フェイク(SDK 非依存で決定論的にファイルを書く) | なし |
| `lib/tap/runner.ts` | `CommandRunner` インターフェース(npm install / tsc / vite build の実行)+ 実実装 + フェイク | `node:child_process` |
| `lib/tap/template.ts` | `templates/tap-vite/` をバッチフォルダへコピー、レシピ同梱 | `lib/store` |
| `lib/tap/index.ts` | ビルドオーケストレータ(準備 → 生成 → 検証 → 修理 → 記録) | 上記すべて |
| `lib/tap/server-manager.ts` | 生成アプリの dev サーバー起動/停止/状態(モジュールスコープの Map) | `node:child_process`, `node:net` |

### 4.1 BuildEngine

```ts
export interface BuildSession {
  send(prompt: string): Promise<{ ok: boolean; summary: string }>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export interface BuildEngine {
  createSession(opts: {
    cwd: string;
    onLog: (line: string) => void;
  }): Promise<BuildSession>;
}
```

- `CursorSdkEngine`: `Agent.create({ apiKey, model, local: { cwd } })`。`send` は `agent.send(prompt)` → `run.stream()` のテキストを `onLog` に流し、`run.wait()` の結果で ok を判定。`CursorAgentError`(起動失敗)と `result.status === "error"`(実行失敗)は区別してメッセージ化する。`dispose` でエージェントを破棄する。
- `FakeBuildEngine`: SDK を呼ばず、cwd に最小限の動くアプリ(後述のフェイクテンプレートに対する追記)を書いて成功を返す。E2E・単体テストで使用。
- エンジン選択: 設定の LLM プロバイダが `"fake"` のとき、または環境変数 `IDEA_BREWING_FAKE_BUILD=1` のときフェイク。それ以外は Cursor SDK。

### 4.2 ビルドオーケストレータ(1 バッチの流れ)

1. **準備(preparing)**: `taps/batch-1/` が既存なら全削除して作り直し(第2版ではバッチ 1 の再ビルド = 上書き)。テンプレートをコピーし、`docs/recipe/` にレシピ 7 ファイルを同梱。`batches[0]` を `building` で記録。
2. **生成(generating)**: エンジンの `createSession(cwd=バッチフォルダ)`。まず全レシピを読ませる初期プロンプト 1 send、続いて `05-implementation-plan.md` のタスクを順に 1 タスク = 1 send(コンテキスト維持)。タスク分解は `05-implementation-plan.md` の第2レベル見出し(`## `)を 1 タスクとして機械的に抽出し(見出し直下の本文をタスク説明として添える)、見出しが 1 つも無ければ「レシピ全体を一括実装」の 1 send にフォールバックする。
3. **検証(verifying)**: `CommandRunner` で `npm install` → `npx tsc --noEmit` → `npx vite build` を順に実行。すべて成功でビルド成功。
4. **修理(repairing)**: 検証失敗時、エラーログ(末尾抜粋)を同じセッションに渡して修正を指示し、再検証。最大 2 ラウンド。それでも失敗なら `failed` で確定し、ログを保存。
5. **記録**: `batches[0]` を `succeeded` / `failed` / `cancelled` で確定し、成功時は `stage: "built"` に遷移。`buildProgress` は必ず `null` に戻す(第1版のレシピ生成と同じ「ゾンビ進捗ゼロ」原則)。

- 進捗は `buildProgress` を `writeBrew` で逐次永続化し、UI は 1 秒ポーリング(第1版で確立済みのパターン)。
- 全ログ(エージェント出力・コマンド出力)は `build.log` に追記し、API でテール取得できるようにする。
- 二重起動防止: モジュールスコープの in-memory `Set<brewId>` で 409(第1版レシピ生成と同じ方式)。
- 中断: UI の「ビルド中断」→ in-memory の中断フラグ + `session.cancel()`。中断後は `cancelled` で確定する。

### 4.3 dev サーバーマネージャ(タップ)

- `start(brewId)`: バッチフォルダの `package.json` の `dev` スクリプトを、空きポート(`node:net` で 5173 から探索)を指定して spawn。`{ child, pid, port, startedAt }` をモジュールスコープ Map に記録。HTTP 応答(最大 30 秒リトライ)を確認してから「稼働中」を返す。
- `stop(brewId)`: 子プロセスツリーを kill(Windows は `taskkill /pid <pid> /T /F`)。
- `status(brewId)`: Map と実プロセス生存確認から `{ running, port }` を返す。
- 同時起動は 1 ブリュー 1 サーバー。Next.js プロセス終了時の残留はベストエフォート(`process.on("exit")` で kill を試みる)とし、README に注意書きを載せる。

## 5. API ルート

| ルート | メソッド | 動作 |
|---|---|---|
| `/api/brews/[id]/tap/build` | POST | ビルド開始。404(ブリュー不在)/ 400(レシピ未生成・Cursor キー未設定)/ 409(ビルド中)。同期実行 + 進捗ポーリング方式 |
| `/api/brews/[id]/tap/cancel` | POST | ビルド中断。実行中なら中断フラグを立てる。実行中でない場合、`building` 残留(クラッシュ痕)があれば `failed` に補正して進捗をクリア(復旧動作)。どちらにも該当しなければ 409 |
| `/api/brews/[id]/tap/server` | GET / POST | GET は `{ running, port }`。POST は `{ action: "start" \| "stop" }`。400(バッチ未成功で start)/ 404 |
| `/api/brews/[id]/tap/log` | GET | `build.log` の末尾 200 行を `{ lines }` で返す |

エラー契約は第1版どおり全ルート `{ error }` JSON。

## 6. UI

- ワークベンチに 5 つ目のタブ「タップ」を追加。活性条件は `recipeGeneratedAt !== null`。
- タップパネルの構成:
  - 未ビルド時: 「ビルド開始(1stバッチ)」ボタン
  - ビルド中: 進捗フェーズ表示(準備 → 生成 → 検証 → 修理)+ ログテール(自動スクロール)+ 「ビルド中断」ボタン
  - 成功時: バッチ情報(所要時間)+ 「注ぐ(サーバー起動)」「止める」ボタン + 稼働中は `http://localhost:<port>` リンク
  - 失敗時: エラー要約 + ログテール + 「再ビルド」ボタン
- ビルド中・サーバー操作中は第1版の busy リフトパターン(`onBusyChange`)でタブ切替を禁止。
- タンクカード: `built` ステージのラベルは「提供中(ビルド済み)」。

## 7. テンプレート

`templates/tap-vite/` をリポジトリに同梱(ビルド時コピーの原本)。

- Vite + React + TypeScript + Tailwind v4(`@tailwindcss/vite`)の最小構成。`npm run dev -- --port <n>` で起動可能。
- `src/App.tsx` はプレースホルダ 1 画面(「ここにレシピが注がれます」)。エージェントがこれを置き換える。
- `package.json` の依存はバージョン固定(ビルド再現性優先)。
- E2E・単体テスト用に `templates/tap-fake/` も同梱: 依存ゼロで `dev` スクリプトが `node server.js`(組み込み http で 200 を返す)のもの。フェイクエンジン使用時はこちらをコピーする。npm install 不要で高速・決定論的にタップ起動まで検証できる。

## 8. エラー処理

- Cursor キー未設定でビルド開始: 400 + 設定画面への誘導メッセージ。
- SDK 起動失敗(`CursorAgentError`): ビルドは `failed`。`isRetryable` をメッセージに含める。
- 実行失敗(`result.status === "error"`)・検証失敗(修理上限超過): `failed` + ログ保存。部分生成物は `taps/batch-1/` にそのまま残す(調査可能性優先)。
- ビルド途中のプロセスクラッシュ: in-memory ロックは消えるため再ビルド可能。`building` のまま残った `batches[0]` は、次回ビルド開始時に `failed`(error: "中断されました")へ補正してから上書きする。
- dev サーバー起動失敗(ポート競合・スクリプト異常): `{ error }` で返し、ログテールを UI に表示。

## 9. テスト方針

- **Vitest(単体)**: テンプレートコピーとレシピ同梱、タスク抽出(05 の見出しパース + フォールバック)、オーケストレータの状態遷移(成功 / 検証失敗→修理→成功 / 修理上限→failed / 中断→cancelled、エンジン・ランナーはフェイク)、`building` 残留の補正、サーバーマネージャの起動/停止(フェイクテンプレートを実 spawn)。
- **Playwright(E2E)**: フェイクエンジン + フェイクテンプレートで「レシピ完成済みブリュー → ビルド → 成功表示 → 注ぐ → localhost 応答確認 → 止める」を 1 本。実 SDK を使う検証は手動確認(README に手順記載)。

## 10. スコープ外(Phase 3 以降)

- 自己評価・改善ループ、2nd バッチ以降の生成とバッチ間比較 UI
- スクリーンショットベースの UI/UX 評価
- Pub(AI ユーザーテスト・リーダーボード)
- 工程別モデル使い分け・クラウド実行(SDK の cloud ランタイム)

## 11. 第2版の完了条件

1. レシピ完成済みのブリューで「ビルド開始」→ Cursor SDK がコード生成 → 検証パス → 「注ぐ」で localhost に生成アプリが表示される(実キーでの手動確認)。
2. 検証失敗時に修理ラウンドが走り、上限超過時はログ付きで失敗表示される。
3. フェイクエンジンによる E2E(ビルド → タップ起動 → HTTP 200 → 停止)が通る。
4. 既存の第1版テスト(単体 30 + E2E 1)がすべて通り続ける。
5. 旧 `settings.json` / 旧 `brew.json` がそのまま読める(後方互換)。
