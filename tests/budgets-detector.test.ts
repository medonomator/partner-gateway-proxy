import { describe, expect, it } from 'vitest';
import {
  detectBudgetBreaches,
  type BudgetRules,
} from '../src/budgets';
import type {
  GatewaySnapshot,
  HistogramSnapshot,
  PoolSnapshot,
  RouteSnapshot,
} from '../src/observability';

function emptyHistogram(): HistogramSnapshot {
  return { count: 0, sumMs: 0, buckets: [], overflowCount: 0 };
}

function makePool(overrides: Partial<PoolSnapshot> = {}): PoolSnapshot {
  return {
    pool: 'partners-eu',
    requestCount: 100,
    errorCount: 0,
    retryCount: 0,
    rateLimitRejects: 0,
    breakerOpenCount: 0,
    failoverAttempts: 0,
    latencyP50Ms: 50,
    latencyP95Ms: 200,
    histogram: emptyHistogram(),
    endpoints: [],
    ...overrides,
  };
}

function makeRoute(overrides: Partial<RouteSnapshot> = {}): RouteSnapshot {
  return {
    route: '/v1/identity/me',
    pool: 'partners-eu',
    requestCount: 100,
    errorCount: 0,
    latencyP50Ms: 50,
    latencyP95Ms: 200,
    ...overrides,
  };
}

function makeSnapshot(
  pools: PoolSnapshot[],
  routes: RouteSnapshot[] = [],
): GatewaySnapshot {
  return {
    windowStartMs: 0,
    generatedAtMs: 1000,
    pools,
    routes,
  };
}

const RULES: BudgetRules = {
  pool: {
    errorRate: { warning: 0.02, critical: 0.1 },
    p95LatencyMs: { warning: 500, critical: 1500 },
    retryRate: { warning: 0.05, critical: 0.2 },
    breakerOpenRate: { warning: 0.01, critical: 0.05 },
  },
  route: {
    errorRate: { warning: 0.02, critical: 0.1 },
    p95LatencyMs: { warning: 400, critical: 1200 },
  },
  minRequestsForChecks: 20,
};

describe('detectBudgetBreaches', () => {
  it('emits no alerts on an empty snapshot', () => {
    expect(detectBudgetBreaches(makeSnapshot([]), RULES)).toEqual([]);
  });

  it('emits no alerts when every signal is well under the warning threshold', () => {
    const snap = makeSnapshot(
      [makePool({ errorCount: 1, retryCount: 1, latencyP95Ms: 100 })],
      [makeRoute({ errorCount: 1, latencyP95Ms: 100 })],
    );
    expect(detectBudgetBreaches(snap, RULES)).toEqual([]);
  });

  it('emits a warning when a metric crosses warning but not critical', () => {
    const snap = makeSnapshot([
      makePool({ errorCount: 3 }), // 0.03 > 0.02 (warn), < 0.1 (crit)
    ]);
    const alerts = detectBudgetBreaches(snap, RULES);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      scope: 'pool',
      target: 'partners-eu',
      metric: 'error_rate',
      severity: 'warning',
      threshold: 0.02,
    });
    expect(alerts[0].observed).toBeCloseTo(0.03);
  });

  it('emits critical (not warning) when a metric crosses both thresholds', () => {
    const snap = makeSnapshot([
      makePool({ errorCount: 20 }), // 0.2 >= 0.1 (crit)
    ]);
    const alerts = detectBudgetBreaches(snap, RULES);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].threshold).toBe(0.1);
  });

  it('reports multiple concurrent breaches on the same pool in stable order', () => {
    const snap = makeSnapshot([
      makePool({ errorCount: 25, retryCount: 30, latencyP95Ms: 2000, breakerOpenCount: 10 }),
    ]);
    const alerts = detectBudgetBreaches(snap, RULES);
    expect(alerts.map((a) => a.metric)).toEqual([
      'error_rate',
      'p95_latency_ms',
      'retry_rate',
      'breaker_open_rate',
    ]);
    expect(alerts.every((a) => a.scope === 'pool')).toBe(true);
  });

  it('reports breaches across multiple pools and routes, sorted deterministically', () => {
    const snap = makeSnapshot(
      [
        makePool({ pool: 'partners-us', errorCount: 30 }),
        makePool({ pool: 'partners-eu', latencyP95Ms: 1600 }),
      ],
      [
        makeRoute({ route: '/v1/charge', pool: 'partners-us', errorCount: 30 }),
        makeRoute({ route: '/v1/me', pool: 'partners-eu', latencyP95Ms: 1300 }),
      ],
    );
    const alerts = detectBudgetBreaches(snap, RULES);
    expect(alerts.map((a) => `${a.scope}:${a.target}:${a.metric}`)).toEqual([
      'pool:partners-eu:p95_latency_ms',
      'pool:partners-us:error_rate',
      'route:/v1/charge:error_rate',
      'route:/v1/me:p95_latency_ms',
    ]);
  });

  it('suppresses alerts when request count is below the low-traffic floor', () => {
    const snap = makeSnapshot(
      [makePool({ requestCount: 5, errorCount: 4, latencyP95Ms: 5000 })], // 80% errors
      [makeRoute({ requestCount: 3, errorCount: 3, latencyP95Ms: 5000 })],
    );
    expect(detectBudgetBreaches(snap, RULES)).toEqual([]);
  });

  it('respects a custom minRequestsForChecks override', () => {
    const snap = makeSnapshot([
      makePool({ requestCount: 5, errorCount: 4 }),
    ]);
    const tight: BudgetRules = { ...RULES, minRequestsForChecks: 3 };
    const alerts = detectBudgetBreaches(snap, tight);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].metric).toBe('error_rate');
    expect(alerts[0].severity).toBe('critical');
  });

  it('skips a metric entirely when the rule omits its threshold', () => {
    const onlyErrorRate: BudgetRules = {
      pool: { errorRate: { critical: 0.1 } },
      minRequestsForChecks: 20,
    };
    const snap = makeSnapshot([
      makePool({ errorCount: 20, latencyP95Ms: 9999, retryCount: 99 }),
    ]);
    const alerts = detectBudgetBreaches(snap, onlyErrorRate);
    expect(alerts.map((a) => a.metric)).toEqual(['error_rate']);
  });

  it('produces the same alert array on repeated calls (no internal state)', () => {
    const snap = makeSnapshot([
      makePool({ errorCount: 20, latencyP95Ms: 1600 }),
    ]);
    const a = detectBudgetBreaches(snap, RULES);
    const b = detectBudgetBreaches(snap, RULES);
    expect(a).toEqual(b);
  });

  it('reason text includes scope, target, metric, observed and threshold', () => {
    const snap = makeSnapshot([
      makePool({ errorCount: 20 }),
    ]);
    const [alert] = detectBudgetBreaches(snap, RULES);
    expect(alert.reason).toContain('pool=partners-eu');
    expect(alert.reason).toContain('error_rate=');
    expect(alert.reason).toContain('>=');
    expect(alert.reason).toContain('0.1');
  });

  it('does not fire on requestCount=0 even when traffic floor would technically allow it', () => {
    const snap = makeSnapshot([
      makePool({ requestCount: 0, errorCount: 0, latencyP95Ms: 0 }),
    ]);
    const allowAll: BudgetRules = {
      ...RULES,
      minRequestsForChecks: 0,
    };
    expect(detectBudgetBreaches(snap, allowAll)).toEqual([]);
  });
});
