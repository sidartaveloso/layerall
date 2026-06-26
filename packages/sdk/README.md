# @layerall/sdk

Minimal TypeScript client for LayerAll orchestrator services.

## Install

```bash
npm install @layerall/sdk
```

## Usage

```ts
import { Orchestrator } from '@layerall/sdk';

const client = new Orchestrator({
  apiKey: process.env.LAYERALL_API_KEY!,
  baseUrl: 'https://api.your-allx.com',
});

const result = await client.operation('create', {
  payload: { externalId: 'req_123', data: { /* domain payload */ } },
  strategy: 'round_robin',
  timeoutMs: 8000,
});

console.log(result.id, result.provider, result.status, result.providerReceipt);
```

The same SDK works across any "All‑X" backend (e‑signature, payments, messaging, storage, LLMs, KYC…). See the root [README](../../README.md).