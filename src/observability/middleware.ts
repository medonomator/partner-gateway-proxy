/**
 * Metrics middleware.
 *
 * Records one `RequestEvent` per request, capturing pool, route, status,
 * duration, outcome, and last error reason. Outcome is derived from the
 * response status plus signals dropped on `ctx.log` by upstream
 * middleware (auth, rate-limit, breaker, retry). This keeps the metrics
 * concern in one place without forcing every other layer to hold a
 * collector handle.
 *
 * Wiring order: place this middleware **outermost** in the pipeline.
 * Auth, rate-limit and breaker layers short-circuit (they return a
 * response without calling `next()`), so any middleware downstream of
 * them never sees rejected requests. The metrics layer is the operator's
 * eye on those rejections, so it MUST sit above them.
 */
import type { Middleware } from '../http';
import type { MetricsCollector, RequestEvent, RequestOutcome } from './types';

export interface MetricsMiddlewareOptions {
  readonly collector: MetricsCollector;
  readonly clock?: () => number;
}

// Precedence order matters: structured ctx.log signals beat raw status.
// A 429 with rate_limit_outcome=rejected must be classified as
// rate_limited, not as a generic client_error - the operator chart needs
// to separate "rejected by policy" from "the client sent garbage". Same
// for breaker_open. New ctx.log flags should be added ABOVE the status
// fallbacks, or the classification will silently regress.
function deriveOutcome(status: number, logFields: Record<string, unknown>): RequestOutcome {
  if (logFields.rate_limit_outcome === 'rejected') return 'rate_limited';
  if (logFields.breaker_outcome === 'circuit_open') return 'breaker_open';
  if (status >= 500) return 'upstream_error';
  if (status >= 400) return 'client_error';
  return 'success';
}

function deriveErrorReason(
  outcome: RequestOutcome,
  logFields: Record<string, unknown>,
): string | undefined {
  if (outcome === 'success') return undefined;
  if (typeof logFields.auth_outcome === 'string' && logFields.auth_outcome !== 'allowed' && logFields.auth_outcome !== 'public') {
    return `auth:${logFields.auth_outcome}`;
  }
  if (outcome === 'rate_limited') return 'rate_limited';
  if (outcome === 'breaker_open') return 'breaker_open';
  if (typeof logFields.upstream_error === 'string') return logFields.upstream_error;
  return outcome;
}

export function createMetricsMiddleware(options: MetricsMiddlewareOptions): Middleware {
  const collector = options.collector;
  const clock = options.clock ?? Date.now;
  return async (ctx, next) => {
    const started = clock();
    let response;
    try {
      response = await next();
    } catch (err) {
      const durationMs = clock() - started;
      const event: RequestEvent = {
        pool: ctx.pool.name,
        route: ctx.route.path,
        status: 500,
        durationMs,
        outcome: 'upstream_error',
        errorReason: err instanceof Error ? err.message : String(err),
      };
      collector.recordRequest(event);
      throw err;
    }
    const durationMs = clock() - started;
    const outcome = deriveOutcome(response.status, ctx.log);
    const event: RequestEvent = {
      pool: ctx.pool.name,
      route: ctx.route.path,
      status: response.status,
      durationMs,
      outcome,
      errorReason: deriveErrorReason(outcome, ctx.log),
    };
    collector.recordRequest(event);
    return response;
  };
}
