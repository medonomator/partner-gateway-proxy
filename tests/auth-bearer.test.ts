import { describe, expect, it } from 'vitest';
import { BearerAuthStrategy, type BearerTokenStore } from '../src/auth';
import { makeCtx } from './_helpers/ctx';

const store: BearerTokenStore = {
  resolve: (t) => (t === 'good' ? { clientId: 'tenant-1' } : undefined),
};
const strategy = new BearerAuthStrategy(store);

describe('BearerAuthStrategy', () => {
  it('admits a valid token', async () => {
    const r = await strategy.verify(
      makeCtx({ headers: { authorization: 'Bearer good' } }),
    );
    expect(r).toEqual({
      ok: true,
      identity: { clientId: 'tenant-1', scheme: 'bearer' },
    });
  });

  it('rejects when no Authorization header is present', async () => {
    const r = await strategy.verify(makeCtx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_credentials');
  });

  it('rejects when the scheme is wrong', async () => {
    const r = await strategy.verify(
      makeCtx({ headers: { authorization: 'Basic abc' } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_credentials');
  });

  it('rejects an unknown token', async () => {
    const r = await strategy.verify(
      makeCtx({ headers: { authorization: 'Bearer bad' } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_credentials');
  });
});
