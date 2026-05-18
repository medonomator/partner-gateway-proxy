# budgets

Budget alerts on top of the RED snapshot.

`detectBudgetBreaches(snapshot, rules)` is a pure function: it takes a
`GatewaySnapshot` (the contract emitted by `InMemoryMetricsCollector`)
and a `BudgetRules` config, and returns a stable list of
`BudgetAlert`s. No I/O, no clock, no collector mutation.

## Sharp question: rules in the collector, or beside it?

Beside it. The collector aggregates events into a snapshot - that is
mechanical and stable. Budget rules are policy: thresholds change with
seasonality, customer SLAs, on-call comfort levels. Mixing them would
couple a stable contract (the snapshot shape) to a volatile one
(thresholds and severity labels), and every operator tweak would
become a code change to the collector. Keeping budgets as a
*consumer* of the snapshot means:

- The snapshot contract is one place (`src/observability`), reused by
  the CLI, future HTTP exposure, and budgets without translation.
- New metrics land in the snapshot once and budgets opt into them
  later without breaking existing consumers.
- New rules land in budgets without touching the collector or its
  tests, so the RED-signal core stays cold and well-pinned.

## Signals

| Metric              | Scope         | Source field                                       |
| ------------------- | ------------- | -------------------------------------------------- |
| `error_rate`        | pool, route   | `errorCount / requestCount`                        |
| `p95_latency_ms`    | pool, route   | `latencyP95Ms` (cumulative-bucket quantile)        |
| `retry_rate`        | pool          | `retryCount / requestCount`                        |
| `breaker_open_rate` | pool          | `breakerOpenCount / requestCount`                  |

Each metric takes a `BudgetThreshold` with optional `warning` and
`critical` bounds. `critical` wins when both fire on the same
observation, so the operator gets one alert per metric per target,
never a duplicate pair.

## Low-traffic suppression

Below `minRequestsForChecks` (default 20) requests, all rules are
skipped for that target. The number is per-target (per pool, per
route), not per gateway. The reason: a single 500 in the first three
requests after a `reset()` is not a 33% error rate, it is a warmup
artifact. Without this suppression, every `reset()` would flood the
alert channel for the first few seconds. The number is intentionally
small so a misconfigured route still trips the alarm after a minute
or two of live traffic.

## Output shape

`BudgetAlert` carries:

- `scope` (`pool` or `route`) plus `target` (pool name or route path)
  and the `pool` the route belongs to (so a downstream chart can
  group route alerts under their pool).
- `metric`, `observed`, `threshold`, `severity` - so operators can
  reproduce the breach by hand.
- `reason` - one-line human-readable string for CLI / log lines.

The output is sorted (scope, target, metric, severity) so the same
input always produces the same array, regardless of map iteration
order.

## What this module does NOT do

- It does not page anyone. Wiring the alert array into PagerDuty,
  Slack or email is a separate concern - keeping alerting transport
  out of this layer means we can unit-test thresholds without mocking
  HTTP clients.
- It does not store state. Streak detection ("error rate has been
  above 5% for 3 windows in a row") belongs in a stateful layer above
  this one. Each call is a single-window evaluation.
- It does not own the snapshot. It only reads it.
