/**
 * HMAC-SHA256 request authentication.
 *
 * Signature covers `<method>\n<path>\n<timestamp>`. That is the smallest
 * envelope that defends against replay (timestamp) and method/path
 * tampering. Bodies are intentionally NOT covered here: covering them
 * would force the gateway to buffer requests just to verify, which fights
 * with streaming proxies. If the partner needs body integrity, that is a
 * higher-level concern (e.g. payload-signing per RFC 9421) and slots in
 * as a separate strategy.
 *
 * Comparison is constant-time via `timingSafeEqual` to neutralize timing
 * oracles. Skew check rejects future and stale timestamps inside the same
 * window.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestContext } from '../http';
import type { AuthOutcome, AuthStrategy } from './types';

export interface HmacKeyStore {
  resolve(keyId: string): { readonly secret: string; readonly clientId: string } | undefined;
}

export interface HmacOptions {
  readonly headerKeyId?: string;
  readonly headerSignature?: string;
  readonly headerTimestamp?: string;
  readonly maxSkewMs?: number;
  readonly now?: () => number;
}

const DEFAULTS = {
  headerKeyId: 'x-gateway-key-id',
  headerSignature: 'x-gateway-signature',
  headerTimestamp: 'x-gateway-timestamp',
  maxSkewMs: 5 * 60_000,
};

export class HmacAuthStrategy implements AuthStrategy {
  readonly name = 'hmac' as const;
  private readonly headerKeyId: string;
  private readonly headerSignature: string;
  private readonly headerTimestamp: string;
  private readonly maxSkewMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: HmacKeyStore,
    options: HmacOptions = {},
  ) {
    this.headerKeyId = options.headerKeyId ?? DEFAULTS.headerKeyId;
    this.headerSignature = options.headerSignature ?? DEFAULTS.headerSignature;
    this.headerTimestamp = options.headerTimestamp ?? DEFAULTS.headerTimestamp;
    this.maxSkewMs = options.maxSkewMs ?? DEFAULTS.maxSkewMs;
    this.now = options.now ?? Date.now;
  }

  async verify(ctx: RequestContext): Promise<AuthOutcome> {
    const keyId = ctx.incoming.headers.get(this.headerKeyId);
    const provided = ctx.incoming.headers.get(this.headerSignature);
    const tsRaw = ctx.incoming.headers.get(this.headerTimestamp);
    if (!keyId || !provided || !tsRaw) {
      return {
        ok: false,
        reason: 'missing_credentials',
        detail: 'missing HMAC headers',
      };
    }
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) {
      return {
        ok: false,
        reason: 'invalid_credentials',
        detail: 'timestamp not numeric',
      };
    }
    if (Math.abs(this.now() - ts) > this.maxSkewMs) {
      return {
        ok: false,
        reason: 'expired_credentials',
        detail: 'timestamp outside skew window',
      };
    }
    const key = this.store.resolve(keyId);
    if (!key) {
      return { ok: false, reason: 'invalid_credentials', detail: 'unknown keyId' };
    }
    const expected = createHmac('sha256', key.secret)
      .update(`${ctx.incoming.method}\n${ctx.incoming.path}\n${tsRaw}`)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return {
        ok: false,
        reason: 'invalid_credentials',
        detail: 'signature mismatch',
      };
    }
    return { ok: true, identity: { clientId: key.clientId, scheme: 'hmac' } };
  }
}
