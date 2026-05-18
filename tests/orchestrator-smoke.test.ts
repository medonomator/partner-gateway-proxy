/**
 * Replayable smoke test for graceful upstream failover.
 *
 * Two in-process mock upstreams. The orchestrator drives the real
 * routing -> breaker -> balancer -> retry -> observability path through
 * `composeMiddleware([metrics, trace, orchestrator])`. We mark one
 * upstream dead and assert the gateway:
 *   - still answers 200 via the survivor,
 *   - counts the failover in the snapshot,
 *   - reports the final upstream URL,
 *   - keeps the trace context attached to the outgoing call,
 *   - trips the breaker on the dead endpoint after enough failures so
 *     subsequent requests skip it,
 *   - does NOT retry a non-idempotent POST against the dead endpoint.
 *
 * Mock upstreams live as plain functions instead of real http servers so
 * the test is deterministic and fast. The "dead endpoint" semantics are
 * captured by a flag on the mock; toggling it between requests matches
 * what an operator would observe: an endpoint that was healthy a moment
 * ago starts returning 503.
 */
import { describe, expect, it } from 'vitest';
import { Headers, composeMiddleware, type GatewayResponse } from '../src/http';
import { WeightedRoundRobinBalancer } from '../src/balance';
import { createCircuitBreaker } from '../src/policy/circuit-breaker';
import {
  InMemoryMetricsCollector,
  createMetricsMiddleware,
} from '../src/observability';
import {
  InMemorySpanRecorder,
  createTraceMiddleware,
  parseTraceparent,
} from '../src/tracing';
import {
  createOrchestratorTerminal,
  type UpstreamSend,
} from '../src/orchestrator';
import type { Route, UpstreamPool } from '../src/routing';
import { makeCtx } from './_helpers/ctx';

type FailureMode = 'status_503' | 'throw_econnreset';

interface MockUpstream {
  url: string;
  alive: boolean;
  failureMode: FailureMode;
  calls: Array<{ traceparent: string | undefined; body: unknown }>;
  kill(mode?: FailureMode): void;
}

function createMockUpstream(url: string): MockUpstream {
  const m: MockUpstream = {
    url,
    alive: true,
    failureMode: 'status_503',
    calls: [],
    kill(mode: FailureMode = 'status_503') {
      m.alive = false;
      m.failureMode = mode;
    },
  };
  return m;
}

function buildSend(...mocks: MockUpstream[]): UpstreamSend {
  const byUrl = new Map(mocks.map((m) => [m.url, m] as const));
  return async (endpoint, ctx) => {
    const mock = byUrl.get(endpoint.url);
    if (!mock) throw new Error(`no mock for ${endpoint.url}`);
    mock.calls.push({
      traceparent: ctx.upstream.headers.get('traceparent') ?? undefined,
      body: ctx.incoming.body,
    });
    if (!mock.alive) {
      if (mock.failureMode === 'throw_econnreset') {
        throw new Error('ECONNRESET');
      }
      const r: GatewayResponse = {
        status: 503,
        headers: new Headers(),
        body: { error: 'upstream_dead' },
      };
      return r;
    }
    return { status: 200, headers: new Headers(), body: { from: mock.url } };
  };
}

const POOL: UpstreamPool = {
  name: 'partners-eu',
  endpoints: [
    { url: 'https://eu-a.local' },
    { url: 'https://eu-b.local' },
  ],
};

const idempotentRoute: Route = { method: 'GET', path: '/v1/me', pool: 'partners-eu' };
const writeRoute: Route = { method: 'POST', path: '/v1/charge', pool: 'partners-eu' };

function buildPipeline(send: UpstreamSend, collector: InMemoryMetricsCollector) {
  const breaker = createCircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
  const balancer = new WeightedRoundRobinBalancer([
    { url: 'https://eu-a.local', baseWeight: 1 },
    { url: 'https://eu-b.local', baseWeight: 1 },
  ]);
  const recorder = new InMemorySpanRecorder();
  const terminal = createOrchestratorTerminal({
    pool: POOL,
    breaker,
    balancer,
    send,
    collector,
  });
  return composeMiddleware(
    [
      createMetricsMiddleware({ collector }),
      createTraceMiddleware({ recorder }),
    ],
    terminal,
  );
}

