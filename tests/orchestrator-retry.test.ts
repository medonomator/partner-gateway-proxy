import { describe, expect, it } from 'vitest';
import { Headers } from '../src/http';
import {
  DEFAULT_RETRY_POLICY,
  classifyNetworkError,
  classifyResponse,
} from '../src/orchestrator';

describe('classifyResponse', () => {
  it('classifies <400 as success (not retryable)', () => {
    expect(classifyResponse({ status: 200, headers: new Headers() }, DEFAULT_RETRY_POLICY))
      .toEqual({ retryable: false, kind: 'success' });
    expect(classifyResponse({ status: 204, headers: new Headers() }, DEFAULT_RETRY_POLICY))
      .toEqual({ retryable: false, kind: 'success' });
  });

  it('classifies default 502/503/504 as retryable', () => {
    for (const status of [502, 503, 504]) {
      expect(
        classifyResponse({ status, headers: new Headers() }, DEFAULT_RETRY_POLICY),
      ).toEqual({ retryable: true, kind: 'retryable_status' });
    }
  });

  it('classifies 4xx and other 5xx as non-retryable', () => {
    expect(classifyResponse({ status: 400, headers: new Headers() }, DEFAULT_RETRY_POLICY))
      .toEqual({ retryable: false, kind: 'non_retryable_status' });
    expect(classifyResponse({ status: 500, headers: new Headers() }, DEFAULT_RETRY_POLICY))
      .toEqual({ retryable: false, kind: 'non_retryable_status' });
  });

  it('honors a custom retry status set', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, retryOnStatuses: [500] };
    expect(classifyResponse({ status: 500, headers: new Headers() }, policy))
      .toEqual({ retryable: true, kind: 'retryable_status' });
    expect(classifyResponse({ status: 502, headers: new Headers() }, policy))
      .toEqual({ retryable: false, kind: 'non_retryable_status' });
  });
});

describe('classifyNetworkError', () => {
  it('returns retryable when policy.retryOnNetworkError is true', () => {
    expect(classifyNetworkError(DEFAULT_RETRY_POLICY))
      .toEqual({ retryable: true, kind: 'network_error' });
  });

  it('returns non-retryable when policy.retryOnNetworkError is false', () => {
    expect(classifyNetworkError({ ...DEFAULT_RETRY_POLICY, retryOnNetworkError: false }))
      .toEqual({ retryable: false, kind: 'network_error' });
  });
});
