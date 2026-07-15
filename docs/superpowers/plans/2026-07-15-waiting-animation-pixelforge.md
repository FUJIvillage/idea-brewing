# 待ち工程アニメーション(PixelForge)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書 `2026-07-15-waiting-animation-pixelforge-design.md` の実装。
タップ(ビルド)工程の待ち時間に、新規制作の chill なドット絵ループGIF「真夜中の醸造所」を表示する。

**Repos:** `orca/pixelforge`(アセット・シーン制作)→ `orca/idea-brewing`(GIF同梱・表示)

---

### Task 1: PixelForge — 醸造所アセット5種の手続き的生成

**Files (pixelforge):**
- Create: `tools/make_brewery_assets.py`(`make_assets.py` の save_asset/grid_to_img 様式を踏襲)

- [ ] `bg_brewery_night`(160×90 static: 石壁・梁・窓+夜空・棚・樽)
- [ ] `brew_kettle`(bubble 4F)/ `steam_puff`(rise 6F)/ `brewery_cat`(sleep 4F)/ `oil_lamp`(glow 3F)
- [ ] 各 metadata.json(subject/tags/anchor/animations/provenance)+ `library.py` 再構築
- [ ] スクリプト実行してアセット出力を確認
- [ ] Commit(pixelforge): `feat: 醸造所チルシーン用アセット5種を追加`

### Task 2: PixelForge — シーン合成とGIFレンダリング

**Files (pixelforge):**
- Create: `scenes/brewing_chill.json`(160×90 / 12fps / 48F / scale 3、全レイヤー周期は48の約数)

- [ ] `python tools/render.py scenes/brewing_chill.json` で `out/brewing_chill/brewing_chill.gif` を出力
- [ ] ループの継ぎ目・パレットの琥珀馴染みを目視確認
- [ ] **ユーザーにGIFを提示してchillさのレビューを受ける(ゲート)**
- [ ] `CLAUDE.md` の現状メモを更新
- [ ] Commit(pixelforge): `feat: 真夜中の醸造所チルループシーンを追加`

### Task 3: idea-brewing — GIF同梱とタップパネル表示

**Files (idea-brewing):**
- Create: `public/anim/brewing-chill.gif`(Task 2 の成果物をコピー)
- Modify: `src/components/tap-panel.tsx`(buildProgress 中に進捗テキストの上へ `<img>`)
- Test: `tests/unit/brew-workbench.test.ts`(buildProgress 中に `/anim/brewing-chill.gif` が出る)

- [ ] 表示実装(既存の `border-2 border-[#3a2a12]` 枠様式、altは「醸造中のアニメーション」)
- [ ] 単体テスト追加 → `npx vitest run` / `npx tsc --noEmit` / `npm run lint` 緑
- [ ] Commit: `feat: タップビルド中にドット絵ループアニメを表示`

### Task 4: 検証・ドキュメント・マージ

- [ ] `npm run e2e` 緑(dev サーバー停止確認後)
- [ ] README のタップ節に1行追記(docs-sync)
- [ ] Commit: `docs: READMEにビルド中アニメ表示を追記`
- [ ] 両リポジトリを push(idea-brewing は master 直コミットか要確認)

---

## 実装時の注意

- ドット絵は ASCII グリッドで整数グリッド整列・限定パレットを守る(アンチエイリアス禁止)
- 完全ループ: 各アニメのフレーム数×fps 周期が 48F(4秒)の約数になるよう設計
  (bubble 4F/steam 6F/sleep 4F/glow 3F → 12fps で全て 48F に整合)
- GIF が 200KB を超えたら色数・フレーム数を削る
- pixelforge は Python 3 + Pillow のみで完結させる(ffmpeg は GIF には不要)
