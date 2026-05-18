/**
 * In-memory circuit breaker keyed by upstream endpoint.
 *
 * State machine:
 *
 *   closed --(failureThreshold consecutive failures)--> open
 *   open   --(cooldownMs elapsed, on next beforeRequest)--> half_open
 *   half_open --(probe success)--> closed
 *   half_open --(probe failure)--> open  (cooldown restarts)
 *
 * `beforeRequest` is mutating: an admitted probe from half_open consumes a
 * probe slot until the matching `recordOutcome` lands. That keeps the
 * half_open phase from flooding a still-broken upstream just because
 * multiple callers are asking at once. The default `halfOpenMaxProbes = 1`
 * is the cautious choice; raise it only when the upstream tolerates a few
 * concurrent recovery probes.
 */
import type {
  BreakerKeySnapshot,
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitDecision,
  CircuitMetricsSnapshot,
  CircuitState,
  Outcome,
} from './types';

interface MutableBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  openedAtMs: number;
  openedTimes: number;
  openedReason?: string;
  probesInFlight: number;
}

interface Transitions {
  closedToOpen: number;
  openToHalfOpen: number;
  halfOpenToClosed: number;
  halfOpenToOpen: number;
}

function freshState(): MutableBreakerState {
  return {
    state: 'closed',
    consecutiveFailures: 0,
    openedAtMs: 0,
    openedTimes: 0,
    probesInFlight: 0,
  };
}

function validate(cfg: CircuitBreakerConfig): void {
  if (!(cfg.failureThreshold > 0)) {
    throw new Error(
      `circuit-breaker failureThreshold must be > 0, got ${cfg.failureThreshold}`,
    );
  }
  if (!(cfg.cooldownMs > 0)) {
    throw new Error(
      `circuit-breaker cooldownMs must be > 0, got ${cfg.cooldownMs}`,
    );
  }
  if (cfg.halfOpenMaxProbes !== undefined && !(cfg.halfOpenMaxProbes > 0)) {
    throw new Error(
      `circuit-breaker halfOpenMaxProbes must be > 0, got ${cfg.halfOpenMaxProbes}`,
    );
  }
}

export function createCircuitBreaker(
  config: CircuitBreakerConfig,
): CircuitBreaker {
  validate(config);
  const maxProbes = config.halfOpenMaxProbes ?? 1;
  const states = new Map<string, MutableBreakerState>();
  const transitions: Transitions = {
    closedToOpen: 0,
    openToHalfOpen: 0,
    halfOpenToClosed: 0,
    halfOpenToOpen: 0,
  };

  function get(key: string): MutableBreakerState {
    let s = states.get(key);
    if (!s) {
      s = freshState();
      states.set(key, s);
    }
    return s;
  }

  function beforeRequest(key: string, now?: number): CircuitDecision {
    const nowMs = now ?? Date.now();
    const s = get(key);

    if (s.state === 'closed') {
      return { admitted: true, key, state: 'closed', probe: false };
    }

    if (s.state === 'open') {
      const elapsed = nowMs - s.openedAtMs;
      if (elapsed >= config.cooldownMs) {
        s.state = 'half_open';
        s.probesInFlight = 0;
        transitions.openToHalfOpen++;
      } else {
        return {
          admitted: false,
          reason: 'circuit_open',
          key,
          state: 'open',
          retryAfterMs: config.cooldownMs - elapsed,
          openedReason: s.openedReason,
        };
      }
    }

    if (s.probesInFlight < maxProbes) {
      s.probesInFlight++;
      return { admitted: true, key, state: 'half_open', probe: true };
    }
    return {
      admitted: false,
      reason: 'circuit_open',
      key,
      state: 'half_open',
      retryAfterMs: 0,
      openedReason: s.openedReason,
    };
  }

  function recordOutcome(
    key: string,
    outcome: Outcome,
    options?: { readonly error?: string; readonly now?: number },
  ): CircuitState {
    const nowMs = options?.now ?? Date.now();
    const s = get(key);

    if (s.state === 'closed') {
      if (outcome === 'success') {
        s.consecutiveFailures = 0;
        return 'closed';
      }
      s.consecutiveFailures++;
      if (s.consecutiveFailures >= config.failureThreshold) {
        s.state = 'open';
        s.openedAtMs = nowMs;
        s.openedTimes++;
        s.openedReason = options?.error ?? `failureThreshold (${config.failureThreshold}) reached`;
        s.probesInFlight = 0;
        transitions.closedToOpen++;
      }
      return s.state;
    }

    if (s.state === 'half_open') {
      if (s.probesInFlight > 0) s.probesInFlight--;
      if (outcome === 'success') {
        s.state = 'closed';
        s.consecutiveFailures = 0;
        s.probesInFlight = 0;
        transitions.halfOpenToClosed++;
      } else {
        s.state = 'open';
        s.openedAtMs = nowMs;
        s.openedTimes++;
        s.openedReason = options?.error ?? 'half-open probe failed';
        s.probesInFlight = 0;
        transitions.halfOpenToOpen++;
      }
      return s.state;
    }

    // state === 'open' - an outcome arrived for a request that pre-dated the
    // open transition. We do not change state here; the next beforeRequest
    // call drives transitions out of `open`.
    return s.state;
  }

  function state(key: string): CircuitState {
    return states.get(key)?.state ?? 'closed';
  }

  function metrics(): CircuitMetricsSnapshot {
    const perKey = new Map<string, BreakerKeySnapshot>();
    for (const [k, s] of states) {
      perKey.set(k, {
        state: s.state,
        openedTimes: s.openedTimes,
        lastOpenReason: s.openedReason,
        consecutiveFailures: s.consecutiveFailures,
      });
    }
    return {
      transitions: { ...transitions },
      perKey,
    };
  }

  return { beforeRequest, recordOutcome, state, metrics };
}
