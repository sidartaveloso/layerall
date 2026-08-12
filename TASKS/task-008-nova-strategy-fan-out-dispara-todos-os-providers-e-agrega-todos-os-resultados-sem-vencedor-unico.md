# Task 008 — nova strategy fan_out: dispara todos os providers e agrega TODOS os resultados (sem vencedor único)

Status: done
Type: feat
Assignee: sidartaveloso

## Description

Todas as 6 strategies atuais (round_robin/load_balance/most_fast/failover/geo_rule/priority_race) selecionam UM provider vencedor -- OperationResult.result e OperationResult.provider sao sempre singulares. Nao existe caso de uso pra fan-out real (disparar todos em paralelo e devolver os resultados de TODOS que tiveram sucesso, sem escolher vencedor). Motivador: geohub/packages/veiculo-client faz merge manual (Promise.allSettled + dedup) porque nao ha strategy equivalente -- descoberto durante a migracao de consulta-placa-router (que usou failover com sucesso) quando o proximo candidato (veiculo-client) revelou esse gap. priority_race e o mais proximo mas tem semantica de corrida (cancela os perdedores assim que o primeiro sucesso chega via executeParallel) -- fan_out precisa esperar TODOS resolverem (sucesso ou falha) e devolver os resultados de cada um, sem cancelar nada.

## Tasks

- [x] `types.ts`: adicionar `'fan_out'` a `StrategyName`; novo tipo `FanOutEntry<TResult>` (
      `{ provider: string; status: 'succeeded' | 'failed'; result?: TResult; error?:
      OperationError; latencyMs: number }`); adicionar `results?: FanOutEntry<TResult>[]` em
      `OperationResult` — opcional, presente só quando a strategy é `fan_out`, sem quebrar o
      shape existente pras outras 6
- [x] `strategies.ts` (TDD, vermelho primeiro): `fanOut: Strategy` — mesma forma de
      `priorityRace` (devolve `eligible` inteiro, ou `null` se vazio); registrar em
      `strategies` record
- [x] `router.test.ts` (TDD, vermelho primeiro): novo método privado `executeFanOut` —
      dispara todos os `targets` em paralelo via `Promise.all` (NÃO `Promise.race`/cancela-o-
      resto como `executeParallel`), espera todos resolverem (sucesso OU falha), popula
      `results[]` com uma entrada por provider na ordem de `targets`. Casos a cobrir:
      - todos sucedem → `status: 'succeeded'`, `results` com N entradas `succeeded`,
        `provider` = ids concatenados por vírgula, `attempts` = N
      - alguns falham, pelo menos um sucede → `status: 'succeeded'` no topo (parcial já é
        sucesso), `results` mistura `succeeded`/`failed`, cada `failed` com seu próprio
        `OperationError`
      - todos falham → `status: 'failed'` no topo, `error.code = 'all_failed'`, `results`
        só com entradas `failed`
      - 1 único provider elegível → ainda popula `results` com 1 entrada (fan_out não vira
        caminho sequencial de 1 item — consistência de shape importa mais que atalho)
      - timeout por provider (mesmo mecanismo de `AbortController` de `executeParallel`,
        `effectiveTimeout = explicitTimeoutMs ?? provider.timeoutMs ?? defaultTimeoutMs`) —
        provider que estoura vira uma entrada `failed` com código de timeout/abort, os
        outros continuam normalmente (SEM cancelar por causa do timeout de um vizinho —
        diferença chave pra `priority_race`, que cancela os "perdedores" quando o vencedor
        chega; aqui não tem "perdedor")
      - `AttemptLog`/`Observer.onAttempt` continua disparando por provider, igual às outras
        strategies (reusar `emitAttempt`)
- [x] Adicionar branch em `Router.execute`: `if (strategy === 'fan_out') { ... return
      executeFanOut(...) }`, paralelo ao branch existente de `priority_race` — sem
      `targets.length > 1` como condição (fan_out com 1 provider ainda popula `results`,
      diferente de `priority_race` que só entra no caminho paralelo com >1)
