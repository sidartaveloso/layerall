import { describe, expect, it } from 'vitest';
import type { MultiPolygon } from 'geojson';
import { selectGeoRule, isGeoCoordinate, isMultiPolygon } from './geo-rule.js';
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

const box3d = (): MultiPolygon => ({
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-10, -10, 100],
        [10, -10, 200],
        [10, 10, 200],
        [-10, 10, 100],
        [-10, -10, 100],
      ],
    ],
  ],
});

const provider = (id: string): Provider => ({ id, invoke: async () => 'ok' });

const payload = (location: unknown): OperationPayload => ({ data: { location } });

const config = (over: Partial<GeoRuleConfig> = {}): GeoRuleConfig => ({
  field: 'location',
  rules: [
    { providers: ['br'], multipolygon: box(-10, -10, 10, 10) },
    { providers: ['us'], multipolygon: box(20, 20, 40, 40) },
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

describe('isMultiPolygon', () => {
  it('accepts 2D and 3D vertices', () => {
    expect(isMultiPolygon(box(-10, -10, 10, 10))).toBe(true);
    expect(isMultiPolygon(box3d())).toBe(true);
  });

  it('rejects malformed geometries', () => {
    expect(isMultiPolygon({ type: 'MultiPolygon' })).toBe(false);
    expect(isMultiPolygon({ type: 'Polygon', coordinates: [] })).toBe(false);
    expect(isMultiPolygon(null)).toBe(false);
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

  it('returns bad_payload when the coordinate field is missing', () => {
    const outcome = selectGeoRule(config(), payload(undefined), [provider('br')]);
    expect(outcome).toEqual({ kind: 'bad_payload' });
  });

  it('returns bad_payload when the coordinate is out of range', () => {
    const outcome = selectGeoRule(config(), payload([200, 0]), [provider('br')]);
    expect(outcome).toEqual({ kind: 'bad_payload' });
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
      rules: [{ providers: ['br'], multipolygon: donut }],
    };
    expect(selectGeoRule(cfg, payload([0, 0]), [provider('br')])).toEqual({ kind: 'unmatched' });
  });

  it('hits a 3D region when the altitude is within the vertex range', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [{ providers: ['uav'], multipolygon: box3d() }],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0, 150]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'hit', provider: expect.objectContaining({ id: 'uav' }) });
  });

  it('skips a 3D region when the altitude is above every vertex', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [{ providers: ['uav'], multipolygon: box3d() }],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0, 5000]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'unmatched' });
  });

  it('skips a 3D region when the altitude is below every vertex', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [{ providers: ['uav'], multipolygon: box3d() }],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0, 50]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'unmatched' });
  });

  it('returns bad_payload when a 3D region contains the footprint but the point has no altitude', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [{ providers: ['uav'], multipolygon: box3d() }],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0]), [provider('uav')]);
    expect(outcome).toEqual({ kind: 'bad_payload' });
  });

  it('treats altitude as inert for a 2D region', () => {
    const outcome = selectGeoRule(config(), payload([0, 0, 9000]), [provider('br')]);
    expect(outcome).toEqual({ kind: 'hit', provider: expect.objectContaining({ id: 'br' }) });
  });

  it('returns a fallback pool when overlapping rules match, preserving order and deduplicating', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [
        { providers: ['br', 'shared'], multipolygon: box(-10, -10, 10, 10) },
        { providers: ['shared'], multipolygon: box(-5, -5, 15, 15) },
      ],
    };
    const pool = [provider('br'), provider('shared'), provider('other')];
    const outcome = selectGeoRule(cfg, payload([0, 0]), pool);
    expect(outcome).toEqual({ kind: 'fallback', pool: [pool[0], pool[1]] });
  });

  it('only collects providers present in the eligible pool', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [{ providers: ['br', 'ghost'], multipolygon: box(-10, -10, 10, 10) }],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0]), [provider('br')]);
    expect(outcome).toEqual({ kind: 'hit', provider: expect.objectContaining({ id: 'br' }) });
  });

  it('returns unmatched when every matched provider is absent from the eligible pool', () => {
    const cfg: GeoRuleConfig = {
      field: 'location',
      rules: [{ providers: ['ghost'], multipolygon: box(-10, -10, 10, 10) }],
    };
    const outcome = selectGeoRule(cfg, payload([0, 0]), [provider('br')]);
    expect(outcome).toEqual({ kind: 'unmatched' });
  });
});
