# Screen — Diagnóstico Completo do Estado Atual (360°)

> **Documento diagnóstico. Nenhum código foi alterado.** Este relatório é a única
> escrita produzida pela auditoria. Ele descreve o estado real do produto Screen
> com base em evidências de código, schema, migrations, serviços, clientes,
> testes, CI, documentação, histórico Git e verificações leves do ambiente
> publicado.

---

## 1. Capa e snapshot

| Item | Valor |
| --- | --- |
| Marca pública | **Screen** (namespace técnico legado `@screena/*`) |
| Domínio canônico | `https://thescreen.media` |
| **SHA auditado** | `eedeba6c5832eac9df976d9e00e21d41c90823bc` (`origin/main`, `origin/HEAD`) |
| Título do commit auditado | `feat(data): streaming, ratings and Gemini entity intelligence platform (Fases 9–11)` |
| Plataforma TMDB (Fases 6–8) consolidada em | `665c45ecf0f268c8f9883ba37f727bcd30493be2` |
| Método de auditoria | Worktree detached em `E:/screena-wt/screen-current-state-audit` @ `eedeba6` |
| Data | 2026-07-16 |
| Banco consultado? | **Não** — sem acesso de leitura seguro estabelecido (ver §8/§10) |
| Ambiente publicado | `https://thescreen.media/pt/` responde **HTTP 200** (verificado por `curl -I`) |
| Modelos Prisma | 34 |
| Migrations | 6 (aditivas) |
| Arquivos versionados | 696 |
| Arquivos de teste | ~175 (85 em `tests/`, ~90 co-localizados em pacotes) |

### 1.1. Aviso crítico sobre o estado do checkout local

O diretório de trabalho do usuário (`e:\Área de Trabalho 2\Screnaa`) **NÃO** está em
`origin/main`. Ele está na branch **`feat/data-governance-hardening` @ `508fa72`**,
que **divergiu** de `main` no merge-base `af531ee` e **não contém as Fases 2–11**
(TMDB, streaming, ratings, Gemini). Evidência:

```
git merge-base --is-ancestor 508fa72 eedeba6  -> NO (divergente)
git rev-list --count eedeba6..508fa72         -> 7  (commits locais fora de main)
git rev-list --count 508fa72..eedeba6         -> 7  (commits de main fora do local)
merge-base                                    -> af531ee
```

Os 7 commits locais são apenas alinhamento de validadores + docs
(`fix(web): align X validator with total-indexing policy`,
`feat(web): add aggregator for discardable postgres validators`), mais um WIP
não commitado (4 arquivos modificados + a pasta de migration
`20260715120000_data_governance_hardening` untracked — **cujo mesmo nome já
existe e está commitado em `main`**). Este relatório audita **`origin/main`
(`eedeba6`)** — o produto real. O WIP local **não foi tocado, descartado ou
alterado**.

> **Correção de um rascunho anterior.** Este arquivo **substitui** um rascunho
> anterior (interrompido) que, por engano, auditou o commit **stale `508fa72`** em
> vez de `origin/main`. Aquele rascunho concluiu incorretamente, por exemplo, que
> "rotas de temporada/episódio **não existem**", que os models **`TmdbVideo`/
> `TmdbImage` não existem** e que o schema tem "24 tabelas" — tudo **falso** em
> `eedeba6` (as rotas de temporada/episódio existem desde a Fase 4; a mídia TMDB
> desde a migration `20260716120000`; o schema tem **34 models**). Isto demonstra na
> prática por que auditar o commit errado leva a conclusões erradas.

---

## 2. Resumo executivo

O Screen é hoje uma **fundação de backend entity-first avançada, offline-first e
fortemente governada**, com um **frontend público reduzido a um shell honesto** e
**quase nenhum dado real de catálogo em produção verificável**. A engenharia de
governança (invariantes travadas em testes, triggers de banco fail-closed,
separação `provider_api` ≠ `rating_source`, pureza de render) está num nível
raro de maturidade. O que falta é **o produto**: dados sincronizados, camada
pessoal (usuários/tracking/listas), busca, e ligação dos dados já modeláveis ao
render.

Diagnóstico de uma frase: **o Screen tem um chassi de plataforma de dados
excelente e um motor de governança de nível industrial, mas o tanque está
praticamente vazio (sem catálogo sincronizado em escala), metade do carro
(produto pessoal / Letterboxd-TV Time-Trakt) ainda não foi projetada, e o painel
(frontend) foi removido de propósito para ser reconstruído depois.**

**Sólido (IMPLEMENTED_AND_TESTED / real):**
- Schema PostgreSQL de 34 modelos com governança de nível industrial (CHECKs,
  índices únicos parciais, triggers, funções de fingerprint versionadas).
- Cliente TMDB tipado e testado; pipeline de ingestão offline (discovery, raw
  sync, promoção movie/tv/person, mídia, gêneros, checkpoints).
- Entity Writer offline completo com adapter Gemini real (gated por chave),
  validação anti-alucinação e persistência versionada.
- Camada SEO como fonte única de verdade (indexabilidade, redirects, sitemap
  paginado no banco, JSON-LD seguro).
- Rotas públicas para filmes/séries/temporadas/episódios/pessoas/notícias, com
  getters server-only puros e presenters puros.
- ~175 arquivos de teste + CI Linux com PostgreSQL efêmero rodando 18 passos.

**Piloto / offline-aguardando-chave (CLIENT_ONLY / IMPLEMENTED_NOT_WIRED):**
- Ratings via RapidAPI (Film/Show Ratings) — recognizer estrito, mas
  `display_allowed=false`, **nenhuma nota real gravada/exibida**.
- Streaming (Streaming Availability) — sync + promoção governada, mas
  `blocked_license`, **nenhuma oferta pública**.
- Gemini — adapter real, mas nenhum `content_block` gerado/semeado.

**Ausente (MISSING):**
- **Toda a camada pessoal**: usuários, auth, sessões, watchlist, listas,
  avaliações de usuário, reviews, diário, progresso por episódio, calendário,
  notificações, follows, atividade social (Letterboxd/TV Time/Trakt).
- **Busca** (nenhuma rota/índice).
- **Coleções/franquias, empresas, networks, keywords, títulos alternativos** como
  modelos próprios.
- **Screen Score algorítmico** (só coluna + gate + formatador).
- **RSSPRIME/MNScr/Payload CMS** (apenas README/roadmap).

**Bloqueado por decisão/licença (BLOCKED_*):**
- Exibição de qualquer rating ou oferta de streaming (decisão humana de licença).
- Publicação de idiomas en/es (`PUBLISHED_LOCALES`).

---

## 3. O que o Screen é hoje

**É de verdade:**
- Um **monorepo pnpm** maduro (Node 22, TS strict, ESM) com fronteiras limpas:
  `apps/web` (render puro), `apps/admin` (operacional), `packages/*` (config, db,
  schemas, seo, ui, types), `api-clients/*`, `services/*` (offline).
- Um **motor de governança de dados** que é o diferencial de engenharia:
  `provider_api` ≠ `rating_source` materializado como FKs para tabelas distintas;
  triggers de banco que tornam **impossível** exibir uma oferta de streaming sem
  revisão humana + licença (`watch_availability_display_guard`); registro de
  entidades (`entities`) mantido por trigger para integridade referencial
  polimórfica; histórico imutável de licença e de decisões de indexabilidade.
- Uma **plataforma de ingestão TMDB offline** real: descoberta por Daily ID
  Exports (com exclusão fail-closed de conteúdo adulto), raw sync com
  hash/idempotência, promoção para tabelas tipadas, normalizadores por tipo.
- Um **Entity Writer** offline completo (fila de jobs, seleção de prompt
  versionado, adapter Gemini com resiliência, validação anti-alucinação,
  persistência em `content_blocks` versionada, decisão de status).
- Uma **camada SEO** como fonte única de verdade, com indexabilidade calculada,
  sitemap paginado direto do banco, redirects e JSON-LD por tipo.
- Um **site publicado** (`thescreen.media`) servindo o shell em pt-BR (200 OK).

**É aspiracional (código/schema/doc, sem produto):**
- Ratings externos exibíveis, "onde assistir" exibível, Screen Score, notícias,
  e **toda a dimensão de produto pessoal** (o que faria o Screen um
  "tracker premium" no espírito Letterboxd/TV Time/Trakt).

**É scaffold/documentação:**
- `api-clients/imdb`, `api-clients/rotten_tomatoes`, `api-clients/kaso` (só
  README), `services/news-ingestion` (só README), workers Python (esqueletos),
  RSSPRIME/MNScr, Payload CMS.

**Superfícies com dados reais hoje:** essencialmente nenhuma comprovável — o seed
é **só de referência** (idiomas, países, fontes/provedores de rating, licenças
seguras); nenhum filme/série/pessoa é semeado. Em produção há um catálogo
mínimo (o site serve `/pt/`), mas **não foi possível verificar o volume/frescor
do banco de produção com segurança** (ver §8/§10).

---

## 4. Visão do produto (posicionamento)

O Screen combina cinco produtos de referência sem clonar nenhum:

| Referência | Papel pretendido | Estado no código |
| --- | --- | --- |
| **TMDB** | Fonte estrutural de catálogo (ingestão offline) | Cliente + ingestão reais; catálogo raso |
| **IMDb** | Identidade externa + notoriedade + ratings | Só IDs (via TMDB); rating IMDb via agregador RapidAPI, bloqueado |
| **Rotten Tomatoes / Metacritic / FilmAffinity** | Sinais de recepção (crítica × audiência) | Schema + validador; sem clients diretos; sem dados |
| **JustWatch / streaming** | Onde assistir por país/monetização | Um provider (Streaming Availability), bloqueado por licença |
| **Letterboxd / TV Time / Trakt** | Tracker pessoal (diário, listas, progresso, social) | **Ausente por completo** |

