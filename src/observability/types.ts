/**
 * Observability primitives.
 *
 * RED signals (Rate, Errors, Duration) per pool and per route, plus the
 * gateway-specific add-ons partner-integrations actually pays for: retry
 * count, rate-limit rejects, breaker state. Snapshot is a contract object
 * suitable for CLI output, a health endpoint, or the next task in the
 * roadmap (budget alerts).
 *
 * Scope choice: the collector is in-process and per-instance. Operators
 * running multiple gateway replicas should scrape each instance and merge
 * upstream (Prometheus, vendor SDK). Trying to aggregate across instances
 * here would mean rebuilding a metrics backend, which the task spec
 * explicitly rules out.
 */
import type { CircuitState } from '../policy/circuit-breaker';
import type { HealthState } from '../balance';

export type RequestOutcome =
  | 'success'
  | 'upstream_error'
  | 'client_error'
  | 'rate_limited'
  | 'breaker_open';

export interface RequestEvent {
  readonly pool: string;
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
  readonly outcome: RequestOutcome;
  readonly errorReason?: string;
}

export interface HistogramBucket {
  readonly upperBoundMs: number;
  readonly count: number;
}

export interface HistogramSnapshot {
  readonly count: number;
  readonly sumMs: number;
  readonly buckets: ReadonlyArray<HistogramBucket>;
  readonly overflowCount: number;
}

export interface EndpointSnapshot {
  readonly url: string;
  readonly breakerState: CircuitState;
  readonly health: HealthState;
}

export interface PoolSnapshot {
  readonly pool: string;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly retryCount: number;
  readonly rateLimitRejects: number;
  readonly breakerOpenCount: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
  readonly histogram: HistogramSnapshot;
  readonly endpoints: ReadonlyArray<EndpointSnapshot>;
  readonly lastErrorReason?: string;
}

export interface RouteSnapshot {
  readonly route: string;
  readonly pool: string;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly latencyP50Ms: number;
  readonly latencyP95Ms: number;
}

export interface GatewaySnapshot {
  readonly windowStartMs: number;
  readonly generatedAtMs: number;
  readonly pools: ReadonlyArray<PoolSnapshot>;
  readonly routes: ReadonlyArray<RouteSnapshot>;
}

export interface MetricsCollector {
  recordRequest(event: RequestEvent): void;
  recordRetry(pool: string, route: string): void;
  recordRateLimitReject(pool: string, route: string): void;
  recordBreakerOpen(pool: string, endpoint: string, reason?: string): void;
  recordBreakerState(pool: string, endpoint: string, state: CircuitState): void;
  snapshot(): GatewaySnapshot;
  reset(): void;
}
