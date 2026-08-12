# Task 007 — geo_rule: fallbackStrategy failover não faz cascata real entre providers sobrepostos

Status: in-progress
Type: fix
Assignee: sidartaveloso

## Description

geoRule() delega o caso 'fallback' (regiões sobrepostas) pra strategies[fallback](ctx), que pra 'failover' devolve só eligible[0] (um Provider). O Router só recebe 1 target em vez do pool inteiro, entao nunca tenta o segundo provider se o primeiro falhar -- apesar do nome 'failover' sugerir cascata. Descoberto via TDD no geocode-client (consumidor real, geohub monorepo) rodando contra o Router de verdade.

## Tasks

- [x] `strategies.test.ts` (TDD, vermelho primeiro): `geoRule` com `fallbackStrategy:
      'failover'` e regiões sobrepostas deve devolver o `pool` inteiro (array, ordem
      preservada), não só `pool[0]` — mirroring o que `priorityRace` já faz
- [x] `strategies.ts`: no branch `case 'fallback'` de `geoRule`, tratar `fallback ===
      'failover'` devolvendo `outcome.pool` diretamente em vez de delegar pra
      `strategies.failover(ctx)` (que devolve só `eligible[0]`)
- [x] `router.test.ts` (integração, dentro de `describe('Router geo_rule')`): regiões
      sobrepostas com `fallbackStrategy: 'failover'`, provider do pool[0] falha (erro não
      transiente) — o `Router` deve tentar o `pool[1]` e suceder; hoje ele propaga o erro do
      primeiro sem tentar o segundo
- [x] Rodar suíte completa (`pnpm --filter @layerall/core test`) — confirmar que os testes
      existentes de `geoRule` (hit único, fallback `most_fast`, `round_robin` default,
      `geo_unmatched`, `geo_bad_payload`) continuam verdes — a mudança só afeta o branch
      `fallback === 'failover'`
- [x] Changeset (`pnpm changeset`) — patch em `@layerall/core` (correção de
      comportamento, não é breaking change de API pública)
- [ ] Depois de publicado (merge do PR → release automatizado via `release.yml`): bumpar
      `@layerall/core` no `packages/geocode-client` do geohub, trocar o teste que hoje
      documenta o bug (`geocode-client-impl.test.ts`, describe "regiões sobrepostas:
      fallbackStrategy failover escolhe o primeiro provider...") por um que confirma a
      cascata real, e remover a nota de limitação do README do geocode-client

## Notes

- Causa raiz confirmada lendo o código-fonte (`packages/core/src/strategies.ts`,
  `geoRule`, branch `case 'fallback'`): delega pra `strategies[fallback]({ ...ctx, eligible:
  outcome.pool })`; pra `fallback === 'failover'`, `strategies.failover` é `(ctx) =>
  eligible[0] ?? null` — devolve só 1 `Provider`, nunca um array. O `Router.execute` só
  cascateia entre múltiplos `targets` quando a seleção devolve um array (compare com
  `priorityRace`, que devolve `eligible` inteiro).
- O `Router` **já sabe** cascatear corretamente — o `for (const provider of targets)` em
  `router.ts` já tenta o próximo item do array quando o anterior esgota as tentativas (prova:
  o teste "retries transient failures before failing over when enabled" em `router.test.ts`,
  onde `strategy: 'failover'` no nível de operação passa `eligible` inteiro via o atalho
  `failover2` em `router.ts` e cascateia entre providerA/B). O bug é só `geoRule` não repassar
  o pool inteiro nesse um branch.
- `selectGeoRule` (`geo-rule.ts`) já está correto — devolve `{ kind: 'fallback', pool }` com
  o pool inteiro, ordem preservada, deduplicado. O bug é inteiramente em `strategies.ts`.
- Descoberto na sessão de 12/ago/2026 implementando `@geocontrol/geocode-client` no monorepo
  geohub (task-229 lá) — TDD contra o `Router` real (não mockado) capturou o comportamento
  antes de eu perceber que era um bug e não um design intencional.
