# Tutorial: AllFleet — agregando frotas de múltiplos sistemas (`fan_out`)

Vamos construir um serviço que lista **veículos cadastrados em dois sistemas diferentes** (dois sistemas de gestão de frota que não conversam entre si) como se fossem um só catálogo. Diferente dos tutoriais anteriores — que escolhem **um** provedor vencedor (`geo_rule`, `priority_race`) — aqui a resposta certa é a **combinação** dos dois: cada sistema pode ter veículos que o outro não tem.

```
              GET /veiculos
                    │
                    ▼
            ┌─────────────────┐
            │ HTTP handler    │
            └────────┬────────┘
                     │
                     ▼
           ┌──────────────────────┐
           │ Router (layerall)    │  ← fan_out: dispara os dois, espera os dois
           └───┬──────────────┬───┘
               │              │
         ┌─────▼───┐    ┌─────▼─────┐
         │ frota-a │    │  frota-b  │
         └─────────┘    └───────────┘
               │              │
               └──────┬───────┘
                      ▼
              mergeFanOut() — dedup por placa
```

## 1. Estrutura do projeto

```
meu-projeto/
├── package.json
├── src/
│   ├── providers/
│   │   ├── frota-a.ts
│   │   └── frota-b.ts
│   ├── veiculo.types.ts
│   ├── policy.ts
│   └── server.ts
```

## 2. package.json

```json
{
  "name": "allfleet",
  "private": true,
  "type": "module",
  "dependencies": {
    "@layerall/core": "^2.1.0",
    "fastify": "^5.0.0"
  }
}
```

## 3. Tipos

### `src/veiculo.types.ts`

```ts
export interface Veiculo {
  placa: string;
  modelo: string;
  origem: 'frota-a' | 'frota-b';
}

export interface ListaVeiculosResponse {
  data: Veiculo[];
}
```

## 4. Providers (um por sistema)

Cada provider é só um adapter fino sobre a API do sistema de frota — o `Router` não sabe nem precisa saber que os dois formatos de resposta são compatíveis; ele só orquestra.

### `src/providers/frota-a.ts`

```ts
import type { Provider } from '@layerall/core';
import type { ListaVeiculosResponse } from '../veiculo.types.js';

export const frotaA: Provider<undefined, ListaVeiculosResponse> = {
  id: 'frota-a',
  timeoutMs: 3000,
  async invoke() {
    // aqui iria: fetch na API real do sistema A
    return {
      data: [
        { placa: 'ABC1234', modelo: 'Onix', origem: 'frota-a' },
        { placa: 'XYZ5678', modelo: 'HB20', origem: 'frota-a' },
      ],
    };
  },
};
```

### `src/providers/frota-b.ts`

```ts
import type { Provider } from '@layerall/core';
import type { ListaVeiculosResponse } from '../veiculo.types.js';

export const frotaB: Provider<undefined, ListaVeiculosResponse> = {
  id: 'frota-b',
  timeoutMs: 3000,
  async invoke() {
    // ABC1234 também existe aqui — cadastro duplicado entre os dois sistemas,
    // o cenário comum que motiva o merge/dedup abaixo.
    return {
      data: [
        { placa: 'ABC1234', modelo: 'Onix', origem: 'frota-b' },
        { placa: 'DEF9999', modelo: 'Compass', origem: 'frota-b' },
      ],
    };
  },
};
```

## 5. Policy

### `src/policy.ts`

```ts
import type { PolicyDocument } from '@layerall/core';

export const policy: PolicyDocument = {
  tenants: {
    default: {
      providers: ['frota-a', 'frota-b'],
      operations: {
        listar: { strategy: 'fan_out', timeoutMs: 4000 },
      },
    },
  },
};
```

Sem `retries`/`failover` — `fan_out` sempre dispara todo mundo uma vez; um provider lento ou fora do ar vira uma entrada `failed`, não impede os outros.

## 6. Servidor HTTP

### `src/server.ts`

