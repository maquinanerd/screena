# ADR 0002 — Hardening do schema e da governança de dados (Fase 2)

- **Status:** proposto (Fase 2 / `feat/data-governance-hardening-v2`) — **requer revisão humana de banco antes do merge**.
- **Data:** 2026-07-15
- **Migration:** `packages/db/prisma/migrations/20260715120000_data_governance_hardening/migration.sql` (forward-only).
- **Invariantes tocadas:** 2 (RatingSource ≠ ApiProvider), 5/6 (indexabilidade/licença), 9 (publicação editorial).

## Contexto

A Auditoria 360 apontou 5 lacunas estruturais de banco. Esta fase as resolve com
migration **forward-only**, backfills **idempotentes** e testes em **PostgreSQL 16
efêmero** (dois cenários: do zero e sobre estado anterior). Nenhum design público
muda; o WIP original foi transportado por patch para um worktree limpo baseado na
`main` pós-Fase 1 (`e33f284`) e concluído aqui.

## Decisões, antes → depois e alternativas rejeitadas

### 1. Referências polimórficas (§13) — tabela de registro `entities`

- **Antes:** `(entity_type, entity_id)` espalhado em 12 tabelas **sem FK**;
  integridade dependia de "limpeza de órfãos no worker".
- **Depois:** tabela fina `entities (entity_type, entity_id)` (PK composta),
  **mantida por triggers** de INSERT/DELETE nas 5 tabelas-raiz
  (movies/tv_shows/seasons/episodes/people); toda tabela polimórfica ganha
  **FK composta** `(entity_type, entity_id) → entities` (`ON DELETE RESTRICT`).
- **Backfill seguro:** órfãos são **copiados para `entity_reference_orphans`
  (quarentena auditável) ANTES de removidos**; a FK entra `NOT VALID` (lock
  breve, sem scan) e depois `VALIDATE CONSTRAINT` (ShareUpdateExclusive, não
  bloqueia leitura/escrita).
- **Alternativa rejeitada:** coluna genérica sem integridade (permite órfãos —
  proibido por §13); FK direta por-tipo em cada tabela (explodiria o schema e
  não cobre o caso polimórfico de forma uniforme).
- **Impacto de comportamento (documentado + testado — check 21):** apagar uma
  entidade-raiz que ainda tem dependente polimórfico é **RESTRINGIDO** (erro).
  É integridade por design (não orfana filhos). O sistema é upsert-based;
  deleções são raras e devem remover os filhos primeiro.

### 2. `PageIndexabilityDecision` — decisão vigente inequívoca + histórico (§9)

- **Antes:** sem garantia de "1 decisão corrente" por entidade/idioma; histórico
  ambíguo.
- **Depois:** `is_current` (bool) + **índice único PARCIAL** `WHERE is_current`
  sobre `(entity_type, entity_id, language_code)` — impede duas vigentes.
  `supersedes_id` (auto-relação) preserva a cadeia histórica; `policy_version`,
  `decision_origin`, `decided_by` versionam a decisão. **Nenhuma linha é apagada**.
- **Backfill:** `ROW_NUMBER()` por grupo (mais recente por `decided_at`/`created_at`)
  marca 1 vigente; o índice parcial só é criado **depois** de normalizar.
- **Troca atômica** (check 34): `UPDATE atual→false` + `INSERT novo→true` numa
  transação; o índice parcial nunca vê duas vigentes.
- **Alternativa rejeitada:** convenção só na aplicação (§9 exige mecanismo
  estrutural); coluna `current` sem índice parcial (não impede concorrência).

### 3. `WatchAvailability` — chave natural + licença/atribuição + revisão (§10/§11)

- **Antes:** sem chave natural (o sync gerava duplicatas indefinidamente); sem
  licença/atribuição/revisão próprias.
- **Depois:** colunas `license_status`, `requires_attribution/linkback`,
  `attribution_text/url`, `reviewed_at/by`, `approved_payload_hash` (fingerprint
  do payload aprovado), + `web_url`/`package` (metadados; produtor: Fase 9).
  **Chave natural única** `(entity_type, entity_id, country_code, offer_type,
  COALESCE(provider_key, provider_name), COALESCE(quality, ''))`.
- **`provider_key` PERMANECE opcional (§11):** `null` é sinal legítimo de
  "provedor não identificado pela API" (guardrail de promoção trata como
  `missing-provider`). Backfill deriva `provider_key` do slug de `provider_name`
  só quando há nome utilizável; nunca inventa.
- **Estratégia da chave (§11 — avaliada, não presumida correta):** o fallback é
  `COALESCE(provider_key, provider_name)` — **não um sentinela fixo** que poderia
  colidir com dado real, e sim outra coluna real e distinguível. Duas plataformas
  diferentes sem `provider_key` (ex.: "Max" e "Prime Video") caem para o
  `provider_name` e **permanecem distintas** (checks 25/8-9). Ofertas idênticas
  colapsam (dedup desejado). Testado em ambos os cenários.
- **Dedup ANTES do índice único:** o gap exato é "duplicatas do sync"; criar o
  índice direto falharia. Um `ROW_NUMBER()` mantém 1 linha por chave natural
  **preservando a aprovação humana** (ordena `display_allowed DESC`, depois mais
  recente) e remove as redundantes (check 8, Cenário B).
- **Alternativa rejeitada:** `NOT NULL` em `provider_key` (destruiria o sinal
  `missing-provider`); sentinela impossível (desnecessário — o fallback já
  distingue); `package` na chave natural agora (sem produtor/semântica real —
  Fase 9 decide).

