import { describe, expect, it } from 'vitest';
import {
  BearerAuthStrategy,
  createAuthMiddleware,
  createAuthPolicy,
} from '../src/auth';
import { Headers, composeMiddleware, type FinalHandler } from '../src/http';
import { makeCtx } from './_helpers/ctx';
import type { Route } from '../src/routing';

const tokens = new Map([['good', { clientId: 'tenant-1' }]]);
const bearer = new BearerAuthStrategy({ resolve: (t) => tokens.get(t) });

const publicRoute: Route = { method: 'GET', path: '/v1/health', pool: 'echo' };
const protectedRoute: Route = { method: 'GET', path: '/v1/identity/me', pool: 'echo' };

const policy = createAuthPolicy([
  { method: 'GET', path: '/v1/health' },
  { method: 'GET', path: '/v1/identity/me', strategy: bearer },
]);

const terminal: FinalHandler = async () => ({
  status: 200,
  headers: new Headers(),
  body: 'ok',
});

const handler = composeMiddleware([createAuthMiddleware(policy)], terminal);

describe('createAuthMiddleware', () => {
  it('admits a public route without any credentials', async () => {
    const ctx = makeCtx({ route: publicRoute });
    const response = await handler(ctx);
    expect(response.status).toBe(200);
    expect(ctx.log.auth_outcome).toBe('public');
    expect(ctx.state.auth).toBeUndefined();
  });

  it('admits a protected route with a valid bearer and stamps log fields', async () => {
    const ctx = makeCtx({
      route: protectedRoute,
      headers: { authorization: 'Bearer good' },
    });
    const response = await handler(ctx);
    expect(response.status).toBe(200);
    expect(ctx.log.auth_outcome).toBe('allowed');
    expect(ctx.log.auth_client).toBe('tenant-1');
    expect(ctx.log.auth_scheme).toBe('bearer');
    expect(ctx.state.auth).toEqual({ clientId: 'tenant-1', scheme: 'bearer' });
  });

  it('rejects a protected route with 401 + structured reason on bad bearer', async () => {
    const ctx = makeCtx({
      route: protectedRoute,
      headers: { authorization: 'Bearer bad' },
    });
    const response = await handler(ctx);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('bearer');
    expect(response.body).toMatchObject({
      error: 'unauthorized',
      reason: 'invalid_credentials',
    });
    expect(ctx.log.auth_outcome).toBe('invalid_credentials');
  });

  it('rejects a protected route with 401 on missing credentials', async () => {
    const ctx = makeCtx({ route: protectedRoute });
    const response = await handler(ctx);
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ reason: 'missing_credentials' });
  });

  it('falls back to defaultStrategy when no explicit rule matches', async () => {
    const strictPolicy = createAuthPolicy([], { defaultStrategy: bearer });
    const strictHandler = composeMiddleware(
      [createAuthMiddleware(strictPolicy)],
      terminal,
    );
    const ctx = makeCtx({ route: protectedRoute });
    const response = await strictHandler(ctx);
    expect(response.status).toBe(401);
  });
});
