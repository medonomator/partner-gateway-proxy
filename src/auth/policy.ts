/**
 * Declarative auth policy.
 *
 * Sharp design question from the task: should auth attach to route, pool,
 * or both with priority? Answer: **route**.
 *
 * Pool is a topology concept ("which upstreams answer this kind of
 * traffic"). Auth is a policy concept ("who is allowed to make this
 * kind of request"). Two routes that hit the same pool can legitimately
 * have different auth - read endpoints public, write endpoints HMAC -
 * and that distinction lives at the route, not at the topology layer.
 *
 * Pool-level auth would conflate policy with topology and force a
 * pool-wide reconfiguration every time a single endpoint's security
 * needs changed. The cost (slightly more verbose declarations) is worth
 * it.
 */
import type { HttpMethod, Route } from '../routing';
import { Headers } from '../http';
import type { Middleware } from '../http';
import type { AuthStrategy } from './types';

export type AuthRequirement =
  | { readonly kind: 'public' }
  | { readonly kind: 'protected'; readonly strategy: AuthStrategy };

export interface AuthPolicy {
  forRoute(route: Route): AuthRequirement;
}

export interface AuthPolicyRule {
  readonly method: HttpMethod | '*';
  readonly path: string;
  readonly strategy?: AuthStrategy;
}

export interface AuthPolicyOptions {
  readonly defaultStrategy?: AuthStrategy;
}

export function createAuthPolicy(
  rules: ReadonlyArray<AuthPolicyRule>,
  options: AuthPolicyOptions = {},
): AuthPolicy {
  const exact = new Map<string, AuthRequirement>();
  const wildcard = new Map<string, AuthRequirement>();
  for (const rule of rules) {
    const requirement: AuthRequirement = rule.strategy
      ? { kind: 'protected', strategy: rule.strategy }
      : { kind: 'public' };
    if (rule.method === '*') {
      wildcard.set(rule.path, requirement);
    } else {
      exact.set(`${rule.method}:${rule.path}`, requirement);
    }
  }
  return {
    forRoute(route) {
      const e = exact.get(`${route.method}:${route.path}`);
      if (e) return e;
      const w = wildcard.get(route.path);
      if (w) return w;
      if (options.defaultStrategy) {
        return { kind: 'protected', strategy: options.defaultStrategy };
      }
      return { kind: 'public' };
    },
  };
}

export function createAuthMiddleware(policy: AuthPolicy): Middleware {
  return async (ctx, next) => {
    const requirement = policy.forRoute(ctx.route);
    if (requirement.kind === 'public') {
      ctx.log.auth_outcome = 'public';
      return next();
    }
    const outcome = await requirement.strategy.verify(ctx);
    if (outcome.ok) {
      ctx.state.auth = outcome.identity;
      ctx.log.auth_outcome = 'allowed';
      ctx.log.auth_client = outcome.identity.clientId;
      ctx.log.auth_scheme = outcome.identity.scheme;
      return next();
    }
    ctx.log.auth_outcome = outcome.reason;
    return {
      status: 401,
      headers: new Headers({
        'content-type': 'application/json',
        'www-authenticate': requirement.strategy.name,
      }),
      body: { error: 'unauthorized', reason: outcome.reason, detail: outcome.detail },
    };
  };
}
