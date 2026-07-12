# idea brewing — 第4版(Pub・AI ユーザーテストとリーダーボード)設計書

- 日付: 2026-07-12
- ステータス: 承認済み(設計)
- スコープ: 第4版「Pub」— AI 客(LLM ペルソナ)による生成アプリの実操作テスト、ブリューごとの Pub レポート、全ブリュー横断のリーダーボード
- 前提: 第3版(熟成・自己評価バッチループ)は master にマージ済み(`a18d528`)

## 1. 概要

ビルド成功済みのバッチに対して「開店」を実行すると、ブリューシートから生成された複数の AI 客(ペルソナ)が Playwright で生成アプリを実際に操作し、自分の目的を達成できたかを試して、客としての評価と感想を残す。醸造メタファーでは、完成したビールを Pub で客に振る舞い、評判を聞く工程にあたる。全ブリューの Pub スコアはリーダーボード(人気ランキング)で横断比較でき、ユーザーはこれをもとに現実世界へのリリース判断を行う。

自己評価(熟成)が「醸造家自身によるルーブリック採点」なのに対し、Pub は「内部基準を知らない客による体験評価」。評価軸も素材も意図的に分離する。

### 確定済みの方針(ユーザー回答)

- **ペルソナ**: 2 系統の併用
  - **自動生成**: LLM がブリューシート(コンセプト・ターゲットユーザー・主要機能)から生成。人数は 0〜5 で指定(既定 3)
  - **常連客(手動定義)**: ユーザーが名前・プロフィール・goals を書いて保存できるグローバルなペルソナリスト(`data/personas.json`)。開店時にチェックボックスで参加させる
  - 1 回の開店の合計人数は 1〜5。生成・常連いずれもレポートに記録される
- **操作方式**: テキストベース。ページの ARIA スナップショット + 操作可能要素の番号付きリストを LLM に渡し、次の 1 手(click / fill / …)を構造化出力で決めさせる。vision 非対応モデルでも動作する(BYOK の互換性優先)。スクリーンショットは記録用にペルソナごとの最終画面 1 枚のみ(失敗許容)
- **評価軸**: Pub 固定 4 軸 —「目的達成」「使いやすさ」「見た目・第一印象」「また来たいか」。ルーブリック(06)は使わない(客は内部基準を知らないという建付け)
- **リーダーボード**: ファイルベース続行(`listBrews` 走査)。Phase 1 設計 §6.2 の「SQLite は Phase 4 で検討」への回答は**見送り** — ローカル数十ブリュー規模では走査で十分。移行条件はスコープ外に記載
- **アーキテクチャ**: サーバー側ジョブ方式(第2・3版と同型:進捗を brew.json に永続化 + UI 1秒ポーリング + インメモリロック/キャンセルトークン)
- **Pub は読み取り専用の工程**: Pub の指摘を次バッチへ反映するのはユーザーが熟成タブで判断する(自動連携は Phase 5 以降)

## 2. データモデルの拡張

`schemaVersion: 1` のまま、新フィールドはストア層でデフォルト補完する(第3版と同じ後方互換方式)。

