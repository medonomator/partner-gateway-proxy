# orchestrator

The seam where the gateway's primitives become one execution path.

`performUpstreamCall(ctx, options)` walks routing -> breaker -> balancer
-> retry -> observability per request. The `send` callback owns the
wire format (fetch, undici, raw http), which keeps the orchestrator
testable without sockets - see `tests/orchestrator-smoke.test.ts`.

## Flow per attempt

1. Balancer picks an endpoint, weighted by breaker-derived health
   (`closed -> healthy`, `half_open -> degraded`, `open -> down`).
2. `breaker.beforeRequest(endpointKey)` gates the call. If the circuit
   is open, the endpoint is silently skipped (no upstream call wasted,
   no attempt counted, no failover counted - see "Counters" below).
3. `send(endpoint, ctx)` runs. The response is classified:
   - `<400` -> success, breaker records success, `recordFinalUpstream`
     fires, request returns.
   - `>=400` in `retryOnStatuses` (default 502, 503, 504) -> failure,
     breaker records failure, retry happens if the route is idempotent.
   - Other `>=400` -> non-retryable failure, return the response as-is.
   - Thrown error -> network failure, retry if policy allows and route
     is idempotent.
4. After `maxAttempts` or after running out of healthy endpoints,
   return the last response or a synthetic 503 (see "Synthetic 503").

## Where iteration state lives

The balancer is stateless across iterations within a single request: it
picks based on the health snapshot it is handed, not on which endpoints
the caller has already tried. The orchestrator owns iteration state -
it keeps a `triedUrls` set and overlays `down` on those URLs in the
health snapshot it passes to the next `pick`. This split keeps the
balancer reusable (other callers can drive their own iteration) and
makes the orchestrator's loop the one place where "skip already-tried"
logic lives.

## Idempotency

Sharp question: where does the idempotency flag live - route policy or
request metadata?

**Route policy.** Per-request hints would force the gateway to trust
the caller, which is a double-charge footgun (a buggy client could mark
`POST /payments` as idempotent). The HTTP method gives a sane default
per RFC 9110:

| Method  | Default idempotent? |
| ------- | ------------------- |
| GET     | yes                 |
| PUT     | yes                 |
| DELETE  | yes                 |
| POST    | no                  |
| PATCH   | no                  |

The optional `idempotent` flag on `Route` overrides the default in
either direction.

## Counters that land in the snapshot

- `failoverAttempts` - bumps once per **real additional upstream call**
  against a different endpoint. A single-attempt success records zero.
  Breaker pre-skips (step 2 above) are **not** counted: no upstream
  call was made and no caller paid for the wasted hop, so surfacing
  them as failovers would inflate the signal. The breaker layer has
  its own counter (`breakerOpenCount`, surfaced by the breaker
  middleware on the request boundary) for the operator chart that
  cares about "how often did a circuit short-circuit a request".
- `lastFinalUpstreamUrl` / `lastFinalUpstreamOutcome` - the endpoint
  that produced the returned response and whether it succeeded or
  failed. Operators correlate this with breaker state and `lastErrorReason`
  for triage.

## Synthetic 503

If `send` throws on every healthy endpoint, or the orchestrator runs
out of admissible endpoints with no response in hand, it returns a
**gateway-synthesized** `503` with `body = { error: 'upstream_unavailable', reason }`.
This is a gateway response, not an upstream response - no upstream
ever produced it. The same shape is returned when a non-idempotent
route throws on its first (only) attempt: there is nothing safe to
retry and nothing to forward to the caller, so the gateway has to
manufacture a body.

The contract: callers should treat any `503` from the gateway as a
"transient, retryable on the client side" signal, regardless of whether
it came from a real upstream or from this synthetic path.

## What the orchestrator does NOT do

- It does not retry non-idempotent requests, ever, even on network
  error or 503. That contract is enforced in `upstream-call.ts` and
  pinned by tests.
- It does not back off between attempts. Retries are immediate failover
  across endpoints, not "retry the same endpoint after a delay". A
  delayed retry layer is a separate concern and would go in front of
  this one.
- It does not speak HTTP. The `send` callback is the wire-format
  boundary.
