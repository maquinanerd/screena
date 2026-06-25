# PHASE 1 — Database Plan (Screena)

> Plano aprovado para a Fase 1 (Banco de dados). Branch: `feat/fase-1-banco`.
> Escopo: schema PostgreSQL via Prisma + migration inicial + seeds + testes de
> governança. **Fora de escopo:** client TMDB, client Gemini, client de ratings,
> client de streaming, qualquer chamada externa, páginas públicas, integração de
> app, publicação automática.
>
> Fonte das decisões: revisão adversarial (integridade + governança) sobre o
> design por domínio. Este documento é a referência canônica da Fase 1; em
> conflito com ele, vence `CLAUDE.md`.

---

## 1. Decisões aprovadas (D1–D6)

| # | Decisão |
| --- | --- |
| **D1** | Referências polimórficas (`entity_type` + `entity_id`) mantidas na Fase 1, **sem FK de banco**, com **índice composto `(entity_type, entity_id)`** em todas as tabelas polimórficas e **rotina transacional de cleanup** documentada no worker. `entities` (supertipo) fica como evolução futura. |
| **D2** | **Não** criar `providers`/`platforms` agora. `watch_availability` guarda `provider_key` + `provider_name` como **texto** (sem FK) até a fase de streaming. |
| **D3** | `ProviderKind` aprovado, **espelhado em `@screena/config`** (`PROVIDER_KINDS`) e coberto por teste. |
| **D4** | `slugs` é a **única fonte autoritativa** de slug. `entity_translations.slug` **removido**. |
| **D5** | Restrições que o Prisma não expressa nativamente (CHECKs condicionais, índices únicos parciais, FK composta) entram via **SQL bruto** na migration. |
| **D6** | PK interna padrão = **`BigInt autoincrement`**. IDs externos (`tmdb_id`, `imdb_id`, `external_id`) ficam em colunas `@unique` próprias. |

## 2. Convenções de modelagem

- **Prisma:** modelos PascalCase singular + `@@map` para tabela snake_case plural; campos camelCase + `@map` para coluna snake_case.
- **PK:** `id BigInt @id @default(autoincrement())`, exceto tabelas-semente com chave natural (`languages.code`, `countries.code`, `rating_sources.key`, `api_providers.key`).
- **Referência polimórfica:** `entityType EntityType` + `entityId BigInt` + `@@index([entityType, entityId])`. Sem relação Prisma (integridade por aplicação — D1).
- **FK para sementes (governança no schema):** `languageCode → languages.code`, `countryCode → countries.code`, `ratingSource → rating_sources.key`, `providerApi → api_providers.key`. `rating_source` e `provider_api` são **colunas e FKs distintas para tabelas distintas** (invariante 2).
- **Default seguro:** tudo nasce no estado mais restritivo — `noindex`, `display_allowed=false`, `license_status=unknown`, `review_status=draft`, `status=draft`.
- **Frescor:** `created_at`, `updated_at`, e onde aplicável `last_synced_at`, `stale_after`, `fetched_at`, `published_at`, `decided_at`.

## 3. Enums (13)

`EntityType`(movie,tv,season,episode,person) · `ContentBlockType`(12) · `ContentSource`(ai,human,hybrid) · `ReviewStatus`(8) · `TranslationStatus`(6) · `IndexDecision`(index,noindex,draft,stale,blocked) · `JobType`(3) · `JobStatus`(7) · `LicenseStatus`(5) · `OfferType`(6) · `SyncStatus`(5) · `ValidationStatus`(passed,warnings,failed) · `ProviderKind`(data,ratings,streaming,ai,news).

`rating_source` e `provider_api` **não** são enums (FK para sementes). `rating_sources.scale` é inteiro que espelha `RATING_SCALES` de `@screena/config`.

## 4. Tabelas (24) e relacionamentos

```
SEMENTE/REFERÊNCIA: languages(code) · countries(code) · rating_sources(key) · api_providers(key,kind:ProviderKind) · source_licenses(id)
MÍDIA:              movies(id) · tv_shows(id) · seasons(id→tv_shows[Cascade], season_number) · episodes(id→seasons[Cascade] via FK composta; episode_number + season_id, SEM season_number) · people(id)
CRÉDITOS:           cast_members(id→people, [poly]) · crew_members(id→people, [poly])
IDENTIDADE/ROTAS:   entity_external_ids([poly]) · slugs([poly]→languages) · redirects(from_path uniq) · entity_translations([poly]→languages)
EDITORIAL/IA:       content_blocks([poly]→languages) · entity_writer_jobs([poly]→content_blocks?) · entity_writer_logs(→jobs)
RATINGS/LICENÇA:    external_ratings([poly]→rating_sources,→api_providers) · source_licenses
DISPONIBILIDADE/SEO: watch_availability([poly]→countries) · page_indexability_decisions([poly]→languages)
INFRA:              api_cache(→api_providers) · api_sync_logs(→api_providers)
```

