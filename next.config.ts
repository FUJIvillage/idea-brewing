import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright と Cursor SDK はネイティブ資産を含むためサーバーバンドルに含めない
  serverExternalPackages: ["playwright", "@cursor/sdk"],
  // 127.0.0.1 / ポート転送経由だと Host が localhost と食い違い、
  // /_next/* がブロックされてハイドレーションが止まって「読み込み中...」のままになる
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
