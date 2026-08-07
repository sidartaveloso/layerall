import { describe, expect, it } from 'vitest';
import type { MultiPolygon } from 'geojson';
import {
  loadBalance,
  mostFast,
  roundRobin,
  failover,
  geoRule,
  priorityRace,
  type SelectionContext,
} from './strategies.js';
import { GeoRuleError, type GeoRuleConfig, type Provider } from './types.js';

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

const mk = (over: Partial<Provider> = {}): Provider => ({
  id: over.id ?? 'p',
  weight: over.weight,
  health: over.health,
  baseLatency: over.baseLatency,
  failRate: over.failRate,
  enabled: over.enabled,
  invoke: over.invoke ?? (async () => 'ok'),
});

const ctxFor = (eligible: Provider[], extra: Partial<SelectionContext> = {}): SelectionContext => ({
  strategy: 'round_robin',
  eligible,
  weights: {},
  roundRobinIndex: { value: 0 },
  payload: { data: {} },
  ...extra,
});

const geoConfig = (over: Partial<GeoRuleConfig> = {}): GeoRuleConfig => ({
  field: 'location',
  rules: [{ providers: ['br'], multipolygon: box(-10, -10, 10, 10) }],
  ...over,
});

const geoErrorCode = (fn: () => unknown): GeoRuleError['code'] | 'no-throw' => {
  try {
    fn();
    return 'no-throw';
  } catch (err) {
    return err instanceof GeoRuleError ? err.code : 'other';
  }
};

describe('strategies', () => {
  it('roundRobin cycles in order', () => {
    const eligible = [mk({ id: 'A' }), mk({ id: 'B' }), mk({ id: 'C' })];
    const rrIndex = { value: 0 };
    const picks = Array.from(
      { length: 6 },
      () => roundRobin(ctxFor(eligible, { roundRobinIndex: rrIndex }))?.id
    );
    expect(picks).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
  });

  it('loadBalance respects weights (probabilistic boundary check)', () => {
    const eligible = [mk({ id: 'A', weight: 100 }), mk({ id: 'B', weight: 0 })];
    for (let i = 0; i < 50; i++) {
      const pick = loadBalance(ctxFor(eligible, { weights: { A: 100, B: 0 } }))?.id;
      expect(pick).toBe('A');
    }
  });

  it('mostFast favours lowest latency / best health', () => {
    const eligible = [
      mk({ id: 'slow', baseLatency: 900, health: 0.5, failRate: 0.4 }),
      mk({ id: 'fast', baseLatency: 50, health: 1, failRate: 0 }),
    ];
    const picks = new Set<string>();
    for (let i = 0; i < 50; i++) picks.add(mostFast(ctxFor(eligible))?.id ?? '');
    expect(picks.has('fast')).toBe(true);
    expect(picks.size).toBeLessThanOrEqual(2);
  });

  it('failover returns the first eligible', () => {
    const eligible = [mk({ id: 'A' }), mk({ id: 'B' })];
    expect(failover(ctxFor(eligible))?.id).toBe('A');
  });

  it('every strategy handles an empty pool gracefully', () => {
    const empty = ctxFor([]);
    expect(roundRobin(empty)).toBeNull();
    expect(loadBalance(empty)).toBeNull();
    expect(mostFast(empty)).toBeNull();
    expect(failover(empty)).toBeNull();
  });

  it('priorityRace returns every eligible provider in order', () => {
    const eligible = [mk({ id: 'A' }), mk({ id: 'B' }), mk({ id: 'C' })];
    const selection = priorityRace(ctxFor(eligible));
    expect(Array.isArray(selection)).toBe(true);
    expect((selection as { id: string }[]).map(p => p.id)).toEqual(['A', 'B', 'C']);
  });

  it('priorityRace returns null for an empty pool', () => {
    expect(priorityRace(ctxFor([]))).toBeNull();
  });

  it('geoRule returns the provider of the matched region', () => {
    const ctx = ctxFor([mk({ id: 'br' }), mk({ id: 'us' })], {
      strategy: 'geo_rule',
      geo: geoConfig(),
      payload: { data: { location: [0, 0] } },
    });
    expect(geoRule(ctx)?.id).toBe('br');
  });

  it('geoRule delegates to the fallbackStrategy when multiple regions match', () => {
    const ctx = ctxFor(
      [mk({ id: 'slow', baseLatency: 900 }), mk({ id: 'fast', baseLatency: 50 })],
      {
        strategy: 'geo_rule',
        geo: geoConfig({
          rules: [
            { providers: ['slow'], multipolygon: box(-10, -10, 10, 10) },
            { providers: ['fast'], multipolygon: box(-5, -5, 15, 15) },
          ],
          fallbackStrategy: 'most_fast',
        }),
        payload: { data: { location: [0, 0] } },
      }
    );
    expect(geoRule(ctx)?.id).toBe('fast');
  });

  it('geoRule defaults to round_robin across multiple matches', () => {
    const rrIndex = { value: 0 };
    const ctx = () =>
      ctxFor([mk({ id: 'a' }), mk({ id: 'b' })], {
        strategy: 'geo_rule',
        roundRobinIndex: rrIndex,
        geo: geoConfig({
          rules: [
            { providers: ['a'], multipolygon: box(-10, -10, 10, 10) },
            { providers: ['b'], multipolygon: box(-5, -5, 15, 15) },
          ],
        }),
        payload: { data: { location: [0, 0] } },
      });
    expect(geoRule(ctx())?.id).toBe('a');
    expect(geoRule(ctx())?.id).toBe('b');
  });

  it('geoRule throws geo_unmatched when no rule matches', () => {
    const ctx = ctxFor([mk({ id: 'br' })], {
      strategy: 'geo_rule',
      geo: geoConfig(),
      payload: { data: { location: [50, 50] } },
    });
    expect(() => geoRule(ctx)).toThrow(GeoRuleError);
    expect(geoErrorCode(() => geoRule(ctx))).toBe('geo_unmatched');
  });

  it('geoRule throws geo_bad_payload when the coordinate is invalid', () => {
    const ctx = ctxFor([mk({ id: 'br' })], {
      strategy: 'geo_rule',
      geo: geoConfig(),
      payload: { data: { location: [200, 0] } },
    });
    expect(geoErrorCode(() => geoRule(ctx))).toBe('geo_bad_payload');
  });

  it('geoRule guards against fallbackStrategy equal to geo_rule', () => {
    const ctx = ctxFor([mk({ id: 'br' }), mk({ id: 'us' })], {
      strategy: 'geo_rule',
      geo: geoConfig({
        rules: [
          { providers: ['br'], multipolygon: box(-10, -10, 10, 10) },
          { providers: ['us'], multipolygon: box(-5, -5, 15, 15) },
        ],
        fallbackStrategy: 'geo_rule',
      }),
      payload: { data: { location: [0, 0] } },
    });
    expect(geoErrorCode(() => geoRule(ctx))).toBe('geo_bad_payload');
  });
});
