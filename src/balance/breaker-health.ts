/**
 * Bridge from the circuit breaker's state to a HealthSnapshot the balancer
 * understands. Mapping is intentional:
 *
 *   closed    -> healthy   (full traffic share)
 *   half_open -> degraded  (allowed in the pick, but at reduced weight,
 *                           so probe traffic is real but bounded)
 *   open      -> down      (excluded entirely)
 *
 * The mapping lives here, not inside the balancer, so the balancer stays
 * source-agnostic: tests can hand it a hand-written HealthSnapshot, prod
 * uses this adapter, and a future active-probe layer could write its own.
 */
import { endpointKey } from '../policy/circuit-breaker';
import type { CircuitBreaker } from '../policy/circuit-breaker';
import type { UpstreamPool } from '../routing';
import type { HealthSnapshot, HealthState } from './types';

export function healthFromBreaker(
  pool: UpstreamPool,
  breaker: CircuitBreaker,
): HealthSnapshot {
  const snapshot: Record<string, HealthState> = {};
  for (const endpoint of pool.endpoints) {
    const state = breaker.state(endpointKey(pool, endpoint));
    snapshot[endpoint.url] =
      state === 'closed' ? 'healthy' : state === 'half_open' ? 'degraded' : 'down';
  }
  return snapshot;
}
