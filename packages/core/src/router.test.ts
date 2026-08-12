import { describe, expect, it } from 'vitest';
import type { MultiPolygon } from 'geojson';
import { Router } from './router.js';
import type {
  AttemptLog,
  CancelledEvent,
  OperationName,
  OperationPolicy,
  PolicyDocument,
  Provider,
  StrategyName,
} from './types.js';

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

describe('Router custom operations', () => {
  const customPolicy = (strategy: StrategyName): PolicyDocument => ({
    tenants: {
      default: {
        providers: ['providerA', 'providerB'],
        operations: { 'consulta-placa': { strategy, timeoutMs: 1000 } },
      },
    },
  });

  it('executes an arbitrary operation name with failover and carries it to result, observer and provider', async () => {
    const providers: Record<string, Provider> = {
      providerA: mkProvider('providerA'),
      providerB: mkProvider('providerB'),
    };
    const cap = capture();
    const router = new Router({
      policy: customPolicy('failover'),
      providers,
      observer: cap.observer,
    });
    const res = await router.execute('consulta-placa', basePayload);
    expect(res.status).toBe('succeeded');
    expect(res.operation).toBe('consulta-placa');
    expect((res.result as { op: string }).op).toBe('consulta-placa');
    expect(cap.started()?.operation).toBe('consulta-placa');
    expect(cap.attempts).toHaveLength(1);
    expect(cap.attempts[0].operation).toBe('consulta-placa');
  });

  it('routes an arbitrary operation name with priority_race', async () => {
    const providers: Record<string, Provider> = {
      providerA: mkProvider('providerA', 'ok', 10),
      providerB: mkProvider('providerB', 'ok', 30),
    };
    const router = new Router({ policy: customPolicy('priority_race'), providers });
    const res = await router.execute('consulta-placa', basePayload);
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('providerA');
    expect(res.operation).toBe('consulta-placa');
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

  it('cascades to the next provider of an overlapping region when fallbackStrategy is failover and the first fails', async () => {
    const router = new Router({
      policy: {
        tenants: {
          default: {
            providers: ['first', 'second'],
            operations: {
              create: {
                strategy: 'geo_rule',
                geo: {
                  field: 'location',
                  rules: [
                    { providers: ['first'], multipolygon: box(-10, -10, 10, 10) },
                    { providers: ['second'], multipolygon: box(-5, -5, 15, 15) },
                  ],
                  fallbackStrategy: 'failover',
                },
              },
            },
          },
        },
      },
      providers: {
        first: mkProvider('first', 'fatal'),
        second: mkProvider('second'),
      },
    });

    const res = await router.execute('create', { data: { location: [0, 0] } });

    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('second');
  });
});

describe('Router priority_race', () => {
  const racePolicy = (op: Partial<OperationPolicy> = {}): PolicyDocument => ({
    tenants: {
      default: {
        providers: ['p1', 'p2', 'p3'],
        operations: {
          create: {
            strategy: 'priority_race',
            timeoutMs: 2000,
            retries: { max: 0, backoffMs: 1 },
            ...op,
          },
        },
      },
    },
  });

  const raceRouter = (
    providers: Record<string, Provider>,
    observer?: { onCancelled?: (ev: CancelledEvent) => void }
  ) => new Router({ policy: racePolicy(), providers, observer });

  const abortAwareProvider = (id: string, resolveMs: number, timeoutMs?: number): Provider => ({
    id,
    timeoutMs,
    invoke: async ctx =>
      new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true, provider: id }), resolveMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        };
        ctx.signal?.addEventListener('abort', onAbort, { once: true });
        if (ctx.signal?.aborted) onAbort();
      }),
  });

  it('returns the first provider result when the first succeeds', async () => {
    const res = await raceRouter({
      p1: mkProvider('p1', 'ok', 10),
      p2: mkProvider('p2', 'ok', 30),
      p3: mkProvider('p3', 'ok', 60),
    }).execute('create', basePayload);
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('p1');
  });

  it('falls through to the next provider when a higher-priority one fails', async () => {
    const res = await raceRouter({
      p1: mkProvider('p1', 'fatal'),
      p2: mkProvider('p2', 'ok', 5),
      p3: mkProvider('p3', 'ok', 30),
    }).execute('create', basePayload);
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('p2');
  });

  it('fails with all_failed when every provider fails', async () => {
    const res = await raceRouter({
      p1: mkProvider('p1', 'fatal'),
      p2: mkProvider('p2', 'fatal'),
      p3: mkProvider('p3', 'fatal'),
    }).execute('create', basePayload);
    expect(res.status).toBe('failed');
    expect(res.error?.code).toBe('all_failed');
  });

  it('cancels lower-priority providers when a higher one succeeds', async () => {
    const cancelled: CancelledEvent[] = [];
    const router = new Router({
      policy: racePolicy(),
      providers: {
        p1: mkProvider('p1', 'ok', 5),
        p2: abortAwareProvider('p2', 200),
        p3: abortAwareProvider('p3', 200),
      },
      observer: { onCancelled: ev => cancelled.push(ev) },
    });
    const res = await router.execute('create', basePayload);
    expect(res.provider).toBe('p1');
    expect(cancelled.map(c => c.reason).sort()).toEqual(['superseded', 'superseded']);
    expect(cancelled.map(c => c.provider).sort()).toEqual(['p2', 'p3']);
  });

  it('respects the per-provider timeout', async () => {
    const cancelled: CancelledEvent[] = [];
    const router = new Router({
      policy: racePolicy({ timeoutMs: undefined }),
      providers: {
        p1: abortAwareProvider('p1', 1000, 20),
        p2: mkProvider('p2', 'ok', 5),
        p3: mkProvider('p3', 'ok', 5),
      },
      observer: { onCancelled: ev => cancelled.push(ev) },
    });
    const res = await router.execute('create', basePayload);
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('p2');
    expect(cancelled.some(c => c.provider === 'p1' && c.reason === 'timeout')).toBe(true);
  });

  it('lets the general timeout override the per-provider timeout', async () => {
    const cancelled: CancelledEvent[] = [];
    const router = new Router({
      policy: racePolicy({ timeoutMs: 5000 }),
      providers: {
        p1: abortAwareProvider('p1', 50, 20),
        p2: mkProvider('p2', 'fatal'),
        p3: mkProvider('p3', 'fatal'),
      },
      observer: { onCancelled: ev => cancelled.push(ev) },
    });
    const res = await router.execute('create', basePayload);
    expect(res.status).toBe('succeeded');
    expect(res.provider).toBe('p1');
    expect(cancelled.filter(c => c.provider === 'p1' && c.reason === 'timeout')).toHaveLength(0);
  });

  it('propagates an external abort to every provider', async () => {
    const controller = new AbortController();
    const cancelled: CancelledEvent[] = [];
    const router = new Router({
      policy: racePolicy(),
      providers: {
        p1: abortAwareProvider('p1', 1000),
        p2: abortAwareProvider('p2', 1000),
      },
      observer: { onCancelled: ev => cancelled.push(ev) },
    });
    setTimeout(() => controller.abort(), 20);
    const res = await router.execute('create', basePayload, { signal: controller.signal });
    expect(res.status).toBe('failed');
    expect(res.error?.code).toBe('aborted');
    expect(cancelled.some(c => c.reason === 'aborted')).toBe(true);
  });
});

