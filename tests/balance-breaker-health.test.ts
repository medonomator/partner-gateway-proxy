import { describe, expect, it } from 'vitest';
import { healthFromBreaker } from '../src/balance';
import {
  createCircuitBreaker,
  endpointKey,
} from '../src/policy/circuit-breaker';
import type { UpstreamPool } from '../src/routing';

const pool: UpstreamPool = {
  name: 'identity',
  endpoints: [
    { url: 'https://id-a' },
    { url: 'https://id-b' },
    { url: 'https://id-c' },
  ],
};

describe('healthFromBreaker', () => {
  it('maps closed -> healthy, half_open -> degraded, open -> down', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });

    // open id-a
    const aKey = endpointKey(pool, pool.endpoints[0]);
    cb.beforeRequest(aKey, 1000);
    cb.recordOutcome(aKey, 'failure', { now: 1000 });
    cb.beforeRequest(aKey, 1010);
    cb.recordOutcome(aKey, 'failure', { now: 1010 });

    // half-open id-b: open it then probe after cooldown
    const bKey = endpointKey(pool, pool.endpoints[1]);
    cb.beforeRequest(bKey, 1000);
    cb.recordOutcome(bKey, 'failure', { now: 1000 });
    cb.beforeRequest(bKey, 1010);
    cb.recordOutcome(bKey, 'failure', { now: 1010 });
    cb.beforeRequest(bKey, 2100); // open -> half_open

    // id-c: untouched, defaults to closed -> healthy
    const snapshot = healthFromBreaker(pool, cb);
    expect(snapshot).toEqual({
      'https://id-a': 'down',
      'https://id-b': 'degraded',
      'https://id-c': 'healthy',
    });
  });
});
