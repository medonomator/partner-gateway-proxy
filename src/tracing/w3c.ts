/**
 * Parse / format / mint W3C `traceparent` values.
 *
 * Rules enforced (per https://www.w3.org/TR/trace-context):
 *   - exactly four hyphen-separated lowercase-hex fields
 *   - version must be `00` (other versions are forward-compat, but we
 *     do not pretend to understand them yet)
 *   - traceId is 16 bytes (32 hex chars), MUST NOT be all zeros
 *   - parentSpanId is 8 bytes (16 hex chars), MUST NOT be all zeros
 *
 * Anything that fails validation returns `null` so the middleware can
 * mint a fresh trace and continue, rather than propagating a malformed
 * id chain.
 */
import { randomBytes } from 'node:crypto';
import type { TraceContext } from './types';

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

export function parseTraceparent(header: string | undefined | null): TraceContext | null {
  if (!header) return null;
  const match = TRACEPARENT_RE.exec(header);
  if (!match) return null;
  const [, version, traceId, parentSpanId, flags] = match;
  if (version !== '00') return null;
  if (traceId === ZERO_TRACE_ID || parentSpanId === ZERO_SPAN_ID) return null;
  return { version: '00', traceId, parentSpanId, flags };
}

export function formatTraceparent(ctx: TraceContext): string {
  return `${ctx.version}-${ctx.traceId}-${ctx.parentSpanId}-${ctx.flags}`;
}

export interface IdGenerator {
  traceId(): string;
  spanId(): string;
}

export const defaultIdGenerator: IdGenerator = {
  traceId: () => randomBytes(16).toString('hex'),
  spanId: () => randomBytes(8).toString('hex'),
};

export function newTraceContext(
  flags = '01',
  idGenerator: IdGenerator = defaultIdGenerator,
): TraceContext {
  return {
    version: '00',
    traceId: idGenerator.traceId(),
    parentSpanId: idGenerator.spanId(),
    flags,
  };
}
