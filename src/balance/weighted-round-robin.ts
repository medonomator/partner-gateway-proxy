/**
 * Smooth weighted round-robin (the Nginx-style algorithm).
 *
 * Each endpoint carries a `currentWeight` accumulator that persists between
 * picks. On every pick we add the endpoint's effective weight to its
 * accumulator, choose the endpoint with the largest accumulator, and
 * subtract the total effective weight from the winner. The result is a
 * distribution that hits the configured ratio without bursting one
 * endpoint and starving the others.
 *
 * Endpoints with effective weight 0 (`down`) are excluded from the pick
 * AND have their accumulator reset to 0, so that when the upstream
 * recovers it re-enters the rotation cleanly rather than carrying old
 * positive or negative state forward.
 *
 * Determinism: ties on max(currentWeight) resolve to the endpoint that
 * appears first in the declared order. Same inputs + same state always
 * yield the same pick sequence, so the operational behavior matches the
 * tests bit-for-bit.
 */
import type {
  Balancer,
  BalancerConfig,
  BalancerPick,
  HealthSnapshot,
  HealthState,
  WeightedEndpoint,
} from './types';

const DEFAULT_DEGRADED_FACTOR = 0.25;

function effectiveWeight(
  base: number,
  health: HealthState,
  degradedFactor: number,
): number {
  if (health === 'healthy') return base;
  if (health === 'degraded') return base * degradedFactor;
  return 0;
}

export class WeightedRoundRobinBalancer implements Balancer {
  private readonly degradedFactor: number;
  private readonly currentWeights: Map<string, number>;
  private readonly endpoints: ReadonlyArray<WeightedEndpoint>;

  constructor(
    endpoints: ReadonlyArray<WeightedEndpoint>,
    config: BalancerConfig = {},
  ) {
    if (endpoints.length === 0) {
      throw new Error('weighted-round-robin balancer needs at least one endpoint');
    }
    for (const e of endpoints) {
      if (!(e.baseWeight > 0)) {
        throw new Error(
          `endpoint ${e.url} baseWeight must be > 0, got ${e.baseWeight}`,
        );
      }
    }
    const factor = config.degradedFactor ?? DEFAULT_DEGRADED_FACTOR;
    if (!(factor > 0 && factor <= 1)) {
      throw new Error(`degradedFactor must be in (0, 1], got ${factor}`);
    }
    this.endpoints = endpoints;
    this.degradedFactor = factor;
    this.currentWeights = new Map(endpoints.map((e) => [e.url, 0]));
  }

  pick(health: HealthSnapshot): BalancerPick {
    let total = 0;
    let bestIndex = -1;
    let bestUrl: string | null = null;
    let bestCurrent = Number.NEGATIVE_INFINITY;
    let bestEffective = 0;
    let bestHealth: HealthState = 'healthy';

    for (let i = 0; i < this.endpoints.length; i++) {
      const ep = this.endpoints[i];
      const h: HealthState = health[ep.url] ?? 'healthy';
      const eff = effectiveWeight(ep.baseWeight, h, this.degradedFactor);
      if (eff <= 0) {
        this.currentWeights.set(ep.url, 0);
        continue;
      }
      total += eff;
      const next = (this.currentWeights.get(ep.url) ?? 0) + eff;
      this.currentWeights.set(ep.url, next);
      if (next > bestCurrent) {
        bestCurrent = next;
        bestUrl = ep.url;
        bestIndex = i;
        bestEffective = eff;
        bestHealth = h;
      }
    }

    if (bestUrl === null) {
      return { ok: false, reason: 'no_healthy_endpoints' };
    }

    this.currentWeights.set(bestUrl, bestCurrent - total);
    return {
      ok: true,
      endpoint: this.endpoints[bestIndex],
      effectiveWeight: bestEffective,
      health: bestHealth,
    };
  }
}
