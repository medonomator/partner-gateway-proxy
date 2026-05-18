/**
 * In-process Redis stand-in for rate-limit parity tests.
 *
 * It ignores the Lua source and runs the same bucket-math the production
 * limiters use. That is the point: if both backends route through the same
 * decide() function, the parity test below proves they cannot drift.
 */
import {
  decide,
  type BucketSnapshot,
} from '../../src/policy/rate-limit/bucket-math';
import type { RedisClientLike } from '../../src/policy/rate-limit/redis';

export class FakeRedisClient implements RedisClientLike {
  private readonly buckets = new Map<string, BucketSnapshot>();

  async eval(
    _script: string,
    keys: ReadonlyArray<string>,
    args: ReadonlyArray<string | number>,
  ): Promise<unknown> {
    const key = keys[0];
    const capacity = Number(args[0]);
    const refillTokensPerSecond = Number(args[1]);
    const cost = Number(args[2]);
    const now = Number(args[3]);
    const current =
      this.buckets.get(key) ?? { tokens: capacity, updatedAtMs: now };
    const result = decide(
      current,
      { capacity, refillTokensPerSecond },
      cost,
      now,
    );
    this.buckets.set(key, result.next);
    return [
      result.decision === 'allow' ? 1 : 0,
      String(result.next.tokens),
      result.retryAfterMs,
    ];
  }
}