```ts
export interface PubPersona {
  name: string;        // 例: "忙しい営業のさとみ"
  profile: string;     // 属性・利用文脈・性格
  goals: string[];     // このアプリで達成したいこと(1〜3件)
  origin: "auto" | "saved";   // 自動生成 or 常連客(レポート表示用)
}

export interface SavedPersona {
  id: string;          // UUID
  name: string;
  profile: string;
  goals: string[];     // 1〜3件
}

export interface PubTaskResult {
  goal: string;
  achieved: boolean;
  note: string;        // 達成/断念の経緯
}

export interface PubStep {
  step: number;        // 1始まり
  action: string;      // 例: `click [3] "追加" ボタン`
  observation: string; // 実行結果の要約(遷移・エラーなど)
}

export type PubPersonaStatus = "completed" | "aborted";

export interface PubPersonaResult {
  persona: PubPersona;
  status: PubPersonaStatus;  // aborted = 連続操作失敗・LLM失敗・ステップ上限前の破綻
  taskResults: PubTaskResult[];
  scores: AxisScore[];       // PUB_AXES 固定4軸(型は既存 AxisScore を再利用)
  overall: number;           // 4軸平均(小数1桁)。aborted 時は 0 で集計対象外
  comment: string;           // 客の一言レビュー
  steps: PubStep[];          // 行動ログ
}

export interface PubReport {
  overall: number;                    // completed ペルソナの overall 平均(小数1桁)
  personaResults: PubPersonaResult[];
  summary: string;                    // 店主(ユーザー)向け総括(LLM 生成)
  ranAt: string;
}

export type PubPhase = "opening" | "serving" | "closing";
// opening: サーバー起動+ペルソナ生成 / serving: 接客(操作+評価聴取) / closing: 総括+保存

export interface PubProgress {
  phase: PubPhase;
  detail: string;   // 例: "ペルソナ 2/3「忙しい営業のさとみ」: ステップ 4"
  batch: number;
}

export const PUB_AXES = ["目的達成", "使いやすさ", "見た目・第一印象", "また来たいか"] as const;

export interface BatchRecord {
  // ...既存フィールド...
  pub: PubReport | null;             // 既定 null(旧データはバックフィル)
}

export interface Brew {
  // ...既存フィールド...
  pubProgress: PubProgress | null;   // 既定 null(旧データはバックフィル)
}
```

- `BrewStage` は変更しない(`built` のまま)。タンクカードは Pub 済みなら「Pub X.X」を追記表示
- `readBrew` のバックフィルに `batches[*].pub ?? null` / `pubProgress ?? null` を追加
- ゾンビ進捗ゼロ原則(第3版と同じ): Pub ジョブは終了時に必ず `pubProgress: null` へ戻す。クラッシュ痕は `normalizeStalePub` が補正する

### ディスク配置

```
data/
  personas.json        # 常連客リスト(SavedPersona[]。settings.json と同じ作法)
  brews/<ID>/taps/batch-N/
    pub/
      report.md        # 人間可読レポート(総括 + ペルソナ別評価 + 行動ログ)
      persona-1.png    # ペルソナ最終画面(取得できた場合のみ)
      persona-2.png
```

- `lib/store` に `readPersonas` / `writePersonas` を追加(`readSettings` / `writeSettings` と同型。壊れていれば空配列)。保存上限 20 件、name / profile 必須、goals 1〜3 件をストア層でバリデーション

## 3. モジュール構成

| モジュール | 責務 | 依存 |
|---|---|---|
| `lib/pub/personas.ts` | ペルソナ自動生成(LLM。ブリューシートの concept / targetUsers / features を材料に)+ 常連客の `PubPersona` 変換 | `lib/llm`, `lib/store` |
| `lib/pub/driver.ts` | ブラウザ操作の抽象。ページ状態要約(ARIA スナップショット + 操作可能要素リスト)とアクション実行 | `playwright` |
| `lib/pub/session.ts` | 1 ペルソナのセッション(観察 → 行動ループ → 評価聴取) | `driver`, `lib/llm` |
| `lib/pub/index.ts` | Pub オーケストレータ `runPub` | 上記 + `lib/tap/server-manager` |
| `lib/pub/pub-state.ts` | `pubbingBrews` Set + `pubCancelTokens` Map(依存なし) | — |
| `lib/pub/resolve.ts` | Settings から deps 解決(fake 分岐でフェイクドライバ注入) | `lib/llm`, `lib/pub/driver` |
| `lib/pub/leaderboard.ts` | `listBrews` からランキング構築(純粋関数 + 収集関数) | `lib/store`, `lib/tap/batches` |

既存モジュールの変更(最小限):

- `lib/mature/mature-state.ts` — `isBrewBusy` に `pubbingBrews` を追加(`pub-state.ts` は依存を持たないので循環しない)。これだけでビルド・熟成・レシピ再生成・tap/server 系の既存 409 ガードが Pub 実行中にも効く
- `lib/llm/client.ts` — `LlmTag` に `"pub-persona"` / `"pub-action"` / `"pub-feedback"` / `"pub-summary"` を追加
- `lib/llm/fake-client.ts` — 上記 4 タグの決定論的応答を追加(7 節)

