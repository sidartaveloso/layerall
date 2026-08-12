## [2.0.1](https://github.com/sidartaveloso/layerall/compare/v2.0.0...v2.0.1) (2026-08-12)


### Bug Fixes

* **core:** geo_rule fallbackStrategy failover cascateia entre providers sobrepostos ([f9035a0](https://github.com/sidartaveloso/layerall/commit/f9035a0a5868b94f34d5c0a94ce8c2f5c34ab5b4))

# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado no [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [2.0.0](https://github.com/sidartaveloso/layerall/compare/v1.0.0...v2.0.0) (2026-08-07)

### ⚠️ BREAKING CHANGES

- `OperationName` deixa de ser um union fechado. `Record<OperationName, X>` e switch/pattern-match exaustivos no código do consumidor precisam virar `Record<CanonicalOperation, X>` ou `Partial<Record<OperationName, X>>`.

### Features

- **core:** `OperationName` aceita nomes de operação customizados (`consulta-placa`, `reverse`, …) sem cast, via `'create' | 'send' | 'status' | 'cancel' | (string & {})` — alinha o código ao contrato já documentado nos guias.
- **cli:** novo tipo local `CanonicalOperation` tipa os defaults do `init` (`create`, `send`, `status`, `cancel`); `validatePolicy` continua aceitando operações customizadas.
- **sdk:** o re-export de `OperationName` propaga o union ampliado.
- **docs:** nota "Nomes de operação customizados" em `strategies.md`; tutoriais atualizados para `@layerall/core@^2.0.0`.

### Documentação

- [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
- [Versionamento Semântico](https://semver.org/lang/pt-BR/)
