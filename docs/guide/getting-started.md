# Getting Started

Este guia mostra como usar o `@layerall/core` no seu backend para rotear requisições entre múltiplos provedores.

## Instalação

```bash
npm install @layerall/core
# ou
pnpm add @layerall/core
```

Se quiser o SDK do cliente (para o frontend/outros serviços):

```bash
npm install @layerall/sdk
```

## Conceitos em 30 segundos

| Termo | O que é |
|-------|---------|
| **Provider** | Um adaptador que chama um provedor real (Google Maps, Stripe, etc.) |
| **Policy** | Um JSON que define quais provedores usar e qual estratégia por operação |
| **Strategy** | Algoritmo que escolhe qual provedor será chamado (round_robin, load_balance, most_fast, failover) |
| **Router** | O core: recebe uma operação, aplica a policy, executa a estratégia com retries e fallback |
| **Observer** | Hook opcional para coletar métricas de cada tentativa |

## Mão na massa: primeiro Router

### 1. Crie um Provider

Um Provider é um objeto com um método `invoke`. Exemplo com geocode reverso:

```ts
import type { Provider } from '@layerall/core';

const googleMaps: Provider = {
  id: 'google',
  weight: 50,
  health: 0.98,
  baseLatency: 180,
  failRate: 0.04,
  async invoke(ctx) {
    const { lat, lng } = ctx.payload.data as { lat: number; lng: number };
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_KEY}`
    );
    if (!res.ok) throw { code: 'upstream_error', message: `Google respondeu ${res.status}`, transient: true };
    return res.json();
  },
};

const nominatim: Provider = {
  id: 'nominatim',
  weight: 30,
  health: 0.92,
  baseLatency: 320,
  failRate: 0.08,
  async invoke(ctx) {
    const { lat, lng } = ctx.payload.data as { lat: number; lng: number };
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
      headers: { 'User-Agent': 'AllGeo/1.0' },
    });
    if (!res.ok) throw { code: 'upstream_error', message: `Nominatim respondeu ${res.status}`, transient: true };
    return res.json();
  },
};
```

> **Dica**: `weight`, `health`, `baseLatency` e `failRate` são usados pelas estratégias `load_balance` e `most_fast`. Quanto maior o `weight`, mais tráfego o provedor recebe. Quanto menor o `baseLatency` e `failRate`, melhor sua pontuação no `most_fast`.

### 2. Crie uma Policy

A policy define quais provedores estão disponíveis e como cada operação deve ser roteada:

```ts
import type { PolicyDocument } from '@layerall/core';

const policy: PolicyDocument = {
  tenants: {
    default: {
      providers: ['google', 'nominatim'],
      operations: {
        reverse: {
          strategy: 'most_fast',      // usa o provedor mais rápido
          timeoutMs: 5000,
          retries: { max: 1, backoffMs: 300 },
          failover: true,              // se falhar, tenta o próximo
        },
      },
    },
  },
};
```

> A operação `reverse` não é fixa — você define os nomes que fizerem sentido pro seu domínio. Poderia ser `create`, `send`, `status`, `cancel`, `analyze`, etc.

### 3. Crie o Router e execute

```ts
import { Router } from '@layerall/core';

const router = new Router({
  providers: { google: googleMaps, nominatim },
  policy,
  observer: {
    onAttempt(log) {
      console.log(`[${log.provider}] tentativa ${log.attempt}: ${log.ok ? 'OK' : 'FALHA'} (${log.latencyMs}ms)`);
    },
    onFinish(res) {
      console.log(`Final: ${res.status} em ${res.attempts} tentativa(s) via ${res.provider}`);
    },
  },
});

const resultado = await router.execute('reverse', {
  externalId: 'req_001',
  data: { lat: -23.5505, lng: -46.6333 },
});

console.log(resultado.status, resultado.provider, resultado.providerReceipt);
```

O Router:
1. Consulta a policy e descobre que `reverse` usa `most_fast`
2. Pede para a estratégia `most_fast` escolher o melhor provedor
3. Invoca o provider escolhido
4. Se falhar e `failover: true`, testa o próximo
5. Se for erro transitório, faz retry com backoff
6. Retorna o resultado normalizado com `providerReceipt` para auditoria

### 4. Observer para métricas (Prometheus)

Veja o [guia de observabilidade](/guide/observability) para integrar com Prometheus.

## CLI: gerencie sua policy

```bash
npx @layerall/cli init --providers google,nominatim,mapbox --weights google=50,nominatim=30,mapbox=20
```

Gera um `layerall.policy.json` com valores sensatos. Depois:

```bash
npx @layerall/cli validate layerall.policy.json
```

## Usando o SDK do cliente

No frontend ou em outro serviço:

```ts
import { Orchestrator } from '@layerall/sdk';

const client = new Orchestrator({
  apiKey: process.env.LAYERALL_API_KEY!,
  baseUrl: 'https://api.meu-allx.com',
});

const res = await client.operation('reverse', {
  payload: { data: { lat: -23.55, lng: -46.63 } },
  strategy: 'most_fast',
});
```

O SDK apenas encaminha a requisição para seu backend — a orquestração acontece lá dentro com o `Router`.

## Próximos passos

- [Tutorial completo: criando o AllGeo](/tutorials/allgeo)
- [Detalhes das estratégias](/guide/strategies)
- [CLI reference](/cli/commands)