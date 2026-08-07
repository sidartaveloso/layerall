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
    id: 'providerA',
    weight: 50,
    health: 0.96,
    baseLatency: 180,
    failRate: 0.06,
    invoke: async ctx => upstreamCallA(ctx),
  },
  providerB: { id: 'providerB', /* ... */ invoke: async ctx => upstreamCallB(ctx) },
};

const policy: PolicyDocument = {
  tenants: {
    default: {
      providers: ['providerA', 'providerB'],
      operations: {
        create: {
          strategy: 'round_robin',
          timeoutMs: 8000,
          retries: { max: 1, backoffMs: 300 },
          failover: true,
        },
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

| Strategy       | Behaviour                                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `round_robin`  | Cycles through eligible providers in policy order.                                                                                                                                            |
| `load_balance` | Weighted random by `Provider.weight` / policy weights.                                                                                                                                        |
| `most_fast`    | Lowest score = `baseLatency + (1-health)*280 + failRate*420`.                                                                                                                                 |
| `failover`     | Tries eligible providers in order until one succeeds.                                                                                                                                         |
| `geo_rule`     | Routes by the payload coordinate against GeoJSON `MultiPolygon` regions (`area` or `volume` with altitude band). Multiple matches fall back to `fallbackStrategy` (`round_robin` by default). |

### Geographic routing (`geo_rule`)

`geo_rule` reads a `[lng, lat, alt?]` position (WGS 84) from `payload.data[field]` and selects the providers of every region whose `MultiPolygon` contains the point. A `volume` region also requires the altitude to fall inside its `[minAltitude, maxAltitude]` band (open bounds are allowed). No region matches → `geo_unmatched`; invalid coordinate or config → `geo_bad_payload`.

```ts
const policy: PolicyDocument = {
  tenants: {
    default: {
      providers: ['br', 'us', 'uav'],
      operations: {
        create: {
          strategy: 'geo_rule',
          geo: {
            field: 'location',
            rules: [
              { providers: ['br'], shape: { kind: 'area', multipolygon: brasil } },
              { providers: ['us'], shape: { kind: 'area', multipolygon: eua } },
              {
                providers: ['uav'],
                shape: { kind: 'volume', multipolygon: zona, minAltitude: 120, maxAltitude: 600 },
              },
            ],
            fallbackStrategy: 'most_fast',
          },
        },
      },
    },
  },
};
```

See the root [README](../../README.md) for the product overview.
