import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { MultiPolygon } from 'geojson';
import type { GeoCoordinate, GeoRuleConfig, OperationPayload, Provider } from './types.js';

/** Result of a geographic selection, exhaustive over the four desfechos. */
export type GeoRuleOutcome =
  | { kind: 'hit'; provider: Provider }
  | { kind: 'fallback'; pool: Provider[] }
  | { kind: 'unmatched' }
  | { kind: 'bad_payload' };

/** Narrowing guard for a WGS 84 position in GeoJSON order. */
export function isGeoCoordinate(value: unknown): value is GeoCoordinate {
  if (!Array.isArray(value)) return false;
  if (value.length < 2 || value.length > 3) return false;
  const [lng, lat, alt] = value as unknown[];
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
  if (value.length === 3 && typeof alt !== 'number') return false;
  return true;
}

/** Narrowing guard for a GeoJSON MultiPolygon whose vertices accept altitude. */
export function isMultiPolygon(value: unknown): value is MultiPolygon {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'MultiPolygon') return false;
  if (!Array.isArray(candidate.coordinates)) return false;
  return candidate.coordinates.every(
    polygon =>
      Array.isArray(polygon) &&
      polygon.every(
        ring =>
          Array.isArray(ring) && ring.length >= 4 && ring.every(position => isPosition(position))
      )
  );
}

/**
 * Pure geographic selection: matches the payload coordinate against every rule
 * and returns the union of their eligible providers.
 */
export function selectGeoRule(
  config: GeoRuleConfig,
  payload: OperationPayload,
  eligible: Provider[]
): GeoRuleOutcome {
  const coord = (payload.data as Record<string, unknown>)[config.field];
  if (!isGeoCoordinate(coord)) return { kind: 'bad_payload' };
  const [lng, lat, alt] = coord;

  const pool: Provider[] = [];
  for (const rule of config.rules) {
    if (!isMultiPolygon(rule.multipolygon)) return { kind: 'bad_payload' };
    const inside = booleanPointInPolygon([lng, lat], rule.multipolygon);
    if (!inside) continue;
    const range = altitudeRange(rule.multipolygon);
    if (range) {
      if (alt === undefined) return { kind: 'bad_payload' };
      if (alt < range.min || alt > range.max) continue;
    }
    for (const id of rule.providers) {
      const found = eligible.find(p => p.id === id);
      if (found && !pool.includes(found)) pool.push(found);
    }
  }

  if (pool.length === 0) return { kind: 'unmatched' };
  if (pool.length === 1) return { kind: 'hit', provider: pool[0] };
  return { kind: 'fallback', pool };
}

function isPosition(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length < 2 || value.length > 3) return false;
  const [lng, lat, alt] = value as unknown[];
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (value.length === 3 && (typeof alt !== 'number' || !Number.isFinite(alt))) return false;
  return true;
}

function altitudeRange(multipolygon: MultiPolygon): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let found = false;
  for (const polygon of multipolygon.coordinates) {
    for (const ring of polygon) {
      for (const position of ring) {
        const alt = position[2];
        if (typeof alt === 'number') {
          found = true;
          if (alt < min) min = alt;
          if (alt > max) max = alt;
        }
      }
    }
  }
  return found ? { min, max } : null;
}
