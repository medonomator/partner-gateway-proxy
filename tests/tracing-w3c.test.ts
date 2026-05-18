import { describe, expect, it } from 'vitest';
import { formatTraceparent, newTraceContext, parseTraceparent } from '../src/tracing';

describe('parseTraceparent', () => {
  it('parses a well-formed version 00 traceparent', () => {
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    expect(parseTraceparent(tp)).toEqual({
      version: '00',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      parentSpanId: 'b7ad6b7169203331',
      flags: '01',
    });
  });

  it('rejects an empty / undefined header', () => {
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(null)).toBeNull();
    expect(parseTraceparent('')).toBeNull();
  });

  it('rejects unsupported versions', () => {
    expect(
      parseTraceparent('01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'),
    ).toBeNull();
    expect(
      parseTraceparent('ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'),
    ).toBeNull();
  });

  it('rejects all-zero ids', () => {
    expect(
      parseTraceparent(`00-${'0'.repeat(32)}-b7ad6b7169203331-01`),
    ).toBeNull();
    expect(
      parseTraceparent(`00-0af7651916cd43dd8448eb211c80319c-${'0'.repeat(16)}-01`),
    ).toBeNull();
  });

  it('rejects malformed structure (wrong lengths, uppercase, garbage)', () => {
    expect(parseTraceparent('not-a-traceparent')).toBeNull();
    expect(
      parseTraceparent('00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01'),
    ).toBeNull();
    expect(parseTraceparent('00-abc-b7ad6b7169203331-01')).toBeNull();
    expect(
      parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331'),
    ).toBeNull();
  });
});

describe('formatTraceparent', () => {
  it('round-trips through parse', () => {
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const parsed = parseTraceparent(tp);
    expect(parsed).not.toBeNull();
    expect(formatTraceparent(parsed!)).toBe(tp);
  });
});

describe('newTraceContext', () => {
  it('produces a fresh context with injected ids', () => {
    let i = 0;
    const fakeGen = {
      traceId: () => '0af7651916cd43dd8448eb211c80319c',
      spanId: () => `b7ad6b716920333${i++}`,
    };
    const ctx = newTraceContext('01', fakeGen);
    expect(ctx.version).toBe('00');
    expect(ctx.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(ctx.parentSpanId).toBe('b7ad6b7169203330');
    expect(ctx.flags).toBe('01');
  });
});
