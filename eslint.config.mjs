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
    // ローカル実行で生成されるブリューデータ(タップ工程の生成アプリ・vite build 成果物)は lint 対象外
    "data/**",
    // 生成アプリのひな形は本体の lint 対象外(CommonJS の fake server や vite build の成果物を含む)
    "templates/**",
    // デザインハンドオフの生成バンドル(support.js / ps1-tank.js)は本体の lint 対象外
    "docs/superpowers/specs/design_handoff_ps1_ui/**",
  ]),
]);

export default eslintConfig;
