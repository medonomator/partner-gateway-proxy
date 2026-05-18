export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  readonly method: HttpMethod;
  readonly path: string;
  readonly pool: string;
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
