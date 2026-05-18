/**
 * Budget breach detector.
 *
 * Pure function over `GatewaySnapshot`. No I/O, no clock, no
 * collector mutation; the operator wires this in wherever they want
 * the alerts to surface (CLI today, HTTP endpoint tomorrow). The
 * snapshot stays the contract between the collector and any consumer,
 * including this one.
 *
 * Ordering is deterministic: alerts are sorted by scope, target,
 * metric, severity. The same snapshot + rules always produces the
 * same array, which is what downstream diff/dedupe layers expect.
 */
import type {
  GatewaySnapshot,
  PoolSnapshot,
  RouteSnapshot,
} from '../observability';
import {
  DEFAULT_MIN_REQUESTS_FOR_CHECKS,
  type AlertMetric,
  type AlertScope,
  type AlertSeverity,
  type BudgetAlert,
  type BudgetRules,
  type BudgetThreshold,
} from './types';

interface Check {
  readonly scope: AlertScope;
  readonly target: string;
  readonly pool: string;
  readonly metric: AlertMetric;
  readonly observed: number;
  readonly threshold?: BudgetThreshold;
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function severityFor(
  observed: number,
  threshold: BudgetThreshold | undefined,
): { severity: AlertSeverity; bound: number } | undefined {
  if (!threshold) return undefined;
  if (threshold.critical !== undefined && observed >= threshold.critical) {
    return { severity: 'critical', bound: threshold.critical };
  }
  if (threshold.warning !== undefined && observed >= threshold.warning) {
    return { severity: 'warning', bound: threshold.warning };
  }
  return undefined;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(3).replace(/\.?0+$/, '');
}

function reasonText(check: Check, bound: number): string {
  return `${check.scope}=${check.target} ${check.metric}=${formatNumber(check.observed)} >= ${formatNumber(bound)}`;
}

function poolChecks(p: PoolSnapshot, rules: BudgetRules['pool']): Check[] {
  if (!rules) return [];
  return [
    {
      scope: 'pool',
      target: p.pool,
      pool: p.pool,
      metric: 'error_rate',
      observed: rate(p.errorCount, p.requestCount),
      threshold: rules.errorRate,
    },
    {
      scope: 'pool',
      target: p.pool,
      pool: p.pool,
      metric: 'p95_latency_ms',
      observed: p.latencyP95Ms,
      threshold: rules.p95LatencyMs,
    },
    {
      scope: 'pool',
      target: p.pool,
      pool: p.pool,
      metric: 'retry_rate',
      observed: rate(p.retryCount, p.requestCount),
      threshold: rules.retryRate,
    },
    {
      scope: 'pool',
      target: p.pool,
      pool: p.pool,
      metric: 'breaker_open_rate',
      observed: rate(p.breakerOpenCount, p.requestCount),
      threshold: rules.breakerOpenRate,
    },
  ];
}

function routeChecks(r: RouteSnapshot, rules: BudgetRules['route']): Check[] {
  if (!rules) return [];
  return [
    {
      scope: 'route',
      target: r.route,
      pool: r.pool,
      metric: 'error_rate',
      observed: rate(r.errorCount, r.requestCount),
      threshold: rules.errorRate,
    },
    {
      scope: 'route',
      target: r.route,
      pool: r.pool,
      metric: 'p95_latency_ms',
      observed: r.latencyP95Ms,
      threshold: rules.p95LatencyMs,
    },
  ];
}

const METRIC_ORDER: Record<AlertMetric, number> = {
  error_rate: 0,
  p95_latency_ms: 1,
  retry_rate: 2,
  breaker_open_rate: 3,
};

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
};

function sortAlerts(alerts: BudgetAlert[]): BudgetAlert[] {
  return alerts.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    if (a.target !== b.target) return a.target.localeCompare(b.target);
    if (a.metric !== b.metric) return METRIC_ORDER[a.metric] - METRIC_ORDER[b.metric];
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
}

export function detectBudgetBreaches(
  snapshot: GatewaySnapshot,
  rules: BudgetRules,
): BudgetAlert[] {
  const minRequests = rules.minRequestsForChecks ?? DEFAULT_MIN_REQUESTS_FOR_CHECKS;
  const alerts: BudgetAlert[] = [];

  for (const pool of snapshot.pools) {
    if (pool.requestCount < minRequests) continue;
    for (const check of poolChecks(pool, rules.pool)) {
      const hit = severityFor(check.observed, check.threshold);
      if (!hit) continue;
      alerts.push({
        scope: check.scope,
        target: check.target,
        pool: check.pool,
        metric: check.metric,
        observed: check.observed,
        threshold: hit.bound,
        severity: hit.severity,
        reason: reasonText(check, hit.bound),
      });
    }
  }

  for (const route of snapshot.routes) {
    if (route.requestCount < minRequests) continue;
    for (const check of routeChecks(route, rules.route)) {
      const hit = severityFor(check.observed, check.threshold);
      if (!hit) continue;
      alerts.push({
        scope: check.scope,
        target: check.target,
        pool: check.pool,
        metric: check.metric,
        observed: check.observed,
        threshold: hit.bound,
        severity: hit.severity,
        reason: reasonText(check, hit.bound),
      });
    }
  }

  return sortAlerts(alerts);
}
