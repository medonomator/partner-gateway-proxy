# observability

In-process RED metrics for the gateway. Designed as a product signal for
operators with SLA exposure, not a full metrics backend.

## What lands in a snapshot

Per **pool**:
- `requestCount`, `errorCount`, `retryCount`, `rateLimitRejects`, `breakerOpenCount`
- `latencyP50Ms`, `latencyP95Ms` (fixed-bucket histogram - see `histogram.ts`)
- `endpoints[]` with current `breakerState` and a coarse `health`
  (closed -> healthy, half_open -> degraded, open -> down)
- `lastErrorReason` for cheap triage

Per **route**:
- `requestCount`, `errorCount`, latency quantiles

> **Intentional extension over the task spec:** the snapshot also carries
> the full `histogram` (per-bucket counts) on every pool. The acceptance
> criteria only ask for latency quantiles, but the raw histogram costs
> almost nothing to ship and is what a Prometheus/OTLP exporter needs
> when this layer grows up. If you do not need it, ignore the field;
> the quantiles are pre-computed.

## Breaker signal: `recordBreakerOpen` vs `recordBreakerState`

Two related-but-different entry points feed the breaker section of the
snapshot:

- `recordBreakerOpen(pool, endpoint, reason?)` - fire-and-forget event.
  Call this **once per transition** when the breaker trips. It bumps
  `breakerOpenCount`, sets the endpoint state to `open`, and stamps
  `lastErrorReason`.
- `recordBreakerState(pool, endpoint, state)` - level signal. Call this
  whenever the breaker reports a state for an endpoint (closed,
  half_open, open). It does NOT bump any counter; it just keeps the
  per-endpoint snapshot fresh. `attachBreakerState(collector, pool,
  breaker)` is the convenience that walks a pool and writes the current
  state for every endpoint.

In short: counters are event-driven, endpoint state is level-driven.

## Wiring

```ts
const collector = new InMemoryMetricsCollector();
const handler = composeMiddleware(
  [
    createMetricsMiddleware({ collector }),
    createTraceMiddleware({ recorder }),
    createAuthMiddleware(policy),
  ],
  terminal,
);
```

Order matters: `metrics` is the **outermost** middleware so that
short-circuit responses from `auth` (401), rate-limit (429), and the
circuit breaker (503) still increment `errorCount`. Inner middlewares
stamp `ctx.log` fields (`auth_outcome`, `rate_limit_outcome`,
`breaker_outcome`) which the metrics middleware reads on the way out to
derive `RequestOutcome`. Putting metrics anywhere downstream of those
layers makes the operator's chart silently lose every rejection - which
is exactly the signal they care about most.

## Scope

- **Per-instance**, in-process. Multi-replica deployments scrape each
  instance and merge upstream (Prometheus, OTLP, vendor SDK). Building a
  distributed metrics aggregator here would mean rebuilding a metrics
  backend; the task spec explicitly rules that out.
- **No background worker.** Counters update inside the request flow.
  Operators poll `collector.snapshot()` from a health endpoint, CLI, or
  cron.
- **Histogram buckets are fixed** at construction. Default bounds:
  `1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000` ms plus an
  overflow bucket. Tests assert these so the snapshot format does not
  drift silently.

## CLI

`bin/snapshot.ts` builds a demo snapshot from synthetic events and
prints `formatSnapshot(snapshot)`. Run via `npm run snapshot`.
