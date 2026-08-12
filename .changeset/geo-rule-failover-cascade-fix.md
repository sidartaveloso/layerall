---
"@layerall/core": patch
---

Corrige `geo_rule` com `fallbackStrategy: 'failover'`: regiões sobrepostas agora cascateiam de verdade entre os providers candidatos quando o primeiro falha, em vez de escolher deterministicamente só o primeiro e propagar o erro sem tentar o segundo. `selectGeoRule` já devolvia o pool inteiro corretamente — o bug estava em `geoRule()` delegando pra `strategies.failover(ctx)` (que devolve um único provider) em vez de repassar o pool inteiro pro `Router` cascatear, como já faz para `priority_race`.
