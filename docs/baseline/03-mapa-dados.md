# 03 — Mapa de dados

> Estrutura de persistência. Contagens obtidas por varredura direta de
> `packages/db/prisma/schema.prisma`. SHA `73c58e9`.

---

## 1. Números verificados

| Métrica | Valor | Comando |
| --- | ---: | --- |
| Modelos Prisma | **75** | `grep -c "^model " packages/db/prisma/schema.prisma` |
| Enums Prisma | **42** | `grep -c "^enum " packages/db/prisma/schema.prisma` |
| Linhas do schema | **2.328** | `wc -l packages/db/prisma/schema.prisma` |
| Migrations | **12** | `ls packages/db/prisma/migrations/` |
| Bytes de SQL de migration | **178.123** | soma de `migration.sql` |
| Provider | `postgresql` | `migration_lock.toml` |
| Asserções em PG 16 real | **636** verdes | `11-validacao-execucoes.md` §3 |

---

## 2. Os 75 modelos por domínio

**Catálogo de entretenimento (21)**
`Movie` · `TvShow` · `Season` · `Episode` · `Person` · `Entity` · `Collection` · `Genre` ·
`Keyword` · `Network` · `TvNetwork` · `ProductionCompany` · `MovieProductionCompany` ·
`TvProductionCompany` · `MovieCollectionMembership` · `CastMember` · `CrewMember` ·
`EntityTranslation` · `EntityAlternativeTitle` · `EntityKeyword` · `EntityExternalId`

**SEO e roteamento (4)**
`Slug` · `Redirect` · `PageIndexabilityDecision` · `SearchDocument`

**Editorial e notícias (6)**
`ContentBlock` · `Article` · `ArticleTranslation` · `EntityNewsLink` ·
`EntityWriterJob` · `EntityWriterLog`

**Inteligência externa (8)**
`ExternalRating` · `RatingSource` · `ApiProvider` · `SourceLicense` · `WatchAvailability` ·
`WatchProvider` · `WatchProviderAlias` · `CinerieScoreCalculation`

**Ingestão e jobs (10)**
`ApiCache` · `ApiSyncLog` · `CatalogJob` · `ImportJob` · `TmdbRaw` · `TmdbImage` ·
`TmdbImageConfig` · `TmdbVideo` · `TmdbSyncCheckpoint` · `DiscoverySnapshot` +
`DiscoverySnapshotItem`

**Plataforma de usuário (20)**
`User` · `UserProfile` · `UserSession` · `Account` · `PasswordCredential` · `VerificationToken` ·
`AuthThrottle` · `AuthAuditLog` · `UserRating` · `UserReview` · `ReviewReport` · `UserList` ·
`UserListItem` · `UserWatchState` · `EpisodeProgress` · `ViewingEvent` · `UserBlock` ·
`UserStatsSnapshot` · `RecommendationSnapshot` · `RecommendationFeedback`

**Conformidade e referência (6)**
`ConsentRecord` · `DataRequest` · `DataUsageDecision` · `Country` · `Language` · `Images`

## 3. Os 42 enums

`AuthAuditAction` · `AuthTokenPurpose` · `CatalogJobStatus` · `CatalogJobType` ·
`CinerieScoreStatus` · `ConsentKind` · `ContentBlockType` · `ContentSource` · `DataRequestKind` ·
`DataRequestStatus` · `DataUsageStage` · `EntityType` · `ImportJobStatus` · `ImportSource` ·
`IndexDecision` · `JobStatus` · `JobType` · `LicenseStatus` · `OfferType` · `ProfileVisibility` ·
`ProviderKind` · `RatingScoreType` · `RecommendationContext` · `RecommendationFeedbackSource` ·
`RecommendationFeedbackType` · `ReportReason` · `ReportStatus` · `ReviewModerationStatus` ·
`ReviewStatus` · `SourceLicenseContentType` · `SyncStatus` · `SystemListKey` · `ThrottleScope` ·
`TmdbEntityKind` · `TranslationStatus` · `UserListKind` · `UserRole` · `UserStatus` ·
`ValidationStatus` · `ViewingEventType` · `Visibility` · `WatchState`

---

## 4. Migrations em ordem cronológica

