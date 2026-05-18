/**
 * In-memory metrics collector.
 *
 * Aggregates RED signals per pool and per route as a side-effect of the
 * normal request flow - no background worker. `snapshot()` returns a
 * deterministic, frozen view; `reset()` zeroes counters and starts a new
 * window. The operator decides the polling cadence.
 *
 * Breaker state is tracked per endpoint and resolved into a coarse
 * `HealthState` for snapshot consumers that do not care about the
 * three-state machine (CLI, alerting). The mapping is the same one used
 * by `healthFromBreaker` in src/balance: closed -> healthy, half_open ->
 * degraded, open -> down.
 */
import type { CircuitState } from '../policy/circuit-breaker';
import type { HealthState } from '../balance';
import { LatencyHistogram } from './histogram';
import type {
  EndpointSnapshot,
  GatewaySnapshot,
  MetricsCollector,
  PoolSnapshot,
  RequestEvent,
  RouteSnapshot,
} from './types';

export interface CollectorOptions {
  readonly clock?: () => number;
  readonly buckets?: ReadonlyArray<number>;
}

interface PoolBucket {
  requestCount: number;
  errorCount: number;
  retryCount: number;
  rateLimitRejects: number;
  breakerOpenCount: number;
  histogram: LatencyHistogram;
  lastErrorReason?: string;
  endpoints: Map<string, CircuitState>;
}

interface RouteBucket {
  pool: string;
  requestCount: number;
  errorCount: number;
  histogram: LatencyHistogram;
}

function healthFromState(state: CircuitState): HealthState {
  if (state === 'closed') return 'healthy';
  if (state === 'half_open') return 'degraded';
  return 'down';
}

function isError(event: RequestEvent): boolean {
  return event.outcome !== 'success';
}

export class InMemoryMetricsCollector implements MetricsCollector {
  private readonly clock: () => number;
  private readonly buckets: ReadonlyArray<number> | undefined;
  private readonly pools = new Map<string, PoolBucket>();
  private readonly routes = new Map<string, RouteBucket>();
  private windowStartMs: number;

  constructor(options: CollectorOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.buckets = options.buckets;
    this.windowStartMs = this.clock();
  }

  recordRequest(event: RequestEvent): void {
    const pool = this.poolBucket(event.pool);
    pool.requestCount++;
    pool.histogram.record(event.durationMs);
    if (isError(event)) {
      pool.errorCount++;
      if (event.errorReason) pool.lastErrorReason = event.errorReason;
    }
    if (event.outcome === 'breaker_open') pool.breakerOpenCount++;
    if (event.outcome === 'rate_limited') pool.rateLimitRejects++;

    const routeKey = `${event.pool}::${event.route}`;
    const route = this.routes.get(routeKey) ?? {
      pool: event.pool,
      requestCount: 0,
      errorCount: 0,
      histogram: new LatencyHistogram(this.buckets),
    };
    route.requestCount++;
    route.histogram.record(event.durationMs);
    if (isError(event)) route.errorCount++;
    this.routes.set(routeKey, route);
  }

  recordRetry(pool: string, _route: string): void {
    this.poolBucket(pool).retryCount++;
  }

  recordRateLimitReject(pool: string, _route: string): void {
    this.poolBucket(pool).rateLimitRejects++;
  }

  recordBreakerOpen(pool: string, endpoint: string, reason?: string): void {
    const bucket = this.poolBucket(pool);
    bucket.breakerOpenCount++;
    bucket.endpoints.set(endpoint, 'open');
    if (reason) bucket.lastErrorReason = reason;
  }

  recordBreakerState(pool: string, endpoint: string, state: CircuitState): void {
    this.poolBucket(pool).endpoints.set(endpoint, state);
  }

  snapshot(): GatewaySnapshot {
    const generatedAtMs = this.clock();
    const pools: PoolSnapshot[] = Array.from(this.pools.entries())
      .map(([name, b]) => this.toPoolSnapshot(name, b))
      .sort((a, b) => a.pool.localeCompare(b.pool));
    const routes: RouteSnapshot[] = Array.from(this.routes.entries())
      .map(([key, r]) => this.toRouteSnapshot(key, r))
      .sort((a, b) => a.route.localeCompare(b.route));
    return {
      windowStartMs: this.windowStartMs,
      generatedAtMs,
      pools,
      routes,
    };
  }

  reset(): void {
    this.pools.clear();
    this.routes.clear();
    this.windowStartMs = this.clock();
  }

  private poolBucket(pool: string): PoolBucket {
    let bucket = this.pools.get(pool);
    if (!bucket) {
      bucket = {
        requestCount: 0,
        errorCount: 0,
        retryCount: 0,
        rateLimitRejects: 0,
        breakerOpenCount: 0,
        histogram: new LatencyHistogram(this.buckets),
        endpoints: new Map(),
      };
      this.pools.set(pool, bucket);
    }
    return bucket;
  }

  private toPoolSnapshot(name: string, b: PoolBucket): PoolSnapshot {
    const endpoints: EndpointSnapshot[] = Array.from(b.endpoints.entries())
      .map(([url, state]) => ({ url, breakerState: state, health: healthFromState(state) }))
      .sort((a, b) => a.url.localeCompare(b.url));
    return {
      pool: name,
      requestCount: b.requestCount,
      errorCount: b.errorCount,
      retryCount: b.retryCount,
      rateLimitRejects: b.rateLimitRejects,
      breakerOpenCount: b.breakerOpenCount,
      latencyP50Ms: b.histogram.quantile(0.5),
      latencyP95Ms: b.histogram.quantile(0.95),
      histogram: b.histogram.snapshot(),
      endpoints,
      lastErrorReason: b.lastErrorReason,
    };
  }

  private toRouteSnapshot(key: string, r: RouteBucket): RouteSnapshot {
    const route = key.slice(r.pool.length + 2);
    return {
      route,
      pool: r.pool,
      requestCount: r.requestCount,
      errorCount: r.errorCount,
      latencyP50Ms: r.histogram.quantile(0.5),
      latencyP95Ms: r.histogram.quantile(0.95),
    };
  }
}
