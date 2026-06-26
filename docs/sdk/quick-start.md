# SDK do cliente

`@layerall/sdk` é um cliente HTTP tipado para qualquer backend compatível com LayerAll. Ele apenas encaminha requisições — a orquestração acontece no servidor com `@layerall/core`.

## Instalação

```bash
npm install @layerall/sdk
```

## Uso

```ts
import { Orchestrator } from '@layerall/sdk';

const client = new Orchestrator({
  apiKey: process.env.LAYERALL_API_KEY!,
  baseUrl: 'https://api.seu-allx.com',
});
```

### Operação única

```ts
const result = await client.operation('create', {
  payload: {
    externalId: 'meu-id-123',
    data: { /* domínio específico */ },
  },
  strategy: 'round_robin',
  timeoutMs: 8000,
});

console.log(result.id, result.provider, result.status);
// → "op_abc google succeeded"
```

### Override de estratégia por request

Útil para testes ou casos específicos:

```ts
// Forçar failover mesmo se a policy padrão for most_fast
await client.operation('send', {
  payload: { data: { to: '+551199999999', text: 'Olá' } },
  strategy: 'failover',
});
```

### Tratamento de erro

```ts
import { OrchestratorError } from '@layerall/sdk';

try {
  await client.operation('status', { payload: { data: { id: 'inexistente' } } });
} catch (err) {
  if (err instanceof OrchestratorError) {
    console.error(err.status, err.code, err.message);
    // → 504 timeout upstream timeout
  }
}
```

### AbortSignal

```ts
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 3000);

await client.operation('create', {
  payload: { data: {} },
  signal: ctrl.signal,
});
```

## API

### `new Orchestrator(opts)`

| Parâmetro   | Tipo     | Padrão        | Descrição                         |
|-------------|----------|---------------|-----------------------------------|
| `apiKey`    | `string` | —             | Chave de autenticação             |
| `baseUrl`   | `string` | —             | URL base do backend               |
| `endpoint`  | `string` | `/v1/operation` | Path do endpoint de operação    |
| `fetchImpl` | `typeof fetch` | `globalThis.fetch` | Para testes ou runtimes sem fetch nativo |

### `client.operation(op, params)`

| Parâmetro     | Tipo                              | Descrição                       |
|---------------|-----------------------------------|---------------------------------|
| `op`          | `string`                          | Nome da operação (`create`, `reverse`, etc.) |
| `params.payload` | `{ externalId?: string, data: T }` | Payload da operação |
| `params.strategy` | `string` (opcional)            | Override de estratégia |
| `params.timeoutMs` | `number` (opcional)           | Timeout em ms |
| `params.failover` | `boolean` (opcional)          | Override de failover |
| `params.signal` | `AbortSignal` (opcional)        | Para cancelamento |

### Retorno

```ts
{
  id: string;              // id da operação
  requestId: string;       // idempotência
  provider: string;        // provedor usado
  operation: string;
  status: 'succeeded' | 'failed';
  result?: TResult;
  error?: { code: string; message: string; provider: string };
  latencyMs: number;
  attempts: number;
  providerReceipt: string; // hash estável para auditoria
}
```