| # | Migration | Bytes | Escopo |
| ---: | --- | ---: | --- |
| 1 | `20260625120000_init` | 28.066 | catálogo base, slugs, cache, logs |
| 2 | `20260701120000_add_news_articles` | 3.315 | notícias e traduções |
| 3 | `20260706120000_add_certification_screen_score` | 825 | certificação e score |
| 4 | `20260708200747_add_tmdb_raw_and_image_config` | 1.665 | raw TMDB + config de imagem |
| 5 | `20260715120000_data_governance_hardening` | 32.682 | governança: licenças, watch offers, decisões |
| 6 | `20260716120000_tmdb_media_genres_checkpoint` | 3.797 | mídia, gêneros, checkpoint |
| 7 | `20260716130000_catalog_jobs_and_search` | 4.773 | fila de jobs + busca |
| 8 | `20260716140000_catalog_entities_and_discovery` | 10.567 | entidades canônicas + discovery |
| 9 | `20260717120000_external_intelligence_product` | **47.441** | ratings, streaming, licenças, Cinerie Score |
| 10 | `20260717150000_user_product_platform` | 34.799 | plataforma de usuário |
| 11 | `20260721120000_user_product_persistence_foundation` | 7.980 | fundação de persistência (C7A) |
| 12 | `20260721140000_tracking_event_idempotency_scope` | 2.213 | idempotência de tracking (C7A.1) |

### 4.1 Aplicação validada nos dois cenários

| Cenário | Comando | Resultado |
| --- | --- | --- |
| Banco **vazio** | `db:validate:real` + smoke | **45/45** + `All migrations have been successfully applied` |
| **Upgrade** sobre estado anterior (backfills) | `db:validate:upgrade` | **23/23** |
| Idempotência | 2ª execução de `migrate deploy` | `No pending migrations to apply` |

### 4.2 Achado verificado: bytes não-ASCII (risco R-11)

68 bytes não-ASCII em **8 das 12** migrations — 60 travessões `—` (U+2014) mais alguns
acentuados e um `§`. Todos os arquivos são UTF-8 válido (nenhum é WIN1252).

O problema é que **6 dessas ocorrências estão dentro de literais `RAISE EXCEPTION` executáveis**,
não em comentários:

```sql
RAISE EXCEPTION 'external_ratings: provider_api nao pode ser igual a rating_source (%) — invariante 2', …
```
`20260717120000_external_intelligence_product/migration.sql:453`

E o próprio repositório documenta o perigo:

> "o cliente psql pode rodar em WIN1252 … um caractere fora desse conjunto … faz o
> `migrate deploy` **FALHAR** na aplicacao"
> — `20260721140000_tracking_event_idempotency_scope/migration.sql:6-8`

Enquanto isso, o teste que trava a regra lê **apenas a última migration**
(`tests/governance/user-platform-persistence-foundation.test.ts:193-195`).

**Calibração de severidade (P1, não P0):** o caminho de deploy realmente usado
(`Dockerfile:69` → `prisma migrate deploy`) lê os arquivos como UTF-8 e aplicou as 12 migrations
**com sucesso mais de 15 vezes** nesta auditoria. O risco é **latente e condicional** a aplicar
migration por cliente `psql` sob WIN1252. Real, mas não bloqueia o deploy atual.

---

## 5. Extensões e objetos de banco

- **`pgcrypto` no schema `public`** é obrigatório. Se faltar, o contêiner **não sobe** e imprime
  instrução explícita (`Dockerfile:69`).
- Validado sob `search_path` hostil por `db:validate:pgcrypto` (10/10) — que **não roda na CI**
  (risco **R-03**, P0).
- O schema usa funções SQL versionadas e triggers de governança (fingerprint de oferta,
  guard de exibição, cadeia de licenças `supersedes_id`), todos exercitados pelos validadores.

---

## 6. Estado do dado

**O banco está estruturalmente pronto e funcionalmente vazio.**
O seed insere apenas 5 tabelas de referência (3 idiomas, 13 países, 5 providers, 5 rating sources,
5 licenças) e **zero** entidades de entretenimento —
ver [`10-catalogo-contagens.md`](10-catalogo-contagens.md).

---

## 7. Achados de modelagem não verificados

> ⚠️ Levantados pelo agente `prisma-data-map`; a verificação adversarial **não rodou**.
> Tratar como leads.

- `search_documents(entity_type, entity_id)` e `discovery_snapshot_items.entity_id` não teriam
  integridade referencial, contra a regra D1 do próprio schema (toda referência polimórfica
  recebe FK composta para `entities`).
- As FKs compostas de `entity_keywords` e `entity_alternative_titles` seriam criadas dentro de um
  bloco `DO` condicional `IF EXISTS (entities)` — em caminho de instalação onde `entities` não
  exista, seriam **silenciosamente puladas** e nunca retentadas.
- `watch_availability_display_guard()` seria definida duas vezes com corpos diferentes; como
  `prisma migrate deploy` compara apenas **nomes** de migration, drift de corpo de função não é
  detectável pela tabela `_prisma_migrations`.
