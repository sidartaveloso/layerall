import type { GeoRuleConfig, OperationPayload, Provider, StrategyName } from './types.js';
import { GeoRuleError } from './types.js';
import { selectGeoRule } from './geo-rule.js';

/**
 * Internal selection context shared by every strategy.
 * Strategies MUST be pure given this state snapshot so they are trivially testable.
 */
export interface SelectionContext {
  strategy: StrategyName;
  /** Eligible providers, in policy order. */
  eligible: Provider[];
  /** Provider id weights across all registered providers (policy or provider-weighted). */
  weights: Record<string, number>;
  roundRobinIndex: { value: number };
  /** Operation payload, read by `geo_rule` to locate the coordinate. */
  payload: OperationPayload;
  /** Geographic rules used by `geo_rule`. */
  geo?: GeoRuleConfig;
}

export type Strategy = (ctx: SelectionContext) => Provider | null;

/** Round‑robin: cycles through eligible providers in order. */
export const roundRobin: Strategy = ctx => {
  const { eligible, roundRobinIndex } = ctx;
  if (eligible.length === 0) return null;
  const chosen = eligible[roundRobinIndex.value % eligible.length];
  roundRobinIndex.value = (roundRobinIndex.value + 1) % Number.MAX_SAFE_INTEGER;
  return chosen;
};

/** Weighted random selection by provider weight (capacity-aware when no weight). */
export const loadBalance: Strategy = ctx => {
  const { eligible, weights } = ctx;
  if (eligible.length === 0) return null;
  const total = eligible.reduce((sum, p) => sum + (resolveWeight(p, weights) || 0), 0);
  if (total <= 0) return eligible[0];
  let r = Math.random() * total;
  for (const p of eligible) {
    r -= resolveWeight(p, weights) || 0;
    if (r <= 0) return p;
  }
  return eligible[eligible.length - 1];
};

/** Picks the provider with the lowest expected score = latency + health/failure penalty. */
export const mostFast: Strategy = ctx => {
  const { eligible } = ctx;
  if (eligible.length === 0) return null;
  let best: Provider | null = null;
  let bestScore = Infinity;
  for (const p of eligible) {
    const noise = Math.random() * 28 - 14;
    const latency = (p.baseLatency ?? 200) + noise;
    const penalty = (1 - (p.health ?? 1)) * 280 + (p.failRate ?? 0) * 420;
    const score = latency + penalty;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
};

/** Failover: returns the first eligible provider (the router tries them in order on failure). */
export const failover: Strategy = ctx => {
  const { eligible } = ctx;
  return eligible[0] ?? null;
};

/** Geo rule: selects the providers of every region matching the payload coordinate. */
export const geoRule: Strategy = ctx => {
  const geo = ctx.geo;
  if (!geo) throw new GeoRuleError('geo_unmatched', 'configuração geo ausente para geo_rule');
  const outcome = selectGeoRule(geo, ctx.payload, ctx.eligible);
  switch (outcome.kind) {
    case 'hit':
      return outcome.provider;
    case 'fallback': {
      const fallback = geo.fallbackStrategy ?? 'round_robin';
      if (fallback === 'geo_rule') {
        throw new GeoRuleError('geo_bad_payload', 'fallbackStrategy não pode ser geo_rule');
      }
      return strategies[fallback]({ ...ctx, strategy: fallback, eligible: outcome.pool });
    }
    case 'unmatched':
      throw new GeoRuleError('geo_unmatched', 'nenhuma regra geográfica casou');
    case 'bad_payload':
      throw new GeoRuleError('geo_bad_payload', 'coordenada ausente ou inválida');
  }
};

export const strategies: Record<StrategyName, Strategy> = {
  round_robin: roundRobin,
  load_balance: loadBalance,
  most_fast: mostFast,
  failover,
  geo_rule: geoRule,
};

function resolveWeight(p: Provider, weights: Record<string, number>): number {
  const explicit = weights[p.id];
  if (typeof explicit === 'number') return explicit;
  if (typeof p.weight === 'number') return p.weight;
  if (typeof p.capacity === 'number') return p.capacity;
  return 1;
}
