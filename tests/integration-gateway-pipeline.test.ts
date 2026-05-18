import { describe, expect, it } from 'vitest';
import {
  BearerAuthStrategy,
  createAuthMiddleware,
  createAuthPolicy,
} from '../src/auth';
import {
  Headers,
  composeMiddleware,
  type FinalHandler,
  type RequestContext,
} from '../src/http';
import {
  InMemorySpanRecorder,
  createTraceMiddleware,
  parseTraceparent,
} from '../src/tracing';
import type { Route } from '../src/routing';
import { makeCtx } from './_helpers/ctx';

const publicRoute: Route = { method: 'GET', path: '/v1/health', pool: 'echo' };
const protectedRoute: Route = { method: 'GET', path: '/v1/identity/me', pool: 'echo' };

const bearer = new BearerAuthStrategy({
  resolve: (t) => (t === 'good' ? { clientId: 'tenant-1' } : undefined),
});

function buildPipeline(seenUpstream: { headers?: Headers; ctx?: RequestContext }) {
  const recorder = new InMemorySpanRecorder();
  const trace = createTraceMiddleware({ recorder });
  const policy = createAuthPolicy([
    { method: 'GET', path: '/v1/health' },
    { method: 'GET', path: '/v1/identity/me', strategy: bearer },
  ]);
  const auth = createAuthMiddleware(policy);

  const terminal: FinalHandler = async (ctx) => {
    seenUpstream.headers = ctx.upstream.headers.clone();
    seenUpstream.ctx = ctx;
    return { status: 200, headers: new Headers(), body: 'ok' };
  };

  return { handler: composeMiddleware([trace, auth], terminal), recorder };
}

describe('gateway pipeline integration (trace + auth)', () => {
  it('proxies a public route, mints trace, and forwards traceparent', async () => {
    const seen: { headers?: Headers; ctx?: RequestContext } = {};
    const { handler, recorder } = buildPipeline(seen);
    const ctx = makeCtx({ route: publicRoute });

    const response = await handler(ctx);

    expect(response.status).toBe(200);
    expect(ctx.log.auth_outcome).toBe('public');
    expect(typeof ctx.log.trace_id).toBe('string');
    expect(typeof ctx.log.span_id).toBe('string');

    const upstream = parseTraceparent(seen.headers!.get('traceparent'));
    expect(upstream).not.toBeNull();
    expect(upstream!.traceId).toBe(ctx.log.trace_id);
    expect(upstream!.parentSpanId).toBe(ctx.log.span_id);

    expect(recorder.snapshot()).toHaveLength(1);
    expect(recorder.snapshot()[0].attributes['http.status_code']).toBe(200);
  });

  it('proxies a protected route with valid bearer, preserves incoming trace, sets child span', async () => {
    const seen: { headers?: Headers; ctx?: RequestContext } = {};
    const { handler } = buildPipeline(seen);
    const incoming =
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const ctx = makeCtx({
      route: protectedRoute,
      headers: {
        authorization: 'Bearer good',
        traceparent: incoming,
        tracestate: 'vendor=v',
      },
    });

    const response = await handler(ctx);

    expect(response.status).toBe(200);
    expect(ctx.log.auth_outcome).toBe('allowed');
    expect(ctx.log.auth_client).toBe('tenant-1');
    expect(ctx.log.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(ctx.log.parent_span_id).toBe('b7ad6b7169203331');

    const upstream = parseTraceparent(seen.headers!.get('traceparent'));
    expect(upstream!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(upstream!.parentSpanId).toBe(ctx.log.span_id);
    expect(upstream!.parentSpanId).not.toBe('b7ad6b7169203331');
    expect(seen.headers!.get('tracestate')).toBe('vendor=v');
  });

  it('rejects a protected route on bad bearer but still carries trace correlation', async () => {
    const seen: { headers?: Headers; ctx?: RequestContext } = {};
    const { handler, recorder } = buildPipeline(seen);
    const incoming =
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const ctx = makeCtx({
      route: protectedRoute,
      headers: { authorization: 'Bearer bad', traceparent: incoming },
    });

    const response = await handler(ctx);

    expect(response.status).toBe(401);
    expect(seen.headers).toBeUndefined();
    expect(ctx.log.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(ctx.log.auth_outcome).toBe('invalid_credentials');
    expect(recorder.snapshot()).toHaveLength(1);
    expect(recorder.snapshot()[0].attributes['http.status_code']).toBe(401);
  });
});
