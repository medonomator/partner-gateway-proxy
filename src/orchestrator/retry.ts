/**
 * Retry classification.
 *
 * Two questions, one decision:
 *   1. Was the failure retryable at the transport level? (network errors
 *      and the configured set of statuses - default 502/503/504)
 *   2. Is the request retryable at the policy level? (idempotent route)
 *
 * Both must be true to fail over. The orchestrator owns (2); this module
 * owns (1).
 */
import type { GatewayResponse } from '../http';
import type { RetryPolicy, UpstreamFailureKind } from './types';

export function classifyResponse(
  response: GatewayResponse,
  policy: RetryPolicy,
): { retryable: boolean; kind: UpstreamFailureKind | 'success' } {
  if (response.status < 400) return { retryable: false, kind: 'success' };
  if (policy.retryOnStatuses.includes(response.status)) {
    return { retryable: true, kind: 'retryable_status' };
  }
  return { retryable: false, kind: 'non_retryable_status' };
}

export function classifyNetworkError(policy: RetryPolicy): {
  retryable: boolean;
  kind: UpstreamFailureKind;
} {
  return {
    retryable: policy.retryOnNetworkError,
    kind: 'network_error',
  };
}
