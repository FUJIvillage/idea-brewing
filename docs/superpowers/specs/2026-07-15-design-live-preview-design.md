# デザインモック生成中のライブプレビュー

日付: 2026-07-15

## 背景

デザイン工程は完了まで「生成中…(経過秒)」のみで、作成過程の画面が見えない。
ユーザーは途中プレビュー（ログではなく画像）を約10〜15秒間隔で見たい。
最初の有効フレームまではプレースホルダ。

## 決定

方針: **並列エクスポート**（生成本体の Pencil プロセスとは別に、周期的に `mock.pen` → PNG）

非採用:
- ログ連動エクスポート（ログ形式依存）
- Pencil interactive + `get_screenshot`（現行 one-shot 構成の大幅変更）

## 要件

1. 生成中に途中モック画像を表示する（エージェントログは出さない）
2. 更新間隔の目安は **12秒**（10〜15秒帯）
3. 有効フレームが出るまでは「キャンバス準備中…」+ 経過時間
4. 最終成果物は従来どおり `mock.png`。途中用は別ファイル
5. プレビュー失敗は生成失敗にしない（前回フレーム維持 / プレースホルダ継続）
6. キャンセル・完了でプレビューループを止める

## アーキテクチャ

```text
POST /design/generate
  ├─ runPencil(... --out mock.pen --export mock.png ...)   // 本体
  └─ preview loop (12s):
       mock.pen をコピー → 別 HOME で
       pencil --in <copy> --export preview.png
UI (generating 中)
  └─ 2〜3秒ごとに GET /design/preview
       200 → <img>
       404 → プレースホルダ
```

### なぜ別 HOME か

Pencil CLI は `~/.pencil/socket/pencil-cli.sock` を使う。
本体と同時起動するとソケットが衝突するため、プレビュー用プロセスは
`HOME=<designDir>/.preview-home` など隔離する。

### ファイル

| パス | 役割 |
|---|---|
| `design/mock.pen` | 本体が更新し続けるデザイン |
| `design/mock.png` | 最終書き出し（既存） |
| `design/preview.png` | 途中プレビュー（本機能） |
| `design/.preview-home/` | プレビュー用 HOME（gitignore 対象でも可、data 配下） |

### 有効フレーム

`preview.png` が存在し、サイズが **1024 bytes 以上**（空に近い失敗出力を除外）。

## API

```text
GET /api/brews/[id]/design/preview  … preview.png (image/png, no-store)
```

- 無い / 無効サイズ: 404 `{ error: "プレビューがありません。" }`
- 認証・ロック不要（既存 mock GET と同じ）

## UI

`DesignPanel` の生成中ブロック:

- 経過時間 + 中断ボタン（既存）
- 有効プレビュー前: プレースホルダ文言「キャンバス準備中…」
- 有効後: `<img src=/api/brews/.../design/preview?t=...>` を 2〜3 秒ポーリングで更新
- 完了後は既存どおり `mock` エンドポイントの最終画像

## フェイクモード

`generateFakeMock` 中に短い間隔で `templates/design-fake/mock.png` を `preview.png` にコピーしてから最終 `mock.png` を書く（E2E/手元でプレビュー経路を触れられるようにする）。所要は数秒でよい。

## テスト

- 単体: プレビュー引数組み立て、有効サイズ判定、preview GET 404/200
- 単体: プレビューループが cancel で止まること（タイマー/モック）
- E2E(fake): 生成中に preview が 200 になる、または完了前にプレースホルダ→画像の遷移が観測できること（タイミングは緩め）

## エッジケース

| ケース | 挙動 |
|---|---|
| `mock.pen` 未作成 | その周期はスキップ |
| プレビュー export 失敗 | ログに残すが生成は継続。UI は前回 or プレースホルダ |
| 前の export がまだ実行中 | 次周期をスキップ（多重起動しない） |
| 生成キャンセル | ループ停止。preview.png は残ってよい |
| 再生成開始 | 古い preview.png を削除してから開始 |

## 非目標

- エージェント発言のライブ表示
- 1秒未満のリアルタイム描画
- 熟成/タップへの波及
