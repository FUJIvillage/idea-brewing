import { describe, expect, it, vi } from "vitest";
import { startPreviewLoop } from "@/lib/design/pencil-cli";
import {
  PREVIEW_MIN_BYTES,
  buildPreviewExportArgs,
  isValidPreviewPngSize,
} from "@/lib/design/preview";

describe("buildPreviewExportArgs", () => {
  it("--in と --export だけを組み立て、--prompt は付けない", () => {
    const args = buildPreviewExportArgs({
      penPath: "/d/design/preview-src.pen",
      outPath: "/d/design/preview.png",
    });
    expect(args).toEqual([
      "--in",
      "/d/design/preview-src.pen",
      "--export",
      "/d/design/preview.png",
      "--export-scale",
      "1",
    ]);
    expect(args).not.toContain("--prompt");
  });
});

describe("isValidPreviewPngSize", () => {
  it("閾値未満は無効、以上は有効", () => {
    expect(isValidPreviewPngSize(0)).toBe(false);
    expect(isValidPreviewPngSize(PREVIEW_MIN_BYTES - 1)).toBe(false);
    expect(isValidPreviewPngSize(PREVIEW_MIN_BYTES)).toBe(true);
    expect(isValidPreviewPngSize(PREVIEW_MIN_BYTES + 100)).toBe(true);
  });
});

describe("startPreviewLoop", () => {
  it("stop 後は export が呼ばれなくなる", async () => {
    vi.useFakeTimers();
    const exportOnce = vi.fn(async () => true);
    const stop = startPreviewLoop({
      designDir: "/tmp",
      key: "k",
      intervalMs: 1000,
      exportOnce,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(exportOnce.mock.calls.length).toBeGreaterThanOrEqual(1);
    const callsAtStop = exportOnce.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(exportOnce.mock.calls.length).toBe(callsAtStop);
    vi.useRealTimers();
  });
});
