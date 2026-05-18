/**
 * Idempotency resolver.
 *
 * Sharp design question (from the task spec): где хранить признак
 * idempotency, в route policy или в request metadata?
 *
 * Answer: **route policy**, with the HTTP method giving a sane default
 * per RFC 9110. The route declaration is the source of truth and an
 * optional `idempotent` flag overrides the method-derived default
 * (POST with an Idempotency-Key contract becomes idempotent; a legacy
 * GET that mutates becomes non-idempotent).
 *
 * Why not request metadata? Per-request idempotency hints would force
 * the gateway to trust the caller, which is a footgun: a buggy or
 * malicious client could mark a POST /payments as idempotent and
 * trigger double-charges on failover. Topology and policy stay
 * server-side.
 */
import type { HttpMethod, Route } from '../routing';

const METHOD_IDEMPOTENT_DEFAULTS: Readonly<Record<HttpMethod, boolean>> = {
  GET: true,
  PUT: true,
  DELETE: true,
  POST: false,
  PATCH: false,
};

export function isRouteIdempotent(route: Route): boolean {
  if (typeof route.idempotent === 'boolean') return route.idempotent;
  return METHOD_IDEMPOTENT_DEFAULTS[route.method] ?? false;
}
