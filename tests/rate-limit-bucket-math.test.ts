import { describe, expect, it } from 'vitest';
import { decide, refill, validateConfig } from '../src/policy/rate-limit/bucket-math';

const cfg = { capacity: 10, refillTokensPerSecond: 1 };

describe('refill', () => {
  it('returns the same snapshot when nowMs has not advanced', () => {
    const s = { tokens: 5, updatedAtMs: 1000 };
    expect(refill(s, cfg, 1000)).toEqual(s);
    expect(refill(s, cfg, 500)).toEqual(s);
  });

  it('adds tokens proportional to elapsed time', () => {
    const r = refill({ tokens: 5, updatedAtMs: 1000 }, cfg, 2000);
    expect(r.tokens).toBeCloseTo(6, 6);
    expect(r.updatedAtMs).toBe(2000);
  });

  it('caps refill at capacity', () => {
    const r = refill({ tokens: 8, updatedAtMs: 1000 }, { capacity: 10, refillTokensPerSecond: 10 }, 10_000);
    expect(r.tokens).toBe(10);
  });
});

describe('decide', () => {
  it('allows and decrements when tokens >= cost', () => {
    const r = decide({ tokens: 5, updatedAtMs: 1000 }, cfg, 1, 1000);
    expect(r.decision).toBe('allow');
    expect(r.next.tokens).toBe(4);
    expect(r.retryAfterMs).toBe(0);
  });

  it('rejects when tokens < cost and reports retryAfter to next token', () => {
    const r = decide({ tokens: 0, updatedAtMs: 1000 }, cfg, 1, 1000);
    expect(r.decision).toBe('reject');
    expect(r.next.tokens).toBe(0);
    expect(r.retryAfterMs).toBe(1000);
  });

  it('rejects when partial refill is still under cost', () => {
    const r = decide({ tokens: 0, updatedAtMs: 1000 }, cfg, 2, 1500);
    expect(r.decision).toBe('reject');
    expect(r.retryAfterMs).toBe(1500);
  });

  it('applies refill before deciding', () => {
    const r = decide({ tokens: 0, updatedAtMs: 1000 }, cfg, 1, 2500);
    expect(r.decision).toBe('allow');
    expect(r.next.tokens).toBeCloseTo(0.5, 6);
  });
});

describe('validateConfig', () => {
  it('rejects non-positive capacity', () => {
    expect(() => validateConfig({ capacity: 0, refillTokensPerSecond: 1 })).toThrow(/capacity/);
    expect(() => validateConfig({ capacity: -1, refillTokensPerSecond: 1 })).toThrow(/capacity/);
  });

  it('rejects non-positive refill rate', () => {
    expect(() => validateConfig({ capacity: 1, refillTokensPerSecond: 0 })).toThrow(/refill/);
  });
});
