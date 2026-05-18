/**
 * Router: exact (method, path) -> pool resolver.
 *
 * Exact match only - no wildcards, no prefix, no path params. That's
 * intentional for task #2: the matcher result type is the seam where
 * retry, tracing and circuit breaker land in later tasks. Wildcards
 * would force the result shape to change again; flat lookup keeps it
 * stable.
 *
 * Construction is strict and fail-fast: duplicate (method, path) pairs
 * and references to unknown pools both throw, so misconfig surfaces at
 * boot instead of as a runtime 502 in front of a partner.
 */
import type {
  HttpMethod,
  Route,
  RouteMatchResult,
  UpstreamPool,
} from './types';

export interface Router {
  match(method: HttpMethod, path: string): RouteMatchResult;
  routes(): ReadonlyArray<Route>;
  pool(name: string): UpstreamPool | undefined;
}

export function createRouter(
  routes: ReadonlyArray<Route>,
  pools: ReadonlyArray<UpstreamPool>,
): Router {
  const poolByName = new Map<string, UpstreamPool>();
  for (const pool of pools) {
    if (poolByName.has(pool.name)) {
      throw new Error(`duplicate upstream pool: "${pool.name}"`);
    }
    if (pool.endpoints.length === 0) {
      throw new Error(`upstream pool "${pool.name}" has no endpoints`);
    }
    poolByName.set(pool.name, pool);
  }

  const byPath = new Map<string, Map<HttpMethod, Route>>();
  for (const route of routes) {
    if (!poolByName.has(route.pool)) {
      throw new Error(
        `route ${route.method} ${route.path} references unknown pool "${route.pool}"`,
      );
    }
    let methods = byPath.get(route.path);
    if (!methods) {
      methods = new Map();
      byPath.set(route.path, methods);
    }
    if (methods.has(route.method)) {
      throw new Error(`duplicate route: ${route.method} ${route.path}`);
    }
    methods.set(route.method, route);
  }

  return {
    match(method: HttpMethod, path: string): RouteMatchResult {
      const methods = byPath.get(path);
      if (!methods) {
        return { ok: false, reason: 'no_route', method, path };
      }
      const route = methods.get(method);
      if (!route) {
        return {
          ok: false,
          reason: 'method_not_allowed',
          method,
          path,
          allowedMethods: [...methods.keys()],
        };
      }
      const pool = poolByName.get(route.pool);
      if (!pool) {
        // Construction guard prevents this; the runtime check exists so the
        // return type doesn't have to leak `| undefined` to callers.
        throw new Error(`route resolved to missing pool "${route.pool}"`);
      }
      return { ok: true, route, pool };
    },
    routes(): ReadonlyArray<Route> {
      return routes;
    },
    pool(name: string): UpstreamPool | undefined {
      return poolByName.get(name);
    },
  };
}
