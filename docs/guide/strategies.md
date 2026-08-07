# Estratégias

A estratégia define **qual provedor será chamado** a cada requisição. A política pode definir uma estratégia diferente para cada operação, e o cliente pode fazer override por request.

## `round_robin`

Distribui o volume igualmente entre provedores elegíveis, em ordem cíclica.

```ts
{ "strategy": "round_robin" }
```

**Quando usar:** quando todos os provedores têm custo/qualidade similares e você quer balancear a carga.

## `load_balance`

Seleção ponderada aleatória. Quanto maior o `weight` do provider, mais tráfego ele recebe.

```ts
{ "strategy": "load_balance", "weights": { "providerA": 50, "providerB": 30, "providerC": 20 } }
```

**Quando usar:** quando você tem contratos com limites de requisição diferentes ou quer distribuir por capacidade contratada.

O peso pode vir de três lugares (por ordem de precedência):

1. `weights` na operação da policy (maior prioridade)
2. `Provider.weight` no objeto do provider
3. `Provider.capacity` como fallback
4. `1` se nada for definido

## `most_fast`

Escolhe o provedor elegível com **menor latência esperada**, considerando saúde e taxa de falha.

**Score = `baseLatency + (1 - health) × 280 + failRate × 420`**

Menor score vence. Um ruído aleatório evita que todos os requests caiam no mesmo provider (flapping).

**Quando usar:** quando a experiência do usuário final é prioridade — você quer a resposta mais rápida possível.

Configure `baseLatency`, `health` e `failRate` em cada Provider para a estratégia funcionar bem:

```ts
const providerA = {
  id: 'providerA',
  baseLatency: 180, // ms esperados
  health: 0.96, // 96% de saúde
  failRate: 0.04, // 4% de falha
  // ...
};
```

## `failover`

Tenta os provedores **na ordem da policy**. Se o primeiro falhar, tenta o segundo, e assim por diante.

```ts
{ "strategy": "failover", "failover": true }
```

**Quando usar:** quando você tem um provedor preferido (mais barato, melhor qualidade) e quer fallback apenas em caso de indisponibilidade.

## `geo_rule`

Roteia pela **região geográfica** da coordenada no payload. Cada regra carrega um `MultiPolygon` GeoJSON (padrão WGS 84); os vértices aceitam altitude `[lng, lat, alt]`.

```ts
{
  "strategy": "geo_rule",
  "geo": {
    "field": "location",
    "rules": [
      { "providers": ["br"], "multipolygon": { /* MultiPolygon GeoJSON */ } },
      { "providers": ["uav"], "multipolygon": { /* vértices com altitude */ } }
    ],
    "fallbackStrategy": "most_fast"
  }
}
```

- O payload entrega a coordenada em `payload.data[field]` como `[lng, lat, alt?]`.
- O ponto precisa estar no **footprint** do polígono. Região 3D (vértices com `alt`): a altitude do ponto precisa estar dentro da extensão vertical dos vértices.
- Várias regras casando → `fallbackStrategy` decide entre os providers (default `round_robin`).
- Nenhum match → erro `geo_unmatched`; coordenada inválida/ausente → erro `geo_bad_payload`.

**Quando usar:** provedores regionais (um por país/estado), ou geofencing com altitude (drones, corredores aéreos).

## `priority_race`

Dispara **todos os provedores elegíveis em paralelo** e retorna a primeira resposta de sucesso em **ordem de prioridade** (ordem no array da policy). Quando um provider de maior prioridade succeede, os demais são cancelados via `AbortController`.

```ts
{ "strategy": "priority_race", "timeoutMs": 4000 }
```

- Timeout por provider: `Provider.timeoutMs` (sobrescrito pelo `timeoutMs` geral da operação/request).
- Providers responsivos a `AbortSignal` são interrompidos de verdade no cancelamento.
- `Observer.onCancelled` é emitido com `reason`: `'superseded' | 'timeout' | 'aborted'`.
- Só falha quando todos falham → erro `all_failed`.

**Quando usar:** quando você quer a menor latência possível consultando todas as fontes ao mesmo tempo, aceitando o custo de chamar todas.

## Combinando estratégias

Você pode usar estratégias diferentes por operação na mesma policy:

```ts
{
  "operations": {
    "create": { "strategy": "round_robin", "failover": true },
    "send":   { "strategy": "load_balance", "weights": { "a": 50, "b": 50 } },
    "status": { "strategy": "most_fast" },
    "cancel": { "strategy": "failover" },
    "geolocalizar": { "strategy": "geo_rule", "geo": { "field": "location", "rules": [] } },
    "buscar": { "strategy": "priority_race", "timeoutMs": 3000 }
  }
}
```

E o cliente ainda pode fazer override:

```ts
// mesmo que a policy diga round_robin, este request específico usa failover
await router.execute('create', payload, { strategy: 'failover' });
```

## Nomes de operação customizados

O `OperationName` não é um union fechado: além dos 4 nomes canônicos
(`create`, `send`, `status`, `cancel`), o `Router` aceita qualquer string —
`consulta-placa`, `reverse`, `buscar`, o nome que fizer sentido pro seu domínio.
Os canônicos são apenas os defaults de autocomplete do editor e o conjunto
gerado pelo `init` do CLI; não são uma restrição da engine.

```ts
// sem cast, direto no editor
await router.execute('consulta-placa', { data: { placa: 'ABC1D23' } });
```
