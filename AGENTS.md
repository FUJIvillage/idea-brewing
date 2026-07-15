<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ドキュメント整合(README を実態に合わせる)

工程・データ配置・定数・レシピ構成・LLMプロバイダ・Pub/熟成のパラメータなど、**ユーザー向けドキュメント(README.md)に書いてある事実**を変える変更をしたら、同じ作業で `README.md` も更新すること。判断に迷ったら `docs-sync` スキル(`/docs-sync`)を実行すると、README の各記述と source-of-truth ファイルの対応表で差分を洗い出せる。`docs/superpowers/**`(日付入りの設計スナップショット)は据え置きで更新対象外。

## Cursor Cloud specific instructions

- Services & standard commands are documented in `README.md` and `package.json` scripts (`dev`/`build`/`lint`/`test`/`e2e`). Deps are installed by the startup update script (`npm install` + `npx playwright install chromium`).
- Run with **no API keys**: set the LLM provider to `fake`. Easiest way is to point the app at a scratch data dir and pre-seed settings, e.g. `IDEA_BREWING_DATA_DIR=/tmp/idea-data` with `{"provider":"fake",...}` in `settings.json` (see `tests/e2e/global-setup.ts`), and set `IDEA_BREWING_FAKE_BUILD=1` so the tap/build/eval/pub/design steps use the fake engine instead of the Cursor SDK / Pencil CLI. This makes the whole flow deterministic and offline.
- `npm run e2e` starts its own dev server (port 3105). Next 16 forbids two `next dev` in the same project dir, so **stop any running `npm run dev` before running e2e** (README notes this too).
- Unit tests (`npm run test`, Vitest) need no browser or keys.
