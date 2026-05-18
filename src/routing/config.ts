/**
 * Declarative routing table + upstream pools.
 *
 * Routes are pure data: (method, path) -> pool name. The matcher resolves
 * the pool by name at request time. Adding a new partner endpoint means
 * appending one row here, no glue code.
 *
 * Hostnames are placeholders. Real upstreams arrive when the next task
 * wires the HTTP client + load balancer.
 */
import type { Route, UpstreamPool } from './types';

export const DEFAULT_POOLS: ReadonlyArray<UpstreamPool> = [
  {
    name: 'identity',
    endpoints: [
      { url: 'https://identity-a.partner.local' },
      { url: 'https://identity-b.partner.local' },
    ],
  },
  {
    name: 'billing',
    endpoints: [{ url: 'https://billing.partner.local' }],
  },
  {
    name: 'support',
    endpoints: [
      { url: 'https://support-a.partner.local' },
      { url: 'https://support-b.partner.local' },
      { url: 'https://support-c.partner.local' },
    ],
  },
];

export const DEFAULT_ROUTES: ReadonlyArray<Route> = [
  { method: 'GET', path: '/v1/identity/me', pool: 'identity' },
  { method: 'POST', path: '/v1/identity/login', pool: 'identity' },
  { method: 'POST', path: '/v1/billing/invoice', pool: 'billing' },
  { method: 'GET', path: '/v1/support/tickets', pool: 'support' },
  { method: 'POST', path: '/v1/support/tickets', pool: 'support' },
];