### 3.1 ドライバ(`driver.ts`)

第3版 `screenshot.ts` の DI パターン(`ScreenshotBrowser` / `ScreenshotPage`)を踏襲し、Pub 用に操作可能なページ抽象を定義する。

```ts
export interface PubPageState {
  url: string;
  title: string;
  snapshot: string;              // ARIA スナップショット等のテキスト要約(上限 8KB、超過は省略注記)
  elements: PubElement[];        // 操作可能要素の番号付きリスト
}

export interface PubElement {
  index: number;                 // 1始まり。アクションの target に使う
  kind: string;                  // button / link / textbox / checkbox / select など
  label: string;                 // アクセシブルネーム(なければ近傍テキスト)
  value?: string;                // 入力系の現在値
}

export interface PubDriver {
  open(url: string): Promise<void>;
  readState(): Promise<PubPageState>;
  act(action: PubAction): Promise<string>;   // 実行結果の observation を返す(要素不在などは例外でなく文字列で返す)
  screenshot(filePath: string): Promise<void>;
  close(): Promise<void>;
}
```

- 実装は Playwright(chromium headless)。要素列挙は `button, a, input, textarea, select, [role=button], [role=link], [role=tab]` などの可視要素を走査
- アクション実行後は `networkidle` を上限 10 秒で待ち、超過は observation に「応答なし(タイムアウト)」を記録して続行
- ARIA スナップショット API が利用できない場合は `document.body.innerText` の要約で代替(実装計画で確定)

### 3.2 アクション(LLM の構造化出力)

```ts
export type PubAction =
  | { kind: "click"; target: number; reason: string }
  | { kind: "fill"; target: number; value: string; reason: string }
  | { kind: "select"; target: number; value: string; reason: string }
  | { kind: "press"; key: string; reason: string }        // Enter など
  | { kind: "goto"; path: string; reason: string }        // 同一オリジン内のパスのみ許可
  | { kind: "finish"; reason: string };                   // 客が自発的に切り上げる
```

- `generateObject`(zod)で 1 手ずつ取得。`reason` は行動ログの action 欄に併記
- `goto` は `http://localhost:<port>` 配下のパスのみ許可(外部 URL は拒否して observation にエラーを返す)

### 3.3 セッション(`session.ts`)

1 ペルソナ 1 セッション。流れ:

1. `open("http://localhost:<port>/")`
2. 行動ループ(最大 **15 ステップ**): `readState()` → LLM(`"pub-action"`。system は「あなたは <persona>。goals を達成するために次の 1 手を決めよ。目的を果たすか見込みがなければ finish」)→ `act()` → `PubStep` 記録
   - `finish` で自発終了。上限到達で強制終了(どちらも completed 扱い)
   - アクション実行エラー(要素消滅など)は observation として LLM に見せ自己修正させる。**連続 3 回失敗でセッション中断(aborted)**
   - LLM 呼び出し失敗(構造化出力の再試行込みで失敗)もそのペルソナを aborted にする
3. 評価聴取(completed のみ): 行動ログ全体 + goals を渡し、`"pub-feedback"` で構造化出力
   - zod スキーマは固定キー `{ taskResults: { achieved, note }[](goals と同数・同順), scores: { purpose, usability, looks, revisit }(1〜5 整数), comment }`
   - アプリ側で `PUB_AXES` の固定名にマップして `AxisScore[]` に変換し、`overall` を計算(LLM に計算させない — 第3版と同じ)
4. 最終画面を `pub/persona-k.png` に保存(失敗しても無視)

## 4. Pub オーケストレータ(`lib/pub/index.ts`)

`runPub(brew, deps, { personaCount })` — サーバー側で完結し、進捗を `pubProgress` として `writeBrew` で逐次永続化する。

```ts
export interface PubDeps {
  client: LlmClient;
  startServer: (brewId: string, batch: number) => Promise<{ port: number }>;
  stopServer: (brewId: string) => Promise<void>;
  createDriver: () => Promise<PubDriver>;
  cancel?: CancelToken;
  onProgress?: (brew: Brew) => Promise<void> | void;
}
export interface PubOptions {
  autoCount: number;            // 自動生成の人数(0〜5、既定 3)
  savedPersonas: SavedPersona[]; // 参加する常連客(ルート層で ID から解決済み)
}
// 合計人数(autoCount + savedPersonas.length)は 1〜5。範囲外はルート層で 400
```

