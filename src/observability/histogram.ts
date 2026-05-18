/**
 * Fixed-bucket latency histogram.
 *
 * Buckets are explicit upper bounds in ms. Quantiles are estimated by
 * walking cumulative counts and returning the upper bound of the bucket
 * that crosses the target rank. We do NOT interpolate within a bucket -
 * the operator value here is "tell me if p95 crossed 500ms", not
 * sub-bucket precision. If you need more resolution, add buckets.
 *
 * Buckets are fixed at construction and the resulting shape is pinned in
 * the snapshot. Tests assert the default boundaries to stop the format
 * from drifting silently.
 */
import type { HistogramSnapshot } from './types';

export const DEFAULT_BUCKETS_MS: ReadonlyArray<number> = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
];

export class LatencyHistogram {
  private readonly buckets: number[];
  private readonly counts: number[];
  private totalCount = 0;
  private sumMs = 0;

  constructor(buckets: ReadonlyArray<number> = DEFAULT_BUCKETS_MS) {
    if (buckets.length === 0) throw new Error('histogram needs at least one bucket');
    const sorted = [...buckets].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] <= 0) throw new Error('bucket bounds must be positive');
      if (i > 0 && sorted[i] === sorted[i - 1]) throw new Error('duplicate bucket bound');
    }
    this.buckets = sorted;
    this.counts = new Array(sorted.length + 1).fill(0);
  }

  record(durationMs: number): void {
    const clamped = Math.max(0, durationMs);
    this.totalCount++;
    this.sumMs += clamped;
    for (let i = 0; i < this.buckets.length; i++) {
      if (clamped <= this.buckets[i]) {
        this.counts[i]++;
        return;
      }
    }
    this.counts[this.counts.length - 1]++;
  }

  quantile(q: number): number {
    if (this.totalCount === 0) return 0;
    if (q <= 0) return this.buckets[0];
    if (q >= 1) return this.tailBound();
    const target = Math.ceil(this.totalCount * q);
    let cumulative = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      cumulative += this.counts[i];
      if (cumulative >= target) return this.buckets[i];
    }
    return this.tailBound();
  }

  private tailBound(): number {
    return this.buckets[this.buckets.length - 1];
  }

  snapshot(): HistogramSnapshot {
    return {
      count: this.totalCount,
      sumMs: this.sumMs,
      buckets: this.buckets.map((upper, i) => ({
        upperBoundMs: upper,
        count: this.counts[i],
      })),
      overflowCount: this.counts[this.counts.length - 1],
    };
  }

  reset(): void {
    this.totalCount = 0;
    this.sumMs = 0;
    this.counts.fill(0);
  }
}
