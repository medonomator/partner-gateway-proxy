/**
 * In-memory token-bucket limiter.
 *
 * Right for: single-instance deploys, dev, tests, smoke checks. State lives
 * in a Map keyed by bucket name; nothing is shared across processes.
 *
 * Wrong for: multi-instance prod - each replica would maintain its own
 * bucket and the partner would see N times the allowed rate. Use the Redis
 * backend there.
 */
import { decide, validateConfig, type BucketSnapshot } from './bucket-math';
import type {
  Limiter,
  LimitDecision,
  LimiterContext,
  TokenBucketConfig,
} from './types';

export class InMemoryTokenBucketLimiter implements Limiter {
  private readonly buckets = new Map<string, BucketSnapshot>();

  constructor(private readonly config: TokenBucketConfig) {
    validateConfig(config);
  }

  async acquire(ctx: LimiterContext): Promise<LimitDecision> {
    const nowMs = ctx.now ?? Date.now();
    const cost = ctx.cost ?? 1;
    if (!(cost > 0)) {
      throw new Error(`acquire cost must be > 0, got ${cost}`);
    }
    const current =
      this.buckets.get(ctx.key) ?? {
        tokens: this.config.capacity,
        updatedAtMs: nowMs,
      };
    const result = decide(current, this.config, cost, nowMs);
    this.buckets.set(ctx.key, result.next);
    if (result.decision === 'allow') {
      return {
        allowed: true,
        key: ctx.key,
        remainingTokens: result.next.tokens,
      };
    }
    return {
      allowed: false,
      reason: 'rate_limited',
      key: ctx.key,
      retryAfterMs: result.retryAfterMs,
      config: this.config,
    };
  }
}
