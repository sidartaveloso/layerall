import { describe, expect, it, vi } from 'vitest';
import { Orchestrator, OrchestratorError } from './index.js';

function fakeFetch(map: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    const entry = map[url] ?? map['*'] ?? { status: 200, body: { id: 'op_1', requestId: 'req_1', provider: 'providerA', operation: 'create', status: 'succeeded', latencyMs: 12, attempts: 1, providerReceipt: 'providerA:req_1:abc' } };
    return new Response(JSON.stringify(entry.body), { status: entry.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Orchestrator SDK', () => {
  it('POSTs to /v1/operation/<op> with auth header', async () => {
    const { fn, calls } = fakeFetch({});
    const client = new Orchestrator({ apiKey: 'key_x', baseUrl: 'https://api.allx.com', fetchImpl: fn });
    const res = await client.operation('create', { payload: { externalId: 'req_1', data: { x: 1 } } });
    expect(res.status).toBe('succeeded');
    expect(calls[0].url).toBe('https://api.allx.com/v1/operation/create');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer key_x');
  });

  it('forwards strategy/timeout as body and throws OrchestratorError on failure', async () => {
    const { fn, calls } = fakeFetch({
      'https://api.allx.com/v1/operation/send': {
        status: 504,
        body: { id: 'op_2', requestId: 'req_2', provider: 'providerB', operation: 'send', status: 'failed', latencyMs: 9000, attempts: 3, providerReceipt: 'providerB:req_2:z', error: { code: 'timeout', message: 'upstream timeout', provider: 'providerB' } },
      },
    });
    const client = new Orchestrator({ apiKey: 'k', baseUrl: 'https://api.allx.com', fetchImpl: fn });
    await expect(
      client.operation('send', { payload: { data: {} }, strategy: 'load_balance', timeoutMs: 12000 })
    ).rejects.toMatchObject({ name: 'OrchestratorError', status: 504, code: 'timeout' });
    const sent = JSON.parse(String(calls[0].init?.body));
    expect(sent.strategy).toBe('load_balance');
    expect(sent.timeoutMs).toBe(12000);
  });
});