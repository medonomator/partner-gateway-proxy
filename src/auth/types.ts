/**
 * Public auth contract.
 *
 * `AuthStrategy` is the seam between the gateway and "how do we know who
 * is calling us". Today there are two implementations (bearer, hmac);
 * tomorrow there might be mTLS or partner-issued JWTs - the middleware
 * doesn't care, it just asks the strategy.
 *
 * Rejection carries a structured `reason` so observability + alerting can
 * fan out on "tons of expired_credentials" vs "tons of invalid_credentials"
 * without parsing free-form strings.
 */
import type { RequestContext } from '../http';

export interface AuthIdentity {
  readonly clientId: string;
  readonly scheme: 'bearer' | 'hmac';
}

export type AuthRejectionReason =
  | 'missing_credentials'
  | 'invalid_credentials'
  | 'expired_credentials';

export type AuthOutcome =
  | { readonly ok: true; readonly identity: AuthIdentity }
  | {
      readonly ok: false;
      readonly reason: AuthRejectionReason;
      readonly detail?: string;
    };

export interface AuthStrategy {
  readonly name: 'bearer' | 'hmac';
  verify(ctx: RequestContext): Promise<AuthOutcome>;
}
