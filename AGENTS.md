<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ドキュメント整合(README を実態に合わせる)

工程・データ配置・定数・レシピ構成・LLMプロバイダ・Pub/熟成のパラメータなど、**ユーザー向けドキュメント(README.md)に書いてある事実**を変える変更をしたら、同じ作業で `README.md` も更新すること。判断に迷ったら `docs-sync` スキル(`/docs-sync`)を実行すると、README の各記述と source-of-truth ファイルの対応表で差分を洗い出せる。`docs/superpowers/**`(日付入りの設計スナップショット)は据え置きで更新対象外。
