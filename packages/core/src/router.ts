import type {
  Observer,
  OperationName,
  OperationPayload,
  OperationRequestOptions,
  OperationResult,
  PolicyDocument,
  Provider,
  StrategyName,
  TenantPolicy,
} from './types.js';
import { strategies, type SelectionContext } from './strategies.js';
import { buildReceipt, clamp, sleep, uid, AbortedError } from './utils.js';

const DEFAULT_TENANT = 'default';

export interface RouterOptions {
  policy: PolicyDocument;
  providers: Record<string, Provider>;
  tenant?: string;
  observer?: Observer;
  defaultStrategy?: StrategyName;
  defaultTimeoutMs?: number;
}

export class Router {
  private readonly providers: Record<string, Provider>;
  private readonly policy: PolicyDocument;
  private readonly observer?: Observer;
  private readonly defaultStrategy: StrategyName;
  private readonly defaultTimeoutMs: number;
  private readonly rrIndex = { value: 0 };

  constructor(opts: RouterOptions) {
    this.providers = opts.providers;
    this.policy = opts.policy;
    this.observer = opts.observer;
    this.defaultStrategy = opts.defaultStrategy ?? 'round_robin';
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 8000;
  }

  async execute<TData = unknown, TResult = unknown>(
    operation: OperationName,
    payload: OperationPayload<TData>,
    options: OperationRequestOptions = {}
  ): Promise<OperationResult<TResult>> {
    const tenant = this.resolveTenant();
    const opPolicy = tenant.operations[operation] ?? {};
    const strategy = options.strategy ?? opPolicy.strategy ?? this.defaultStrategy;
    const timeoutMs = options.timeoutMs ?? opPolicy.timeoutMs ?? this.defaultTimeoutMs;
    const failover = options.failover ?? opPolicy.failover ?? strategy === 'failover';
    const retries = opPolicy.retries ?? { max: 0, backoffMs: 300 };

    const requestId = payload.externalId ?? uid('req');
    this.observer?.onStart?.({ requestId, operation, strategy });

    const eligible = this.eligibleProviders(tenant);
    if (eligible.length === 0) {
      return this.fail<TResult>(requestId, operation, 'no_providers', 'Nenhum provedor ativo.', 0, 0);
    }

    const weights = opPolicy.weights ?? {};
    const selectionCtx: SelectionContext = {
      strategy,
      eligible,
      weights,
      roundRobinIndex: this.rrIndex,
    };

    const startedAt = performance.now();
    const order = failover ? eligible : [strategies[strategy](selectionCtx)].filter(
      (p): p is Provider => p !== null
    );
    const targets = order.length > 0 ? order : eligible;

    let attempts = 0;
    let lastError: OperationResult<TResult> | null = null;

    for (const provider of targets) {
      const maxAttempts = 1 + (failover ? 0 : clamp(retries.max, 0, 5));
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        attempts++;
        const attemptStart = performance.now();
        try {
          const signal = this.signal(timeoutMs, options.signal);
          const result = await provider.invoke({
            operation,
            requestId,
            payload,
            signal,
          });
          const latencyMs = Math.round(performance.now() - attemptStart);
          this.emitAttempt(provider.id, attempt, true, latencyMs, false, undefined, undefined, requestId, operation);
          const res = this.success<TResult>(requestId, provider.id, operation, result as TResult, latencyMs, attempts);
           this.observer?.onFinish?.(res);
           return res;
         } catch (err) {
const latencyMs = Math.round(performance.now() - attemptStart);
            const transient = isTransient(err);
            this.emitAttempt(provider.id, attempt, false, latencyMs, transient, errMsg(err), errCode(err), requestId, operation);
           if (err instanceof AbortedError || options.signal?.aborted) {
             const out = this.fail<TResult>(requestId, operation, 'aborted', 'operação abortada', latencyMs, attempts, provider.id);
             this.observer?.onFinish?.(out);
             return out;
          }
          if (attempt < maxAttempts && transient) {
            const backoff = retries.backoffMs * Math.pow(retries.backoffMultiplier ?? 1, attempt - 1);
            await sleep(clamp(backoff, 0, 5000), options.signal).catch(() => {});
            continue;
          }
          lastError = this.fail<TResult>(requestId, operation, errCode(err), errMsg(err), latencyMs, attempts, provider.id);
          break;
        }
      }
    }

    const totalMs = Math.round(performance.now() - startedAt);
    const out = lastError ?? this.fail<TResult>(requestId, operation, 'all_failed', 'todos os provedores falharam', totalMs, attempts);
    this.observer?.onFinish?.(out);
    return out;
  }

  private eligibleProviders(tenant: TenantPolicy): Provider[] {
    return tenant.providers
      .map(id => this.providers[id])
      .filter((p): p is Provider => p !== undefined && p.enabled !== false);
  }

  private resolveTenant(): TenantPolicy {
    return this.policy.tenants[DEFAULT_TENANT] ?? { providers: [], operations: {} };
  }

  private signal(timeoutMs: number, parent?: AbortSignal): AbortSignal | undefined {
    if (timeoutMs <= 0 && !parent) return undefined;
    const ctrl = new AbortController();
    const t = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
    const onParentAbort = () => ctrl.abort();
    parent?.addEventListener('abort', onParentAbort, { once: true });
    ctrl.signal.addEventListener('abort', () => {
      if (t) clearTimeout(t);
      parent?.removeEventListener('abort', onParentAbort);
    });
    return ctrl.signal;
  }

  private success<TResult>(
    requestId: string,
    providerId: string,
    operation: OperationName,
    result: TResult,
    latencyMs: number,
    attempts: number
  ): OperationResult<TResult> {
    return {
      id: uid('op'),
      requestId,
      provider: providerId,
      operation,
      status: 'succeeded' as const,
      result,
      latencyMs,
      attempts,
      providerReceipt: buildReceipt(providerId, requestId),
    };
  }

  // Using overload: caller casts to TResult for ergonomics
  private fail<TResult>(
    requestId: string,
    operation: OperationName,
    code: string,
    message: string,
    latencyMs: number,
    attempts: number,
    provider?: string
  ): OperationResult<TResult> {
    return {
      id: uid('op'),
      requestId,
      provider: provider ?? '—',
      operation,
      status: 'failed' as const,
      latencyMs,
      attempts,
      providerReceipt: buildReceipt(provider ?? 'none', requestId),
      error: { code, message, transient: false, provider: provider ?? '—' },
    } as OperationResult<TResult>;
  }

  private emitAttempt(
    provider: string,
    attempt: number,
    ok: boolean,
    latencyMs: number,
    transient: boolean,
    error: string | undefined,
    errorCode: string | undefined,
    requestId: string,
    operation: OperationName
  ): void {
    this.observer?.onAttempt?.({ provider, attempt, ok, latencyMs, transient, error, errorCode, requestId, operation });
  }
}

function isTransient(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object' && err !== null) {
    return (err as { transient?: boolean }).transient === true;
  }
  return false;
}

function errCode(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: string }).code;
    if (typeof code === 'string') return code;
  }
  return 'error';
}

function errMsg(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: string }).message;
    if (typeof message === 'string') return message;
  }
  return 'unknown error';
}