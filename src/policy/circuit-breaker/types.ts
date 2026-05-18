/**
 * Public types for the per-upstream circuit breaker.
 *
 * Scope choice (sharp question from the task spec): the breaker is keyed at
 * the endpoint level, not at the pool level. If one endpoint of a pool is
 * misbehaving, the rest of the pool stays serving traffic. Pool-level
 * scoping would convert one bad endpoint into a pool-wide outage and that
 * is exactly the failure mode the breaker exists to prevent.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

export type Outcome = 'success' | 'failure';

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly halfOpenMaxProbes?: number;
}

export type CircuitDecision =
  | {
      readonly admitted: true;
      readonly key: string;
      readonly state: CircuitState;
      readonly probe: boolean;
    }
  | {
      readonly admitted: false;
      readonly reason: 'circuit_open';
      readonly key: string;
      readonly state: 'open' | 'half_open';
      readonly retryAfterMs: number;
      readonly openedReason?: string;
    };

export interface BreakerKeySnapshot {
  readonly state: CircuitState;
  readonly openedTimes: number;
  readonly lastOpenReason?: string;
  readonly consecutiveFailures: number;
}

export interface CircuitMetricsSnapshot {
  readonly transitions: {
    readonly closedToOpen: number;
    readonly openToHalfOpen: number;
    readonly halfOpenToClosed: number;
    readonly halfOpenToOpen: number;
  };
  readonly perKey: ReadonlyMap<string, BreakerKeySnapshot>;
}

export interface CircuitBreaker {
  beforeRequest(key: string, now?: number): CircuitDecision;
  recordOutcome(
    key: string,
    outcome: Outcome,
    options?: { readonly error?: string; readonly now?: number },
  ): CircuitState;
  state(key: string): CircuitState;
  metrics(): CircuitMetricsSnapshot;
}