Diferencial-alvo declarado: **DATABASE PREMIUM + TRACKER + AGREGAÇÃO GOVERNADA DE
RATINGS + ONDE ASSISTIR + CAMADA EDITORIAL**. Hoje: **DATABASE (raso) +
GOVERNANÇA (forte) + editorial (motor pronto, sem conteúdo)**; **TRACKER**,
**RATINGS exibíveis** e **ONDE ASSISTIR exibível** não existem como produto.

---

## 5. Arquitetura atual

### 5.1. Diagrama textual real

```
                        ┌───────────────────────────── OFFLINE (worker-only) ─────────────────────────────┐
                        │                                                                                  │
 APIs externas          │  services/ingestion   services/ratings   services/streaming   services/         │
 ┌────────────┐         │  ├ discovery          ├ film-show-        ├ streaming-         entity-writer      │
 │ TMDB       │──────────▶│ (Daily IDs, adult    │  ratings          │ availability       ├ gemini/adapter  │
 │ RapidAPI   │──┐      │  │  filter)            │ (recognizer       │ ├ promotion        │  (REST real,    │
 │  film/show │  │      │  ├ raw-sync (tmdb_raw) │  estrito)         │ │  guardrails)     │   gated p/ key) │
 │ Streaming  │──┼──────▶│  ├ raw-promote        └ external-ratings- └ watch-review/      ├ pipeline        │
 │  Availab.  │  │      │  ├ catalog-sync (media,   store              watch-store        │  (validate      │
 │ Gemini     │──┘      │  │  genres, list)                                               │   anti-halluc)  │
 └────────────┘         │  ├ config-sync                                                  └ persistence     │
        │               │  └ normalizers/import  api-clients/{tmdb, rapidapi-core,           (content_blocks)│
        │               │                         film_show_ratings, streaming_availability}                │
        │               └──────────────────────────────────┬───────────────────────────────────────────────┘
        │                          escreve (com log em api_sync_logs, hash, idempotência)
        ▼                                                   ▼
   api_cache / tmdb_raw  ────────────────────────▶  PostgreSQL (packages/db, Prisma, 34 models)
                                                          │  triggers: entity_registry_sync,
                                                          │  watch_availability_display_guard,
                                                          │  *_supersedes_same_group,
                                                          │  watch_offer_identity/fingerprint_v1
                                                          │
        ┌─────────────────────────── RENDER (puro: só Postgres/cache) ──────────────┐
        ▼                                                                            │
 apps/web (Next App Router, RSC/ISR)                          apps/admin (operacional)
  app/pt/**  ──▶ src/server/*-page.ts (getters,               app/** ──▶ src/server/* (read)
   (rotas)        server-only, Prisma) ──▶ src/lib/*-          + src/lib (editorial-action-policy,
                  presenter.ts (PUROS) ──▶ render                content-qa, staging) atrás de
                  packages/seo (indexability, sitemap,           flags + Basic Auth (fail-closed)
                  json-ld, redirects, value-blocks)
        │
        ▼
   thescreen.media (VPS + EasyPanel/Dockerfile; Next; robots/sitemap; 200 OK)
```

### 5.2. Regras arquiteturais confirmadas por evidência

