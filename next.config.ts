import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright はネイティブ資産を含むためサーバーバンドルに含めない
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
