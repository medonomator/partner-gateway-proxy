/**
 * Public types for the upstream call orchestrator.
 *
 * The orchestrator is the seam where routing, breaker, balancer, retry
 * and observability stop being independent primitives and start being
 * one execution path. It does NOT speak HTTP - the `send` callback owns
 * the wire format. That keeps the orchestrator testable without real
 * sockets (see the smoke test) and lets the runtime swap fetch / undici
 * / Node http without touching this layer.
 */
import type { GatewayResponse, RequestContext } from '../http';
import type { UpstreamEndpoint } from '../routing';

export type UpstreamFailureKind = 'network_error' | 'retryable_status' | 'non_retryable_status';

export type UpstreamResult =
  | {
      readonly ok: true;
      readonly response: GatewayResponse;
      readonly endpoint: UpstreamEndpoint;
    }
  | {
      readonly ok: false;
      readonly kind: UpstreamFailureKind;
      readonly endpoint: UpstreamEndpoint;
      readonly status?: number;
      readonly response?: GatewayResponse;
      readonly error?: Error;
    };

export type UpstreamSend = (
  endpoint: UpstreamEndpoint,
  ctx: RequestContext,
) => Promise<GatewayResponse>;

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly retryOnStatuses: ReadonlyArray<number>;
  readonly retryOnNetworkError: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  retryOnStatuses: [502, 503, 504],
  retryOnNetworkError: true,
};

export interface OrchestratorOutcome {
  readonly response: GatewayResponse;
  readonly attempts: number;
  readonly chosenEndpoint?: UpstreamEndpoint;
  readonly failovers: number;
  readonly idempotent: boolean;
}
