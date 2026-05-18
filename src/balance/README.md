# balance

Weighted round-robin endpoint selection inside a pool, with health-aware
weight adjustment. This is the layer that turns "we have a pool" into
"we sent the request to a specific upstream."

## Where it fits

```
   routing               policy/circuit-breaker
   ───────               ──────────────────────
   match(method, path)   per-endpoint state
       │                       │
       ▼                       ▼
   pool                   healthFromBreaker(pool, breaker)
       │                       │
       └──────────┬────────────┘
                  ▼
            balance.pick(health)
                  │
                  ▼
              endpoint
```

- `routing` answers "which pool serves this (method, path)".
- `circuit-breaker` answers "which endpoints inside that pool are
  currently safe to use", expressed as a `HealthSnapshot`.
- `balance` answers "given those weights and that health, which endpoint
  do I hit *now*".

The balancer never imports the breaker directly. Health is supplied as a
plain `HealthSnapshot`, so a future active-probe or partner-reported
health source can plug in without touching this module.

## Algorithm: smooth weighted round-robin

The same algorithm Nginx ships. Each endpoint has a `currentWeight`
accumulator that persists between calls. On every `pick()`:

1. For each eligible endpoint (effective weight > 0):
   `currentWeight += effectiveWeight`
2. Pick the endpoint with the largest `currentWeight`. Ties resolve to
   the endpoint that appears first in the declared order, so the
   sequence is deterministic.
3. Subtract the total eligible weight from the winner's `currentWeight`.

This produces a smooth distribution that hits the configured ratio
without bursting one endpoint and starving the others. Weights are
stable between calls - the accumulator is the state, not a per-request
counter.

## Health mapping

| Breaker state | Health      | Effective weight                |
| ------------- | ----------- | ------------------------------- |
| `closed`      | `healthy`   | `baseWeight`                    |
| `half_open`   | `degraded`  | `baseWeight * degradedFactor`   |
| `open`        | `down`      | `0` - excluded from the pick    |

`degradedFactor` defaults to `0.25` (a half-open endpoint should sip
traffic, not gulp it). Down endpoints also have their `currentWeight`
reset to `0`, so when the upstream recovers it re-enters the rotation
cleanly instead of carrying stale state forward.

## Multi-instance state - sharp question, explicit answer

Round-robin state is held in-process. When the gateway runs as N
replicas, you get N independent round-robins. That is **deliberately
out of scope for this PR**:

- Weight proportionality still holds per replica, so the partner sees
  the configured ratio even with no coordination.
- Distributed RR with N replicas requires either a shared counter
  (Redis), an external scheduler, or consistent hashing - each comes
  with different operational trade-offs and is its own decision.
- For partner gateways the load typically arrives evenly via the
  upstream LB, so per-replica drift averages out in practice.

If a future task needs strictly-coordinated picks across replicas, the
right answer is a new `DistributedBalancer` implementing the same
`Balancer` contract - not patches inside this file.
