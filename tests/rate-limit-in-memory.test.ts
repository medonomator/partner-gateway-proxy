import { describe, expect, it } from 'vitest';
import { InMemoryTokenBucketLimiter } from '../src/policy/rate-limit/in-memory';

describe('InMemoryTokenBucketLimiter', () => {
  it('allows burst up to capacity then rejects with rate_limited', async () => {
    const lim = new InMemoryTokenBucketLimiter({ capacity: 3, refillTokensPerSecond: 1 });
    const t = 1000;
    const r1 = await lim.acquire({ key: 'k', now: t });
    const r2 = await lim.acquire({ key: 'k', now: t });
    const r3 = await lim.acquire({ key: 'k', now: t });
    const r4 = await lim.acquire({ key: 'k', now: t });
    expect(r1.allowed && r2.allowed && r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    if (!r4.allowed) {
      expect(r4.reason).toBe('rate_limited');
      expect(r4.retryAfterMs).toBe(1000);
      expect(r4.config).toEqual({ capacity: 3, refillTokensPerSecond: 1 });
      expect(r4.key).toBe('k');
    }
  });

  it('refills tokens over time and resumes admitting traffic', async () => {
    const lim = new InMemoryTokenBucketLimiter({ capacity: 2, refillTokensPerSecond: 1 });
    await lim.acquire({ key: 'k', now: 1000 });
    await lim.acquire({ key: 'k', now: 1000 });
    const blocked = await lim.acquire({ key: 'k', now: 1000 });
    expect(blocked.allowed).toBe(false);

    const after = await lim.acquire({ key: 'k', now: 2500 });
    expect(after.allowed).toBe(true);
    if (after.allowed) {
      expect(after.remainingTokens).toBeCloseTo(0.5, 6);
    }
  });

  it('isolates buckets by key', async () => {
    const lim = new InMemoryTokenBucketLimiter({ capacity: 1, refillTokensPerSecond: 1 });
    const a1 = await lim.acquire({ key: 'a', now: 1000 });
    const b1 = await lim.acquire({ key: 'b', now: 1000 });
    expect(a1.allowed && b1.allowed).toBe(true);
    const a2 = await lim.acquire({ key: 'a', now: 1000 });
    expect(a2.allowed).toBe(false);
  });

  it('honours custom cost per acquire', async () => {
    const lim = new InMemoryTokenBucketLimiter({ capacity: 5, refillTokensPerSecond: 1 });
    const big = await lim.acquire({ key: 'k', now: 1000, cost: 5 });
    expect(big.allowed).toBe(true);
    const next = await lim.acquire({ key: 'k', now: 1000, cost: 1 });
    expect(next.allowed).toBe(false);
  });

  it('caps sustained throughput near the refill rate over a long window', async () => {
    const lim = new InMemoryTokenBucketLimiter({ capacity: 3, refillTokensPerSecond: 2 });
    const startMs = 1000;
    const intervalMs = 100;
    const totalRequests = 100;

    let allowed = 0;
    for (let i = 0; i < totalRequests; i++) {
      const r = await lim.acquire({ key: 'k', now: startMs + i * intervalMs });
      if (r.allowed) allowed++;
    }

    // Initial capacity (3) plus refill of 2 tok/s over the (n-1)*interval span:
    //   3 + 2 * 9.9s = ~22.8. Boundary phasing keeps the actual count tight
    //   around that value.
    expect(allowed).toBeGreaterThanOrEqual(22);
    expect(allowed).toBeLessThanOrEqual(24);

    // And the limiter must be doing real work, not approving everything.
    expect(allowed).toBeLessThan(totalRequests / 3);
  });

  it('rejects invalid config and invalid cost', () => {
    expect(() => new InMemoryTokenBucketLimiter({ capacity: 0, refillTokensPerSecond: 1 })).toThrow();
    expect(() => new InMemoryTokenBucketLimiter({ capacity: 1, refillTokensPerSecond: 0 })).toThrow();

    const lim = new InMemoryTokenBucketLimiter({ capacity: 1, refillTokensPerSecond: 1 });
    return expect(lim.acquire({ key: 'k', now: 1000, cost: 0 })).rejects.toThrow(/cost/);
  });
});
