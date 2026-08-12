import { describe, expect, it } from 'vitest';
import { isFanOutResult, mergeFanOut } from './fan-out.js';
import type { OperationResult } from './types.js';

function baseResult(over: Partial<OperationResult> = {}): OperationResult {
  return {
    id: 'op_1',
    requestId: 'req_1',
    provider: 'a,b',
    operation: 'list',
    status: 'succeeded',
    latencyMs: 10,
    attempts: 2,
    providerReceipt: 'a,b:req_1:xyz',
    ...over,
  };
}

describe('isFanOutResult', () => {
  it('is true when results is present', () => {
    const result = baseResult({
      results: [{ provider: 'a', status: 'succeeded', result: [1], latencyMs: 5 }],
    });
    expect(isFanOutResult(result)).toBe(true);
  });

  it('is false when results is absent (non fan_out strategies)', () => {
    const result = baseResult({ result: [1] });
    expect(isFanOutResult(result)).toBe(false);
  });

  it('narrows the type: TS lets you access .results without optional chaining after the guard', () => {
    const result = baseResult({
      results: [{ provider: 'a', status: 'succeeded', result: [1], latencyMs: 5 }],
    });
    if (isFanOutResult(result)) {
      // Se isso não compilasse, o teste falharia no typecheck do pacote, não aqui.
      expect(result.results.length).toBe(1);
    }
  });
});

describe('mergeFanOut', () => {
  it('passes only the successful results, in order, to the merge function', () => {
    const result = baseResult({
      results: [
        { provider: 'a', status: 'succeeded', result: [1, 2], latencyMs: 5 },
        {
          provider: 'b',
          status: 'failed',
          error: { code: 'x', message: 'falhou', provider: 'b' },
          latencyMs: 3,
        },
        { provider: 'c', status: 'succeeded', result: [3], latencyMs: 8 },
      ],
    });

    const merged = mergeFanOut(result, successful => successful.flat());

    expect(merged).toEqual([1, 2, 3]);
  });

  it('infers TMerged from the merge function return type (compile-time — the assertion below just documents it)', () => {
    const result = baseResult({
      results: [{ provider: 'a', status: 'succeeded', result: 'x', latencyMs: 5 }],
    });

    const merged: number = mergeFanOut(result, successful => successful.length);

    expect(merged).toBe(1);
  });

  it('calls merge with an empty array when every provider failed', () => {
    const result = baseResult({
      status: 'failed',
      results: [
        {
          provider: 'a',
          status: 'failed',
          error: { code: 'x', message: 'falhou', provider: 'a' },
          latencyMs: 5,
        },
      ],
    });

    const merged = mergeFanOut(result, successful => successful.length);

    expect(merged).toBe(0);
  });

  it('throws a clear error when the result is not from a fan_out strategy', () => {
    const result = baseResult({ result: 'x' });

    expect(() => mergeFanOut(result, successful => successful.length)).toThrow(/fan_out/i);
  });
});
