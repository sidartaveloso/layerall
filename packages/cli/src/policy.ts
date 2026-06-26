import type { OperationName, PolicyDocument, StrategyName } from '@layerall/core';

const ALL_OPS: OperationName[] = ['create', 'send', 'status', 'cancel'];

const STRATEGIES_PER_OP: Record<OperationName, StrategyName> = {
  create: 'round_robin',
  send: 'load_balance',
  status: 'most_fast',
  cancel: 'failover',
};

/** Builds a sensible default policy document for a set of provider ids. */
export function buildPolicy(opts: {
  providers: string[];
  weights?: Record<string, number>;
  timeoutMs?: number;
  retries?: { max: number; backoffMs: number };
}): PolicyDocument {
  const providers = opts.providers.slice();
  const failures = { max: opts.retries?.max ?? 1, backoffMs: opts.retries?.backoffMs ?? 300 };
  const operations: PolicyDocument['tenants']['default']['operations'] = {};
  for (const op of ALL_OPS) {
    const strategy = STRATEGIES_PER_OP[op];
    operations[op] = {
      strategy,
      timeoutMs: opts.timeoutMs ?? 8000,
      retries: failures,
      failover: strategy === 'failover',
      ...(opts.weights ? { weights: opts.weights } : {}),
    };
  }
  return { tenants: { default: { providers, operations } } };
}

/** Validates a policy document shape; returns a list of human-readable issues. */
export function validatePolicy(policy: unknown): string[] {
  const issues: string[] = [];
  if (!policy || typeof policy !== 'object') return ['policy must be an object'];
  const root = policy as { tenants?: Record<string, unknown> };
  if (!root.tenants || typeof root.tenants !== 'object') issues.push('missing tenants map');
  for (const [tenant, value] of Object.entries(root.tenants ?? {})) {
    const t = value as { providers?: unknown; operations?: unknown };
    if (!Array.isArray(t.providers)) issues.push(`tenant "${tenant}" providers must be an array`);
    if (!t.operations || typeof t.operations !== 'object')
      issues.push(`tenant "${tenant}" operations must be an object`);
  }
  return issues;
}