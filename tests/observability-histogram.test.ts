import { describe, expect, it } from 'vitest';
import { DEFAULT_BUCKETS_MS, LatencyHistogram } from '../src/observability';

describe('LatencyHistogram', () => {
  it('pins the default bucket boundaries so the snapshot shape does not drift', () => {
    expect([...DEFAULT_BUCKETS_MS]).toEqual([
      1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
    ]);
  });

  it('records into the smallest bucket whose upper bound covers the sample', () => {
    const h = new LatencyHistogram();
    h.record(3);
    h.record(5);
    h.record(6);
    h.record(99);
    h.record(99999);

    const snap = h.snapshot();
    expect(snap.count).toBe(5);
    const byBound = Object.fromEntries(snap.buckets.map((b) => [b.upperBoundMs, b.count]));
    expect(byBound[5]).toBe(2);
    expect(byBound[10]).toBe(1);
    expect(byBound[100]).toBe(1);
    expect(snap.overflowCount).toBe(1);
  });

  it('estimates p50 and p95 by walking cumulative counts', () => {
    const h = new LatencyHistogram();
    for (let i = 0; i < 90; i++) h.record(20);
    for (let i = 0; i < 10; i++) h.record(800);

    expect(h.quantile(0.5)).toBe(25);
    expect(h.quantile(0.95)).toBe(1000);
  });

  it('reports 0 for any quantile when empty', () => {
    const h = new LatencyHistogram();
    expect(h.quantile(0.5)).toBe(0);
    expect(h.quantile(0.95)).toBe(0);
  });

  it('reset zeroes counts and sum', () => {
    const h = new LatencyHistogram();
    h.record(50);
    h.record(500);
    h.reset();
    const snap = h.snapshot();
    expect(snap.count).toBe(0);
    expect(snap.sumMs).toBe(0);
    expect(snap.buckets.every((b) => b.count === 0)).toBe(true);
    expect(snap.overflowCount).toBe(0);
  });

  it('rejects invalid bucket configs', () => {
    expect(() => new LatencyHistogram([])).toThrow();
    expect(() => new LatencyHistogram([0, 10])).toThrow();
    expect(() => new LatencyHistogram([5, 5])).toThrow();
  });
});
