import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), ".e2e-data");

export default function globalSetup() {
  // PlaywrightはwebServerをglobalSetupより先に起動するため、Windows/OneDriveでは
  // サーバーが掴んだファイルの削除がEBUSY/EPERMになりうる。リトライで吸収する。
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    path.join(dataDir, "settings.json"),
    JSON.stringify({ provider: "fake", apiKey: "", baseUrl: "", model: "fake" }),
  );
}
