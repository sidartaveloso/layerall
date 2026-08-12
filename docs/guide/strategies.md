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

## `fan_out`

Dispara **todos os provedores elegíveis em paralelo** e espera **todos** resolverem (sucesso ou falha) — ao contrário de `priority_race`, nenhum provider é cancelado por causa de outro; não existe "vencedor".

```ts
{ "strategy": "fan_out", "timeoutMs": 4000 }
```

O resultado normal (`OperationResult.result`/`provider`) não faz sentido quando há vários providers — em vez disso, `OperationResult.results` traz um `FanOutEntry` por provider, na ordem da policy:

```ts
interface FanOutEntry<TResult> {
  provider: string;
  status: 'succeeded' | 'failed';
  result?: TResult;
  error?: OperationError;
  latencyMs: number;
}
```

- `OperationResult.status` é `'succeeded'` se **pelo menos um** provider teve sucesso, `'failed'` (código `all_failed`) só quando todos falham.
- `OperationResult.provider` é a lista de ids dos providers disparados, separados por vírgula (ex.: `"pontual,sespes"`).
- Timeout por provider: mesmo mecanismo do `priority_race` (`Provider.timeoutMs`/`timeoutMs` da operação) — mas um provider que estoura vira só uma entrada `failed` em `results`, sem afetar os outros.
- O Router **não mescla** os `result`s de providers diferentes — isso é específico de domínio (ex.: dedup por chave de negócio) e fica por conta de quem chama, iterando `results`.

**Quando usar:** quando a resposta certa é a **combinação** de várias fontes (ex.: "todos os veículos cadastrados nos dois sistemas"), não uma escolha entre elas. Se você precisa de UM resultado (mais rápido, mais confiável, primeiro disponível), use `priority_race`/`failover`/`most_fast` em vez disso.

### Consumindo o resultado: `isFanOutResult` e `mergeFanOut`

`OperationResult.results` só existe quando a strategy resolvida é `fan_out` — mas isso é uma informação de **runtime** (a strategy normalmente vem da policy, não da chamada), então o TypeScript não tem como saber isso sozinho no tipo de retorno de `execute()`. Em vez de fingir que dá, o pacote exporta uma type guard honesta:

```ts
import { isFanOutResult } from '@layerall/core';

const result = await router.execute('listar', payload);

if (isFanOutResult(result)) {
  // aqui `result.results` não é mais opcional — TS já sabe
  for (const entry of result.results) {
    console.log(entry.provider, entry.status);
  }
}
```

Pra combinar os resultados bem-sucedidos numa resposta só, `mergeFanOut` — um helper pequeno e composable, **não** um parâmetro de `execute()` (ver [ADR sobre por que não](#por-que-nao-um-parametro-de-merge) mais abaixo):

```ts
import { mergeFanOut } from '@layerall/core';

const veiculos = mergeFanOut(result, successful => {
  const porPlaca = new Map<string, Veiculo>();
  for (const lista of successful) {
    for (const v of lista.data) porPlaca.set(v.placa, v);
  }
  return [...porPlaca.values()];
});
```

`TMerged` (o tipo de `veiculos` acima) é **inferido** do retorno da função passada — nunca precisa anotar generic na mão. `mergeFanOut` lança um erro claro se `result` não veio de uma operação `fan_out` (evita mesclar silenciosamente algo que não devia).

#### Por que não um parâmetro de merge? {#por-que-nao-um-parametro-de-merge}

Cogitamos adicionar `merge?: (entries) => T` direto em `OperationRequestOptions`. Descartado por três motivos:

1. **Só faz sentido pra uma strategy.** Passado com `failover`/`round_robin`, seria ignorado silenciosamente — um parâmetro que só é válido em combinações específicas é o tipo de estado que dá pra evitar representando de outro jeito.
2. **Já é trivial de fazer por fora** — uma função de uma linha sobre `results`. Empurrar isso pra dentro de `execute()` não reduz complexidade, só muda onde ela mora.
3. **Quebraria a simetria com `geo_rule`/`priority_race`**, que nunca tocam no `result` — só normalizam o envelope. `fan_out` fazendo diferente criaria uma exceção sem motivo forte.

`isFanOutResult`/`mergeFanOut` resolvem a mesma necessidade como funções compostas de fora, sem adicionar estado inválido ao tipo de `execute()`.

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
