# ADR 0013 — External Intelligence Product: ratings, streaming, licenças e Cinerie Score (Backend B)

- **Status:** proposto (Backend B / `feat/external-intelligence-product`) — **requer revisão humana de banco antes do merge**.
- **Data:** 2026-07-17.
- **Migration:** `packages/db/prisma/migrations/20260717120000_external_intelligence_product/migration.sql` (forward-only).
- **Invariantes tocadas:** 1 (IMDb ≠ Rotten Tomatoes), 2 (provider_api ≠ rating_source), 6 (sem licença clara não aparece), 8 (sem pirataria).
- **Contexto:** após [[0009-0011-external-data-intelligence-platform]] e
  [[0012-complete-catalog-platform]] (Backend A), existiam os modelos de ratings,
  streaming e licença, mas a operacionalização da **exibição governada** estava
  incompleta: `external_ratings` não tinha trigger fail-closed (só default de
  coluna), provedores de streaming eram string crua, e não havia o eixo "para que
  uso" nem esqueleto do Cinerie Score.

## Princípio central

Nada de terceiro nasce exibível. Toda exibição passa a exigir, **no banco** (não
só na aplicação), uma cadeia completa e verificável:

```
SourceLicense → DataUsageDecision → linha de dado (fingerprint + revisor) → display_allowed
```

Reutiliza o padrão já provado na Fase 2 (`watch_availability_display_guard`) em
vez de criar uma segunda plataforma de governança. `validateRating` (schema puro)
só protege quem passa por ele; os triggers protegem também script, seed e `psql`.

## Decisões

### 1. `data_usage_decisions` — o eixo `use_case`

`source_licenses` responde "o que a fonte permite por content_type/território";
não responde "para QUE USO", "pode armazenar?" nem "pode derivar?". Esses três
eixos separam auditoria de exibição de Cinerie Score. A tabela é **filha** da
licença (FK real), não uma cópia — e o guard `data_usage_decisions_guard` impõe o
**teto da licença-mãe**: uma decisão nunca concede mais que a licença vigente
permite (senão o eixo use_case viraria porta dos fundos para lavar dado sem
licença). CHECKs formam a escada: `display ⇒ storage`, `derivative ⇒ storage`,
`display ⇒ stage=approved_for_display`, `revoked ⇒ nada`.

Não duplica `SourceLicense`: reusa `territory`, `policy_version`, `decided_by` e
o histórico `is_current`/`supersedes_id`, e acrescenta só o que faltava.

### 2. `external_ratings` — dois triggers

- `external_ratings_integrity_guard` (toda linha): invariantes 1 e 2 viram lei do
  banco — provider ≠ source, escala da fonte, valor na escala, votos ≥ 0,
  cross-label, Tomatometer⇒critics/Popcornmeter⇒audience.
- `external_ratings_display_guard` (fail-closed): hash do payload aprovado = atual
  ("mudança revoga"), revisor humano, score_type classificado, licença permissiva,
  atribuição/linkback, e `DataUsageDecision` vigente de `rating_display` **da
  licença daquela fonte** (senão uma decisão do Metacritic exibiria IMDb).

Colunas novas: `score_type`, `requires_attribution/linkback`, `reviewed_at/by`,
`approved_payload_hash`, `stale_after`, `data_usage_decision_id`. Fingerprints
`external_rating_{identity_key,payload_fingerprint}_v1` (pgcrypto, computados no
banco, nunca reimplementados em TS).

### 3. `watch_providers` / `watch_provider_aliases`

Identidade canônica de plataforma (não confundir com `api_providers`, fornecedor
técnico — invariante 2). Unique `(provider_api, external_key)` no alias. Exibir
oferta passa a exigir provedor canônico resolvido **por alias** (nunca pelo nome)
+ decisão da licença daquele provedor (`source_key = slug`). Backfill seguro:
`provider_key` nunca derivado de `provider_name`; `provider_api` fantasma vira
`NULL` antes do `ADD CONSTRAINT` (FK nova); nenhuma linha apagada.

### 4. Cinerie Score — bloqueado por decisão

`cinerie_score_calculations` (histórico versionado, `inputs_hash`, CHECK
calculated⊻blocked) + trigger `cinerie_score_display_guard` (sem decisão vigente de
`cinerie_score_display` com `derivative_allowed`, o banco recusa
`screen_score_display=true`). Engine `@screena/cinerie-score` **sem fórmula**:
`PRODUCTION_FORMULA_REGISTRY` vazio, resultado `blocked_by_decision`. A fórmula é
decisão humana pendente ([[../product/cinerie-score-decision]]). Colunas legadas
`screen_score*` preservadas; "Screen Score" nunca aparece ao usuário.

### 5. Camada pura + CLI + read path

- `@screena/config`: `RATING_STALE_POLICY` versionada, `DATA_USAGE_CASES`,
  `RATING_SCORE_TYPES`.
