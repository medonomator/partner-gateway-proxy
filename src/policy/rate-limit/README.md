# rate-limit

Token-bucket rate limiter for the partner gateway. Lives under `src/policy/`
because it is a policy concern, not transport: nothing here knows about HTTP,
fastify, or BullMQ. The matched route arrives as plain data and a decision
goes out as plain data, which keeps it composable with whatever wiring the
gateway grows next (retry, breaker, fanout).

## Picking a backend

| Backend  | Use when                                                    | Avoid when                                          |
| -------- | ----------------------------------------------------------- | --------------------------------------------------- |
| InMemory | single-instance deploys, dev, tests, smoke checks           | running >1 replica - each replica has its own state |
| Redis    | multi-instance prod where all replicas share one bucket     | no Redis available; latency-critical hot paths      |

The two backends route their decisions through the same `bucket-math` module,
so swapping is a one-line change and the parity test in
`tests/rate-limit-redis.test.ts` proves they cannot drift.

## Picking a scope (key resolver)

`createKeyResolver({ scope })` answers "what counts as one bucket":

- `pool` (default choice for partner quotas) - one bucket per upstream pool.
  Right when the limit comes from the provider ("billing API allows 50 rps").
  This is also the *forward-compatible* default: if a future caller does not
  opt into a scope, pool-level limiting is the safest contract because it
  matches how partner-imposed quotas are enforced upstream.
- `route` - one bucket per (method, path). Right when two routes share a
  pool but have different SLAs (e.g. mutating writes throttled stricter
  than reads).
- `global` - one bucket for the whole gateway. Right as an emergency
  back-pressure switch, not as a steady-state policy.

`perClient: true` adds a `#<clientId>` suffix so the same scope is applied
per tenant. Combine with the auth layer that produces the client id.

## Decision shape

`acquire()` always returns a `LimitDecision`. On reject it carries the
reason tag, retry-after hint, and the limiter config that produced the
decision - enough for the future observability layer to emit structured
metrics without re-deriving anything.
