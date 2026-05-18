import { describe, expect, it } from 'vitest';
import { Headers, type GatewayResponse } from '../src/http';
import {
  InMemoryMetricsCollector,
} from '../src/observability';
import {
  WeightedRoundRobinBalancer,
} from '../src/balance';
import { createCircuitBreaker } from '../src/policy/circuit-breaker';
import {
  performUpstreamCall,
  type UpstreamSend,
} from '../src/orchestrator';
import type { UpstreamPool } from '../src/routing';
import { makeCtx } from './_helpers/ctx';

const POOL: UpstreamPool = {
  name: 'p',
  endpoints: [{ url: 'https://a' }, { url: 'https://b' }],
};

function buildBalancer(): WeightedRoundRobinBalancer {
  return new WeightedRoundRobinBalancer([
    { url: 'https://a', baseWeight: 1 },
    { url: 'https://b', baseWeight: 1 },
  ]);
}

function ok(): GatewayResponse {
  return { status: 200, headers: new Headers(), body: 'ok' };
}

function fail(status: number): GatewayResponse {
  return { status, headers: new Headers(), body: { error: 'upstream' } };
}

describe('performUpstreamCall', () => {
  it('returns the response from the first healthy endpoint on success', async () => {
    const collector = new InMemoryMetricsCollector();
    const send: UpstreamSend = async () => ok();
    const result = await performUpstreamCall(makeCtx({ route: { method: 'GET', path: '/r', pool: 'p' } }), {
      pool: POOL,
      breaker: createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 }),
      balancer: buildBalancer(),
      send,
      collector,
    });
    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(1);
    expect(result.failovers).toBe(0);
    expect(collector.snapshot().pools[0].lastFinalUpstreamOutcome).toBe('success');
  });

  it('fails over to a second endpoint on retryable 503 for an idempotent route', async () => {
    const collector = new InMemoryMetricsCollector();
    const calls: string[] = [];
    const send: UpstreamSend = async (endpoint) => {
      calls.push(endpoint.url);
      return endpoint.url === 'https://a' ? fail(503) : ok();
    };
    const result = await performUpstreamCall(
      makeCtx({ route: { method: 'GET', path: '/r', pool: 'p' } }),
      {
        pool: POOL,
        breaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 1000 }),
        balancer: buildBalancer(),
        send,
        collector,
      },
    );
    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(2);
    expect(result.failovers).toBe(1);
    expect(calls).toEqual(['https://a', 'https://b']);
    const snap = collector.snapshot().pools[0];
    expect(snap.failoverAttempts).toBe(1);
    expect(snap.lastFinalUpstreamUrl).toBe('https://b');
    expect(snap.lastFinalUpstreamOutcome).toBe('success');
  });

  it('does NOT retry a non-idempotent POST even if first endpoint returns 503', async () => {
    const collector = new InMemoryMetricsCollector();
    const calls: string[] = [];
    const send: UpstreamSend = async (endpoint) => {
      calls.push(endpoint.url);
      return fail(503);
    };
    const result = await performUpstreamCall(
      makeCtx({ route: { method: 'POST', path: '/r', pool: 'p' } }),
      {
        pool: POOL,
        breaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 1000 }),
        balancer: buildBalancer(),
        send,
        collector,
      },
    );
    expect(result.response.status).toBe(503);
    expect(result.attempts).toBe(1);
    expect(result.failovers).toBe(0);
    expect(calls).toEqual(['https://a']);
    expect(collector.snapshot().pools[0].failoverAttempts).toBe(0);
  });

  it('retries a POST when the route explicitly opts into idempotency', async () => {
    let count = 0;
    const send: UpstreamSend = async () => (count++ === 0 ? fail(503) : ok());
    const result = await performUpstreamCall(
      makeCtx({ route: { method: 'POST', path: '/r', pool: 'p', idempotent: true } }),
      {
        pool: POOL,
        breaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 1000 }),
        balancer: buildBalancer(),
        send,
      },
    );
    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(2);
  });

  it('does NOT fail over on a non-retryable 400 client error', async () => {
    const calls: string[] = [];
    const send: UpstreamSend = async (endpoint) => {
      calls.push(endpoint.url);
      return fail(400);
    };
    const result = await performUpstreamCall(
      makeCtx({ route: { method: 'GET', path: '/r', pool: 'p' } }),
      {
        pool: POOL,
        breaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 1000 }),
        balancer: buildBalancer(),
        send,
      },
    );
    expect(result.response.status).toBe(400);
    expect(result.attempts).toBe(1);
    expect(calls).toEqual(['https://a']);
  });

  it('fails over on a thrown network error for an idempotent route', async () => {
    const send: UpstreamSend = async (endpoint) => {
      if (endpoint.url === 'https://a') throw new Error('econnreset');
      return ok();
    };
    const result = await performUpstreamCall(
      makeCtx({ route: { method: 'GET', path: '/r', pool: 'p' } }),
      {
        pool: POOL,
        breaker: createCircuitBreaker({ failureThreshold: 5, cooldownMs: 1000 }),
        balancer: buildBalancer(),
        send,
      },
    );
    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(2);
    expect(result.failovers).toBe(1);
  });

  it('returns synthetic 503 when every endpoint fails', async () => {
    const send: UpstreamSend = async () => {
      throw new Error('upstream_down');
    };
    const result = await performUpstreamCall(
      makeCtx({ route: { method: 'GET', path: '/r', pool: 'p' } }),
      {
        pool: POOL,
        breaker: createCircuitBreaker({ failureThreshold: 10, cooldownMs: 1000 }),
        balancer: buildBalancer(),
        send,
      },
    );
    expect(result.response.status).toBe(503);
    expect(result.attempts).toBe(2);
    expect(result.failovers).toBe(1);
  });

  it('skips an endpoint whose breaker is already open and goes straight to the next one', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 60_000 });
    breaker.recordOutcome('p|https://a', 'failure', { now: 0 });
    const calls: string[] = [];
    const send: UpstreamSend = async (endpoint) => {
      calls.push(endpoint.url);
      return ok();
    };
    const result = await performUpstreamCall(
      makeCtx({ route: { method: 'GET', path: '/r', pool: 'p' } }),
      {
        pool: POOL,
        breaker,
        balancer: buildBalancer(),
        send,
        now: () => 1,
      },
    );
    expect(result.response.status).toBe(200);
    expect(calls).toEqual(['https://b']);
    expect(result.attempts).toBe(1);
    expect(result.failovers).toBe(0);
  });
});