- `@screena/schemas`: `evaluateRatingFreshness` (relógio da leitura — o trigger é
  a trava de escrita; decisão que expira pelo tempo só a leitura enxerga).
- `@screena/public-contracts`: `RatingsPayload`/`StreamingPayload`/
  `CinerieScorePayload` + validadores que recusam nota reescalada, preço sem
  moeda, link não-HTTPS, `available:false` com número.
- `pnpm ratings` (sample/sync/review/promote/revoke): escrita dry-run por default,
  `--confirm` exige `--reviewer`, lote ≤ 20, exit code próprio para governança.
- `apps/web/src/server/entity-ratings.ts`: read path server-only que revalida
  vigência + frescor. **Não ligado a nenhuma página** — mudança visual é separada.
- 9 métricas (`ratings_*`, `streaming_*`, `cinerie_score_*`), todas nascendo em 0.

## Impacto sobre dados existentes

Zero linha apagada. Toda coluna nova é nullable ou tem default. Backfill
fail-closed revoga o que estivesse exibido sem a cadeia nova — no-op factual
(produção tem 0 ratings e 0 ofertas promovidas). Validado em PostgreSQL 16
efêmero: Cenário A **45/45**, Cenário B (upgrade) **23/23**, stores **11/11**,
`validate:external-intelligence-product` **45/45** — cada trava provada nos dois
sentidos.

## O que NÃO afirma

- Não decide nenhuma licença nem fórmula (ambas humanas).
- Não ativa ratings/streaming/Cinerie Score em produção — nenhuma chamada real.
- Não altera o frontend visual.
- Não emite `AggregateRating` de terceiro sem escopo/licença/revisão.

## Dois bugs corrigidos no caminho

- `watch-store`: revogação usava `web_url` antigo → sync abortava com exceção em
  vez de revogar. Provado nos dois sentidos (check 11 do `validate:stores`).
- `validate-real-postgres`: contagem de tabelas/enums era literal duplicando a
  lista; agora deriva de `EXPECTED_TABLES.length`, com check bilateral.

## Adendo — revisão adversarial (2026-07-17, pré-merge)

Uma revisão adversarial independente da PR #74 encontrou e corrigiu, ainda em
draft (checks 46-51 do `validate:external-intelligence-product` + testes puros
cobrem cada item nos dois sentidos):

- **A1 (P1)** — a supersessão/revogação da licença não derrubava exibições: os
  display guards checavam a decisão mas não `is_current`/`license_status`/
  `display_allowed` (e `score_allowed`, ratings) da **licença-mãe**, e os read
  paths não a consultavam. Agora os guards exigem a licença vigente e exibível,
  `entity-ratings` revalida a cadeia inteira em memória e `entity-watch` filtra
  decisão vigente/válida + licença vigente no `where`.
- **A2 (P1)** — decisão de `rating_display` com território ≠ BR era selecionada
  e autorizava exibição no site BR (licença territorial extrapolada). Store e
  read path agora só aceitam `territory ∈ {NULL, 'BR'}`.
- **A3 (P2)** — sync sem mudança congelava `fetched_at` ⇒ a nota expirava da
  vitrine mesmo re-confirmada. O branch unchanged renova
  `fetched_at`/`stale_after` sem bumpar `updated_at` (SQL bruto com ISO +
  `AT TIME ZONE 'UTC'` — bindar `Date` em raw desloca o valor fora de UTC).
- **A4 (P2)** — `expectViolation` aceitava qualquer erro como "barrado" (erros
  Prisma começam com `\n` ⇒ detail vazio). Agora exige padrão esperado;
  "barrado pelo motivo errado" é FALHA.
- **A5 (P2)** — `pnpm ratings sample/sync` não executava (redirecionava com
  exit=usage). Agora delega por subprocesso ao entrypoint dedicado (caminho de
  rede único), repassando o exit code.
- **A6 (P2 / questão 6.2)** — `raw/recognized/normalized` descrevem o dado, não
  uma decisão; CHECK restringe `data_usage_decisions.stage` aos 4 estados
  decisórios (o enum permanece como vocabulário do workflow).
- **A7 (P2 / questão 6.1)** — `policyVersion` (jurídico) selecionava a fórmula;
  id legal renovado bloquearia o score, e um id coincidente trocaria o
  algoritmo em silêncio. O engine passa a usar `approvedFormulaVersion`,
  campo separado.
- **A8 (P2)** — `cinerie_score_calculations` ganhou a FK composta para
  `entities` (mesma disciplina das demais tabelas polimórficas).
- **A10 (P2)** — o Cenário B aplicava as migrations posteriores à Fase 2 FORA
  DE ORDEM (antes dela); a FK do A8 expôs. O cenário agora remove Fase 2 +
  posteriores do primeiro deploy e as aplica em ordem no segundo — o upgrade
  genuíno de produção, com a migration do Backend B rodando sobre dados
  populados.
