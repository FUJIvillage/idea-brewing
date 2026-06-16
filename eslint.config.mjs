import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".e2e-data/**",
    // 生成アプリのひな形は本体の lint 対象外(CommonJS の fake server や vite build の成果物を含む)
    "templates/**",
  ]),
]);

export default eslintConfig;