- [x] `geo-rule.test.ts`/`geo-rule.ts`: NÃO precisa mudar — `fan_out` como
      `fallbackStrategy` dentro de `geo_rule` fica fora de escopo por ora (não há caso de uso
      motivador pra combinar os dois); documentar essa decisão explicitamente
      (`geoRule()` já lança `geo_bad_payload` se `fallbackStrategy === 'geo_rule'` — não
      precisa de guarda equivalente pra `fan_out`, mas vale um teste confirmando que
      `fan_out` como fallback funciona via delegação normal a `strategies.fan_out(ctx)`, já
      que o código existente já delega genericamente)
- [x] Rodar suíte completa (`pnpm --filter @layerall/core test`) — confirmar que as 56
      existentes continuam verdes, mais os casos novos
- [x] Atualizar `docs/guide/strategies.md` com a nova strategy (mesmo padrão das outras 6)
- [x] Changeset (`pnpm changeset`) — **minor** em `@layerall/core` (adiciona strategy nova +
      campo opcional em `OperationResult`, não quebra nada existente)
- [x] **Adicionado depois (mesma sessão, 12/ago/2026):** `fan-out.ts` + `fan-out.test.ts`
      (TDD, 7 casos) — `isFanOutResult(result)` (type guard: `results` só é opcional no
      tipo porque a strategy vem de policy resolvida em runtime, não dá pra saber em
      compile-time; a guard estreita isso onde você sabe) e `mergeFanOut(result, merge)`
      (combina os `result`s bem-sucedidos, `TMerged` inferido do retorno de `merge`, nunca
      anotado na mão). Decisão explícita de NÃO adicionar isso como parâmetro
      (`merge?`) em `OperationRequestOptions`/`execute()` — só faria sentido pra uma entre
      sete strategies (estado inválido representável), e mesclar já é trivial por fora.
      Exportado em `index.ts`. Seção "Consumindo o resultado" adicionada em
      `docs/guide/strategies.md` com o ADR completo do porquê. Novo tutorial
      `docs/tutorials/allfleet.md` (agregação de frota de dois sistemas, dedup por placa —
      o caso de uso real que motivou tudo isso) registrado no nav do VitePress; `pnpm run
      build` da doc confirmado sem link quebrado
- [ ] (fora do escopo desta task, fica registrado como próximo passo) Depois de publicado:
      usar em `geohub/packages/veiculo-client` (task-231 lá) — `listarVeiculos` passa a poder
      usar `strategy: 'fan_out'` e o merge/dedup (hoje em `merge-utils.ts`) vira lógica de
      CONSUMIDOR sobre `resultado.results`, não responsabilidade do Router (a lib não sabe o
      que é "placa" — só agrega o envelope)

## Notes

- Motivado por uma pergunta direta do usuário durante a sessão de 12/ago/2026 ("acho que o
  layerall tem uma estratégia que retorna mais de um") — verificação no código-fonte
  confirmou que NÃO tinha; esta task fecha esse gap real.
- Design deliberadamente NÃO tenta normalizar/mesclar os `result`s de cada provider — isso é
  específico de domínio (ex.: dedup por placa em `veiculo-client`) e não pertence à lib
  genérica. `fan_out` só garante que TODOS os resultados chegam ao consumidor, cabe a ele
  decidir o que fazer com eles — mesmo princípio já aplicado em `geo_rule`/`priority_race`
  (o Router normaliza o ENVELOPE, nunca o `result` em si).
- Reaproveita boa parte da mecânica de `executeParallel` (AbortController por provider,
  timeout individual, `emitAttempt`) — a diferença central é `Promise.all` sem
  cancelamento-ao-primeiro-sucesso, e popular `results[]` em vez de devolver só o vencedor.
