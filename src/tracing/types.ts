/**
 * W3C Trace Context primitives.
 *
 * Only `traceparent` version `00` is supported - that is the published
 * normative form. `tracestate` is preserved verbatim as a string and
 * forwarded without parsing, per spec (gateways MUST forward unknown
 * vendor entries unchanged).
 */
export interface TraceContext {
  readonly version: '00';
  readonly traceId: string;
  readonly parentSpanId: string;
  readonly flags: string;
  readonly tracestate?: string;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean;
}

export interface Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly startMs: number;
  endMs?: number;
  readonly attributes: SpanAttributes;
}

export interface SpanRecorder {
  start(name: string, parent: TraceContext, attributes?: SpanAttributes): Span;
  end(span: Span, attributes?: SpanAttributes): void;
  snapshot(): ReadonlyArray<Span>;
}
