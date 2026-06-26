# @layerall/plugin-prometheus

Observer pronto para Prometheus que integra com o `Router` do `@layerall/core`. Bom para zero boilerplate: 4 métricas padrão expostas automaticamente.

## Instalação

```bash
npm install @layerall/core @layerall/plugin-prometheus prom-client
```

> `prom-client` é peer dependency — instale no seu backend.

## Métricas expostas

| Métrica | Tipo | Labels |
|---|---|---|
| `layerall_requests_total`   | Counter   | `provider`, `operation`, `status` |
| `layerall_latency_seconds`   | Histogram | `provider`, `operation` |
| `layerall_attempts_total`   | Counter   | `provider`, `operation`, `result` |
| `layerall_errors_total`     | Counter   | `provider`, `code` |

Histogram buckets: `[0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]` segundos.

## Uso básico

```ts
import { PrometheusObserver } from '@layerall/plugin-prometheus';
import { Router } from '@layerall/core';

const observer = new PrometheusObserver();
const router = new Router({ providers, policy, observer });

// endpoint /metrics
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', observer.metricRegistry.contentType);
  res.end(await observer.metricRegistry.metrics());
});
```

## Factory `createMetricsRouter`

Constrói o Router já com o observer injetado:

```ts
import { createMetricsRouter } from '@layerall/plugin-prometheus';

const { router, observer } = createMetricsRouter({ providers, policy });

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', observer.metricRegistry.contentType);
  res.end(await observer.metricRegistry.metrics());
});

await router.execute('create', { data: {} });
```

## Opções

```ts
new PrometheusObserver({
  registry: new Registry(),  // isolada (útil em testes); default = global do prom-client
  prefix:   'allx_',         // prefixo das métricas; default = 'layerall_'
});
```

## Registry customizada

```ts
import { Registry } from 'prom-client';
import { PrometheusObserver } from '@layerall/plugin-prometheus';

const registry = new Registry();
const observer = new PrometheusObserver({ registry, prefix: 'allx_' });
```

## Exemplo de saída no `/metrics`

```
# HELP layerall_requests_total Total LayerAll requests by provider, operation and final status.
# TYPE layerall_requests_total counter
layerall_requests_total{provider="google",operation="create",status="succeeded"} 142

# HELP layerall_latency_seconds LayerAll request latency in seconds, by provider and operation.
# TYPE layerall_latency_seconds histogram
layerall_latency_seconds_bucket{le="0.2",provider="google",operation="create"} 138
layerall_latency_seconds_bucket{le="0.5",provider="google",operation="create"} 142
layerall_latency_seconds_sum{provider="google",operation="create"} 18.41
layerall_latency_seconds_count{provider="google",operation="create"} 142

# HELP layerall_errors_total Total LayerAll failed attempts by provider and error code.
# TYPE layerall_errors_total counter
layerall_errors_total{provider="google",code="upstream_error"} 3
```