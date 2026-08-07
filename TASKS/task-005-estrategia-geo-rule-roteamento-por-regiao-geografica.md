# Task 005 — Estratégia `geo_rule`: roteamento por região geográfica

Status: pending
Type: feat
Assignee: Sidarta Veloso
Priority: medium

## Description

Adicionar a estratégia `geo_rule` ao `@layerall/core`: roteamento por região geográfica. A estratégia lê a coordenada `[lng, lat, alt?]` do payload, testa contra as `GeoShape` GeoJSON configuradas no `OperationPolicy` e seleciona o provider da região. Em `area`, o footprint 2D decide; em `volume`, o footprint 2D **mais a faixa de altitude** decidem (volume real). Quando mais de uma regra casa com a coordenada, a escolha final é delegada a uma `fallbackStrategy` configurável, compondo com as estratégias já existentes.

### Comportamento esperado

1. `geoRule(ctx)` lê `ctx.payload.data[ctx.geo.field]` como `[lng, lat, alt?]` (ordem GeoJSON, altitude em metros)
2. Testa cada regra em ordem do config:
   - `area` → `booleanPointInPolygon` do Turf (suporta multipolygon e buracos)
   - `volume` → mesmo footprint **e** `alt` dentro de `[minAltitude, maxAltitude]` (borda ausente = aberta)
3. Hit único → retorna o provider da regra (se elegível)
4. Multi-hit → providers das regras em ordem do config, sem duplicatas, filtrando só os `eligible` → `fallbackStrategy` decide o vencedor
5. Miss → erro `geo_unmatched`
6. Coordenada ausente/inválida → erro `geo_bad_payload`
7. Ponto dentro do footprint de uma `volume`, mas payload sem `alt` → erro `geo_bad_payload` (não dá para avaliar a dimensão vertical)
8. Guarda de recursão: `fallbackStrategy` nunca é `geo_rule`

### Discriminated union da seleção

A lógica pura expõe o resultado como união discriminada exaustiva:

```ts
type GeoRuleOutcome =
  | { kind: 'hit'; provider: Provider }
  | { kind: 'fallback'; pool: Provider[] }
  | { kind: 'unmatched' }
  | { kind: 'bad_payload' };
```

Cada regra carrega uma `GeoShape` — também união discriminada. `area` é o footprint 2D; `volume` adiciona a dimensão vertical:

```ts
type GeoShape =
  | { kind: 'area'; multipolygon: MultiPolygon }
  | { kind: 'volume'; multipolygon: MultiPolygon; minAltitude?: number; maxAltitude?: number };
```

`selectGeoRule(ctx)` é pura e retorna `GeoRuleOutcome`. O switch sobre `kind` é exaustivo (o compilador garante a cobertura). `geoRule` é o adaptador que mapeia:

- `hit` → retorna o provider
- `fallback` → `strategies[fallbackStrategy](subCtx)` sobre o sub-pool
- `unmatched` / `bad_payload` → lança `GeoRuleError` com `code` discriminado

## Tasks

### 1. Testes primeiro (TDD — red/green)

