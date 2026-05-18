/**
 * Pure token-bucket arithmetic shared by every backend.
 *
 * Keeping the math in a standalone module means the in-memory limiter, the
 * Redis Lua script and the fake test client all derive the same numeric
 * answers from the same equations. That parity is what makes swapping
 * backends in production safe.
 */
import type { TokenBucketConfig } from './types';

export interface BucketSnapshot {
  readonly tokens: number;
  readonly updatedAtMs: number;
}

export function refill(
  snapshot: BucketSnapshot,
  config: TokenBucketConfig,
  nowMs: number,
): BucketSnapshot {
  if (nowMs <= snapshot.updatedAtMs) return snapshot;
  const elapsedMs = nowMs - snapshot.updatedAtMs;
  const added = (elapsedMs / 1000) * config.refillTokensPerSecond;
  return {
    tokens: Math.min(config.capacity, snapshot.tokens + added),
    updatedAtMs: nowMs,
  };
}

export interface DecideResult {
  readonly next: BucketSnapshot;
  readonly decision: 'allow' | 'reject';
  readonly retryAfterMs: number;
}

export function decide(
  snapshot: BucketSnapshot,
  config: TokenBucketConfig,
  cost: number,
  nowMs: number,
): DecideResult {
  const refilled = refill(snapshot, config, nowMs);
  if (refilled.tokens >= cost) {
    return {
      next: { tokens: refilled.tokens - cost, updatedAtMs: refilled.updatedAtMs },
      decision: 'allow',
      retryAfterMs: 0,
    };
  }
  const missing = cost - refilled.tokens;
  const retryAfterMs = Math.ceil((missing / config.refillTokensPerSecond) * 1000);
  return { next: refilled, decision: 'reject', retryAfterMs };
}

export function validateConfig(config: TokenBucketConfig): void {
  if (!(config.capacity > 0)) {
    throw new Error(`token-bucket capacity must be > 0, got ${config.capacity}`);
  }
  if (!(config.refillTokensPerSecond > 0)) {
    throw new Error(
      `token-bucket refillTokensPerSecond must be > 0, got ${config.refillTokensPerSecond}`,
    );
  }
}
