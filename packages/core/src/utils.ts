/** Generates a short unique id (timestamp + random). */
export function uid(prefix = ''): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}${prefix ? '_' : ''}${ts}${rand}`;
}

/** Clamps `n` between `min` and `max`. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Sleep helper that respects an optional AbortSignal. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(t);
      reject(new AbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

/** Builds a stable audit receipt from the provider id and requestId. */
export function buildReceipt(providerId: string, requestId: string): string {
  const h = simpleHash(`${providerId}:${requestId}`);
  return `${providerId}:${requestId}:${h.toString(36)}`;
}

function simpleHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}