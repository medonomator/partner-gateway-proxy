import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HmacAuthStrategy, type HmacKeyStore } from '../src/auth';
import { makeCtx } from './_helpers/ctx';

function sign(secret: string, method: string, path: string, ts: string): string {
  return createHmac('sha256', secret).update(`${method}\n${path}\n${ts}`).digest('hex');
}

const store: HmacKeyStore = {
  resolve: (id) => (id === 'k1' ? { secret: 's3cret', clientId: 'tenant-1' } : undefined),
};

describe('HmacAuthStrategy', () => {
  const now = 1_700_000_000_000;
  const strategy = new HmacAuthStrategy(store, { now: () => now });

  it('admits a valid signature inside the skew window', async () => {
    const ts = String(now);
    const sig = sign('s3cret', 'POST', '/v1/billing/invoice', ts);
    const ctx = makeCtx({
      method: 'POST',
      path: '/v1/billing/invoice',
      headers: {
        'x-gateway-key-id': 'k1',
        'x-gateway-signature': sig,
        'x-gateway-timestamp': ts,
      },
    });
    const r = await strategy.verify(ctx);
    expect(r).toEqual({
      ok: true,
      identity: { clientId: 'tenant-1', scheme: 'hmac' },
    });
  });

  it('rejects when one of the HMAC headers is missing', async () => {
    const r = await strategy.verify(
      makeCtx({
        headers: { 'x-gateway-key-id': 'k1' },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_credentials');
  });

  it('rejects when the signature does not match', async () => {
    const ts = String(now);
    const ctx = makeCtx({
      method: 'POST',
      path: '/v1/billing/invoice',
      headers: {
        'x-gateway-key-id': 'k1',
        'x-gateway-signature': 'deadbeef'.repeat(8),
        'x-gateway-timestamp': ts,
      },
    });
    const r = await strategy.verify(ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_credentials');
  });

  it('rejects when the timestamp is outside the skew window', async () => {
    const stale = String(now - 10 * 60_000);
    const sig = sign('s3cret', 'POST', '/v1/billing/invoice', stale);
    const ctx = makeCtx({
      method: 'POST',
      path: '/v1/billing/invoice',
      headers: {
        'x-gateway-key-id': 'k1',
        'x-gateway-signature': sig,
        'x-gateway-timestamp': stale,
      },
    });
    const r = await strategy.verify(ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired_credentials');
  });

  it('rejects an unknown keyId', async () => {
    const ts = String(now);
    const sig = sign('s3cret', 'POST', '/v1/billing/invoice', ts);
    const ctx = makeCtx({
      method: 'POST',
      path: '/v1/billing/invoice',
      headers: {
        'x-gateway-key-id': 'unknown',
        'x-gateway-signature': sig,
        'x-gateway-timestamp': ts,
      },
    });
    const r = await strategy.verify(ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_credentials');
  });
});
