import { describe, expect, it } from 'vitest';
import { Headers, composeMiddleware, type FinalHandler, type Middleware } from '../src/http';
import { InMemoryMetricsCollector, createMetricsMiddleware } from '../src/observability';
import { makeCtx } from './_helpers/ctx';

function fakeClock(initial: number) {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('createMetricsMiddleware', () => {
  it('records a successful 200 with the elapsed duration', async () => {
    const clock = fakeClock(1000);
    const collector = new InMemoryMetricsCollector();
    const mw = createMetricsMiddleware({ collector, clock: clock.now });
    const terminal: FinalHandler = async () => {
      clock.advance(45);
      return { status: 200, headers: new Headers() };
    };
    const handler = composeMiddleware([mw], terminal);
    await handler(makeCtx());

    const [pool] = collector.snapshot().pools;
    expect(pool.requestCount).toBe(1);
    expect(pool.errorCount).toBe(0);
    expect(pool.histogram.sumMs).toBe(45);
  });

  it('classifies 5xx as upstream_error and 4xx as client_error', async () => {
    const collector = new InMemoryMetricsCollector();
    const mw = createMetricsMiddleware({ collector, clock: () => 0 });
    let status = 500;
    const terminal: FinalHandler = async () => ({ status, headers: new Headers() });
    const handler = composeMiddleware([mw], terminal);

    status = 502;
    await handler(makeCtx());
    status = 404;
    await handler(makeCtx());

    const [pool] = collector.snapshot().pools;
    expect(pool.requestCount).toBe(2);
    expect(pool.errorCount).toBe(2);
  });

  it('reads ctx.log.rate_limit_outcome=rejected to attribute rate-limited requests', async () => {
    const collector = new InMemoryMetricsCollector();
    const mw = createMetricsMiddleware({ collector, clock: () => 0 });
    const stamp: Middleware = async (ctx, next) => {
      ctx.log.rate_limit_outcome = 'rejected';
      return next();
    };
    const terminal: FinalHandler = async () => ({
      status: 429,
      headers: new Headers(),
    });
    const handler = composeMiddleware([mw, stamp], terminal);
    await handler(makeCtx());
    const [pool] = collector.snapshot().pools;
    expect(pool.rateLimitRejects).toBe(1);
  });

  it('records a synthetic 500 if downstream throws, then rethrows', async () => {
    const collector = new InMemoryMetricsCollector();
    const mw = createMetricsMiddleware({ collector, clock: () => 0 });
    const handler = composeMiddleware(
      [mw],
      async () => {
        throw new Error('boom');
      },
    );
    await expect(handler(makeCtx())).rejects.toThrow('boom');
    const [pool] = collector.snapshot().pools;
    expect(pool.requestCount).toBe(1);
    expect(pool.errorCount).toBe(1);
    expect(pool.lastErrorReason).toBe('boom');
  });

  it('uses auth_outcome from ctx.log as the error reason on 401', async () => {
    const collector = new InMemoryMetricsCollector();
    const mw = createMetricsMiddleware({ collector, clock: () => 0 });
    const stamp: Middleware = async (ctx) => {
      ctx.log.auth_outcome = 'invalid_credentials';
      return { status: 401, headers: new Headers() };
    };
    const handler = composeMiddleware([mw, stamp], async () => ({
      status: 200,
      headers: new Headers(),
    }));
    await handler(makeCtx());
    const [pool] = collector.snapshot().pools;
    expect(pool.lastErrorReason).toBe('auth:invalid_credentials');
  });
});