**FKs reais:** `seasons→tv_shows`(Cascade); `episodes→seasons` via **FK composta `(season_id, tv_show_id) → seasons(id, tv_show_id)`** + `@@unique([id, tvShowId])` em `seasons` (impede `tv_show_id` divergir da season); `cast/crew→people`; `entity_writer_logs→entity_writer_jobs`; `entity_writer_jobs.result_block_id→content_blocks` (nullable); FKs para sementes.

**Normalização de `episodes` (correção do PR #1):** `episodes` armazena apenas `episode_number` e `season_id`; a **unicidade de episódio por temporada** é `@@unique([season_id, episode_number])`. `episodes` **NÃO armazena `season_number`** — o número da temporada é **derivado de `seasons.season_number` via `episodes.season_id`**. Isso elimina o risco de `episodes.season_number` divergir de `seasons.season_number` (dado redundante removido). A FK composta `(season_id, tv_show_id)` mantém apenas a denormalização controlada de `tv_show_id` (para query), garantindo que ele não divirja do show da season. Hierarquia: `tv_shows → seasons (season_number) → episodes (episode_number, season_id)`. Travado por `tests/governance/episode-no-season-number.test.ts`.

**Polimórficas (sem FK, app-enforced + índice composto):** cast_members, crew_members, entity_external_ids, slugs, entity_translations, content_blocks, entity_writer_jobs, entity_writer_logs, external_ratings, watch_availability, page_indexability_decisions.

## 5. Ordem de migration

1. `languages → countries → rating_sources → api_providers → source_licenses`
2. `people → movies → tv_shows`
3. `seasons → episodes`
4. `cast_members → crew_members → entity_external_ids → slugs → redirects → entity_translations`
5. `content_blocks → entity_writer_jobs → entity_writer_logs`
6. `external_ratings → watch_availability → page_indexability_decisions`
7. `api_cache → api_sync_logs`
8. **Hardening SQL bruto** (ver §6): CHECKs + índices únicos parciais.
9. Seeds (ver §7).

## 6. Database governance constraints not fully represented by Prisma

> Esta seção lista **toda invariante/integridade que o schema Prisma não trava
> sozinho** e que, portanto, é garantida por **SQL bruto na migration** e/ou por
> **teste de governança** + disciplina de aplicação (worker). É a lista de
> "pontos cegos do ORM" que precisam de defesa explícita.

### 6.1. CHECKs condicionais (SQL bruto na migration — D5)

| Tabela | CHECK | Invariante |
| --- | --- | --- |
| `content_blocks` | `source_type = 'human' OR (model_provider IS NOT NULL AND model_name IS NOT NULL)` | 8/13 (bloco de IA exige modelo) |
| `watch_availability` | `price IS NULL OR currency IS NOT NULL` | coerência financeira |
| `watch_availability` | `offer_type IN ('rent','buy') OR price IS NULL` | preço só em compra/aluguel |
| `redirects` | `from_path <> to_path` | sem auto-redirect/loop |
| `movies` / `tv_shows` / `people` | `imdb_id IS NULL OR imdb_id <> ''` | `''` não ocupa o slot `@unique` |

### 6.2. Índices únicos parciais (SQL bruto — Prisma `@@unique` não expressa `WHERE`)

| Tabela | Índice parcial | Garante |
| --- | --- | --- |
| `slugs` | `UNIQUE (entity_type, entity_id, language_code) WHERE is_canonical = true` | 1 slug canônico por entidade/idioma |
| `entity_writer_jobs` | `UNIQUE (entity_type, entity_id, language_code, job_type) WHERE status IN ('queued','claimed','running')` | 1 job ativo por alvo |
| `source_licenses` | `UNIQUE (source_key) WHERE provider_key IS NULL` | 1 política default por fonte (invariante 6) |

### 6.3. Integridade não travada pelo banco (aplicação + teste)

1. **Referências polimórficas (D1):** `entity_type+entity_id` não têm FK nem `ON DELETE CASCADE`. Integridade e limpeza de órfãos ficam por conta de uma **rotina transacional no worker** (ao remover uma entidade, apaga em cascata as linhas polimórficas por `(entity_type, entity_id)`). Alternativa registrada: tabela supertipo `entities` (FK+CASCADE reais ao custo de +1 join por leitura) — decisão humana futura.
2. **Invariante 2 (provider_api ≠ rating_source) na seed:** as FKs apontam para tabelas distintas, mas o **mesmo literal** passaria nas duas se existisse nas duas seeds. Travado por **teste de governança de disjunção** `api_providers.key ∩ rating_sources.key = ∅` (§7, teste).
3. **Escala por fonte:** `external_ratings.rating_scale` deve casar com `rating_sources.scale`, que deve espelhar `RATING_SCALES` de `@screena/config`. Sem CHECK cross-table na Fase 1 → **teste de governança** (§7).
4. **Gate de idioma (invariantes 7/9):** `page_indexability_decisions.decision='index'` exige `languages.index_default=true` **ou** regra explícita de revisão. Sem trigger no banco → **função-guarda pura** (`@screena/seo`) + **teste de governança**.
5. **Licença "o mais restritivo vence":** `license_status`/`display_allowed` existem em `source_licenses` (política), `external_ratings` e `watch_availability` (snapshots). O gate de render usa o **mais restritivo**; ao mudar `source_licenses`, as notas/ofertas afetadas devem ser remarcadas para revalidação. Regra de fronteira de render, não de schema.
6. **Rastreabilidade de hash:** `entity_writer_jobs.payload_hash`, `entity_writer_logs.input_hash` e `content_blocks.input_hash` são colunas independentes (snapshots append-only). A igualdade ponta-a-ponta é **asserção de aplicação** ao persistir o bloco, não constraint de banco.
7. **Mapa `block_type → value_block_type` (follow-up recomendado):** o vocabulário de `ContentBlockType` difere de `VALUE_BLOCK_TYPES` (`@screena/seo`). `value_blocks_count` deve ser computado por `countValueBlocks` (15 tipos), e um **mapa canônico** `block_type→value_block_type` (com teste) deve ser adicionado para o gate anti-thin contar corretamente. Documentado aqui; implementação na fase de páginas/SEO.

## 7. Seeds obrigatórios

- **languages:** `pt-BR {is_published=true, index_default=true}`; `en`, `es` `{false, false}`.
- **countries:** conjunto inicial (BR, US, GB, PT, ES, FR, DE, IT, MX, AR, CA, AU, JP).
- **rating_sources:** as 5 fontes com `scale` espelhando `RATING_SCALES` (imdb=10, rotten_tomatoes=100, metacritic=100, letterboxd=5, filmaffinity=10).
- **api_providers:** `tmdb`(data), `gemini`(ai), `imdb236`(ratings — provedor técnico das notas IMDb), `streaming_availability`(streaming). **Disjunto** de `rating_sources.key` (`imdb` nunca é provider).
- **source_licenses:** uma linha conservadora por fonte (`license_status=unknown`, todos `*_allowed=false`, `requires_attribution/linkback=true`). Nada exibível até revisão humana.
- **Sem** seed de catálogo real (sem TMDB). Sem pirataria.

## 8. Checklist de aceite da Fase 1

- [ ] Prisma configurado em `packages/db` (datasource PostgreSQL via `env`, generator client).
- [ ] `schema.prisma` com **24 tabelas + 13 enums**; `prisma validate` passa; migration inicial gerada.
- [ ] **Hardening SQL bruto** (§6.1, §6.2) aplicado na migration (CHECKs + índices únicos parciais + FK composta de `episodes`).
- [ ] Seeds criados: languages, countries, rating_sources, api_providers, source_licenses.
- [ ] **en/es nascem `draft`/`noindex` e NÃO podem ser indexáveis por padrão** — garantido por: defaults de coluna (`entity_translations.status=draft`, `index_status=noindex`; `languages.is_published/index_default=false`), função-guarda de idioma e teste de governança.
- [ ] **Teste de governança (item 4):** `page_indexability_decisions.decision='index'` proibido quando `language.index_default=false`, salvo regra explícita de revisão.
- [ ] **Teste de governança (item 5):** `api_providers.key` e `rating_sources.key` disjuntos.
- [ ] **Teste de governança (item 6):** `rating_sources` (seed) espelha `RATING_SCALES`.
- [ ] **Teste/default (item 7):** `external_ratings.display_allowed=false` e `watch_availability.display_allowed=false` por padrão.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit:invariants`, `pnpm audit:render` — **todos verdes**.
- [ ] **Zero** client TMDB/Gemini/ratings/streaming; **zero** chamada externa; **nenhuma** página pública; **nenhuma** integração de app; **nada** publicado automaticamente; render permanece puro.
- [ ] Trabalho na branch `feat/fase-1-banco`; merge para `main` só via PR com revisão humana (licença/indexação/publicação nunca automáticas).

## 9. Riscos residuais (monitorar)

- Órfãos polimórficos se a rotina de cleanup do worker falhar (mitigado por transação + índices compostos).
- Drift entre seed de `rating_sources`/`api_providers` e `@screena/config` (mitigado por testes de espelho e disjunção).
- `value_blocks_count` subcontar se a derivação usar só as 7 flags `has_*` em vez dos 15 tipos (mitigado pelo follow-up §6.3.7).
