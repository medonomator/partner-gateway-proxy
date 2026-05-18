import { describe, expect, it } from 'vitest';
import { createCircuitBreaker } from '../src/policy/circuit-breaker';

const cfg = { failureThreshold: 3, cooldownMs: 1000 };

describe('createCircuitBreaker - state machine', () => {
  it('opens after failureThreshold consecutive failures', () => {
    const cb = createCircuitBreaker(cfg);
    for (let i = 0; i < 3; i++) {
      const d = cb.beforeRequest('k', 1000);
      expect(d.admitted).toBe(true);
      cb.recordOutcome('k', 'failure', { now: 1000, error: 'ECONNREFUSED' });
    }
    expect(cb.state('k')).toBe('open');

    const blocked = cb.beforeRequest('k', 1100);
    expect(blocked.admitted).toBe(false);
    if (!blocked.admitted) {
      expect(blocked.reason).toBe('circuit_open');
      expect(blocked.state).toBe('open');
      expect(blocked.retryAfterMs).toBe(900);
      expect(blocked.openedReason).toBe('ECONNREFUSED');
    }
  });

  it('resets consecutive failures on a successful call before threshold', () => {
    const cb = createCircuitBreaker(cfg);
    cb.beforeRequest('k', 1000);
    cb.recordOutcome('k', 'failure', { now: 1000 });
    cb.beforeRequest('k', 1010);
    cb.recordOutcome('k', 'failure', { now: 1010 });
    cb.beforeRequest('k', 1020);
    cb.recordOutcome('k', 'success', { now: 1020 });
    cb.beforeRequest('k', 1030);
    cb.recordOutcome('k', 'failure', { now: 1030 });
    expect(cb.state('k')).toBe('closed');
  });

  it('transitions open -> half_open after cooldown on the next beforeRequest', () => {
    const cb = createCircuitBreaker(cfg);
    for (let i = 0; i < 3; i++) {
      cb.beforeRequest('k', 1000);
      cb.recordOutcome('k', 'failure', { now: 1000 });
    }
    expect(cb.state('k')).toBe('open');

    const probe = cb.beforeRequest('k', 2000);
    expect(probe.admitted).toBe(true);
    if (probe.admitted) {
      expect(probe.state).toBe('half_open');
      expect(probe.probe).toBe(true);
    }
    expect(cb.state('k')).toBe('half_open');
  });

  it('half_open closes on probe success, reopens on probe failure', () => {
    const cb = createCircuitBreaker(cfg);
    // open it
    for (let i = 0; i < 3; i++) {
      cb.beforeRequest('k', 1000);
      cb.recordOutcome('k', 'failure', { now: 1000 });
    }
    // half-open at t=2000
    cb.beforeRequest('k', 2000);
    cb.recordOutcome('k', 'failure', { now: 2010, error: 'still bad' });
    expect(cb.state('k')).toBe('open');

    const blocked = cb.beforeRequest('k', 2500);
    expect(blocked.admitted).toBe(false);
    if (!blocked.admitted) {
      // cooldown restarted at 2010, so at 2500 we have 510ms left
      expect(blocked.retryAfterMs).toBe(510);
      expect(blocked.openedReason).toBe('still bad');
    }

    cb.beforeRequest('k', 3100);
    cb.recordOutcome('k', 'success', { now: 3110 });
    expect(cb.state('k')).toBe('closed');
  });

  it('half_open limits in-flight probes to halfOpenMaxProbes (default 1)', () => {
    const cb = createCircuitBreaker(cfg);
    for (let i = 0; i < 3; i++) {
      cb.beforeRequest('k', 1000);
      cb.recordOutcome('k', 'failure', { now: 1000 });
    }
    const p1 = cb.beforeRequest('k', 2000);
    const p2 = cb.beforeRequest('k', 2000);
    expect(p1.admitted).toBe(true);
    expect(p2.admitted).toBe(false);
    if (!p2.admitted) {
      expect(p2.state).toBe('half_open');
    }
  });

  it('halfOpenMaxProbes can be raised to admit several concurrent probes', () => {
    const cb = createCircuitBreaker({ ...cfg, halfOpenMaxProbes: 2 });
    for (let i = 0; i < 3; i++) {
      cb.beforeRequest('k', 1000);
      cb.recordOutcome('k', 'failure', { now: 1000 });
    }
    expect(cb.beforeRequest('k', 2000).admitted).toBe(true);
    expect(cb.beforeRequest('k', 2000).admitted).toBe(true);
    expect(cb.beforeRequest('k', 2000).admitted).toBe(false);
  });
});

describe('createCircuitBreaker - isolation', () => {
  it('failures on one key do not affect other keys', () => {
    const cb = createCircuitBreaker(cfg);
    for (let i = 0; i < 3; i++) {
      cb.beforeRequest('a', 1000);
      cb.recordOutcome('a', 'failure', { now: 1000 });
    }
    expect(cb.state('a')).toBe('open');
    expect(cb.state('b')).toBe('closed');

    const onB = cb.beforeRequest('b', 1000);
    expect(onB.admitted).toBe(true);
    if (onB.admitted) {
      expect(onB.state).toBe('closed');
      expect(onB.probe).toBe(false);
    }
  });
});

describe('createCircuitBreaker - metrics', () => {
  it('counts transitions and exposes per-key state', () => {
    const cb = createCircuitBreaker(cfg);
    for (let i = 0; i < 3; i++) {
      cb.beforeRequest('k', 1000);
      cb.recordOutcome('k', 'failure', { now: 1000, error: 'boom' });
    }
    cb.beforeRequest('k', 2000); // open -> half_open
    cb.recordOutcome('k', 'failure', { now: 2010 }); // half_open -> open
    cb.beforeRequest('k', 3200); // open -> half_open again
    cb.recordOutcome('k', 'success', { now: 3210 }); // half_open -> closed

    const m = cb.metrics();
    expect(m.transitions.closedToOpen).toBe(1);
    expect(m.transitions.openToHalfOpen).toBe(2);
    expect(m.transitions.halfOpenToClosed).toBe(1);
    expect(m.transitions.halfOpenToOpen).toBe(1);

    const k = m.perKey.get('k');
    expect(k?.state).toBe('closed');
    expect(k?.openedTimes).toBe(2);
    expect(k?.lastOpenReason).toBeDefined();
  });

  it('returns "closed" for keys never seen', () => {
    const cb = createCircuitBreaker(cfg);
    expect(cb.state('unseen')).toBe('closed');
  });
});

describe('createCircuitBreaker - validation', () => {
  it('rejects invalid config', () => {
    expect(() => createCircuitBreaker({ failureThreshold: 0, cooldownMs: 1 })).toThrow();
    expect(() => createCircuitBreaker({ failureThreshold: 1, cooldownMs: 0 })).toThrow();
    expect(() => createCircuitBreaker({ failureThreshold: 1, cooldownMs: 1, halfOpenMaxProbes: 0 })).toThrow();
  });
});
