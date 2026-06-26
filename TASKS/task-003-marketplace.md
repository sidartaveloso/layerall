# Task 003 — Marketplace de produtos "All‑X" feitos com LayerAll

Status: pending
Type: feat
Assignee: Sidarta Veloso
Priority: low

## Description

Criar uma seção no site de documentação (ou uma página separada) que funcione como um marketplace/gallery de produtos públicos construídos com LayerAll. Cada entrada é um JSON seguindo o mesmo schema do `layerall init-landing`, permitindo que qualquer desenvolvedor publique seu "All‑X" via PR.

### Exemplo de entrada

```jsonc
// marketplace/allgeo.json
{
  "product": "AllGeo",
  "tagline": "Geocode reverso unificado — um SDK, N provedores",
  "domain": "geocode-reverse",
  "author": { "name": "Sidarta Veloso", "url": "https://github.com/sidartaveloso" },
  "website": "https://allgeo.dev",
  "providers": ["Google Maps", "Nominatim", "Mapbox", "OpenCage"],
  "strategies": ["round_robin", "most_fast", "failover"],
  "config": { /* link ou embed do JSON usado no init-landing */ }
}
```

### Como funciona

1. Desenvolvedor cria `marketplace/<slug>.json` seguindo o schema
2. Abre PR no repositório layerall
3. CI valida schema + sanitiza contra XSS
4. Mantenedor revisa e faz merge manual (sem auto-merge)
5. Merge → build gera `docs/public/marketplace.json` e a galeria atualiza
6. Visitantes veem cards com nome, domínio, provedores, link

## Segurança

### Validação no CI

- Uso de JSON schema estrito (cada campo com `pattern`, `format` e `maxLength`)
- Detecção de tags HTML, `javascript:`, `data:` URLs e iframes em todos os campos string
- Rejeição de IPs nus em `website` e `author.url` (exige domínio válido com DNS)
- Lista de bloqueio para domínios conhecidos de spam/malware
- CI falha + comentário no PR com o motivo

### Renderização

- Toda string é escapada com `escape-html` (ou DOMPurify se houver JS) antes de ir para o HTML
- CSP restritivo na página (`script-src 'self'`, `object-src 'none'`)

### Processo humano

- PRs de marketplace **não têm auto-merge**
- Mantenedor revisa visualmente cada entry antes de aprovar
- Botão "reportar" na página → abre issue no repositório

## Tasks

- [ ] Definir schema JSON (`.github/schemas/marketplace.json`) com patterns, maxLength e format
- [ ] Criar script de sanitização (`scripts/sanitize-marketplace.ts`) que:
  - Escapa HTML em todos os campos string
  - Valida URLs contra lista de bloqueio
  - Rejeita IPs nus em campos de URL
- [ ] Criar diretório `marketplace/` na raiz com entrada de exemplo (`_template.json`)
- [ ] Criar script de build que lê todos `marketplace/*.json`, sanitiza e gera `docs/public/marketplace.json`
- [ ] Adicionar página `docs/marketplace/index.md` no VitePress que lista os produtos em cards (com escape na renderização)
- [ ] Adicionar CI job que valida schema + sanitiza + comenta falha no PR (sem auto-merge)
- [ ] Adicionar botão "reportar" em cada card → link para `https://github.com/sidartaveloso/layerall/issues/new?template=report-marketplace.md`
- [ ] Criar template de issue para reportar entries
- [ ] Adicionar CSP restritivo na página
- [ ] Adicionar seção no README explicando como publicar
- [ ] (Opcional) Badge "Built with LayerAll" para os produtos listados

## Notes

### Estrutura visual (sugestão)

Grid de cards estilo GitHub Topics ou VueUse:

```
┌──────────────────┐  ┌──────────────────┐
│  AllGeo          │  │  AllSign         │
│  geocode-reverse │  │  e-signature     │
│  🟢 4 providers  │  │  🟢 3 providers  │
│  → allgeo.dev    │  │  → allsign.io    │
└──────────────────┘  └──────────────────┘
```

### Inspiração

- VueUse plugins: https://vueuse.org/guide/plugins.html
- Awesome lists: https://github.com/sindresorhus/awesome
- GitHub Marketplace: https://github.com/marketplace