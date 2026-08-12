---
"@layerall/core": minor
---

Adiciona a strategy `fan_out`: dispara todos os providers elegíveis em paralelo e espera todos resolverem (sucesso ou falha), sem cancelar ninguém — ao contrário de `priority_race`, que corre pra pegar o primeiro sucesso e cancela o resto. `OperationResult.results` (novo campo opcional, `FanOutEntry[]`) traz o desfecho de cada provider, na ordem da policy; `status`/`provider` no topo resumem o conjunto (`succeeded` se pelo menos um provider teve sucesso). O Router não mescla os `result`s entre si — isso é específico de domínio e fica por conta de quem chama. `fan_out` também funciona como `fallbackStrategy` de `geo_rule`, via a mesma delegação genérica já usada por `most_fast`/`round_robin`.