- **Zero API externa/Gemini no render** (invariantes 3/4): getters usam
  `getPrismaClient()` de `@screena/db/server`
  ([apps/web/src/server/home-catalog.ts:11](apps/web/src/server/home-catalog.ts#L11));
  travado por `tests/governance/no-render-external-api.test.ts`,
  `tmdb-raw-not-in-render.test.ts`, `web-render-layering.test.ts`, e por
  `scripts/audit/check-render-purity.mjs` (passo de CI `audit:render`).
- **Separação getter (impuro/DB) → presenter (puro)**: `src/server/*` fazem I/O;
  `src/lib/*-presenter.ts` são puros e testados isoladamente.
- **Chaves só em env**: `.env.example` documenta todas as chaves como env vars;
  `services/entity-writer/src/gemini/config.ts:82` falha explícito se faltar
  `GEMINI_API_KEY`/`GEMINI_MODEL` e nunca as hardcoda.

---

## 6. Inventário do monorepo

| Caminho | Responsabilidade | Stack | Estado |
| --- | --- | --- | --- |
| `apps/web` | App público (render puro) | Next App Router, RSC/ISR | IMPLEMENTED (shell + rotas; dados rasos) |
| `apps/admin` | Painel operacional (read + ações editoriais gated) | Next | IMPLEMENTED_AND_TESTED |
| `packages/config` | Invariantes, RATING_SOURCES/SCALES, PUBLISHED_LOCALES, tokens | TS puro | IMPLEMENTED_AND_TESTED |
| `packages/db` | Schema Prisma, migrations, seed, client server-only | Prisma/PG | IMPLEMENTED_AND_TESTED |
| `packages/schemas` | `validateRating`, `entity-writer-output` | TS puro | IMPLEMENTED_AND_TESTED |
| `packages/seo` | Indexabilidade, sitemap, json-ld, redirects, value-blocks | TS puro | IMPLEMENTED_AND_TESTED |
| `packages/ui` | Tokens, badges filme/série | TS/CSS | PARTIAL (reset visual) |
| `packages/types` | Tipos compartilhados | TS puro | IMPLEMENTED |
| `api-clients/tmdb` | Cliente TMDB tipado (http, catalog, endpoints, append) | TS/Node | IMPLEMENTED_AND_TESTED |
| `api-clients/rapidapi-core` | Core RapidAPI compartilhado (http, cache, sanitize, hash) | TS/Node | IMPLEMENTED_AND_TESTED |
| `api-clients/film_show_ratings` | Provider técnico de ratings | TS/Node | IMPLEMENTED_AND_TESTED (offline) |
| `api-clients/streaming_availability` | Provider de "onde assistir" | TS/Node | IMPLEMENTED_AND_TESTED (offline) |
| `api-clients/imdb` | — | — | **DOCUMENTATION_ONLY** (só README) |
| `api-clients/rotten_tomatoes` | — | — | **DOCUMENTATION_ONLY** (só README) |
| `api-clients/kaso` | Fallback de streaming | — | **DOCUMENTATION_ONLY** (só README) |
| `services/ingestion` | Descoberta, raw-sync, promoção, mídia, gêneros | TS/Node | IMPLEMENTED_AND_TESTED (offline) |
| `services/ratings` | Sync + mapping de ratings (Film/Show) | TS/Node | IMPLEMENTED_NOT_WIRED (sem dado real) |
| `services/streaming` | Sync + promoção governada de ofertas | TS/Node | IMPLEMENTED_NOT_WIRED (bloqueado) |
| `services/entity-writer` | Geração editorial offline (Gemini) | TS/Node | IMPLEMENTED_AND_TESTED (sem conteúdo real) |
| `services/sync` | Stale policy + units systemd | TS/Node | PARTIAL |
| `services/news-ingestion` | RSSPRIME | — | **DOCUMENTATION_ONLY** (só README) |
| `workers/*.py` | Ratings/streaming/tmdb/rssprime/entity/scheduler | Python | **SCAFFOLD** (roadmap/shim) |
| `seo/` (raiz) | Lógica SEO histórica (rules/templates) | TS | ver §21 (possível duplicação com `packages/seo`) |
| `database/` | Documentação histórica de modelagem | MD | DOCUMENTATION_ONLY |
| `prompts/` | Prompts versionados (pt-BR) | MD | IMPLEMENTED (parcial: intro/faq/ratings/where) |

---

## 7. Banco de dados e migrations

### 7.1. Enums (14) e Modelos (34)

**Enums:** `EntityType`, `ContentBlockType`, `ContentSource`, `ReviewStatus`,
`TranslationStatus`, `IndexDecision`, `JobType`, `JobStatus`, `LicenseStatus`,
`SourceLicenseContentType`, `OfferType`, `SyncStatus`, `ValidationStatus`,
`ProviderKind`, `TmdbEntityKind` (superset para raw).

**Modelos por domínio** (`packages/db/prisma/schema.prisma`):

- **Referência/semente:** `Language`, `Country`, `RatingSource`, `ApiProvider`,
  `SourceLicense`.
- **Mídia-raiz:** `Movie`, `TvShow`, `Season`, `Episode`, `Person`.
- **Registro:** `Entity` (mantido por trigger).
- **Créditos:** `CastMember`, `CrewMember`.
- **Identidade/rotas:** `EntityExternalId`, `Slug`, `Redirect`,
  `EntityTranslation`.
- **Editorial/IA:** `ContentBlock`, `EntityWriterJob`, `EntityWriterLog`.
- **Ratings:** `ExternalRating`.
- **Disponibilidade/SEO:** `WatchAvailability`, `PageIndexabilityDecision`.
- **Infra/ingestão:** `ApiCache`, `ApiSyncLog`, `TmdbRaw`, `TmdbImageConfig`,
  `Genre`, `TmdbImage`, `TmdbVideo`, `TmdbSyncCheckpoint`.
- **Notícias:** `Article`, `ArticleTranslation`, `EntityNewsLink`.

### 7.2. Migrations (6, aditivas)

| Migration | Conteúdo |
| --- | --- |
| `20260625120000_init` | Schema base (Fase 1) |
| `20260701120000_add_news_articles` | `articles`, `article_translations`, `entity_news_links` |
| `20260706120000_add_certification_screen_score` | `certification` + `screen_score*` em movies/tv |
| `20260708200747_add_tmdb_raw_and_image_config` | `tmdb_raw`, `tmdb_image_config` (P0-00a) |
| `20260715120000_data_governance_hardening` | Triggers/constraints/histórico de governança |
| `20260716120000_tmdb_media_genres_checkpoint` | `genres`, `tmdb_images`, `tmdb_videos`, `tmdb_sync_checkpoint` |

### 7.3. Governança em SQL bruto (não expressável em Prisma) — confirmada

Funções/triggers encontrados nas migrations (evidência: grep em
`packages/db/prisma/migrations/**/*.sql`):

- `entity_registry_sync_insert` / `entity_registry_sync_delete` — mantêm a
  tabela `entities` (integridade das refs polimórficas).
- `watch_availability_display_guard` — **fail-closed**: torna impossível
  `display_allowed=true` sem `approved_payload_hash` = fingerprint + `reviewed_at/by`
  + licença permitida + atribuição/linkback.
- `watch_offer_identity_key_v1` — identidade estável da oferta (índice único
  funcional).
- `watch_offer_payload_fingerprint_v1` — fingerprint que, ao mudar, exige nova
  revisão.
- `page_indexability_supersedes_same_group` / `source_license_supersedes_same_group`
  — integridade do histórico imutável (uma decisão "vigente" por grupo via índice
  único parcial `WHERE is_current`).

**Avaliação:** governança de dados de nível industrial e coerente com as
invariantes. Migrations aditivas e consistentes. `IMPLEMENTED_AND_TESTED`
(coberto por `db:validate:real` + `db:validate:upgrade` em CI).

### 7.4. Seed — apenas referência

`packages/db/src/seed-data.ts` + `packages/db/prisma/seed.ts`:
- `LANGUAGE_SEED`: `pt-BR` (published/index), `en`/`es` (não).
- `COUNTRY_SEED`: 13 países.
- `RATING_SOURCE_SEED`: `imdb, rotten_tomatoes, metacritic, letterboxd,
  filmaffinity` (derivado de `@screena/config`).
- `API_PROVIDER_SEED`: `tmdb, gemini, imdb236, rapidapi_film_show_ratings,
  streaming_availability` (**disjunto** de rating_sources — invariante 2).
- `SOURCE_LICENSE_SEED`: uma linha conservadora por fonte
  (`license_status=unknown`, `display_allowed=false`).

**Nenhum filme/série/pessoa/artigo é semeado.** Um banco recém-semeado contém
**só tabelas de referência**. Travado por `tests/governance/seed-disjoint.test.ts`
e `rating-scales-mirror.test.ts`.

---

## 8. Estado real dos dados

**Não foi possível consultar o banco de produção com segurança.** O repositório
não versiona a `DATABASE_URL` de produção (segredos só em env). O `.env.example`
aponta para um Postgres **local de desenvolvimento**
(`postgresql://screena:...@localhost:5432/screena`), que provavelmente não está
em execução neste host Windows. Conectar às cegas a um banco possivelmente de
produção seria arriscado e foi **evitado deliberadamente**.

**Inferência baseada em código (não em SELECTs):**
- Seed = **só referência** → um ambiente limpo tem **zero catálogo**.
- Produção serve `/pt/` (200) → **existe algum catálogo**, mas volume/frescor
  **`UNKNOWN_NO_EVIDENCE`**.
- Ratings: `display_allowed=false` por design → **0 ratings públicos**.
- Streaming: `blocked_license` → **0 ofertas públicas**.
- `content_blocks`: nenhum semeado; geração exige `GEMINI_API_KEY` → provável **0
  blocos publicados**.

**Consultas SQL que DEVEM ser executadas por quem tiver acesso read-only ao banco
correto** (apenas `SELECT`, sem escrita):

```sql
-- Volume por tabela crítica
SELECT 'movies' t, count(*) FROM movies
UNION ALL SELECT 'tv_shows', count(*) FROM tv_shows
UNION ALL SELECT 'seasons', count(*) FROM seasons
UNION ALL SELECT 'episodes', count(*) FROM episodes
UNION ALL SELECT 'people', count(*) FROM people
UNION ALL SELECT 'cast_members', count(*) FROM cast_members
UNION ALL SELECT 'crew_members', count(*) FROM crew_members
UNION ALL SELECT 'slugs', count(*) FROM slugs
UNION ALL SELECT 'entity_translations', count(*) FROM entity_translations
UNION ALL SELECT 'external_ratings', count(*) FROM external_ratings
UNION ALL SELECT 'watch_availability', count(*) FROM watch_availability
UNION ALL SELECT 'content_blocks', count(*) FROM content_blocks
UNION ALL SELECT 'tmdb_raw', count(*) FROM tmdb_raw
UNION ALL SELECT 'tmdb_images', count(*) FROM tmdb_images
UNION ALL SELECT 'tmdb_videos', count(*) FROM tmdb_videos
UNION ALL SELECT 'articles', count(*) FROM articles
UNION ALL SELECT 'api_sync_logs', count(*) FROM api_sync_logs
UNION ALL SELECT 'page_indexability_decisions', count(*) FROM page_indexability_decisions;

-- Frescor e último sync
SELECT max(last_synced_at) FROM movies;
SELECT provider_api, endpoint, status, items_processed, items_created, created_at
  FROM api_sync_logs ORDER BY created_at DESC LIMIT 50;

-- Exibibilidade real
SELECT display_allowed, license_status, count(*) FROM external_ratings GROUP BY 1,2;
SELECT display_allowed, license_status, count(*) FROM watch_availability GROUP BY 1,2;
SELECT decision, language_code, count(*) FROM page_indexability_decisions
  WHERE is_current GROUP BY 1,2;
SELECT review_status, count(*) FROM content_blocks GROUP BY 1;

-- Cobertura de mídia
SELECT count(*) filter (where poster_path is not null) posters,
       count(*) filter (where backdrop_path is not null) backdrops,
       count(*) total FROM movies;
```

**Responsável:** operador com acesso read-only ao Postgres de produção
(EasyPanel/VPS). Confirmar o ambiente (`SELECT current_database()`) antes.

---

## 9. TMDB — auditoria endpoint por endpoint

Fonte cruzada: `api-clients/tmdb/src/{catalog,endpoints}.ts`, `services/ingestion`
e a matriz oficial do projeto `docs/api-coverage/coverage-matrix.md` (validada por
`pnpm api:coverage`, que quebra em drift). Estados do projeto: `raw_captured`,
`normalized`, `public_ready`, `blocked_*`, `not_applicable`, `deprecated`.

| Área de endpoint | Client | Raw | Normalize | Persist | Sync/CLI | Público | Status auditoria |
| --- | --- | --- | --- | --- | --- | --- | --- |
| movie details | ✅ | ✅ | ✅ movies | sync-tmdb-raw + promote | ✅ | IMPLEMENTED_AND_TESTED |
| tv details | ✅ | ✅ | ✅ tv_shows | promote | ✅ | IMPLEMENTED_AND_TESTED |
| season details | ✅ | ✅ | ✅ seasons | promote | ✅ | IMPLEMENTED_AND_TESTED |
| episode details | ✅ | — | método existe | — | não chamado | IMPLEMENTED_NOT_WIRED |
| person details | ✅ | ✅ | ✅ people | promote | ✅ | IMPLEMENTED_AND_TESTED |
| genres (movie/tv) | ✅ | ✅ | ✅ genres | config-sync | não lido no render | IMPLEMENTED_NOT_WIRED |
| configuration (images) | ✅ | ✅ | ✅ tmdb_image_config | config-sync | — | IMPLEMENTED_AND_TESTED |
| images | ✅ | ✅ | ✅ tmdb_images | media-sync | **não lido pelo web** | DATA_MODEL_ONLY→render |
| videos/trailers | ✅ | ✅ | ✅ tmdb_videos | media-sync | **não lido pelo web** | DATA_MODEL_ONLY→render |
| external_ids | ✅ | ✅ | ✅ entity_external_ids | promote | ✅ (sameAs/links) | IMPLEMENTED_AND_TESTED |
| credits/aggregate | ✅ | ✅ | ✅ cast/crew | promote | ✅ | IMPLEMENTED_AND_TESTED |
| daily ID exports | ✅ | ✅ | fila | discover-ids | — | IMPLEMENTED_AND_TESTED |
| changes (movie/tv/person) | ✅ (contrato) | — | planner | não executado | — | PARTIAL (roadmap F8) |
| discover movie/tv | ✅ tipado+testado | — | — | **sem worker** | — | CLIENT_ONLY |
| search movie/tv/person/multi | ✅ tipado+testado | — | — | **sem worker** | — | CLIENT_ONLY |
| trending | ❌ | — | — | — | — | MISSING (roadmap F8) |
| popular/top_rated/now_playing/airing/on_the_air | ✅ tipado+testado | — | — | **sem worker** | — | CLIENT_ONLY |
| upcoming (movie) | ✅ | ✅ | ✅ | ingest-public-catalog | ✅ (home "Em breve") | IMPLEMENTED_AND_TESTED |
| recommendations/similar (standalone) | ❌ | — | — | — | — | MISSING (roadmap F8) |
| collections | ❌ | — | — | — | — | MISSING (roadmap F6/F8) |
| companies/networks/keywords detalhe | ❌ | — | — | — | — | MISSING |
| certifications/content ratings | ✅ (raw) | ✅ | advisory | config-sync | — | PARTIAL |
| translations/alternative titles | append (raw) | ✅ | parcial | — | — | PARTIAL |

**Notas TMDB:**
- Resiliência real no cliente (`api-clients/tmdb/src/http.ts`): retry+backoff,
  rate limit, circuit breaker, cache; hash de payload evita reescrita.
- Auth: `TMDB_READ_ACCESS_TOKEN` (v4, preferido) → fallback `TMDB_API_KEY` (v3).
- Exclusão de adulto (2 camadas fail-closed): `services/ingestion/src/discovery/adult-filter.ts`.
- **Zero chamada TMDB no render** (confirmado; travado por testes de governança).
- `workers/tmdb_worker.py` = **SCAFFOLD** (o pipeline real é o TS/Node).
- **Lacuna central:** o **client de descoberta (search/discover/popular/etc.) está
  tipado e testado, mas SEM worker de execução** → a única fonte de "catálogo"
  hoje é discovery-por-ID-export + upcoming. Não há um caminho automatizado que
  encha o banco em escala.

**Top gaps TMDB:** P0 — worker de execução para list/discover/changes (encher e
manter o catálogo); P1 — expor `tmdb_images`/`tmdb_videos` ao render (mídia/
trailers); P1 — episódio details wired; P2 — coleções/empresas/networks.

---

## 10. IMDb e identidade externa

**Respostas diretas:**

1. **Integração direta com IMDb?** **Não.** Não há dataset oficial, scraping nem
   client IMDb (`api-clients/imdb` é só README — DOCUMENTATION_ONLY).
2. **Só armazena IMDb IDs vindos do TMDB?** **Sim.** `movies.imdbId`,
   `tv_shows.imdbId`, `people.imdbId` (identificador, nunca fonte de rating);
   `entity_external_ids` guarda o mapeamento.
3. **Quais providers retornam ratings "IMDb"?** O agregador técnico
   `rapidapi_film_show_ratings` (e o legado `imdb236`, deprecado) — via RapidAPI,
   endpoint `/item/?id=<IMDb>`. A nota é **reatribuída** à `rating_source=imdb`
   por `services/ratings/src/film-show-ratings/mapping.ts` (que aplica
   `validateRating`, escala por fonte e anti cross-label).
4. **Esses ratings estão no banco?** Provavelmente **não** (matriz:
   `blocked_license`; recognizer projetado para "0 mapeados até amostra humana").
5. **Podem ser exibidos?** **Não** (`display_allowed=false`,
   `license_status=unknown`).
6. **Têm quantidade de votos?** O contrato suporta `rating_count`, mas sem dados.
7. **São atualizados?** Sem sync real comprovado.
8. **Risco de licença?** Sim — exibir nota IMDb via RapidAPI exige revisão de
   ToS/atribuição (decisão humana).
9. **Gap para "Screen tem IMDb":** possuir IDs ≠ ter rating IMDb exibível. Falta:
   (a) chave RapidAPI + sync real, (b) decisão humana de licença/atribuição,
   (c) `display_allowed=true` após revisão. Até lá, **"Screen tem IMDb ID", não
   "Screen tem IMDb rating".**

---

## 11. Ratings externos

`services/ratings` + `api-clients/film_show_ratings` + `packages/schemas/src/ratings.ts`.

| Provider técnico | rating_source | Tipo | Escala | Licença | Dado no banco | Aprovado | Público |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `rapidapi_film_show_ratings` | imdb | audience | 10 | unknown | provável 0 | não | não |
| `rapidapi_film_show_ratings` | rotten_tomatoes | audience/critics | 100 | unknown | provável 0 | não | não |
| `rapidapi_film_show_ratings` | metacritic | critics | 100 | unknown | 0 (audience base-10 recusado por escala) | não | não |
| `rapidapi_film_show_ratings` | letterboxd | audience | 5 | unknown | provável 0 | não | não |
| `rapidapi_film_show_ratings` | filmaffinity | — | 10 | unknown | provável 0 | não | não |
| `imdb236` (legado) | imdb | — | 10 | — | — | — | **deprecated** |
| clients diretos RT/Metacritic/FilmAffinity | — | — | — | — | — | — | **MISSING (roadmap F10)** |

**Governança (forte, IMPLEMENTED_AND_TESTED):**
- `provider_api` ≠ `rating_source` materializado como FKs distintas
  (`external_ratings.source` → `rating_sources`, `.provider` → `api_providers`).
- `validateRating` barra cross-label (Tomatometer no IMDb), escala errada,
  `provider_api` == `rating_source`. Travado por `tests/governance/ratings.test.ts`,
  `tmdb-provider-separation.test.ts`, `rapidapi-offline-only.test.ts`.
- `rating_label` **nunca** vem do payload — é derivado da fonte canônica
  ([mapping.ts:73](services/ratings/src/film-show-ratings/mapping.ts#L73)), tornando
  cross-label impossível por construção.
- **NUNCA reescala**: Metacritic audience base-10 é **recusado**, não convertido.

**Status geral de ratings:** `CLIENT_ONLY` / `IMPLEMENTED_NOT_WIRED` +
`BLOCKED_BY_LICENSE`. Nenhuma nota exibível. Nenhuma chamada real comprovada
(faltam chaves + amostra + decisão de licença).

---

## 12. Screen Score

**Referências:** coluna `screen_score`/`screen_score_scale`/`screen_score_display`
em `movies`/`tv_shows`; formatador `resolveCardScreenScore`
(apps/web/src/lib/entity-index-presenter.ts) e uso em getters (`screenScore: true`).

| Pergunta | Resposta |
| --- | --- |
| Algoritmo canônico? | **Não.** Não existe função de cálculo. |
| Implementado/versionado/testado? | Só **coluna + gate + formatador**; sem versão de fórmula. |
| Quais ratings entram? | Nenhum — não há agregação. |
| Fontes ausentes / escalas? | N/A (não computa). |
| Persistido ou calculado? | **Persistido** (Decimal), nunca calculado no código. |
| Reproduzível? | N/A. |
| Exibido? | Só quando `screen_score_display=true` (nasce `false`); default oculto. |
| Valores mockados? | Governança **proíbe** propagação fake: `tests/governance/no-fake-streaming-in-ui.test.ts:93` barra `screenScore: X.screenScore`. |
| O que falta p/ produção? | Definir **fórmula/pesos/escala/fallback** (decisão de produto) + implementar cálculo offline versionado + testes. |

**Status:** `DATA_MODEL_ONLY` (coluna) + gate de exibição seguro. **É uma decisão
de produto aberta, não um bug.**

---

## 13. Streaming e "onde assistir"

`services/streaming` + `api-clients/streaming_availability`.

**Fluxo real (código presente):**
```
Streaming Availability (RapidAPI, /shows/{imdbId}, BR-only)
  → cache (api_cache) + log (api_sync_logs)
  → mapping/gate (streaming-availability/*)
  → watch-review-store (candidato display_allowed=false)
  → promotion (guardrails: provider/country/link/tipo/validade + --confirm humano)
  → watch_availability (trigger display_guard fail-closed)
  → presenter (watch-availability-presenter) → painel "Disponibilidade no Brasil"
```

| Pergunta | Resposta |
| --- | --- |
| APIs implementadas | Streaming Availability (`/shows/{imdbId}`), BR-only |
| Só README | `api-clients/kaso` (fallback) |
| Dados no banco / países | Provável 0; alvo BR |
| Providers/logos/URLs | `provider_name`+`web_url`/`deep_link` suportados; sem dados |
| Compra/aluguel/assinatura | `OfferType` (subscription/rent/buy/free/ads/cinema) |
| Preço/validade | `price`/`currency` (CHECK) + `available_from/until` |
| Aprovado / bloqueado | Nada aprovado; `blocked_license` |
| Frontend hoje | Painel gated existe, mas **omitido em prod** até promoção humana |
| Falta | Chave + sync real + decisão de licença/atribuição + promoção; modelagem `platforms`/`providers` canônica (roadmap) |

**Governança:** `watch_availability_display_guard` torna **impossível** exibir sem
revisão humana + licença + fingerprint. `tests/governance/no-fake-streaming-in-ui.test.ts`
impede CTA falso. **Status:** `IMPLEMENTED_NOT_WIRED` + `BLOCKED_BY_LICENSE`.

---

## 14. Imagens e vídeos

| Tipo | Origem | Tabela | Persistência | Render hoje |
| --- | --- | --- | --- | --- |
| poster/backdrop (movie/tv) | TMDB `poster_path`/`backdrop_path` na entidade | movies/tv_shows | sim (promote) | ✅ via `tmdb-image-url` (URL remota) ou demo local |
| still (episode) | `episodes.still_path` | episodes | sim | via presenter |
| profile (person) | `people.profile_path` | people | sim | via presenter |
| galeria (múltiplas imagens) | `/images` | **tmdb_images** | media-sync (offline) | **NÃO lido pelo web** |
| trailer/teaser/clip | `/videos` | **tmdb_videos** | media-sync (offline) | **NÃO lido pelo web** |

**Fatos:**
- O web renderiza **uma** imagem por entidade (o `*_path` na própria linha),
  resolvendo **local demo primeiro, senão URL remota TMDB**
  (`apps/web/src/lib/tmdb-image-url.ts`, `*-presenter.ts`). `image.tmdb.org` é
  exceção autorizada no `audit:render`.
- **`tmdb_images` e `tmdb_videos` existem, são sincronizados offline, nascem
  `display_allowed=false`, e NÃO são lidos pelo render** → **galeria e trailers
  não existem no produto** (P1 para o frontend final).
- Ativos demo committed: `apps/web/public/media/demo/*.png` (usados como fallback).

**Cobertura real por entidade:** `UNKNOWN_NO_EVIDENCE` — usar as queries de §8.

---

## 15. Catálogo e páginas de entidades

Rotas em `apps/web/app/**`; getters em `apps/web/src/server/*`; presenters em
`apps/web/src/lib/*`.

| Rota | Getter | Presenter | Schema JSON-LD | Dados |
| --- | --- | --- | --- | --- |
| `/pt` (home) | home-hero, home-catalog, home-upcoming | home-*-presenter | — | Postgres-only; vazio→omite |
| `/pt/filmes` | entity-indexes | entity-index-presenter | ItemList | real (raso) |
| `/pt/filmes/[slug]` | movie-page + entity-cast + entity-watch | movie-presenter | Movie + Breadcrumb | real (raso) |
| `/pt/series` | entity-indexes | entity-index-presenter | ItemList | real |
| `/pt/series/[slug]` | series-page | series-presenter | TVSeries | real |
| `/pt/series/[slug]/temporadas/[season]` | season-page | season-episode-presenter | TVSeason | real (rota própria — Fase 4) |
| `.../episodios/[episode]` | episode-page | season-episode-presenter | TVEpisode | real (rota própria — Fase 4) |
| `/pt/pessoas` / `[slug]` | person-page | person-presenter | Person | real |
| `/pt/noticias` / `[slug]` | news-pages | news-presenter | NewsArticle | **sem dados (0 artigos)** |
| `/pt/explorar` | portal-presenter | portal-presenter | — | shell (omite o que não tem) |
| `/robots.ts`, `/sitemap.xml`, `/sitemaps/[shard]` | seo/* | sitemap-presenter | — | paginado no banco |

**Rotas AUSENTES (o frontend futuro precisará, hoje não existem):** busca,
coleção, gênero, empresa, network, perfil de usuário, watchlist, listas.

**Qualidades:** getters `cache()`-memoizados, server-only, sem N+1 óbvio (queries
por lote com `in`). `docs/frontend/page-map.md` é o contrato de escopo de telas.
**Contra:** dados rasos; várias superfícies "honestamente vazias".

> Correção vs rascunho anterior: as rotas de temporada e episódio **existem** e têm
> URL própria (`/pt/series/[slug]/temporadas/[season]/episodios/[episode]`), não são
> apenas acopladas na página da série.

---

## 16. Busca e discovery

- **Busca:** **MISSING** — nenhuma rota/UI/índice de busca no `apps/web`. O client
  TMDB `search.*` existe (tipado+testado) mas **não há worker nem busca interna**.
- **Discovery/listas dinâmicas:** home "Filmes em alta" = `ORDER BY popularity`
  sobre o que foi ingerido (query dinâmica, não snapshot). "Em breve" = TMDB
  upcoming ingerido. `trending`/`popular`/`top_rated` como superfície: **MISSING**
  (clients existem, execução roadmap F8).
- **Recomendações/similares:** MISSING.

Não há necessidade demonstrada de OpenSearch/Algolia ainda: Postgres (com índices
GIN/trigram) cobre o MVP quando a busca for construída.

---

## 17. Listas (três domínios distintos)

| Domínio | Schema | Serviço | Estado |
| --- | --- | --- | --- |
| **Catálogo/descoberta** (populares, em breve, por gênero) | parcial (queries) | home-*/entity-indexes | PARTIAL (só home) |
| **Listas do usuário** (quero ver, assistindo, favoritos, custom) | **nenhum** | **nenhum** | **MISSING** |
| **Listas editoriais** (melhores do ano, guias) | **nenhum** (irá para Payload) | **nenhum** | **MISSING (P3)** |

---

## 18. Usuários e tracking (Letterboxd / TV Time / Trakt)

**Toda a camada pessoal está AUSENTE do schema e do código.** Confirmado: nenhum
modelo de `users, accounts, sessions, verification_tokens, profiles, preferences,
watch_status, watchlist, user_lists, list_items, user_ratings, user_reviews,
viewing_history, episode_progress, follows, activity, comments, notifications,
subscriptions`.

| Capacidade | Schema | Service | API | Test | Dados | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Auth/cadastro/login/sessão | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Watchlist / quero-assistir | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Estados (assistindo/assistido/abandonado/reassistindo) | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Favoritos / não-interesse | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Avaliação do usuário | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Review do usuário / diário | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Progresso por episódio / calendário / próximos | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Notificações / lembretes | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Follows / atividade / comentários / spoilers | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Import/export (Letterboxd/Trakt) | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |
| Recomendações personalizadas | ❌ | ❌ | ❌ | ❌ | ❌ | MISSING |

**Este é o maior bloco ausente do produto** e o principal trabalho de backend
antes do frontend final poder entregar a promessa de "tracker premium".

---

## 19. Reviews e avaliações (cinco domínios — não misturar)

1. **Ratings externos** (IMDb/RT/Metacritic/FilmAffinity/TMDB-audience):
   modelado + validado; sem dado exibível (§11). `IMPLEMENTED_NOT_WIRED`.
2. **Screen Score** (nota própria escala 5): coluna + gate; sem algoritmo (§12).
   `DATA_MODEL_ONLY`.
3. **Avaliação do usuário** (nota individual): **MISSING**.
4. **Review do usuário** (texto): **MISSING**.
5. **Crítica editorial** (autores; futuro Payload): `content_blocks.review_summary`
   é tipo válido mas **contrato/roadmap** (não gerado); artigos = Payload futuro.
   `DATA_MODEL_ONLY` / `DOCUMENTATION_ONLY`.

---

## 20. Entity Writer (Gemini)

`services/entity-writer` — pipeline offline completo.

| Pergunta | Resposta |
| --- | --- |
| O que gera hoje | Slice ativo: `editorial_intro`, `cast_intro` (pt-BR). Demais `block_type` = contrato. |
| Adapter Gemini | **Real** (REST `:generateContent`, header `x-goog-api-key`, retry/breaker/throttle, transporte injetável). Gated por `GEMINI_API_KEY`+`GEMINI_MODEL` (`config.ts:82`). `fake.ts` p/ testes. |
| Onde armazena | `content_blocks` (versionado: prompt_version, input/output_hash, model_provider/name, review_status, warnings_json). |
| Publicação automática? | **Não** — nasce `draft`/`ai_generated`; publicação = humano. |
| Anti-alucinação | `validateAgainstPayload` (`packages/schemas/src/entity-writer-output.ts`): todo nome fora do payload vira warning `fato fora do payload`. Testado (`entity-writer-output.test.ts`). |
| Input muda | Fluxo `needs_update`; sem publicação herdada. |
| Gemini no render? | **Zero** (worker-only; `audit:render` impede import por apps/web). |
| Dados reais no banco | Provável **0** (nada semeado; exige chave). |
| Gaps p/ produção | Chave Gemini + payloads reais (catálogo) + revisão humana + ampliar block_types além de intro/cast. |

**Status:** `IMPLEMENTED_AND_TESTED` (pipeline) + `BLOCKED_BY_DECISION` (sem
conteúdo gerado/revisado).

---

## 21. SEO e entity-first

`packages/seo` (fonte executável) — IMPLEMENTED_AND_TESTED:
- `indexability.ts` (`evaluateIndexability`): precedência `blocked` → `draft`
  (locale fora de `PUBLISHED_LOCALES`) → `noindex` técnico → `index`. **Indexação
  total** (gate anti-thin removido); `value-blocks.ts` é sinal, não gate.
- `resolver.ts`/`resolver-persisted.ts` (canonical/slug), `redirects.ts`,
  `sitemap-plan.ts`/`sitemap-xml.ts` (paginado no banco), `entity-schema.ts`/
  `json-ld.ts` (Movie/TVSeries/TVSeason/TVEpisode/Person/NewsArticle/Breadcrumb),
  `language-index-guard.ts`.
- Diferenciação filme/série por 5 sinais (label+badge+breadcrumb+schema+URL) —
  `tests/governance/vertical.test.ts`.
- Robots bloqueia indexação quando a origem ≠ `https://thescreen.media`
  (`THE_SCREEN_PUBLIC_SITE_URL`).

**Possível dívida:** existe `seo/` na **raiz** (`indexability.ts`, `sitemap.ts`,
`robots.ts`, `rules/`, `templates/`) além de `packages/seo`. O executável ativo é
`packages/seo`; a pasta raiz parece **legado/duplicado** — validar se está morta
(risco de divergência de fonte). Recomenda-se consolidar ou remover (fora do
escopo desta auditoria).

---

## 22. Notícias atuais

- Modelos: `Article`, `ArticleTranslation`, `EntityNewsLink` — governança de
  licença/atribuição embutida; `ai_assisted` para disclaimer; nascem
  `draft`/`noindex`.
- Rotas web `/pt/noticias` e `/pt/noticias/[slug]` existem (getters +
  presenter + `related-news`).
- **Nenhum artigo semeado** (grep vazio no seed); **nenhuma ingestão** —
  `services/news-ingestion` é só README; RSSPRIME/MN26/MNScr **ausentes**.
- **Status:** `DATA_MODEL_ONLY` + rotas prontas + `DOCUMENTATION_ONLY` (ingestão).
  Corretamente posicionado como **fase posterior**, não bloqueia o backend
  principal.

---

## 23. Payload CMS (futuro) — avaliação de compatibilidade

Decisão fixa: Payload será a camada editorial headless (não WordPress/Strapi/etc.).
Esta auditoria **não implementa** nada.

1. **Reutilizável:** `Article*`/`EntityNewsLink` (viram projeção pública),
   governança de licença/atribuição, refs polimórficas para `entities`, o padrão
   de `content_blocks` versionados, e a camada SEO (`packages/seo`) para SEO
   editorial.
2. **Permanece no `screen_core`:** filmes/séries/temporadas/episódios/pessoas/
   créditos/gêneros/streaming/ratings/Screen Score/usuários/tracking.
3. **Viram projeção pública:** artigos/traduções/links de entidade.
4. **Adaptar/preservar:** manter Prisma dono de `screen_core`; Payload dono de
   `screen_cms` (bancos lógicos separados, mesmo cluster).
5. **Packages compartilhados necessários:** `content-contracts`,
   `entity-contracts`, `editorial-rules`, `shared-types` (reusar `packages/seo`,
   `packages/config`).
6. **Contrato Payload→Screen:** evento de publicação → fila → projection worker →
   `screen_core` (o navegador não consulta Payload).
7. **Contrato MNScr→Payload:** MNScr cria/atualiza com proveniência → revisão no
   Payload (nunca autopublica na 1ª implantação).
8. **Tabelas que NÃO podem ser compartilhadas:** todo o catálogo/ratings/streaming/
   usuários — Payload nunca escreve nelas.
9. **Riscos de migration:** separar `articles*` do `screen_core` para `screen_cms`
   exige projeção; refs de entidade precisam de IDs estáveis.
10. **Passos futuros:** ver §36.
11. **Quando implantar:** **após** `backend-v1-ready` + frontend principal (P3).
12. **Pré-requisitos:** IDs de entidade estáveis + API interna de busca de
    entidades + contrato de projeção.

---

## 24. RSSPRIME e MNScr — fronteiras

- **RSSPRIME:** coleta/normalização/dedup/clusters/event-keys/superfeeds. **Não**
  recebe lógica de produto Screen. Estado: **MISSING** (não existe código).
- **MNScr:** consome clusters → Editorial Gate → seleção/extração/fatos/Gemini/QA/
  SEO/entity-linking → submissão ao Payload. Estado: **MISSING**.
- **Payload:** processo editorial (rascunho→revisão→aprovação→agendamento→
  publicação→versão→auditoria). **MISSING**.
- **Screen Core:** projeção pública + relações de entidade (o que **existe** hoje).
- Contratos reaproveitáveis: `entity_news_links` (ligação artigo↔entidade),
  governança de licença. Contratos ausentes: fila/evento de publicação, projection
  worker, tenant_id/multiportal.

---

## 25. Deploy e produção

- **Dockerfile** na raiz (build do `@screena/web`); `docker-compose.dev.yml`
  (Postgres local); `.dockerignore`.
- **EasyPanel:** `docs/EASYPANEL_DEPLOY.md` + `docs/CLOUDPANEL_DEPLOY.md`.
  Armadilhas conhecidas: `NODE_ENV=production` só pós-build; `db:generate`
  explícito; ARGs `THE_SCREEN_PUBLIC_*` antes do `next build`.
- **Ambiente publicado (verificado, leve):**
  - `HEAD https://thescreen.media/pt/` → **200** (`Cache-Control: private,
    no-cache`).
  - `/robots.txt` → **200** (`text/plain`, `max-age=14400`).
  - `/sitemap.xml` → **200** (`application/xml`, header `X-Screena-Locale: pt`).
- **Backup/restore:** `scripts/backup/backup.sh` + `restore-test.sh` (validados
  por `bash -n` na CI); **nenhum backup real comprovado** (roadmap: passo antes da
  carga TMDB). Invariante: restore-test nunca `--clean`/`--create`.
- **Não verificável sem acesso:** volume de dados em prod, workers/scheduler
  systemd ativos, healthchecks, métricas/alertas, rollback. **Cautela:** 200 ≠
  "funcional em produto"; o shell responde, o conteúdo é raso.

**Status:** deploy `PRODUCTION_VERIFIED` (serve o shell); observabilidade/backup
operacional `UNKNOWN_NO_EVIDENCE`/roadmap.

---

## 26. Segurança e licenças

- **Segredos só em env** (`.env.example` documenta; nunca no frontend). Testes:
  `tests/admin/no-secret-leak.test.ts`. Gemini nunca loga chave/prompt.
- **Pureza de render** (sem API externa/Gemini): `audit:render` +
  `no-render-external-api.test.ts`.
- **Admin fail-closed**: Basic Auth por env (`ADMIN_PROTECTION_ENABLED`,
  `ADMIN_BASIC_AUTH_USER/PASSWORD`), decisão por ambiente
  (`apps/admin/src/lib/access-protection.ts`); ações editoriais atrás de flag;
  `tests/admin/no-server-writes.test.ts`, `no-write-endpoints.test.ts`.
- **Anti-pirataria:** `watch_availability` só links legais; `no-fake-streaming-in-ui`.
- **Licenças (revisão contratual, não parecer jurídico):**
  - **Ratings via RapidAPI/IMDb:** exibir nota/logo exige revisar ToS + atribuição
    → **decisão humana** antes de `display_allowed=true`.
  - **Streaming Availability:** atribuição obrigatória; BR-only.
  - **TMDB:** atribuição de imagens/dados conforme ToS TMDB.
  - **Biografias de pessoas:** `people.biography_source_status` governa exibição.
- **A rever:** SSRF em `deep_link`/`web_url` externos; upload/HTML no futuro
  Payload; prompt-injection no Entity Writer (mitigado por payload controlado).

---

## 27. Testes e CI

- **~175 arquivos de teste.** Governança (`tests/governance/`) trava: ratings,
  indexabilidade, vertical filme/série, pureza de render, exclusão de adulto,
  no-fake-streaming, separação de provider TMDB, tmdb-raw-not-in-render, JSON-LD
  seguro, escalas de rating, seed disjunto, defaults seguros, docs-invariants.
- **CI** (`.github/workflows/ci.yml`, `ubuntu-latest`) roda 18 passos: install,
  `bash -n` backups, `db:generate`, typecheck, lint, test, `audit:invariants`,
  `audit:render`, `api:coverage`, `build`, `validate:all` + `db:validate:real` +
  `db:validate:upgrade` + `streaming validate:stores` + `validate:seo-runtime` +
  `validate:season-episode-routes` + `validate:tmdb-platform` +
  `validate:external-intelligence-platform` — **todos com PostgreSQL 16 efêmero**.
- **Não executei** a suíte localmente nesta auditoria (Windows + limites de
  sessão; os validadores `*-real-postgres` exigem Postgres). A CI Linux é a fonte
  de verdade dos validadores de integração. Classificação recomendada de qualquer
  falha local: **limitação do Windows / banco ausente → precisa da CI Linux**,
  não regressão.

---

## 28. Drift documental

| Documento | Afirmação | Estado real | Evidência | Impacto |
| --- | --- | --- | --- | --- |
| Rascunho anterior deste relatório | "Rotas temporada/episódio não existem"; "model videos não existe"; "24 tabelas" | Auditou o commit stale `508fa72` | §1.1; rotas Fase 4; `TmdbVideo`/`TmdbImage`; 34 models | Alto — auditar commit errado gera conclusão errada |
| `docs/SITE_BACKEND_API_PRODUCT_AUDIT_BEFORE_DESIGN_RESET.md` | Auditoria "antes do reset" (pré Fases 6–11) | Anterior à plataforma atual | histórico de commits | Usar como pista, não verdade |
| README/commits "Fase X concluída" | Fases 6–11 "completas" | Clients/pipelines completos, **sem dados/execução** | api-coverage `not_applicable`/`blocked_*` | Risco de superestimar prontidão |
| `coverage-matrix.md` | search/discover/popular "tipado+testado" | Sim, mas **sem worker** | §9 | "Coberto" ≠ "executado" |
| `.claude/rules/i18n.md` §10 / `seo.md` §5 | citam "gate anti-thin (≥2 blocos)" | Gate **removido** (indexação total 2026-07) | Invariante 5 atual; `indexability.ts` | Documentos internos inconsistentes entre si |
| Menções a "IMDb integrado" | — | Só **IMDb IDs**; rating IMDb bloqueado | §10 | Não afirmar "tem IMDb" |
| Screen Score em docs de roadmap | Tratado como recurso | Só coluna + gate, **sem algoritmo** | §12 | Decisão de produto pendente |
| `services/news-ingestion` | Serviço de ingestão | Só README | árvore | Notícias = roadmap real |
| `seo/` raiz vs `packages/seo` | Duas fontes de SEO | Ativo = `packages/seo`; raiz = legado? | §21 | Risco de divergência |

---

## 29. Matriz mestre

Legenda: **PV**=PRODUCTION_VERIFIED · **IT**=IMPLEMENTED_AND_TESTED ·
**INW**=IMPLEMENTED_NOT_WIRED · **PA**=PARTIAL · **DM**=DATA_MODEL_ONLY ·
**CO**=CLIENT_ONLY · **SF**=SEED_OR_FIXTURE_ONLY · **DO**=DOCUMENTATION_ONLY ·
**SC**=SCAFFOLD · **BL**=BLOCKED_BY_LICENSE · **BD**=BLOCKED_BY_DECISION ·
**MI**=MISSING · **UN**=UNKNOWN_NO_EVIDENCE.

| Área | Capacidade | Schema | Migr | Client | Norm | Store | Job/CLI | Test | Dados | Público | Status | Prioridade |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Catálogo | Filmes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | raso | ✅ | IT | P0 (dados) |
| Catálogo | Séries | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | raso | ✅ | IT | P0 (dados) |
| Catálogo | Temporadas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | raso | ✅ (rota própria) | IT | P0 |
| Catálogo | Episódios | ✅ | ✅ | ✅ | ✅ | ✅ | parcial | ✅ | raso | ✅ (rota própria) | INW | P1 |
| Catálogo | Pessoas | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | raso | ✅ | IT | P0 |
| Catálogo | Créditos (cast/crew) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | raso | ✅ | IT | P1 |
| Catálogo | Coleções/franquias | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P2 |
| Catálogo | Gêneros | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UN | ❌ | INW | P1 |
| Catálogo | Empresas/Networks/Keywords | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P2 |
| Catálogo | Títulos alternativos | parcial | — | append | parcial | ❌ | ❌ | — | ❌ | ❌ | PA | P2 |
| Mídia | Poster/backdrop/profile/still | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UN | ✅ | IT | P1 |
| Mídia | Galeria (tmdb_images) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UN | ❌ | DM→render | P1 |
| Mídia | Trailers/vídeos (tmdb_videos) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | UN | ❌ | DM→render | P1 |
| Ratings | IMDb (via agregador) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~0 | ❌ | INW+BL | P1 |
| Ratings | Rotten Tomatoes | ✅ | ✅ | agregador | ✅ | ✅ | ✅ | ✅ | ~0 | ❌ | INW+BL | P1 |
| Ratings | Metacritic | ✅ | ✅ | agregador | ✅ | ✅ | ✅ | ✅ | ~0 | ❌ | INW+BL | P1 |
| Ratings | FilmAffinity | ✅ | ✅ | agregador | ✅ | ✅ | ✅ | ✅ | ~0 | ❌ | INW+BL | P1 |
| Ratings | Clients diretos RT/MC/FA | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P2 |
| Score | Screen Score (algoritmo) | coluna | ✅ | — | ❌ | gate | ❌ | parcial | ❌ | gated | DM+BD | P1 |
| Streaming | Onde assistir (BR) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~0 | ❌ | INW+BL | P1 |
| Busca | Search interna | ❌ | — | client TMDB | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P1 |
| Discovery | Trending/popular/top-rated | ❌ superfície | — | ✅ tipado | ❌ | ❌ | ❌ (sem worker) | ✅ client | ❌ | ❌ | CO | P1 |
| Discovery | Upcoming ("Em breve") | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | sim | ✅ | IT | — |
| Discovery | Recomendações/similares | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P2 |
| Listas | Catálogo (home rails) | parcial | — | — | — | ✅ | — | ✅ | sim | ✅ | PA | — |
| Listas | Usuário (watchlist/custom) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P1 |
| Listas | Editorial | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P3 |
| Usuário | Auth/sessão/perfil | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P1 |
| Tracking | Watch status/progresso/diário | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P1 |
| Tracking | Calendário/notificações | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P2 |
| Tracking | Avaliação/review de usuário | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P1 |
| Comunidade | Follows/atividade/comentários | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P3 |
| SEO | Indexabilidade/sitemap/JSON-LD/redirects | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | sim | ✅ | IT | — |
| Editorial | Entity Writer (Gemini) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ~0 | ❌ | IT+BD | P2 |
| Notícias | Article/Translation/Link | ✅ | ✅ | — | — | ✅ | ❌ | ✅ | ❌ | rota vazia | DM | P3 |
| Notícias | Ingestão (RSSPRIME/MNScr) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | DO/MI | P3 |
| CMS | Payload | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | MI | P3 |
| Admin | Painel operacional gated | — | — | — | — | ✅ | ✅ | ✅ | — | interno | IT | — |
| Deploy | Web em produção | — | — | — | — | — | ✅ | — | — | ✅ 200 | PV | — |
| Ops | Backup/restore/observabilidade | — | — | — | — | — | ✅ scripts | `bash -n` | ❌ real | ❌ | PA/UN | P2 |
| Infra | Workers Python | — | — | — | — | — | ❌ | ❌ | ❌ | ❌ | SC | P3 |

### 29.1. Contagem por status (capacidades da matriz, ~45)

| Status | Nº aprox. |
| --- | --- |
| IT (implementado+testado) | 12 |
| PV (verificado em produção) | 1 |
| INW (implementado, não ligado) | ~5 |
| INW+BL / IT+BD / DM+BD (bloqueado) | ~7 |
| PA (parcial) | ~4 |
| CO (só client) | 1 |
| DM (só modelo de dados) | ~3 |
| DO/SC (doc/scaffold) | ~3 |
| **MI (ausente)** | **~14** |
| UN (sem evidência — dados de produção) | transversal |

---

## 30. Gaps P0/P1/P2/P3

### P0 — bloqueia o backend real
1. **Sem worker de execução de catálogo em escala** (search/discover/popular/
   changes têm client, não têm job) → o banco **não se enche nem se atualiza**
   automaticamente. Sem isso, todas as páginas ficam rasas. (§9)
2. **Sem dados reais verificáveis** (catálogo/mídia) e **sem inspeção de banco de
   produção** → volume/frescor `UNKNOWN`. Rodar as queries de §8. (§8)
3. **Sync incremental (`/changes`) apenas contrato** → sem manutenção de frescor.

### P1 — bloqueia o frontend completo
4. **Camada de usuário/tracking/listas/avaliações ausente** (§18) — o maior bloco.
5. **Busca inexistente** (§16).
6. **Mídia rica (galeria/trailers) modelada mas não exposta ao render** (§14).
7. **Ratings e streaming bloqueados** (chave + licença + promoção) (§11/§13).
8. **Screen Score sem algoritmo** (decisão + implementação) (§12).
9. **Discovery (trending/popular) sem superfície** (§16).

### P2 — bloqueia lançamento confiável
10. Backup/restore **reais** + observabilidade/scheduler/dead-letter/alertas (§25).
11. Coleções/empresas/networks; episódio wired; recomendações/similares.
12. Entity Writer com conteúdo real (chave + revisão) e mais block_types (§20).

### P3 — fase editorial/expansão
13. Payload CMS; RSSPRIME/MNScr; notícias reais; multiportal; comunidade social.

---

## 31. Backlog do backend (ordenado)

### Backend A — verdade dos dados e catálogo (P0)
- **Objetivo:** encher e manter o catálogo real.
- **Escopo:** worker de execução para list/discover/search/changes (TMDB F8);
  wiring de episódio; expor gêneros; sync incremental por `/changes` com
  checkpoint; validação de volume via §8.
- **Pré-req:** chave TMDB; Postgres de produção acessível.
- **Migrations prováveis:** nenhuma nova (tabelas existem); talvez índices.
- **Riscos:** cota TMDB, idempotência sob mudança.
- **Testes:** integração PG efêmero (já há harness).
- **Aceite:** N filmes/séries/pessoas sincronizados + `last_synced_at` fresco +
  logs em `api_sync_logs`.

### Backend B — inteligência externa (P1/P2)
- **Escopo:** sync real de ratings (chave RapidAPI + amostra humana + decisão de
  licença → `display_allowed`); streaming BR real + promoção; **definir e
  implementar Screen Score** (fórmula versionada, offline); histórico/atualização.
- **Migrations:** possivelmente `platforms`/`providers` de streaming; versão de
  Screen Score.
- **Riscos:** licença/ToS (revisão jurídica), reescala proibida.
- **Aceite:** ≥1 fonte de rating exibível licenciada; ofertas BR exibíveis;
  Screen Score reproduzível e testado.

### Backend C — produto pessoal (P1) — o maior
- **Escopo:** `users/accounts/sessions`; watch status; watchlist; listas + itens;
  user_ratings; user_reviews; diário; episode_progress; histórico; calendário;
  notificações; privacidade; import/export (Letterboxd/Trakt).
- **Migrations:** grande bloco novo (banco de usuário — considerar `screen_user`
  lógico ou schema separado).
- **Riscos:** privacidade/LGPD, auth segura, spoilers.
- **Aceite:** fluxo completo criar conta → marcar assistido → progresso →
  watchlist, com testes.

### Backend D — busca, recomendação e contratos (P1)
- **Escopo:** busca Postgres (trigram/GIN) por título/original/alias/acentos;
  discovery (trending/popular/top-rated) como superfície; recomendações/similares;
  **congelar payloads** (§32); APIs internas para admin/CMS/busca de entidade.
- **Aceite:** busca funcional + payloads tipados estáveis.

### Backend E — operação (P2)
- **Escopo:** backup/restore reais; observabilidade (logs/métricas/alertas);
  scheduler (systemd timers) ativo; dead-letter; staging; segurança operacional.
- **Aceite:** backup restaurável testado; alertas de degradação de upstream.

Ordem: **A → B/D (paralelizáveis) → C (grande, paralelo parcial) → E (transversal)**.

---

## 32. Contratos para o frontend (congelar antes do frontend final)

| Contrato | Existe? | Onde | Estável? | Lacuna |
| --- | --- | --- | --- | --- |
| HomePayload | parcial | home-*-presenter | não | consolidar rails + fontes |
| MovieDetailPayload | ✅ | movie-presenter | ~ | ratings/streaming/mídia rica ausentes |
| TvDetailPayload | ✅ | series-presenter | ~ | idem |
| SeasonDetailPayload | ✅ | season-episode-presenter | ~ | — |
| EpisodeDetailPayload | ✅ | season-episode-presenter | ~ | still/creditos por episódio |
| PersonDetailPayload | ✅ | person-presenter | ~ | filmografia rica |
| SearchPayload | ❌ | — | — | **MISSING** |
| DiscoveryPayload | parcial | portal/home | não | trending/popular |
| RatingsPayload | ❌ (bloqueado) | — | — | licença + dados |
| StreamingPayload | parcial | watch-availability-presenter | não (gated) | dados + licença |
| MediaPayload (galeria/trailer) | ❌ | — | — | expor tmdb_images/videos |
| UserProfilePayload | ❌ | — | — | **MISSING** |
| WatchlistPayload | ❌ | — | — | **MISSING** |
| UserListPayload | ❌ | — | — | **MISSING** |
| ArticlePayload | parcial | news-presenter | ~ | sem dados |

**Regra:** os presenters puros já são a base do contrato — congelar seus tipos de
saída (`EntityCard`, `MovieDetail*`, etc.) **após** Backend A–D.

---

## 33. Critério `backend-v1-ready`

Só criar a tag quando houver **evidência** (queries §8 + testes verdes) de:
- [ ] Catálogo real suficiente (filmes/séries/pessoas) com slugs e traduções pt-BR.
- [ ] TMDB: details + credits + external_ids + mídia sincronizados; **sync
      incremental (`/changes`) executando**.
- [ ] Imagens (poster/backdrop/profile) e **trailers** expostos ao render.
- [ ] ≥1 fonte de ratings licenciada e exibível **ou** decisão registrada de adiar.
- [ ] Streaming BR exibível **ou** decisão registrada de adiar.
- [ ] Busca funcional + discovery (trending/popular).
- [ ] Contratos tipados congelados (§32).
- [ ] **Usuários + tracking + watchlists + listas + avaliações + histórico** (ou
      escopo v1.1 justificado por escrito).
- [ ] Jobs/scheduler + backups reais + staging.
- [ ] Zero API externa no render (mantido) + testes de integração verdes.
- [ ] Documentação operacional atualizada (sem drift).

**Legitimamente adiável para v1.1 (com justificativa):** comunidade social,
recomendações personalizadas, notícias/editorial, en/es.

---

## 34. Fase do frontend (após backend-v1-ready)

**FRONTEND CLAUDE DESIGN** consome contratos congelados para: Home, filmes,
séries, temporadas, episódios, pessoas, busca, explorar, streaming, ratings,
trailers, listas, perfil, tracking, notícias. **Pré-condição:** contratos §32
estáveis + dados reais (§31 A–D). Não implementar antes; hoje o shell é
proposital.

---

## 35. Fase editorial e notícias (última)

`PAYLOAD CMS → editorial manual → projeção pública → RSSPRIME → MNScr →
automação`. Subfases: 1 fundação Payload · 2 integração com entidades · 3 projeção
pública · 4 preview · 5 workflow editorial · 6 mídia editorial · 7 SEO editorial ·
8 MNScr publisher · 9 RSSPRIME · 10 multiportal · 11 escala. **Notícias não
bloqueiam o backend principal.**

---

## 36. Roadmap final

| Etapa | Entregas | Dependências | Paralelização | Conclusão | Não entra |
| --- | --- | --- | --- | --- | --- |
| **1. Concluir backend central** | Catálogo cheio + sync incremental + mídia/trailers + ratings/streaming licenciados + Screen Score + busca + usuários/tracking/listas | Chaves API + Postgres prod + decisões de licença | A→B/D paralelos; C grande | `backend-v1-ready` | frontend visual, Payload |
| **2. Congelar contratos** | Payloads/APIs internas/stores tipados estáveis | Etapa 1 | — | tipos versionados | features novas |
| **3. Frontend final (Claude Design)** | UI sobre backend pronto | Etapa 2 | por superfície | paridade de design | mudar contratos |
| **4. Payload CMS** | Editorial headless + projeção | Etapa 3 + IDs estáveis | fundação isolada | publicar 1º artigo real | escrever no catálogo |
| **5. RSSPRIME + MNScr** | Automação editorial | Etapa 4 | pipeline isolado | ingestão→revisão→publicação | autopublicar sem revisão |

---

## 37. Decisões abertas (requerem o dono do produto)

| # | Pergunta | Por quê | Opções | Recomendação neutra | Pode avançar sem? |
| --- | --- | --- | --- | --- | --- |
| 1 | **Fórmula do Screen Score** | Sem algoritmo hoje | (a) média ponderada de fontes licenciadas; (b) só nota própria editorial; (c) adiar | Definir só após ≥1 fonte licenciada; manter gate `display=false` até lá | Sim (backend catálogo) |
| 2 | **Fontes de rating autorizadas + licença** | Exibição bloqueada | IMDb(RapidAPI)/RT/MC/FA — quais licenciar | Começar por 1 fonte com atribuição clara | Sim (sync pode rodar bloqueado) |
| 3 | **País inicial de streaming** | Só BR modelado | BR / +US | Manter BR no MVP | Sim |
| 4 | **Escala da avaliação do usuário** | Camada ausente | 5 estrelas (Letterboxd) / 10 / 100 | 5 com passos de 0.5 | Não p/ tracking |
| 5 | **Privacidade de listas/tracking** | LGPD/social | público/privado/amigos | privado por padrão | Não p/ usuário |
| 6 | **Escopo de status de tracking** | Define modelo | mínimo (watch/watched) vs completo (Trakt) | começar mínimo, extensível | Não p/ tracking |
| 7 | **Nível inicial de social** | Escopo v1 | nenhum / follows / comentários | adiar p/ pós-v1 | Sim |
| 8 | **Autopublicação futura no Payload** | Governança editorial | nunca / com gate | nunca na 1ª implantação | Sim (P3) |
| 9 | **Consolidar `seo/` raiz vs `packages/seo`** | Possível duplicação | remover raiz / manter | confirmar e remover legado | Sim |

---

## 38. Apêndice de evidências (arquivos-chave)

- Schema: `packages/db/prisma/schema.prisma` (34 models, 14 enums).
- Migrations governança: `packages/db/prisma/migrations/20260715120000_*`,
  `20260716120000_*` (triggers/funções listadas em §7.3).
- Seed referência: `packages/db/src/seed-data.ts`, `packages/db/prisma/seed.ts`.
- Invariantes/config: `packages/config/src/invariants.ts`
  (RATING_SOURCES/SCALES, PUBLISHED_LOCALES=`["pt-BR","pt"]`).
- Ratings: `services/ratings/src/film-show-ratings/mapping.ts`,
  `packages/schemas/src/ratings.ts`, `tests/governance/ratings.test.ts`.
- Gemini: `services/entity-writer/src/gemini/{adapter,config,fake}.ts`,
  `packages/schemas/src/entity-writer-output.ts`.
- Render puro: `apps/web/src/server/home-catalog.ts`,
  `apps/web/src/lib/tmdb-image-url.ts`, `scripts/audit/check-render-purity.mjs`.
- SEO: `packages/seo/src/{indexability,value-blocks,sitemap-*,json-ld,redirects}.ts`.
- Coverage self-assessment: `docs/api-coverage/coverage-matrix.md`,
  `endpoints.json`, `fields.json`; comando `pnpm api:coverage`.
- CI: `.github/workflows/ci.yml` (18 passos, PG efêmero).
- Env: `.env.example`.
- Ausências (grep vazio): user/auth/watchlist/collections/companies/search em
  `schema.prisma` e `apps/web/app`.

---

## 39. Comandos executados (todos read-only)

```
git fetch origin
git status --short ; git rev-parse HEAD ; git rev-parse origin/main
git rev-parse --abbrev-ref HEAD ; git log --oneline --decorate -30 origin/main
git merge-base --is-ancestor 508fa72 eedeba6 ; git merge-base 508fa72 eedeba6
git rev-list --count eedeba6..508fa72 ; git rev-list --count 508fa72..eedeba6
git log --oneline 508fa72 -12
git worktree list
git worktree add --detach E:/screena-wt/screen-current-state-audit eedeba6
git ls-files (por subárvore) ; ls / wc / grep (leitura)
Read: schema.prisma, seed-data.ts, invariants.ts, gemini/{config,adapter}.ts,
      ratings/mapping.ts, home-catalog.ts, .env.example, coverage-matrix.md,
      .github/workflows/ci.yml
grep: triggers/funções em migrations; screenScore; placeholders web; admin flags
curl -I: https://thescreen.media/{pt/,robots.txt,sitemap.xml}  -> 200/200/200
```
(Tentativa de `curl` do corpo do sitemap foi negada por permissão — apenas
cabeçalhos obtidos. Nenhum `SELECT`/escrita em banco foi executado.)

---

## 40. Limitações da auditoria

- **Sem acesso ao banco de produção** → volume/frescor `UNKNOWN`; queries em §8.
- **Suíte de testes não executada localmente** (Windows + validadores exigem
  Postgres; limites de sessão) → confiar na CI Linux.
- **Corpo do sitemap de produção não obtido** (permissão) → só cabeçalhos (200).
- **Amostragem de código:** ~696 arquivos; foram lidos integralmente os
  decisivos e cruzados com a matriz de cobertura oficial + CI. Áreas classificadas
  `UNKNOWN_NO_EVIDENCE` são as sem evidência conclusiva.
- **Nenhuma conclusão jurídica definitiva** — questões de licença/ToS marcadas
  como "requer revisão contratual".

---

### Entregáveis finais

1. **Caminho do relatório:** `docs/audits/SCREEN_CURRENT_STATE_COMPLETE_DIAGNOSIS.md`
2. **SHA auditado:** `eedeba6c5832eac9df976d9e00e21d41c90823bc` (origin/main)
3. **Banco consultado?** Não (sem acesso read-only seguro; SQL fornecido em §8).
4. **Comandos executados:** §39 (todos read-only).
5. **Capacidades por status:** §29.1 (~12 IT, 1 PV, ~5 INW, ~7 bloqueados, ~4 PA,
   1 CO, ~3 DM, ~3 DO/SC, **~14 MISSING**).
6. **Principais gaps P0:** sem worker de execução de catálogo em escala; sem dados
   reais verificáveis; sync incremental só contrato.
7. **Principais gaps P1:** camada de usuário/tracking/listas ausente; busca
   inexistente; mídia rica/trailers não expostos; ratings/streaming bloqueados;
   Screen Score sem algoritmo.
8. **Próximo trabalho objetivo:** Backend A (worker de execução TMDB para encher e
   manter o catálogo em escala) + rodar as queries de §8 no Postgres de produção
   para medir o estado real dos dados.
9. **Confirmação:** **Nenhum código foi alterado.** A única escrita foi a criação
   deste relatório. O WIP local na branch `feat/data-governance-hardening` não foi
   tocado.
