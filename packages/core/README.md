# @layerall/core

The orchestration engine for LayerAll: routing strategies, provider router with retries/fallback and typed policies.

## Install

```bash
npm install @layerall/core
```

## Usage

```ts
import { Router, type PolicyDocument, type Provider } from '@layerall/core';

const providers: Record<string, Provider> = {
  providerA: {
    id: 'providerA', weight: 50, health: 0.96, baseLatency: 180, failRate: 0.06,
    invoke: async ctx => upstreamCallA(ctx),
  },
  providerB: { id: 'providerB', /* ... */ invoke: async ctx => upstreamCallB(ctx) },
};

const policy: PolicyDocument = {
  tenants: {
    default: {
      providers: ['providerA', 'providerB'],
      operations: {
        create: { strategy: 'round_robin', timeoutMs: 8000, retries: { max: 1, backoffMs: 300 }, failover: true },
      },
    },
  },
};

const router = new Router({
  policy,
  providers,
  observer: { onAttempt: l => console.log(l), onFinish: r => console.log(r) },
});

const res = await router.execute('create', { externalId: 'req_123', data: {} });
```

## Strategies

| Strategy       | Behaviour                                          |
| -------------- | -------------------------------------------------- |
| `round_robin`  | Cycles through eligible providers in policy order. |
| `load_balance` | Weighted random by `Provider.weight` / policy weights. |
| `most_fast`    | Lowest score = `baseLatency + (1-health)*280 + failRate*420`. |
| `failover`     | Tries eligible providers in order until one succeeds. |

See the root [README](../../README.md) for the product overview.