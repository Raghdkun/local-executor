import { describe, expect, it } from "vitest";
import { formatBytes, formatPullLine, PullTracker } from "../../src/ollama/progress.js";

describe("PullTracker", () => {
  it("aggregates multiple layers into one percentage", () => {
    let t = 0;
    const tracker = new PullTracker(() => t);
    tracker.update({ status: "pulling manifest" });
    expect(tracker.snapshot().percent).toBeNull();
    t = 1000;
    tracker.update({ status: "pulling a", digest: "a", total: 1000, completed: 500 });
    tracker.update({ status: "pulling b", digest: "b", total: 1000, completed: 0 });
    const s = tracker.snapshot();
    expect(s.percent).toBe(25);
    expect(s.completedBytes).toBe(500);
    expect(s.totalBytes).toBe(2000);
    expect(s.bytesPerSec).toBe(500);
    tracker.update({ status: "pulling a", digest: "a", total: 1000, completed: 1000 });
    tracker.update({ status: "pulling b", digest: "b", total: 1000, completed: 1000 });
    expect(tracker.snapshot().percent).toBe(100);
  });
});

describe("formatting", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5 MB");
    expect(formatBytes(6.6 * 1024 ** 3)).toBe("6.6 GB");
  });

  it("formats a progress line", () => {
    expect(
      formatPullLine("m", {
        status: "pulling manifest",
        completedBytes: 0,
        totalBytes: 0,
        percent: null,
        bytesPerSec: null,
      }),
    ).toBe("Pulling m: pulling manifest");
    const line = formatPullLine("m", {
      status: "pulling x",
      completedBytes: 1024 ** 3,
      totalBytes: 2 * 1024 ** 3,
      percent: 50,
      bytesPerSec: 20 * 1024 ** 2,
    });
    expect(line).toBe("Pulling m: 50%  1.0 GB / 2.0 GB  20 MB/s");
  });
});
