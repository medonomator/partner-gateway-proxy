/**
 * Koa/Express-style middleware composer.
 *
 * Each middleware receives the context and a `next` thunk. Calling `next`
 * advances the chain; *not* calling `next` short-circuits and the
 * middleware's return value becomes the response. Calling `next` twice in
 * the same middleware is a bug and throws - this is the standard guard
 * that catches accidental double-invocation patterns.
 */
import type { FinalHandler, GatewayResponse, Middleware, RequestContext } from './types';

export function composeMiddleware(
  middlewares: ReadonlyArray<Middleware>,
  terminal: FinalHandler,
): FinalHandler {
  return async function run(ctx: RequestContext): Promise<GatewayResponse> {
    let lastCalled = -1;
    const dispatch = (i: number): Promise<GatewayResponse> => {
      if (i <= lastCalled) {
        return Promise.reject(new Error('next() called multiple times in middleware'));
      }
      lastCalled = i;
      const mw = middlewares[i];
      if (!mw) return terminal(ctx);
      return mw(ctx, () => dispatch(i + 1));
    };
    return dispatch(0);
  };
}