describe('Router fan_out', () => {
  const fanOutPolicy = (
    providers: string[],
    op: Partial<OperationPolicy> = {}
  ): PolicyDocument => ({
    tenants: {
      default: {
        providers,
        operations: {
          create: {
            strategy: 'fan_out',
            timeoutMs: 2000,
            ...op,
          },
        },
      },
    },
  });

  const fanOutRouter = (providers: Record<string, Provider>, op: Partial<OperationPolicy> = {}) =>
    new Router({ policy: fanOutPolicy(Object.keys(providers), op), providers });

  const abortAwareProvider = (id: string, resolveMs: number, timeoutMs?: number): Provider => ({
    id,
    timeoutMs,
    invoke: async ctx =>
      new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => resolve({ ok: true, provider: id }), resolveMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        };
        ctx.signal?.addEventListener('abort', onAbort, { once: true });
        if (ctx.signal?.aborted) onAbort();
      }),
  });

  it('waits for every provider and collects a succeeded entry for each', async () => {
    const res = await fanOutRouter({
      p1: mkProvider('p1'),
      p2: mkProvider('p2'),
      p3: mkProvider('p3'),
    }).execute('create', basePayload);

    expect(res.status).toBe('succeeded');
    expect(res.attempts).toBe(3);
    expect(res.provider).toBe('p1,p2,p3');
    expect(res.results).toHaveLength(3);
    expect(res.results?.map(r => r.provider)).toEqual(['p1', 'p2', 'p3']);
    expect(res.results?.every(r => r.status === 'succeeded')).toBe(true);
  });

  it('is succeeded overall when at least one provider succeeds, mixing entries', async () => {
    const res = await fanOutRouter({
      p1: mkProvider('p1', 'fatal'),
      p2: mkProvider('p2'),
      p3: mkProvider('p3', 'fatal'),
    }).execute('create', basePayload);

    expect(res.status).toBe('succeeded');
    const byProvider = Object.fromEntries((res.results ?? []).map(r => [r.provider, r]));
    expect(byProvider.p1.status).toBe('failed');
    expect(byProvider.p1.error).toBeDefined();
    expect(byProvider.p2.status).toBe('succeeded');
    expect(byProvider.p3.status).toBe('failed');
  });

  it('is failed overall (all_failed) when every provider fails', async () => {
    const res = await fanOutRouter({
      p1: mkProvider('p1', 'fatal'),
      p2: mkProvider('p2', 'fatal'),
    }).execute('create', basePayload);

    expect(res.status).toBe('failed');
    expect(res.error?.code).toBe('all_failed');
    expect(res.results).toHaveLength(2);
    expect(res.results?.every(r => r.status === 'failed')).toBe(true);
  });

  it('still populates results with a single entry when there is only one eligible provider', async () => {
    const res = await fanOutRouter({ p1: mkProvider('p1') }).execute('create', basePayload);

    expect(res.status).toBe('succeeded');
    expect(res.results).toHaveLength(1);
    expect(res.results?.[0]).toMatchObject({ provider: 'p1', status: 'succeeded' });
  });

  it('does not cancel other providers when one of them times out', async () => {
    const res = await fanOutRouter(
      {
        p1: abortAwareProvider('p1', 1000, 20),
        p2: mkProvider('p2', 'ok', 5),
      },
      { timeoutMs: undefined }
    ).execute('create', basePayload);

    expect(res.status).toBe('succeeded');
    const byProvider = Object.fromEntries((res.results ?? []).map(r => [r.provider, r]));
    expect(byProvider.p1.status).toBe('failed');
    expect(byProvider.p2.status).toBe('succeeded');
  });
});
