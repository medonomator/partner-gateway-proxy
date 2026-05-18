/**
 * In-memory span recorder.
 *
 * Right for: tests, dev, smoke. Snapshots are returned by `snapshot()`
 * for assertions. Wrong for prod - the real recorder will be an OTLP
 * exporter or vendor SDK, but it implements the same `SpanRecorder`
 * contract so the middleware does not change.
 */
import { defaultIdGenerator, type IdGenerator } from './w3c';
import type { Span, SpanAttributes, SpanRecorder, TraceContext } from './types';

export interface InMemorySpanRecorderOptions {
  readonly clock?: () => number;
  readonly idGenerator?: IdGenerator;
}

export class InMemorySpanRecorder implements SpanRecorder {
  private readonly spans: Span[] = [];
  private readonly clock: () => number;
  private readonly idGenerator: IdGenerator;

  constructor(options: InMemorySpanRecorderOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
  }

  start(name: string, parent: TraceContext, attributes: SpanAttributes = {}): Span {
    const span: Span = {
      traceId: parent.traceId,
      spanId: this.idGenerator.spanId(),
      parentSpanId: parent.parentSpanId,
      name,
      startMs: this.clock(),
      attributes: { ...attributes },
    };
    this.spans.push(span);
    return span;
  }

  end(span: Span, attributes: SpanAttributes = {}): void {
    span.endMs = this.clock();
    Object.assign(span.attributes, attributes);
  }

  snapshot(): ReadonlyArray<Span> {
    return this.spans.map((s) => ({ ...s, attributes: { ...s.attributes } }));
  }
}
