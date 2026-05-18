/**
 * Redis-backed token-bucket limiter.
 *
 * Right for: multi-instance prod where every replica must see one shared
 * bucket per partner. The Lua script makes refill + decide + persist atomic
 * in one round-trip, so two replicas racing on the same key cannot
 * double-count tokens.
 *
 * The redis client is injected as a minimal interface, so the dependency
 * choice (ioredis, node-redis, a Cluster client) is the caller's problem.
 * Tests substitute an in-process fake that uses the same bucket-math.
 */
import { validateConfig } from './bucket-math';
import type {
  Limiter,
  LimitDecision,
  LimiterContext,
  TokenBucketConfig,
} from './types';

export interface RedisClientLike {
  eval(
    script: string,
    keys: ReadonlyArray<string>,
    args: ReadonlyArray<string | number>,
  ): Promise<unknown>;
}

// KEYS[1] - bucket key
// ARGV    - capacity, refillTokensPerSecond, cost, nowMs
// Returns - [allowed (1/0), tokensAfter (string), retryAfterMs (number)]
//
// tokens are returned as strings so float precision survives the round
// trip; redis only promises integers for numeric replies.
export const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local state = redis.call('HMGET', key, 'tokens', 'updated')
local tokens = tonumber(state[1])
local updated = tonumber(state[2])
if tokens == nil then
  tokens = capacity
  updated = now
end

if now > updated then
  local elapsed = now - updated
  tokens = math.min(capacity, tokens + (elapsed / 1000) * refill)
  updated = now
end

local allowed = 0
local retry = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  local missing = cost - tokens
  retry = math.ceil((missing / refill) * 1000)
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'updated', tostring(updated))
local ttlMs = math.ceil((capacity / refill) * 1000) + 1000
redis.call('PEXPIRE', key, ttlMs)

return {allowed, tostring(tokens), retry}
`;

export interface RedisTokenBucketLimiterOptions {
  readonly keyPrefix?: string;
}

export class RedisTokenBucketLimiter implements Limiter {
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: RedisClientLike,
    private readonly config: TokenBucketConfig,
    options: RedisTokenBucketLimiterOptions = {},
  ) {
    validateConfig(config);
    this.keyPrefix = options.keyPrefix ?? 'rl:';
  }

  async acquire(ctx: LimiterContext): Promise<LimitDecision> {
    const nowMs = ctx.now ?? Date.now();
    const cost = ctx.cost ?? 1;
    if (!(cost > 0)) {
      throw new Error(`acquire cost must be > 0, got ${cost}`);
    }
    const fullKey = `${this.keyPrefix}${ctx.key}`;
    const raw = await this.redis.eval(
      ACQUIRE_SCRIPT,
      [fullKey],
      [
        this.config.capacity,
        this.config.refillTokensPerSecond,
        cost,
        nowMs,
      ],
    );
    if (!Array.isArray(raw) || raw.length < 3) {
      throw new Error(
        `unexpected redis eval result for rate-limit acquire: ${JSON.stringify(raw)}`,
      );
    }
    const allowed = Number(raw[0]) === 1;
    const tokens = Number(raw[1]);
    const retryAfterMs = Number(raw[2]);
    if (allowed) {
      return { allowed: true, key: ctx.key, remainingTokens: tokens };
    }
    return {
      allowed: false,
      reason: 'rate_limited',
      key: ctx.key,
      retryAfterMs,
      config: this.config,
    };
  }
}
