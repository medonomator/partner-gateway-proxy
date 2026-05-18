export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  readonly method: HttpMethod;
  readonly path: string;
  readonly pool: string;
  // Declarative override of the HTTP-method idempotency default. Per
  // RFC 9110, GET/PUT/DELETE are idempotent and POST/PATCH are not, but
  // a route can opt in (POST with an Idempotency-Key contract) or out
  // (a legacy GET that mutates server state). The orchestrator reads
  // this flag when deciding whether to fail over on a retryable error.
  readonly idempotent?: boolean;
}

export interface UpstreamEndpoint {
  readonly url: string;
}

export interface UpstreamPool {
  readonly name: string;
  readonly endpoints: ReadonlyArray<UpstreamEndpoint>;
}

export type RouteMatchOk = {
  readonly ok: true;
  readonly route: Route;
  readonly pool: UpstreamPool;
};

export type RouteMatchErrReason = 'no_route' | 'method_not_allowed';

export type RouteMatchErr = {
  readonly ok: false;
  readonly reason: RouteMatchErrReason;
  readonly method: HttpMethod;
  readonly path: string;
  readonly allowedMethods?: ReadonlyArray<HttpMethod>;
};

export type RouteMatchResult = RouteMatchOk | RouteMatchErr;
