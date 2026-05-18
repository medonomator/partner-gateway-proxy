/**
 * Budget alert types.
 *
 * A budget rule is a threshold (warning + critical) on a single
 * derived metric. The detector walks a snapshot, evaluates each rule
 * against pool- or route-scoped numbers, and emits one alert per
 * breach with severity, observed value, threshold and a
 * human-readable reason.
 *
 * The shape is deliberately flat: budgets is a pure function over
 * snapshot, so the alert array is the only output. CLI, future HTTP
 * exposure and downstream tooling can consume the same array without
 * re-deriving anything.
 */

export type AlertSeverity = 'warning' | 'critical';

export type AlertMetric =
  | 'error_rate'
  | 'p95_latency_ms'
  | 'retry_rate'
  | 'breaker_open_rate';

export type AlertScope = 'pool' | 'route';

export interface BudgetAlert {
  readonly scope: AlertScope;
  /** Pool name for `scope: pool`; route path for `scope: route`. */
  readonly target: string;
  /** Pool the target belongs to (equal to `target` when `scope: pool`). */
  readonly pool: string;
  readonly metric: AlertMetric;
  readonly observed: number;
  readonly threshold: number;
  readonly severity: AlertSeverity;
  readonly reason: string;
}

export interface BudgetThreshold {
  readonly warning?: number;
  readonly critical?: number;
}

export interface PoolBudgetRules {
  readonly errorRate?: BudgetThreshold;
  readonly p95LatencyMs?: BudgetThreshold;
  readonly retryRate?: BudgetThreshold;
  readonly breakerOpenRate?: BudgetThreshold;
}

export interface RouteBudgetRules {
  readonly errorRate?: BudgetThreshold;
  readonly p95LatencyMs?: BudgetThreshold;
}

export interface BudgetRules {
  readonly pool?: PoolBudgetRules;
  readonly route?: RouteBudgetRules;
  /**
   * Minimum requestCount in the window before any check fires for the
   * target. Below this, the target is considered "low traffic" and all
   * checks are skipped to keep the operator chart quiet during warmup
   * or after a `reset()`. Default 20.
   */
  readonly minRequestsForChecks?: number;
}

export const DEFAULT_MIN_REQUESTS_FOR_CHECKS = 20;
