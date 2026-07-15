# Pub バーVNドット絵化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設計書 `2026-07-15-pub-pixel-art-design.md` の実装。
客のローポリ3D描画をドット絵に置き換え、背景を PixelForge 製の静的PNGにする。

---

### Task 1: PixelForge — bg_pub_bar(240×150)制作

**Files (pixelforge):**
- Modify: `tools/make_brewery_assets.py`(`bg_pub_bar` 追加。石壁/梁/棚の酒瓶2段/窓+夜空・三日月・星/吊りランタン/木の看板/奥の常連シルエット2人/カウンター。counter_y を metadata に記録)

- [ ] 生成して目視確認(**ユーザーレビューゲート**)
- [ ] Commit(pixelforge)+ push

### Task 2: guest-visual.ts のドット絵化

**Files (idea-brewing):**
- Rewrite: `src/lib/pub/guest-visual.ts`
  - 維持: `guestSeed` / `guestTraits` / `moodFromResult` / `drawDrink` / パレット(db32寄りに量子化)
  - 追加: `buildGuestGrid(seed, mood, frame): string[]`(純関数・約28×32)/
    `buildStoolGrid(): string[]` / `drawGridInto(ctx, grid, x, y, scale)`
  - 削除: `buildFigure` / `buildStool` / `renderFigureInto` / ringFaces等の3D一式 /
    ditherPattern / BAYER(バーシーン側で不要になれば)
- Test: `tests/unit/guest-visual.test.ts`(seed差分で髪・眼鏡が変わる/moodで口が変わる/
  フレームで呼吸差分/寸法・使用色キー検証。3D向けテストは置き換え)

- [ ] 失敗するテストから TDD
- [ ] Commit

### Task 3: PubBarScene / GuestChip 配線

**Files (idea-brewing):**
- Modify: `src/components/pub/pub-bar-scene.tsx`(buildBackBuf→`/pub/bar-bg.png` ロード、
  renderFigureInto→drawGridInto、雨・ネオン描画を削除しランタン明滅+瞬きに置換)
- Modify: `src/components/pub/pub-seat-row.tsx`(GuestChip をグリッド描画に)
- Create: `public/pub/bar-bg.png`(Task 1 の成果物)

- [ ] `npx tsc --noEmit` で3D関数の参照漏れゼロを確認
- [ ] `npm run lint` / `npx vitest run` 緑
- [ ] Commit

### Task 4: 検証・README・push

- [ ] `npm run e2e` 緑(dev サーバー停止確認後)
- [ ] README の Pub 節の演出記述を更新(docs-sync)
- [ ] Commit + 両リポジトリ push(リモート先行時は pull→検証→push)
