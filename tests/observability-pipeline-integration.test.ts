/**
 * Regression guard: ctx.log fields stamped by auth and rate-limit
 * middleware must reach the metrics collector with the compose order
 * documented in src/observability/README.md. If someone reorders the
 * pipeline and accidentally puts metrics in front of auth, this test
 * fails before the operator's chart starts lying.
 */
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
  type Middleware,
} from '../src/http';
import {
  InMemoryMetricsCollector,
  createMetricsMiddleware,
} from '../src/observability';
import { InMemorySpanRecorder, createTraceMiddleware } from '../src/tracing';
import type { Route } from '../src/routing';
import { makeCtx } from './_helpers/ctx';

const protectedRoute: Route = { method: 'GET', path: '/v1/identity/me', pool: 'echo' };
const bearer = new BearerAuthStrategy({
  resolve: (t) => (t === 'good' ? { clientId: 'tenant-1' } : undefined),
});

function buildPipeline(rateLimitStamp?: Middleware) {
  const collector = new InMemoryMetricsCollector();
  const recorder = new InMemorySpanRecorder();
  const policy = createAuthPolicy([
    { method: 'GET', path: '/v1/identity/me', strategy: bearer },
  ]);
  const middlewares: Middleware[] = [
    createMetricsMiddleware({ collector, clock: () => 0 }),
    createTraceMiddleware({ recorder }),
    createAuthMiddleware(policy),
  ];
  if (rateLimitStamp) middlewares.push(rateLimitStamp);
  const terminal: FinalHandler = async () => ({
    status: 200,
    headers: new Headers(),
    body: 'ok',
  });
  return { handler: composeMiddleware(middlewares, terminal), collector };
}

describe('observability pipeline integration', () => {
  it('counts auth rejection as an error with auth_outcome as the reason', async () => {
    const { handler, collector } = buildPipeline();
    const ctx = makeCtx({
      route: protectedRoute,
      headers: { authorization: 'Bearer bad' },
    });
    const response = await handler(ctx);

    expect(response.status).toBe(401);
    const [pool] = collector.snapshot().pools;
    expect(pool.requestCount).toBe(1);
    expect(pool.errorCount).toBe(1);
    expect(pool.lastErrorReason).toBe('auth:invalid_credentials');
  });

  it('classifies a request stamped with rate_limit_outcome=rejected as rate_limited', async () => {
    const rejectAsLimited: Middleware = async (ctx) => {
      ctx.log.rate_limit_outcome = 'rejected';
      return { status: 429, headers: new Headers() };
    };
    const { handler, collector } = buildPipeline(rejectAsLimited);
    const ctx = makeCtx({
      route: protectedRoute,
      headers: { authorization: 'Bearer good' },
    });
    await handler(ctx);

    const [pool] = collector.snapshot().pools;
    expect(pool.requestCount).toBe(1);
    expect(pool.rateLimitRejects).toBe(1);
    expect(pool.errorCount).toBe(1);
  });

  it('classifies a request stamped with breaker_outcome=circuit_open as breaker_open', async () => {
    const trip: Middleware = async (ctx) => {
      ctx.log.breaker_outcome = 'circuit_open';
      return { status: 503, headers: new Headers() };
    };
    const { handler, collector } = buildPipeline(trip);
    const ctx = makeCtx({
      route: protectedRoute,
      headers: { authorization: 'Bearer good' },
    });
    await handler(ctx);

    const [pool] = collector.snapshot().pools;
    expect(pool.breakerOpenCount).toBe(1);
    expect(pool.errorCount).toBe(1);
  });

  it('counts a successful authenticated request as success with zero errors', async () => {
    const { handler, collector } = buildPipeline();
    const ctx = makeCtx({
      route: protectedRoute,
      headers: { authorization: 'Bearer good' },
    });
    await handler(ctx);

    const [pool] = collector.snapshot().pools;
    expect(pool.requestCount).toBe(1);
    expect(pool.errorCount).toBe(0);
  });
});
