import { describe, expect, it } from 'vitest';
import { Headers, composeMiddleware, type Middleware, type FinalHandler } from '../src/http';
import { makeCtx } from './_helpers/ctx';

describe('composeMiddleware', () => {
  it('runs middlewares around the terminal in declared order', async () => {
    const order: string[] = [];
    const mw1: Middleware = async (_, next) => {
      order.push('1-pre');
      const r = await next();
      order.push('1-post');
      return r;
    };
    const mw2: Middleware = async (_, next) => {
      order.push('2-pre');
      const r = await next();
      order.push('2-post');
      return r;
    };
    const terminal: FinalHandler = async () => {
      order.push('terminal');
      return { status: 200, headers: new Headers() };
    };

    const composed = composeMiddleware([mw1, mw2], terminal);
    const response = await composed(makeCtx());

    expect(response.status).toBe(200);
    expect(order).toEqual(['1-pre', '2-pre', 'terminal', '2-post', '1-post']);
  });

  it('short-circuits when a middleware returns without calling next', async () => {
    let terminalRan = false;
    const mw: Middleware = async () => ({ status: 401, headers: new Headers() });
    const terminal: FinalHandler = async () => {
      terminalRan = true;
      return { status: 200, headers: new Headers() };
    };
    const composed = composeMiddleware([mw], terminal);

    const response = await composed(makeCtx());

    expect(response.status).toBe(401);
    expect(terminalRan).toBe(false);
  });

  it('rejects when next() is called twice in the same middleware', async () => {
    const mw: Middleware = async (_, next) => {
      await next();
      return await next();
    };
    const composed = composeMiddleware(
      [mw],
      async () => ({ status: 200, headers: new Headers() }),
    );
    await expect(composed(makeCtx())).rejects.toThrow(/multiple times/);
  });
});
