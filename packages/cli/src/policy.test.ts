import { describe, expect, it } from 'vitest';
import { buildPolicy, validatePolicy } from './policy.js';

describe('policy', () => {
  it('builds a default policy covering all 4 operations', () => {
    const p = buildPolicy({ providers: ['providerA', 'providerB'] });
    const ops = p.tenants.default.operations;
    expect(Object.keys(ops).sort()).toEqual(['cancel', 'create', 'send', 'status']);
    expect(ops.create?.strategy).toBe('round_robin');
    expect(ops.send?.strategy).toBe('load_balance');
    expect(ops.status?.strategy).toBe('most_fast');
    expect(ops.cancel?.strategy).toBe('failover');
    expect(ops.cancel?.failover).toBe(true);
  });

  it('validatePolicy flags malformed shapes', () => {
    expect(validatePolicy(null)).toContain('policy must be an object');
    expect(validatePolicy({})).toContain('missing tenants map');
    expect(validatePolicy({ tenants: { default: {} } })).toContain(
      'tenant "default" providers must be an array'
    );
    expect(validatePolicy(buildPolicy({ providers: ['pA'] }))).toEqual([]);
  });
});