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

export {
  InMemoryTokenBucketLimiter,
  RedisTokenBucketLimiter,
  createKeyResolver,
} from './policy/rate-limit';
export type {
  Limiter,
  LimitDecision,
  LimiterContext,
  TokenBucketConfig,
  KeyScope,
  KeyResolver,
  RedisClientLike,
} from './policy/rate-limit';

export {
  createCircuitBreaker,
  pickEndpoint,
  endpointKey,
} from './policy/circuit-breaker';
export type {
  CircuitBreaker,
  CircuitBreakerConfig,
  CircuitDecision,
  CircuitMetricsSnapshot,
  CircuitState,
  Outcome,
  EndpointPick,
} from './policy/circuit-breaker';

export { WeightedRoundRobinBalancer, healthFromBreaker } from './balance';
export type {
  Balancer,
  BalancerConfig,
  BalancerPick,
  HealthSnapshot,
  HealthState,
  WeightedEndpoint,
} from './balance';

export { Headers, composeMiddleware } from './http';
export type {
  FinalHandler,
  GatewayResponse,
  IncomingRequest,
  Middleware,
  RequestContext,
  UpstreamRequest,
} from './http';

export {
  BearerAuthStrategy,
  HmacAuthStrategy,
  createAuthMiddleware,
  createAuthPolicy,
} from './auth';
export type {
  AuthIdentity,
  AuthOutcome,
  AuthStrategy,
  AuthPolicy,
  BearerTokenStore,
  HmacKeyStore,
} from './auth';

export {
  InMemorySpanRecorder,
  createTraceMiddleware,
  defaultIdGenerator,
  formatTraceparent,
  newTraceContext,
  parseTraceparent,
} from './tracing';
export type {
  IdGenerator,
  Span,
  SpanAttributes,
  SpanRecorder,
  TraceContext,
  TraceMiddlewareOptions,
} from './tracing';

export {
  DEFAULT_BUCKETS_MS,
  InMemoryMetricsCollector,
  LatencyHistogram,
  attachBreakerState,
  createMetricsMiddleware,
  formatSnapshot,
} from './observability';
export type {
  EndpointSnapshot,
  GatewaySnapshot,
  HistogramBucket,
  HistogramSnapshot,
  MetricsCollector,
  PoolSnapshot,
  RequestEvent,
  RequestOutcome,
  RouteSnapshot,
  UpstreamCallOutcome,
} from './observability';

export {
  DEFAULT_RETRY_POLICY,
  classifyNetworkError,
  classifyResponse,
  createOrchestratorTerminal,
  isRouteIdempotent,
  performUpstreamCall,
} from './orchestrator';
export type {
  OrchestratorOptions,
  OrchestratorOutcome,
  RetryPolicy,
  UpstreamFailureKind,
  UpstreamResult,
  UpstreamSend,
} from './orchestrator';

export {
  DEFAULT_MIN_REQUESTS_FOR_CHECKS,
  detectBudgetBreaches,
} from './budgets';
export type {
  AlertMetric,
  AlertScope,
  AlertSeverity,
  BudgetAlert,
  BudgetRules,
  BudgetThreshold,
  PoolBudgetRules,
  RouteBudgetRules,
} from './budgets';
