import { describe, expect, it } from 'vitest';
import { createKeyResolver } from '../src/policy/rate-limit/key';
import type { RouteMatchOk } from '../src/routing';

const match: RouteMatchOk = {
  ok: true,
  route: { method: 'POST', path: '/v1/billing/invoice', pool: 'billing' },
  pool: { name: 'billing', endpoints: [{ url: 'https://billing.partner.local' }] },
};

describe('createKeyResolver', () => {
  it('keys by pool when scope is "pool"', () => {
    expect(createKeyResolver({ scope: 'pool' }).resolve(match)).toBe('pool:billing');
  });

  it('keys by method+path when scope is "route"', () => {
    expect(createKeyResolver({ scope: 'route' }).resolve(match)).toBe('route:POST:/v1/billing/invoice');
  });

  it('returns a single global key when scope is "global"', () => {
    expect(createKeyResolver({ scope: 'global' }).resolve(match)).toBe('global');
  });

  it('appends client id when perClient is enabled', () => {
    const r = createKeyResolver({ scope: 'pool', perClient: true });
    expect(r.resolve(match, 'tenant-42')).toBe('pool:billing#tenant-42');
  });

  it('throws when perClient is set but no clientId is provided', () => {
    const r = createKeyResolver({ scope: 'pool', perClient: true });
    expect(() => r.resolve(match)).toThrow(/clientId/);
  });
});
