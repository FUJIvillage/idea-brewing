import { afterEach, describe, expect, it } from "vitest";
import { resolveEngine, TapNotConfiguredError } from "@/lib/tap/resolve";
import type { Settings } from "@/lib/store/types";

const baseSettings: Settings = {
  provider: "openai",
  apiKey: "",
  baseUrl: "",
  model: "",
  effort: "",
  cursorApiKey: "",
  cursorModel: "composer-2.5",
  cursorEffort: "",
};

afterEach(() => {
  delete process.env.CURSOR_API_KEY;
  delete process.env.IDEA_BREWING_FAKE_BUILD;
});

describe("resolveEngine", () => {
  it("fakeプロバイダではフェイクテンプレートを使う", async () => {
    const resolved = await resolveEngine({ ...baseSettings, provider: "fake" });
    expect(resolved.template).toBe("tap-fake");
  });

  it("環境変数でフェイクビルドに切り替えられる", async () => {
    process.env.IDEA_BREWING_FAKE_BUILD = "1";
    const resolved = await resolveEngine(baseSettings);
    expect(resolved.template).toBe("tap-fake");
  });

  it("Cursorキーが未設定なら設定エラーになる", async () => {
    await expect(resolveEngine({ ...baseSettings, cursorApiKey: "   " })).rejects.toThrow(
      TapNotConfiguredError,
    );
  });

  it("設定キーが空白だけなら環境変数へフォールバックする", async () => {
    process.env.CURSOR_API_KEY = " cursor_env_key ";
    const resolved = await resolveEngine({
      ...baseSettings,
      cursorApiKey: "   ",
      cursorModel: "   ",
    });
    expect(resolved.template).toBe("tap-vite");
  });
});
