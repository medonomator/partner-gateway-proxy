/**
 * Public types for the rate-limit module.
 *
 * The Limiter contract is intentionally backend-agnostic: callers hand it a
 * pre-built key and receive a deterministic decision. Backends (in-memory,
 * Redis) implement the same interface so swapping is a one-line change.
 */
export interface TokenBucketConfig {
  readonly capacity: number;
  readonly refillTokensPerSecond: number;
}

export interface LimiterContext {
  readonly key: string;
  readonly now?: number;
  readonly cost?: number;
}

/**
 * Numeric contract on the boundary:
 *   - `remainingTokens` is a real number; partial refills produce fractional
 *     balances by design, so the rate isn't truncated.
 *   - `retryAfterMs` is integer milliseconds, rounded UP. Round-up is what
 *     metrics and Retry-After headers expect: never under-promise wait time.
 */
export type LimitDecision =
  | {
      readonly allowed: true;
      readonly key: string;
      readonly remainingTokens: number;
    }
  | {
      readonly allowed: false;
      readonly reason: 'rate_limited';
      readonly key: string;
      readonly retryAfterMs: number;
      readonly config: TokenBucketConfig;
    };

export interface Limiter {
  acquire(ctx: LimiterContext): Promise<LimitDecision>;
}

export type KeyScope = 'route' | 'pool' | 'global';
