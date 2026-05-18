import { describe, expect, it } from 'vitest';
import {
  InMemoryMetricsCollector,
  attachBreakerState,
  formatSnapshot,
} from '../src/observability';
import { createCircuitBreaker } from '../src/policy/circuit-breaker';
import type { UpstreamPool } from '../src/routing';

describe('formatSnapshot', () => {
  it('emits a header with window length and lists pools, endpoints, routes', () => {
    let now = 1000;
    const c = new InMemoryMetricsCollector({ clock: () => now });
    c.recordRequest({
      pool: 'eu',
      route: '/v1/me',
      status: 200,
      durationMs: 20,
      outcome: 'success',
    });
    c.recordBreakerState('eu', 'https://eu-a', 'closed');
    now = 6000;
    const text = formatSnapshot(c.snapshot());

    expect(text).toContain('window=5000ms');
    expect(text).toContain('eu  req=1 err=0');
    expect(text).toContain('endpoint https://eu-a  breaker=closed health=healthy');
    expect(text).toContain('/v1/me -> eu');
  });

  it('shows last_error and overall counts when one pool degrades', () => {
    const c = new InMemoryMetricsCollector();
    for (let i = 0; i < 5; i++) {
      c.recordRequest({
        pool: 'us',
        route: '/v1/billing',
        status: 503,
        durationMs: 200,
        outcome: 'upstream_error',
        errorReason: 'upstream_down',
      });
    }
    c.recordBreakerState('us', 'https://us-a', 'open');
    const text = formatSnapshot(c.snapshot());
    expect(text).toContain('us  req=5 err=5');
    expect(text).toContain('last_error: upstream_down');
    expect(text).toContain('breaker=open health=down');
  });
});

describe('attachBreakerState', () => {
  it('writes every pool endpoint into the collector', () => {
    const c = new InMemoryMetricsCollector();
    const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    const pool: UpstreamPool = {
      name: 'p1',
      endpoints: [{ url: 'https://a' }, { url: 'https://b' }],
    };
    breaker.recordOutcome('p1|https://a', 'failure', { now: 1 });
    breaker.recordOutcome('p1|https://a', 'failure', { now: 2 });

    attachBreakerState(c, pool, breaker);

    const snap = c.snapshot();
    const eps = snap.pools[0].endpoints;
    const byUrl = Object.fromEntries(eps.map((e) => [e.url, e.breakerState]));
    expect(byUrl['https://a']).toBe('open');
    expect(byUrl['https://b']).toBe('closed');
  });
});
