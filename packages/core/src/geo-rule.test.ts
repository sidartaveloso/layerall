import { describe, expect, it } from 'vitest';
import type { MultiPolygon } from 'geojson';
import { selectGeoRule, isGeoCoordinate } from './geo-rule.js';
import type { GeoRuleConfig, OperationPayload, Provider } from './types.js';

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

const provider = (id: string): Provider => ({ id, invoke: async () => 'ok' });

const payload = (location: unknown): OperationPayload => ({ data: { location } });

const config = (over: Partial<GeoRuleConfig> = {}): GeoRuleConfig => ({
  field: 'location',
  rules: [
    { providers: ['br'], shape: { kind: 'area', multipolygon: box(-10, -10, 10, 10) } },
    { providers: ['us'], shape: { kind: 'area', multipolygon: box(20, 20, 40, 40) } },
  ],
  ...over,
});

describe('isGeoCoordinate', () => {
  it('accepts a two-dimensional position', () => {
    expect(isGeoCoordinate([0, 0])).toBe(true);
  });

  it('accepts a three-dimensional position', () => {
    expect(isGeoCoordinate([0, 0, 300])).toBe(true);
  });

  it('rejects non-arrays and wrong sizes', () => {
    expect(isGeoCoordinate({ lat: 0, lng: 0 })).toBe(false);
    expect(isGeoCoordinate([0])).toBe(false);
    expect(isGeoCoordinate([0, 0, 300, 4])).toBe(false);
  });

  it('rejects out-of-range longitude and latitude', () => {
    expect(isGeoCoordinate([181, 0])).toBe(false);
    expect(isGeoCoordinate([0, 91])).toBe(false);
    expect(isGeoCoordinate([0, -91])).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(isGeoCoordinate([0, 'x'])).toBe(false);
    expect(isGeoCoordinate([0, 0, 'alt'])).toBe(false);
  });
});

describe('selectGeoRule', () => {
  it('hits the single provider whose area contains the point', () => {
    const outcome = selectGeoRule(config(), payload([0, 0]), [provider('br'), provider('us')]);
    expect(outcome).toEqual({ kind: 'hit', provider: expect.objectContaining({ id: 'br' }) });
  });

  it('returns unmatched when the point is outside every rule', () => {
    const outcome = selectGeoRule(config(), payload([50, 50]), [provider('br'), provider('us')]);
    expect(outcome).toEqual({ kind: 'unmatched' });
  });

  it('returns unmatched for a point inside the hole of a multipolygon', () => {
    const donut: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-10, -10],
            [10, -10],
            [10, 10],
            [-10, 10],
            [-10, -10],
          ],
          [
            [-5, -5],
            [-5, 5],
            [5, 5],
            [5, -5],
            [-5, -5],
          ],
        ],
      ],
    };
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [{ providers: ['br'], shape: { kind: 'area', multipolygon: donut } }],
    };
    expect(selectGeoRule(cfg, payload([0, 0]), [provider('br')])).toEqual({ kind: 'unmatched' });
  });

  it('returns bad_payload when the coordinate field is missing', () => {
    const outcome = selectGeoRule(config(), payload(undefined), [provider('br')]);
    expect(outcome).toEqual({ kind: 'bad_payload' });
  });

  it('returns bad_payload when the coordinate is out of range', () => {
    const outcome = selectGeoRule(config(), payload([200, 0]), [provider('br')]);
    expect(outcome).toEqual({ kind: 'bad_payload' });
  });

  it('hits a volume when the altitude is inside the band', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        {
          providers: ['uav'],
          shape: {
            kind: 'volume',
            multipolygon: box(-10, -10, 10, 10),
            minAltitude: 100,
            maxAltitude: 600,
          },
        },
      ],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0, 300]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'hit', provider: expect.objectContaining({ id: 'uav' }) });
  });

  it('skips a volume when the altitude is below the floor', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        {
          providers: ['uav'],
          shape: {
            kind: 'volume',
            multipolygon: box(-10, -10, 10, 10),
            minAltitude: 100,
            maxAltitude: 600,
          },
        },
      ],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0, 50]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'unmatched' });
  });

  it('skips a volume when the altitude is above the ceiling', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        {
          providers: ['uav'],
          shape: {
            kind: 'volume',
            multipolygon: box(-10, -10, 10, 10),
            minAltitude: 100,
            maxAltitude: 600,
          },
        },
      ],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0, 1000]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'unmatched' });
  });

  it('accepts any altitude above the floor when the ceiling is open', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        {
          providers: ['uav'],
          shape: { kind: 'volume', multipolygon: box(-10, -10, 10, 10), minAltitude: 100 },
        },
      ],
    };
    expect(selectGeoRule(cfg, payload([0, 0, 5000]), [provider('uav')])).toEqual({
      kind: 'hit',
      provider: expect.objectContaining({ id: 'uav' }),
    });
  });

  it('returns bad_payload when a volume footprint matches but altitude is missing', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        {
          providers: ['uav'],
          shape: {
            kind: 'volume',
            multipolygon: box(-10, -10, 10, 10),
            minAltitude: 100,
            maxAltitude: 600,
          },
        },
      ],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'bad_payload' });
  });

  it('returns bad_payload when a volume declares no altitude bound', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        { providers: ['uav'], shape: { kind: 'volume', multipolygon: box(-10, -10, 10, 10) } },
      ],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0, 300]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'bad_payload' });
  });

  it('returns bad_payload when a volume floor exceeds its ceiling', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        {
          providers: ['uav'],
          shape: {
            kind: 'volume',
            multipolygon: box(-10, -10, 10, 10),
            minAltitude: 600,
            maxAltitude: 100,
          },
        },
      ],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0, 300]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'bad_payload' });
  });

  it('returns a fallback pool when overlapping rules match, preserving order and deduplicating', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        {
          providers: ['br', 'shared'],
          shape: { kind: 'area', multipolygon: box(-10, -10, 10, 10) },
        },
        { providers: ['shared'], shape: { kind: 'area', multipolygon: box(-5, -5, 15, 15) } },
      ],
    };
    const pool = [provider('br'), provider('shared'), provider('other')];
    const outcome = selectGeoRule(cfg, payload([0, 0]), pool);
    expect(outcome).toEqual({ kind: 'fallback', pool: [pool[0], pool[1]] });
  });

  it('only collects providers present in the eligible pool', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        {
          providers: ['br', 'ghost'],
          shape: { kind: 'area', multipolygon: box(-10, -10, 10, 10) },
        },
      ],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0]), [provider('br')]);
    expect(outcome).toEqual({ kind: 'hit', provider: expect.objectContaining({ id: 'br' }) });
  });

  it('returns unmatched when every matched provider is absent from the eligible pool', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        { providers: ['ghost'], shape: { kind: 'area', multipolygon: box(-10, -10, 10, 10) } },
      ],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0]), [provider('br')]);
    expect(outcome).toEqual({ kind: 'unmatched' });
  });
});
