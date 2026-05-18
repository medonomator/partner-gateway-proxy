# http

The middleware seam. Routing produces a `RequestContext`; the pipeline
runs ordered `Middleware`s around a `FinalHandler` (the upstream proxy).
Each middleware sees the context, can mutate the upstream request, and
either calls `next()` to advance or returns a `GatewayResponse` to
short-circuit.

## Wiring order

```
incoming HTTP request
  │
  ▼
router.match(method, path)        ← src/routing
  │
  ▼   matched route + pool
RequestContext { incoming, route, pool, upstream, state, log }
  │
  ▼
composeMiddleware([
  traceMiddleware,                ← src/tracing  (mints/propagates traceparent, opens span)
  authMiddleware,                 ← src/auth     (verifies bearer or HMAC)
  ...                             ← future: rate-limit, breaker hooks
], proxyTerminal)                 ← issues the upstream call
```

`traceMiddleware` goes **first** so that the auth decision (and any
subsequent rejection) is already inside the request's span and carries
the same `trace_id` in logs. Reversing the order would orphan auth
rejections from the rest of the trace.

## RequestContext

- `incoming` - frozen view of the inbound request (method, path,
  headers, body)
- `route`, `pool` - whatever the router produced
- `upstream` - mutable; middlewares write headers (and eventually the
  outgoing URL) here, the terminal flushes it to the wire
- `state` - typed bag where middlewares stash strongly-typed values
  (auth identity, trace context, span handle)
- `log` - flat string-keyed bag of correlation fields ready to feed a
  structured logger

`state` vs `log`: same idea, different consumers. `state` is for
downstream middlewares; `log` is for the logger. Keeping them separate
means a redaction policy on log output cannot accidentally strip
trace context that another middleware still needs.
