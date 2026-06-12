import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), ".e2e-data");

export default function globalSetup() {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    path.join(dataDir, "settings.json"),
    JSON.stringify({ provider: "fake", apiKey: "", baseUrl: "", model: "fake" }),
  );
}
