import type {
  CancelledReason,
  FanOutEntry,
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
import { GeoRuleError } from './types.js';
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
      return this.fail<TResult>(
        requestId,
        operation,
        'no_providers',
        'Nenhum provedor ativo.',
        0,
        0
      );
    }

    const weights = opPolicy.weights ?? {};
    const selectionCtx: SelectionContext = {
      strategy,
      eligible,
      weights,
      roundRobinIndex: this.rrIndex,
      payload,
      geo: opPolicy.geo,
    };

    const startedAt = performance.now();
    let order: Provider[];
    try {
      const selection = failover ? eligible : strategies[strategy](selectionCtx);
      order = Array.isArray(selection) ? selection : selection ? [selection] : [];
    } catch (err) {
      if (err instanceof GeoRuleError) {
        const out = this.fail<TResult>(requestId, operation, err.code, err.message, 0, 0);
        this.observer?.onFinish?.(out);
        return out;
      }
      throw err;
    }
    const targets = order.length > 0 ? order : eligible;

    if (strategy === 'priority_race' && targets.length > 1) {
      const explicitTimeout = options.timeoutMs ?? opPolicy.timeoutMs;
      const out = await this.executeParallel<TResult>(
        operation,
        requestId,
        payload,
        targets,
        explicitTimeout,
        options.signal
      );
      this.observer?.onFinish?.(out);
      return out;
    }

    if (strategy === 'fan_out') {
      const explicitTimeout = options.timeoutMs ?? opPolicy.timeoutMs;
      const out = await this.executeFanOut<TResult>(
        operation,
        requestId,
        payload,
        targets,
        explicitTimeout
      );
      this.observer?.onFinish?.(out);
      return out;
    }

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
          this.emitAttempt(
            provider.id,
            attempt,
            true,
            latencyMs,
            false,
            undefined,
            undefined,
            requestId,
            operation
          );
          const res = this.success<TResult>(
            requestId,
            provider.id,
            operation,
            result as TResult,
            latencyMs,
            attempts
          );
          this.observer?.onFinish?.(res);
          return res;
        } catch (err) {
          const latencyMs = Math.round(performance.now() - attemptStart);
          const transient = isTransient(err);
          this.emitAttempt(
            provider.id,
            attempt,
            false,
            latencyMs,
            transient,
            errMsg(err),
            errCode(err),
            requestId,
            operation
          );
          if (err instanceof AbortedError || options.signal?.aborted) {
            const out = this.fail<TResult>(
              requestId,
              operation,
              'aborted',
              'operação abortada',
              latencyMs,
              attempts,
              provider.id
            );
            this.observer?.onFinish?.(out);
            return out;
          }
          if (attempt < maxAttempts && transient) {
            const backoff =
              retries.backoffMs * Math.pow(retries.backoffMultiplier ?? 1, attempt - 1);
            await sleep(clamp(backoff, 0, 5000), options.signal).catch(() => {});
            continue;
          }
          lastError = this.fail<TResult>(
            requestId,
            operation,
            errCode(err),
            errMsg(err),
            latencyMs,
            attempts,
            provider.id
          );
          break;
        }
      }
    }

    const totalMs = Math.round(performance.now() - startedAt);
    const out =
      lastError ??
      this.fail<TResult>(
        requestId,
        operation,
        'all_failed',
        'todos os provedores falharam',
        totalMs,
        attempts
      );
    this.observer?.onFinish?.(out);
    return out;
  }

  private async executeParallel<TResult>(
    operation: OperationName,
    requestId: string,
    payload: OperationPayload,
    targets: Provider[],
    explicitTimeoutMs: number | undefined,
    externalSignal: AbortSignal | undefined
  ): Promise<OperationResult<TResult>> {
    interface ParallelAttempt {
      ok: boolean;
      result?: TResult;
      error?: unknown;
      latencyMs: number;
      cancelled?: CancelledReason;
    }

    interface ParallelTask {
      provider: Provider;
      index: number;
      controller: AbortController;
      timer?: ReturnType<typeof setTimeout>;
      cancelled?: CancelledReason;
      promise: Promise<ParallelAttempt>;
    }

    const tasks: ParallelTask[] = targets.map((provider, index) => {
      const controller = new AbortController();
      const task: ParallelTask = {
        provider,
        index,
        controller,
        promise: Promise.resolve({ ok: false, latencyMs: 0 }),
      };
      const effectiveTimeout = explicitTimeoutMs ?? provider.timeoutMs ?? this.defaultTimeoutMs;
      if (effectiveTimeout > 0) {
        task.timer = setTimeout(() => {
          if (!task.cancelled) {
            task.cancelled = 'timeout';
            controller.abort();
            this.emitCancelled(requestId, provider, operation, 'timeout');
          }
        }, effectiveTimeout);
      }
      task.promise = (async () => {
        const start = performance.now();
        try {
          const result = await provider.invoke({
            operation,
            requestId,
            payload,
            signal: controller.signal,
          });
          const latencyMs = Math.round(performance.now() - start);
          this.emitAttempt(
            provider.id,
            index + 1,
            true,
            latencyMs,
            false,
            undefined,
            undefined,
            requestId,
            operation
          );
          return { ok: true, result: result as TResult, latencyMs, cancelled: task.cancelled };
        } catch (err) {
          const latencyMs = Math.round(performance.now() - start);
          const transient = isTransient(err);
          this.emitAttempt(
            provider.id,
            index + 1,
            false,
            latencyMs,
            transient,
            errMsg(err),
            errCode(err),
            requestId,
            operation
          );
          return { ok: false, error: err, latencyMs, cancelled: task.cancelled };
        }
      })();
      return task;
    });

    const startedAt = performance.now();
    let externalAborted = false;
    let onExternalAbort: (() => void) | undefined;
    if (externalSignal) {
      onExternalAbort = () => {
        externalAborted = true;
        for (const task of tasks) {
          if (!task.cancelled) {
            task.cancelled = 'aborted';
            task.controller.abort();
            this.emitCancelled(requestId, task.provider, operation, 'aborted');
          }
        }
      };
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let attempts = 0;
    let winner: OperationResult<TResult> | null = null;
    for (const task of tasks) {
      if (winner) break;
      const outcome = await task.promise;
      attempts++;
      if (outcome.ok && task.cancelled === undefined) {
        winner = this.success<TResult>(
          requestId,
          task.provider.id,
          operation,
          outcome.result as TResult,
          outcome.latencyMs,
          attempts
        );
        for (const lower of tasks) {
          if (lower.index > task.index && !lower.cancelled) {
            lower.cancelled = 'superseded';
            lower.controller.abort();
            this.emitCancelled(requestId, lower.provider, operation, 'superseded');
          }
        }
      } else if (outcome.cancelled === 'aborted') {
        externalAborted = true;
        break;
      }
    }

    for (const task of tasks) {
      if (task.timer) clearTimeout(task.timer);
    }
    if (externalSignal && onExternalAbort)
      externalSignal.removeEventListener('abort', onExternalAbort);

    if (externalAborted) {
      return this.fail<TResult>(
        requestId,
        operation,
        'aborted',
        'operação abortada',
        Math.round(performance.now() - startedAt),
        attempts
      );
    }
    if (winner) return winner;
    return this.fail<TResult>(
      requestId,
      operation,
      'all_failed',
      'todos os provedores falharam',
      Math.round(performance.now() - startedAt),
      attempts
    );
  }

  /**
   * Fires every target in parallel and waits for ALL of them to settle
   * (success or failure) — unlike `executeParallel` (`priority_race`), no
   * provider is ever cancelled because another one succeeded; there is no
   * "winner". Each outcome becomes a `FanOutEntry` in `results`; the Router
   * never merges the `result`s themselves, that stays the caller's job.
   */
  private async executeFanOut<TResult>(
    operation: OperationName,
    requestId: string,
    payload: OperationPayload,
    targets: Provider[],
    explicitTimeoutMs: number | undefined
  ): Promise<OperationResult<TResult>> {
    const startedAt = performance.now();

    const entries = await Promise.all(
      targets.map(async (provider): Promise<FanOutEntry<TResult>> => {
        const effectiveTimeout = explicitTimeoutMs ?? provider.timeoutMs ?? this.defaultTimeoutMs;
        const controller = new AbortController();
        const timer =
          effectiveTimeout > 0 ? setTimeout(() => controller.abort(), effectiveTimeout) : undefined;

        const start = performance.now();
        try {
          const result = await provider.invoke({
            operation,
            requestId,
            payload,
            signal: controller.signal,
          });
          const latencyMs = Math.round(performance.now() - start);
          this.emitAttempt(
            provider.id,
            1,
            true,
            latencyMs,
            false,
            undefined,
            undefined,
            requestId,
            operation
          );
          return {
            provider: provider.id,
            status: 'succeeded',
            result: result as TResult,
            latencyMs,
          };
        } catch (err) {
          const latencyMs = Math.round(performance.now() - start);
          const transient = isTransient(err);
          this.emitAttempt(
            provider.id,
            1,
            false,
            latencyMs,
            transient,
            errMsg(err),
            errCode(err),
            requestId,
            operation
          );
          return {
            provider: provider.id,
            status: 'failed',
            error: { code: errCode(err), message: errMsg(err), transient, provider: provider.id },
            latencyMs,
          };
        } finally {
          if (timer) clearTimeout(timer);
        }
      })
    );

    const providerIds = targets.map(p => p.id).join(',');
    const totalMs = Math.round(performance.now() - startedAt);
    const attempts = entries.length;
    const algumSucesso = entries.some(e => e.status === 'succeeded');

    if (!algumSucesso) {
      return {
        id: uid('op'),
        requestId,
        provider: providerIds || '—',
        operation,
        status: 'failed',
        results: entries,
        latencyMs: totalMs,
        attempts,
        providerReceipt: buildReceipt(providerIds || 'none', requestId),
        error: {
          code: 'all_failed',
          message: 'todos os provedores falharam',
          transient: false,
          provider: providerIds || '—',
        },
      };
    }

    return {
      id: uid('op'),
      requestId,
      provider: providerIds,
      operation,
      status: 'succeeded',
      results: entries,
      latencyMs: totalMs,
      attempts,
      providerReceipt: buildReceipt(providerIds, requestId),
    };
  }

  private emitCancelled(
    requestId: string,
    provider: Provider,
    operation: OperationName,
    reason: CancelledReason
  ): void {
    this.observer?.onCancelled?.({ requestId, provider: provider.id, operation, reason });
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
    this.observer?.onAttempt?.({
      provider,
      attempt,
      ok,
      latencyMs,
      transient,
      error,
      errorCode,
      requestId,
      operation,
    });
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
