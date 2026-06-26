# LayerAll

<div align="center">

**Uma camada agnóstica de orquestração/abstração para múltiplas APIs/SDKs — um SDK, vários provedores, estratégias de roteamento plugáveis**

[English](./README.md) · [Português](./README.pt-BR.md)

</div>

---

## O que é o LayerAll?

**LayerAll** é um toolkit para construir produtos orquestradores do tipo "All‑X": uma camada de abstração que unifica múltiplos provedores de um mesmo domínio (assinatura eletrônica, pagamentos, mensageria, storage, LLMs, KYC, …) atrás de um único contrato de SDK estável. O cliente fala com um SDK; o LayerAll roteia para N provedores usando estratégias configuráveis.

### Princípios

- **Contratos unificados** — Interface estável (`create()`, `send()`, `status()`, `cancel()`) mapeada para cada provedor
- **Estratégias plugáveis** — round‑robin, load‑balance, mais‑rápido/menor‑latência, failover
- **Resiliência** — retries, circuit breaker e fallback automático por operação
- **Observabilidade** — latência, erros, dispersão de custo e `providerReceipt` auditável
- **Governança** — policies por tenant/rota, rate‑limit, webhooks normalizados

## Pacotes

- **[@layerall/core](./packages/core)** — Engine de orquestração: tipos, estratégias e roteador
- **[@layerall/sdk](./packages/sdk)** — SDK de cliente TypeScript minimalista
- **[@layerall/cli](./packages/cli)** — CLI para scaffold de policies e configs de provedores
- **[@layerall/plugin-prometheus](./packages/plugin-prometheus)** — Observer Prometheus com métricas prontas (`prom-client`)
- **[docs](./docs)** — Site de documentação VitePress
- **[examples/landing](./examples/landing)** — Template HTML white‑label de landing/demo

## Início rápido

```bash
pnpm install
pnpm build
pnpm test
```

Usando o SDK:

```ts
import { Orchestrator } from '@layerall/sdk';

const client = new Orchestrator({
  apiKey: process.env.LAYERALL_API_KEY!,
  baseUrl: 'https://api.seu-allx.com',
});

const result = await client.operation('create', {
  payload: { externalId: 'req_123', data: {} },
  strategy: 'round_robin',
  timeoutMs: 8000,
});

console.log(result.id, result.provider, result.status);
```

## Estratégias

| Estratégia     | Descrição                                       |
| -------------- | ----------------------------------------------- |
| `round_robin`  | Distribui o volume igualmente entre provedores  |
| `load_balance` | Seleção ponderada pela capacidade do provedor    |
| `most_fast`    | Escolhe o provedor elegível de menor latência   |
| `failover`     | Tenta os provedores em ordem até um ter sucesso |

## Releases

Este projeto usa [semantic-release](https://semantic-release.gitbook.io/) para versionamento e publicação automáticos. Veja [RELEASE.md](./RELEASE.md).

## Licença

MIT — veja [LICENSE](./LICENSE).