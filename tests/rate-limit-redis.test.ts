import { describe, expect, it } from 'vitest';
import { InMemoryTokenBucketLimiter } from '../src/policy/rate-limit/in-memory';
import { RedisTokenBucketLimiter } from '../src/policy/rate-limit/redis';
import { FakeRedisClient } from './_helpers/fake-redis';

const config = { capacity: 3, refillTokensPerSecond: 2 };

describe('RedisTokenBucketLimiter', () => {
  it('allows up to capacity and then rejects', async () => {
    const lim = new RedisTokenBucketLimiter(new FakeRedisClient(), config);
    const r1 = await lim.acquire({ key: 'k', now: 1000 });
    const r2 = await lim.acquire({ key: 'k', now: 1000 });
    const r3 = await lim.acquire({ key: 'k', now: 1000 });
    const r4 = await lim.acquire({ key: 'k', now: 1000 });
    expect(r1.allowed && r2.allowed && r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    if (!r4.allowed) {
      expect(r4.reason).toBe('rate_limited');
      expect(r4.retryAfterMs).toBe(500);
      expect(r4.config).toEqual(config);
    }
  });

  it('recovers tokens once enough wall-clock time has passed', async () => {
    const lim = new RedisTokenBucketLimiter(new FakeRedisClient(), { capacity: 1, refillTokensPerSecond: 1 });
    await lim.acquire({ key: 'k', now: 1000 });
    const blocked = await lim.acquire({ key: 'k', now: 1000 });
    expect(blocked.allowed).toBe(false);
    const recovered = await lim.acquire({ key: 'k', now: 2000 });
    expect(recovered.allowed).toBe(true);
  });

  it('mirrors in-memory behavior for the same call sequence', async () => {
    const inMem = new InMemoryTokenBucketLimiter(config);
    const redis = new RedisTokenBucketLimiter(new FakeRedisClient(), config);
    const calls = [
      { key: 'a', now: 1000 },
      { key: 'a', now: 1000 },
      { key: 'a', now: 1000 },
      { key: 'a', now: 1000 },
      { key: 'a', now: 1200 },
      { key: 'b', now: 1200 },
      { key: 'a', now: 2500 },
      { key: 'a', now: 3000 },
    ];
    for (const c of calls) {
      const memDec = await inMem.acquire(c);
      const redisDec = await redis.acquire(c);
      expect(redisDec.allowed).toBe(memDec.allowed);
      if (!memDec.allowed && !redisDec.allowed) {
        expect(redisDec.retryAfterMs).toBe(memDec.retryAfterMs);
      }
    }
  });

  it('namespaces keys with the configured prefix', async () => {
    const observed: string[] = [];
    const spyClient = {
      async eval(_s: string, keys: ReadonlyArray<string>) {
        observed.push(keys[0]);
        return [1, '0', 0];
      },
    };
    const lim = new RedisTokenBucketLimiter(spyClient, config, { keyPrefix: 'gw:rl:' });
    await lim.acquire({ key: 'pool:billing', now: 1000 });
    expect(observed).toEqual(['gw:rl:pool:billing']);
  });
});
