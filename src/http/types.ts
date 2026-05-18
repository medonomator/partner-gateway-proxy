/**
 * Shared types for the HTTP middleware layer.
 *
 * The pipeline runs after the router has matched a route to a pool. Each
 * middleware sees the same `RequestContext`, can mutate the upstream
 * request (e.g. inject trace headers), short-circuit with a response, or
 * delegate to the next middleware via `next()`.
 *
 * `state` and `log` are intentionally loose maps: middlewares attach what
 * they need (auth identity, trace context, span handle, correlation
 * fields) without imposing a single fat shape on every consumer.
 */
import type { HttpMethod, Route, UpstreamPool } from '../routing';
import type { Headers } from './headers';

export interface IncomingRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers: Headers;
  readonly body?: unknown;
}

export interface UpstreamRequest {
  url: string;
  method: HttpMethod;
  headers: Headers;
  body?: unknown;
}

export interface GatewayResponse {
  status: number;
  headers: Headers;
  body?: unknown;
}

export interface RequestContext {
  readonly incoming: IncomingRequest;
  readonly route: Route;
  readonly pool: UpstreamPool;
  upstream: UpstreamRequest;
  readonly state: Record<string, unknown>;
  readonly log: Record<string, unknown>;
}

export type FinalHandler = (ctx: RequestContext) => Promise<GatewayResponse>;
export type Middleware = (
  ctx: RequestContext,
  next: () => Promise<GatewayResponse>,
) => Promise<GatewayResponse>;
