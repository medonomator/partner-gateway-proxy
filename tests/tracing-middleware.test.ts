import { describe, expect, it } from 'vitest';
import { Headers, composeMiddleware, type FinalHandler } from '../src/http';
import {
  InMemorySpanRecorder,
  createTraceMiddleware,
  parseTraceparent,
} from '../src/tracing';
import { makeCtx } from './_helpers/ctx';

const fixedGen = {
  traceId: () => '0af7651916cd43dd8448eb211c80319c',
  spanId: () => 'aaaaaaaaaaaaaaaa',
};

const terminal: FinalHandler = async () => ({
  status: 200,
  headers: new Headers(),
  body: 'ok',
});

describe('createTraceMiddleware', () => {
  it('preserves incoming traceId and injects child span as upstream parent', async () => {
    const recorder = new InMemorySpanRecorder({ clock: () => 1000, idGenerator: fixedGen });
    const mw = createTraceMiddleware({ recorder, idGenerator: fixedGen });
    const handler = composeMiddleware([mw], terminal);

    const incoming =
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const ctx = makeCtx({ headers: { traceparent: incoming, tracestate: 'vendor=v' } });
    await handler(ctx);

    const upstream = ctx.upstream.headers.get('traceparent');
    const parsed = parseTraceparent(upstream);
    expect(parsed).not.toBeNull();
    expect(parsed!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(parsed!.parentSpanId).toBe('aaaaaaaaaaaaaaaa');
    expect(parsed!.flags).toBe('01');

    expect(ctx.upstream.headers.get('tracestate')).toBe('vendor=v');
    expect(ctx.log.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(ctx.log.span_id).toBe('aaaaaaaaaaaaaaaa');
    expect(ctx.log.parent_span_id).toBe('b7ad6b7169203331');
  });

  it('mints a fresh trace when no traceparent is present', async () => {
    const recorder = new InMemorySpanRecorder({ clock: () => 0, idGenerator: fixedGen });
    const mw = createTraceMiddleware({ recorder, idGenerator: fixedGen });
    const handler = composeMiddleware([mw], terminal);

    const ctx = makeCtx();
    await handler(ctx);

    expect(ctx.log.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(ctx.log.parent_span_id).toBe('aaaaaaaaaaaaaaaa');
    const upstream = parseTraceparent(ctx.upstream.headers.get('traceparent'));
    expect(upstream!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('mints a fresh trace when incoming traceparent is malformed', async () => {
    const recorder = new InMemorySpanRecorder({ clock: () => 0, idGenerator: fixedGen });
    const mw = createTraceMiddleware({ recorder, idGenerator: fixedGen });
    const handler = composeMiddleware([mw], terminal);

    const ctx = makeCtx({ headers: { traceparent: 'garbage' } });
    await handler(ctx);

    const upstream = parseTraceparent(ctx.upstream.headers.get('traceparent'));
    expect(upstream).not.toBeNull();
    expect(upstream!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('records a span with http.status_code attribute after response', async () => {
    const recorder = new InMemorySpanRecorder({ clock: () => 1234, idGenerator: fixedGen });
    const mw = createTraceMiddleware({ recorder, idGenerator: fixedGen });
    const handler = composeMiddleware([mw], terminal);

    await handler(makeCtx());

    const [span] = recorder.snapshot();
    expect(span.name).toBe('gateway.proxy');
    expect(span.attributes['http.status_code']).toBe(200);
    expect(span.attributes['http.method']).toBe('GET');
    expect(span.endMs).toBe(1234);
  });

  it('records span with error attributes if downstream throws', async () => {
    const recorder = new InMemorySpanRecorder({ idGenerator: fixedGen });
    const mw = createTraceMiddleware({ recorder, idGenerator: fixedGen });
    const handler = composeMiddleware(
      [mw],
      async () => {
        throw new Error('boom');
      },
    );

    await expect(handler(makeCtx())).rejects.toThrow('boom');
    const [span] = recorder.snapshot();
    expect(span.attributes.error).toBe(true);
    expect(span.attributes['error.message']).toBe('boom');
  });
});
