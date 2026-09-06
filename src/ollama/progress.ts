import type { PullEvent } from "./client.js";

/**
 * Ollama's pull stream reports one line per layer with its own total/completed.
 * This tracker folds those into a single percentage and a human-readable line.
 */
export interface PullSnapshot {
  status: string;
  completedBytes: number;
  totalBytes: number;
  /** 0–100, or null before any sizes are known. */
  percent: number | null;
  bytesPerSec: number | null;
}

export class PullTracker {
  private readonly layers = new Map<string, { total: number; completed: number }>();
  private status = "starting";
  private readonly startedAt: number;
  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
    this.startedAt = now();
  }

  update(e: PullEvent): PullSnapshot {
    if (e.status) this.status = e.status;
    if (e.digest && typeof e.total === "number") {
      this.layers.set(e.digest, { total: e.total, completed: e.completed ?? 0 });
    }
    return this.snapshot();
  }

  snapshot(): PullSnapshot {
    let total = 0;
    let completed = 0;
    for (const l of this.layers.values()) {
      total += l.total;
      completed += l.completed;
    }
    const elapsedSec = Math.max(0.001, (this.now() - this.startedAt) / 1000);
    return {
      status: this.status,
      completedBytes: completed,
      totalBytes: total,
      percent: total > 0 ? Math.min(100, Math.floor((completed / total) * 100)) : null,
      bytesPerSec: completed > 0 ? completed / elapsedSec : null,
    };
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export function formatPullLine(tag: string, s: PullSnapshot): string {
  if (s.percent === null) return `Pulling ${tag}: ${s.status}`;
  const speed = s.bytesPerSec ? `  ${formatBytes(s.bytesPerSec)}/s` : "";
  return `Pulling ${tag}: ${s.percent}%  ${formatBytes(s.completedBytes)} / ${formatBytes(s.totalBytes)}${speed}`;
}
