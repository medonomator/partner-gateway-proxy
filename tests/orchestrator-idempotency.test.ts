import { describe, expect, it } from 'vitest';
import { isRouteIdempotent } from '../src/orchestrator';
import type { Route } from '../src/routing';

describe('isRouteIdempotent', () => {
  it('uses RFC 9110 defaults when no override is set', () => {
    expect(isRouteIdempotent({ method: 'GET', path: '/', pool: 'p' })).toBe(true);
    expect(isRouteIdempotent({ method: 'PUT', path: '/', pool: 'p' })).toBe(true);
    expect(isRouteIdempotent({ method: 'DELETE', path: '/', pool: 'p' })).toBe(true);
    expect(isRouteIdempotent({ method: 'POST', path: '/', pool: 'p' })).toBe(false);
    expect(isRouteIdempotent({ method: 'PATCH', path: '/', pool: 'p' })).toBe(false);
  });

  it('lets the route opt in or opt out of the method default', () => {
    expect(
      isRouteIdempotent({ method: 'POST', path: '/', pool: 'p', idempotent: true }),
    ).toBe(true);
    expect(
      isRouteIdempotent({ method: 'GET', path: '/', pool: 'p', idempotent: false }),
    ).toBe(false);
  });

  it('treats undefined override as "no override"', () => {
    const r: Route = { method: 'GET', path: '/', pool: 'p', idempotent: undefined };
    expect(isRouteIdempotent(r)).toBe(true);
  });
});
