# Tutorial: AllGeo — Geocode reverso multi-provedor

Vamos construir um serviço de **geocode reverso** (lat/lng → endereço) que usa Google Maps, Nominatim e Mapbox, com fallback automático se um falhar.

O resultado: um único endpoint HTTP que o cliente chama sem saber qual provedor está sendo usado.

```

                    POST /reverse
                        │
                        ▼
                ┌────────────────┐
                │  @layerall/sdk │  (ou HTTP direto)
                └───────┬────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │  Router (layerall)  │  ← policy com most_fast + failover
              └──┬──────┬──────┬────┘
                 │      │      │
           ┌─────▼┐ ┌──▼──┐ ┌─▼────┐
           │Google│ │Nom. │ │Mapbox│
           └──────┘ └─────┘ └──────┘
```

## 1. Estrutura do projeto

```
meu-projeto/
├── package.json
├── src/
│   ├── providers/
│   │   ├── google.ts
│   │   ├── nominatim.ts
│   │   └── mapbox.ts
│   ├── policy.ts
│   ├── router.ts
│   └── server.ts
└── layerall.policy.json
```

## 2. Package.json

```json
{
  "name": "allgeo",
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

## 3. Providers

Cada provedor traduz o contrato `reverse` para a API específica.

### `src/providers/google.ts`

```ts
import type { Provider } from '@layerall/core';

export const googleMaps: Provider = {
  id: 'google',
  weight: 50,
  health: 0.98,
  baseLatency: 180,
  failRate: 0.03,
  async invoke(ctx) {
    const { lat, lng } = ctx.payload.data as { lat: number; lng: number };
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_API_KEY}`
    );
    if (!res.ok) throw upstreamError(`HTTP ${res.status}`);
    const json = await res.json() as { status: string; results: Array<{ formatted_address: string }> };
    if (json.status !== 'OK') throw upstreamError(`google status: ${json.status}`);
    return { address: json.results[0]?.formatted_address ?? null };
  },
};

function upstreamError(message: string) {
  return { code: 'upstream_error', message, transient: true };
}
```

### `src/providers/nominatim.ts`

```ts
import type { Provider } from '@layerall/core';

export const nominatim: Provider = {
  id: 'nominatim',
  weight: 30,
  health: 0.92,
  baseLatency: 320,
  failRate: 0.07,
  async invoke(ctx) {
    const { lat, lng } = ctx.payload.data as { lat: number; lng: number };
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'AllGeo/1.0' } }
    );
    if (!res.ok) throw upstreamError(`HTTP ${res.status}`);
    const json = await res.json() as { display_name?: string; error?: string };
    if (json.error) throw upstreamError(json.error);
    return { address: json.display_name ?? null };
  },
};

function upstreamError(message: string) {
  return { code: 'upstream_error', message, transient: true };
}
```

### `src/providers/mapbox.ts`

```ts
import type { Provider } from '@layerall/core';

export const mapbox: Provider = {
  id: 'mapbox',
  weight: 20,
  health: 0.95,
  baseLatency: 150,
  failRate: 0.05,
  async invoke(ctx) {
    const { lat, lng } = ctx.payload.data as { lat: number; lng: number };
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${process.env.MAPBOX_TOKEN}`
    );
    if (!res.ok) throw upstreamError(`HTTP ${res.status}`);
    const json = await res.json() as { features: Array<{ place_name: string }> };
    return { address: json.features[0]?.place_name ?? null };
  },
};

function upstreamError(message: string) {
  return { code: 'upstream_error', message, transient: true };
}
```

> Repare que os três retornam `{ address: string | null }` — o contrato é unificado. O cliente nunca vê a diferença entre as APIs.

## 4. Policy

```ts
// src/policy.ts
import type { PolicyDocument } from '@layerall/core';

export const policy: PolicyDocument = {
  tenants: {
    default: {
      providers: ['google', 'nominatim', 'mapbox'],
      operations: {
        reverse: {
          strategy: 'most_fast',       // usa o provedor mais rápido
          timeoutMs: 5000,
          retries: { max: 1, backoffMs: 300 },
          failover: true,               // testa google → nominatim → mapbox se falhar
        },
      },
    },
  },
};
```

Ou gere pelo CLI:

```bash
npx @layerall/cli init --providers google,nominatim,mapbox --weights google=50,nominatim=30,mapbox=20
```

## 5. Router + servidor HTTP

```ts
// src/server.ts
import Fastify from 'fastify';
import { Router } from '@layerall/core';
import { policy } from './policy.js';
import { googleMaps } from './providers/google.js';
import { nominatim } from './providers/nominatim.js';
import { mapbox } from './providers/mapbox.js';

const router = new Router({
  providers: { google: googleMaps, nominatim, mapbox },
  policy,
  observer: {
    onAttempt(log) {
      console.log(`[${log.provider}] tentativa #${log.attempt}: ${log.ok ? 'OK' : 'FALHA'} (${log.latencyMs}ms)`);
    },
    onFinish(res) {
      console.log(`→ ${res.status} | via ${res.provider} | ${res.latencyMs}ms | receipt=${res.providerReceipt}`);
    },
  },
});

const app = Fastify({ logger: true });

app.post<{ Body: { lat: number; lng: number } }>('/reverse', async (req, reply) => {
  const { lat, lng } = req.body;

  const result = await router.execute('reverse', {
    externalId: `req_${Date.now()}`,
    data: { lat, lng },
  });

  if (result.status === 'failed') {
    return reply.code(502).send({ error: result.error?.message ?? 'all providers failed' });
  }

  return {
    address: result.result!.address,
    provider: result.provider,
    receipt: result.providerReceipt,
    latencyMs: result.latencyMs,
  };
});

app.listen({ port: 3000 }).then(() => console.log('AllGeo rodando em :3000'));
```

## 6. Testando

```bash
export GOOGLE_API_KEY=...
export MAPBOX_TOKEN=...

curl -X POST http://localhost:3000/reverse \
  -H 'Content-Type: application/json' \
  -d '{"lat": -23.5505, "lng": -46.6333}'
```

Resposta:

```json
{
  "address": "Av. Paulista, 1000 - Bela Vista, São Paulo - SP, Brasil",
  "provider": "google",
  "receipt": "google:req_174…:abc123",
  "latencyMs": 192
}
```

Se o Google estiver lento ou falhar, o LayerAll testa Nominatim automaticamente — o cliente não percebe nada.

## 7. Evoluindo

Agora você pode:

- **Adicionar provedores** — crie um arquivo novo e registre no Router. Zero mudança no cliente.
- **Mudar estratégia** — troque `most_fast` por `round_robin` na policy. Zero mudança no cliente.
- **Adicionar métricas** — implemente o observer com Prometheus.
- **Gerar landing page** — use `layerall init-landing --config allgeo-config.json` (em breve).

## Código completo

Disponível em `examples/allgeo/` no repositório layerall.