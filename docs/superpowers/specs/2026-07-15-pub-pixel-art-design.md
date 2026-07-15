# Pub バーVNのドット絵化 設計書

Date: 2026-07-15
Status: approved(2026-07-15 ユーザー承認)

## Goal

Pub工程のバーVN演出から**ローポリ3D描画(回転バスト+フラットシェーディング+ディザ)を廃止**し、
待ち工程アニメで確立した「真夜中の醸造所」と同じ世界観の**本物のドット絵**に置き換える。

現状の構成(調査済み):

- `src/lib/pub/guest-visual.ts` — 客のローポリ3D描画(buildFigure/renderFigureInto/buildStool)。
  ここだけが3D。seed→traits(髪4種・眼鏡・飲み物3種・体格)/mood の決定論ロジックは既にあり、テスト済み
- `PubBarScene` — canvas 240×150。背景(壁・棚・窓・ネオン・奥の常連)はコード描画の2Dドット風、
  客はローポリ、飲み物(drawDrink)は既にドット絵
- `PubSeatRow` の GuestChip — 同じローポリ描画の静止1コマ
- `PubVnBox` / `PubMeters` / レポート構造 — 描画とは独立(変更不要)

## Non-goals

- VNの構造・情報(セリフ箱・評判看板・メーター・客席チップ・スクショ)の変更
- ペルソナ生成やPub実行ロジックの変更
- 雨・ネオンの維持(醸造所世界観に合わせて夜空+ランタンへ置き換える)

## 方針

### 1. 背景: PixelForge で新規制作(静的PNG)

`bg_pub_bar`(240×150)を PixelForge の手続き的オーサリングで新規制作し、
`public/pub/bar-bg.png` として同梱。`buildBackBuf()` のコード描画背景を置き換える。

内容(醸造所の続きの一角、バーカウンター):

- 石壁+木の梁、棚2段に色とりどりの酒瓶(現行踏襲)
- 窓+夜空・三日月・星(雨はやめて醸造所と統一)
- 吊りランタン、木の看板(ネオンの代替)
- 奥の常連2人はドット絵シルエットとして背景に焼き込む
- 手前のカウンターも背景に含める(客・飲み物はカウンター手前に重ねるため、
  カウンター天板のY座標をアセットのmetadataに記録)

### 2. 客: guest-visual.ts をドット絵描画に書き換え

- **維持**: `guestSeed` / `guestTraits` / `moodFromResult` の決定論API(既存テストも維持)
- **置き換え**: `buildFigure`/`renderFigureInto`/`buildStool`(3D)を廃止し、
  - `buildGuestGrid(seed, mood, frame): string[]` — 客のバスト(約28×32)を
    色キー文字列グリッドで返す**純関数**(canvas非依存・単体テスト対象)。
    特徴は現行踏襲: 髪4種(短髪/お団子/ポニテ/帽子)・眼鏡・体格差+
    肌5/髪6/服6/差し色5 の既存パレットを db32 寄りに量子化して使用。
    mood で表情が変わる(happy=笑顔+頬、meh=真顔、gone は描かない)
  - `drawGuestInto(ctx, grid, x, y, scale)` — グリッドを fillRect で描く薄いブリッター
  - `buildStoolGrid(): string[]` — 空きスツール(中断した客)のドット絵
- **アニメ**: 回転の代わりに、呼吸(1pxボブ)2フレーム+数秒ごとの瞬き
  (時刻tから決定論的に算出)。`prefers-reduced-motion` では静止(現行踏襲)
- `drawDrink` は既にドット絵なので継続使用

### 3. PubBarScene / GuestChip の配線

- `PubBarScene`: 背景PNGを一度ロードして使い回し(ロード完了まで `#080402` 塗り)。
  ランタンの明滅・客の呼吸/瞬きだけを requestAnimationFrame で上描き
  (現行と同じループ構造・reduced-motion対応)
- `GuestChip`: `buildGuestGrid` の静止フレームを小さく描く(構造は現行のまま)
- 評判看板・mood記号・ビネットのDOMオーバーレイは無変更

## テスト

- 単体: `buildGuestGrid` — seed差分で髪型・眼鏡が変わる/moodで口が変わる/
  グリッド寸法とパレットキーの妥当性/`buildStoolGrid`。既存の seed/traits/mood テストは維持
- 既存 `guest-visual.test.ts` の3D関数向けテストがあれば置き換え
- E2E: 既存ハッピーパス(Pub含む)がそのまま緑

## リスク

- ローポリのbuild系関数を消すため、参照箇所(PubBarScene/GuestChip)を同時に更新する
  (tscが漏れを検出する)
- 背景PNGの非同期ロード: ロード前フレームは無地なので体感差なし(1フレーム程度)

## 実装順序

1. PixelForge: `bg_pub_bar`(240×150)制作 → PNG目視レビュー
2. guest-visual.ts のドット絵化(純関数+ブリッター)+単体テスト
3. PubBarScene / GuestChip 配線 + 全体検証(tsc/lint/vitest/e2e)
4. README(Pub節の演出説明を1行更新)+ 両リポジトリ push
