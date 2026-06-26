# @layerall/landing

White‑label landing/demo HTML template for LayerAll.

This is the original `whitelabel-layerall.html` (template agnóstico — Camada de Abstração/Orquestração), moved here as the canonical landing example. It is a self‑contained page (Tailwind via CDN) showcasing:

- Unification of multiple providers behind one SDK
- Pluggable routing strategies (round‑robin, load balance, most‑fast, failover)
- Interactive sandbox simulation of provider routing
- SDK snippets (Node/Python/cURL) and a policy engine reference
- Playground for sandbox API key generation + pricing tiers

## Develop

```bash
pnpm --filter landing dev
# open http://localhost:5174
```

## Build

```bash
pnpm --filter landing build
pnpm --filter landing preview
```

Source: `src/index.html`.