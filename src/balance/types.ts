/**
 * Public types for the load balancer.
 *
 * Health is supplied per pick as a snapshot, not held inside the balancer.
 * That decouples balancing from the source of health truth (circuit
 * breaker, active probes, partner-reported status) and lets the same
 * algorithm absorb whatever observer the gateway grows next.
 */
export type HealthState = 'healthy' | 'degraded' | 'down';

export interface WeightedEndpoint {
  readonly url: string;
  readonly baseWeight: number;
}

export type HealthSnapshot = Readonly<Record<string, HealthState>>;

export interface BalancerConfig {
  readonly degradedFactor?: number;
}

export type BalancerPick =
  | {
      readonly ok: true;
      readonly endpoint: WeightedEndpoint;
      readonly effectiveWeight: number;
      readonly health: HealthState;
    }
  | {
      readonly ok: false;
      readonly reason: 'no_healthy_endpoints';
    };

export interface Balancer {
  pick(health: HealthSnapshot): BalancerPick;
}