1. **opening**: 対象 = 最新成功バッチ(`latestSucceededBatch`)。稼働中の dev サーバーがあれば停止 → `startServer(brewId, batch)` → ペルソナ確定(常連客を `PubPersona`(origin: "saved")に変換 + `autoCount > 0` なら `"pub-persona"` で自動生成。自動生成があるのにブリューシート欠落ならエラー)
2. **serving**: ペルソナごとに**直列**でセッション実行(ポート・プロセス競合と LLM レート制限を避けるため並列化しない)。`pubProgress.detail` に「ペルソナ k/N「名前」: ステップ s」を反映
   - ペルソナ単位の失敗許容: aborted になっても次のペルソナへ続行
3. **closing**: `"pub-summary"` で総括(改善のヒントより「客の評判」の要約に寄せる)→ `PubReport` を確定 → `batches[N].pub` に保存 + `pub/report.md` 書き出し → `pubProgress: null`
4. `finally` で必ず `stopServer`

- **completed ペルソナが 0 件なら Pub 全体を失敗**にする(レポート未保存)
- 同一バッチへの再実行は上書き(評価の再評価と同じ扱い。スクリーンショット・report.md も上書き)
- サーバー起動失敗は Pub 失敗(スクリーンショットと違い、実操作が工程の本体なので続行不能)
- キャンセルトークンはステップ間・ペルソナ間・フェーズ間でチェック。中断時はレポート未保存で `pubProgress: null`(前回の `batches[N].pub` は無傷)
- `normalizeStalePub(brew)`: `pubProgress` 残留 + 実行ロックなし → `null` に補正。Pub 系 POST 入口と cancel で適用(第2・3版の stale 補正と同型)

### 4.1 リーダーボード(`leaderboard.ts`)

```ts
export interface LeaderboardEntry {
  brewId: string;
  name: string;
  batch: number;          // Pub レポートを持つ最新バッチ
  pubOverall: number;
  selfOverall: number | null;   // 同バッチの自己評価(あれば)
  personaCount: number;
  ranAt: string;
}
export function buildLeaderboard(brews: Brew[]): LeaderboardEntry[];  // 純粋関数
```

- 対象 = 各ブリューの「`pub` を持つ最大番号のバッチ」。Pub 未実施のブリューは載せない
- `pubOverall` 降順(同点は `ranAt` 新しい順)
- 永続化は追加しない(`listBrews` 走査で毎回構築)

## 5. API ルート

| ルート | メソッド | 動作 |
|---|---|---|
| `/api/brews/[id]/pub/run` | POST | `{ autoCount?, savedPersonaIds? }`(autoCount は 0〜5 の整数・既定 3、savedPersonaIds は保存済み ID の配列・既定 []。合計 1〜5 の範囲外・未知 ID は 400)。404(ブリュー不在)/ 400(成功バッチなし・自動生成ありでシート欠落)/ 409(ビルド・熟成・Pub 実行中) |
| `/api/personas` | GET / PUT | 常連客リストの取得 / 全置換(settings と同じ作法)。PUT はストア層バリデーション違反で 400。id は新規要素ならサーバー側で採番 |
| `/api/brews/[id]/pub/cancel` | POST | Pub 中断。実行中でなく `pubProgress` 残留があれば `null` に補正(復旧動作)。どちらでもなければ 409 |
| `/api/brews/[id]/pub/report?batch=N` | GET | `{ markdown, report, screenshots: ["persona-1.png", ...] }`。batch バリデーション + 404 |
| `/api/brews/[id]/pub/screenshot?batch=N&name=persona-1.png` | GET | PNG を返す。`name` はホワイトリスト方式(`persona-[1-5].png` のみ) |
| `/api/pub/leaderboard` | GET | `{ entries: LeaderboardEntry[] }` |

