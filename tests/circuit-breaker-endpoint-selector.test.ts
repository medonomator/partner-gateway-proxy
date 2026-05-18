import { describe, expect, it } from 'vitest';
import {
  createCircuitBreaker,
  endpointKey,
  pickEndpoint,
} from '../src/policy/circuit-breaker';
import type { UpstreamPool } from '../src/routing';

const pool: UpstreamPool = {
  name: 'billing',
  endpoints: [
    { url: 'https://billing-a' },
    { url: 'https://billing-b' },
    { url: 'https://billing-c' },
  ],
};

const cfg = { failureThreshold: 2, cooldownMs: 1000 };

describe('pickEndpoint', () => {
  it('returns the first endpoint whose breaker admits', () => {
    const cb = createCircuitBreaker(cfg);
    const pick = pickEndpoint(pool, cb, 1000);
    expect(pick.ok).toBe(true);
    if (pick.ok) {
      expect(pick.endpoint.url).toBe('https://billing-a');
      expect(pick.probe).toBe(false);
      expect(pick.state).toBe('closed');
    }
  });

  it('skips open endpoints and picks the next healthy one', () => {
    const cb = createCircuitBreaker(cfg);
    const aKey = endpointKey(pool, pool.endpoints[0]);
    for (let i = 0; i < 2; i++) {
      cb.beforeRequest(aKey, 1000);
      cb.recordOutcome(aKey, 'failure', { now: 1000 });
    }
    const pick = pickEndpoint(pool, cb, 1100);
    expect(pick.ok).toBe(true);
    if (pick.ok) {
      expect(pick.endpoint.url).toBe('https://billing-b');
    }
    // and crucially: the rest of the pool keeps serving
    expect(cb.state(endpointKey(pool, pool.endpoints[1]))).toBe('closed');
    expect(cb.state(endpointKey(pool, pool.endpoints[2]))).toBe('closed');
  });

  it('returns all_open with the soonest retryAfterMs when every endpoint is open', () => {
    const cb = createCircuitBreaker(cfg);
    for (const ep of pool.endpoints) {
      const key = endpointKey(pool, ep);
      cb.beforeRequest(key, 1000);
      cb.recordOutcome(key, 'failure', { now: 1000 });
      cb.beforeRequest(key, 1010);
      cb.recordOutcome(key, 'failure', { now: 1010 });
    }
    // all three opened at t=1010 (2 consecutive failures, threshold=2);
    // at t=1200, remaining cooldown = 1000 - (1200-1010) = 810ms.
    const pick = pickEndpoint(pool, cb, 1200);
    expect(pick.ok).toBe(false);
    if (!pick.ok) {
      expect(pick.reason).toBe('all_open');
      expect(pick.pool).toBe('billing');
      expect(pick.retryAfterMs).toBe(810);
    }
  });
});
