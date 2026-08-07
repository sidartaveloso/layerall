# Task 005 — Estratégia `geo_rule`: roteamento por região geográfica

Status: pending
Type: feat
Assignee: Sidarta Veloso
Priority: medium

## Description

Adicionar a estratégia `geo_rule` ao `@layerall/core`: roteamento por região geográfica. A estratégia lê a coordenada `[lng, lat]` do payload, testa contra os `MultiPolygon` GeoJSON configurados no `OperationPolicy` e seleciona o provider da região. Quando mais de uma regra casa com a coordenada, a escolha final é delegada a uma `fallbackStrategy` configurável, compondo com as estratégias já existentes.

### Comportamento esperado

1. `geoRule(ctx)` lê `ctx.payload.data[ctx.geo.field]` como `[lng, lat]` (ordem GeoJSON)
2. Testa cada regra com `booleanPointInPolygon` do Turf (suporta multipolygon e buracos)
3. Hit único → retorna o provider da regra (se elegível)
4. Multi-hit → providers das regras em ordem do config, sem duplicatas, filtrando só os `eligible` → `fallbackStrategy` decide o vencedor
5. Miss → erro `geo_unmatched`
6. Coordenada ausente/inválida → erro `geo_bad_payload`
7. Guarda de recursão: `fallbackStrategy` nunca é `geo_rule`

### Discriminated union da seleção

A lógica pura expõe o resultado como união discriminada exaustiva:

```ts
type GeoRuleOutcome =
  | { kind: 'hit'; provider: Provider }
  | { kind: 'fallback'; pool: Provider[] }
  | { kind: 'unmatched' }
  | { kind: 'bad_payload' };
```

`selectGeoRule(ctx)` é pura e retorna `GeoRuleOutcome`. O switch sobre `kind` é exaustivo (o compilador garante a cobertura). `geoRule` é o adaptador que mapeia:

- `hit` → retorna o provider
- `fallback` → `strategies[fallbackStrategy](subCtx)` sobre o sub-pool
- `unmatched` / `bad_payload` → lança `GeoRuleError` com `code` discriminado

## Tasks

### 1. Testes primeiro (TDD — red/green)

- [ ] `selectGeoRule` com ponto dentro do multipolygon → `{ kind: 'hit', provider }`
- [ ] ponto fora de todas as regras → `{ kind: 'unmatched' }`
- [ ] coordenada ausente/inválida → `{ kind: 'bad_payload' }`
- [ ] multipolygon com buraco: ponto no buraco → `{ kind: 'unmatched' }`
- [ ] duas regras sobrepostas → `{ kind: 'fallback', pool }` com providers na ordem do config e sem duplicatas
- [ ] `geoRule` delega a `fallbackStrategy` (ex.: `most_fast`) e retorna `Provider`
- [ ] `geoRule` lança `GeoRuleError` com `code` discriminado
- [ ] router: `geo_bad_payload` / `geo_unmatched` viram `OperationResult` `failed` com esses codes

### 2. Dependências (`packages/core/package.json`)

- [ ] `@turf/helpers` (tipo `MultiPolygon`)
- [ ] `@turf/boolean-point-in-polygon` (teste de ponto em multipolygon, com suporte a buracos)

### 3. Tipos (`packages/core/src/types.ts`)

- [ ] `'geo_rule'` no union `StrategyName`
- [ ] `GeoErrorCode = 'geo_bad_payload' | 'geo_unmatched'`
- [ ] Config no `OperationPolicy`:
  ```ts
  geo?: {
    field: string;
    rules: Array<{
      providers: string[];
      multipolygon: MultiPolygon;
    }>;
    fallbackStrategy?: StrategyName;
  }
  ```
- [ ] `GeoRuleError extends Error` com `code: GeoErrorCode`

### 4. Estratégia (`packages/core/src/strategies.ts`)