describe('orchestrator smoke: graceful failover', () => {
  it('answers 200 via the survivor when one upstream is dead', async () => {
    const eu_a = createMockUpstream('https://eu-a.local');
    const eu_b = createMockUpstream('https://eu-b.local');
    const collector = new InMemoryMetricsCollector();
    const handler = buildPipeline(buildSend(eu_a, eu_b), collector);

    // eu-a is dead from request time; with WRR ties resolving to the
    // first declared endpoint, the gateway picks eu-a first, observes
    // 503, and fails over to eu-b within the same request.
    eu_a.kill();

    const response = await handler(
      makeCtx({
        pool: POOL,
        route: idempotentRoute,
        headers: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ from: 'https://eu-b.local' });
    expect(eu_a.calls).toHaveLength(1);
    expect(eu_b.calls).toHaveLength(1);

    const pool = collector.snapshot().pools.find((p) => p.pool === 'partners-eu')!;
    expect(pool.failoverAttempts).toBe(1);
    expect(pool.lastFinalUpstreamUrl).toBe('https://eu-b.local');
    expect(pool.lastFinalUpstreamOutcome).toBe('success');

    // Trace context propagates: the call that hit eu-b carries the same
    // traceId as the incoming traceparent.
    const surviving = eu_b.calls.at(-1)!;
    const tp = parseTraceparent(surviving.traceparent);
    expect(tp).not.toBeNull();
    expect(tp!.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('trips the breaker on the dead endpoint and stops sending traffic to it', async () => {
    const eu_a = createMockUpstream('https://eu-a.local');
    const eu_b = createMockUpstream('https://eu-b.local');
    const collector = new InMemoryMetricsCollector();
    const handler = buildPipeline(buildSend(eu_a, eu_b), collector);

    eu_a.kill();
    // Four requests, threshold=2. After the first two failures against
    // eu-a the breaker opens; later requests must skip eu-a at the
    // breaker stage and go straight to eu-b.
    for (let i = 0; i < 4; i++) {
      const r = await handler(makeCtx({ pool: POOL, route: idempotentRoute }));
      expect(r.status).toBe(200);
    }

    expect(eu_a.calls.length).toBeLessThanOrEqual(2);
    expect(eu_b.calls.length).toBeGreaterThanOrEqual(2);

    const pool = collector.snapshot().pools.find((p) => p.pool === 'partners-eu')!;
    expect(pool.lastFinalUpstreamUrl).toBe('https://eu-b.local');
    expect(pool.lastFinalUpstreamOutcome).toBe('success');
  });

  it('fails over on a thrown connection error (real connection drop, not a 503 body)', async () => {
    // Distinct from the 503-response path: here the send callback throws,
    // simulating ECONNRESET at the transport layer. The orchestrator must
    // still fail over for an idempotent route and the survivor must
    // produce a real 200, not a synthetic gateway response.
    const eu_a = createMockUpstream('https://eu-a.local');
    const eu_b = createMockUpstream('https://eu-b.local');
    const collector = new InMemoryMetricsCollector();
    const handler = buildPipeline(buildSend(eu_a, eu_b), collector);

    eu_a.kill('throw_econnreset');

    const response = await handler(
      makeCtx({ pool: POOL, route: idempotentRoute }),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ from: 'https://eu-b.local' });
    expect(eu_a.calls).toHaveLength(1);
    expect(eu_b.calls).toHaveLength(1);

    const pool = collector.snapshot().pools.find((p) => p.pool === 'partners-eu')!;
    expect(pool.failoverAttempts).toBe(1);
    expect(pool.lastFinalUpstreamUrl).toBe('https://eu-b.local');
    expect(pool.lastFinalUpstreamOutcome).toBe('success');
  });

  it('does NOT retry a non-idempotent POST when the first endpoint is dead', async () => {
    const eu_a = createMockUpstream('https://eu-a.local');
    const eu_b = createMockUpstream('https://eu-b.local');
    eu_a.kill();
    const collector = new InMemoryMetricsCollector();
    const handler = buildPipeline(buildSend(eu_a, eu_b), collector);

    const response = await handler(
      makeCtx({ pool: POOL, route: writeRoute, body: { amount: 100 } }),
    );

    expect(response.status).toBe(503);
    expect(eu_a.calls).toHaveLength(1);
    expect(eu_b.calls).toHaveLength(0);
    const pool = collector.snapshot().pools.find((p) => p.pool === 'partners-eu')!;
    expect(pool.failoverAttempts).toBe(0);
  });
});
