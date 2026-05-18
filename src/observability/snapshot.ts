/**
 * Snapshot helpers.
 *
 * - `formatSnapshot`: pretty-print a `GatewaySnapshot` for CLI / SSH
 *   debugging. Stable column order; deterministic so it can land in
 *   golden tests.
 * - `attachBreakerState`: fold a breaker's per-key state into the
 *   collector so the snapshot reflects current circuit state without the
 *   call site holding both objects.
 */
import type { CircuitBreaker } from '../policy/circuit-breaker';
import type { UpstreamPool } from '../routing';
import { endpointKey } from '../policy/circuit-breaker';
import type { GatewaySnapshot, MetricsCollector } from './types';

export function attachBreakerState(
  collector: MetricsCollector,
  pool: UpstreamPool,
  breaker: CircuitBreaker,
): void {
  for (const endpoint of pool.endpoints) {
    const key = endpointKey(pool, endpoint);
    collector.recordBreakerState(pool.name, endpoint.url, breaker.state(key));
  }
}

export function formatSnapshot(snapshot: GatewaySnapshot): string {
  const lines: string[] = [];
  const windowMs = snapshot.generatedAtMs - snapshot.windowStartMs;
  lines.push(`gateway snapshot - window=${windowMs}ms generated_at=${snapshot.generatedAtMs}`);
  lines.push('');
  if (snapshot.pools.length === 0) {
    lines.push('  (no pools recorded yet)');
  } else {
    lines.push('pools:');
    for (const p of snapshot.pools) {
      lines.push(
        `  ${p.pool}  req=${p.requestCount} err=${p.errorCount} retries=${p.retryCount} rate_limit_rejects=${p.rateLimitRejects} breaker_opens=${p.breakerOpenCount} p50=${p.latencyP50Ms}ms p95=${p.latencyP95Ms}ms`,
      );
      if (p.lastErrorReason) lines.push(`    last_error: ${p.lastErrorReason}`);
      for (const e of p.endpoints) {
        lines.push(`    endpoint ${e.url}  breaker=${e.breakerState} health=${e.health}`);
      }
    }
  }
  lines.push('');
  if (snapshot.routes.length > 0) {
    lines.push('routes:');
    for (const r of snapshot.routes) {
      lines.push(
        `  ${r.route} -> ${r.pool}  req=${r.requestCount} err=${r.errorCount} p50=${r.latencyP50Ms}ms p95=${r.latencyP95Ms}ms`,
      );
    }
  }
  return lines.join('\n');
}
