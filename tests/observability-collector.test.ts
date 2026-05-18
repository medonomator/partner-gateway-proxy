import { describe, expect, it } from 'vitest';
import { InMemoryMetricsCollector } from '../src/observability';

describe('InMemoryMetricsCollector', () => {
  it('records a successful request into pool and route buckets', () => {
    let now = 1000;
    const c = new InMemoryMetricsCollector({ clock: () => now });
    c.recordRequest({
      pool: 'p1',
      route: '/v1/a',
      status: 200,
      durationMs: 20,
      outcome: 'success',
    });
    now = 2000;
    const snap = c.snapshot();
    expect(snap.windowStartMs).toBe(1000);
    expect(snap.generatedAtMs).toBe(2000);
    expect(snap.pools).toHaveLength(1);
    expect(snap.pools[0]).toMatchObject({
      pool: 'p1',
      requestCount: 1,
      errorCount: 0,
      retryCount: 0,
      rateLimitRejects: 0,
      breakerOpenCount: 0,
    });
    expect(snap.routes[0]).toMatchObject({
      route: '/v1/a',
      pool: 'p1',
      requestCount: 1,
      errorCount: 0,
    });
  });

  it('separates error outcomes and stamps the last error reason', () => {
    const c = new InMemoryMetricsCollector();
    c.recordRequest({ pool: 'p1', route: '/x', status: 200, durationMs: 10, outcome: 'success' });
    c.recordRequest({
      pool: 'p1',
      route: '/x',
      status: 502,
      durationMs: 100,
      outcome: 'upstream_error',
      errorReason: 'connection_reset',
    });
    c.recordRequest({
      pool: 'p1',
      route: '/x',
      status: 504,
      durationMs: 200,
      outcome: 'upstream_error',
      errorReason: 'timeout',
    });
    const [pool] = c.snapshot().pools;
    expect(pool.requestCount).toBe(3);
    expect(pool.errorCount).toBe(2);
    expect(pool.lastErrorReason).toBe('timeout');
  });

  it('counts retries, rate-limit rejects and breaker opens via dedicated entry points', () => {
    const c = new InMemoryMetricsCollector();
    c.recordRetry('p1', '/a');
    c.recordRetry('p1', '/a');
    c.recordRateLimitReject('p1', '/a');
    c.recordBreakerOpen('p1', 'https://a', 'consecutive_failures');
    const [pool] = c.snapshot().pools;
    expect(pool.retryCount).toBe(2);
    expect(pool.rateLimitRejects).toBe(1);
    expect(pool.breakerOpenCount).toBe(1);
    expect(pool.lastErrorReason).toBe('consecutive_failures');
    expect(pool.endpoints).toEqual([
      { url: 'https://a', breakerState: 'open', health: 'down' },
    ]);
  });

  it('maps breaker state to health: closed->healthy, half_open->degraded, open->down', () => {
    const c = new InMemoryMetricsCollector();
    c.recordBreakerState('p1', 'https://a', 'closed');
    c.recordBreakerState('p1', 'https://b', 'half_open');
    c.recordBreakerState('p1', 'https://c', 'open');
    const [pool] = c.snapshot().pools;
    const byUrl = Object.fromEntries(pool.endpoints.map((e) => [e.url, e.health]));
    expect(byUrl['https://a']).toBe('healthy');
    expect(byUrl['https://b']).toBe('degraded');
    expect(byUrl['https://c']).toBe('down');
  });

  it('shows partial degradation: one pool down, the other still healthy', () => {
    const c = new InMemoryMetricsCollector();
    for (let i = 0; i < 20; i++) {
      c.recordRequest({
        pool: 'eu',
        route: '/v1/me',
        status: 200,
        durationMs: 30,
        outcome: 'success',
      });
    }
    for (let i = 0; i < 5; i++) {
      c.recordRequest({
        pool: 'us',
        route: '/v1/me',
        status: 503,
        durationMs: 800,
        outcome: 'upstream_error',
        errorReason: 'upstream_down',
      });
    }
    c.recordBreakerState('eu', 'https://eu-a', 'closed');
    c.recordBreakerState('us', 'https://us-a', 'open');

    const snap = c.snapshot();
    const eu = snap.pools.find((p) => p.pool === 'eu')!;
    const us = snap.pools.find((p) => p.pool === 'us')!;

    expect(eu.requestCount).toBe(20);
    expect(eu.errorCount).toBe(0);
    expect(eu.endpoints[0].health).toBe('healthy');

    expect(us.requestCount).toBe(5);
    expect(us.errorCount).toBe(5);
    expect(us.endpoints[0].health).toBe('down');
    expect(us.lastErrorReason).toBe('upstream_down');
  });

  it('reset clears counters and starts a new window', () => {
    let now = 1000;
    const c = new InMemoryMetricsCollector({ clock: () => now });
    c.recordRequest({
      pool: 'p1', route: '/a', status: 200, durationMs: 10, outcome: 'success',
    });
    now = 5000;
    c.reset();
    expect(c.snapshot()).toMatchObject({
      windowStartMs: 5000,
      pools: [],
      routes: [],
    });
  });

  it('produces deterministic ordering (pools and routes sorted by name)', () => {
    const c = new InMemoryMetricsCollector();
    c.recordRequest({ pool: 'z', route: '/z', status: 200, durationMs: 1, outcome: 'success' });
    c.recordRequest({ pool: 'a', route: '/a', status: 200, durationMs: 1, outcome: 'success' });
    c.recordRequest({ pool: 'm', route: '/m', status: 200, durationMs: 1, outcome: 'success' });
    const snap = c.snapshot();
    expect(snap.pools.map((p) => p.pool)).toEqual(['a', 'm', 'z']);
    expect(snap.routes.map((r) => r.route)).toEqual(['/a', '/m', '/z']);
  });
});
