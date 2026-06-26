import { describe, expect, it } from 'vitest';
import { buildReceipt, clamp, uid } from './utils.js';

describe('utils', () => {
  it('clamp limits within range', () => {
    expect(clamp(10, 0, 5)).toBe(5);
    expect(clamp(-3, 0, 5)).toBe(0);
    expect(clamp(2, 0, 5)).toBe(2);
  });

  it('uid produces unique-ish ids with prefix', () => {
    const a = uid('req');
    const b = uid('req');
    expect(a).not.toEqual(b);
    expect(a.startsWith('req_')).toBe(true);
  });

  it('buildReceipt is deterministic per (provider, requestId)', () => {
    const r1 = buildReceipt('providerA', 'req_1');
    const r2 = buildReceipt('providerA', 'req_1');
    const r3 = buildReceipt('providerB', 'req_1');
    expect(r1).toBe(r2);
    expect(r1).not.toEqual(r3);
    expect(r1.startsWith('providerA:req_1:')).toBe(true);
  });
});