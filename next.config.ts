import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright と Cursor SDK はネイティブ資産を含むためサーバーバンドルに含めない
  serverExternalPackages: ["playwright", "@cursor/sdk"],
};

export default nextConfig;
