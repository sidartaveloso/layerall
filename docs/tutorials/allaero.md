# Tutorial: AllAero — roteamento por região aérea (`geo_rule` 3D)

Vamos construir um serviço de **autorização de voo para drones** que roteia cada requisição para o provedor da **região aérea** onde a aeronave está. Cada região é um `MultiPolygon` GeoJSON cujos vértices carregam **altitude** (`[lng, lat, alt]`); a estratégia `geo_rule` escolhe o provedor que atende a posição do voo.

O resultado: um único endpoint que recebe `[lng, lat, alt]` e devolve a autorização — o cliente nunca sabe qual órgão regional foi consultado.

```
               POST /flight
                    │
                    ▼
            ┌─────────────────┐
            │ @layerall/sdk   │  (ou HTTP direto)
            └────────┬────────┘
                     │
                     ▼
           ┌──────────────────────┐
           │ Router (layerall)    │  ← geo_rule + fallbackStrategy
           └───┬───────┬──────┬───┘
               │       │      │
         ┌─────▼───┐ ┌─▼────┐ ┌▼──────┐
         │ br-aero │ │us-aer│ │eu-aero│
         └─────────┘ └──────┘ └───────┘
```

## 1. Estrutura do projeto

```
meu-projeto/
├── package.json
├── src/
│   ├── providers/
│   │   ├── br-aero.ts
│   │   ├── us-aero.ts
│   │   └── eu-aero.ts
│   ├── airspaces.ts   # MultiPolygons 3D das regiões
│   ├── policy.ts
│   └── server.ts
```

## 2. package.json

```json
{
  "name": "allaero",
  "private": true,
  "type": "module",
  "dependencies": {
    "@layerall/core": "^0.1.0",
    "fastify": "^5.0.0"
  }
}
```

```bash
npm install
```

## 3. Providers (um por espaço aéreo)

Cada provedor autoriza o voo dentro do seu espaço aéreo. Para o tutorial rodar sem chaves externas, os providers são **simulados** (latência fixa) — troque o corpo do `invoke` por uma chamada real à API do órgão regional.

### `src/providers/br-aero.ts`

```ts
import type { Provider } from '@layerall/core';
import type { FlightPos, FlightResult } from './airspaces.js';

export const brAero: Provider<FlightPos, FlightResult> = {
  id: 'br-aero',
  timeoutMs: 3000,
  async invoke(ctx) {
    const [lng, lat, alt] = ctx.payload.data.position;
    await sleep(120);
    // aqui iria: fetch à API do espaço aéreo brasileiro
    return { clearance: true, corridor: 'br-sudeste' };
  },
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### `src/providers/us-aero.ts`

```ts
import type { Provider } from '@layerall/core';
import type { FlightPos, FlightResult } from './airspaces.js';

export const usAero: Provider<FlightPos, FlightResult> = {
  id: 'us-aero',
  timeoutMs: 3000,
  async invoke(ctx) {
    const [lng, lat, alt] = ctx.payload.data.position;
    await sleep(180);
    return { clearance: true, corridor: 'us-ny' };
  },
};
```

### `src/providers/eu-aero.ts`

```ts
import type { Provider } from '@layerall/core';
import type { FlightPos, FlightResult } from './airspaces.js';

export const euAero: Provider<FlightPos, FlightResult> = {
  id: 'eu-aero',
  timeoutMs: 3000,
  async invoke(ctx) {
    const [lng, lat, alt] = ctx.payload.data.position;
    await sleep(140);
    return { clearance: true, corridor: 'eu-berlin' };
  },
};
```

> `Provider<FlightPos, FlightResult>` tipa `ctx.payload.data` via o **genérico do `Provider`** — sem `as`. Se os dados viessem de uma fonte não confiável, valide em runtime com um type guard em vez de assumir.

## 4. Regiões aéreas — MultiPolygon 3D

Cada zona é um `MultiPolygon` GeoJSON. Os vértices carregam **altitude**: o ponto `[lng, lat, alt]` está na zona quando o footprint `[lng, lat]` está dentro do polígono **e** `alt` está dentro da extensão vertical dos vértices.

### `src/airspaces.ts`

```ts
import type { MultiPolygon } from 'geojson';

// Vértices com altitude (metros): [lng, lat, alt]
export const brZona: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-46.7, -23.7, 120],
        [-46.4, -23.7, 120],
        [-46.4, -23.4, 400],
        [-46.7, -23.4, 400],
        [-46.7, -23.7, 120],
      ],
    ],
  ],
};

export const usZona: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-74.1, 40.6, 100],
        [-73.8, 40.6, 100],
        [-73.8, 40.9, 300],
        [-74.1, 40.9, 300],
        [-74.1, 40.6, 100],
      ],
    ],
  ],
};

// Região 2D: vértices sem altitude → só o footprint decide
export const euZona: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [13.2, 52.4],
        [13.5, 52.4],
        [13.5, 52.6],
        [13.2, 52.6],
        [13.2, 52.4],
      ],
    ],
  ],
};

