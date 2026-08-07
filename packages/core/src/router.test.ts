import { describe, expect, it } from 'vitest';
import type { MultiPolygon } from 'geojson';
import { Router } from './router.js';
import type { AttemptLog, OperationName, PolicyDocument, Provider, StrategyName } from './types.js';

const mkProvider = (
  id: string,
  behavior: 'ok' | 'transient' | 'fatal' = 'ok',
  latency = 5
): Provider => ({
  id,
  weight: 1,
  health: 1,
  baseLatency: latency,
  failRate: 0,
  enabled: true,
  invoke: async ctx => {
    if (behavior === 'transient') {
      const err = new Error('transient') as Error & { transient: boolean };
      err.transient = true;
      err.code = 'unavailable';
      throw err;
    }
    if (behavior === 'fatal') {
      const err = new Error('fatal') as Error & { code: string };
      err.code = 'fatal';
      throw err;
    }
    return { ok: true, provider: id, op: ctx.operation } as unknown;
  },
});

const policy = (strategy: StrategyName, retries = { max: 0, backoffMs: 1 }): PolicyDocument => ({
  tenants: {
    default: {
      providers: ['providerA', 'providerB', 'providerC'],
      operations: {
        create: { strategy, retries, failover: strategy === 'failover', timeoutMs: 1000 },
      },
    },
  },
});

const capture = () => {
  const attempts: AttemptLog[] = [];
  let started: { operation: OperationName; strategy: StrategyName } | null = null;
  const observer = {
    onStart: (e: { operation: OperationName; strategy: StrategyName }) => (started = e),
    onAttempt: (l: AttemptLog) => attempts.push(l),
    onFinish: () => {},
  };
  return { attempts, observer, started: () => started };
};

const basePayload = { data: { doc: 'x' } };

describe('Router', () => {
  it('succeeds on the first healthy provider (round_robin)', async () => {
    const providers: Record<string, Provider> = {
      providerA: mkProvider('providerA'),
      providerB: mkProvider('providerB'),
      providerC: mkProvider('providerC'),
    };
    const cap = capture();
    const router = new Router({ policy: policy('round_robin'), providers, observer: cap.observer });
    const res = await router.execute('create', basePayload);
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('providerA');
    expect(res.attempts).toBe(1);
    expect(cap.started()?.strategy).toBe('round_robin');
    expect(cap.attempts).toHaveLength(1);
    expect(res.providerReceipt).toContain('providerA');
  });

  it('retries transient failures before failing over when enabled', async () => {
    const providers: Record<string, Provider> = {
      providerA: mkProvider('providerA', 'transient'),
      providerB: mkProvider('providerB'),
      providerC: mkProvider('providerC'),
    };
    const cap = capture();
    const router = new Router({
      policy: policy('failover', { max: 1, backoffMs: 1 }),
      providers,
      observer: cap.observer,
    });
    const res = await router.execute('create', basePayload);
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('providerB');
    expect(res.attempts).toBeGreaterThanOrEqual(2);
    expect(cap.attempts.some(a => a.provider === 'providerA' && !a.ok)).toBe(true);
  });

  it('fails when all providers are fatal', async () => {
    const providers: Record<string, Provider> = {
      providerA: mkProvider('providerA', 'fatal'),
      providerB: mkProvider('providerB', 'fatal'),
      providerC: mkProvider('providerC', 'fatal'),
    };
    const router = new Router({ policy: policy('failover'), providers });
    const res = await router.execute('create', basePayload);
    expect(res.status).toBe('failed');
    expect(res.error?.code).toBe('fatal');
  });

  it('returns no_providers when none registered/enabled', async () => {
    const router = new Router({
      policy: { tenants: { default: { providers: ['ghost'], operations: {} } } },
      providers: {},
    });
    const res = await router.execute('create', basePayload);
    expect(res.status).toBe('failed');
    expect(res.error?.code).toBe('no_providers');
  });

  it('per-request strategy override wins over policy', async () => {
    const providers: Record<string, Provider> = {
      providerA: mkProvider('providerA'),
      providerB: mkProvider('providerB'),
    };
    const cap = capture();
    const router = new Router({ policy: policy('round_robin'), providers, observer: cap.observer });
    const res = await router.execute('create', basePayload, { strategy: 'failover' });
    expect(res.status).toBe('succeeded');
    expect(cap.started()?.strategy).toBe('failover');
  });
});

const box = (lngMin: number, latMin: number, lngMax: number, latMax: number): MultiPolygon => ({
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [lngMin, latMin],
        [lngMax, latMin],
        [lngMax, latMax],
        [lngMin, latMax],
        [lngMin, latMin],
      ],
    ],
  ],
});

describe('Router geo_rule', () => {
  const geoPolicy = (): PolicyDocument => ({
    tenants: {
      default: {
        providers: ['br', 'us'],
        operations: {
          create: {
            strategy: 'geo_rule',
            timeoutMs: 1000,
            geo: {
              field: 'location',
              rules: [
                { providers: ['br'], multipolygon: box(-10, -10, 10, 10) },
                { providers: ['us'], multipolygon: box(20, 20, 40, 40) },
              ],
            },
          },
        },
      },
    },
  });

  const geoRouter = () =>
    new Router({
      policy: geoPolicy(),
      providers: { br: mkProvider('br'), us: mkProvider('us') },
    });

  it('routes to the provider of the matched region', async () => {
    const res = await geoRouter().execute('create', { data: { location: [0, 0] } });
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('br');
  });

  it('fails with geo_unmatched when the point is in no region', async () => {
    const res = await geoRouter().execute('create', { data: { location: [50, 50] } });
    expect(res.status).toBe('failed');
    expect(res.error?.code).toBe('geo_unmatched');
  });

  it('fails with geo_bad_payload when the coordinate is invalid', async () => {
    const res = await geoRouter().execute('create', { data: { location: [200, 0] } });
    expect(res.status).toBe('failed');
    expect(res.error?.code).toBe('geo_bad_payload');
  });

  it('applies the fallbackStrategy across matched regions', async () => {
    const router = new Router({
      policy: {
        tenants: {
          default: {
            providers: ['slow', 'fast'],
            operations: {
              create: {
                strategy: 'geo_rule',
                geo: {
                  field: 'location',
                  rules: [
                    { providers: ['slow'], multipolygon: box(-10, -10, 10, 10) },
                    { providers: ['fast'], multipolygon: box(-5, -5, 15, 15) },
                  ],
                  fallbackStrategy: 'most_fast',
                },
              },
            },
          },
        },
      },
      providers: {
        slow: mkProvider('slow', 'ok', 900),
        fast: mkProvider('fast', 'ok', 50),
      },
    });
    const res = await router.execute('create', { data: { location: [0, 0] } });
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('fast');
  });
});
