import {
  createRouter,
  DEFAULT_POOLS,
  DEFAULT_ROUTES,
  type Router,
} from './routing';

export const serviceName = 'partner-mcp-gateway';

export function buildReadyMessage(
  name: string = serviceName,
  routeCount?: number,
): string {
  if (typeof routeCount === 'number') {
    return `${name} ready - ${routeCount} route(s) loaded`;
  }
  return `${name} ready`;
}

export function buildDefaultRouter(): Router {
  return createRouter(DEFAULT_ROUTES, DEFAULT_POOLS);
}

function main(): void {
  const router = buildDefaultRouter();
  console.log(buildReadyMessage(serviceName, router.routes().length));
}

if (require.main === module) {
  main();
}

export { createRouter, DEFAULT_POOLS, DEFAULT_ROUTES } from './routing';
export type {
  Route,
  Router,
  RouteMatchResult,
  HttpMethod,
  UpstreamPool,
  UpstreamEndpoint,
} from './routing';
