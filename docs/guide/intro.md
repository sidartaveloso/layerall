# Introdução

O **LayerAll** é uma camada agnóstica de orquestração para múltiplos provedores de um mesmo domínio (assinatura, pagamentos, mensageria, storage, LLMs, KYC…).

## Por que usar?

- Reduz lock‑in com múltiplos provedores atrás de um único SDK
- Melhor disponibilidade com fallback e circuit breaker
- Padroniza integrações de clientes

## Arquitetura

1. **Unificação** — um contrato estável mapeado para cada provedor
2. **Orquestração** — políticas configuráveis por operação/tenant
3. **Operação** — métricas, logs e webhooks normalizados

Veja [Estratégias](./strategies).