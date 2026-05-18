# auth

Pluggable inbound authentication. Two strategies ship today:

| Strategy | Headers                                                                  | When to pick                                   |
| -------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| `bearer` | `Authorization: Bearer <token>`                                          | Partner uses OAuth-style opaque tokens.        |
| `hmac`   | `x-gateway-key-id`, `x-gateway-signature`, `x-gateway-timestamp`         | Partner signs requests with a shared secret.   |

Both implement the same `AuthStrategy` contract, so the policy layer
treats them uniformly. Adding a third (mTLS, JWT, partner-issued
session) is a new class, not a new branch in middleware.

## Sharp design question - on route, on pool, or both?

**Route.** Pool is a topology concern - "which upstreams answer this
class of traffic". Auth is a policy concern - "who is allowed to make
this call". Two routes that hit the same pool can legitimately have
different auth (read public, write HMAC-signed), and that distinction
lives at the route. Pool-level auth would conflate the two and force
pool-wide reconfiguration every time a single endpoint's security
needs changed.

Declared via `createAuthPolicy(rules, { defaultStrategy? })`:

```ts
const policy = createAuthPolicy([
  { method: 'GET',  path: '/v1/health',             /* public */ },
  { method: 'GET',  path: '/v1/identity/me',        strategy: bearer },
  { method: 'POST', path: '/v1/billing/invoice',    strategy: hmac   },
]);
```

`defaultStrategy` is the fallback for routes not in the rules list -
absent default means "public by default". For partner gateways the
safer choice is `defaultStrategy: hmac` so a new route added to the
router does not silently ship without auth.

## Rejection semantics

`AuthOutcome` carries a structured `reason`:

- `missing_credentials` - header absent / unparseable shape
- `invalid_credentials` - signature mismatch, unknown token, unknown
  key id
- `expired_credentials` - HMAC timestamp outside skew window

The middleware turns rejection into a `401` with `WWW-Authenticate`
naming the strategy and a JSON body carrying `{ error, reason, detail }`.
Reason codes are stable so alerts and dashboards can fan out on them
without parsing free-form strings.

## HMAC signing envelope

Signature covers `<method>\n<path>\n<timestamp>` only. Body is
intentionally out of scope: covering it would force the gateway to
buffer requests just to verify, which fights with streaming proxies.
Body-integrity is a higher-level concern (RFC 9421 payload signing,
etc.) and can slot in as a separate strategy.
