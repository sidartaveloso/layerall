# Observabilidade

O `Router` aceita um `Observer` opcional que é chamado em cada etapa da execução. Use para métricas, logs ou tracing.

> Precisa de métricas Prometheus **prontas** sem escrever boilerplate? Veja o pacote [`@layerall/plugin-prometheus`](/plugins/prometheus) — um `Observer` que coleta `requests_total`, `latency_seconds`, `attempts_total` e `errors_total` automaticamente.

## Interface

```ts
interface Observer {
  onStart?(ev: { requestId: string; operation: string; strategy: string }): void;
  onAttempt?(log: AttemptLog): void;
  onFinish?(res: OperationResult): void;
}
```

`onAttempt` é chamado a cada tentativa (sucesso ou falha) — inclusive retries:

```ts
interface AttemptLog {
  provider: string;
  attempt: number;
  ok: boolean;
  latencyMs: number;
  transient: boolean;
  error?: string;
}
```

## Exemplo: logs no console

```ts
const observer = {
  onStart(ev) {
    console.log(`▶ ${ev.operation} [${ev.strategy}] req=${ev.requestId}`);
  },
  onAttempt(log) {
    const icon = log.ok ? '✓' : '✗';
    console.log(`  ${icon} ${log.provider} tentativa #${log.attempt}: ${log.latencyMs}ms`);
  },
  onFinish(res) {
    console.log(`🏁 ${res.status} via ${res.provider} (${res.attempts} tentativas)`);
  },
};
```

## Exemplo: métricas Prometheus

Instale o `prom-client`:

```bash
npm install prom-client
```

```ts
import { Counter, Histogram } from 'prom-client';

const requestsTotal = new Counter({
  name: 'layerall_requests_total',
  help: 'Total de requisições por provedor, operação e status',
  labelNames: ['provider', 'operation', 'status'] as const,
});

const latencyHistogram = new Histogram({
  name: 'layerall_latency_seconds',
  help: 'Latência por provedor e operação',
  labelNames: ['provider', 'operation'] as const,
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
});

const errorsTotal = new Counter({
  name: 'layerall_errors_total',
  help: 'Erros por provedor e código',
  labelNames: ['provider', 'code'] as const,
});

const observer = {
  onAttempt(log) {
    if (!log.ok) {
      errorsTotal.inc({ provider: log.provider, code: log.error ?? 'unknown' });
    }
  },
  onFinish(res) {
    requestsTotal.inc({ provider: res.provider, operation: res.operation, status: res.status });
    latencyHistogram.observe({ provider: res.provider, operation: res.operation }, res.latencyMs / 1000);
  },
};
```

Depois exponha o `/metrics` no seu HTTP server:

```ts
import { register } from 'prom-client';

server.get('/metrics', async (_req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

> Ou use [`@layerall/plugin-prometheus`](/plugins/prometheus) — esse observer pronto, empacotado, com prefixo configurável e Registry isolável. Veja a [referência do plugin](/plugins/prometheus).