export type FlightPos = { position: [lng: number, lat: number, alt: number] };
export type FlightResult = { clearance: boolean; corridor: string };
export type FlightRequest = { lng: number; lat: number; alt: number };
```

- **3D** (`brZona`, `usZona`): `alt` precisa estar entre o menor e o maior z dos vértices. Ex.: em São Paulo, 300 m cai dentro de `[120, 400]`; 900 m não.
- **2D** (`euZona`): altitude é ignorada — decide só o footprint.

## 5. Policy

### `src/policy.ts`

```ts
import type { PolicyDocument } from '@layerall/core';
import { brZona, usZona, euZona } from './airspaces.js';

export const policy: PolicyDocument = {
  tenants: {
    default: {
      providers: ['br-aero', 'us-aero', 'eu-aero'],
      operations: {
        authorize: {
          strategy: 'geo_rule',
          timeoutMs: 5000,
          geo: {
            field: 'position', // onde está a coordenada em payload.data
            rules: [
              { providers: ['br-aero'], multipolygon: brZona },
              { providers: ['us-aero'], multipolygon: usZona },
              { providers: ['eu-aero'], multipolygon: euZona },
            ],
            fallbackStrategy: 'most_fast',
          },
        },
      },
    },
  },
};
```

Se várias zonas casarem com o mesmo ponto, `fallbackStrategy` decide entre os providers (default `round_robin`). O override por request continua valendo:

```ts
await router.execute('authorize', payload, { strategy: 'geo_rule' });
```

## 6. Servidor HTTP

### `src/server.ts`

```ts
import Fastify from 'fastify';
import { Router } from '@layerall/core';
import { policy } from './policy.js';
import { brAero } from './providers/br-aero.js';
import { usAero } from './providers/us-aero.js';
import { euAero } from './providers/eu-aero.js';
import type { FlightPos, FlightRequest, FlightResult } from './airspaces.js';

const router = new Router({
  providers: { 'br-aero': brAero, 'us-aero': usAero, 'eu-aero': euAero },
  policy,
  observer: {
    onFinish(res) {
      console.log(`→ ${res.status} | via ${res.provider} | ${res.latencyMs}ms`);
    },
  },
});

const app = Fastify({ logger: true });

app.post<{ Body: FlightRequest }>('/flight', async (req, reply) => {
  const { lng, lat, alt } = req.body;

  const result = await router.execute<FlightPos, FlightResult>('authorize', {
    externalId: `req_${Date.now()}`,
    data: { position: [lng, lat, alt] }, // [lng, lat, alt?] — ordem GeoJSON
  });

  if (result.status === 'failed') {
    return reply.code(422).send({ error: result.error });
  }
  if (!result.result) {
    return reply
      .code(502)
      .send({ error: { code: 'no_result', message: 'resposta vazia do provedor' } });
  }

  return {
    ...result.result,
    provider: result.provider,
    receipt: result.providerReceipt,
    latencyMs: result.latencyMs,
  };
});

app.listen({ port: 3000 }).then(() => console.log('AllAero rodando em :3000'));
```

## 7. Testando

```bash
curl -X POST http://localhost:3000/flight \
  -H 'Content-Type: application/json' \
  -d '{"lng": -46.6, "lat": -23.5, "alt": 300}'
```

Posição em São Paulo a 300 m (dentro de `brZona`):

```json
{
  "clearance": true,
  "corridor": "br-sudeste",
  "provider": "br-aero",
  "receipt": "br-aero:req_174…:abc123",
  "latencyMs": 132
}
```

A mesma posição a 900 m (acima do teto da zona) não casa — e se nenhuma outra zona cobrir, vira erro `geo_unmatched`:

```json
{
  "error": {
    "code": "geo_unmatched",
    "message": "nenhuma regra geográfica casou",
    "transient": false,
    "provider": "—"
  }
}
```

## 8. Tratamento de erros

| Código            | Quando                                                                         |
| ----------------- | ------------------------------------------------------------------------------ |
| `geo_unmatched`   | O ponto não cai em nenhuma região (ou está fora da faixa de altitude de todas) |
| `geo_bad_payload` | Coordenada ausente/inválida, ou altitude faltando numa região 3D               |
| `upstream_error`  | O provedor regional falhou (propagado pelo provider)                           |

No servidor, `geo_unmatched` → `422` (posição não coberta); `geo_bad_payload` → `400` (requisição malformada).

## 9. Evoluindo

- **Adicionar regiões** — crie o `MultiPolygon` e uma regra. Zero mudança no cliente.
- **Zonas 2D** — vértices sem `alt`; o footprint decide sozinho.
- **Menor latência real** — use `priority_race` como estratégia para disparar órgãos regionais em paralelo e cancelar os perdedores via `onCancelled`.
- **Observabilidade** — o observer recebe `onAttempt`, `onFinish` e `onCancelled` para métricas.

## Código completo

O passo a passo acima é o projeto completo; cada arquivo está na seção correspondente.
