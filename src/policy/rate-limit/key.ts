/**
 * Key resolution: turns a matched route into a stable bucket key.
 *
 * Scope is configurable because the right answer depends on the upstream:
 *   - "pool"   - default; throttles per upstream provider, which is where
 *                quotas usually live (e.g. billing partner caps us at N rps)
 *   - "route"  - two routes sharing one pool but with different SLAs
 *   - "global" - emergency back-pressure across the whole gateway
 */
import type { RouteMatchOk } from '../../routing';
import type { KeyScope } from './types';

export interface KeyResolverOptions {
  readonly scope: KeyScope;
  readonly perClient?: boolean;
}

export interface KeyResolver {
  resolve(match: RouteMatchOk, clientId?: string): string;
}

export function createKeyResolver(options: KeyResolverOptions): KeyResolver {
  return {
    resolve(match, clientId) {
      const base =
        options.scope === 'route'
          ? `route:${match.route.method}:${match.route.path}`
          : options.scope === 'pool'
            ? `pool:${match.pool.name}`
            : 'global';
      if (options.perClient) {
        if (!clientId) {
          throw new Error('perClient key resolver requires clientId');
        }
        return `${base}#${clientId}`;
      }
      return base;
    },
  };
}
