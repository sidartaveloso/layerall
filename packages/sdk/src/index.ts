import type { OperationName, OperationRequestOptions, OperationResult } from './types.js';

export class Orchestrator {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    apiKey: string;
    baseUrl: string;
    /** Mount path of the operation endpoint (default `/v1/operation`). */
    endpoint?: string;
    /** Injectable fetch (for tests/non-browser runtimes). */
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.endpoint = opts.endpoint ?? '/v1/operation';
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Performs an agnostic operation against the orchestrator backend.
   * The backend resolves policy/strategy and routes to the chosen provider.
   */
  async operation<TData = unknown, TResult = unknown>(
    operation: OperationName,
    params: { payload: { externalId?: string; data: TData } } & OperationRequestOptions
  ): Promise<OperationResult<TResult>> {
    const url = `${this.baseUrl}${this.endpoint}/${encodeURIComponent(operation)}`;
    const body = {
      payload: params.payload,
      ...(params.strategy ? { strategy: params.strategy } : {}),
      ...(typeof params.timeoutMs === 'number' ? { timeoutMs: params.timeoutMs } : {}),
      ...(typeof params.failover === 'boolean' ? { failover: params.failover } : {}),
    };

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      ...(params.signal ? { signal: params.signal } : {}),
    });

    const json = (await res.json().catch(() => ({}))) as OperationResult<TResult>;

    if (!res.ok) {
      const err = new OrchestratorError(
        json?.error?.message ?? `HTTP ${res.status}`,
        res.status,
        json?.error?.code ?? 'http_error'
      ) as OrchestratorError & { result: OperationResult<TResult> };
      err.result = json;
      throw err;
    }

    return json;
  }
}

export class OrchestratorError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'OrchestratorError';
    this.status = status;
    this.code = code;
  }
}