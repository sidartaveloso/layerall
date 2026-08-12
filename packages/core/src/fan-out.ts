import type { FanOutEntry, OperationResult } from './types.js';

/**
 * Narrows an `OperationResult` to the shape produced by the `fan_out`
 * strategy (`results` populated). The Router can't know this at compile
 * time when the strategy comes from a policy resolved at runtime — this
 * type guard is the honest way to recover the narrower type where you do
 * know it (e.g. right after a call you configured with `strategy: 'fan_out'`).
 */
export function isFanOutResult<TResult>(
  result: OperationResult<TResult>
): result is OperationResult<TResult> & { results: FanOutEntry<TResult>[] } {
  return result.results !== undefined;
}

/**
 * Combines the successful outcomes of a `fan_out` result. The Router itself
 * never merges `result`s — that's domain-specific (dedup by business key,
 * union of lists, whatever) — this is a small composable helper for the
 * common case of "reduce every successful result into one value", not a
 * parameter on `Router.execute`. `TMerged` is inferred from `merge`'s return
 * type; you never annotate it by hand.
 */
export function mergeFanOut<TResult, TMerged>(
  result: OperationResult<TResult>,
  merge: (successful: TResult[]) => TMerged
): TMerged {
  if (!isFanOutResult(result)) {
    throw new Error(
      'mergeFanOut só aceita OperationResult de uma operação com strategy fan_out (result.results ausente)'
    );
  }

  const successful = result.results
    .filter(
      (entry): entry is FanOutEntry<TResult> & { status: 'succeeded' } =>
        entry.status === 'succeeded'
    )
    .map(entry => entry.result as TResult);

  return merge(successful);
}
