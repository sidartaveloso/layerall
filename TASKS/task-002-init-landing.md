# Task 002 — CLI: comando `layerall init-landing` — site de marketing data‑driven

Status: done
Type: feat
Assignee: Sidarta Veloso
Priority: high

## Description

Criar o comando `layerall init-landing` no `@layerall/cli` que, a partir de um arquivo JSON de config, gere um site estático de marketing completo (HTML+CSS+JS) para o produto "All‑X". O template HTML atual (`examples/landing/src/index.html`) deve ser refatorado para ser renderizado a partir de dados, não mais hardcoded.

O programador só precisa de um JSON como este:

```jsonc
// allgeo.json
{
  "product": "AllGeo",
  "tagline": "Geocode reverso unificado — um SDK, N provedores",
  "domain": "geocode-reverse",
  "operations": ["reverse", "batch"],
  "strategies": ["round_robin", "most_fast", "failover"],
  "providers": [
    { "name": "Google Maps",  "weight": 50, "latency": 180, "health": 0.98 },
    { "name": "Nominatim",    "weight": 30, "latency": 320, "health": 0.92 },
    { "name": "Mapbox",       "weight": 20, "latency": 140, "health": 0.95 }
  ],
  "sdkExamples": {
    "node": "import { Orchestrator } from '@layerall/sdk';\nconst client = new Orchestrator({ apiKey: process.env.LAYERALL_API_KEY!, baseUrl: 'https://api.allgeo.com' });\nconst result = await client.operation('reverse', { payload: { data: { lat: -23.55, lng: -46.63 } }, strategy: 'most_fast' });",
    "python": "from layerall_sdk import Orchestrator\nclient = Orchestrator(api_key=...)\nresult = client.operation('reverse', payload={'data': {'lat': -23.55, 'lng': -46.63}}, strategy='most_fast')",
    "curl": "curl -X POST 'https://api.allgeo.com/v1/operation/reverse' -H 'Authorization: Bearer $KEY' -d '{\"payload\":{\"data\":{\"lat\":-23.55,\"lng\":-46.63}},\"strategy\":\"most_fast\"}'"
  },
  "pricing": {
    "starter":  { "price": "R$ 0",   "requests": "10k/mês", "providers": 2 },
    "pro":      { "price": "R$ 499", "requests": "100k/mês", "providers": "ilimitado" },
    "enterprise": { "price": "Sob consulta", "features": ["SSO", "SLA", "Suporte dedicado"] }
  },
  "cta": { "email": "geo@allx.com" }
}
```

E executar:

```bash
layerall init-landing --config allgeo.json --out landing-geo
```

## Tasks

- [x] Definir schema TypeScript para o config JSON (`LandingConfig`) no CLI
- [x] Analisar o HTML atual (`examples/landing/src/index.html`) e isolar as seções que precisam ser dinâmicas
- [x] Extrair o template HTML puro (em `packages/cli/src/templates/landing.html`) data-driven via `window.__LAYERALL_CONFIG__`
- [x] Implementar `init-landing` no cli.ts (commander) que:
  - Lê e valida o JSON de config contra o schema
  - Gera o HTML completo substituindo as variáveis
  - Salva em `<out>/index.html`
- [x] Criar schema de validação com mensagens de erro amigáveis (`validateLandingConfig`)
- [x] Manter o `examples/landing` atual como fallback/default (sem config gera o template agnóstico `AllX`)
- [x] Testar geração com configs de exemplo diferentes (AllGeo e default)
- [x] Documentar o comando e o schema no README do CLI e no VitePress (`docs/cli/commands.md`)
- [ ] Adicionar seção visual no VitePress mostrando exemplos de landing geradas (galeria — pendente)

## Notes

### Estratégia

1. O HTML atual é 100% funcional mas tem dados fixos (provedores, operações, SDK snippets, preços). Vamos usar `Handlebars` ou simplesmente `template literals` + `replace` — o CLI já não tem deps pesadas. Prefiro template literals para manter zero dependencies extras.
2. O simulador JS no HTML usa `state.providers` fixo — vamos injetar os providers do config via `<script>window.__LAYERALL_CONFIG__ = {...}</script>`.
3. O layout visual (glass, gradientes, tipografia) permanece fixo — só o conteúdo muda. Isso garante identidade visual consistente entre todos os "All‑X".

### Arquivos alterados

- `packages/cli/src/cli.ts` — novo comando `init-landing`
- `packages/cli/src/landing.ts` — lógica de geração (novo)
- `packages/cli/src/landing.test.ts` — testes
- `examples/landing/src/index.html` — refatorar para aceitar `__LAYERALL_CONFIG__` e manter fallback hardcoded

### Exemplo de saída

```
landing-geo/
├── index.html          # site completo gerado
└── assets/             # (opcional) CSS/JS se extrairmos
```

### Referências

- Template atual: `examples/landing/src/index.html`
- CLI existente: `packages/cli/src/cli.ts`, `packages/cli/src/policy.ts`
- Schema inspirado no `PolicyDocument` de `@layerall/core`