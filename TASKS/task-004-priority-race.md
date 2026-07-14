# Task 004 — Estratégia `priority_race` com Strategy type generalizado

Status: pending
Type: feat
Assignee: Sidarta Veloso
Priority: medium

## Description

Adicionar a estratégia `priority_race` ao `@layerall/core`, generalizando o tipo `Strategy` para suportar seleção multi-provider. A estratégia dispara **todos os providers elegíveis em paralelo**, respeitando **prioridade por ordem no array** e cancelando providers de menor prioridade quando um de maior prioridade succeede.

### Comportamento esperado

1. `priorityRace(ctx)` retorna **todos** os `eligible` providers na ordem original (primeiro = maior prioridade)
2. O router detecta retorno `Provider[]` e entra em **modo de execução paralela**
3. Cada provider recebe seu próprio `AbortController`:
   - Timeout individual: `provider.timeoutMs ?? timeoutGeral ?? defaultTimeoutMs`
   - `timeoutGeral` (vindo de `options.timeoutMs` / `opPolicy.timeoutMs`) **sobrepõe** o timeout individual
4. Todos disparam simultaneamente
5. Resultados são processados em **ordem de prioridade**:
   - Provider de maior prioridade succeede → retorna seu resultado imediatamente, **cancela** os demais
   - Provider falha → aguarda o próximo na ordem de prioridade (já está em voo)
   - Qualquer um succeede → resultado de sucesso
6. **Só falha quando todos falham** — agrega último erro
7. `Observer.onCancelled` é emitido para cada provider cancelado com motivo (`'superseded' | 'timeout' | 'aborted'`)

### Vantagens

- ✅ Paralelismo real: todos disparam juntos
- ✅ Cancelamento inteligente: maior prioridade cancela os outros
- ✅ Estratégia de espera: menor prioridade espera as maiores
- ✅ Timeout individual: cada provider tem seu tempo limite
- ✅ Só falha quando todos falham: tolerância a falhas
- ✅ Eventos de cancelamento no Observer

## Tasks

### 1. Tipos (`packages/core/src/types.ts`)

- [ ] Adicionar `'priority_race'` ao union `StrategyName`
- [ ] Adicionar `CancelledReason` type: `'superseded' | 'timeout' | 'aborted'`
- [ ] Adicionar `CancelledEvent` interface:
  ```ts
  export interface CancelledEvent {
    requestId: string;
    provider: string;
    operation: OperationName;
    reason: CancelledReason;
  }
  ```
- [ ] Adicionar `onCancelled?(ev: CancelledEvent): void` ao `Observer`
- [ ] Adicionar `timeoutMs?: number` opcional ao `Provider` (para timeout individual)

### 2. Estratégia (`packages/core/src/strategies.ts`)

- [ ] Generalizar `Strategy` type:
  ```ts
  export type Strategy = (ctx: SelectionContext) => Provider | Provider[] | null;
  ```
- [ ] Implementar `priorityRace` que retorna `eligible` (array vazio → `null`)
- [ ] Registrar no record `strategies`
- [ ] Estratégias existentes continuam retornando `Provider | null` (compatível via covariância)
- [ ] Exportar `priorityRace`

### 3. Router (`packages/core/src/router.ts`)

- [ ] Detectar retorno array vs Provider na seleção:
  ```ts
  const selection = strategies[strategy](selectionCtx);
  const order = Array.isArray(selection) ? selection : (failover ? eligible : [selection].filter(...));
  ```
- [ ] Quando `order` for array com length > 1 e strategy for `priority_race`, entrar em **modo paralelo**
- [ ] Implementar `executeParallel()`:
  - Criar `AbortController` por provider com timeout individual (provider timeout sobrescrito pelo timeout geral)
  - Disparar todos com `Promise.allSettled` + tracking individual
  - Processar resultados em ordem de prioridade (índice no array)
  - Provider succeede → resolver imediatamente, abortar controllers dos demais, emitir `onCancelled` com `reason: 'superseded'`
  - Provider falha → continuar para próximo
  - Timeout/disparo individual → emitir `onCancelled` com `reason: 'timeout'`
  - Sinal externo aborta → emitir `onCancelled` com `reason: 'aborted'`
  - Todos falham → retornar `all_failed`
- [ ] Garantir que `latencyMs` e `attempts` no resultado final sejam precisos (latência do provider vencedor, attempts = total de invocações)

### 4. Testes (`packages/core/src/strategies.test.ts`)

- [ ] `priorityRace` retorna todos os eligible providers
- [ ] `priorityRace` retorna `null` para pool vazio

