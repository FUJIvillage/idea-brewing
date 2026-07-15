import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamLogBuffer } from "@/lib/tap/stream-log-buffer";

afterEach(() => {
  vi.useRealTimers();
});

describe("createStreamLogBuffer", () => {
  it("改行までの断片はまとめて1行にする", () => {
    const lines: string[] = [];
    const buf = createStreamLogBuffer((line) => lines.push(line));

    buf.push("完");
    buf.push("了・評価");
    buf.push("フローを実装します。\n");
    buf.push("次の行");

    expect(lines).toEqual(["完了・評価フローを実装します。"]);
    buf.flush();
    expect(lines).toEqual(["完了・評価フローを実装します。", "次の行"]);
  });

  it("改行が来なくてもアイドル後にまとめてflushする", () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const buf = createStreamLogBuffer((line) => lines.push(line), { idleMs: 200 });

    buf.push("完");
    buf.push("了");
    buf.push("・");
    expect(lines).toEqual([]);

    vi.advanceTimersByTime(199);
    expect(lines).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(lines).toEqual(["完了・"]);
  });

  it("長すぎる断片は改行がなくても分割flushする", () => {
    const lines: string[] = [];
    const buf = createStreamLogBuffer((line) => lines.push(line), { maxChars: 10 });

    buf.push("あいうえおかきくけこさしすせそ");
    expect(lines).toEqual(["あいうえおかきくけこ"]);
    buf.flush();
    expect(lines).toEqual(["あいうえおかきくけこ", "さしすせそ"]);
  });

  it("空白だけの断片は記録しない", () => {
    const lines: string[] = [];
    const buf = createStreamLogBuffer((line) => lines.push(line));
    buf.push("   \n");
    buf.push("\n");
    buf.flush();
    expect(lines).toEqual([]);
  });
});
