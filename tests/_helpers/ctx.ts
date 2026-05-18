import { Headers, type RequestContext } from '../../src/http';
import type { HttpMethod, Route, UpstreamPool } from '../../src/routing';

export interface FakeCtxInit {
  readonly method?: HttpMethod;
  readonly path?: string;
  readonly headers?: Record<string, string>;
  readonly route?: Route;
  readonly pool?: UpstreamPool;
  readonly body?: unknown;
}

const DEFAULT_ROUTE: Route = { method: 'GET', path: '/echo', pool: 'echo' };
const DEFAULT_POOL: UpstreamPool = {
  name: 'echo',
  endpoints: [{ url: 'https://echo.local' }],
};

export function makeCtx(init: FakeCtxInit = {}): RequestContext {
  const route = init.route ?? DEFAULT_ROUTE;
  const pool = init.pool ?? DEFAULT_POOL;
  const incomingHeaders = new Headers(init.headers ?? {});
  return {
    incoming: {
      method: init.method ?? route.method,
      path: init.path ?? route.path,
      headers: incomingHeaders,
      body: init.body,
    },
    route,
    pool,
    upstream: {
      url: pool.endpoints[0].url,
      method: init.method ?? route.method,
      headers: new Headers(),
    },
    state: {},
    log: {},
  };
}
