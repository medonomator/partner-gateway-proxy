/**
 * Trace middleware.
 *
 * - Parses incoming `traceparent`; mints a fresh context if absent or
 *   malformed.
 * - Starts a `gateway.proxy` span using the incoming context as parent.
 * - Builds the upstream context (same traceId, parentSpanId =
 *   span.spanId, flags preserved) and writes it back as `traceparent`
 *   on the outgoing upstream request. So one hop = one span = one
 *   parent-child link, matching the W3C model.
 * - Preserves `tracestate` end-to-end without parsing.
 * - Drops correlation fields (`trace_id`, `span_id`, `parent_span_id`)
 *   into `ctx.log` so structured logs can stitch a request across
 *   gateway -> upstream -> downstream without manual digging.
 */
import { Headers, type Middleware } from '../http';
import {
  defaultIdGenerator,
  formatTraceparent,
  newTraceContext,
  parseTraceparent,
  type IdGenerator,
} from './w3c';
import type { SpanRecorder, TraceContext } from './types';

export interface TraceMiddlewareOptions {
  readonly recorder: SpanRecorder;
  readonly idGenerator?: IdGenerator;
  readonly headerTraceparent?: string;
  readonly headerTracestate?: string;
  readonly spanName?: string;
}

export function createTraceMiddleware(options: TraceMiddlewareOptions): Middleware {
  const recorder = options.recorder;
  const idGen = options.idGenerator ?? defaultIdGenerator;
  const headerTp = options.headerTraceparent ?? 'traceparent';
  const headerTs = options.headerTracestate ?? 'tracestate';
  const spanName = options.spanName ?? 'gateway.proxy';

  return async (ctx, next) => {
    const incomingTp = ctx.incoming.headers.get(headerTp);
    const incomingTs = ctx.incoming.headers.get(headerTs);
    const parent: TraceContext =
      parseTraceparent(incomingTp) ?? newTraceContext('01', idGen);

    const span = recorder.start(spanName, parent, {
      'http.method': ctx.incoming.method,
      'http.route': ctx.route.path,
      'gateway.pool': ctx.pool.name,
    });

    const upstreamContext: TraceContext = {
      version: '00',
      traceId: parent.traceId,
      parentSpanId: span.spanId,
      flags: parent.flags,
    };
    if (!ctx.upstream.headers) ctx.upstream.headers = new Headers();
    ctx.upstream.headers.set(headerTp, formatTraceparent(upstreamContext));
    if (incomingTs) ctx.upstream.headers.set(headerTs, incomingTs);

    ctx.state.trace = parent;
    ctx.state.span = span;
    ctx.log.trace_id = parent.traceId;
    ctx.log.span_id = span.spanId;
    ctx.log.parent_span_id = parent.parentSpanId;

    try {
      const response = await next();
      recorder.end(span, { 'http.status_code': response.status });
      return response;
    } catch (err) {
      recorder.end(span, {
        error: true,
        'error.message': err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
