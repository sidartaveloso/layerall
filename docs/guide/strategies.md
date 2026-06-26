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
  baseLatency: 180,  // ms esperados
  health: 0.96,       // 96% de saúde
  failRate: 0.04,     // 4% de falha
  // ...
};
```

## `failover`

Tenta os provedores **na ordem da policy**. Se o primeiro falhar, tenta o segundo, e assim por diante.

```ts
{ "strategy": "failover", "failover": true }
```

**Quando usar:** quando você tem um provedor preferido (mais barato, melhor qualidade) e quer fallback apenas em caso de indisponibilidade.

## Combinando estratégias

Você pode usar estratégias diferentes por operação na mesma policy:

```ts
{
  "operations": {
    "create": { "strategy": "round_robin", "failover": true },
    "send":   { "strategy": "load_balance", "weights": { "a": 50, "b": 50 } },
    "status": { "strategy": "most_fast" },
    "cancel": { "strategy": "failover" }
  }
}
```

E o cliente ainda pode fazer override:

```ts
// mesmo que a policy diga round_robin, este request específico usa failover
await router.execute('create', payload, { strategy: 'failover' });
```