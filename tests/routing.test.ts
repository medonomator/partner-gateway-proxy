import { describe, expect, it } from 'vitest';
import {
  createRouter,
  DEFAULT_POOLS,
  DEFAULT_ROUTES,
  type Route,
  type UpstreamPool,
} from '../src/routing';

const POOLS: ReadonlyArray<UpstreamPool> = [
  { name: 'a', endpoints: [{ url: 'https://a1' }, { url: 'https://a2' }] },
  { name: 'b', endpoints: [{ url: 'https://b1' }] },
];

const ROUTES: ReadonlyArray<Route> = [
  { method: 'GET', path: '/a', pool: 'a' },
  { method: 'POST', path: '/a', pool: 'a' },
  { method: 'GET', path: '/b', pool: 'b' },
];

describe('createRouter - matching', () => {
  const router = createRouter(ROUTES, POOLS);

  it('returns the route + pool on exact (method, path) match', () => {
    const result = router.match('GET', '/a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.route.pool).toBe('a');
    expect(result.pool.name).toBe('a');
    expect(result.pool.endpoints).toHaveLength(2);
  });

  it('distinguishes routes by HTTP method on the same path', () => {
    const getResult = router.match('GET', '/a');
    const postResult = router.match('POST', '/a');
    expect(getResult.ok).toBe(true);
    expect(postResult.ok).toBe(true);
    if (!getResult.ok || !postResult.ok) return;
    expect(getResult.route.method).toBe('GET');
    expect(postResult.route.method).toBe('POST');
  });

  it('returns no_route when path is unknown', () => {
    const result = router.match('GET', '/does-not-exist');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_route');
    expect(result.path).toBe('/does-not-exist');
  });

  it('returns method_not_allowed when path exists but method does not', () => {
    const result = router.match('DELETE', '/a');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('method_not_allowed');
    expect(result.allowedMethods).toEqual(
      expect.arrayContaining(['GET', 'POST']),
    );
  });

  it('does not do prefix matching (exact paths only)', () => {
    const result = router.match('GET', '/a/extra');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_route');
  });

  it('exposes pool lookup by name with multiple endpoints', () => {
    const pool = router.pool('a');
    expect(pool).toBeDefined();
    expect(pool?.endpoints.map((e) => e.url)).toEqual([
      'https://a1',
      'https://a2',
    ]);
  });

  it('returns undefined for unknown pool name', () => {
    expect(router.pool('nope')).toBeUndefined();
  });
});

describe('createRouter - construction validation', () => {
  it('throws on duplicate (method, path) pairs', () => {
    expect(() =>
      createRouter(
        [
          { method: 'GET', path: '/dup', pool: 'a' },
          { method: 'GET', path: '/dup', pool: 'a' },
        ],
        POOLS,
      ),
    ).toThrow(/duplicate route/i);
  });

  it('throws on route referencing unknown pool', () => {
    expect(() =>
      createRouter([{ method: 'GET', path: '/x', pool: 'ghost' }], POOLS),
    ).toThrow(/unknown pool/i);
  });

  it('throws on duplicate pool names', () => {
    expect(() =>
      createRouter([], [
        { name: 'a', endpoints: [{ url: 'https://x' }] },
        { name: 'a', endpoints: [{ url: 'https://y' }] },
      ]),
    ).toThrow(/duplicate upstream pool/i);
  });

  it('throws on empty pool', () => {
    expect(() =>
      createRouter([], [{ name: 'empty', endpoints: [] }]),
    ).toThrow(/no endpoints/i);
  });
});

describe('default routing table', () => {
  it('builds without errors and exposes the bundled routes', () => {
    const router = createRouter(DEFAULT_ROUTES, DEFAULT_POOLS);
    expect(router.routes().length).toBe(DEFAULT_ROUTES.length);
  });

  it('matches a known default route end-to-end', () => {
    const router = createRouter(DEFAULT_ROUTES, DEFAULT_POOLS);
    const result = router.match('POST', '/v1/billing/invoice');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pool.name).toBe('billing');
  });
});
