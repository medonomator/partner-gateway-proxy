# circuit-breaker

Per-endpoint circuit breaker for partner upstreams. Lives next to
rate-limit under `src/policy/` because it is a policy concern, not
transport - the breaker only knows about request outcomes, never about
HTTP clients or sockets.

## State machine

```
        failureThreshold
closed ───────────────────► open
  ▲                          │
  │                          │ cooldownMs
  │                          ▼
  │      probe success     half_open
  └──────────────────────────┤
                             │ probe failure
                             ▼
                            open  (cooldown restarts)
```

- `closed` - normal traffic, count consecutive failures
- `open` - traffic refused with `circuit_open` and a deterministic
  `retryAfterMs`; the next `beforeRequest` after cooldown transitions to
  `half_open` lazily (no timer)
- `half_open` - admits up to `halfOpenMaxProbes` (default 1) probe
  requests; the first probe outcome decides the next state. Any failure
  during the probe phase reopens; success closes

A successful call resets the consecutive-failure counter, so a single
glitch on a healthy upstream does not get amplified by accumulated state.

## Scope: endpoint, not pool

The breaker is keyed at the *endpoint* level (`pool|endpoint.url`). One
misbehaving endpoint must not take a whole pool offline - that is the
exact failure mode the breaker exists to prevent. `pickEndpoint()` in
`endpoint-selector.ts` enforces this: it walks the pool's endpoints in
order and returns the first one the breaker admits. Only when every
endpoint is open does the pool itself surface as `all_open`.

## What is "deteriorating upstream" vs "deteriorating gateway"

Observability signals the breaker exposes:

- `metrics().transitions.closedToOpen` - how many times *any* endpoint
  broke open. A steady non-zero rate here points at upstream health, not
  at gateway capacity.
- `metrics().perKey.<key>.state` - current state per endpoint. Aggregate
  this to spot "one endpoint of a pool is degraded" without flagging the
  whole pool.
- `metrics().perKey.<key>.lastOpenReason` - the error string that tripped
  the most recent open transition. Useful when correlating with upstream
  logs.

If `closedToOpen` is climbing across many keys at once, that is the
gateway-wide signal: the whole partner is degraded, not just one endpoint.
A spike concentrated on one key means just that endpoint.

## Contract notes

- `beforeRequest` is mutating: an admitted half-open call reserves a probe
  slot until the matching `recordOutcome`. Callers must call
  `recordOutcome` exactly once per admitted request, even if the upstream
  call timed out.
- A `recordOutcome` that arrives while the state is already `open` (e.g.
  for a request that was in flight when the breaker tripped) is ignored
  rather than retroactively re-opening; the open transition is driven by
  `beforeRequest` only.