### 4. `SourceLicense` — relações verificáveis (RatingSource ≠ ApiProvider) (§12)

- **Antes:** `source_key`/`provider_key` como texto frágil; sem território,
  vigência ou tipo de conteúdo.
- **Depois:** `content_type` (enum `SourceLicenseContentType`), `rating_source_key`
  (**FK real → rating_sources**), `provider_key` (**FK real → api_providers**),
  `territory_code` (**FK → countries**), `valid_from/until`, `decided_by/at`.
  CHECKs: `content_type='rating'` exige `rating_source_key`; `rating_source_key ≠
  provider_key` (invariante 2 materializada). Chave natural
  `(source_key, content_type, COALESCE(provider_key,''), COALESCE(territory_code,''))`.
- **Backfill:** liga `rating_source_key = source_key` quando bate uma fonte real;
  anula `provider_key` órfão **antes** da FK.
- **Alternativa rejeitada:** manter strings livres (§12 exige relação verificável
  quando há entidade correspondente).

### 5. Publicação editorial (§14) — `articles`/`article_translations`

- **`articles`:** índice em `category` + CHECK `category`/`author_name` **não
  vazios** (com **backfill `'' → NULL` ANTES do CHECK** — normalizar antes de
  travar).
- **`article_translations`: decisão consciente de NÃO acoplar** `review_status`/
  `index_status`/`published_at` por CHECK. O admin
  (`editorial-action-policy.ts`) trata os três como decisões **independentes**
  (um revisor seta `index_status` isolado; `published_at` sobrevive à reversão
  para draft). Um CHECK acoplando-os quebraria o fluxo real. A publicação
  **fail-closed** já é garantida na camada de apresentação
  (`isPublishableArticle`: review + licença + display + slug + título +
  publishedAt), não por um CHECK de banco. "Normalize só quando houver ganho
  real de integridade" — este não seria seguro.

## Migration: forward-only, locks e rollout

- **Forward-only**, sem down migration. Correção futura = **nova migration
  corretiva** (convenção do repo).
- **Ordem segura:** backfill/quarentena/dedup **antes** de cada constraint;
  FK composta `NOT VALID → VALIDATE`; índices únicos **após** normalização.
- **Idempotente:** `ON CONFLICT DO NOTHING`, `WHERE IS NULL`, `IS DISTINCT FROM` —
  reaplicar sobre estado corrigido não altera nada.
- **Locks:** triggers e `ADD CONSTRAINT NOT VALID` tomam lock **breve** (sem
  scan); `VALIDATE` usa lock fraco. `CREATE UNIQUE INDEX` (não CONCURRENTLY) trava
  a tabela alvo — **aceitável agora** porque `watch_availability`/
  `source_licenses`/`page_indexability_decisions` estão vazias ou mínimas em
  produção (streaming/ratings/indexabilidade ainda não populam em massa). **Risco
  residual:** em escala futura, trocar por `CREATE INDEX CONCURRENTLY` numa
  migration não-transacional dedicada.
- **Rollout:** aplicar via `prisma migrate deploy` no job de release (Fase 14
  formaliza release separado do start da app). Nunca contra banco remoto nesta PR.

## Observabilidade

- `entity_reference_orphans` é **quarentena auditável**: após a migration,
  consultá-la mostra exatamente quais refs órfãs foram removidas (nada some em
  silêncio).
- `page_indexability_decisions` preserva histórico completo (auditável por
  `supersedes_id`/`is_current`).

## Validação (dois cenários PostgreSQL 16 efêmero)

- **Cenário A (do zero):** `db:validate:real` — **35/35** (migrate deploy + seed +
  35 checks: triggers, FK órfão, RESTRICT, dedup, decisão vigente, concorrência,
  território, CHECKs, troca atômica, colunas de governança).
- **Cenário B (upgrade sobre estado anterior):** `db:validate:upgrade` — **16/16**
  (aplica as 4 migrations anteriores, injeta dados legados sujos — órfão,
  duplicatas, `provider_key` nulo, 3 decisões históricas, licença sem link,
  `category=''` — aplica a Fase 2 e prova cada backfill sem perda).

## Impacto nos consumidores

- **Prisma Client:** ganha campos novos, todos **opcionais/`@default`** →
  código existente compila e roda sem mudança (build `@screena/web` verde;
  `validate:all` 118/118).
- **Novos:** modelo `Entity`, `entity_reference_orphans`, enum
  `SourceLicenseContentType`.

## Compatibilidade com fases futuras (contratos congelados)

- **Fase 3 (SEO fonte única):** deve ler a decisão **vigente** de
  `page_indexability_decisions` (`is_current = true`) como o fato persistido de
  indexabilidade. O contrato de `is_current`/`policy_version`/`decision_origin`
  está estável aqui.
- **Fase 9 (streaming):** popula `license_status`/atribuição/`reviewed_*`/
  `approved_payload_hash`/`web_url`/`package`; decide se `package` entra na chave
  natural ao modelar add-on/bundle com payload real.
- **Fase 10 (ratings):** usa `source_licenses.content_type` + `rating_source_key`
  (FK real) para separar fonte editorial de provedor técnico.

## Riscos residuais

1. `CREATE UNIQUE INDEX` não-concorrente (mitigado pelo baixo volume atual).
2. Deleção de entidade-raiz com dependentes agora é RESTRINGIDA (integridade por
   design; consumidores que deletam devem remover filhos primeiro).
3. Migration da licença de rating é **fail-closed**: uma licença `content_type=
   'rating'` sem `rating_source_key` válido aborta a migration (correto — não se
   deve ter licença de nota sem fonte real; dados de seed/sintéticos são válidos).
