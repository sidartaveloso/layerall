import { describe, it, expect, beforeEach } from 'vitest';
import { Registry } from 'prom-client';
import { PrometheusObserver } from './observer.js';
import { Router } from '@layerall/core';
import type { Provider, PolicyDocument } from '@layerall/core';

function makeProvider(id: string, ok: boolean, latencyMs = 20): Provider {
  return {
    id,
    weight: 50,
    async invoke() {
      await new Promise(r => setTimeout(r, latencyMs));
      if (!ok) throw { code: 'upstream_error', message: 'fail', transient: true };
      return { ok: true, id };
    },
  };
}

function policy(): PolicyDocument {
  return {
    tenants: {
      default: {
        providers: ['a', 'b'],
        operations: {
          create: { strategy: 'round_robin', retries: { max: 0, backoffMs: 10 } },
        },
      },
    },
  };
}

async function runWith(
  observer: PrometheusObserver,
  registry: Registry,
  providers: Record<string, Provider>,
) {
  const router = new Router({ providers, policy: policy(), observer });
  const a = await router.execute('create', { data: {} });
  return { a, registry };
}

describe('PrometheusObserver', () => {
  let registry: Registry;
  let observer: PrometheusObserver;

  beforeEach(() => {
    registry = new Registry();
    observer = new PrometheusObserver({ registry });
  });

  it('exposes 4 metrics with the configured prefix', async () => {
    await runWith(observer, registry, { a: makeProvider('a', true), b: makeProvider('b', true) });
    const metrics = await registry.metrics();
    expect(metrics).toContain('layerall_requests_total');
    expect(metrics).toContain('layerall_latency_seconds');
    expect(metrics).toContain('layerall_attempts_total');
    expect(metrics).toContain('layerall_errors_total');
  });

  it('increments requests_total with status=succeeded on a successful call', async () => {
    await runWith(observer, registry, { a: makeProvider('a', true), b: makeProvider('b', true) });
    const metrics = await registry.metrics();
    expect(metrics).toContain('status="succeeded"');
    expect(metrics).not.toContain('status="failed"');
  });

  it('increments requests_total with status=failed when all providers fail', async () => {
    await runWith(
      observer,
      registry,
      { a: makeProvider('a', false), b: makeProvider('b', false) },
    );
    const metrics = await registry.metrics();
    expect(metrics).toContain('status="failed"');
  });

  it('increments attempts_total for every attempt, ok or fail', async () => {
    await runWith(
      observer,
      registry,
      { a: makeProvider('a', true), b: makeProvider('b', false) },
    );
    const metrics = await registry.metrics();
    // one attempt, one OK
    expect(metrics).toContain('result="ok"');
  });

  it('increments errors_total with a code label on failed attempts', async () => {
    await runWith(
      observer,
      registry,
      { a: makeProvider('a', false), b: makeProvider('b', false) },
    );
    const metrics = await registry.metrics();
    expect(metrics).toContain('code="upstream_error"');
  });

  it('records latency in seconds via the latency histogram', async () => {
    await runWith(observer, registry, { a: makeProvider('a', true, 30), b: makeProvider('b', true) });
    const metrics = await registry.metrics();
    expect(metrics).toContain('layerall_latency_seconds_bucket');
    expect(metrics).toContain('le="0.5"');
  });

  it('uses a custom prefix when provided', async () => {
    const customRegistry = new Registry();
    const customObserver = new PrometheusObserver({ registry: customRegistry, prefix: 'allx_' });
    await runWith(customObserver, customRegistry, { a: makeProvider('a', true), b: makeProvider('b', true) });
    const metrics = await customRegistry.metrics();
    expect(metrics).toContain('allx_requests_total');
    expect(metrics).not.toContain('layerall_requests_total');
  });

  it('exposes metricRegistry for /metrics scraping', async () => {
    await runWith(observer, registry, { a: makeProvider('a', true), b: makeProvider('b', true) });
    expect(observer.metricRegistry).toBe(registry);
    expect(observer.metricRegistry.contentType).toMatch(/text\/plain/);
  });
});