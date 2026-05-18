# tracing

W3C Trace Context propagation + per-hop spans.

## What flows in, what flows out

```
incoming request                      upstream request
─────────────────                     ────────────────
traceparent: 00-<traceA>-<spanX>-01   traceparent: 00-<traceA>-<spanY>-01
tracestate: vendor=foo                 tracestate: vendor=foo
                                       (same traceA, same flags, new spanY = gateway span id)
```

- `traceparent` is parsed; only version `00` is accepted. Malformed or
  zero-valued ids trigger a fresh trace (we never propagate an
  ill-formed chain).
- `tracestate` is forwarded verbatim; we do not parse vendor entries
  (W3C requires gateways to preserve unknown entries unchanged).
- The gateway emits a `gateway.proxy` span with `parent_span_id` =
  whatever the incoming `traceparent` carried. The upstream call gets
  `parent_span_id` = the gateway span's id, so the resulting trace
  reads `caller → gateway → upstream` end-to-end.

## Correlation in logs

The middleware drops these fields into `ctx.log`:

- `trace_id` - the global identifier; one request, one value across
  gateway and every upstream that respects W3C
- `span_id` - the gateway-side span; lets you split latency between
  "time in gateway" and "time in upstream" when reading logs
- `parent_span_id` - whichever caller invoked us; needed to stitch
  back to a partner's own trace

Wire `ctx.log` into your structured logger of choice (pino, bunyan,
internal). The contract is the field names, not a specific library.

## Replacing the recorder

`InMemorySpanRecorder` is the dev/test default; it just appends spans
to an array and exposes them via `snapshot()`. Production swaps it
for an OTLP exporter or vendor SDK behind the same `SpanRecorder`
interface, no middleware changes.
