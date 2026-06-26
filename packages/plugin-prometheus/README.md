# @layerall/plugin-prometheus

> Prometheus observer pronto para o `Router` do `@layerall/core` — métricas automáticas via `prom-client`.

## Instalação

```bash
npm install @layerall/core @layerall/plugin-prometheus prom-client
```

> `prom-client` é uma peer dependency — você precisa instalá-lo no seu backend.

## Métricas expostas

| Métrica | Tipo | Labels |
|---|---|---|
| `layerall_requests_total`   | Counter   | `provider`, `operation`, `status` |
| `layerall_latency_seconds`   | Histogram | `provider`, `operation` |
| `layerall_attempts_total`   | Counter   | `provider`, `operation`, `result` |
| `layerall_errors_total`      | Counter   | `provider`, `code` |

O prefixo `layerall_` é configurável (`prefix: 'allx_'`).

## Uso básico

```ts
import { PrometheusObserver } from '@layerall/plugin-prometheus';
import { Router } from '@layerall/core';

const observer = new PrometheusObserver();
const router = new Router({ providers, policy, observer });

// no seu HTTP server
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

## Registry customizada

Por padrão, as métricas vão para o registro global do `prom-client` (qualquer endpoint `/metrics` as vê). Para isolar (útil em testes), passe uma Registry própria:

```ts
import { Registry } from 'prom-client';
import { PrometheusObserver } from '@layerall/plugin-prometheus';

const registry = new Registry();
const observer = new PrometheusObserver({ registry, prefix: 'allx_' });
```

## Prefixo customizado

```ts
const observer = new PrometheusObserver({ prefix: 'allx_' });
// métricas viram allx_requests_total, allx_latency_seconds, ...
```

## License

MIT © Sidarta Veloso