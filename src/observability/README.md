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

## Wiring

```ts
const collector = new InMemoryMetricsCollector();
const handler = composeMiddleware(
  [
    createTraceMiddleware({ recorder }),
    createAuthMiddleware(policy),
    createMetricsMiddleware({ collector }),
  ],
  terminal,
);
```

Order matters: `metrics` sits after `trace` (so requests carry `trace_id`)
and after `auth` (so 401/403 still increment `errorCount` for the
operator). Rate-limit and breaker decisions stamp `ctx.log` fields that
the metrics middleware reads to derive `RequestOutcome`.

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
