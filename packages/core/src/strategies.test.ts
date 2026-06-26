import { describe, expect, it } from 'vitest';
import {
  loadBalance,
  mostFast,
  roundRobin,
  failover,
  type SelectionContext,
} from './strategies.js';
import type { Provider } from './types.js';

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
  ...extra,
});

describe('strategies', () => {
  it('roundRobin cycles in order', () => {
    const eligible = [mk({ id: 'A' }), mk({ id: 'B' }), mk({ id: 'C' })];
    const rrIndex = { value: 0 };
    const picks = Array.from({ length: 6 }, () =>
      roundRobin(ctxFor(eligible, { roundRobinIndex: rrIndex }))?.id
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
    const eligible = [mk({ id: 'slow', baseLatency: 900, health: 0.5, failRate: 0.4 }), mk({ id: 'fast', baseLatency: 50, health: 1, failRate: 0 })];
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
});