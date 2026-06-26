# LayerAll

<div align="center">

**An agnostic orchestration/abstraction layer for multiple APIs/SDKs — one SDK, many providers, pluggable routing strategies**

[English](./README.md) · [Português](./README.pt-BR.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pnpm](https://img.shields.io/badge/maintained%20with-pnpm-cc00ff.svg)](https://pnpm.io/)
[![Turborepo](https://img.shields.io/badge/built%20with-Turborepo-ef4444)](https://turbo.build/repo)

📖 **Documentation**: https://sidartaveloso.github.io/layerall/

</div>

---

## What is LayerAll?

**LayerAll** is a toolkit for building "All‑X" orchestrator products: an abstraction layer that unifies multiple providers of the same domain (e‑signature, payments, messaging, storage, LLMs, KYC, …) behind a single, stable SDK contract. Clients talk to one SDK; LayerAll routes to N providers using configurable strategies.

### Core Principles

- **Unified contracts** — A stable interface (`create()`, `send()`, `status()`, `cancel()`) mapped to each provider
- **Pluggable strategies** — round‑robin, load‑balance, most‑fast/lowest‑latency, failover
- **Resilience** — retries, circuit breaker and automatic fallback per operation
- **Observability** — latency, errors, cost spread and auditable `providerReceipt`
- **Governance** — policies per tenant/route, rate‑limit, normalized webhooks

## Packages

This monorepo contains:

- **[@layerall/core](./packages/core)** — Orchestration engine: types, strategies and router (main package)
- **[@layerall/sdk](./packages/sdk)** — Minimal TypeScript client SDK
- **[@layerall/cli](./packages/cli)** — CLI for scaffolding policies and provider configs
- **[@layerall/plugin-prometheus](./packages/plugin-prometheus)** — Prometheus observer with ready-to-use metrics (`prom-client`)
- **[docs](./docs)** — VitePress documentation site
- **[examples/landing](./examples/landing)** — White‑label landing/demo HTML template

## Project Structure

```
layerall/
├── packages/
│   ├── core/      # Orchestration engine
│   ├── sdk/       # Client SDK
│   └── cli/       # CLI tool
├── docs/          # VitePress docs
├── examples/
│   └── landing/   # White‑label HTML template
├── turbo.json
└── pnpm-workspace.yaml
```

## Quick Start

```bash
pnpm install
pnpm build
pnpm test
```

Use the SDK:

```ts
import { Orchestrator } from '@layerall/sdk';

const client = new Orchestrator({
  apiKey: process.env.LAYERALL_API_KEY!,
  baseUrl: 'https://api.your-allx.com',
});

const result = await client.operation('create', {
  payload: { externalId: 'req_123', data: {} },
  strategy: 'round_robin',
  timeoutMs: 8000,
});

console.log(result.id, result.provider, result.status);
```

## Strategies

| Strategy       | Description                                   |
| -------------- | --------------------------------------------- |
| `round_robin`  | Distributes volume equally across providers   |
| `load_balance` | Weighted selection by provider capacity      |
| `most_fast`    | Picks the lowest‑latency eligible provider    |
| `failover`     | Tries providers in order until one succeeds   |

## Releases

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and npm publishing. See [RELEASE.md](./RELEASE.md).

## License

MIT — see [LICENSE](./LICENSE).

## Credits

Created and maintained by [Sidarta Veloso](https://github.com/sidartaveloso).