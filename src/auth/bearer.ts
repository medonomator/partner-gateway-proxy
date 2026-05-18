import type { RequestContext } from '../http';
import type { AuthOutcome, AuthStrategy } from './types';

export interface BearerTokenStore {
  resolve(token: string): { readonly clientId: string } | undefined;
}

const BEARER_RE = /^Bearer\s+(.+)$/;

export class BearerAuthStrategy implements AuthStrategy {
  readonly name = 'bearer' as const;

  constructor(private readonly store: BearerTokenStore) {}

  async verify(ctx: RequestContext): Promise<AuthOutcome> {
    const header = ctx.incoming.headers.get('authorization');
    if (!header) {
      return {
        ok: false,
        reason: 'missing_credentials',
        detail: 'no Authorization header',
      };
    }
    const match = BEARER_RE.exec(header);
    if (!match) {
      return {
        ok: false,
        reason: 'invalid_credentials',
        detail: 'Authorization must be "Bearer <token>"',
      };
    }
    const resolved = this.store.resolve(match[1]);
    if (!resolved) {
      return { ok: false, reason: 'invalid_credentials', detail: 'unknown token' };
    }
    return { ok: true, identity: { clientId: resolved.clientId, scheme: 'bearer' } };
  }
}
