/**
 * Upstream call orchestrator.
 *
 * Single execution path that ties routing -> breaker -> balancer ->
 * retry -> observability. The flow per attempt:
 *
 *   1. Ask the balancer for an endpoint from the pool, weighted by
 *      breaker-derived health (closed -> healthy, half_open -> degraded,
 *      open -> down). If no healthy endpoint exists, return 503.
 *   2. Consult `breaker.beforeRequest` for the chosen endpoint. If the
 *      circuit is open we skip the endpoint, count a failover, and try
 *      the next one (no upstream call wasted on a known-bad endpoint).
 *   3. Call `send(endpoint, ctx)`. Classify the response or thrown
 *      error: success -> record success and return; retryable failure
 *      -> record failure, count failover, continue if policy + idempotency
 *      both allow; non-retryable failure -> return the response as-is.
 *   4. After `maxAttempts` or after running out of healthy endpoints,
 *      return the last response or a synthetic 503.
 *
 * `recordFailoverAttempt` fires once per *additional* attempt against a
 * different endpoint - so a single-attempt success records zero
 * failovers. `recordFinalUpstream` fires exactly once per request with
 * the endpoint that produced the returned response (success or failure).
 */
import type { GatewayResponse, RequestContext } from '../http';
import { Headers } from '../http';
import type { UpstreamEndpoint, UpstreamPool } from '../routing';
import type { Balancer, HealthState } from '../balance';
import { healthFromBreaker } from '../balance';
import type { CircuitBreaker } from '../policy/circuit-breaker';
import { endpointKey } from '../policy/circuit-breaker';
import type { MetricsCollector } from '../observability';
import { isRouteIdempotent } from './idempotency';
import { classifyNetworkError, classifyResponse } from './retry';
import {
  DEFAULT_RETRY_POLICY,
  type OrchestratorOutcome,
  type RetryPolicy,
  type UpstreamFailureKind,
  type UpstreamSend,
} from './types';

export interface OrchestratorOptions {
  readonly pool: UpstreamPool;
  readonly breaker: CircuitBreaker;
  readonly balancer: Balancer;
  readonly send: UpstreamSend;
  readonly retryPolicy?: RetryPolicy;
  readonly collector?: MetricsCollector;
  readonly now?: () => number;
}

function buildHealth(pool: UpstreamPool, breaker: CircuitBreaker): Record<string, HealthState> {
  return { ...healthFromBreaker(pool, breaker) };
}

function syntheticUnavailable(reason: string): GatewayResponse {
  return {
    status: 503,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: { error: 'upstream_unavailable', reason },
  };
}

export async function performUpstreamCall(
  ctx: RequestContext,
  options: OrchestratorOptions,
): Promise<OrchestratorOutcome> {
  const policy = options.retryPolicy ?? DEFAULT_RETRY_POLICY;
  const idempotent = isRouteIdempotent(ctx.route);
  const collector = options.collector;
  const breaker = options.breaker;
  const pool = options.pool;
  const send = options.send;

  const triedUrls = new Set<string>();
  let lastResponse: GatewayResponse | undefined;
  let lastEndpoint: UpstreamEndpoint | undefined;
  let lastFailureReason = 'no_healthy_endpoints';
  let attempts = 0;
  let failovers = 0;

  const maxAttempts = idempotent ? Math.max(1, policy.maxAttempts) : 1;

  for (let i = 0; i < pool.endpoints.length && attempts < maxAttempts; i++) {
    const health = buildHealth(pool, breaker);
    for (const url of triedUrls) {
      health[url] = 'down';
    }
    const pick = options.balancer.pick(health);
    if (!pick.ok) break;
    if (triedUrls.has(pick.endpoint.url)) break;
    triedUrls.add(pick.endpoint.url);

    const key = endpointKey(pool, pick.endpoint);
    const breakerDecision = breaker.beforeRequest(key, options.now?.());
    if (!breakerDecision.admitted) {
      lastFailureReason = 'circuit_open';
      continue;
    }

    attempts++;
    if (attempts > 1) {
      failovers++;
      if (collector) {
        collector.recordFailoverAttempt(
          pool.name,
          ctx.route.path,
          lastEndpoint?.url ?? pick.endpoint.url,
        );
        collector.recordRetry(pool.name, ctx.route.path);
      }
    }

    let response: GatewayResponse | undefined;
    let networkError: Error | undefined;
    try {
      response = await send(pick.endpoint, ctx);
    } catch (err) {
      networkError = err instanceof Error ? err : new Error(String(err));
    }

    lastEndpoint = pick.endpoint;
    if (response) {
      const cls = classifyResponse(response, policy);
      if (cls.kind === 'success') {
        breaker.recordOutcome(key, 'success', { now: options.now?.() });
        if (collector) collector.recordFinalUpstream(pool.name, pick.endpoint.url, 'success');
        return { response, attempts, chosenEndpoint: pick.endpoint, failovers, idempotent };
      }
      lastResponse = response;
      lastFailureReason = describeFailure(cls.kind, response.status);
      breaker.recordOutcome(key, 'failure', {
        error: lastFailureReason,
        now: options.now?.(),
      });
      if (cls.kind === 'non_retryable_status' || !idempotent) {
        if (collector) collector.recordFinalUpstream(pool.name, pick.endpoint.url, 'failure');
        return { response, attempts, chosenEndpoint: pick.endpoint, failovers, idempotent };
      }
      continue;
    }

    // networkError path
    const cls = classifyNetworkError(policy);
    lastFailureReason = networkError?.message ?? 'network_error';
    breaker.recordOutcome(key, 'failure', { error: lastFailureReason, now: options.now?.() });
    if (!cls.retryable || !idempotent) {
      const synthetic = syntheticUnavailable(lastFailureReason);
      if (collector) collector.recordFinalUpstream(pool.name, pick.endpoint.url, 'failure');
      return {
        response: synthetic,
        attempts,
        chosenEndpoint: pick.endpoint,
        failovers,
        idempotent,
      };
    }
    // try the next endpoint
  }

  const response = lastResponse ?? syntheticUnavailable(lastFailureReason);
  if (collector && lastEndpoint) {
    collector.recordFinalUpstream(pool.name, lastEndpoint.url, 'failure');
  }
  return {
    response,
    attempts,
    chosenEndpoint: lastEndpoint,
    failovers,
    idempotent,
  };
}

function describeFailure(kind: UpstreamFailureKind, status?: number): string {
  if (kind === 'retryable_status') return `upstream_status_${status}`;
  if (kind === 'non_retryable_status') return `upstream_status_${status}`;
  return 'network_error';
}