```ts
import Fastify from 'fastify';
import { Router, isFanOutResult, mergeFanOut } from '@layerall/core';
import { policy } from './policy.js';
import { frotaA } from './providers/frota-a.js';
import { frotaB } from './providers/frota-b.js';
import type { ListaVeiculosResponse, Veiculo } from './veiculo.types.js';

const router = new Router({
  providers: { 'frota-a': frotaA, 'frota-b': frotaB },
  policy,
  observer: {
    onFinish(res) {
      console.log(`→ ${res.status} | providers: ${res.provider} | ${res.latencyMs}ms`);
    },
  },
});

const app = Fastify({ logger: true });

app.get('/veiculos', async (_req, reply) => {
  const result = await router.execute<undefined, ListaVeiculosResponse>('listar', {
    data: undefined,
  });

  // `results` só existe pra fan_out — isFanOutResult() é o jeito honesto de
  // afirmar isso no tipo (a strategy vem da policy, não dá pra saber em
  // compile-time). Sem a guarda, `result.results` seria opcional.
  if (!isFanOutResult(result)) {
    return reply.code(500).send({ error: 'resposta inesperada do router' });
  }

  // dedup por placa — lógica de domínio, o Router não faz isso por você.
  const veiculos = mergeFanOut(result, successful => {
    const porPlaca = new Map<string, Veiculo>();
    for (const pagina of successful) {
      for (const v of pagina.data) porPlaca.set(v.placa, v);
    }
    return [...porPlaca.values()];
  });

  // full transparency: quais sistemas responderam, e quais falharam
  const falhas = result.results
    .filter(entry => entry.status === 'failed')
    .map(entry => ({ provider: entry.provider, erro: entry.error?.message }));

  return { total: veiculos.length, veiculos, falhas };
});

app.listen({ port: 3000 }).then(() => console.log('AllFleet rodando em :3000'));
```

## 7. Testando

```bash
curl http://localhost:3000/veiculos
```

`ABC1234` existe nos dois sistemas — o merge devolve uma entrada só:

```json
{
  "total": 3,
  "veiculos": [
    { "placa": "ABC1234", "modelo": "Onix", "origem": "frota-a" },
    { "placa": "XYZ5678", "modelo": "HB20", "origem": "frota-a" },
    { "placa": "DEF9999", "modelo": "Compass", "origem": "frota-b" }
  ],
  "falhas": []
}
```

Se `frota-b` estivesse fora do ar, a resposta continuaria `200` com o que `frota-a` devolveu, e `falhas` mostraria o motivo:

```json
{
  "total": 2,
  "veiculos": [
    { "placa": "ABC1234", "modelo": "Onix", "origem": "frota-a" },
    { "placa": "XYZ5678", "modelo": "HB20", "origem": "frota-a" }
  ],
  "falhas": [{ "provider": "frota-b", "erro": "connect ECONNREFUSED" }]
}
```

`result.status` só vira `'failed'` (código `all_failed`) se **os dois** sistemas falharem — um sucesso parcial já é `'succeeded'` no topo.

## 8. Por que não uma `strategy` que já devolve mesclado?

Cogitamos passar uma função de merge direto pro `execute()` (`{ strategy: 'fan_out', merge: (entries) => ... }`). Descartamos: um parâmetro que só faz sentido pra uma entre sete strategies é o tipo de estado que dá pra evitar representando de outro jeito, e mesclar já é trivial por fora — uma função de uma linha sobre `results`. `isFanOutResult`/`mergeFanOut` resolvem a mesma necessidade como peças pequenas e compostas, sem esse parâmetro condicional no meio do tipo de `execute()`. Ver [Estratégias → fan_out](/guide/strategies#fan-out) pro detalhe completo.

## 9. Evoluindo

- **Mais de dois sistemas** — só adicionar mais um id em `providers` e no array da policy; o `Router` já dispara todos em paralelo.
- **Timeout por sistema** — `Provider.timeoutMs` sobrescreve o `timeoutMs` da operação individualmente, útil se um sistema é sabidamente mais lento.
- **Observabilidade por provider** — `Observer.onAttempt` dispara um evento por sistema (sucesso ou falha), útil pra métricas de "qual sistema costuma cair".

## Código completo

O passo a passo acima é o projeto completo; cada arquivo está na seção correspondente.
