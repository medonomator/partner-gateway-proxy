/**
 * Bridge between the routing layer (pools of endpoints) and the breaker.
 *
 * Walks a pool's endpoints in declared order and returns the first one the
 * breaker admits. If every endpoint is open, the caller gets a deterministic
 * `all_open` decision with the soonest `retryAfterMs` across the pool. This
 * is the place that enforces the contract: one bad endpoint must not block
 * the others in the same pool.
 *
 * The selector is deliberately ignorant of HTTP, retries and load balancing.
 * Those concerns layer on top.
 */
import type { UpstreamEndpoint, UpstreamPool } from '../../routing';
import type { CircuitBreaker, CircuitState } from './types';

export type EndpointPick =
  | {
      readonly ok: true;
      readonly endpoint: UpstreamEndpoint;
      readonly key: string;
      readonly state: CircuitState;
      readonly probe: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: 'all_open';
      readonly pool: string;
      readonly retryAfterMs: number;
    };

export function endpointKey(
  pool: UpstreamPool,
  endpoint: UpstreamEndpoint,
): string {
  return `${pool.name}|${endpoint.url}`;
}

export function pickEndpoint(
  pool: UpstreamPool,
  breaker: CircuitBreaker,
  now?: number,
): EndpointPick {
  let earliestRetryMs = Number.POSITIVE_INFINITY;
  for (const endpoint of pool.endpoints) {
    const key = endpointKey(pool, endpoint);
    const decision = breaker.beforeRequest(key, now);
    if (decision.admitted) {
      return {
        ok: true,
        endpoint,
        key,
        state: decision.state,
        probe: decision.probe,
      };
    }
    if (decision.retryAfterMs < earliestRetryMs) {
      earliestRetryMs = decision.retryAfterMs;
    }
  }
  return {
    ok: false,
    reason: 'all_open',
    pool: pool.name,
    retryAfterMs: Number.isFinite(earliestRetryMs) ? earliestRetryMs : 0,
  };
}
