/**
 * Orchestrator middleware: terminal handler that calls
 * `performUpstreamCall` and stamps observability hints on `ctx.log` for
 * the metrics middleware sitting upstream of this one.
 */
import type { FinalHandler } from '../http';
import type { OrchestratorOptions } from './upstream-call';
import { performUpstreamCall } from './upstream-call';

export function createOrchestratorTerminal(options: OrchestratorOptions): FinalHandler {
  return async (ctx) => {
    const outcome = await performUpstreamCall(ctx, options);
    ctx.log.upstream_attempts = outcome.attempts;
    ctx.log.upstream_failovers = outcome.failovers;
    ctx.log.upstream_idempotent = outcome.idempotent;
    if (outcome.chosenEndpoint) {
      ctx.log.upstream_final_url = outcome.chosenEndpoint.url;
    }
    return outcome.response;
  };
}
