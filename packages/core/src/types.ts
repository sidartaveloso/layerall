/** Canonical operations an orchestrator exposes to clients. */
export type OperationName = 'create' | 'send' | 'status' | 'cancel';

/** Pluggable routing strategies. */
export type StrategyName = 'round_robin' | 'load_balance' | 'most_fast' | 'failover';

/** A registered provider implementation. Adapters map domain calls to `invoke`. */
export interface Provider<TContext = unknown, TResult = unknown> {
  id: string;
  /** Optional weights used by `load_balance`. Higher weight = more traffic share. */
  weight?: number;
  /** Optional capacity hint used by `load_balance` when `weight` is absent. */
  capacity?: number;
  /** Whether the provider is currently eligible for routing (defaults to true). */
  enabled?: boolean;
  /** Optional current health score in [0, 1]; used by `most_fast` and failover scoring. */
  health?: number;
  /** Optional base latency in ms; used by `most_fast` as the expected response time. */
  baseLatency?: number;
  /** Optional transient failure rate in [0, 1]; used by `most_fast` as a penalty. */
  failRate?: number;
  /**
   * Executes the operation against this provider. Implementations translate the
   * provider-agnostic call into a concrete downstream API request.
   */
  invoke: (ctx: InvokeContext<TContext>) => Promise<TResult>;
}

/** Context passed to a provider on invocation. `payload` is domain-specific. */
export interface InvokeContext<TData = unknown> {
  operation: OperationName;
  requestId: string;
  payload: OperationPayload<TData>;
  signal?: AbortSignal;
}

/** Generic operation payload. `externalId` enables idempotency. */
export interface OperationPayload<TData = unknown> {
  externalId?: string;
  data: TData;
}

/** Outcome returned to the client, normalized across providers. */
export interface OperationResult<TResult = unknown> {
  id: string;
  requestId: string;
  provider: string;
  operation: OperationName;
  status: 'succeeded' | 'failed';
  result?: TResult;
  error?: OperationError;
  /** Latency observed for the successful/terminal call, in ms. */
  latencyMs: number;
  /** Number of provider attempts consumed (including the successful one). */
  attempts: number;
  /** Stable receipt for audit/storage; derived from provider + requestId. */
  providerReceipt: string;
}

/** Normalized error surface. */
export interface OperationError {
  code: string;
  message: string;
  /** Whether the error is likely transient (retryable). */
  transient?: boolean;
  provider: string;
}

/** Per-operation retry policy. */
export interface RetryPolicy {
  max: number;
  backoffMs: number;
  /** Optional multiplier applied between successive backoffs (default 1, i.e. fixed). */
  backoffMultiplier?: number;
}

/** Per-operation configuration entry in a tenant policy. */
export interface OperationPolicy {
  strategy?: StrategyName;
  timeoutMs?: number;
  retries?: RetryPolicy;
  failover?: boolean;
  /** Explicit weights keyed by provider id (overrides `Provider.weight`). */
  weights?: Record<string, number>;
  /** Optional short cache TTL for idempotent reads such as `status`. */
  cacheTtlMs?: number;
}

/** Flags set by the client on a per-request basis to override policy. */
export interface OperationRequestOptions {
  strategy?: StrategyName;
  timeoutMs?: number;
  failover?: boolean;
  signal?: AbortSignal;
}

/** A tenant routing policy. */
export interface TenantPolicy {
  providers: string[];
  operations: Partial<Record<OperationName, OperationPolicy>>;
}

/** Root policy document keyed by tenant id. */
export interface PolicyDocument {
  tenants: Record<string, TenantPolicy>;
}

/** Metadata collected per attempt for observability. */
export interface AttemptLog {
  /** Id of the request this attempt belongs to. */
  requestId: string;
  /** Operation being executed. */
  operation: OperationName;
  provider: string;
  attempt: number;
  ok: boolean;
  latencyMs: number;
  transient: boolean;
  /** Human-readable error message when `ok === false`. */
  error?: string;
  /** Stable error code (e.g. `upstream_error`, `timeout`) when `ok === false`. */
  errorCode?: string;
}

/** Sink receiving attempt logs and final outcomes for observability. */
export interface Observer {
  onStart?(ev: { requestId: string; operation: OperationName; strategy: StrategyName }): void;
  onAttempt?(log: AttemptLog): void;
  onFinish?(res: OperationResult): void;
}