- エラー契約は既存どおり全ルート `{ error }` JSON(400 / 404 / 409 / 500)。`LlmNotConfiguredError` は 400 + `code: "not_configured"`
- run は同期実行 + 進捗ポーリング方式(ビルド・熟成と同じ)。UI は `pubProgress` を 1 秒ポーリング
- run 入口で `normalizeStaleBatch(normalizeStaleMaturation(normalizeStalePub(brew)))` を適用し、ロックは `pubbingBrews.add / finally delete`(熟成ルートと同型)

## 6. UI

### 6.1 「Pub」タブ(PubPanel)

活性条件: 成功バッチが 1 つ以上あること。構成:

- **開店フォーム**: 自動生成の人数(0〜5、既定 3)+ 常連客のチェックボックスリスト(保存済みから選択)+「開店する」ボタン(合計 0 人なら非活性)。対象バッチ(最新成功バッチ番号)を明記
- **常連客の管理**: Pub タブ内の折りたたみセクション。一覧(名前・プロフィール・goals)+ 追加・編集・削除フォーム。`/api/personas` の GET / PUT で保存
- **実行中**: フェーズ表示(開店準備 → 接客中 → 閉店作業)+ `detail` + 「中断」ボタン(`aria-live="polite"`、熟成タブと同じ作法)
- **レポート**: Pub 済みバッチを選択して表示
  - 総合スコア「X.X / 5.0」+ 総括(summary)
  - ペルソナカード: 名前(常連客なら「常連」バッジ)・プロフィール・4 軸スコア・一言レビュー・タスク結果(達成 ○/✕ と経緯)・最終画面サムネイル(クリックで原寸)・行動ログ(折りたたみ、`<details>`)
  - aborted のペルソナは「中断」バッジ + 経緯のみ(スコア非表示)
- スタイルは既存の amber 系 Tailwind 規約に従う(`mature-panel.tsx` がひな型)

### 6.2 リーダーボード(新ページ `/leaderboard`)

- ホーム(タンク一覧)のヘッダーに「リーダーボード」リンクを追加
- 表: 順位・ブリュー名・バッチ番号・Pub スコア・自己評価スコア・客数・実施日時。行クリックでブリューのワークベンチへ
- 上位 3 位は装飾(🍺 メダル等、実装時の裁量)。Pub 未実施のブリューは載せず、表下に「未開店のブリュー N 件」と件数だけ示す
- サーバーコンポーネントで `GET /api/pub/leaderboard` 相当を直接構築してよい(既存ページの作法に合わせて実装計画で確定)

### 6.3 既存 UI の変更

- `BrewWorkbench`: `TABS` に「Pub」を追加(熟成の右)。`pubProgress !== null` のとき Pub タブを強制表示 + 全タブロック(`tabsBusy` に `pubProgress` を追加)
- タンクカード: Pub 済みなら stageLabel に「Pub X.X」を追記

## 7. フェイク実装(テスト用)

- `FakeClient` に 4 タグを追加(すべて決定論的):
  - `"pub-persona"`: 要求人数ぶんの固定ペルソナ(「常連客1」「常連客2」…、goals 各 2 件)
  - `"pub-action"`: 1 手目は `click`、2 手目は `finish`(カウンタ制御。呼び出し記録 `calls` で検証可能)
  - `"pub-feedback"`: 1 人目は 4 点台、2 人目以降は 3 点台(リーダーボードの順位検証が決定論的になる)
  - `"pub-summary"`: 固定文
- **フェイクドライバ**: `provider: "fake"` または `IDEA_BREWING_FAKE_BUILD=1` のとき、`resolve.ts` が実ブラウザを起動しない `FakePubDriver`(canned な `PubPageState` を返し、`act` は成功 observation を返す)を注入。**サーバー起動・スクリーンショットもスキップ**(第3版の撮影スキップと同じ方針。E2E の実行時間と Playwright 依存を避ける)
- E2E: `happy-path.spec.ts` を延長 —「Pub タブ → 開店する → レポート表示(スコア・ペルソナカード)→ `/leaderboard` にブリューが載る」

## 8. エラー処理

