# ADR 0005 — Registro de cobertura total das APIs (Fase 5)

- Status: aceito (implementacao em PR draft para revisao).
- Data: 2026-07-15.
- Contexto: apos [[0004-public-season-episode-routes]] (Fase 4), o repositorio ja
  tem uma superficie real de integracoes (TMDB, Gemini offline, RapidAPI ratings e
  streaming, discovery, mais stubs/roadmap). Faltava um **registro auditavel** que
  classifique cada endpoint e cada campo por estado de cobertura, ancorado no
  codigo, para que a auditoria final (Fase 17) nao tenha item sem classificacao e
  para que qualquer drift entre o registro e o codigo quebre o CI. A Fase 5 nao
  adiciona feature de produto nem chama API externa: so cataloga, valida e trava.

## Decisao

### Registro (`docs/api-coverage/`)
- `providers.yaml` — catalogo dos **provedores tecnicos** (`provider_api`).
  Fontes editoriais de rating (`imdb`, `rotten_tomatoes`, `metacritic`,
  `letterboxd`, `filmaffinity`) **nunca** aparecem aqui (invariante 2); vivem em
  `@screena/config` como `rating_source`.
- `endpoints.json` — toda capacidade/endpoint (implementado, com ancora de
  codigo, **ou** exigido pelo plano mas nao implementado), cada um com **1** dos 8
  estados.
- `fields.json` — grupos de campo (normalizados, raw capturados, bloqueados por
  licenca/privacidade, N/A), com a mesma disciplina de estado.
- `coverage-matrix.md` — visao humana derivada.
- `decisions.md` — semantica dos 8 estados e o "porque" de cada classificacao.

### Os 8 estados de cobertura (exatamente 1 por endpoint E por campo)
`raw_captured`, `normalized`, `public_ready`, `blocked_license`,
`blocked_privacy`, `blocked_plan`, `not_applicable` (com `justification`),
`deprecated` (com `superseded_by`). Semantica completa em `decisions.md`. Decisao
chave: capacidade **exigida pelo plano mas ainda nao construida** e
`not_applicable` com `justification` citando a fase de roadmap (`implemented:false`)
— a lacuna fica listada, nunca escondida.

### Comando `api:coverage` (quebra em drift)
- `pnpm api:coverage` -> `node scripts/audit/check-api-coverage.mjs`. Audit raiz,
  100% offline (sem rede/DB/deps), mesmo contrato de `audit:invariants`/
  `audit:render` (`exit 1` violacao, `exit 0` limpo, `exit 2` fatal). Logica pura
  em `scripts/audit/api-coverage-core.mjs` (+ tipos em `.d.mts`).
- O que quebra: estado invalido; `not_applicable` sem justificativa; `deprecated`
  sem substituto; `provider_api === rating_source` ou `provider_api` sendo uma
  fonte editorial (invariante 2); `worker_only !== true` (invariante 3); provider
  inexistente; **drift de ancora forward** (simbolo de `must_contain` sumiu do
  arquivo); **drift reverso** (metodo-endpoint `async get<X>(` num client
  enumerado sem entrada no registro).

### Validacao
- `tests/governance/api-coverage.test.ts` (Vitest, 12 checks): trava os 8 estados
  e as 5 fontes canonicas; prova que o registro **commitado** passa contra o
  codigo real (zero violacoes); e 8 casos negativos provando que o validador
  realmente pega cada drift/violacao de invariante.
- Step de CI (Linux) `Cobertura de API (drift do registry vs codigo)` roda
  `pnpm api:coverage` junto do cluster de audits.

## Consequencias e follow-ups
- Sem alteracao de schema/migrations. Zero API externa e zero Gemini (o registro e
  estatico; nao chama nada).
- Promocao de estado sensivel (`blocked_license` -> `public_ready`) continua
  **decisao humana de licenca** (invariante 6); o registro nao promove nada.
- Fica a base para as fases seguintes (F6-F13) ampliarem a cobertura real
  (normalizar append, ativar ratings/streaming/news, endurecer Gemini) — cada uma
  atualiza o registro e o gate acompanha.
- Campos puramente internos (ex.: `screen_score`) e drift de config de env
  (`SCREENA_*` vs `RAPIDAPI_*`) ficam **fora** do escopo de cobertura de API (ver
  `decisions.md` §9), tratados nas fases proprias.
