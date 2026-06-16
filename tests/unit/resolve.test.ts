import { afterEach, describe, expect, it } from "vitest";
import { resolveEngine, TapNotConfiguredError } from "@/lib/tap/resolve";
import type { Settings } from "@/lib/store/types";

const baseSettings: Settings = {
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: "",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
};

afterEach(() => {
  delete process.env.CURSOR_API_KEY;
  delete process.env.IDEA_BREWING_FAKE_BUILD;
});

describe("resolveEngine", () => {
  it("fakeプロバイダではフェイクテンプレートを使う", () => {
    const resolved = resolveEngine({ ...baseSettings, provider: "fake" });
    expect(resolved.template).toBe("tap-fake");
  });

  it("環境変数でフェイクビルドに切り替えられる", () => {
    process.env.IDEA_BREWING_FAKE_BUILD = "1";
    const resolved = resolveEngine(baseSettings);
    expect(resolved.template).toBe("tap-fake");
  });

  it("Cursorキーが未設定なら設定エラーになる", () => {
    expect(() => resolveEngine({ ...baseSettings, cursorApiKey: "   " })).toThrow(
      TapNotConfiguredError,
    );
  });

  it("設定キーが空白だけなら環境変数へフォールバックする", () => {
    process.env.CURSOR_API_KEY = " cursor_env_key ";
    const resolved = resolveEngine({ ...baseSettings, cursorApiKey: "   ", cursorModel: "   " });
    expect(resolved.template).toBe("tap-vite");
  });
});
