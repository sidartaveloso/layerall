# Task 006 — Generalizar OperationName para nomes de operação customizados

Status: done
Type: feat
Assignee: A definir

## Description

Permitir nomes de operação arbitrários (ex: `consulta-placa`) no `Router`, hoje
limitados ao union fechado `'create' | 'send' | 'status' | 'cancel'`.

### Motivação

O problema: a 1.0.0 define `OperationName` como union **fechado**
(`packages/core/src/types.ts:4`), mas os docs (guia `getting-started` e tutorial
`allgeo`) afirmam que "a operação não é fixa — você define os nomes que fizerem
sentido pro seu domínio" e usam `reverse` como exemplo. Ou seja: o **código não
bate com o contrato documentado**. Um consumidor com uma operação de negócio
fora dos 4 canônicos (ex: consulta de placa, geocode reverso) é forçado a:

1. Mapear a operação de negócio para um dos 4 canônicos (ex: `status`), criando
   acoplamento semântico indevido; ou
2. Castar o nome via `as`, perdendo a segurança de tipos que é o propósito da lib.

O objetivo desta task é alinhar o código ao contrato já documentado: tornar
`OperationName` **extensível** (literais canônicos com autocomplete + qualquer
string), sem quebrar o autocomplete dos nomes padrão nem o `@layerall/cli`.

## Tasks

### 1. Tipos (`packages/core/src/types.ts`)

- [x] Generalizar `OperationName` (linha 4) usando o padrão de string extensível:
  ```ts
  export type OperationName = 'create' | 'send' | 'status' | 'cancel' | (string & {});
  ```
- [x] Verificar propagação — todos os usos de `OperationName` já aceitam string
      arbitraria sem cast no core:
  - `InvokeContext.operation`, `OperationResult.operation`, `CancelledEvent.operation`
  - `TenantPolicy.operations: Partial<Record<OperationName, OperationPolicy>>`
  - `AttemptLog.operation`, `Observer.onStart`
- [x] Garantir que o `Router.execute(operation, payload, options)` aceita
      `consulta-placa` sem cast (o `router.ts` só repassa a string — deve compilar
      sem mudança de lógica).

### 2. Router (`packages/core/src/router.ts`)

- [x] Confirmar que nenhuma assinatura interna precisa mudar (`success`, `fail`,
      `emitAttempt`, `emitCancelled` já tipam `operation` como `OperationName`).
- [x] Teste de regressão: `execute('consulta-placa', ...)` com estratégia
      `priority_race`/`failover` passa a typecheck sem `as`.

### 3. CLI (`packages/cli/src/policy.ts`)

- [x] `STRATEGIES_PER_OP: Record<OperationName, StrategyName>` (linha 5) quebra
      com o union ampliado (objeto literal não satisfaz índice de string).
      Extrair um tipo local `CanonicalOperation = 'create' | 'send' | 'status' | 'cancel'`
      e tipar `STRATEGIES_PER_OP` como `Record<CanonicalOperation, StrategyName>`.
- [x] `ALL_OPS: OperationName[]` (linha 3) → tipar como `CanonicalOperation[]`
      (os 4 canônicos continuam sendo os defaults gerados pelo `init`).
- [x] `validatePolicy` já aceita chaves de operação arbitrárias (só checa se
      `operations` é objeto) — sem mudança; adicionar teste opcional validando
      uma policy com operação customizada.

### 4. SDK (`packages/sdk`)

- [x] Confirmar que o `sdk` re-exporta `OperationName` de `@layerall/core`
      (`src/types.ts:1-6`) — a generalização chega automaticamente. Sem mudança
      de código; adicionar teste/typecheck se necessário.

### 5. Docs

- [x] O texto dos guias já promete nomes customizados; depois da mudança de tipo
      eles passam a ser verdade. Adicionar nota na página `Estratégias` ou
      `Getting Started` explicitando o padrão de string extensível e que os 4
      canônicos são apenas defaults de autocomplete.

### 6. Testes (`packages/core/src/router.test.ts`)

- [x] Novo teste: executa operação customizada (`consulta-placa`) e verifica que
      `OperationResult.operation` e o log do observer carregam o nome exato.
- [x] Novo teste: policy com `operations['consulta-placa']` definida e
      `strategy: 'failover'` roteia corretamente.
- [x] Rodar `pnpm typecheck` e `pnpm test` no repo inteiro.

## Versionamento

**Major version** (`@layerall/core@2.0.0`) — mudança de contrato de tipos públicos
(seguindo o precedente da task-004, que tratou ampliação de union como breaking):

| Mudança                                                | Impacto                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `OperationName` deixa de ser union fechado e vira `... | (string & {})`                                                  | `Record<OperationName, ...>` e switch/pattern-match exaustivos quebram |
| `Record<OperationName, X>` no código do consumidor     | Precisa virar `Record<CanonicalOperation, X>` ou `Partial<...>` |

`semantic-release` detecta automaticamente via conventional commits — usar
`feat!:` ou `BREAKING CHANGE` no footer do commit.

## Notes

### Padrão de string extensível

`'create' | 'send' | 'status' | 'cancel' | (string & {})` preserva o
autocomplete dos nomes canônicos no editor, mas aceita qualquer string em
runtime. É o padrão recomendado pelo TypeScript para "enums abertos".

### Por que não `type OperationName = string`

Perderia o autocomplete e o `Record` tipado por operação no `TenantPolicy`
(que é o coração do contrato de policy). O `(string & {})` mantém os dois.

### CLI: defaults canônicos continuam

O `init` continua gerando policy para os 4 canônicos (`create/send/status/cancel`).
A mudança é só tipográfica — o `CanonicalOperation` documenta que ali é um
default, não uma restrição da engine.

### Referências

- `OperationName` em `packages/core/src/types.ts:4`
- Usos no core: `packages/core/src/router.ts` (assinaturas de `execute`/`success`/`fail`)
- `ALL_OPS`/`STRATEGIES_PER_OP` em `packages/cli/src/policy.ts:3-10`
- Re-export no `packages/sdk/src/types.ts:1-6`
- Docs que já prometem nomes customizados: `docs/guide/getting-started.md` (exemplo `reverse`), `docs/guide/strategies.md`
