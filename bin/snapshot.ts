/**
 * CLI: print a gateway snapshot.
 *
 * For now this script seeds an `InMemoryMetricsCollector` with a small
 * synthetic workload and prints `formatSnapshot(...)`. The point is to
 * make the snapshot contract usable today by SSH-into-prod operators,
 * before the gateway has a real upstream loop wired up. When the runtime
 * lands, the same `formatSnapshot` call will serve a `/internal/snapshot`
 * endpoint without changes.
 */
import { InMemoryMetricsCollector, formatSnapshot } from '../src/observability';
import { detectBudgetBreaches, type BudgetRules } from '../src/budgets';

const DEMO_BUDGETS: BudgetRules = {
  pool: {
    errorRate: { warning: 0.02, critical: 0.1 },
    p95LatencyMs: { warning: 500, critical: 1500 },
    retryRate: { warning: 0.02, critical: 0.1 },
    breakerOpenRate: { warning: 0.01, critical: 0.05 },
  },
  route: {
    errorRate: { warning: 0.02, critical: 0.1 },
    p95LatencyMs: { warning: 400, critical: 1200 },
  },
};

function seedDemoTraffic(collector: InMemoryMetricsCollector): void {
  for (let i = 0; i < 40; i++) {
    collector.recordRequest({
      pool: 'partners-eu',
      route: '/v1/identity/me',
      status: 200,
      durationMs: 40 + (i % 7) * 5,
      outcome: 'success',
    });
  }
  for (let i = 0; i < 3; i++) {
    collector.recordRequest({
      pool: 'partners-eu',
      route: '/v1/identity/me',
      status: 502,
      durationMs: 800,
      outcome: 'upstream_error',
      errorReason: 'connection_reset',
    });
  }
  collector.recordRateLimitReject('partners-eu', '/v1/identity/me');
  collector.recordRetry('partners-eu', '/v1/identity/me');
  collector.recordBreakerState('partners-eu', 'https://eu-a.example.com', 'closed');
  collector.recordBreakerState('partners-eu', 'https://eu-b.example.com', 'half_open');

  for (let i = 0; i < 12; i++) {
    collector.recordRequest({
      pool: 'partners-us',
      route: '/v1/billing/invoice',
      status: 200,
      durationMs: 120 + (i % 4) * 10,
      outcome: 'success',
    });
  }
}

function main(): void {
  const collector = new InMemoryMetricsCollector();
  seedDemoTraffic(collector);
  console.log('# DEMO OUTPUT - synthetic traffic seeded in bin/snapshot.ts');
  console.log('# Wire createMetricsMiddleware into the real pipeline to get runtime numbers.');
  console.log('');
  const snapshot = collector.snapshot();
  console.log(formatSnapshot(snapshot));
  const alerts = detectBudgetBreaches(snapshot, DEMO_BUDGETS);
  console.log('');
  console.log('budget breaches:');
  if (alerts.length === 0) {
    console.log('  none');
  } else {
    for (const a of alerts) {
      console.log(`  [${a.severity}] ${a.reason}`);
    }
  }
}

main();