| 事象 | 挙動 |
|---|---|
| 成功バッチなし / 自動生成ありでブリューシート欠落 / 合計人数が 1〜5 の範囲外 / 未知の常連客 ID | run は 400 |
| dev サーバー起動失敗 | Pub 失敗(500 `{ error }`、`pubProgress: null` に戻す) |
| ペルソナ生成の LLM 失敗 | Pub 失敗(同上) |
| セッション中の LLM 失敗・連続 3 回の操作失敗 | そのペルソナを aborted にして続行 |
| completed が 0 件 | Pub 失敗(レポート未保存) |
| スクリーンショット失敗 | 無視(レポートに画像なしと表示) |
| プロセスクラッシュ | `pubProgress` 残留 → 次回の Pub 系 POST または cancel で `null` に補正 |
| 中断 | レポート未保存・`pubProgress: null`・サーバー停止。前回の Pub レポートは無傷 |

## 9. テスト方針

- **Vitest(単体)**:
  - `personas.ts`: ブリューシートからのプロンプト構築、人数指定、シート欠落エラー、常連客の `PubPersona` 変換(origin: "saved")
  - ストア: `readPersonas` / `writePersonas`(破損時の空配列・上限 20・goals 1〜3 のバリデーション)
  - `driver.ts`: 要素列挙・状態要約の上限、アクション実行と observation(Playwright 抽象をフェイク化)、goto の同一オリジン制限
  - `session.ts`: finish / ステップ上限 / 連続失敗 abort / LLM 失敗 abort / 評価聴取の変換(固定軸マップ・overall 計算)
  - オーケストレータ: 正常完走 / ペルソナ部分失敗の続行 / 全滅で失敗 / サーバー起動失敗 / キャンセル(各フェーズ)/ stale 補正 / 再実行上書き
  - `leaderboard.ts`: ランキング順・同点処理・Pub 未実施の除外・selfOverall の同居
  - API ルート: run / cancel / report / screenshot / leaderboard / personas の 400・404・409 契約、run ボディ(合計人数・未知 ID)、name ホワイトリスト、相互排他(ビルド中・熟成中の run は 409、Pub 中の tap/mature 系は 409)
  - ストア: `readBrew` バックフィル(`pub` / `pubProgress`)
- **Playwright(E2E)**: フェイク構成で「ビルド済み → Pub タブ → 開店 → レポート表示 → リーダーボード表示」を happy-path に追加
- 既存 143 テストがすべて通り続けること

## 10. スコープ外(Phase 5 以降)

- Pub フィードバックの熟成への自動連携(客の不満を改善指示に変換して次バッチへ)
- 常連客のインポート/エクスポート・ブリューごとの常連客プリセット
- バッチ間の Pub 結果比較・スコア推移グラフ
- SQLite 移行(ブリュー数の増加で `listBrews` 走査が遅くなった場合の再検討事項として明記)
- マルチページ SPA の深い操作(ファイルアップロード・ドラッグ&ドロップ等の高度なアクション)
- 実ユーザー向けの公開・デプロイ機能

## 11. 第4版の完了条件

1. ビルド済みブリューで「開店する」→ AI 客がアプリを実操作し、ペルソナ別の 4 軸スコア・一言レビュー・タスク結果・行動ログ・最終画面つきの Pub レポートが表示・保存される(実キーでの手動確認)
2. 常連客を保存し、開店時に自動生成と組み合わせて参加させられる(レポートに「常連」表示)
3. 複数ブリューで Pub 実施後、`/leaderboard` に Pub スコア降順で並び、行クリックでワークベンチに飛べる
4. ペルソナ 1 体が破綻しても残りの客で完走し、全滅時のみ Pub が失敗する
5. 中断・クラッシュ復旧(stale 補正)・相互排他(ビルド / 熟成 / tap サーバー操作と互いに 409)が機能する
6. vision 非対応モデルでも Pub が完走する(操作はテキストベースのみで成立)
7. フェイク構成の E2E(開店 → レポート → リーダーボード)が通る
8. 既存の第1〜3版テストがすべて通り続け、旧 brew.json がそのまま読める(`pub` / `pubProgress` のバックフィル)