- [ ] `SelectionContext` ganha `payload` e `geo`
- [ ] `selectGeoRule(ctx): GeoRuleOutcome` (pura, sem efeitos colaterais)
- [ ] `geoRule: Strategy` (adaptador que mapeia o outcome)
- [ ] Registrar no record `strategies` e exportar `geoRule`

### 5. Router (`packages/core/src/router.ts`)

- [ ] Passar `payload` e `geo` (de `opPolicy`) ao `selectionCtx`
- [ ] Capturar `GeoRuleError` na seleção → `fail(requestId, operation, error.code, ...)`
- [ ] `fallbackStrategy` default `round_robin`

### 6. Documentação

- [ ] README do `@layerall/core`: entrada na tabela de estratégias com exemplo de config

## Versionamento

**Major version** (`@layerall/core@2.0.0`) — precedente da task-004:

| Mudança | Impacto |
|---|---|
| `StrategyName` ganha `'geo_rule'` | Switch/pattern-match exaustivos quebram |
| `SelectionContext` ganha `payload` e `geo` | Contexto interno, mas exportado — adição não quebra |
| `OperationPolicy.geo?` | **Não quebra** (campo opcional) |
| Primeiras runtime deps (`@turf/*`) | Impacto de bundle passa a existir no core |

`semantic-release` detecta via conventional commits — usar `feat!:` ou `BREAKING CHANGE` no footer.

## Notes

### TDD

Escrever os testes de `selectGeoRule` e `geoRule` **antes** da implementação. A separação lógica pura (`selectGeoRule`) vs adaptador (`geoRule`) isola o comportamento geográfico do mecanismo de estratégia, mantendo os testes rápidos e sem mock de rede. Testes de router cobrem a conversão do `GeoRuleError` para `OperationResult`.

### Discriminated unions

- `GeoRuleOutcome` força o tratamento exaustivo dos quatro desfechos: o `switch` sem `default` falha no tipo se um caso novo surgir.
- `GeoErrorCode` é a fonte única dos códigos de erro propagados ao `OperationResult`, evitando strings soltas.
- A coordenada é tipada como `[lng: number, lat: number]` (tupla nomeada), nunca objeto `{ lat, lng }`.

### Sem comentários

Código deve ser auto-documentado: nomes precisos e tipos expressivos no lugar de comentários. Se uma parte precisa de comentário para ser entendida, refatorar até o nome/tipo carregar o significado. Exemplos de código nesta task seguem essa regra.

### GeoJSON `[lng, lat]`

Turf e GeoJSON usam `[lng, lat]`, não `{ lat, lng }`. O payload entrega a coordenada em `ctx.payload.data[field]` já em `[lng, lat]`, passada direto ao `booleanPointInPolygon` sem conversão.

### Exemplo de config

```ts
const router = new Router({
  providers: {
    br: { id: 'br', invoke },
    us: { id: 'us', invoke },
  },
  policy: {
    tenants: {
      default: {
        providers: ['br', 'us'],
        operations: {
          create: {
            strategy: 'geo_rule',
            geo: {
              field: 'location',
              rules: [
                { providers: ['br'], multipolygon: brasilMultipolygon },
                { providers: ['us'], multipolygon: euaMultipolygon },
              ],
              fallbackStrategy: 'most_fast',
            },
          },
        },
      },
    },
  },
});
```

Coordenada em São Paulo → `br`; em Nova York → `us`; coordenada em nenhum dos dois → `OperationResult` failed com `code: 'geo_unmatched'`.

### Referências

- `Strategy` type em `packages/core/src/strategies.ts:16`
- `OperationPolicy` em `packages/core/src/types.ts:78-87`
- Fluxo `execute()` em `packages/core/src/router.ts:42-121`
- Turf `booleanPointInPolygon`: https://turfjs.org/docs/api/booleanPointInPolygon
- Precedente de versão quebrada: task-004 (`StrategyName` ganhou `'priority_race'`)
