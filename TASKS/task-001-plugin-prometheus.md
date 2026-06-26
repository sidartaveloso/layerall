# Task 001 — Criar @layerall/plugin-prometheus

Status: done
Type: feat
Assignee: Sidarta Veloso
Priority: medium

## Description

Criar um pacote `@layerall/plugin-prometheus` que exponha um `Observer` pronto para integrar o Router do `@layerall/core` com métricas Prometheus (`prom-client`). Deve fornecer automaticamente:

- `layerall_requests_total` (counter) por provedor, operação e status
- `layerall_latency_seconds` (histogram) por provedor e operação
- `layerall_attempts_total` (counter) por provedor, operação e resultado
- `layerall_errors_total` (counter) por provedor e código de erro

## Tasks

- [x] Scaffold do package `packages/plugin-prometheus` com `package.json`, `tsconfig.json`, `vitest.config.ts`
- [x] Implementar `PrometheusObserver` que implementa `Observer` do `@layerall/core`
- [x] Registrar métricas com labels padronizados (`provider`, `operation`, `status`, `code`)
- [x] Exportar função `createMetricsRouter` que wrappa `Router` e já injeta o observer
- [x] Testes unitários verificando que as métricas são incrementadas corretamente
- [x] Adicionar ao `pnpm-workspace.yaml` e `turbo.json` (workspace wildcard já cobre `packages/*`)
- [x] Documentar no README do pacote e adicionar seção em `docs/`
- [x] Configurar `semantic-release` para publicar também este pacote

## Notes

### Estratégia

Usar `prom-client` como peer dependency (evita bundle, usuário já tem no backend). O observer coleta métricas no `onAttempt` e `onFinish` e expõe um `registry` para scrape.

### Exemplo de uso esperado

```ts
import { PrometheusObserver, register } from '@layerall/plugin-prometheus';
import { Router } from '@layerall/core';

const observer = new PrometheusObserver();
const router = new Router({ providers, policy, observer });

// endpoint /metrics
server.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

### Referências

- `prom-client`: https://github.com/siimon/prom-client
- `Observer` type em `@layerall/core/src/types.ts`
- Storytype patterns em `packages/cli/` e `packages/core/`