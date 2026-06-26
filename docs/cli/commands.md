# CLI

O `@layerall/cli` ajuda a criar e validar policies sem escrever JSON na mão.

## Instalação

```bash
npm install -g @layerall/cli
# ou use com npx
npx @layerall/cli <comando>
```

## `layerall init`

Gera um arquivo `layerall.policy.json` com valores sensatos.

```bash
layerall init \
  --providers google,nominatim,mapbox \
  --weights google=50,nominatim=30,mapbox=20 \
  --out allgeo.policy.json
```

Saída:

```json
{
  "tenants": {
    "default": {
      "providers": ["google", "nominatim", "mapbox"],
      "operations": {
        "create": { "strategy": "round_robin", "timeoutMs": 8000, "retries": { "max": 1, "backoffMs": 300 }, "failover": true },
        "send": { "strategy": "load_balance", "weights": {"google": 50, "nominatim": 30, "mapbox": 20}, "timeoutMs": 12000, "retries": { "max": 2, "backoffMs": 450 } },
        "status": { "strategy": "most_fast", "timeoutMs": 6000, "cacheTtlMs": 5000 },
        "cancel": { "strategy": "failover", "timeoutMs": 8000 }
      }
    }
  }
}
```

> Os nomes das operações podem ser alterados depois — o CLI gera `create`, `send`, `status`, `cancel` como padrão.

## `layerall validate`

Valida a estrutura de um arquivo policy:

```bash
layerall validate allgeo.policy.json
# ✔ Policy is valid.
```

Se algo estiver errado:

```bash
# ✖ Policy issues:
#   - tenant "default" providers must be an array
```

## `layerall init-landing`

Gera um site de marketing estático (HTML único) a partir de um JSON de
config. O template é data-driven via `window.__LAYERALL_CONFIG__` — o programador
só descreve produto, provedores, estratégias, pricing e snippets de SDK, e o CLI
gera um `index.html` pronto para deploy.

### Uso

```bash
# com config customizada
layerall init-landing --config allgeo.json --out landing-geo

# sem config: gera o template agnóstico "AllX" como ponto de partida
layerall init-landing --out landing-default
```

### Config schema

```jsonc
{
  "product": "AllGeo",                       // obrigatório
  "tagline": "Geocode reverso unificado",   // obrigatório
  "domain": "geocode reverso",              // obrigatório
  "operations": ["reverse", "batch"],        // obrigatório (strings)
  "strategies": ["round_robin", "most_fast", "failover"], // obrigatório (subset válido)
  "providers": [                              // obrigatório (≥1)
    { "name": "Google Maps", "weight": 50, "latency": 180, "health": 0.98 }
  ],
  "sdkExamples": {                            // opcional
    "node":   "import { Orchestrator } from '@layerall/sdk'; ...",
    "python": "from layerall_sdk import Orchestrator ...",
    "curl":   "curl -X POST ..."
  },
  "pricing": {                                // opcional
    "starter":    { "price": "R$ 0",   "requests": "10k/mês",  "providers": 2 },
    "pro":        { "price": "R$ 499", "requests": "100k/mês", "providers": "ilimitado" },
    "enterprise": { "price": "Sob consulta", "features": ["SSO", "SLA"] }
  },
  "cta": { "email": "geo@allx.com" }          // opcional
}
```

Estratégias válidas: `round_robin`, `load_balance`, `most_fast`, `failover`.

### Validação

Se a config violar o schema, o CLI imprime a lista de issues e sai com código 1:

```bash
layerall init-landing --config bad.json
# ✖ Landing config issues:
#   - tagline: tagline deve ser uma string não vazia
#   - strategies[0]: estratégia desconhecida: "random". Válidas: round_robin, ...
```

### Saída

```
landing-geo/
└── index.html   # site estático completo (Tailwind CDN + fontes Google, sem build)
```

Abra direto no navegador, ou sirva com `npx serve landing-geo`. 100% estático — pode
hospedar em qualquer CDN (S3, Vercel, Netlify, GitHub Pages).