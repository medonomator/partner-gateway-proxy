import { describe, expect, it } from 'vitest';
import { WeightedRoundRobinBalancer } from '../src/balance';
import type { HealthSnapshot } from '../src/balance';

const ALL_HEALTHY: HealthSnapshot = {};

describe('WeightedRoundRobinBalancer - distribution', () => {
  it('distributes picks proportional to weights for healthy endpoints', () => {
    const lb = new WeightedRoundRobinBalancer([
      { url: 'a', baseWeight: 5 },
      { url: 'b', baseWeight: 1 },
    ]);
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 600; i++) {
      const pick = lb.pick(ALL_HEALTHY);
      expect(pick.ok).toBe(true);
      if (pick.ok) counts[pick.endpoint.url]++;
    }
    expect(counts.a).toBe(500);
    expect(counts.b).toBe(100);
  });

  it('produces a deterministic pick sequence for identical inputs', () => {
    const make = () => new WeightedRoundRobinBalancer([
      { url: 'a', baseWeight: 2 },
      { url: 'b', baseWeight: 1 },
    ]);
    const lb1 = make();
    const lb2 = make();
    const seq1: string[] = [];
    const seq2: string[] = [];
    for (let i = 0; i < 20; i++) {
      const p1 = lb1.pick(ALL_HEALTHY);
      const p2 = lb2.pick(ALL_HEALTHY);
      if (p1.ok) seq1.push(p1.endpoint.url);
      if (p2.ok) seq2.push(p2.endpoint.url);
    }
    expect(seq1).toEqual(seq2);
    // ratio sanity: in 21 picks at 2:1 we get ~14 a and ~7 b
    expect(seq1.filter((u) => u === 'a').length).toBe(13);
    expect(seq1.filter((u) => u === 'b').length).toBe(7);
  });

  it('keeps weight state stable between calls (no reset per request)', () => {
    const lb = new WeightedRoundRobinBalancer([
      { url: 'a', baseWeight: 3 },
      { url: 'b', baseWeight: 1 },
    ]);
    // Without state across calls, every call would give the heaviest
    // endpoint and the lighter one would never appear in the prefix.
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const p = lb.pick(ALL_HEALTHY);
      if (p.ok) seen.add(p.endpoint.url);
    }
    expect(seen).toEqual(new Set(['a', 'b']));
  });
});

describe('WeightedRoundRobinBalancer - health awareness', () => {
  it('excludes down endpoints from the pick', () => {
    const lb = new WeightedRoundRobinBalancer([
      { url: 'a', baseWeight: 1 },
      { url: 'b', baseWeight: 1 },
    ]);
    const health: HealthSnapshot = { a: 'down' };
    for (let i = 0; i < 50; i++) {
      const p = lb.pick(health);
      expect(p.ok).toBe(true);
      if (p.ok) expect(p.endpoint.url).toBe('b');
    }
  });

  it('gives degraded endpoints a smaller share than healthy ones', () => {
    const lb = new WeightedRoundRobinBalancer(
      [
        { url: 'a', baseWeight: 4 },
        { url: 'b', baseWeight: 4 },
      ],
      { degradedFactor: 0.25 },
    );
    const health: HealthSnapshot = { a: 'degraded' };
    const counts: Record<string, number> = { a: 0, b: 0 };
    // total weight per cycle = 1 (a) + 4 (b) = 5
    for (let i = 0; i < 500; i++) {
      const p = lb.pick(health);
      if (p.ok) counts[p.endpoint.url]++;
    }
    // ~100 a vs ~400 b at the 1:4 ratio
    expect(counts.a).toBe(100);
    expect(counts.b).toBe(400);
    expect(counts.a).toBeLessThan(counts.b);
  });

  it('returns no_healthy_endpoints when every endpoint is down', () => {
    const lb = new WeightedRoundRobinBalancer([
      { url: 'a', baseWeight: 1 },
      { url: 'b', baseWeight: 1 },
    ]);
    const health: HealthSnapshot = { a: 'down', b: 'down' };
    const p = lb.pick(health);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe('no_healthy_endpoints');
  });

  it('redistributes traffic when an endpoint recovers from down', () => {
    const lb = new WeightedRoundRobinBalancer([
      { url: 'a', baseWeight: 1 },
      { url: 'b', baseWeight: 1 },
    ]);
    // Phase 1: a is down, b absorbs everything
    for (let i = 0; i < 20; i++) {
      const p = lb.pick({ a: 'down' });
      if (p.ok) expect(p.endpoint.url).toBe('b');
    }
    // Phase 2: a recovers, both must share. We expect at least one of each
    // in the next ~10 picks - exactness here is a sanity check, not the
    // distribution test.
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const p = lb.pick({});
      if (p.ok) seen.add(p.endpoint.url);
    }
    expect(seen).toEqual(new Set(['a', 'b']));
  });
});

describe('WeightedRoundRobinBalancer - validation', () => {
  it('rejects empty endpoint list', () => {
    expect(() => new WeightedRoundRobinBalancer([])).toThrow(/at least one endpoint/);
  });

  it('rejects non-positive baseWeight', () => {
    expect(
      () => new WeightedRoundRobinBalancer([{ url: 'a', baseWeight: 0 }]),
    ).toThrow(/baseWeight/);
  });

  it('rejects degradedFactor outside (0, 1]', () => {
    expect(
      () =>
        new WeightedRoundRobinBalancer([{ url: 'a', baseWeight: 1 }], {
          degradedFactor: 0,
        }),
    ).toThrow(/degradedFactor/);
    expect(
      () =>
        new WeightedRoundRobinBalancer([{ url: 'a', baseWeight: 1 }], {
          degradedFactor: 1.5,
        }),
    ).toThrow(/degradedFactor/);
  });
});
