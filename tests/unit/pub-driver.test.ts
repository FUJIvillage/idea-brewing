import { describe, expect, it } from "vitest";
import { isFailureObservation, truncateSnapshot } from "@/lib/pub/driver";
import { createFakePubDriver } from "@/lib/pub/fake-driver";

describe("truncateSnapshot", () => {
  it("上限以下はそのまま", () => {
    expect(truncateSnapshot("abc")).toBe("abc");
  });

  it("8KBを超えると切り詰めて省略注記を付ける", () => {
    const long = "あ".repeat(10_000);
    const out = truncateSnapshot(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("(以下省略)");
  });
});

describe("isFailureObservation", () => {
  it("失敗プレフィックスを判定する", () => {
    expect(isFailureObservation("操作に失敗しました: 要素なし")).toBe(true);
    expect(isFailureObservation("操作に成功しました。")).toBe(false);
  });
});

describe("fake driver", () => {
  it("固定のページ状態を返し、アクションを記録する", async () => {
    const driver = createFakePubDriver();
    await driver.open("/");
    const state = await driver.readState();
    expect(state.title).toContain("フェイク");
    expect(state.elements[0].index).toBe(1);
    const obs = await driver.act({ kind: "click", target: 1, reason: "テスト" });
    expect(obs).toBe("操作に成功しました。");
    expect(driver.actions).toHaveLength(1);
    await driver.screenshot("unused.png"); // 何もしない(例外を投げない)
    await driver.close();
  });
});