### 5. Testes (`packages/core/src/router.test.ts`)

- [ ] `priority_race`: primeiro provider succeede → resultado do primeiro
- [ ] `priority_race`: primeiro falha, segundo succeede → resultado do segundo
- [ ] `priority_race`: todos falham → `all_failed`
- [ ] `priority_race`: cancelamento de lower-priority quando higher succeede (verificar `onCancelled`)
- [ ] `priority_race`: per-provider timeout respeitado
- [ ] `priority_race`: timeout geral sobrepõe timeout individual
- [ ] `priority_race`: sinal externo de aborto propaga para todos

### 6. Integração (opcional)

- [ ] Atualizar `@layerall/sdk` se ele exporta tipos de strategy que precisam refletir o novo nome
- [ ] Adicionar entrada na tabela de estratégias no `README.md`

## Versionamento

**Major version** (`@layerall/core@2.0.0`) — mudanças quebram contratos públicos:

| Mudança | Impacto |
|---|---|
| `StrategyName` ganha `'priority_race'` | Switch/pattern-match exaustivos quebram |
| `Strategy` type muda de `(ctx) => Provider \| null` para `(ctx) => Provider \| Provider[] \| null` | Código que referenciar o tipo explicitamente precisa atualizar |
| `Observer` ganha `onCancelled?` opcional | **Não quebra** (método opcional) |
| `Provider` ganha `timeoutMs?` opcional | **Não quebra** (campo opcional) |

`semantic-release` detecta automaticamente via conventional commits — usar `feat!:` ou `BREAKING CHANGE` no footer do commit.

## Notes

### Estratégia de implementação — Abordagem B (Strategy type generalizado)

O tipo `Strategy` muda de `(ctx) => Provider | null` para `(ctx) => Provider | Provider[] | null`.
Isso é uma mudança **compatível para trás**: estratégias existentes retornam `Provider | null`,
que é um subtipo de `Provider | Provider[] | null`. O router usa `Array.isArray()` para decidir
o fluxo.

### Fluxo paralelo

```
execute() detecta Array.isArray(selection)
  │
  └─ priorityRace flow:
       ├─ Para cada provider: AbortController com timeoutMs efetivo
       │    (provider.timeoutMs ?? operationTimeout ?? defaultTimeoutMs)
       │    mas operationTimeout overrides se definido
       ├─ Promise.allSettled(promises) + tracking por índice
       ├─ Await resultados em ordem de prioridade (índice crescente)
       │    ├─ Sucesso → return, abortar controllers restantes
       │    │              emitir onCancelled(reason: 'superseded') para cada
       │    └─ Falha → continuar
       └─ Todos falharam → all_failed
```

### Definição de prioridade

A ordem no array `eligible` (que espelha `tenant.providers[]`) define prioridade:
primeiro elemento = maior prioridade, último = menor.

### Cancelamento via AbortSignal

O router cria `AbortController` por provider. O signal é passado no `InvokeContext`.
Providers responsivos ao `AbortSignal` podem interromper sua requisição downstream.
Quando um provider é cancelado por `'superseded'`, o router simplesmente ignora o
resultado pendente (a promise pode resolver, mas o valor é descartado).

### onCancelled vs onAttempt

`onCancelled` é chamado **no momento do cancelamento**, não quando a promise rejeita.
Isso permite que observadores (ex: Prometheus) incrementem contadores de cancelamento
sem esperar a resolução da promise. `onAttempt` continua sendo chamado para tentativas
que de fato executaram (completaram ou timeout individual).

### Exemplo de uso

```ts
const router = new Router({
  providers: {
    fastButFallible: { id: 'fastButFallible', invoke: ..., timeoutMs: 2000 },
    slowButReliable: { id: 'slowButReliable', invoke: ..., timeoutMs: 5000 },
  },
  policy: {
    tenants: {
      default: {
        providers: ['fastButFallible', 'slowButReliable'],
        operations: {
          create: { strategy: 'priority_race', timeoutMs: 4000 },
        },
      },
    },
  },
});

// fastButFallible (prioridade 1) e slowButReliable (prioridade 2)
// disparam juntos. Se fast succeedir em 2s, slow é cancelado.
// Se fast falhar, aguarda slow até 4s.
```

### Referências

- `Strategy` type em `packages/core/src/strategies.ts:16`
- `Observer` type em `packages/core/src/types.ts:126-130`
- `Provider` type em `packages/core/src/types.ts:8-27`
- Fluxo `execute()` em `packages/core/src/router.ts:42-121`