- [ ] `selectGeoRule` com ponto dentro do footprint de `area` → `{ kind: 'hit', provider }`
- [ ] ponto fora de todas as regras → `{ kind: 'unmatched' }`
- [ ] coordenada ausente/inválida → `{ kind: 'bad_payload' }`
- [ ] coordenada fora da faixa (`lng` > 180 ou `lat` > 90) → `{ kind: 'bad_payload' }`
- [ ] multipolygon com buraco: ponto no buraco → `{ kind: 'unmatched' }`
- [ ] `volume`: ponto no footprint e `alt` dentro da faixa → `{ kind: 'hit', provider }`
- [ ] `volume`: ponto no footprint, `alt` abaixo de `minAltitude` → não casa (segue para a próxima regra)
- [ ] `volume`: ponto no footprint, `alt` acima de `maxAltitude` → não casa
- [ ] `volume` com `minAltitude` ausente → aceita qualquer altitude acima do chão
- [ ] `volume`: ponto no footprint mas payload sem `alt` → `{ kind: 'bad_payload' }`
- [ ] `volume` com `minAltitude` e `maxAltitude` ausentes → `{ kind: 'bad_payload' }` (config inválida, volume exige ao menos uma borda)
- [ ] `volume` com `minAltitude` > `maxAltitude` → `{ kind: 'bad_payload' }`
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
      shape: GeoShape;
    }>;
    fallbackStrategy?: StrategyName;
  }
  ```
- [ ] `GeoShape = { kind: 'area'; multipolygon: MultiPolygon } | { kind: 'volume'; multipolygon: MultiPolygon; minAltitude?: number; maxAltitude?: number }`
- [ ] Type guard `isGeoShape(value): value is GeoShape` (volume exige ao menos uma borda; `minAltitude` ≤ `maxAltitude`)
- [ ] `GeoCoordinate = [lng: number, lat: number, alt?: number]` (tupla nomeada)
- [ ] Type guard `isGeoCoordinate(value): value is GeoCoordinate` com faixa de lng/lat e altitude em metros
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
- `GeoShape` discrimina `area` de `volume` no próprio tipo: a avaliação de altitude só existe no braço `volume`, e o switch exaustivo obriga decidir o que cada `kind` faz. `minAltitude`/`maxAltitude` opcionais codificam bandas abertas sem estado inválido no tipo.
- `GeoErrorCode` é a fonte única dos códigos de erro propagados ao `OperationResult`, evitando strings soltas.
- A coordenada é tipada como `GeoCoordinate = [lng: number, lat: number, alt?: number]` (tupla nomeada), nunca objeto `{ lat, lng }`.

### Sem comentários

Código deve ser auto-documentado: nomes precisos e tipos expressivos no lugar de comentários. Se uma parte precisa de comentário para ser entendida, refatorar até o nome/tipo carregar o significado. Exemplos de código nesta task seguem essa regra.

### Sistema de coordenadas

GeoJSON (RFC 7946) já padroniza o sistema: **WGS 84 (EPSG:4326)**, posição `[lng, lat, alt?]`, e o padrão proíbe membro `crs`. Não inventamos convenção nem config — a estratégia sempre recebe WGS 84.

- O payload entrega a coordenada em `ctx.payload.data[field]` como `[lng, lat, alt?]`; o footprint `[lng, lat]` é passado direto ao `booleanPointInPolygon` sem conversão.
- Faixa válida: `lng` em [-180, 180] e `lat` em [-90, 90]. Fora da faixa → `{ kind: 'bad_payload' }`.
- Altitude e faixas verticais em **metros** (unidade do eixo z do GeoJSON).
- O footprint é testado com Turf (planar). A dimensão vertical é avaliada no próprio core: `alt >= (minAltitude ?? -Infinity) && alt <= (maxAltitude ?? +Infinity)`. O volume resultante é um prisma vertical sobre o footprint — o mesmo modelo de geofencing aéreo/drones da indústria (ex.: FAA/DJI usam footprint 2D + faixa vertical).
- Sem nova dep para 3D: a verificação vertical é aritmética; volume real não exige lib de geometria 3D.

### Exemplo de config

```ts
const router = new Router({
  providers: {
    br: { id: 'br', invoke },
    us: { id: 'us', invoke },
    uav: { id: 'uav', invoke },
  },
  policy: {
    tenants: {
      default: {
        providers: ['br', 'us', 'uav'],
        operations: {
          create: {
            strategy: 'geo_rule',
            geo: {
              field: 'location',
              rules: [
                { providers: ['br'], shape: { kind: 'area', multipolygon: brasilMultipolygon } },
                { providers: ['us'], shape: { kind: 'area', multipolygon: euaMultipolygon } },
                { providers: ['uav'], shape: { kind: 'volume', multipolygon: zonaDeVoo, minAltitude: 120, maxAltitude: 600 } },
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

Coordenada em São Paulo → `br`; em Nova York → `us`; dentro do footprint de `zonaDeVoo` a 300 m → `uav`; no mesmo footprint a 1.000 m (acima de `maxAltitude`) → não casa; em nenhuma regra → `OperationResult` failed com `code: 'geo_unmatched'`.

### Referências

- `Strategy` type em `packages/core/src/strategies.ts:16`
- `OperationPolicy` em `packages/core/src/types.ts:78-87`
- Fluxo `execute()` em `packages/core/src/router.ts:42-121`
- Turf `booleanPointInPolygon`: https://turfjs.org/docs/api/booleanPointInPolygon
- Precedente de versão quebrada: task-004 (`StrategyName` ganhou `'priority_race'`)
