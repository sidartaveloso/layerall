import { Counter, Histogram, Registry, register as defaultRegistry } from 'prom-client';
import type { Observer, AttemptLog, OperationResult } from '@layerall/core';
import { Router, type RouterOptions } from '@layerall/core';

export interface PrometheusObserverOptions {
  /**
   * Registry where metrics will be registered. Defaults to the global
   * `prom-client` registry so `/metrics` endpoints pick them up automatically.
   * Pass a custom `Registry` to isolate metrics (useful in tests).
   */
  registry?: Registry;
  /**
   * Prefix applied to all metric names. Defaults to `layerall_`.
   */
  prefix?: string;
}

/**
 * Observer that increments Prometheus metrics for every LayerAll Router
 * execution. Register it on a `Router` (or use `createMetricsRouter`) and
 * scrape `registry.metrics()` from your `/metrics` endpoint.
 *
 * Metrics exposed:
 * - `<prefix>requests_total{provider,operation,status}` — Counter
 * - `<prefix>latency_seconds{provider,operation}` — Histogram
 * - `<prefix>attempts_total{provider,operation,result}` — Counter
 * - `<prefix>errors_total{provider,code}` — Counter
 */
export class PrometheusObserver implements Observer {
  private readonly registry: Registry;
  private readonly prefix: string;
  private readonly requestsTotal: Counter<string>;
  private readonly latencySeconds: Histogram<string>;
  private readonly attemptsTotal: Counter<string>;
  private readonly errorsTotal: Counter<string>;

  constructor(opts: PrometheusObserverOptions = {}) {
    this.registry = opts.registry ?? defaultRegistry;
    this.prefix = opts.prefix ?? 'layerall_';

    const labels = {
      requests: ['provider', 'operation', 'status'] as const,
      latency: ['provider', 'operation'] as const,
      attempts: ['provider', 'operation', 'result'] as const,
      errors: ['provider', 'code'] as const,
    };

    this.requestsTotal = new Counter({
      name: `${this.prefix}requests_total`,
      help: 'Total LayerAll requests by provider, operation and final status.',
      labelNames: [...labels.requests],
      registers: [this.registry],
    });

    this.latencySeconds = new Histogram({
      name: `${this.prefix}latency_seconds`,
      help: 'LayerAll request latency in seconds, by provider and operation.',
      labelNames: [...labels.latency],
      buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });

    this.attemptsTotal = new Counter({
      name: `${this.prefix}attempts_total`,
      help: 'Total LayerAll provider attempts by provider, operation and result.',
      labelNames: [...labels.attempts],
      registers: [this.registry],
    });

    this.errorsTotal = new Counter({
      name: `${this.prefix}errors_total`,
      help: 'Total LayerAll failed attempts by provider and error code.',
      labelNames: [...labels.errors],
      registers: [this.registry],
    });
  }

  /** Registry used by this observer — exposes `metrics()` and `contentType`. */
  get metricRegistry(): Registry {
    return this.registry;
  }

  onStart(): void {
    // nothing — final counts live in onFinish/onAttempt
  }

  onAttempt(log: AttemptLog): void {
    this.attemptsTotal.inc({
      provider: log.provider,
      operation: log.operation,
      result: log.ok ? 'ok' : 'fail',
    });
    if (!log.ok) {
      this.errorsTotal.inc({
        provider: log.provider,
        code: log.errorCode ?? log.error ?? 'unknown',
      });
    }
  }

  onFinish(res: OperationResult): void {
    this.requestsTotal.inc({
      provider: res.provider,
      operation: res.operation,
      status: res.status,
    });
    this.latencySeconds.observe(
      { provider: res.provider, operation: res.operation },
      res.latencyMs / 1000,
    );
  }
}

export interface CreateMetricsRouterOptions extends RouterOptions {
  prometheus?: PrometheusObserverOptions;
}

/**
 * Convenience factory: builds a `Router` with a `PrometheusObserver` already
 * wired in. Returns both the router and the observer so you can scrape the
 * registry from your `/metrics` endpoint.
 *
 * @example
 * ```ts
 * const { router, observer } = createMetricsRouter({ providers, policy });
 * server.get('/metrics', (_req, res) => {
 *   res.set('Content-Type', observer.metricRegistry.contentType);
 *   res.end(observer.metricRegistry.metrics());
 * });
 * ```
 */
export function createMetricsRouter(
  opts: CreateMetricsRouterOptions,
): { router: Router; observer: PrometheusObserver } {
  const observer = new PrometheusObserver(opts.prometheus);
  const router = new Router({
    providers: opts.providers,
    policy: opts.policy,
    tenant: opts.tenant,
    observer,
    defaultStrategy: opts.defaultStrategy,
    defaultTimeoutMs: opts.defaultTimeoutMs,
  });
  return { router, observer };
}