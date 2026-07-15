# 待ち工程のドット絵ループアニメーション(PixelForge連携)設計書

Date: 2026-07-15
Status: approved(2026-07-15 ユーザー承認)

## Goal

長い待ちが発生する工程で、テキスト進捗だけでなく chill なドット絵ループアニメーションを表示し、
待ち時間の体験を良くする。アニメはユーザーのプロダクト **PixelForge**
(`C:\Users\fmura\orca\pixelforge`、シーンJSON→ループGIFの決定的レンダリング)で制作する。

まずは **1工程 = タップ(ビルド)** で試す。ビルドは数分〜数十分かかる最長の待ちで、
現状はテキスト進捗(`生成: タスク 3/12` 等)のみのため効果が最も分かりやすい。

## Non-goals

- 他工程(マッシュ/煮沸/レシピ/デザイン/熟成/Pub)への展開(試行の結果を見てから)
- ランタイムでの PixelForge 実行(GIFは事前生成した静的ファイルを同梱する。Python/ffmpeg への実行時依存なし)
- 既存 PixelForge アセットの使用(**全アセット新規制作**がユーザー要件)
- MP4/APNG対応(GIFで十分軽い)

## シーンコンセプト: 「真夜中の醸造所」(chill)

idea-brewing の PS1風・琥珀色UI(背景 `#150d05` / 金 `#f5b94a`)に合わせた暖色ドット絵。
全レイヤーがループ周期の公倍数で完全ループする(継ぎ目なし)。

- 石壁と木の梁の醸造室。窓の外は夜空、星がまばらに瞬く
- 銅の醸造ケトルがコポコポと静かに泡立つ(= ビルド中のメタファー)
- ケトルから蒸気がゆっくり立ち上って消える
- 樽の上で猫が丸くなって寝息を立てる(chill の主役)
- オイルランプが柔らかく明滅する

パラメータ目安: キャンバス 160×90 / 12fps / 48フレーム(4秒ループ)/ `scale: 3`(出力 480×270)。
GIF想定サイズ: 50〜150KB。

## PixelForge 側(リポジトリ: `orca/pixelforge`)

既存の手続き的オーサリング様式(`make_assets.py` の ASCIIグリッド+`save_asset`)に従い、
新規スクリプトで**新アセット5種**を作る:

| アセットID | 種別 | アニメ |
|---|---|---|
| `bg_brewery_night` | 背景 160×90(窓・石壁・梁・棚・樽) | static |
| `brew_kettle` | 銅ケトル(泡つき) | `bubble` 4F ループ |
| `steam_puff` | 蒸気 | `rise` 6F ループ(上昇して消える) |
| `brewery_cat` | 丸まって寝る猫 | `sleep` 4F ループ(呼吸+尻尾) |
| `oil_lamp` | オイルランプ | `glow` 3F ループ(明滅) |

成果物:

- `tools/make_brewery_assets.py` — 上記5種を生成(パレットは `make_assets.py` 同様の
  夜向け限定パレット+琥珀寄りの暖色。`library.py` で索引再構築)
- `scenes/brewing_chill.json` — 合成シーン(全レイヤー周期の公倍数=48Fで完全ループ)
- `out/brewing_chill/brewing_chill.gif` — レンダリング結果
- 各 `metadata.json` は既存様式(subject/tags/anchor/animations/provenance)に従う
- `CLAUDE.md` の現状メモを1行更新(醸造所シーン追加)

## idea-brewing 側

- `public/anim/brewing-chill.gif` — 生成したGIFをコピーして同梱(gitにコミット)
- `src/components/tap-panel.tsx` — `buildProgress !== null` の間、進捗テキストの上に
  GIFを表示(`<img src="/anim/brewing-chill.gif">`、`ps-design-mock-frame` は使わず
  CRT走査線は乗せたまま=PS1画面の中の映像として馴染ませる。枠は既存の
  `border-2 border-[#3a2a12]` 様式)
- alt テキスト: 「醸造中…」系。`aria-hidden` にはしない
- 熟成中のビルド(maturationProgress の building フェーズ)は対象外(タップタブのビルド進捗のみ。
  展開は次フェーズで判断)
- README: 使い方のタップ節に1行追記(docs-sync)

## テスト

- PixelForge: レンダリングが完走し GIF が出力されること(目視でループ確認)
- idea-brewing 単体テスト: `brew-workbench.test.ts` 様式で、buildProgress 中の
  タップパネルに `/anim/brewing-chill.gif` の `<img>` が出ること
- E2E: 既存ハッピーパスがそのまま緑(フェイクビルドは数秒で終わるため
  アニメ表示の明示検証はしない。壊れないことのみ担保)

## リスク・補足

- GIFのCPU負荷: 480×270・12fpsのGIFは無視できるレベル
- 世界観ズレ: パレットをUIの琥珀基調に寄せて制作(完成GIFを目視レビューしてから統合)
- 他工程への展開は「シーンJSONを1本書いてGIFを足すだけ」になるよう、
  idea-brewing 側は工程非依存の書き方にしない(v1はタップ直書き。抽象化は展開時)

## 実装順序

1. PixelForge: アセット5種 → シーン → GIF レンダリング(ここで目視レビュー)
2. idea-brewing: GIF同梱 + タップパネル表示 + テスト + README
