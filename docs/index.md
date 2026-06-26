---
layout: home
hero:
  name: LayerAll
  text: Um SDK. N provedores. Uma engine.
  tagline: Camada agnóstica de orquestração/abstração para múltiplas APIs/SDKs. Roteamento inteligente, fallback automático, observabilidade.
  actions:
    - theme: brand
      text: Começar
      link: /guide/getting-started
    - theme: alt
      text: Ver tutorial AllGeo
      link: /tutorials/allgeo
features:
  - title: Trabalhe com um contrato
    details: Crie, envie, consulte, cancele — a interface é sempre a mesma. Quem roteia para cada provedor é o LayerAll.
  - title: 4 estratégias plugáveis
    details: round_robin, load_balance, most_fast, failover. Troque sem mudar código do cliente.
  - title: Resiliência nativa
    details: Retries com backoff, circuit breaker, fallback automático por operação. Pronto para produção.
  - title: Observabilidade
    details: Hook de observer para métricas, logs e tracing em cada tentativa.
  - title: CLI para config
    details: layerall init gera sua policy.json. layerall validate checa o schema.
  - title: SDK do cliente incluso
    details: '@layerall/sdk — minimalista, tipado, compatível com qualquer backend LayerAll.'
---