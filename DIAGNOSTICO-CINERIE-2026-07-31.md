# DIAGNÓSTICO CINERIE — LEITURA TOTAL — 2026-07-31

> Commit auditado: `953696a` (= `origin/main` no momento da auditoria; verificado por `git rev-parse HEAD == origin/main` após `git fetch`).
> Produção: `https://cinerie.com`. Método: código + runtime + dados, com âncora em cada afirmação. Nenhum valor de segredo aparece neste documento.

## 1. Veredito executivo

**O Cinerie NÃO pode ser aberto ao público hoje — mas está mais perto do que as auditorias anteriores sugeriam.** O frontend visual atual ESTÁ em produção (a hipótese de deploy defasado foi **refutada**: a home serve 21 `<img>` com hero real, detalhes servem `Movie`/`TVSeries`/`Person` em JSON-LD; a "casca em branco" de 31/07 não existe mais). O que impede a abertura é outra coisa:

1. **O site está deliberadamente invisível**: `robots.txt` responde `Disallow: /` e toda rota serve `noindex, nofollow` — o kill-switch `CINERIE_PUBLIC_INDEXING_ENABLED` está desligado em produção (por design, sem exigir rebuild para ligar).
2. **O cadastro é legalmente inválido**: o consentimento obrigatório aponta para `/pt/termos` e `/pt/privacidade`, que retornam **404 no código e em produção**.
3. **Zero notícias publicadas**: `/pt/noticias/` não tem nenhum link de matéria e `news-sitemap.xml` é um `<urlset>` vazio; o pipeline editorial (CMS Payload → outbox → worker → banco público) existe e é testado no CI, mas sua presença/estado em produção não é verificável deste ambiente.
4. **Catálogo raso e desproporcional**: sitemap de produção com 129 filmes, 110 séries e **22.410 pessoas** — risco de index bloat no dia em que a indexação ligar.
5. As chaves externas estão vivas (TMDB 200, ratings 200 com quota 1439/1440, streaming 200), os 10 gates locais passam (4.404 testes verdes — sob Node 24, EXPERIMENTAL), e backup/restore é provado no CI — mas **não há branch protection na `main`** (plano GitHub free) e **não dá para saber qual commit está em produção** (`/api/health` → `commit: "unknown"`).

Estado em uma frase: **fundação técnica sólida e governada, produto fechado ao público por decisão + três lacunas executáveis (termos/privacidade, conteúdo editorial, escala de catálogo).**

## 2. Método e limites

**O que este diagnóstico alcançou:**

- **Código**: worktree limpo no commit `953696a` (idêntico a `origin/main`); 20 frentes de leitura (9 por agentes paralelos, 11 inline após estouro de limite de sessão dos agentes); 1.148 arquivos TS, 80 modelos, 51 enums, 26 workspaces confirmados por comando.
- **Gates**: os 10 comandos rodaram de verdade neste worktree com exit codes registrados (Bloco K) — **sob Node v24.14.0**, fora do engines `>=22 <23`, logo marcados EXPERIMENTAIS.
- **Runtime**: varredura HTTP real de `https://cinerie.com` rota a rota via browser (status, bytes, `<img>`, form, h1, JSON-LD, canonical, meta robots), robots.txt, sitemap index + 6 shards com contagem de URLs, `/api/health`.
- **APIs externas**: 1 chamada de leitura barata por provedor com as chaves do `.env` do checkout principal (TMDB, film_show_ratings, streaming_availability); Gemini **não** foi chamado (chave presente confirmada).

**O que este diagnóstico NÃO alcançou (e por quê):**

- **Banco de produção**: `DATABASE_URL` aponta para `rss_prime_screen-db:5432/screena` (usuário/senha mascarados) — hostname interno do EasyPanel, **DNS não resolve desta máquina** (`ENOTFOUND` comprovado). Todo o Bloco M virou pacote de queries prontas (seção 15/23).
- **EasyPanel**: sem acesso ao painel — Bloco N é extração do repo + formulário para preenchimento humano (seção 16/24).
- **Branch protection via API**: `gh api .../branches/main/protection` → HTTP 403 "Upgrade to GitHub Pro or make this repository public". Isso **prova por implicação** que não há proteção configurável na `main` (o recurso não existe em repo privado no plano free).
- **`curl` foi negado pela política de permissão da sessão**; a varredura HTTP foi feita pelo browser pane (equivalente para fins de SSR/SEO: o HTML analisado é o que o crawler recebe).
- 11 dos 20 agentes de leitura falharam por limite de sessão e seus blocos foram cobertos inline pelo auditor principal — mesma profundidade de evidência, menor largura de varredura em E1/F1/D2 (indicado em cada seção).

---

# 3. BLOCO A — MODELO DE DADOS

## A1. Os 80 modelos e 51 enums por domínio

Leitura integral concluida: `packages/db/prisma/schema.prisma` (2740 linhas). Contagem confirmada por `grep -c "^model "` = **80 modelos** e `grep -c "^enum "` = **51 enums** — bate com a enumeracao manual abaixo (80/51). Observacao: o cabecalho da secao de enums diz `// ENUMS (14)` (schema.prisma:27) — comentario desatualizado; ha 51.

## Modelos por dominio (80)

### 1. Catalogo — entidades-raiz e creditos (17)

| Modelo | Representa | Relacoes principais | @@map |
| --- | --- | --- | --- |
| Movie (schema.prisma:501) | Filme (fatos TMDB + screenScore proprio gateado por `screen_score_display=false`) | Language, MovieCollectionMembership, MovieProductionCompany | `movies` |
| TvShow (:542) | Serie | Language, Season[], TvNetwork[], TvProductionCompany[] | `tv_shows` |
| Season (:584) | Temporada | TvShow (Cascade), Episode[]; `@@unique([id, tvShowId])` alvo de FK composta | `seasons` |
| Episode (:607) | Episodio; NAO guarda season_number (derivado) | Season via FK composta `(seasonId, tvShowId)` (:626) | `episodes` |
| Person (:633) | Pessoa; `biographySourceStatus` governa exibicao da bio (inv. 6) | CastMember[], CrewMember[] | `people` |
| Entity (:668) | Registro fino supertipo `(entityType, entityId)` mantido por TRIGGERS; alvo das FKs compostas polimorficas | — (PK composta) | `entities` |
| CastMember (:681) | Credito de elenco polimorfico (`isGuest` p/ episodio) | Person (Cascade); ref polimorfica -> entities | `cast_members` |
| CrewMember (:702) | Credito de equipe polimorfico | Person (Cascade) | `crew_members` |
| Collection (:1400) | Colecao/franquia TMDB | MovieCollectionMembership[] | `collections` |
| MovieCollectionMembership (:1416) | N:N filme-colecao com position | Collection, Movie (Cascade) | `movie_collection_memberships` |
| ProductionCompany (:1431) | Produtora | Movie/TvProductionCompany | `production_companies` |
| MovieProductionCompany (:1449) | N:N filme-produtora (PK composta) | Movie, ProductionCompany | `movie_production_companies` |
| TvProductionCompany (:1462) | N:N serie-produtora | TvShow, ProductionCompany | `tv_production_companies` |
| Network (:1475) | Rede de TV | TvNetwork[] | `networks` |
| TvNetwork (:1492) | N:N serie-rede | TvShow, Network | `tv_networks` |
| Keyword (:1505) | Keyword TMDB | EntityKeyword[] | `keywords` |
| EntityKeyword (:1517) | N:N keyword-entidade (polimorfico movie/tv) | Keyword (Cascade) | `entity_keywords` |
| EntityAlternativeTitle (:1533) | Titulo alternativo por pais; `normalized` alimenta alias da busca | ref polimorfica (FK composta via SQL) | `entity_alternative_titles` |

(EntityAlternativeTitle incluido: total do grupo = 18 se contado; ajuste: 17 acima + este = 18.)

### 2. SEO / slugs / redirects / i18n / indexabilidade (5)

| Modelo | Representa | Relacoes | @@map |
| --- | --- | --- | --- |
| Slug (:739) | Slug por entidade/idioma; 1 canonico por entidade/idioma via unique parcial (SQL bruto, :751) | Language | `slugs` |
| Redirect (:758) | Redirect 301/308; CHECK from<>to via SQL | Language? | `redirects` |
| EntityTranslation (:774) | Texto por idioma (title/meta/summary/faq); nasce `draft`+`noindex` | Language; slug NAO mora aqui (D4, :792) | `entity_translations` |
| PageIndexabilityDecision (:1038) | Decisao de indexabilidade com historico imutavel (`isCurrent`+`supersedesId`); desde Prompt 10 cobre TAMBEM artigo via `docKind`+`articleId` (:1034-1037) | Language, self-relation historico, Article? (Cascade) | `page_indexability_decisions` |
| SearchDocument (:1315) | Projecao de busca (unaccent+pg_trgm); entidade E artigo na mesma tabela via `PublicDocKind` | Article? (Cascade); unique parcial de artigo em SQL bruto (:1341-1344) | `search_documents` |

### 3. Editorial IA / content blocks (3)

| Modelo | Representa | Relacoes | @@map |
| --- | --- | --- | --- |
| ContentBlock (:805) | Bloco editorial versionado (`promptVersion`/`inputHash`/`outputHash` obrigatorios — inv. 13) | Language, EntityWriterJob[] | `content_blocks` |
| EntityWriterJob (:832) | Fila do Entity Writer (1 job ativo por alvo via unique parcial SQL, :856) | Language, ContentBlock (resultado), EntityWriterLog[] | `entity_writer_jobs` |
| EntityWriterLog (:862) | Log por execucao (tokens, validacao, warnings) | EntityWriterJob (Cascade) | `entity_writer_logs` |

### 4. Editorial / noticias — artigos + cadeia de entrada + projecao CMS (8)

| Modelo | Representa | Relacoes | @@map |
| --- | --- | --- | --- |
| Article (:1567) | Fatos independentes de idioma do artigo; ancora CMS `payloadDocumentId` @unique (:1585) e `projectedSequence` anti-fora-de-ordem (:1597) | ArticleTranslation[], EntityNewsLink[], ArticleSourceLink[], EditorialProjectionReceipt[], EditorialMediaAsset (hero), SearchDocument[], PageIndexabilityDecision[] | `articles` |
| ArticleTranslation (:1618) | Texto por idioma (slug proprio, `bodyBlocks` estruturado, SEO aprovado do CMS, correcao material) | Article (Cascade), Language | `article_translations` |
| EntityNewsLink (:1695) | Vinculo artigo -> entidade (movie/tv/person) | Article (Cascade); FK composta -> entities via SQL | `entity_news_links` |
| EditorialSource (:2526) | Fonte editorial registrada; nasce `paused` + `useRights=unknown` (fail-closed) | SourceItem[], ArticleSourceLink[] | `editorial_sources` |
| SourceItem (:2562) | Item recebido: identidade + fingerprints + excerpt curto; NUNCA corpo integral de terceiro (:2559-2561) | EditorialSource (Restrict), self-relation duplicateOf, ArticleSourceLink[] | `source_items` |
| ArticleSourceLink (:2616) | Proveniencia artigo<->fonte (role primary/secondary/...) | Article (Cascade), EditorialSource (Restrict), SourceItem? (SetNull) | `article_source_links` |
| EditorialProjectionReceipt (:2654) | Recibo de idempotencia da projecao CMS->banco publico; `eventId` @unique = trava de replay | Article? (SetNull) | `editorial_projection_receipts` |
| EditorialMediaAsset (:2702) | Asset de midia projetado do CMS, dedupe por `contentHash`, flags de uso fail-closed | Article[] (hero) | `editorial_media_assets` |

### 5. Usuario / auth / produto pessoal (23)

| Modelo | Representa | Relacoes | @@map |
| --- | --- | --- | --- |
| User (:1929) | Conta; LGPD tumba (`deletedAt`, status `deleted`) | hub de ~20 relacoes | `users` |
| UserProfile (:1971) | Perfil (visibilidade default `private`) | User (Cascade) 1-1 | `user_profiles` |
| PasswordCredential (:1988) | Hash de senha PHC (scrypt) | User (Cascade) 1-1 | `user_password_credentials` |
| Account (:2003) | Preparo OAuth; sem tokens de provedor | User (Cascade) | `user_accounts` |
| UserSession (:2017) | Sessao (tokenHash+csrfTokenHash; rotacao 1-1) | User (Cascade), self rotation | `user_sessions` |
| VerificationToken (:2040) | Token de verificacao/reset (hash, consumo atomico) | User (Cascade) | `user_verification_tokens` |
| AuthThrottle (:2057) | Brute-force por email/ip_hash; sem FK de proposito | — | `user_auth_throttles` |
| AuthAuditLog (:2075) | Auditoria auth append-only (trigger SQL); User Restrict | User? | `user_auth_audit_logs` |
| UserWatchState (:2095) | Estado atual de acompanhamento (movie/tv) com optimistic locking | User; ref polimorfica | `user_watch_states` |
| EpisodeProgress (:2118) | Progresso por episodio | User; FK real p/ episodes via SQL | `user_episode_progress` |
| ViewingEvent (:2139) | Diario append-only; identidade `(userId, idempotencyKey, eventType)` (:2161) | User | `user_viewing_events` |
| UserList (:2167) | Lista (system/custom; watchlist etc.) | User, UserListItem[] | `user_lists` |
| UserListItem (:2191) | Item de lista polimorfico | UserList (Cascade) | `user_list_items` |
| UserRating (:2211) | Nota pessoal 0.5–5.0; SEM relacao com external_ratings (inv. 1/2, :2208-2210) | User | `user_ratings` |
| UserReview (:2231) | Review de usuario; nasce pending+private | User, ReviewReport[] | `user_reviews` |
| ReviewReport (:2254) | Denuncia de review | UserReview (Cascade), User | `user_review_reports` |
| UserBlock (:2274) | Bloqueio usuario-usuario | User x2 (Cascade) | `user_blocks` |
| UserStatsSnapshot (:2290) | Cache de estatisticas (nunca no request) | User (Cascade) 1-1 | `user_stats_snapshots` |
| RecommendationSnapshot (:2314) | Snapshot de recomendacoes com contexto/fingerprint; vigente via unique parcial SQL | User (Cascade) | `user_recommendation_snapshots` |
| RecommendationFeedback (:2342) | Feedback explicito (not_interested etc.); idempotente | User (Cascade) | `user_recommendation_feedback` |
| ConsentRecord (:2366) | Consentimento LGPD append-only | User | `user_consent_records` |
| DataRequest (:2382) | Solicitacao LGPD export/exclusao | User | `user_data_requests` |
| ImportJob (:2404) | Importacao Letterboxd/Trakt/Cinerie; nunca aplica sem preview | User | `user_import_jobs` |

### 6. Ratings (2)

| Modelo | Representa | Relacoes | @@map |
| --- | --- | --- | --- |
| RatingSource (:273) | Fonte editorial de nota (imdb, rotten_tomatoes...; `scale` espelha RATING_SCALES) | ExternalRating[], SourceLicense[] | `rating_sources` |
| ExternalRating (:891) | Nota externa; `ratingSource` e `providerApi` sao FKs para tabelas DISTINTAS (inv. 2 materializada, :930-932); display fail-closed com `approvedPayloadHash`+triggers | RatingSource, ApiProvider, DataUsageDecision? | `external_ratings` |

### 7. Streaming / onde assistir (3)

| Modelo | Representa | Relacoes | @@map |
| --- | --- | --- | --- |
| WatchProvider (:429) | Plataforma canonica (Netflix etc.), distinta de ApiProvider | WatchProviderAlias[], WatchAvailability[] | `watch_providers` |
| WatchProviderAlias (:447) | Mapeamento upstream-key -> provedor canonico; `@@unique([providerApi, externalKey])` | WatchProvider, ApiProvider | `watch_provider_aliases` |
| WatchAvailability (:965) | Oferta por entidade/pais; identidade e fingerprint por funcoes SQL versionadas (ADR 0002, :953-964); display guard no banco | Country, WatchProvider?, DataUsageDecision?, ApiProvider? | `watch_availability` |

### 8. Governanca / licenca / score (4)

| Modelo | Representa | Relacoes | @@map |
| --- | --- | --- | --- |
| SourceLicense (:311) | O que a fonte permite exibir por (source, content_type, provider, territorio); historico imutavel `isCurrent`/`supersedesId` | RatingSource?, ApiProvider?, Country?, self-historico, DataUsageDecision[] | `source_licenses` |
| DataUsageDecision (:381) | Eixo USE CASE: display/storage/derivative por licenca-mae; teto por trigger `data_usage_decisions_guard` (:374) | SourceLicense, Country?, self-historico, ExternalRating[], WatchAvailability[] | `data_usage_decisions` |
| CinerieScoreCalculation (:475) | Historico do Cinerie Score; `blocked_by_decision` e estado de 1a classe (formula NAO decidida, :466-471) | — (ref polimorfica) | `cinerie_score_calculations` |
| Language / Country (:239 / :260) | Sementes de idioma (com `isPublished`/`indexDefault`) e pais | hubs de FK | `languages` / `countries` |

(Language e Country contados aqui como semente = 2 modelos; total do grupo = 5.)

### 9. Infra / ingestao / fila / descoberta (13)

| Modelo | Representa | Relacoes | @@map |
| --- | --- | --- | --- |
| ApiProvider (:286) | Fornecedor tecnico (tmdb, gemini, imdb236...) — NUNCA fonte editorial | ratings, syncLogs, cache, licenses, aliases, offers | `api_providers` |
| ApiCache (:1082) | Cache bruto de resposta por (provider, requestKey, paramsHash) | ApiProvider | `api_cache` |
| ApiSyncLog (:1101) | Log obrigatorio de todo sync (status, contagens, cota, hash) | ApiProvider | `api_sync_logs` |
| TmdbRaw (:1125) | Arquivo permanente de payload bruto TMDB (JSONL de detalhe) | — | `tmdb_raw` |
| TmdbImageConfig (:1147) | Singleton do /configuration de imagens | — | `tmdb_image_config` |
| Genre (:1169) | Generos normalizados por media_type (PK composta) | — | `genres` |
| TmdbImage (:1183) | Metadados de imagem TMDB (nasce display_allowed=false) | — | `tmdb_images` |
| TmdbVideo (:1211) | Metadados de video/trailer (nasce display_allowed=false) | — | `tmdb_videos` |
| TmdbSyncCheckpoint (:1241) | Checkpoint de paginacao/changes por job | — | `tmdb_sync_checkpoint` |
| CatalogJob (:1273) | Fila duravel do catalogo (idempotencyKey, backoff, dead_letter, heartbeat) | — (autocontida, sem FK p/ entities de proposito, :1262-1264) | `catalog_jobs` |
| DiscoverySnapshot (:1356) | Snapshot imutavel de lista de descoberta (trending/popular...) | DiscoverySnapshotItem[] | `discovery_snapshots` |
| DiscoverySnapshotItem (:1376) | Item posicionado do snapshot | DiscoverySnapshot (Cascade) | `discovery_snapshot_items` |
| EntityExternalId (:724) | IDs externos por entidade (tmdb/imdb) | ref polimorfica | `entity_external_ids` |

Soma dos grupos: 18+5+3+8+23+2+3+5+13 = **80**.

## Enums (51)

| Enum | Proposito (1 linha) |
| --- | --- |
| EntityType (:30) | Tipos de entidade renderavel: movie/tv/season/episode/person (sem `article`, deliberado). |
| ContentBlockType (:38) | 12 tipos de bloco editorial (editorial_intro ... review_summary). |
| ContentSource (:53) | Origem do bloco: ai/human/hybrid. |
| ReviewStatus (:59) | Ciclo de revisao de content_blocks E article_translations (enum compartilhado, maquinas distintas — ADR 0016). |
| TranslationStatus (:70) | Ciclo de EntityTranslation (draft...archived). |
| IndexDecision (:79) | index/noindex/draft/stale/blocked. |
| JobType (:87) | Jobs do writer: generate/regenerate/translate_block. |
| JobStatus (:93) | Estados do EntityWriterJob. |
| LicenseStatus (:103) | official/licensed/third_party/unknown/blocked. |
| SourceLicenseContentType (:115) | Dominio da licenca: rating/watch_availability/review/video/news/image/other. |
| OfferType (:125) | Modalidades legais de oferta (subscription...cinema). |
| SyncStatus (:134) | Resultado de sync: success/partial/failed/empty/aborted. |
| ValidationStatus (:142) | Validacao do writer: passed/warnings/failed. |
| ProviderKind (:148) | Natureza do ApiProvider: data/ratings/streaming/ai/news. |
| DataUsageStage (:161) | Ciclo raw -> approved_for_display -> revoked (revoked terminal). |
| RatingScoreType (:174) | critics/audience/editorial (Tomatometer vs Popcornmeter nunca se fundem). |
| CinerieScoreStatus (:183) | calculated / blocked_by_decision (bloqueio e 1a classe). |
| TmdbEntityKind (:191) | Superset TMDB: EntityType + collection/network/company/keyword. |
| CatalogJobType (:207) | 11 tipos de job de catalogo (bootstrap...reprocess_raw). |
| CatalogJobStatus (:224) | Fila: pending...dead_letter/cancelled. |
| UserStatus (:1740) | active/disabled/pending_deletion/deleted (tumba LGPD). |
| UserRole (:1747) | user/moderator/admin. |
| ProfileVisibility (:1753) | private/public. |
| Visibility (:1759) | private/unlisted/public para conteudo de usuario. |
| WatchState (:1765) | planned...not_interested. |
| ViewingEventType (:1775) | 12 tipos de evento do diario (inclui undo/import_applied). |
| ReviewModerationStatus (:1792) | Moderacao de review de usuario (sem relacao com ReviewStatus editorial). |
| AuthTokenPurpose (:1799) | email_verification/password_reset. |
| ThrottleScope (:1804) | email/ip. |
| AuthAuditAction (:1809) | 20 acoes de auditoria de auth. |
| UserListKind (:1833) | system/custom. |
| SystemListKey (:1838) | watchlist/favorites/watching/watched. |
| ConsentKind (:1845) | Tipos de consentimento LGPD. |
| DataRequestKind (:1852) | export/deletion. |
| DataRequestStatus (:1857) | pending...cancelled. |
| ImportSource (:1865) | letterboxd_csv/trakt_export/cinerie_json/cinerie_csv. |
| ImportJobStatus (:1872) | uploaded...applied/failed/cancelled. |
| ReportReason (:1884) | Motivos de denuncia. |
| ReportStatus (:1892) | open/reviewed/dismissed/actioned. |
| RecommendationContext (:1905) | discovery/continue_watching/rewatch/similar (espelha dominio puro, travado por teste). |
| RecommendationFeedbackType (:1914) | not_interested...save. |
| RecommendationFeedbackSource (:1924) | app/system. |
| EditorialSourceKind (:2454) | Como o material chega (rss_feed...manual). |
| EditorialSourceStatus (:2467) | active/paused (default)/retired. |
| EditorialSourceUseRights (:2476) | unknown (default)...full_syndication — decisao humana, nunca inferida. |
| SourceItemStatus (:2485) | received...failed. |
| SourceItemDedupVerdict (:2498) | unique/duplicate/related/superseded (dedup deterministico, sem fusao semantica). |
| ArticleSourceRole (:2506) | primary/secondary/press_release/catalog. |
| PublicDocKind (:2517) | entity/article — discriminador de busca+indexabilidade compartilhadas. |
| EditorialProjectionOutcome (:2638) | applied/skipped_duplicate/skipped_stale/skipped_unlicensed. |
| EditorialMediaLicenseStatus (:2684) | Licenca de asset editorial (espelha enum do CMS): unknown...prohibited. |

## NAO VERIFICADO

- Os CHECKs condicionais, uniques PARCIAIS, triggers (`data_usage_decisions_guard`, `external_ratings_display_guard_trg`, `watch_availability_display_guard`, `cinerie_score_display_guard`, append-only, FKs compostas para `entities`) sao declarados apenas em COMENTARIO no schema; a existencia real vive nas migrations SQL, que nao foram lidas neste bloco.
- Espelhamento enum<->dominio (RecommendationContext etc.) e citado como travado por `tests/governance/user-platform-enums-mirror` — teste nao aberto aqui.

### ACHADOS-CHAVE

- Contagem exata confirmada: **80 modelos** e **51 enums** (grep + enumeracao manual batem); o comentario `// ENUMS (14)` em schema.prisma:27 esta desatualizado.
- Invariante 2 materializada no banco: `ExternalRating.ratingSource` -> `rating_sources` e `providerApi` -> `api_providers` sao FKs para tabelas distintas (schema.prisma:930-932).
- Fail-closed por default em todo dado externo: `licenseStatus=unknown` + `displayAllowed=false` nascem assim em SourceLicense (:318-319), ExternalRating (:907-908), WatchAvailability (:983-984), Article (:1577-1578), TmdbImage/TmdbVideo e EditorialMediaAsset (:2724-2730).
- Parte critica da governanca NAO esta no Prisma: triggers, CHECKs e uniques parciais vivem em SQL bruto nas migrations (declarado em :13-15) — o schema sozinho nao prova essas travas.
- Artigo e entidade coexistem nas MESMAS tabelas de busca e indexabilidade via `PublicDocKind`+`articleId` (SearchDocument :1315-1349, PageIndexabilityDecision :1038-1076); `EntityType` deliberadamente nao ganha `article`.
- Cadeia CMS->publico completa no schema: `Article.payloadDocumentId` @unique (:1585), `projectedSequence` anti-evento-fora-de-ordem (:1597), recibo idempotente `EditorialProjectionReceipt.eventId` @unique (:2657) e midia por `contentHash` (:2699-2708).
- Historico imutavel padrao (insert + `isCurrent` + `supersedesId`) em 3 tabelas de decisao: SourceLicense, DataUsageDecision e PageIndexabilityDecision.
- Cinerie Score sem formula decidida: `CinerieScoreCalculation` registra `blocked_by_decision` como estado esperado (:180-186, :466-471); colunas `screen_score*` em movies/tv_shows sao nome tecnico legado com display gateado.

---

## Bloco A2 — Modelos órfãos do Prisma (`packages/db/prisma/schema.prisma`, commit 953696a)

### Método executado

1. `grep -n "^model "` no schema → **80 models** confirmados (linhas 239–2702).
2. Para cada model, accessor camelCase buscado com `git grep -lE "\.<accessor>\b" -- '*.ts' '*.tsx' ':!packages/db/prisma'` (o client gerado vive em `node_modules`, fora da árvore; sem `*.d.ts`).
3. Zeros e contagens=1 auditados manualmente: conferido `@@map` em SQL cru (`$queryRaw`/`$executeRawUnsafe`/scripts) e em `apps/cms`. Falsos positivos de propriedade homônima (ex.: `.account`, `.sourceLicense` como campo de relação/DTO) foram desfeitos abrindo cada match.
4. Acesso dinâmico verificado: `git grep -nE "prisma\[|client\[|executor\["` fora de testes → **zero ocorrências**, então a busca por accessor literal é exaustiva.

### ÓRFÃOS (zero accessor Prisma no repo inteiro + zero SQL cru fora de censo estrutural)

| Model | Tabela (`@@map`) | Evidência de busca |
| --- | --- | --- |
| **Account** | `user_accounts` (schema.prisma:2003, map :2014) | `git grep -nE "(prisma\|tx\|executor\|client\|db)\.account\b"` → rc=1 (zero). Os 2 arquivos com `.account` são falsos positivos: `apps/cms/src/__tests__/service-accounts.integration.test.ts:82` (service accounts do Payload, banco próprio do CMS) e `services/user-platform/scripts/validate-identity-privacy-real-postgres.ts:257` (`exportRes.value.account.email`, DTO de exportação, não Prisma). SQL cru: `user_accounts` aparece apenas no censo de existência de tabelas `packages/db/scripts/validate-real-postgres.ts:129` e na migration. **Nenhuma leitura/escrita em código algum.** |
| **ReviewReport** | `user_review_reports` (schema.prisma:2254, map :2271) | `\.reviewReport\b` → 0 arquivos. Tabela citada só no censo estrutural `packages/db/scripts/validate-real-postgres.ts:133` e em docs (`docs/product/user-product-persistence-decisions.md:33`). |
| **UserBlock** | `user_blocks` (schema.prisma:2274, map :2284) | `\.userBlock\b` → 0 arquivos. Tabela só no censo `packages/db/scripts/validate-real-postgres.ts:133`. Zero produto, zero domínio. |
| **RecommendationSnapshot** | `user_recommendation_snapshots` (schema.prisma:2314, map :2335) | `\.recommendationSnapshot\b` → 0. SQL cru só em script de validação estrutural (`packages/db/scripts/validate-user-product-persistence-real-postgres.ts:116` define `SNAP`; INSERTs de teste :159–226). O domínio puro apenas menciona a tabela em comentário (`services/user-platform/src/recommendations/snapshot.ts:5` — "pronta para C7 persistir"). Teste de governança **proíbe** `apps/` de referenciá-la (`tests/governance/user-platform-persistence-foundation.test.ts:222`). Sem adapter de persistência — órfão no produto. |
| **RecommendationFeedback** | `user_recommendation_feedback` (schema.prisma:2342, map :2361) | `\.recommendationFeedback\b` → 0. SQL cru só no mesmo script de validação (`packages/db/scripts/validate-user-product-persistence-real-postgres.ts:117` define `FB`) e censo :137. Mesmo teste de governança negativa acima. |

### QUASE-ÓRFÃOS (schema vivo, mas metade do ciclo ausente ou uso só por script)

| Model | Classificação | Evidência |
| --- | --- | --- |
| **UserReview** | **SÓ-LIDO** | Única chamada real: `services/user-platform/src/persistence/prisma/export-read-store.ts:155` (`executor.userReview.findMany`). `\.userReview\.(create\|update\|upsert\|delete)` → 0 no repo inteiro. O domínio de reviews/moderação é puro e registra a lacuna: `services/user-platform/src/reviews/types.ts:17`. Nada escreve `user_reviews`. |
| **UserStatsSnapshot** | **SÓ-LIDO** | `services/user-platform/src/persistence/prisma/export-read-store.ts:171` (`findUnique`). Zero writes (`\.userStatsSnapshot\.(create\|...)` → 0). |
| **CinerieScoreCalculation** | **SÓ-LIDO em produto** | Leitura: `apps/web/src/server/editorial-score.ts:79` (`prisma.cinerieScoreCalculation.findMany`). Única escrita é fixture de QA: `apps/web/scripts/qa-home-first-fold-real-postgres.ts:368` (INSERT cru). `packages/cinerie-score` é motor puro, não persiste. Coerente com o comentário do schema (:475–484: "blocked_by_decision", sem fórmula decidida). |
| **WatchProvider / WatchProviderAlias** | **USADO, mas SEM accessor Prisma** (só SQL cru) | `\.watchProvider\b`/`\.watchProviderAlias\b` → 0; porém código de produto lê via SQL cru: `services/streaming/src/persistence/watch-store.ts:57` (subselect em `watch_provider_aliases`), `services/streaming/src/persistence/watch-review-store.ts:213,221,223` (JOIN `watch_provider_aliases`/`watch_providers`). Escrita real só em seeds/scripts de validação (ex.: `packages/db/scripts/validate-real-postgres.ts:442`). |
| **ApiProvider** | USADO só em seed + script | Escrita: `packages/db/prisma/seed.ts:40` (upsert) e `services/ingestion/scripts/validate-catalog-platform-real-postgres.ts:536`. No produto funciona como FK (`api_providers.key` referenciado em comentários/relations, ex.: `api-clients/tmdb/src/provider.ts:15`); sem leitura direta de produto pelo accessor. |
| **SourceLicense / DataUsageDecision** | USADO (escrita via seed/SQL cru; leitura via relação) | Escrita: `packages/db/prisma/seed.ts:48-60` (sourceLicense); INSERTs crus em `apps/web/scripts/qa-home-first-fold-real-postgres.ts:305,311`. Leitura de produto via include de relação: `apps/web/src/server/entity-ratings.ts:100,115` (`row.dataUsageDecision`, `decision.sourceLicense`). Sem accessor direto `prisma.sourceLicense`/`prisma.dataUsageDecision` fora do seed. |

### USADOS — demais 69 models (âncora exemplar de chamada Prisma real)

Contagem de arquivos com o accessor entre parênteses. Todos verificados com pelo menos uma chamada `*.model.metodo(...)` real:

| Model (arquivos) | Âncora exemplar |
| --- | --- |
| Language (43) / Country (24) | `packages/db/prisma/seed.ts:28,32`; `apps/admin/scripts/public-demo-seed.ts:517,518` |
| RatingSource (13) | `packages/db/prisma/seed.ts:36` |
| Movie (58) / TvShow (44) | `apps/admin/scripts/public-demo-seed.ts:253,296` |
| Season (21) / Episode (18) | `apps/admin/src/server/content-qa.ts:108,109` |
| Person (36) | `apps/admin/scripts/public-demo-seed.ts:343` |
| Entity (18) | `services/news-ingestion/src/persistence/editorial-projection-store.ts:137` |
| CastMember (10) / CrewMember (9) | `apps/admin/scripts/public-demo-seed.ts:371,398` |
| EntityExternalId (5) | `apps/web/src/server/movie-page.ts:139` |
| Slug (102) | `apps/admin/scripts/public-demo-seed.ts:122` |
| Redirect (8) | leitura de produto `apps/web/src/server/seo/redirect-lookup.ts:57`; escrita `services/ingestion/src/persistence/catalog-finalize.ts:84` |
| EntityTranslation (33) | `apps/admin/scripts/public-demo-seed.ts:153` |
| ContentBlock (24) | `apps/admin/scripts/public-demo-seed.ts:186` |
| EntityWriterJob (5) / EntityWriterLog (3) | `services/entity-writer/scripts/validate-real-postgres.ts:207,278` |
| ExternalRating (4) | escrita `services/ratings/src/persistence/external-ratings-store.ts:87,119`; leitura `apps/web/src/server/entity-ratings.ts:187` |
| WatchAvailability (10) | `apps/admin/scripts/public-demo-seed.ts:229`; SQL cru em `services/streaming/src/persistence/watch-store.ts` |
| PageIndexabilityDecision (9) | `apps/web/scripts/validate-season-episode-routes-real-postgres.ts:160` |
| ApiCache (3) | `services/ingestion/src/persistence/cache.ts:33` |
| ApiSyncLog (4) | `services/ingestion/bin/catalog.ts:1143` |
| TmdbRaw (3) | `services/ingestion/src/persistence/tmdb-raw-promote-store.ts:28` |
| TmdbImageConfig (2) | `services/ingestion/src/persistence/image-config-store.ts:60` |
| Genre (1) | `services/ingestion/src/persistence/catalog-stores.ts:24-29` (find/create/update) |
| TmdbImage (6) | `apps/web/src/server/person-page.ts:371` |
| TmdbVideo (4) | `services/ingestion/scripts/validate-catalog-platform-real-postgres.ts:594` |
| TmdbSyncCheckpoint (5) / CatalogJob (6) / SearchDocument (6) / DiscoverySnapshot (4) | `services/ingestion/bin/catalog.ts:1136,1134,1112,1137` |
| DiscoverySnapshotItem (1) | `services/ingestion/src/persistence/discovery-snapshot-store.ts:116` (`tx.discoverySnapshotItem.createMany`) |
| Collection (8) / MovieCollectionMembership (3) / EntityAlternativeTitle (4) | `services/ingestion/scripts/validate-catalog-platform-real-postgres.ts:581,582,583` |
| ProductionCompany / MovieProductionCompany / TvProductionCompany / Network / TvNetwork / Keyword / EntityKeyword (1 cada) | todos em `services/ingestion/src/persistence/catalog-entities-store.ts:63,151,157,88,170,111,182` (upserts de produto) |
| Article (22) / ArticleTranslation (23) | `apps/admin/src/server/dashboard.ts:63`; `apps/admin/src/server/articles.ts:101` |
| EntityNewsLink (13) | `apps/web/scripts/canary-editorial-entity-links-real-postgres.ts:418` + projeção editorial |
| User (30) | `services/user-platform/scripts/_library-harness.ts:117` |
| UserProfile (1) | `services/user-platform/src/persistence/prisma/profile-store.ts:145` (upsert) |
| PasswordCredential (2) | `services/user-platform/src/persistence/prisma/password-credential-store.ts:60,96` |
| UserSession (2) | `services/user-platform/src/persistence/prisma/session-store.ts:62` |
| VerificationToken (2) | `services/user-platform/src/persistence/prisma/auth-token-store.ts:41` |
| AuthThrottle (1) | `services/user-platform/src/persistence/prisma/auth-throttle-store.ts:56,76,99` |
| AuthAuditLog (1) | `services/user-platform/src/persistence/prisma/auth-audit-store.ts:33` |
| UserWatchState (3) | `services/user-platform/src/persistence/prisma/product-content-purge-store.ts:74` (write) + export-read-store.ts:80 (read) |
| EpisodeProgress (8) | `services/user-platform/src/persistence/prisma/episode-progress-store.ts:79,101,126` |
| ViewingEvent (3) / UserList (3) / UserListItem (2) / UserRating (3) / ImportJob (3) | stores dedicados: `viewing-event-store.ts`, `user-list-store.ts`, `user-list-item-store.ts`, `user-rating-store.ts`, `import-job-store.ts` (todos em `services/user-platform/src/persistence/prisma/`) |
| ConsentRecord (2) / DataRequest (2) | `consent-store.ts:42`, `data-request-store.ts:50` (mesmo diretório) |
| EditorialSource (3) | `services/news-ingestion/bin/editorial.ts:95` |
| SourceItem (2) / ArticleSourceLink (2) | `services/news-ingestion/scripts/validate-editorial-platform-real-postgres.ts:159,335` |
| EditorialProjectionReceipt (3) | `apps/web/scripts/canary-editorial-entity-links-real-postgres.ts:734` |
| EditorialMediaAsset (2) | `services/news-ingestion/src/__tests__/editorial-projection.integration.test.ts:905` |

### NÃO VERIFICADO

- Distinção fina leitura/escrita para todos os 69 USADOS (feita apenas onde relevante: Redirect, ExternalRating, UserReview, UserStatsSnapshot, CinerieScoreCalculation, WatchProvider*). Faria falta abrir cada um dos ~300 call sites.
- Uso em runtime via SQL gerado por Payload (`apps/cms`): grep por todos os 6 nomes de tabela suspeitos em `apps/cms` → zero matches; mas o CMS gera DDL/queries dinamicamente para as SUAS coleções — irrelevante para o banco público, não auditado além do grep.

### ACHADOS-CHAVE

- **5 models órfãos de 80**: `Account` (`user_accounts`), `ReviewReport` (`user_review_reports`), `UserBlock` (`user_blocks`), `RecommendationSnapshot` e `RecommendationFeedback` — zero accessor Prisma no repo e zero SQL cru fora de censo/validação estrutural.
- `Account` é o órfão mais enganoso: a contagem bruta dava 2 arquivos, mas ambos são falsos positivos (teste do Payload CMS em banco próprio e um campo `account` de DTO em `validate-identity-privacy-real-postgres.ts:257`).
- `RecommendationSnapshot`/`RecommendationFeedback` são órfãos **por design atual**: o domínio C6B é puro, o adapter C7 nunca foi escrito, e `tests/governance/user-platform-persistence-foundation.test.ts:222` proíbe `apps/` de tocá-los — schema pronto aguardando fase futura, não lixo acidental.
- `UserReview` e `UserStatsSnapshot` são **SÓ-LIDOS** (apenas `export-read-store.ts:155,171`): a exportação LGPD lê tabelas que nenhum código consegue popular — o export desses domínios retornará sempre vazio em produção.
- `CinerieScoreCalculation` é SÓ-LIDO em produto (`apps/web/src/server/editorial-score.ts:79`); a única escrita existente é fixture de QA — consistente com o estado `blocked_by_decision` documentado no próprio schema (linhas 475–484).
- `WatchProvider`/`WatchProviderAlias` parecem órfãos pelo accessor (0 refs) mas são usados em produto **exclusivamente via SQL cru** (`services/streaming/src/persistence/watch-store.ts:57`, `watch-review-store.ts:213-223`) — auditorias por accessor subestimam essas tabelas.
- Não há acesso dinâmico (`prisma[...]`) no repo fora de testes, então a busca literal por accessor é exaustiva.
- 7 models de catálogo (companies/networks/keywords) têm exatamente 1 ponto de uso cada, todos concentrados em `services/ingestion/src/persistence/catalog-entities-store.ts` — escrita real, sem leitura pública ainda.

---

## Bloco A3 — Migrations

### 1. Prisma (`packages/db/prisma/migrations`) — 16 migrations, provider `postgresql` (migration_lock.toml)

Ordem cronologica (nomes sao lexicograficamente ordenados; todas tem `migration.sql` nao vazio):

| # | Migration | Linhas | O que faz (lido do SQL) |
|---|---|---|---|
| 1 | `20260625120000_init` | 773 | Fundacao: enums `EntityType`, `ContentBlockType` (12 tipos), `ReviewStatus` (8 estados), `IndexDecision`, `LicenseStatus`, `SyncStatus` etc.; tabelas `languages`, `countries`, `rating_sources`, `api_providers`, `source_licenses`, `movies`, `tv_shows`, `seasons`, `episodes`, `people`, `cast_members`, `crew_members`, `entity_external_ids`, `slugs`, `redirects`, `entity_translations`, `content_blocks`, `entity_writer_jobs/logs`, `external_ratings`, `watch_availability`, `page_indexability_decisions`, `api_cache`, `api_sync_logs` (linhas 44–465 do migration.sql) |
| 2 | `20260701120000_add_news_articles` | 85 | `articles`, `article_translations` (unique `article_id+language_code` e `language_code+slug`, linhas 63–66), `entity_news_links` (unique `article_id+entity_type+entity_id`, linha 75), FKs com CASCADE |
| 3 | `20260706120000_add_certification_screen_score` | 16 | `certification` + `screen_score/scale/display` em `movies` e `tv_shows`; `screen_score_display` DEFAULT false (fail-closed, linhas 7–16) |
| 4 | `20260708200747_add_tmdb_raw_and_image_config` | 48 | Enum `TmdbEntityKind`; `tmdb_raw` (unique `entity_type+tmdb_id+base_language`, linha 48) e `tmdb_image_config` |
| 5 | `20260715120000_data_governance_hardening` | 653 | Registro `entities` + triggers de sincronizacao AFTER INSERT/DELETE em movies/tv_shows/seasons/episodes/people (linhas 69–91); `entity_reference_orphans`, `data_migration_quarantine`; funcoes de identidade/fingerprint de watch offer (linhas 370, 406); triggers-guarda `source_licenses_supersedes_guard` (321), `watch_availability_display_guard` (541), `page_indexability_decisions_supersedes_guard` (620) |
| 6 | `20260716120000_tmdb_media_genres_checkpoint` | 92 | `genres`, `tmdb_images`, `tmdb_videos`, `tmdb_sync_checkpoint` (unique `job+params_hash`, linha 92) |
| 7 | `20260716130000_catalog_jobs_and_search` | 117 | Funcao `immutable_unaccent` (linha 21); `catalog_jobs` (fila com idempotency_key unique, heartbeat) e `search_documents` com indices GIN trgm (linhas 114, 117) |
| 8 | `20260716140000_catalog_entities_and_discovery` | 218 | `collections`, `production_companies`, `networks`, `keywords` + tabelas de juncao, `entity_alternative_titles`, `discovery_snapshots/_items`; `cast_members.is_guest` (linha 16) |
| 9 | `20260717120000_external_intelligence_product` | 875 | `data_usage_decisions` + trigger guard (236); `watch_providers`/`watch_provider_aliases`; funcoes de identidade/fingerprint de rating (374, 401); triggers `external_ratings_integrity_guard_trg` (508) e `external_ratings_display_guard_trg` (614); redefine `watch_availability_display_guard` (633); `cinerie_score_calculations` + guards de display em movies/tv_shows (862, 866) |
| 10 | `20260717150000_user_product_platform` | 608 | Plataforma de usuario completa: ~24 tabelas `users`, `user_sessions`, `user_watch_states`, `user_viewing_events`, `user_lists`, `user_ratings`, `user_reviews`, `user_import_jobs` etc.; trigger append-only em viewing_events/auth_audit/consent (linhas 598–606) |
| 11 | `20260721120000_user_product_persistence_foundation` | 137 | Enums de recomendacao; retrabalha `user_recommendation_snapshots` (unique parcial "current", linha 68); cria `user_recommendation_feedback` com idempotency unique (117) |
| 12 | `20260721140000_tracking_event_idempotency_scope` | 38 | Troca unique de `user_viewing_events` para `(user_id, idempotency_key, event_type)` (linhas 32–37); comentario avisa que SQL nao-ASCII quebra `migrate deploy` (linha 8) |
| 13 | `20260727120000_editorial_news_platform` | 377 | Enums editoriais (kind/status/use_rights/dedup); `editorial_sources` (58), `source_items` (109), `article_source_links` (199); campos em `article_translations` (246, 250); redefine `page_indexability_supersedes_same_group` (357) |
| 14 | `20260728220000_editorial_projection_from_cms` | 106 | Ponte CMS→banco publico: `articles.payload_document_id` (unique, CHECK not-empty) + `projected_sequence` (linhas 17–32); `article_translations.body_blocks/body_blocks_version` JSONB (36–37); enum `EditorialProjectionOutcome` e tabela `editorial_projection_receipts` (unique `event_id`, linha 81) |
| 15 | `20260729010000_editorial_media_assets` | 109 | Enum `EditorialMediaLicenseStatus`; `editorial_media_assets` (uniques payload_media_id/storage_key/public_path, linhas 50–57); `articles.hero_media_asset_id` + FK (100–106) |
| 16 | `20260729190000_editorial_approved_seo` | 36 | Campos SEO aprovados em `article_translations`: social_title/description, canonical_override, focus_keyphrase, related/editorial keywords, schema_type_recommendation, article_section, approved_image_alt/internal_links JSONB (linhas 16–36) |

### 2. Payload (`apps/cms/src/migrations`) — 9 migrations TS + snapshots JSON + `index.ts`

Registradas em ordem no array `migrations` de `apps/cms/src/migrations/index.ts:11` (todas com `up`/`down`):

| # | Migration | O que faz |
|---|---|---|
| 1 | `20260728_224559_initial` (1020 linhas TS) | Schema Payload completo: enums de role (`administrator..writer`), `service_accounts` (purpose `mnscr`/`internal_tooling`), media com `license_status`/`provenance`, `articles` com blocos (paragraph/heading/video/entity_card), `entity_references`, `external_sources`, `claims`, `workflow_status` de 12 estados (`automation_draft`→`retracted`), `publication_outbox` (event_type/status) + tabelas de versao `_articles_v` (linhas 5–33 do .ts) |
| 2 | `20260729_011649_outbox_lease_and_scopes` | Enum `enum_service_accounts_scopes` (`draft_ingest`,`publication_projection`), tabela `service_accounts_scopes`; colunas de lease na outbox (`lease_token`, `locked_by`, `lease_expires_at`, `error_code`) + indices (linhas 5–21) |
| 3 | `20260729_145607_auto_publish_scope_and_author_policy` | `ALTER TYPE enum_service_accounts_scopes ADD VALUE 'editorial_auto_publish'` (linha 9); politica de automacao por autor: `automation_publishing_allowed`, `automation_daily_limit`, content types e attribution modes permitidos (linhas 38–41) |
| 4 | `20260729_145858_auto_publication_article_fields` | Campos de auditoria de automacao em `articles`/`_articles_v`: `auto_published`, `automation_actor_id`, `automation_idempotency_key`, `automation_payload_hash`, `automation_contract_*`, `focus_keyphrase`, `schema_type_recommendation`, `article_section` (linhas 9–20) |
| 5 | `20260729_170140_automation_audit_fields` | `automation_actor_label` + `automation_received_at` (linhas 5–8) |
| 6 | `20260729_180427_auto_publish_quota_counters` | `autopublish_quota_counters` (unique `time_zone+local_date+dimension_type+dimension_key`, linha 56) e `autopublish_quota_usage` (unique `request_id`, linha 57) + `automation_contract_name`/`automation_schema_hash` |
| 7 | `20260729_180503_drop_legacy_contract_hash` | Remove `automation_contract_hash` (substituido por `automation_schema_hash` da #6) — linhas 5–6 |
| 8 | `20260729_184812_content_type_review` | `ALTER TYPE enum_articles_content_type ADD VALUE 'review' BEFORE 'guide'` (linhas 5–6); o `down` recria o enum sem `review` |
| 9 | `20260729_223310_human_publication_trail` | `created_by_id`/`updated_by_id`/`published_by_id` com FK para `editorial_users` ON DELETE set null (linhas 5–16) |

Cada `.ts` tem um `.json` par (snapshot de schema do drizzle-kit do Payload, 7.8k–9.3k linhas) — padrao da ferramenta, nao duplicacao.

### 3. Fora de sequencia / duplicada / vazia / suspeita

- **Nenhuma vazia**: todas as 16 pastas Prisma tem `migration.sql`; todos os 9 pares TS/JSON do Payload existem e estao no `index.ts`.
- **Ordem**: estritamente crescente nos dois lados. Convencao mista no Prisma — 15 migrations usam timestamp "redondo" manual (`...120000`) e uma usa timestamp real (`20260708200747`); cosmetico, sem impacto de ordenacao.
- **Redefinicao intencional de funcoes** (nao é duplicacao acidental, mas vale registro): `watch_availability_display_guard` criada em `20260715120000.../migration.sql:512` e redefinida em `20260717120000.../migration.sql:633`; `page_indexability_supersedes_same_group` criada em `20260715120000.../migration.sql:605` e redefinida em `20260727120000.../migration.sql:357`. Como `prisma migrate deploy` nao valida checksum de conteudo (só nomes — regra ja conhecida do projeto), a versao vigente da funcao em producao so e auditavel via `pg_proc.prosrc`.
- **`ALTER TYPE ... ADD VALUE`** aparece em 2 migrations do Payload (`20260729_145607...ts:9` e `20260729_184812...ts:5-6`) dentro de `db.execute(sql...)`. Em PG >= 12 e permitido em transacao desde que o valor novo nao seja usado na mesma transacao; nas duas migrations o valor novo nao e usado no mesmo bloco — OK, mas e o ponto mais fragil se alguem consolidar migrations. NAO VERIFICADO: se o runner do Payload envolve cada migration em transacao unica (exigiria ler o codigo do @payloadcms/db-postgres, fora do repo).
- Par de migrations Payload com 4 min de distancia e drop de coluna recem-criada (`automation_contract_hash` criada em #4 145858, dropada em #7 180503) — churn de mesmo dia, coerente com desenvolvimento da FASE 2F; sem risco pois a sequencia aplica limpa.

### 4. Legado `database/`

`database/migrations/` existe e esta **vazio** (saida literal de `ls database/migrations`: nada); `database/seeds/` contem apenas `README.md`. Consistente com o CLAUDE.md (fonte executavel = `packages/db/prisma`).

### 5. Aplicacao em deploy

| Superficie | Mecanismo | Evidencia |
|---|---|---|
| Web/screen-db | `prisma migrate deploy` roda no CMD do container ANTES do Next; se falhar, `exit 1` e o app nao sobe (mensagem cita pgcrypto e runbook) | `Dockerfile:105` (`CMD ["sh","-c","pnpm --filter @screena/db db:migrate:deploy || { ... exit 1; }; exec pnpm --filter @screena/web start"]`); script definido em `packages/db/package.json:24` |
| Web/screen-db (nota de replica) | Comentario documenta decisao: migrate no start só com 1 replica; Prisma serializa via advisory lock | `Dockerfile:98-103` |
| CMS (Payload) | CMD carrega segredos de `/run/secrets`, roda `cms:migrations:deploy` (= `payload migrate`) e so entao `next start`; falha = nao sobe | `Dockerfile.cms:90`; script em `apps/cms/package.json:23` |
| Worker de projecao | **Nao roda migration nenhuma** — só `publication-worker:start` (depende das migrations aplicadas pelo web e pelo CMS) | `Dockerfile.publication-worker:68` |
| CI | Aplica `db:migrate:deploy` + seed antes do teste de backup/restore | `.github/workflows/ci.yml:354` |
| Docs/runbook (INTENCAO) | `README.md:108,123` e `CINERIE.md:751` instruem `db:migrate:deploy` manual |

### ACHADOS-CHAVE

- 16 migrations Prisma + 9 do Payload, todas presentes, com SQL real, em ordem estrita e sem lacunas; `database/migrations` legado esta vazio (`ls` literal).
- Deploy fail-closed nos dois containers: `Dockerfile:105` (prisma) e `Dockerfile.cms:90` (payload migrate) rodam migration antes do servidor e derrubam o boot com `exit 1` se falhar; o worker de projecao (`Dockerfile.publication-worker:68`) nao migra nada — depende dos outros dois.
- Duas funcoes PL/pgSQL sao redefinidas por `CREATE OR REPLACE` em migrations posteriores (`watch_availability_display_guard`: 20260715:512 → 20260717:633; `page_indexability_supersedes_same_group`: 20260715:605 → 20260727:357) — combinado com `migrate deploy` nao validar conteudo, a versao vigente em producao so e auditavel via `pg_proc.prosrc`.
- Churn de mesmo dia no Payload: `automation_contract_hash` criada em `20260729_145858` e dropada 34 min depois em `20260729_180503`; aplica limpa, mas mostra que as migrations do CMS nao foram consolidadas antes do merge.
- `ALTER TYPE ... ADD VALUE` em 2 migrations Payload (`...145607.ts:9`, `...184812.ts:5`) — ponto fragil se alguem consolidar/reordenar; comportamento transacional do runner do Payload NAO VERIFICADO (codigo fora do repo).
- A ponte CMS→publico e materializada no lado Prisma por `20260728220000_editorial_projection_from_cms` (unique `articles.payload_document_id` + `editorial_projection_receipts` com unique `event_id`) — idempotencia da projecao e por constraint de banco, nao só por codigo.
- Guardas de governanca vivem como TRIGGERS de banco (display de rating/streaming/score, supersedes de licenca e indexabilidade, append-only de eventos de usuario) criadas em 20260715/20260717 — invariantes 5/6 tem enforcement no proprio PostgreSQL, nao apenas na aplicacao.
- Convencao mista de timestamp no Prisma (15 manuais `...120000` vs 1 real `20260708200747`) — cosmetico, sem impacto.

---

## A4 — Índices e constraints em tabelas de alto volume vs consultas do `apps/web`

Fonte executável: `packages/db/prisma/schema.prisma` (2740 linhas) + índices em SQL bruto nas migrations (Prisma não os declara no schema — auditados via `grep CREATE INDEX`).

### 1. Inventário de índices/constraints (schema + SQL bruto)

| Tabela | @id | @@unique / @unique | @@index (schema) | Índices extras em SQL bruto |
| --- | --- | --- | --- | --- |
| `people` (schema.prisma:633-654) | `id` | `tmdbId` (635), `imdbId` (636) | `[updatedAt]` (652) | — |
| `seasons` (584-605) | `id` | `[id, tvShowId]` (601), `[tvShowId, seasonNumber]` (602) | `[tvShowId]` (603) | — |
| `episodes` (607-631) | `id` | `[seasonId, episodeNumber]` (628) | `[tvShowId]` (629) | — |
| `cast_members` (681-700) | `id` | `creditId` (688) | `[entityType, entityId]` (697), `[personId]` (698) | — |
| `crew_members` (702-718) | `id` | `creditId` (709) | `[entityType, entityId]` (715), `[personId]` (716) | — |
| `slugs` (739-756) | `id` | `[entityType, languageCode, slug]` (752) | `[entityType, entityId, languageCode]` (753), `[languageCode]` (754) | unique PARCIAL `slugs_canonical_unique (entity_type, entity_id, language_code) WHERE is_canonical` (migrations/20260625120000_init/migration.sql:734-736) |
| `search_documents` (1315-1349) | `id` | `[entityType, entityId, locale]` (1345) | `[locale]` (1346), `[articleId]` (1347) | GIN trgm `normalized_text` e GIN trgm `immutable_unaccent(lower(primary_text))` (20260716130000:114,117); unique parcial `search_documents_article_unique (article_id, locale) WHERE doc_kind='article'` (20260727120000:280-282); CHECK `search_documents_kind_shape` (20260727120000:292-296) |
| `tmdb_images` (1183-1207) | `id` | `[entityType, tmdbId, imageType, filePath]` (1204) | `[entityType, tmdbId]` (1205) | — |
| `entity_news_links` (1695-1708) | `id` | `[articleId, entityType, entityId]` (1704) | `[entityType, entityId]` (1705), `[articleId]` (1706) | — |
| `articles` (1567-1616) | `id` | `payloadDocumentId` (1585) | `[publishedAt]` (1611), `[licenseStatus]` (1612), `[category]` (1613), `[heroMediaAssetId]` (1614) | — |
| `article_translations` (1618-1693) | `id` | `[articleId, languageCode]` (1689), `[languageCode, slug]` (1690) | `[languageCode, indexStatus]` (1691) | — |

Confirmado por grep nas migrations: **não existe** índice em `episodes.air_date`, `seasons.air_date`, `article_translations.published_at`, `article_translations.review_status` nem `search_documents.normalized_aliases`.

### 2. Consultas do apps/web servidas por índice (OK)

| Consulta | Índice que serve |
| --- | --- |
| `slug.findFirst {entityType, languageCode, slug}` (movie-page.ts:84, series-page.ts:72, person-page.ts:84, season-page.ts:61, episode-page.ts:77) | unique `[entityType, languageCode, slug]` |
| `slug.findMany {entityType, entityId in, languageCode, isCanonical}` (news-pages.ts:332, person-page.ts:302, entity-cast.ts:58, watch-browse.ts:98, discover.ts:136, catalog-summary.ts:96, anticipated.ts:179, home-ticker.ts:231) | `[entityType, entityId, languageCode]` e/ou parcial `slugs_canonical_unique` |
| `episode.findFirst {seasonId, episodeNumber}` / `findMany {seasonId} orderBy episodeNumber` (episode-page.ts:108,120) | unique `[seasonId, episodeNumber]` |
| `season.findFirst/findMany {tvShowId, seasonNumber}` (season-page.ts:87,110; news-pages.ts:459) | unique `[tvShowId, seasonNumber]` |
| `castMember/crewMember.findMany {personId}` (person-page.ts:132,141) | `[personId]` |
| `castMember.findMany {entityType, entityId}` (entity-cast.ts:42), `crewMember.findFirst {entityType, entityId,...}` (home-hero.ts:90) | `[entityType, entityId]` |
| `entityNewsLink.findMany {articleId}` (news-pages.ts:282,394; home-editorial.ts:89) e `{entityType, entityId}` (related-news.ts:47) | `[articleId]` / `[entityType, entityId]` |
| `articleTranslation.findFirst {languageCode, slug}` (news-pages.ts:143) | unique `[languageCode, slug]` |
| `articleTranslation.findMany {articleId in, languageCode,...}` (related-news.ts:57) | unique `[articleId, languageCode]` |
| `article.findMany {payloadDocumentId in}` (news-pages.ts:508) | unique `payloadDocumentId` |
| `tmdbImage.findMany/count {entityType, tmdbId, imageType,...} take 4` (person-page.ts:371,377) | `[entityType, tmdbId]` (conjunto por pessoa é pequeno; sort por voteAverage em memória aceitável) |
| Shards de sitemap `ORDER BY s.entity_id / e.id / se.id / at.id ASC LIMIT/OFFSET` (sitemap-index.ts:254,265,293,308,370,396) | PK ou `[entityType, entityId, languageCode]` (ordem por entity_id após igualdade em entity_type); NOT EXISTS em `page_indexability_decisions` servido por `[entityType, entityId, languageCode]` (schema.prisma:1071) |

### 3. Consultas SEM índice correspondente (candidatas a seq scan)

1. **`episodes.air_date` — sem índice.** `prisma.episode.findMany({ where: { airDate: { gte, lt } }, orderBy: [{airDate: asc},...], take: 60 })` em apps/web/src/server/home-ticker.ts:275-287 e `{ airDate: { gt: cutoff } } ... take: 200` em apps/web/src/server/anticipated.ts:118-135. Únicos índices: `[seasonId, episodeNumber]` e `[tvShowId]` (schema.prisma:628-629). Com o volume real de episódios (memória do projeto registra ~85.878 episódios ingeridos com `--limit 20`), cada render/revalidate da home e da página de antecipados varre a tabela inteira e ordena. **Índice ausente: `episodes(air_date)`.**
2. **`seasons.air_date` — sem índice.** `prisma.season.findMany({ where: { airDate: { gte, lt }, seasonNumber: { gt: 0 } }, orderBy airDate, take 60 })` em home-ticker.ts:294-305 e `{ airDate: { gt: cutoff } } take 48` em anticipated.ts:102-117. Índices existentes só por `tvShowId` (schema.prisma:601-603). **Índice ausente: `seasons(air_date)`.**
3. **`article_translations.published_at` — sem índice.** Três consultas ordenam/filtram por ele:
   - home-editorial.ts:55-61 — `{languageCode, reviewStatus in} orderBy publishedAt desc take 60`;
   - news-pages.ts:563-574 (`resolveReadAlso`) — `{languageCode, reviewStatus in, publishedAt lte} orderBy publishedAt desc take 8`;
   - news-sitemap.ts:61-76 — `ORDER BY COALESCE(at.published_at, a.published_at) DESC LIMIT 1000` (expressão sobre join — não indexável diretamente; a janela de 48h no WHERE também usa o mesmo COALESCE).
   O único índice não-unique é `[languageCode, indexStatus]` (schema.prisma:1691), que não cobre `reviewStatus` nem `publishedAt`. Hoje o volume de matérias é pequeno; com a autopublicação MNScr (quota diária) a tabela cresce monotonicamente e todas essas viram top-N com sort completo do idioma. **Índice candidato: `article_translations(language_code, published_at DESC)`** (o do news-sitemap seguiria parcialmente coberto por causa do COALESCE).
4. **Listagem de notícias sem `take`.** `prisma.articleTranslation.findMany({ where: {languageCode, reviewStatus in} })` **sem take e sem orderBy** em news-pages.ts:80-107 (`getNewsIndexData`) — carrega o arquivo inteiro de matérias pt-BR a cada render do índice de notícias. Mesmo padrão de crescimento sem teto do item 3.
5. **Listagens de entidade carregam o tipo inteiro.** `slug.findMany({ entityType, languageCode, isCanonical })` sem `take` em entity-indexes.ts:67-70 (e home-hero.ts:53, home-catalog.ts:46, home-upcoming.ts:42), seguido de `person.findMany({ id: { in: ids } })` em entity-indexes.ts:216-219. O filtro é servido por índice, mas o resultado é o conjunto completo do tipo — o próprio comentário do sitemap registra ~22.400 pessoas com slug (sitemap-index.ts:23). A página `/pt/pessoas/` hidrata todas em memória por request. Não é falta de índice e sim ausência de paginação no banco.
6. **Busca (`search_documents`): o ramo de alias pode anular os índices trgm.** O WHERE de search-page.ts:69-79 é `doc_kind='entity' AND locale=$3 AND (normalized_text = $1 OR normalized_text LIKE $2 OR normalized_text % $1 OR EXISTS(... unnest(string_to_array(normalized_aliases,'|')) ...))`. Os GIN trgm existem (20260716130000:114,117), mas o quarto ramo do OR (unnest de `normalized_aliases`, coluna sem índice) não é indexável — um BitmapOr exige todos os ramos indexáveis, então o plano provável é usar só `search_documents_locale_idx` (locale único publicado ≈ tabela inteira) e filtrar linha a linha. **NÃO VERIFICADO com EXPLAIN** (auditoria sem acesso a banco); recomendo `EXPLAIN ANALYZE` desta query antes de crescer o catálogo. O `NEWS_SEARCH_SQL` (search-page.ts:94-117) não tem o ramo de alias e tende a usar os trgm normalmente; falta índice em `doc_kind` mas o CHECK/particionamento lógico é pequeno.

### 4. Paginação de sitemap e busca — verificação específica

- Sitemap é paginado NO banco com `LIMIT/OFFSET` e `ORDER BY` determinístico por PK/entity_id (sitemap-index.ts:246-308, 350-406); `SITEMAP_URL_LIMIT = 50_000` (packages/seo/src/sitemap-plan.ts:18). Com ~86k episódios são 2 shards; o custo O(offset) do OFFSET é aceitável nessa escala e a ordem é servida por índice. O index (`/sitemap.xml`) só conta (`COUNT + MAX(updated_at)`, sitemap-index.ts:147-236) — porém o COUNT de `people` executa o gate de elegibilidade (EXISTS em cast/crew + slugs + decisões, sitemap-index.ts:171-196) para cada pessoa; cada sub-lookup é indexado (`cast_members_person_id_idx`, `slugs[entityType,entityId,languageCode]`, `page_indexability_decisions[entityType,entityId,languageCode]`), mas é O(pessoas × subconsultas) a cada request de index e a cada shard (a contagem roda de novo em getSitemapShardXml, sitemap-index.ts:566).
- Google News sitemap: janela de 48h aplicada no SQL (news-sitemap.ts:58-76) — correto em intenção, mas sem índice utilizável (item 3 acima).
- Busca pública: `LIMIT/OFFSET` parametrizados com clamp (search-page.ts:34-36, 215-216); notícias só na primeira página (search-page.ts:239-247). Paginação em si correta; risco é o plano do WHERE (item 6).

### ACHADOS-CHAVE

- `episodes.air_date` NÃO tem índice e é filtrado/ordenado por range em home-ticker.ts:275 e anticipated.ts:118 — seq scan de ~86k linhas por render da home/antecipados; pior caso do bloco.
- `seasons.air_date` NÃO tem índice; mesmas superfícies (home-ticker.ts:294, anticipated.ts:102).
- `article_translations` não tem índice em `published_at` nem `review_status`; home-editorial.ts:60, news-pages.ts:573 e news-sitemap.ts:75 ordenam por ele — degrada linearmente com a autopublicação MNScr.
- `getNewsIndexData` (news-pages.ts:80) faz `findMany` SEM `take`: o índice de notícias carrega o arquivo inteiro de matérias a cada render.
- Listagem `/pt/pessoas/` hidrata TODAS as ~22,4k pessoas com slug por request (entity-indexes.ts:67 + 216) — sem paginação no banco.
- Busca de entidades: o ramo de alias (unnest de `normalized_aliases`, sem índice) dentro do OR provavelmente impede o uso dos GIN trgm → filtro linha a linha do locale inteiro (search-page.ts:69-79). NÃO VERIFICADO com EXPLAIN (sem acesso a banco).
- Lado positivo: slugs, cast/crew, entity_news_links, tmdb_images e todos os lookups de página de detalhe têm índice exato (incl. o unique parcial `slugs_canonical_unique` e o unique parcial de artigo em `search_documents`); os shards de sitemap paginam no banco com ORDER BY indexado.
- Vários índices críticos existem SÓ em SQL bruto (trgm, uniques parciais) — o schema.prisma sozinho subestima a cobertura; qualquer auditoria futura precisa varrer `packages/db/prisma/migrations`.

---

# 4. BLOCO B — CMS PAYLOAD (apps/cms)

## Bloco B1+B2 — CMS Payload (`apps/cms`)

### 1. Configuração geral (`apps/cms/src/payload.config.ts`)

| Aspecto | Estado verificado |
| --- | --- |
| Adapter de banco | `postgresAdapter` (`@payloadcms/db-postgres`) — `apps/cms/src/payload.config.ts:101-107` |
| Connection string | var `PAYLOAD_DATABASE_URL` (nome exportado em `apps/cms/src/env.ts:28`); `DATABASE_URL` NUNCA é fallback e igualdade entre as duas aborta o boot (`env.ts:105-134`); padrões de host/nome que denunciam o banco público (`screen-db`, `screena`, `rss_prime` no path, `production` etc.) também abortam (`env.ts:41-66,146-163`) |
| Migrations | `push: false`, `migrationDir: src/migrations` — `payload.config.ts:105-106` |
| Secret | `PAYLOAD_SECRET`, mínimo 32 chars (`env.ts:29,32,119-124`) |
| Auth admin | `admin.user: 'editorial-users'` — `payload.config.ts:92` |
| Editor | `lexicalEditor()` — `payload.config.ts:96` |
| GraphQL | **desabilitado** (`graphQL.disable: true`) — `payload.config.ts:117-121` |
| Storage de upload | driver local (dev) ou `s3Storage` oficial (`@payloadcms/storage-s3`) via `resolvePayloadUploadConfig(process.env)` — `payload.config.ts:47-87`; local em produção exige confirmação explícita de volume persistente (comentário `payload.config.ts:41-45`; lógica em `upload-storage-config.ts`, NÃO VERIFICADO linha a linha) |
| Endpooints custom | `editorial-drafts`, `publication-outbox` (spread), `publication-media`, `contracts`, `editorial-publications` — `payload.config.ts:109-115` |

### 2. Colecoes (8, registradas em `apps/cms/src/collections.ts:1024-1033`)

#### 2.1 `editorial-users` (humanos) — `collections.ts:248-270`
`auth: true` (login local email+senha). Sem versionamento, sem upload.

| Campo | Tipo | Obrig. | Relacionamento |
| --- | --- | --- | --- |
| email + senha | (implícitos por `auth: true`) | sim | — |
| displayName | text | sim | — |
| role | select (`administrator`, `editor_in_chief`, `editor`, `reviewer`, `writer` — `workflow.ts:39-45`) | sim (default `writer`) | — |
| active | checkbox (default true) | não | — |

#### 2.2 `service-accounts` (máquinas) — `collections.ts:276-337`
`auth: { useAPIKey: true, disableLocalStrategy: true }` — só API key, sem senha (`collections.ts:278-283`). Sem versionamento/upload. Oculta do menu para não-admin (`admin.hidden`, `collections.ts:290` + `collections.ts:110-111`), mas o comentário do código é explícito: "hidden é apenas INTERFACE — a negacao real esta em access" (`collections.ts:109-111`).

| Campo | Tipo | Obrig. | Obs. |
| --- | --- | --- | --- |
| apiKey | text | — | sobrescrito com `access: { read: () => false }` para a chave decifrada não vazar em `/me` (`collections.ts:305`) |
| label | text | sim | — |
| purpose | select (`mnscr`, `internal_tooling`) | sim (default `mnscr`) | — |
| active | checkbox | não (default **false**) | conta inativa vira `anonymous` (`actor.ts:40`) |
| scopes | select hasMany (`draft_ingest`, `publication_projection`, `editorial_auto_publish` — `outbox-api.ts:33-37`) | não (default `[]`) | lista vazia = revogação sem apagar |
| notes | textarea | não | — |

#### 2.3 `authors` (autoria pública) — `collections.ts:343-432`
`versions: true` (`collections.ts:346`). Sem upload.

| Campo | Tipo | Obrig. | Relacionamento |
| --- | --- | --- | --- |
| name | text | sim | — |
| slug | text (unique) | sim | — |
| bio | textarea | não | — |
| avatar | relationship | não | → media |
| roleLabel / publicEmail / sameAs (hasMany) | text/email/text | não | — |
| active | checkbox (default true) | não | — |
| automationPublishingAllowed | checkbox (default **false**) | não | opt-in do autor para autopublicação |
| allowedAutomationContentTypes | select hasMany (`news`,`feature`,`guide`,`list`,`interview`,`evergreen`) | não (default []) | — |
| allowedAutomationSections | text hasMany | não | — |
| automationDailyLimit | number | não | — |
| automationAttributionModes | select hasMany (`byline`,`newsroom`,`assisted`) | não (default []) | vazio = nenhum modo aceito |
| isOrganization | checkbox | não | — |
| createdBy / updatedBy | relationship | não | → editorial-users |

#### 2.4 `media` — `collections.ts:438-506`
**Upload: sim** (`staticDir` absoluto de `PAYLOAD_UPLOAD_LOCAL_ROOT`/`EDITORIAL_MEDIA_CMS_STATIC_DIR`, mimeTypes `image/png|jpeg|webp|avif` — `collections.ts:441-452`). Sem versionamento.

| Campo | Tipo | Obrig. | Obs. |
| --- | --- | --- | --- |
| alt | text | sim | — |
| caption / credit / sourceName / sourceUrl / rightsHolder / licenseReference / aspectRatio / contentHash | text | não | — |
| licenseStatus | select (`unknown`,`pending`,`approved`,`restricted`,`expired`,`prohibited`) | sim (default **unknown**) | default fail-closed |
| licenseExpiresAt | date | não | — |
| requiresAttribution | checkbox (default true) | não | — |
| allowedForEditorial / allowedForHero / allowedForSocial | checkbox (default **false**) | não | "ausencia de decisao = proibicao" (`collections.ts:477`) |
| focalPoint | group {x,y number} | não | — |
| provenanceType | select | sim (default `external_source`) | — |
| restrictions | text hasMany | não | — |

#### 2.5 `articles` — `collections.ts:512-857`
**Draft/publish habilitado**: `versions: { drafts: { autosave: { interval: 2000 } }, maxPerDoc: 0 }` (`collections.ts:522-525`). Hooks `beforeChange: enforceEditorialGovernance` e `afterChange: emitPublicationEvent` (`collections.ts:518-521`). Sem upload. Campos organizados em abas **sem nome** (schema plano). Resumo dos campos:

| Grupo | Campos (obrig. em negrito) |
| --- | --- |
| Conteúdo | **title**, subtitle, slug (index), summary, **contentType** (select de `PUBLICATION_CONTENT_TYPES` de `@screena/editorial-contracts`, `collections.ts:565`), **language** (default pt-BR), body (blocks: `paragraph`,`heading`,`image`,`video`,`quote`,`entityCard`,`factBox`,`relatedContent`,`sourceList`,`divider` — `collections.ts:151-242`; **não existe bloco de HTML livre**, `collections.ts:148-150`) |
| Mídia | heroMedia (rel→media), gallery (rel→media hasMany) |
| Autoria | authors (rel→authors hasMany), primaryAuthor (rel→authors), assignedTo (rel→editorial-users), section, internalTags |
| SEO | metaTitle, metaDescription, focusKeyphrase, relatedKeyphrases, editorialKeywords, schemaTypeRecommendation (select), articleSection, socialTitle/Description, socialMedia (rel→media), canonicalOverride, noindex (default false) |
| Entidades | entityReferences (array: **entityKind**, **entityId**, **relation**, confidence, verified default false), relatedArticleReferences (rel→articles hasMany) |
| Fontes/QA | externalSources (array: sourceId/name/url/role, todos required), claims (array), provenanceJson (json), aiAssisted, blockingErrors, warnings, qaVersion, qaPassedAt |
| Publicação | **workflowStatus** (select de 12 estados, `workflow.ts:20-34`, default `draft`, index; "`_status` do Payload tem 2 valores; o fluxo real tem 12" — `collections.ts:728-729`), scheduledFor, publishedAt, correctedAt, correctionNote, retractionReason, legalHold, createdBy/updatedBy/publishedBy (rel→editorial-users, readOnly de UI) |
| Automação (auditoria) | autoPublished, automationActorId/Label/ScopesUsed/ReceivedAt/IdempotencyKey/SourceRevision/PayloadHash/PipelineVersion/ContractVersion/ContractName/SchemaHash/AttributionMode, automationDraftId, idempotencyKey, sourceClusterId, sourceRevision, sourcePayloadHash, draftPayloadHash, pipelineVersion — todos `admin.readOnly` (UI) |

#### 2.6 `publication-outbox` — `collections.ts:863-916`
`admin.hidden: true`. Sem versionamento/upload. Campos: eventId (unique), idempotencyKey (unique+index), eventType (`article.published|updated|unpublished|retracted`), aggregateType/Id/Version, payload (json), status (default `pending`), attempts, availableAt, lease (leaseToken/lockedBy/lockedAt/leaseExpiresAt), processedAt, errorCode, lastError.

#### 2.7 `autopublish-quota-counters` — `collections.ts:928-977`
UNIQUE composta `(timeZone, localDate, dimensionType, dimensionKey)` (`collections.ts:945-953`). Campos: timeZone, localDate, dimensionType (select de `QUOTA_DIMENSIONS`), dimensionKey, currentCount, limitSnapshot, windowStartUtc/EndUtc — todos required.

#### 2.8 `autopublish-quota-usage` — `collections.ts:989-1022`
requestId (unique), idempotencyKey, sourceClusterId, sourceRevision, articleId, publicAuthorId, publicationIntent (`publish|update`), localDate, timeZone, dimensionsConsumed, consumedAt, serviceAccountId, pipelineVersion.

### 3. Controle de acesso

Toda política é pura em `apps/cms/src/access.ts`, adaptada via `policy()` (`collections.ts:65-67`). `toActor` (`actor.ts:33-57`) é fail-closed: user nulo/malformado, service account com `active !== true`, ou humano com `active === false` viram `anonymous`, que não passa em política nenhuma.

**Matriz por colecão** (evidência: `access.ts:87-124` + bindings em `collections.ts`):

| Colecão | create | read | update | delete |
| --- | --- | --- | --- | --- |
| articles | humano com papel de conteúdo (`administrator/editor_in_chief/editor/writer`) OU service com escopo `draft_ingest` | qualquer humano autenticado (`isHuman`) — service **não lê** a coleção | papel de conteúdo OU papel de revisão (`+reviewer`) OU service `draft_ingest` | só `administrator` |
| authors, media | `canAuthorContent` | qualquer humano | `canAuthorContent` | `administrator` |
| editorial-users | `administrator` | admin OU o próprio doc (`readOwnIdentity('human')` → filtro `{id: {equals: actor.id}}` com checagem de collection de origem, `collections.ts:87-98`) | `administrator` | `administrator` |
| service-accounts | `administrator` | admin OU a própria conta (`readOwnIdentity('service')`); campo `apiKey` sempre ilegível | `administrator` | `administrator` |
| publication-outbox | `() => false` | `administrator` | `() => false` | `() => false` (`access.ts:119-124`) |
| autopublish-quota-counters | `() => false` | `administrator` | `() => false` | `() => false` (`collections.ts:939-944`) |
| autopublish-quota-usage | idem (`collections.ts:996-1001`) | | | |

Trechos-chave de `access.ts`:

```ts
export const articlesAccess = {
  create: (actor) => canAuthorContent(actor) || serviceHasScope(actor, 'draft_ingest'),
  read:   (actor) => isHuman(actor),
  update: (actor) => canAuthorContent(actor) || canReview(actor) || serviceHasScope(actor, 'draft_ingest'),
  delete: (actor) => isAdministrator(actor),
}                                                    // access.ts:87-94
export const identityAccess = { create/read/update/delete: isAdministrator }  // access.ts:105-110
export const outboxAccess = { create: () => false, read: isAdministrator, update: () => false, delete: () => false } // access.ts:119-124
```

**Autenticação:**
- Humanos: colecão `editorial-users` com `auth: true` (login local do Payload); é a colecão do painel admin (`payload.config.ts:92`).
- Máquinas: colecão `service-accounts` com `useAPIKey: true` + `disableLocalStrategy: true` — só API key.
- Endpoints internos gateados por escopo da credencial: `editorial-drafts` exige `draft_ingest` (`endpoints/editorial-drafts.ts:159`), `editorial-publications` exige `editorial_auto_publish` (`endpoints/editorial-publications.ts:193`), `publication-outbox` e `publication-media` exigem `publication_projection` (`endpoints/publication-outbox.ts:78`, `endpoints/publication-media.ts:95`), `contracts` aceita qualquer um dos três (`endpoints/contracts.ts:44-46`).

**Papéis:** 5 papéis (`workflow.ts:39-45`). Editor É separado de admin: publicação exige `administrator` ou `editor_in_chief` (`canPublish`, `access.ts:28,54-56`); `editor`/`writer` criam/editam; `reviewer` só revisa (não está em `CONTENT_ROLES`, `access.ts:31-44`). Atribuição de papel: campo `role` de `editorial-users`, e como update dessa colecão é `identityAccess.update` (= só admin, `collections.ts:255`), **apenas administrador atribui papéis**. Não há self-signup: create também é só admin.

**Listas de campos proibidos por ator** (defesa além do access de colecão, `access.ts:134-221`): `SERVICE_ACCOUNT_FORBIDDEN_FIELDS` (draft_ingest não escreve `workflowStatus`, `publishedAt`, `authors`, `createdBy` etc.), `AUTOMATION_PUBLISHER_FORBIDDEN_FIELDS` (auto_publish não escreve `publishedAt`, `_status`, retratação/legalHold), `HUMAN_FORBIDDEN_FIELDS` (nem admin escreve os campos `automation*` — porque `admin.readOnly` "e uma decisao de INTERFACE: a REST API do Payload aceita o campo normalmente", `access.ts:189-191`). Enforcement dessas listas ocorre nos hooks/endpoints (`hooks/articles.ts` via `enforceEditorialGovernance`) — a aplicação efetiva das listas nos hooks NÃO VERIFICADA linha a linha neste bloco.

### 4. Banco

- Adapter: `postgresAdapter` do `@payloadcms/db-postgres` (`payload.config.ts:13,101`).
- Var de conexão: **`PAYLOAD_DATABASE_URL`** (única; sem fallback para `DATABASE_URL`, `env.ts:10,105-112`).
- Banco próprio, isolado do público, com validação anti-colisão fail-closed no boot (`payload.config.ts:30-32`, `env.ts:98-168`).

### ACHADOS-CHAVE

- 8 colecões reais: 2 de identidade (humano vs máquina separadas de propósito), 3 editoriais (authors/media/articles), 1 outbox e 2 de quota internas — `collections.ts:1024-1033`.
- Identidades separadas por construção: `editorial-users` (login local) vs `service-accounts` (só API key, `disableLocalStrategy: true`, default `active: false`, escopos explícitos com vazio = sem poder) — `collections.ts:276-337`.
- RBAC com 5 papéis; publicar exige `editor_in_chief`/`administrator`; papéis só atribuíveis por admin (update de `editorial-users` = `identityAccess.update`) — `access.ts:28`, `collections.ts:255`.
- Draft/publish do Payload habilitado só em `articles` (autosave 2s), mas a fonte da verdade do fluxo é `workflowStatus` com 12 estados, não o `_status` binário — `collections.ts:522-525,720-731`.
- Fail-closed em cadeia: ator anônimo por default (`actor.ts:33-57`), mídia nasce `licenseStatus: unknown` e permissões `false` (`collections.ts:470-480`), API key ilegível após criação (`collections.ts:305`).
- Colecões internas (outbox, quota) são imutáveis pela API (`create/update/delete: () => false`); só admin lê — `access.ts:119-124`, `collections.ts:939-944,996-1001`.
- Banco isolado: `PAYLOAD_DATABASE_URL` obrigatória, `DATABASE_URL` nunca é fallback, e URL que "parece" o banco público aborta o boot — `env.ts:98-168`, `payload.config.ts:30-32`.
- Três listas de campos proibidos por ator (service, automation publisher, humano) reconhecem que `admin.readOnly` não protege a REST API — `access.ts:134-221`; enforcement nos hooks NÃO VERIFICADO linha a linha neste bloco.

---

## B3 — Hooks do CMS Payload (apps/cms)

**Inventário completo:** apenas a colecao `articles` registra hooks. Grep por `beforeChange|afterChange|beforeValidate|beforeRead|afterRead|...` em `apps/cms/src` (excluindo testes) retorna somente `apps/cms/src/collections.ts:519-520`:

```
hooks: {
  beforeChange: [enforceEditorialGovernance],
  afterChange: [emitPublicationEvent],
}
```

Nenhuma outra colecao (`editorial-users`, `service-accounts`, `authors`, `media`, `publication-outbox`, `autopublish-quota-counters`, `autopublish-quota-usage`) tem hook de colecao. Existe um override de leitura **em nível de campo** (não hook): `service-accounts.apiKey` com `access: { read: () => false }` para impedir que o `afterRead` nativo do Payload devolva a chave decifrada em `/me` (`apps/cms/src/collections.ts:305`).

### `enforceEditorialGovernance` (beforeChange de `articles`) — `apps/cms/src/hooks/articles.ts:201-398`

| O que faz | Onde |
|---|---|
| Nega escrita anonima (403 via `APIError`) | articles.ts:207-208 |
| Deriva `actorKind` do ESCOPO da credencial: `service` + `editorial_auto_publish` = `automation_publisher`; `service` sem esse escopo = `service` (draft_ingest) | articles.ts:215-222 |
| Service account comum: REMOVE (não recusa) campos proibidos, força `workflowStatus='automation_draft'` e `_status='draft'` | articles.ts:230-254 |
| Automation publisher: remove `AUTOMATION_PUBLISHER_FORBIDDEN_FIELDS` (retencao juridica, retratacao, agendamento, carimbo) | articles.ts:257-269 |
| Humano: remove `HUMAN_FORBIDDEN_FIELDS` (proveniencia tecnica), força `autoPublished=false` na criacao, deriva `createdBy`/`updatedBy`/`publishedBy` do `req.user` (nunca do corpo); `publishedBy` só na TRANSIÇÃO para published | articles.ts:282-320 |
| Valida transicao de estado via `canTransition(from, to, actorKind)`; criacao: automacao nasce em `automation_draft`, humano nasce em `draft` | articles.ts:322-341 |
| `_status` é DERIVADO de `workflowStatus` (nunca aceito solto); pedir `_status='published'` sem `workflowStatus='published'` = 403 | articles.ts:343-354, 393-395 |
| Gate de publicacao (`evaluatePublishGate`) só na transicao para `published`: autores ativos, slug/title/language, blockingErrors, QA, IA-assistida exige fonte externa, midia nao autorizada (capa + galeria + corpo, fail-closed inclusive midia inexistente/inverificavel), legalHold | articles.ts:356-386 |
| `publishedAt` carimbado pelo SERVIDOR se ausente | articles.ts:387-390 |

### `emitPublicationEvent` (afterChange de `articles`) — `apps/cms/src/hooks/articles.ts:404-512`

**Resposta direta: quem escreve na outbox é o `afterChange` de `articles`, e SOMENTE ele** ("so o afterChange cria a outbox, e so a outbox", articles.ts:18). Condicoes:

- `operation === 'create'` → nunca emite (articles.ts:410).
- Emite apenas quando `publicationEventForTransition(from, to)` retorna nao-nulo (`apps/cms/src/workflow.ts:260-275`):
  - `* → published`: `article.published` na estreia; `article.updated` se `from === 'needs_update'` **ou** se ja existe `article.published` na propria outbox para o `aggregateId` (consulta em articles.ts:423-440 — a fila é o registro de "ja foi publica").
  - `published → retracted`: `article.retracted` (workflow.ts:272).
  - `published → blocked|archived`: `article.unpublished` (workflow.ts:273).
  - Qualquer outra transicao (draft, autosave, revisao) → `null` → nada na fila (articles.ts:444-445).
- Evento invalido (`buildOutboxRecord` falha) lança `APIError` 500 e **derruba a transacao inteira** — artigo nao fica publicado sem evento (articles.ts:456-464).
- Escrita com bypass explicito (`overrideAccess: true`, mesmo `req` = mesma transacao), pois `publication-outbox` declara `create: false` para todos (collections.ts:871-876). Idempotencia: consulta previa por `idempotencyKey` + UNIQUE do banco; colisao 23505/ValidationError em `eventId`/`idempotencyKey` é tratada como sucesso idempotente (articles.ts:470-509, 523-543).

## B4 — Endpoints customizados

Todos registrados em `apps/cms/src/payload.config.ts:109-115`; prefixo efetivo `/api` (rota catch-all do Payload). GraphQL desabilitado (payload.config.ts:117-121).

| Endpoint | Metodo/Rota | Auth/escopo | Entrada | Resposta | Erros |
|---|---|---|---|---|---|
| **Drafts (ingestao MNScr)** `endpoints/editorial-drafts.ts:127-275` | `POST /api/internal/editorial-drafts` | service account ativa com escopo `draft_ingest` (linha 159); inativa → 403 `not_service_account` (draft-intake.ts:288), anonimo → 401 (draft-intake.ts:283) | JSON até 1.000.000 bytes (`MAX_REQUEST_BYTES`, draft-intake.ts:33); contrato validado em `draft-intake.ts` | `{outcome: create\|update\|duplicate_noop, articleId, workflowStatus:'automation_draft', draftPayloadHash}` | 400 `invalid_json`, 413 `payload_too_large`, 422 `contract_violation`, 409 `idempotency_conflict` (draft-intake.ts:283-315). Escreve via `overrideAccess: false` em nome do ator (linhas 246-247) |
| **Publicacoes automaticas** `endpoints/editorial-publications.ts:180-528` | `POST /api/internal/editorial-publications` | escopo `editorial_auto_publish` (linhas 193-195); anonimo 401 | JSON até 2 MiB (linha 51); contrato `editorial-publication-request-v1` (Zod) + tripla checagem nome/versao/hash (linhas 230-234) | `{outcome, requestId, idempotencyKey, reasons[], warnings[], technicalActorId, publicAuthorId, canonicalSlug, articleId}` | `PUBLISHED`=201, `ROUTED_TO_REVIEW`=202, `CONFLICT`=409, `BLOCKED`=422 (auto-publication.ts:432-438); fuso invalido=503 `AUTO_PUBLISH_TIME_ZONE_INVALID` retryable (linhas 239-257); falha de persistencia=503 `AUTO_PUBLISH_PERSISTENCE_FAILED` com rollback (linhas 485-524) |
| **Outbox claim** `endpoints/publication-outbox.ts:88-228` | `POST /api/internal/publication-outbox/claim` | escopo `publication_projection` (linhas 75-82); humano tambem recusado | `{workerId, batchSize?, leaseMs?}` (corpo ≤100 KB) | `{workerId, claimed, events[]}` com `leaseToken`, `emissionSequence` (= id serial da linha, linha 212), payload | 401/403/400. Claim é compare-and-swap em **UM UPDATE SQL** direto no pool (linhas 149-199) porque `payload.update({where})` não é atomico |
| **Outbox ack** `publication-outbox.ts:234-304` | `POST /api/internal/publication-outbox/ack` | idem `publication_projection` | `{eventId, leaseToken, workerId, projectionReceiptId, projectedAt, eventPayloadHash?}` | `{outcome:'processed'\|'already_processed'}` | 400 `missing_fields`, 404 `event_not_found`, 409 `lease_invalid`; ack repetido de processado = 200 idempotente (linhas 280-283) |
| **Outbox fail** `publication-outbox.ts:310-389` | `POST /api/internal/publication-outbox/fail` | idem | `{eventId, leaseToken, workerId, errorCode?, retryable?, failedAt?, message?}` | `{outcome: failed\|dead_letter, attempts, availableAt}` (backoff via `decideFailOutcome`) | mesmos de ack; `lastError` SANITIZADO antes de gravar (linha 378) |
| **Media bytes** `endpoints/publication-media.ts:89-198` | `GET /api/internal/publication-media/:mediaId?purpose=` | escopo `publication_projection` (linhas 94-97) | `mediaId` numerico; `purpose` ∈ editorial/hero/social (default editorial) | 200 com bytes + headers verificaveis (`x-cinerie-media-content-hash` sha256, licenca, credito, alt; linhas 168-196) | 401/403, 400 `invalid_purpose`, 404 `media_not_found`/`file_missing`, 403 `media_not_deliverable` (politica em `media-authorization.ts`, fail-closed), 503 `storage_unavailable`. Limite 15 MiB, MIME restrito a jpeg/png/webp/avif (linhas 33-41) |
| **Contracts manifest** `endpoints/contracts.ts:51-68` | `GET /api/internal/contracts` | QUALQUER conta tecnica com um dos 3 escopos (`draft_ingest`, `editorial_auto_publish`, `publication_projection`); anonimo 401 (linhas 40-49) | — | `{contracts[] (nome/versao/hash/compat/direcao), buildIdentifier}` | 403 `forbidden_scope` |
| **Contract schema** `contracts.ts:78-108` | `GET /api/internal/contracts/:contractName` | idem | — | JSON Schema gerado do Zod + versao/hash | 404 `unknown_contract` |
| **Liveness** `app/healthz/route.ts:18-23` | `GET /healthz` | NENHUMA (rota Next, fora do handler Payload; deliberado, linhas 10-13) | — | 200 `{status:'ok', service:'cinerie-cms'}` — não toca banco | — |
| **Readiness** `app/readyz/route.ts:22-37` | `GET /readyz` | NENHUMA | — | 200 `ready` / 503 `not_ready` com `checks[]` (config, banco, migrations, storage, collections) sem segredos | 503, não 500 |

## B5 — Quota de autopublicacao

Implementacao em 3 camadas, todas em `apps/cms/src`: politica pura (`quota.ts`), execucao transacional (`quota-store.ts`), configuracao/fuso (`env-auto-publish.ts`), orquestrada pelo endpoint (`endpoints/editorial-publications.ts:415-524`).

**As 5 dimensoes** (`quota.ts:28-35`, ordem = ordem deterministica de aquisicao para evitar deadlock):

| Dimensao | Chave | Env do teto | Default em production (`env-auto-publish.ts:47-51`) |
|---|---|---|---|
| `global` | `'all'` | `EDITORIAL_AUTO_PUBLISH_DAILY_LIMIT` | 50 |
| `content_type` | contentType do pedido | `..._PER_CONTENT_TYPE_LIMIT` | 40 |
| `section` | secao (omitida se pedido sem secao, quota.ts:93-101) | `..._PER_SECTION_LIMIT` | 30 |
| `author` | publicAuthorId — teto efetivo = **min(plataforma, `automationDailyLimit` do autor)** (`strictestLimit`, editorial-publications.ts:62-66, 437) | `..._PER_AUTHOR_LIMIT` | 20 |
| `article_update` | targetArticleId (só em `update`) | `..._PER_ARTICLE_UPDATE_LIMIT` | 5 |

**Fuso:** `EDITORIAL_AUTO_PUBLISH_TIME_ZONE`, obrigatorio e IANA-valido em production (offset fixo e abreviacao recusados, `env-auto-publish.ts:69-81, 106-121`); default fora de production: `America/Sao_Paulo` (linha 44). Dia civil = janela half-open `[inicio, proximo_inicio)` convertida a UTC com resolucao de horario de verao pelo ICU (`editorialDayWindowUtc`, linhas 198-221). Fuso faz parte da CHAVE do contador junto com `localDate` (unique composta `timeZone,localDate,dimensionType,dimensionKey`, collections.ts:945-953).

**Mecanica anti-corrida:** nao ha `SELECT COUNT` pre-publicacao (o gate recebe `usage` zerado de proposito, editorial-publications.ts:326-330). A reserva é `INSERT ... ON CONFLICT DO UPDATE SET current_count = current_count + 1 ... WHERE current_count < limite RETURNING` em SQL cru, no handle da TRANSACAO (`runnerFor` pega `db.sessions[transactionID]`, quota-store.ts:73-85, 114-140). Reserva + persistencia do artigo + `recordConsumption` compartilham a transacao aberta por `initTransaction(req)` (editorial-publications.ts:415-484); sem `transactionID` a publicacao é recusada (linhas 419-421).

**Ao estourar:** `consumeDimension` retorna zero linhas → `consumeQuotas` devolve recusa com `code` (`AUTO_PUBLISH_*_LIMIT_REACHED`, quota.ts:38-44) → `QuotaRejectedError` aborta a transacao (rollback desfaz dimensoes ja incrementadas) → resposta **HTTP 202 `ROUTED_TO_REVIEW`** com `reasons[{code, detail: 'dimensao X'}]` e `nextEligibleAt` (fim da janela UTC; `null` para `article_update`, que não renova à meia-noite — quota.ts:168-173; editorial-publications.ts:489-505). **Nem erro nem silencio nem fila:** porem atencao — nesse caminho `quotaRejection` é setado ANTES de `persistPublication` rodar, logo o conteudo **não** é persistido como `needs_review` (a transacao inteira morre); o "ROUTED_TO_REVIEW" da resposta descreve o desfecho sem materia gravada nesse ramo especifico.

**Persistencia dos contadores:** tabela `autopublish_quota_counters` (collection `autopublish-quota-counters`, collections.ts:928-977 — `create/update/delete: () => false`, leitura só administrador) com `limitSnapshot` (teto vigente no momento) e janela UTC; trilha de consumo em `autopublish-quota-usage` com UNIQUE em `requestId` como segunda linha de defesa da idempotencia (collections.ts:989-1022; quota-store.ts:206-232). Idempotencia checada ANTES da quota: `findPreviousConsumption` por `requestId` devolve `ALREADY_CONSUMED` sem consumir de novo (editorial-publications.ts:380-398). Migration dos contadores: `src/migrations/20260729_180427_auto_publish_quota_counters.ts`. `docs/operations/editorial-auto-publication-quota.md` é a referencia cruzada de intencao; toda a evidencia acima é código.

**Kill switch:** `EDITORIAL_AUTO_PUBLISH_ENABLED` — comparacao positiva (`true`/`1`), ausencia = desligado (env-auto-publish.ts:86-91). Desligado → `ROUTED_TO_REVIEW` com `auto_publish_disabled` (auto-publication.ts:372-380), e a readiness continua `ok` (env-auto-publish.ts:263-280).

### ACHADOS-CHAVE

- **Um unico par de hooks em todo o CMS**, ambos em `articles` (collections.ts:519-520): `enforceEditorialGovernance` (beforeChange, governanca/gate) e `emitPublicationEvent` (afterChange, unica escrita na outbox — `create: false` para todos, inclusive admin).
- **A outbox só recebe evento em 4 transicoes**: chegada a `published` (published/updated, decidido consultando a PROPRIA outbox), `published→retracted` e `published→blocked|archived` (workflow.ts:260-275); evento invalido derruba a transacao da publicacao (articles.ts:456-464).
- **`_status` do Payload é neutralizado**: derivado de `workflowStatus`, nunca aceito como entrada — fecha a porta de publicar com `_status:'published'` por fora do fluxo (articles.ts:343-354).
- **Claim da outbox usa SQL cru compare-and-swap** porque `payload.update({where})` nao é atomico (publication-outbox.ts:149-199); ack/fail validam lease token aleatorio por claim e sao idempotentes para eventos ja processados.
- **Quota = reserva transacional por `INSERT ... ON CONFLICT ... WHERE current_count < limite`** no handle da transacao (`db.sessions[transactionID]`), com ordem canonica de aquisicao anti-deadlock; teto estourado responde 202 `ROUTED_TO_REVIEW` + `nextEligibleAt`, e o rollback desfaz contadores parciais (quota-store.ts:99-176; editorial-publications.ts:415-524).
- **No ramo de quota esgotada nada é persistido** (a transacao aborta antes/junto de `persistPublication`): o rotulo `ROUTED_TO_REVIEW` da resposta nao corresponde a uma materia gravada em `needs_review` nesse caso especifico — divergencia semantica a observar (editorial-publications.ts:444-504).
- **Idempotencia antes da quota**: retry do mesmo `requestId` devolve `ALREADY_CONSUMED` sem reconsumir teto; UNIQUE em `autopublish-quota-usage.requestId` é a segunda defesa (editorial-publications.ts:380-398; quota-store.ts:198-232).
- **healthz/readyz sao rotas Next SEM autenticacao** e fora do handler Payload (deliberado); readyz responde 503 sem expor segredos (app/healthz/route.ts:10-23; app/readyz/route.ts:22-37).

---

## B6 — MÍDIA: onde o upload grava, URL pública, sobrevivência a restart

**Dois storages distintos, por design.** O upload de ORIGEM (o que a redação sobe no painel) é resolvido por `resolvePayloadUploadConfig` (`apps/cms/src/upload-storage-config.ts:92`); o storage PÚBLICO (a cópia que o site serve) é outro sistema, em `services/news-ingestion/src/media/storage-config.ts` com prefixo `EDITORIAL_MEDIA_*` (`apps/cms/src/upload-storage-config.ts:4-12`).

| Aspecto | Evidência |
| --- | --- |
| Driver | `local` ou `s3` via `PAYLOAD_UPLOAD_STORAGE_DRIVER` (`upload-storage-config.ts:20`, `97`) |
| Local (dev) | `staticDir` absoluto: `PAYLOAD_UPLOAD_LOCAL_ROOT` → `EDITORIAL_MEDIA_CMS_STATIC_DIR` → default `apps/cms/media` (`collections.ts:51-54`, usado em `collections.ts:450`) |
| S3 | Plugin oficial `@payloadcms/storage-s3` com `@aws-sdk/client-s3` (sem SigV4 manual), prefixo default `cms-uploads` (`payload.config.ts:63-87`, `upload-storage-config.ts:137`) |
| Sobrevive a restart? | **s3: sim.** **local em production: só com decisão explícita** — sem driver declarado o boot falha (`PAYLOAD_UPLOAD_STORAGE_DRIVER ausente em production`, `upload-storage-config.ts:105-107`); driver local exige `PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED=true` (`:154-159`) e recusa raízes efêmeras conhecidas (`/tmp/`, `/run/`, `/app/.next/`... — `:63-70`, erro `PAYLOAD_UPLOAD_LOCAL_ROOT aponta para diretorio efemero conhecido`, `:161`). A flag registra decisão, não prova o volume ("A prova de que o EasyPanel montou o volume e do runbook", `:29-34`) |
| Config inválida | Derruba o processo na subida: `throw new Error('storage de upload invalido: ...')` (`payload.config.ts:48-51`) |

**URL pública:** o site NUNCA usa a URL do CMS. O worker de projeção busca os bytes pelo endpoint interno autenticado `GET /internal/publication-media/:mediaId` (exige escopo `publication_projection`, `apps/cms/src/endpoints/publication-media.ts:89-97`), que existe justamente para o worker nunca seguir URL ("SSRF", `:4-9`). O worker grava no storage público com chave por hash de conteúdo (`services/news-ingestion/src/media/media-pipeline.ts:125,155`) e a referência pública é um **caminho, nunca URL http(s)** (`storage-port.ts:40-41`), servido pelo screen-app. Limites do endpoint: MIME `jpeg/png/webp/avif`, teto 15 MiB (`publication-media.ts:33-41`).

## B7 — ADMIN UI: customizado vs padrão + PR #94

**No HEAD auditado (953696a)** a UI é Payload padrão: `importMap` vazio com o comentário literal "Vazio: o CMS usa o padrao" (`apps/cms/app/(payload)/admin/importMap.ts`, visto no diff da PR como linha removida). A customização real no HEAD é de **schema/UX de formulário**: 8 abas SEM nome (não aninham storage — `collections.ts:533-543`), ordem de trabalho da redação (Conteudo → Midia → Autoria → SEO → Entidades → Fontes e QA → Publicacao → Automacao), descrições pt-BR em cada campo, campos de automação `readOnly`, collections `publication-outbox` e quota ocultas/não editáveis (`collections.ts:863-1022`), `service-accounts` visível só para administrador (`collections.ts:284-291`).

**PR #94** — `gh pr view 94`: título `feat(cms): redesign the Cinerie editorial admin`, **state OPEN, mergeStateStatus CLEAN** (não mergeada; o HEAD auditado não a contém). 7 arquivos, só apresentação:

| Arquivo | Mudança |
| --- | --- |
| `apps/cms/app/(payload)/custom.scss` | +691 linhas: tema claro (paleta `--cinerie-brand: #f0443e`, papel `#f6f3eb`), sidebar escura, tabs sticky em pills, tipografia Montserrat, cards/tabelas/botões restilizados, responsivo (breakpoints 1100/700px) |
| `apps/cms/src/admin/CinerieIcon.tsx` / `CinerieLogo.tsx` | Marca "CINERIE / Editorial" (SVG "C" + dot amarelo) no login e no nav |
| `apps/cms/src/admin/EditorialDashboard.tsx` | Server component `beforeDashboard`: 5 contadores por `workflowStatus` via `payload.count`, contagem de mídia/autores, badge de autopublicação, atalhos (nova matéria/mídia/autor), guia de 4 passos |
| `apps/cms/src/payload.config.ts` | `theme: 'light'`, `dateFormat: 'dd/MM/yyyy HH:mm'`, registro de `graphics.Icon/Logo` e `beforeDashboard` |
| `importMap.ts` | Deixa de ser vazio; registra os 3 componentes |
| `layout.tsx` | +1 linha: `import './custom.scss'` |

Zero mudança em schema, migrations, workflow, access ou publicação — coerente com o body da PR. **Divergência real detectada:** o dashboard decide o badge com `process.env.EDITORIAL_AUTO_PUBLISH_ENABLED === 'true'` (EditorialDashboard.tsx no diff), enquanto o resolvedor canônico aceita `'true' || '1'` (`apps/cms/src/env-auto-publish.ts:87-91`) — com `EDITORIAL_AUTO_PUBLISH_ENABLED=1` a autopublicação roda e o painel exibe "Desativada".

## B8 — EXPERIÊNCIA DO EDITOR: fluxo manual de publicação

**Passos até publicar** (confirmados pelo E2E real `apps/cms/e2e/manual-editorial.spec.ts:147-359`):

1. Login (`/admin/login`).
2. Criar **autor público** (`name` + `slug` obrigatórios, `collections.ts:354-355`) — identidade separada do usuário do CMS.
3. Subir **mídia** (arquivo + `alt` obrigatório, `collections.ts:460`) e **licenciá-la em ato separado**: nasce `licenseStatus: 'unknown'` e `allowedForEditorial/Hero/Social: false` (`collections.ts:471-480`) — sem `approved` + `allowedForEditorial` (+ `allowedForHero` para capa) a publicação trava (`hooks/articles.ts:187-189`).
4. Criar **matéria**: `title`, `contentType` (default `news`), `language` (default `pt-BR`) obrigatórios; **slug é digitado à mão** — a geração automática (`canonical-slug.ts`) só existe no caminho da autopublicação (`endpoints/editorial-publications.ts`); grava por **autosave a cada 2s** (`collections.ts:523`), não por botão.
5. Preencher corpo (blocos estruturados, sem HTML livre — `collections.ts:148-151`), capa, autores, `externalSources` e **`qaPassedAt` manualmente** (campo de data; não há runner de QA no fluxo humano — o E2E o preenche na mão, `manual-editorial.spec.ts:278`).
6. **5 transições de workflow**, uma a uma, pelo select `workflowStatus`: `draft → needs_review → in_review → human_reviewed → ready_to_publish → published` (`manual-editorial.spec.ts:301-310`; allowlist em `workflow.ts:83-96`). Papéis: `writer` só alcança `draft/needs_review`; `published` só `editor_in_chief`/`administrator` (`workflow.ts:111-124`).

**Validações e mensagens reais** (todas viram HTTP 403 via `deny`, `hooks/articles.ts:44-47`):

| Cenário | Mensagem literal |
| --- | --- |
| Sem autenticação | `escrita editorial exige autenticacao` (`hooks/articles.ts:208`) |
| Humano criando fora de draft | `artigo humano nasce em draft` (`:336`) / `automation_draft e criado apenas pela automacao` (`:335`) |
| Transição fora da allowlist | `transicao proibida: ${from} -> ${to}` (`workflow.ts:152`) |
| Papel insuficiente | `papel "${actor}" nao pode levar um artigo a "${to}"` (`workflow.ts:158`) |
| Botão nativo "Publish changes" | `_status "published" exige workflowStatus "published" (que so vem de ready_to_publish)` (`hooks/articles.ts:353`) |
| Gate de publicação | `publicacao bloqueada: ${reasons}` (`:385`) com códigos em inglês: `not_ready_to_publish, missing_slug, missing_title, missing_language, missing_active_author, qa_not_passed, has_blocking_errors, ai_assisted_without_sources, unauthorized_media, legal_hold` (`workflow.ts:186-196`) |

**Veredito: usável, com atritos deliberados e dois pontos hostis.** Usável: o E2E prova o caminho completo pelo painel real, do login ao evento `article.published` na outbox (`manual-editorial.spec.ts:349-358`); abas em ordem de trabalho, descrições pt-BR, autosave, defaults sensatos. Hostil: (a) o **botão primário visível do Payload ("Publish changes") falha por design** com 403 — não há botão de transição customizado; o editor precisa saber operar o select `workflowStatus` em 5 saves; (b) os erros do gate chegam como **códigos técnicos concatenados** (`publicacao bloqueada: qa_not_passed, missing_active_author`), não como frases acionáveis; (c) `qaPassedAt` e `slug` manuais são degraus fáceis de esquecer que só reclamam no último passo. PR #94 melhora orientação (dashboard com guia de 4 passos) mas não toca em nenhum dos três atritos.

NÃO VERIFICADO: comportamento visual real do painel (nenhum servidor foi subido — auditoria somente-leitura); montagem efetiva do volume no EasyPanel (runbook, não código); se a URL do arquivo dentro do admin passa por access control do Payload no driver s3 (o plugin é usado sem `disablePayloadAccessControl` explícito — comportamento default do plugin não confirmado no repo).

### ACHADOS-CHAVE

- Upload do CMS: `local`|`s3` fail-closed — em production, sem driver declarado o boot morre (`upload-storage-config.ts:105`); driver local exige `PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED=true` e recusa raízes efêmeras conhecidas (`:154-163`). Mídia só sobrevive a restart com S3 ou volume confirmado por decisão explícita.
- O site nunca consome URL do CMS: bytes saem só por `GET /internal/publication-media/:mediaId` com escopo `publication_projection` (`publication-media.ts:89-97`) e a referência pública é caminho por hash, nunca URL http(s) (`storage-port.ts:41`).
- PR #94 está **OPEN/CLEAN, não mergeada**: 100% apresentação (custom.scss 691 linhas, logo/ícone Cinerie, dashboard `beforeDashboard`, `theme: 'light'`); zero mudança de schema/workflow/access.
- Defeito na PR #94: dashboard compara `=== 'true'` enquanto `env-auto-publish.ts:87-91` aceita `'true'|'1'` — com `EDITORIAL_AUTO_PUBLISH_ENABLED=1` o badge mente "Desativada" com a autopublicação ligada.
- No HEAD auditado o admin é Payload padrão (importMap vazio); a UX real vem do schema: 8 abas sem nome, descrições pt-BR, campos de automação readOnly (`collections.ts:544-853`).
- Fluxo manual completo provado por E2E real de navegador até a outbox (`manual-editorial.spec.ts:147-359`), mas exige 5 transições manuais de `workflowStatus` e o botão nativo "Publish changes" retorna 403 por design (`hooks/articles.ts:353`) — atrito de UX sem botão substituto.
- Erros do gate de publicação são códigos técnicos em inglês concatenados (`publicacao bloqueada: qa_not_passed, ...`, `hooks/articles.ts:385`) — legíveis por máquina, hostis para redator.
- `slug` e `qaPassedAt` são 100% manuais no fluxo humano (geração de slug só existe na autopublicação); mídia nasce `licenseStatus: 'unknown'` e bloqueia publicação até liberação humana explícita (`collections.ts:471-480`, `hooks/articles.ts:187`).

---

# 5. BLOCO C — CLIENTES DE API EXTERNAS (api-clients/)

## Bloco C1+C2+C5 — Auditoria de `api-clients/` (commit 953696a)

### (1) Clientes reais

| Cliente (pacote) | Endpoints implementados | Autenticacao | Rate limit | Retry/backoff | Cache | Tratamento de erro | Campos mapeados |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **tmdb** (`@screena/tmdb-client`, `api-clients/tmdb/package.json:2`) | **Detalhe** (`endpoints.ts`): `getMovie` `/movie/{id}` (endpoints.ts:100-103), `getTvShow` `/tv/{id}` (:104-107), `getTvSeason` (:108-116), `getTvEpisode` (:117-125), `getPerson` (:126-129), `getUpcomingMovies` `/movie/upcoming` (:130-137) — todos com `append_to_response` maximo particionado (endpoints.ts:74-94, teto `TMDB_APPEND_LIMIT=20` em append-to-response.ts:23). **Catalogo** (`catalog.ts:222-266`, 40 metodos): `/configuration{,/countries,/languages,/jobs}`, generos, certificacoes, listas (`popular/top_rated/now_playing/airing_today/on_the_air`), `/movie|tv|person/changes` (catalog.ts:320-328), `discoverMovies/TvShows` com allowlist de filtros (catalog.ts:186-204, filtro desconhecido lanca `TmdbCatalogError` :199), `search/{movie,tv,person,multi}`, `/trending/{type}/{window}` (:353-365), images/videos por entidade, `collection/company/network/keyword` (:397-410) | `TMDB_READ_ACCESS_TOKEN` (v4, header `authorization: Bearer`, http.ts:227-229) preferido; fallback `TMDB_API_KEY` (v3, query `api_key`, http.ts:219-221); sem auth lanca `TmdbConfigError` (config.ts:78-81) | Sim — throttle de intervalo minimo por `maxRps` (default 20; config.ts:87; http.ts:198-202) | Sim — exponencial base 250ms, teto 10s, jitter, so em 429/5xx/rede; 4xx nunca retenta (http.ts:72-73, 91-94, 160-172, 204-212). Circuit breaker por fonte (http.ts:191-196, threshold 5 / cooldown 30s, config.ts:89-90) | **Nao no client** — `cacheTtlMs` (config.ts:91, default 24h) e consumido pelo worker; o adapter `api_cache` vive em `services/ingestion/src/persistence/cache.ts:22-52` | `TmdbHttpError` com flag `permanent` (http.ts:39-51); `TmdbCircuitOpenError` (:54-62); JSON invalido em 2xx lanca (:233-240) | Subset tipado em `types.ts`: `TmdbMovieDetail` (:45), `TmdbTvDetail` (:75), `TmdbSeasonDetail` (:107), `TmdbEpisodeDetail` (:118), `TmdbPersonDetail` (:132), credits/external_ids (:10-43); sub-recursos extras seguem no payload bruto para `tmdb_raw` (endpoints.ts:11-13) |
| **rapidapi-core** (`@screena/rapidapi-core`) | Nao tem endpoints proprios — e o executor HTTP compartilhado (`RapidApiHttpClient.request`, http.ts:167-239) + utilitarios: `buildCacheKey` (cache-key.ts:34-39, chave `(provider_api, request_key, params_hash)`), `stableStringify/sha256Hex/hashPayload` (hash.ts:17-43), `sanitizePayload/redactSecrets` (sanitize.ts:46-61), leitores de env (`requireSecret` cita so o NOME da var, env.ts:56-65) | Headers `x-rapidapi-key` + `x-rapidapi-host` (http.ts:81-83, 287-293); a chave NUNCA entra na URL (http.ts:276-285) | Sim — throttle por `maxRps` por instancia (http.ts:139, 259-263) | Sim — mesmo padrao do TMDB + timeout via `AbortController` (http.ts:91-111); Retry-After respeitado com teto (http.ts:265-273); breaker POR instancia/API (http.ts:129-131, 252-257) | Fornece a chave e o hash; a persistencia em `api_cache` e do worker (http.ts:10-12) | `RapidApiHttpError`/`RapidApiCircuitOpenError`/`RapidApiInvalidPayloadError` (errors.ts via http.ts:21-25); erro cru de fetch nunca propaga (poderia vazar URL/headers, http.ts:182-190) | N/A (nao interpreta payload) |
| **film_show_ratings** (`@screena/film-show-ratings-client`) | `getPopular()` → `GET /popular/[?type=film\|show]` (client.ts:87-90); `getItem(id)` → `GET /item/?id=tt...` (client.ts:98-101); builders puros p/ dry-run `buildPopularRequest`/`buildItemRequest` (client.ts:49-72) | `RAPIDAPI_FILM_SHOW_RATINGS_KEY` obrigatoria (config.ts:27, 47), header `x-rapidapi-key`; host default `film-show-ratings.p.rapidapi.com` (provider.ts:14) | Sim, via core — `maxRps` default **2** (config.ts:52) | Sim, via core — retries 3, breaker 5/30s, timeout 15s (config.ts:53-56) | `cacheTtlMs` na config (config.ts:57-60) + `cacheKey` em cada request (client.ts:54, 70); gravacao no worker | Herda do core; `getRequestCount()` p/ `quota_cost` (client.ts:104-106) | **Nenhum** — devolve `unknown` cru deliberadamente ("esta API nao publica schema"; client.ts:2-11); mapping para `external_ratings` e de `services/ratings` |
| **streaming_availability** (`@screena/streaming-availability-client`) | `getShow` → `GET /shows/{imdbId}?series_granularity&output_language` (client.ts:181-184; guard anti path-traversal `isSafeShowId` :139-141, so `tt\d+`/`movie\|tv/\d+`); `searchByTitle` → `/shows/search/title` (:187-190); `searchByFilters` → `/shows/search/filters` (:193-196, country ISO-2 validado :110); `getChanges` → `/shows/search/changes` (:199-202); `getCountries` (:205-207); `getCountry` (:210-214); `getGenres` (:217-219) | `RAPIDAPI_STREAMING_AVAILABILITY_KEY` obrigatoria (config.ts:26, 44), header `x-rapidapi-key`; host default `streaming-availability.p.rapidapi.com` (provider.ts:24) | Sim, via core — `maxRps` default 2 (config.ts:50) | Sim, via core — retries 3, breaker 5/30s, timeout 15s (config.ts:51-57) | `cacheTtlMs` (config.ts:58-61) + `cacheKey` por request (client.ts:86-88); gravacao no worker | Herda do core; `RapidApiConfigError` em input invalido (client.ts:97, 110, 156-158, 212) | **Nenhum** — payload cru `unknown`; normalizacao p/ `watch_availability` em `services/streaming` (client.ts:2-7). Sem param `country` na chamada: filtro BR e do worker (client.ts:38-41) |

### (2) Placeholders imdb / kaso / rotten_tomatoes

Confirmado: cada diretorio contem **apenas `README.md`** (saida literal de `ls`):
```
api-clients/imdb:            README.md
api-clients/kaso:            README.md
api-clients/rotten_tomatoes: README.md
```
Busca por imports/referencias em codigo (`grep -rE "api-clients/(imdb|kaso|rotten_tomatoes)|@screena/(imdb|kaso|rotten[-_]tomatoes)"` sobre `*.ts/*.tsx/*.js/*.json`, excluindo node_modules e os proprios READMEs): **zero resultados**. Sem `package.json`, nao sao workspaces; nada no codigo os importa. `kaso` e `imdb236` aparecem apenas como entradas declarativas em `docs/api-coverage/providers.yaml` (estado `not_applicable`/`seeded`) e `imdb236` como valor de exemplo de `provider_api` — nunca como modulo.

### (3) Consumo

| Cliente | Consumidores (service/CLI) | Disparo |
| --- | --- | --- |
| tmdb | `services/ingestion`: composition (`createTmdbClient` em src/composition.ts:12,28, com `api_cache` + `api_sync_logs` wired :29-35), normalizers (src/normalizers/*.ts), CLIs `bin/sync-tmdb.ts`, `bin/sync-tmdb-config.ts`, `bin/sync-tmdb-raw.ts`, `bin/catalog.ts` (catalog.ts:34,276,385); `services/sync/bin/run.ts` reusa a ingestao p/ refresh de stale (run.ts:12-13,26-40). Descoberta de ids (`bin/discover-ids.ts`) NAO usa o client — baixa exports publicos de `files.tmdb.org` via fetch proprio (discover-ids.ts:90-94) | **Cron via systemd timer (arquivos versionados, instalacao manual no host)**: `services/ingestion/systemd/cinerie-catalog-cycle.timer` (`OnCalendar=hourly`, `Persistent=true`) → `cinerie-catalog-cycle.service` → `scripts/catalog/catalog-cycle-with-alert.sh` (worker de fila + reindex + index-decisions, com `flock`); legado `services/sync/systemd/screena-tmdb-catalog.timer` (`OnCalendar=*-*-* 03:00:00`) → `bin/run.ts`, mantido como rollback (comentario no service: "substitui operacionalmente o par legado... NAO foi removido"). Bootstrap/sync pontual = CLI manual. NAO VERIFICADO: se os timers estao de fato instalados/ativos no host (fora do repo) |
| film_show_ratings | `services/ratings`: `bin/sync-film-show-ratings.ts` (unico executor; importa `createFilmShowRatingsClient` na linha ~60) + core puro `src/film-show-ratings/{run,args}.ts` | **Manual apenas** — CLI com dry-run default, `--sample`/`--apply` explicitos, fail-closed ("aborta em producao"; cabecalho do bin). Nenhum timer/cron/easypanel referencia este bin (busca por unit files so achou os 2 timers de catalogo acima) |
| streaming_availability | `services/streaming`: `bin/sync-streaming-availability.ts` (sync), `bin/promote-watch-availability.ts` e `bin/review-watch-availability.ts` (promocao/revisao humana), core em `src/streaming-availability/` e `src/promotion/` | **Manual apenas** — mesmo padrao dry-run/`--sample`/`--apply`, fail-closed; toda oferta nasce `display_allowed=false` (cabecalho do bin). Sem scheduler |
| rapidapi-core | So os dois clients acima (imports em film_show_ratings/src/client.ts:13-21 e streaming_availability/src/client.ts:9-18) + `sanitizePayload` usado direto pelo bin de streaming | N/A (biblioteca) |

Nenhuma referencia a cron/scheduler em Dockerfiles, `.github/workflows/ci.yml` ou `scripts/deploy/` para esses workers; os unicos agendadores versionados sao os dois pares systemd citados.

### (4) O que `pnpm api:coverage` mede DE VERDADE

Script: `scripts/audit/check-api-coverage.mjs` → logica pura em `scripts/audit/api-coverage-core.mjs`. E uma auditoria **offline de consistencia entre um registro declarativo e o codigo** — nao mede chamadas reais nem cota. Verifica (check-api-coverage.mjs:12-21):
- (a) todo endpoint/campo do registro tem exatamente 1 de 8 estados de cobertura;
- (b) `provider_api != rating_source` e nunca e fonte editorial (invariante 2);
- (c) `worker_only === true` em toda entrada (invariante 3);
- (d) `not_applicable` exige justificativa, `deprecated` exige substituto;
- (e) **ancora de codigo**: entrada implementada aponta arquivo real contendo os simbolos declarados;
- (f) **drift reverso**: metodo `async get<X>(` nos 4 arquivos enumerados (api-coverage-core.mjs:70-76) sem entrada no registro = violacao. A regex e `\basync\s+(get[A-Z]...)\(` (api-coverage-core.mjs:79) — **so pega metodos comecando com `get`**.

Registro (`docs/api-coverage/`): **71 endpoints** — tmdb 49, gemini 12, streaming_availability 5, rapidapi_film_show_ratings 2, imdb236 1, rssprime 1, kaso 1; estados: `public_ready` 5, `normalized` 15, `raw_captured` 19, `not_applicable` 28, `blocked_license` 2 (`film_show_ratings.item`, `streaming_availability.show`), `blocked_plan` 1 (`film_show_ratings.popular`), `deprecated` 1 (`imdb236.item`). **34 campos** em fields.json. Ou seja: dos 71, ~39 (normalized+raw_captured+public_ready) estao implementados/usados; 28 sao declaradamente fora de escopo e 4 bloqueados por licenca/plano/deprecacao.

### ACHADOS-CHAVE

- Os 4 clientes reais implementam os mecanismos obrigatorios (throttle por RPS, retry exponencial+jitter so em transitorio, breaker por fonte) com transporte/relogio injetaveis — TMDB em `api-clients/tmdb/src/http.ts:105-241`, RapidAPI em `api-clients/rapidapi-core/src/http.ts:133-303`. Cache e hash sao responsabilidade do worker, nao do client (por design documentado, rapidapi-core/src/http.ts:10-12).
- **Gap no drift reverso do `api:coverage`**: a regex so captura `async get<X>(` (api-coverage-core.mjs:79). `searchByTitle`/`searchByFilters` do streaming client (client.ts:187-196) e os `discover*/search*` do catalogo TMDB escapam da deteccao automatica — o registro de streaming lista so 5 endpoints (show/changes/countries/genres/person_season_episode); os 2 endpoints de busca do client **nao tem entrada no registro e o audit nao acusa**.
- Placeholders `imdb`, `kaso`, `rotten_tomatoes`: confirmados como so-README, sem `package.json`, com zero imports no codigo (grep repo-wide vazio).
- Segredos so em env vars, com nomes canonicos: `TMDB_READ_ACCESS_TOKEN`/`TMDB_API_KEY` (config.ts:69-70), `RAPIDAPI_FILM_SHOW_RATINGS_KEY` (config.ts:27), `RAPIDAPI_STREAMING_AVAILABILITY_KEY` (config.ts:26); chave RapidAPI viaja so em header e mensagens de erro citam apenas o NOME da variavel (env.ts:56-65).
- Clients de ratings/streaming devolvem payload **cru** (`unknown`) por decisao explicita — a interpretacao/mapping fica em `services/ratings` e `services/streaming`, coerente com invariante 2 (`FILM_SHOW_RATINGS_PROVIDER_API='rapidapi_film_show_ratings'`, provider.ts:11).
- Agendamento real versionado existe SO para TMDB/catalogo: timer horario `cinerie-catalog-cycle.timer` + legado diario 03:00 `screena-tmdb-catalog.timer`; ratings e streaming sao 100% manuais (CLI dry-run default, fail-closed em producao). Instalacao efetiva dos timers no host: NAO VERIFICADO (fora do repo).
- `pnpm api:coverage` NAO mede uso real de API: e um lint offline de consistencia registro↔codigo (8 estados, worker_only, ancoras de simbolo, drift `get*`). Do registro: 71 endpoints declarados, ~39 implementados, 28 `not_applicable`, 4 bloqueados (2 por licenca, 1 por plano, 1 deprecado).
- Retry-After no TMDB (`http.ts:97-102`) e no core RapidAPI (`http.ts:119-124`) ignoram o formato HTTP-date (so aceitam segundos) — caso raro, degrada para backoff exponencial normal; o core ainda aplica teto `BACKOFF_MAX_MS` ao Retry-After (rapidapi-core/src/http.ts:265-268), o client TMDB nao (tmdb/src/http.ts:204-207: dorme o valor cru).

---

### C4 — Teste de conectividade (executado nesta auditoria, 1 chamada de leitura por provedor)

Chaves lidas do `.env` do checkout principal, exportadas em shell sem nunca serem impressas. Resultado literal:

| Provedor | Endpoint chamado | Status | Latência | Evidência de validade | Cota |
| --- | --- | --- | --- | --- | --- |
| TMDB | `GET /3/movie/550?language=pt-BR` (Bearer `TMDB_READ_ACCESS_TOKEN`) | **200** | 496 ms | `title="Clube da Luta"` | headers de rate limit não expostos |
| film_show_ratings (RapidAPI) | `GET /item/?id=tt0137523` | **200** | 1.778 ms | corpo `{status, result}` | **1439/1440 restantes** no dia — quota praticamente intocada |
| streaming_availability (RapidAPI) | `GET /shows/tt0137523` | **200** | 1.228 ms | corpo `{itemType, showType, id, imdbId, tmdbId}` | headers não expostos |
| Gemini | **NÃO CHAMADO** (regra do diagnóstico) | — | — | `GEMINI_API_KEY` e `GEMINI_MODEL` presentes no `.env` (validade da chave NÃO VERIFICADA) | — |

Conclusão: as três chaves ativas são válidas e a cota de ratings está de pé. A quota 1439/1440 também confirma o achado do Bloco D: **os workers de ratings não estão rodando em produção** (se rodassem, a cota diária não estaria cheia).

---

# 6. BLOCO D — SERVICES E CLIs

## Bloco D — services/ingestion, services/sync, services/ratings, services/streaming

---

## 1. `services/ingestion` (`@screena/ingestion`)

**Responsabilidade real (src/):** plataforma completa de catalogo TMDB. Nucleo puro exportado em `services/ingestion/src/index.ts:12-40` (types, ports, normalizers movie/tv/season/episode/person, discovery de Daily ID Exports com filtro adulto, raw-sync, raw-promote); runtime com Prisma em `services/ingestion/src/composition.ts:27-41` (`createIngestionContext` = client TMDB + cache/store/syncLog Prisma + stale de 7 dias, exportado via subpath `./runtime`, `package.json` `exports`). Contem tambem a fila duravel de jobs (`src/catalog-jobs/worker.ts:1-18` — claim SKIP LOCKED, heartbeat, retry/dead-letter, IO injetado), projecao de busca (`src/search-projection/`), auditoria de banco (`src/audit/`) e produtor de decisoes de indexabilidade. **Importa:** `@screena/db`, `@screena/tmdb-client`, `@screena/public-contracts`, `@screena/seo` (`services/ingestion/package.json`). **Expoe:** superficie pura + runtime; adapters Prisma NAO sao reexportados (`src/index.ts:6-8`). Consumido por `services/sync/bin/run.ts:13` e pelos proprios validadores.

**CLIs em `bin/`:**

| CLI | O que faz | Args | Destrutivo? | Runbook |
| --- | --- | --- | --- | --- |
| `bin/catalog.ts` (alias raiz `pnpm catalog`, `package.json:42`) | Entrada unica: 16 comandos (`src/cli/args.ts:18-35`): `bootstrap, plan-bootstrap, enqueue, worker, sync, changes, discovery, media, episodes, search-reindex, search-status, status, audit-database, index-decisions, backfill-finalization, dead-letter(list\|replay)` | por comando; flags `--apply/--dry-run/--limit/--entity/--strategy/--from/--to/--concurrency/--max-jobs/--force/--confirm-production-read` | Mutantes exigem `--dry-run`/`--apply` explicito (`src/cli/args.ts:169-183`); read-only: `status, search-status, audit-database, plan-bootstrap` (`args.ts:186-193`). `worker` e excecao: processa sem exigir flag (`args.ts:379` comentario). `index-decisions` escreve tabela que o sitemap le | `docs/runbooks/catalog-bootstrap.md`, `catalog-incremental-sync.md`, `catalog-dead-letter.md`, `catalog-production-audit.md` |
| `bin/discover-ids.ts` | Baixa os 7 Daily ID Exports do TMDB (nunca `adult_*`), filtra fail-closed, monta fila NDJSON | `--apply`, `--date`, `--only`, `--max-per-type` | Escreve artefato + `api_sync_logs` so com `--apply`; dry-run default | `catalog-bootstrap.md:118` |
| `bin/sync-tmdb-raw.ts` | Consome fila NDJSON e grava payload bruto em `tmdb_raw` (idempotente por hash) | `--apply`, `--queue`, `--limit-movies/tv/people`, `--concurrency`, `--report` | Escreve `tmdb_raw` + log com `--apply`; aborta em producao | `catalog-bootstrap.md:122` |
| `bin/promote-tmdb-raw.ts` | Promove `tmdb_raw` → tabelas tipadas + slug + traducao pt-BR; ZERO rede | `--apply`, `--kind=movie\|tv\|person`, `--limit`, `--report` | Escreve com `--apply`; aborta em producao | `catalog-bootstrap.md` |
| `bin/import.ts` | Import TMDB por ID (movie/tv/person) via pipeline | `--movie`, `--tv`, `--person`, `--seed` | Escreve sempre que roda (sem gate dry-run proprio) | citado em docs (`docs/PHASE_2_TMDB_PLAN.md`), sem runbook dedicado |
| `bin/ingest-public-catalog.ts` | Backfill curado do catalogo publico (slug + traducao pt-BR + file_path de imagem) | `--apply`, `--include-upcoming`, `--download-images`, `--refresh-images` | Escreve com `--apply`; aborta em producao | citado em docs de auditoria, sem runbook dedicado |
| `bin/sync-tmdb.ts` | CLI unificada Fases 6-8: `configuration\|taxonomies\|genres\|media\|lists\|discover\|trending` | `--id --language --page --limit --max-pages --resume --apply` etc. | Dry-run default; `--apply` aborta em producao | `catalog-bootstrap.md:82,114` |
| `bin/sync-tmdb-config.ts` | Wrapper legado do sync de taxonomia (8 endpoints → `api_cache` + `tmdb_image_config`) | `--apply` | idem | `catalog-bootstrap.md:83,113` |

**Gate de producao do `catalog.ts`:** escrita em producao exige `--force`; leitura exige `--confirm-production-read` (`src/cli/exit.ts:71-86`) — ou seja, o catalogo PODE operar producao deliberadamente, diferente de ratings/streaming.

**Agendamento:** `services/ingestion/systemd/cinerie-catalog-cycle.timer` — `OnCalendar=hourly`, `Persistent=true`, `RandomizedDelaySec=300`; o `.service` executa `scripts/catalog/catalog-cycle-with-alert.sh` (audit → worker → search-reindex → index-decisions --apply → audit → sentinela → alerta, com `flock`). O proprio unit diz "Instalar em /etc/systemd/system/ no host de operacao" — sao ARQUIVOS no repo, nao prova de instalacao ativa.

**Estado:** implementado (src acima) · ligado ao fluxo (sync o consome em `services/sync/bin/run.ts:13`; o app publico le as tabelas que ele povoa) · validado por teste (28 arquivos em `src/__tests__/`; integracao PG16 no CI: `.github/workflows/ci.yml:231-241`; governanca das units em `tests/governance/catalog-scheduler-units.test.ts`) · producao: **NAO VERIFICAVEL alem de artefatos** — existem units systemd + runbooks, mas nenhum dos 3 Dockerfiles do repo roda este servico (`Dockerfile` = web, `Dockerfile.cms`, `Dockerfile.publication-worker` = news-ingestion). A instalacao/ativacao do timer e estado do host, fora do repo.

---

## 2. `services/sync` (`@screena/sync`)

**Responsabilidade real:** minima. `src/index.ts:9` exporta so `stale-policy.ts` (3 simbolos puros: janela de 7 dias, `staleAfterFrom`, `isStale` — `src/stale-policy.ts:9-20`). O runner `bin/run.ts:24-45` seleciona movies/tv com `staleAfter` nulo/vencido e reimporta via `importMovie`/`importTvShow` da ingestao. **Importa:** `@screena/db`, `@screena/ingestion`. **Expoe:** so a politica pura.

**CLI:** `bin/run.ts` — arg posicional unico `[limite]` (default 50, `bin/run.ts:15-19`). Destrutivo: sim (reimporta/reescreve entidades stale), **sem dry-run e sem gate de producao** — unico bin do bloco sem fail-closed. Runbook: nenhum dedicado; documentado apenas na propria unit systemd e em `workers/README.md`.

**Agendamento:** `services/sync/systemd/screena-tmdb-catalog.timer` — `OnCalendar=*-*-* 03:00:00` diario, executando `pnpm --filter @screena/sync exec tsx bin/run.ts 50`. **Status LEGADO explicito**: o cabecalho de `cinerie-catalog-cycle.service` declara que o substitui operacionalmente ("O legado NAO foi removido... Rollback = desabilitar este timer e reabilitar o legado"), e `tests/governance/catalog-scheduler-units.test.ts:36-42` trava que a unit nova NAO execute `@screena/sync bin/run.ts`.

**Estado:** implementado · ligado ao fluxo (reusa a ingestao) · teste: apenas `src/__tests__/stale-policy.test.ts` — o runner `bin/run.ts` esta EXCLUIDO do typecheck (`bin/run.ts:3`) e nao tem teste proprio · producao: NAO VERIFICADO; artefato = unit legada, sem Dockerfile/entrypoint.

---

## 3. `services/ratings` (`@screena/ratings`)

**Responsabilidade real:** worker offline de ratings externos via RapidAPI (Film/Show Ratings). Nucleo puro em `src/index.ts:16-27` (ports, CLI parser, gate, mapping com reatribuicao de fonte editorial — invariante 2 citada no header —, guardrails de promocao, metricas). Persistencia grava **estruturalmente fail-closed**: `displayAllowed: false` no create E no update (`src/persistence/external-ratings-store.ts:108,139`), `license_status=unknown` decidido no store (`src/film-show-ratings/run.ts:13`). **Importa:** `@screena/config`, `@screena/db`, `@screena/film-show-ratings-client`, `@screena/rapidapi-core`, `@screena/schemas`.

**CLIs:**

| CLI | O que faz | Args | Destrutivo? | Runbook |
| --- | --- | --- | --- | --- |
| `bin/ratings.ts` (alias raiz `pnpm ratings`, `package.json:43`) | 5 comandos (`src/cli/args.ts:15`): `sample` (payload real, grava so cache+log), `sync` (delega ao bin dedicado via `src/cli/delegate.ts`), `review` (read-only), `promote`/`revoke` (viram `display_allowed`, so PostgreSQL) | `--source --entity --limit --dry-run --apply --ids --reviewer --confirm` | `promote`/`revoke` exigem `--confirm`; `sync --apply` grava `external_ratings`; dry-run e default (`args.ts:8`) | `docs/runbooks/ratings-sync.md` (cobre os 5 comandos) |
| `bin/sync-film-show-ratings.ts` | Worker do endpoint `/item/?id=<IMDb_ID>`; enriquece entidades locais por IMDb id, nunca por titulo | `--type --id --limit --sample --apply` | `--apply` grava `external_ratings` (fail-closed); dry-run default | `ratings-sync.md:43` |

**Agendamento:** **nenhum**. Sem unit systemd, sem cron, sem workflow. E mais: o gate bloqueia producao SEMPRE (`src/film-show-ratings/gate.ts:44` — `if (input.isProd) return { allowed: false }`, "mesmo em dry-run: nada de rede em prod"). Tudo manual, dev/staging.

**Estado:** implementado · ligado ao fluxo de leitura: `apps/web/src/server/entity-ratings.ts:9-13` le `external_ratings` filtrando `display_allowed` (a exibicao depende de promocao humana) · testado (11 arquivos em `src/__tests__/`; integracao PG16 no CI `.github/workflows/ci.yml:246`; governanca `tests/governance/rapidapi-offline-only.test.ts`) · producao: **estruturalmente impedido de rodar em producao** pelo gate; nenhum Dockerfile/scheduler o cobre.

---

## 4. `services/streaming` (`@screena/streaming`)

**Responsabilidade real:** worker offline de disponibilidade legal (Movie of the Night via RapidAPI) → `watch_availability`, com replace transacional por entidade/pais e escopo por `provider_api`; toda linha nasce `display_allowed=false` ate licenca/atribuicao ("Streaming Availability API by Movie of the Night" com link — header de `bin/sync-streaming-availability.ts`). Nucleo puro em `src/index.ts:12-26` (gate, mapping, run, report + ferramenta governada de promocao). **Importa:** `@screena/db`, `@screena/rapidapi-core`, `@screena/streaming-availability-client`.

**CLIs:**

| CLI | O que faz | Args | Destrutivo? | Runbook |
| --- | --- | --- | --- | --- |
| `bin/sync-streaming-availability.ts` | Dry-run (plano) / `--sample` (payload real, so cache+log) / `--apply` (replace transacional em `watch_availability`) | `--kind --country --limit --sample --apply` | `--apply` escreve; dry-run default; aborta em producao (`src/streaming-availability/gate.ts:40`) | `docs/runbooks/streaming-sync.md:22-24` |
| `bin/review-watch-availability.ts` | Revisao READ-ONLY de candidatas (`display_allowed=false`), avalia guardrails | `--kind --entity-id --country --limit --report --json` | Nao — "sem NUNCA alterar o banco" | `streaming-sync.md:46` |
| `bin/promote-watch-availability.ts` | Vira `display_allowed` por ids explicitos; substitui SQL manual | `--ids --country --confirm --revoke --reviewer` | Sim com `--confirm`; dry-run default; zero rede | `streaming-sync.md:55-68` |

**Agendamento:** **nenhum** — e gate identico ao de ratings bloqueia producao sempre (`src/streaming-availability/gate.ts:5,40`). Tudo manual.

**Estado:** implementado · ligado ao fluxo de leitura: `apps/web/src/server/entity-watch.ts:57-104` filtra `displayAllowed: true` + `licenseStatus in (official,licensed,third_party)` · testado (11 arquivos em `src/__tests__/`, inclusive `promotion-no-network.test.ts`; CI `.github/workflows/ci.yml:222-223` + Backend B linha 246) · producao: sync bloqueado por gate; promocao (`promote-watch-availability`) nao tem gate de producao no header lido — **NAO VERIFICADO** se ha gate interno em `src/promotion/run.ts` (nao aberto).

---

## Resposta consolidada sobre agendamento (repo inteiro)

| Mecanismo | Existe? | Evidencia |
| --- | --- | --- |
| systemd timer (catalogo, ativo por design) | Sim, como arquivo | `services/ingestion/systemd/cinerie-catalog-cycle.timer` (`OnCalendar=hourly`) → `catalog-cycle-with-alert.sh` |
| systemd timer (sync legado) | Sim, como arquivo, declarado substituido | `services/sync/systemd/screena-tmdb-catalog.timer` (`OnCalendar=*-*-* 03:00:00`) |
| GitHub Actions `schedule:` | Nao | grep em `.github/` sem matches |
| node-cron / cron em codigo | Nao | grep `node-cron` em `pnpm-lock.yaml` sem matches |
| EasyPanel scheduled task | Apenas INTENCAO em doc | `docs/EASYPANEL_DEPLOY.md:111-112` |
| `workers/scheduler.py` | Scaffold legado, declarado inativo | `workers/README.md:20-22` ("permanecem como legado/scaffold — nesta fase NAO") |
| Dockerfile para algum dos 4 services | Nao | `Dockerfile` (web), `Dockerfile.cms`, `Dockerfile.publication-worker` (news-ingestion) |

Conclusao: **nao existe scheduler executavel dentro do repo**; o unico agendamento definido sao as duas units systemd, que exigem instalacao manual no host. Ratings e streaming nao tem agendamento nenhum e sao bloqueados em producao por gate de codigo. Se as units estao de fato instaladas/ativas num host: NAO VERIFICAVEL a partir do repo.

### ACHADOS-CHAVE

- Dois schedulers coexistem como arquivo: `cinerie-catalog-cycle.timer` (hourly, atual) e `screena-tmdb-catalog.timer` (diario 03:00, legado nao removido); a nao-regressao e travada por `tests/governance/catalog-scheduler-units.test.ts:36-42`.
- Nenhum scheduler roda de dentro do repo (sem GH Actions `schedule:`, sem node-cron, sem Dockerfile para os 4 services); ativacao em producao depende de instalar as units no host — invisivel ao repo.
- Ratings e streaming sao **estruturalmente proibidos de rodar em producao**: `gate.ts` de ambos retorna `allowed:false` se `isProd`, mesmo em dry-run (`services/ratings/src/film-show-ratings/gate.ts:44`; `services/streaming/src/streaming-availability/gate.ts:40`).
- Assimetria deliberada: a CLI `catalog` opera producao com `--force` (escrita) / `--confirm-production-read` (leitura) (`services/ingestion/src/cli/exit.ts:71-86`) — e o unico caminho de escrita em producao do bloco.
- `services/sync/bin/run.ts` e o unico bin do bloco **sem dry-run e sem gate de producao**, esta excluido do typecheck e sem teste proprio (so a stale-policy pura e testada).
- Fail-closed de licenca e estrutural na escrita: `displayAllowed: false` fixado no store de ratings em create E update (`services/ratings/src/persistence/external-ratings-store.ts:108,139`); web le com filtro `display_allowed=true` + `licenseStatus` permitido (`apps/web/src/server/entity-watch.ts:57-104`).
- `catalog worker` nao exige `--dry-run/--apply` (excecao documentada em `src/cli/args.ts:379`) — drena a fila direto; a protecao contra concorrencia e `flock` no shell + SKIP LOCKED, e o unit alerta que nao ha unique parcial para decisoes de indexabilidade vigentes.
- `bin/import.ts` e `bin/ingest-public-catalog.ts` nao tem runbook dedicado (so mencoes em docs de auditoria/plano); `import.ts` escreve sem flag de confirmacao.
- NAO VERIFICADO: gate de producao interno de `services/streaming/src/promotion/run.ts` (arquivo nao aberto); estado real dos timers em qualquer host.

---

## Bloco D (parte 2) — entity-writer, news-ingestion, user-platform, legal

_Cobertura inline (agente falhou por limite de sessão); mesma regra de evidência._

### services/entity-writer

- **Responsabilidade real**: pipeline offline de geração de `content_blocks` com Gemini. Estrutura: `src/gemini/` (adapter + **`fake.ts`** para teste), `src/prompt/` (leitura de `prompts/entity_intro_pt.md`, extraindo `prompt_version` do frontmatter), `src/pipeline/` (`run-generation.ts`, `decide-status.ts`, `persistence-plan.ts`), `src/persistence/` (`content-block-store.ts`, `entity-writer-log-store.ts`, `job-enqueue.ts`, `inspect-store.ts`).
- **Slice ativo**: o prompt combinado `entity_intro_pt.md` gera `editorial_intro` + `cast_intro` (comentário-contrato em `src/prompt/`: "prompt combinado que gera `editorial_intro` + `cast_intro`"). Os demais block_types são contrato/roadmap (ver Bloco H).
- **CLIs em `bin/`**: `enqueue.ts` (enfileira jobs), `run.ts` / `run-offline.ts` (executa geração; offline usa fake adapter), `inspect.ts` (leitura), `smoke-gemini.ts` (fumaça com chave real — manual). Nenhum agendador aponta para eles: **execução 100% manual**.
- **Estado**: implementado ✔ · ligado ao fluxo ✔ (web lê `content_blocks` com `reviewStatus` publicável — `apps/web/src/server/movie-page.ts:125-134`) · testado ✔ (suite própria em `src/__tests__`) · ativado em produção: **NÃO VERIFICÁVEL do repo** (sem Dockerfile/timer; contagem real depende de M6).

### services/news-ingestion

- **Responsabilidade real**: (a) plataforma editorial pura (identidade, dedup, ciclo de vida, slug, projeção de busca — `src/*.ts` sem Prisma); (b) adapters Prisma em `src/persistence/`; (c) **worker de projeção editorial** (`bin/project-editorial.ts`) — o único processo que fala com os dois lados (API Payload via HTTP + banco público via Prisma). Detalhe completo no Bloco G.
- **CLIs em `bin/`**: `editorial.ts` (CLI de desenvolvimento, com barreira anti-produção), `project-editorial.ts` (worker de loop contínuo: `PROJECTION_POLL_INTERVAL_MS` default 15s, `PROJECTION_BATCH_SIZE` default 10, `PROJECTION_LEASE_MS` default 60s — `src/projection-worker-config.ts:111-113`), `qa-editorial-seed.ts` (seed de QA), `worker-preflight.ts` (checagens de subida).
- **Agendamento**: o worker é processo de longa duração (poll), não cron. Dockerfile próprio existe (`Dockerfile.publication-worker`, ver A3/J3). Presença em produção: NÃO VERIFICADA (formulário N).
- **Estado**: implementado ✔ · ligado ✔ (CI roda integração + canários reais, `.github/workflows/ci.yml:108,148,159,172`) · testado ✔ · em produção: NÃO VERIFICADO.

### services/user-platform

- **Responsabilidade real**: identidade, credencial, sessão, tokens, e-mail transacional (Brevo REST sem SDK), listas/biblioteca/tracker/importação. O runtime está **WIRED** nas rotas `/api/auth/**`, `/api/account/**`, `/api/me/**` de apps/web — todas delegadoras de 3 linhas (ex.: `apps/web/app/api/me/library/route.ts`: "Delegador de tres linhas: toda a regra vive em @screena/user-platform").
- **Sem `bin/`** (não há CLI; é biblioteca de runtime).
- **Estado**: implementado ✔ · ligado ✔ · testado ✔ (suites C7A–C8 no monorepo; validadores PG16 no CI) · em produção ✔ (o formulário de `/pt/criar-conta/` e `/api/health` com `database: ok` respondem no domínio público).

### services/legal

- **Responsabilidade real**: registro de autorização de fontes e atribuição (`authorization-spec.ts`, `plan.ts`, `report.ts`); CLI única `bin/legal.ts` com subcomandos de planejamento/relatório (`pnpm legal`, raiz `package.json`). Roda manual; validador `validate:source-authorization-and-attribution` no CI.
- **Estado**: implementado ✔ · ligado (gates de licença fail-closed consomem as decisões) · testado ✔ · decisão da matriz legal segue pendente de humano (PR #74 draft, memória do projeto — hipótese, não fonte).

### D3 — Scheduler (resposta consolidada)

Não existe NENHUM scheduler executável dentro do repo (sem GH Actions `schedule:`, sem node-cron). O que existe são **units systemd versionadas** para o catálogo TMDB (`cinerie-catalog-cycle.timer` horário + legado `screena-tmdb-catalog.timer` diário 03:00, com teste de não-regressão `tests/governance/catalog-scheduler-units.test.ts:36-42`) e **exemplos de cron** para backup (`docs/runbooks/BACKUP_RESTORE.md:52`). Instalação efetiva no host: NÃO VERIFICÁVEL do repo. Ratings e streaming são **estruturalmente proibidos de rodar em produção** (`gate.ts` de ambos retorna `allowed:false` se `isProd`). Todo o resto é disparo manual.

---

# 7. BLOCO E — PACKAGES

_Cobertura inline (agentes E1/E2 falharam por limite de sessão). Censo de consumo por `git grep` de imports `@screena/<nome>` excluindo o próprio pacote._

## E1. Censo de vida por pacote

| Pacote | Exporta | Arquivos consumidores (fora do pacote) | Veredito |
| --- | --- | --- | --- |
| `@screena/db` | Prisma client server-only + helpers | **148** | VIVO — espinha dorsal |
| `@screena/seo` | 28 arquivos: indexabilidade, JSON-LD, sitemap, redirects, elegibilidade | **54** | VIVO — ver E2 |
| `@screena/config` | env tipado, locales, invariantes (`RATING_SOURCES`, `RATING_SCALES`) | **30** | VIVO |
| `@screena/editorial-contracts` | contratos v1 (draft, publication-request, publication-event, seo-proposal, blocks, manifest) | **23** | VIVO — produtor (CMS) e consumidor (worker) importam (G2) |
| `@screena/schemas` | validadores puros (ratings, entity-writer-output) | **18** | VIVO |
| `@screena/public-contracts` | contratos de apresentação (único lugar autorizado ao host de imagem TMDB) | **11** | VIVO |
| `@screena/cinerie-score` | motor sem fórmula (`blocked_by_decision`) | **2** (script de validação + `recommendations/types.ts`) | VIVO mas dormente por decisão (E3) |
| `@screena/ui` | **apenas** `tokens.js` + `vertical.js` (`packages/ui/src/index.ts:11-12`) | **2** (`apps/web/next.config.ts`, `tests/governance/vertical.test.ts`) | **QUASE MORTO como biblioteca de componentes** — os componentes reais vivem em `apps/web/app/_components/` (26 arquivos). O CLAUDE.md descreve "componentes, badges" que não existem aqui. |
| `@screena/types` | uniões literais (EntityType etc.) | **1** direto (`apps/web/next.config.ts`) | Quase sem consumo direto; vocabulário chegou aos consumidores por outros caminhos |

## E2. `packages/seo` — o que controla e onde é aplicado

Inventário (28 arquivos em `src/`, 13 de teste): `indexability.ts`, `catalog-indexability.ts`, `public-indexability.ts`, `language-index-guard.ts`, `person-eligibility.ts`, `entity-schema.ts`, `json-ld.ts`, `article-publication.ts`, `article-technical-seo.ts`, `news-sitemap.ts`, `sitemap-plan.ts`, `sitemap-xml.ts`, `redirects.ts`, `resolver.ts`, `value-blocks.ts`.

Aplicação nas rotas (todas com import direto de `@screena/seo`): as 13 páginas de entidade/notícia de `apps/web/app/pt/**` (home, filmes, séries, temporada, episódio, pessoas, notícias, explorar, em-breve, onde-assistir), `apps/web/app/_components/entity-index.tsx`, `apps/web/src/lib/entity-index-presenter.ts` e a infraestrutura de sitemap (`apps/web/src/server/seo/sitemap-index.ts`, que usa `person-eligibility`). O gate de publicação de artigo é fonte única em `article-publication.ts` (consumido por news-pages, news-sitemap e canários — a duplicação por superfície foi eliminada no Prompt 10).

- **Kill-switch global**: `apps/web/app/robots.ts` é `force-dynamic` de propósito (o comentário :12-18 explica que a versão estática assava `Allow: /` no build); libera crawl SOMENTE quando `CINERIE_PUBLIC_SITE_URL=https://cinerie.com` E `CINERIE_PUBLIC_INDEXING_ENABLED=true|1` (`robots.ts:21-24`, com fallback aos nomes legados `THE_SCREEN_*`). Caso contrário: `Disallow: /` e sem sitemap anunciado — exatamente o que produção serve hoje.
- **Elegibilidade de pessoa**: `person-eligibility.ts:24,44` exige ≥ 1 crédito (cast ou crew) em obra PUBLICÁVEL; aplicado no sitemap (`sitemap-index.ts`). Módulo puro, com validador PG16 (`validate:person-eligibility`).
- `value-blocks.ts` segue existindo como **sinal informativo** (`hasUniqueValue`), não gate — coerente com a política de indexação total 2026-07.

## E3. `packages/cinerie-score` — confirmação

- Sem fórmula: `PRODUCTION_FORMULA_REGISTRY` vazio de propósito (`README.md:16`); `computeCinerieScore` devolve `blocked_by_decision` (`src/index.ts:5-7`).
- Decisão pendente documentada em [`docs/product/cinerie-score-decision.md`](docs/product/cinerie-score-decision.md) — **"Status: NÃO DECIDIDO"** na linha 3; o doc é o gate humano (escala, fontes, pesos, votos mínimos, arredondamento) e exige `DataUsageDecision` com `derivative_allowed=true` para exibir.
- No produto: `apps/web/src/server/editorial-score.ts:79` só LÊ `CinerieScoreCalculation`; a única escrita no repo é fixture de QA (achado do Bloco A2).

## E4. `packages/ui` — componentes

`packages/ui` NÃO contém componentes React — só tokens de cor e resolução de vertical (2 módulos). Os 26 componentes reais estão em `apps/web/app/_components/` (15 deles `'use client'`): `home-hero-carousel`, `home-ticker`, `home-editorial-highlights`, `discover-rails`, `rail`, `entity-index`, `entity-facts`, `entity-actions`, `filmography`, `ratings-panel`, `watch-availability-panel`, `article-body`, `site-header`, `site-footer`, `ad-slot`/`ad-surfaces`, `card-bookmark`, `continue-watching`, `anticipated-grid`, `month-stats`, `prev-next-nav`, `canon-icons`, `ds`, `entity-external-ids`, `home-like`, `watch-popular`. Órfãos dentro de `packages/ui`: não há (não há componentes lá para orfanar); a dívida é de **documentação** (CLAUDE.md §5 descreve um pacote que não corresponde ao conteúdo).

---

# 8. BLOCO F — APLICAÇÃO WEB (apps/web)

_Cobertura inline. A tabela de rotas vem do manifesto REAL do `next build` executado neste worktree (exit 0) cruzado com a varredura de produção (Bloco L). "Visual" = contagem de `<img>` no HTML SSR servido por produção — evidência mais forte que contagem estática de JSX._

## F1. Rotas de página

Legenda render: `ƒ` = dynamic (SSR por request), `○` = estática. **Nenhuma rota usa ISR/`revalidate`** (manifesto sem anotações de revalidate; home servida com `cache-control: private, no-cache, no-store`). Auth = exige sessão.

| Rota | Render | Visual em produção | Fonte do dado | Auth |
| --- | --- | --- | --- | --- |
| `/pt` | ƒ | 21 `<img>` (hero + rails) | `src/server/home-*.ts` (PG) | não |
| `/pt/filmes` | ƒ | 15 `<img>` | `entity-indexes.ts` (PG) | não |
| `/pt/filmes/[slug]` | ƒ | 13 `<img>` (A Origem) | `movie-page.ts` (PG: movie+translation+content_blocks+news+cast+watch+external ids) | não |
| `/pt/series` | ƒ | 50 `<img>` | `entity-indexes.ts` | não |
| `/pt/series/[slug]` | ƒ | 23 `<img>` (GoT) | `series-page.ts` | não |
| `/pt/series/[slug]/temporadas/[n]` | ƒ | 2 `<img>` | `season-page` (PG) | não |
| `/pt/.../episodios/[n]` | ƒ | 2 `<img>` | `episode-page` (PG) | não |
| `/pt/pessoas` | ƒ | 9 `<img>` | `entity-indexes.ts` (⚠ hidrata ~22,4k pessoas por request — A4) | não |
| `/pt/pessoas/[slug]` | ƒ | 6 `<img>` (DiCaprio) | `person-page.ts` | não |
| `/pt/noticias` | ƒ | 2 `<img>` (só chrome) — **LISTA VAZIA em produção** | `news-pages.ts` (⚠ `findMany` sem `take` — A4) | não |
| `/pt/noticias/[slug]` | ƒ | não testável (sem matéria publicada) | `news-pages.ts` + `article-body.tsx` | não |
| `/pt/explorar` | ƒ | 18 `<img>`, 1 form | `discover-rails` (PG) | não |
| `/pt/busca` | ƒ | form de busca; resultados SSR | `search-page.ts` (unaccent+trgm) | não |
| `/pt/em-breve` | ƒ | 3 `<img>` | `anticipated.ts` | não |
| `/pt/onde-assistir` | ƒ | 2 `<img>` (guia textual) | `watch-*.ts` gateado por licença | não |
| `/pt/entrar`, `/pt/criar-conta`, `/pt/recuperar-senha`, `/pt/redefinir-senha`, `/pt/verificar-email` | ƒ | forms reais (1 form cada em produção) | `/api/auth/**` | não |
| `/pt/conta`, `/pt/conta/privacidade` | ƒ | painéis client | `/api/account/**`, `/api/me/**` | **sim** |
| `/pt/listas`, `/pt/listas/[id]`, `/pt/minha-lista`, `/pt/tracker`, `/pt/historico`, `/pt/importar` | ƒ | painéis client | `/api/me/**` | **sim** |
| `/filmes`, `/series` (raiz) | ○ | redirect 307→`/pt/...` (produção confirmou) | — | não |
| `/dev/ad-preview`, `/dev/movie-page-preview` | ○ | **404 em produção** (gate de dev correto) | — | — |
| `/robots.txt`, `/sitemap.xml`, `/sitemaps/[shard]`, `/news-sitemap.xml` | ƒ | — | `@screena/seo` + PG | não |
| `/_not-found` | ○ | 404 com h1 "404", `noindex` | — | — |

Nenhuma rota pública é "lista textual" no sentido do prompt — TODAS as superfícies de catálogo servem imagem real de `image.tmdb.org` (19 das 21 imagens da home; contagem por rota acima). A exceção é `/pt/noticias`, textual **porque não há dado**, com empty state próprio.

## F2. Rotas de API (34, todas reais — nenhum stub)

Extraídas do manifesto de build; handlers são **delegadores de 3 linhas** para `@screena/user-platform` (padrão declarado em `apps/web/app/api/me/library/route.ts:6-9` — "apps/web nao e coberto pelo vitest, entao qualquer logica escrita aqui nasceria sem teste").

| Grupo | Rotas | Auth | Real? |
| --- | --- | --- | --- |
| Auth | `signup`, `login`, `logout`, `logout-all`, `session`, `email-verification/{request,confirm}`, `password-reset/{request,confirm}`, `password-change` | CSRF + cookie de sessão | ✔ (runtime C7C wired; produção serve o fluxo) |
| Conta | `account/{close,consent,export,privacy,profile}` | sessão + reauth por senha no `close` | ✔ (`close/route.ts:1-5`: pending_deletion + revoga sessões + limpa cookies) |
| Produto pessoal | `me/{library,lists[...],ratings,watch-state,episodes,history,series-progress,imports[...]}` (19 rotas) | sessão | ✔ (C8) |
| Catálogo | `catalog/summary` | não | ✔ |
| SEO | `seo/redirect` | header interno | ✔ — produção respondeu `{"status":"none",...}` |
| Health | `health` | não | ✔ — produção respondeu `{status:"ok",database:"ok",...}` |

## F3. Middleware (`apps/web/middleware.ts`, 88 linhas)

1. **Redirects persistidos** (tabela `redirects`): o middleware roda no Edge e não acessa Postgres, então resolve via subrequest a `/api/seo/redirect` com header `x-screena-internal: redirect-lookup` (`middleware.ts:36-39`); **fail-closed**: qualquer falha ⇒ sem redirect, segue o fluxo (`:57`). 2. **Locale**: `resolveLocale` + redirect 307 da raiz e cabeçalho `x-screena-locale` (`:66,75-77`).

## F4. Componentes

26 componentes em `app/_components/` (15 `'use client'`, 11 server). Server (renderizam imagem/poster): `home-hero-carousel`, `rail`, `discover-rails`, `entity-index`, `filmography`, `article-body`. Client (interação): painéis de conta/listas/importação, `card-bookmark`, `home-like`, `continue-watching`, `tracker`. Acesso a banco APENAS via `apps/web/src/server/**` (padrão confirmado pelos leitores de página; `audit:render` verde reforça zero API externa no render).

## F5. Estados vazios

Tratados com componente/JSX explícito nas listagens verificadas: busca (`busca/page.tsx:53` — "Nenhum resultado para …"), em-breve (`em-breve/page.tsx:65` — `<EmptyState title="Nenhuma estreia futura confirmada no catálogo.">`), explorar (`explorar/page.tsx:284`), biblioteca (`minha-lista/library-panel.tsx:109` — "Nada por aqui ainda." + estados carregando/erro/não-autenticado declarados em `:11`), importação (máquina de estados vazio/arrastando/validando/concluído/erro, `import-panel.tsx:22`). Produção confirma: `/pt/noticias/` vazia renderiza página íntegra, não quebrada.

## F6. Responsividade

**Zero classes responsivas Tailwind** em `apps/web` (`grep -rhoE "\b(sm|md|lg|xl|2xl):"` → vazio) e zero larguras fixas `w-[NNNpx]`. A responsividade vive em `apps/web/app/globals.css` com **68 `@media`**, padrão **desktop-first** (`max-width`): 25× `767px`, 19× `1023px`, 5× `900px`, 4× `720px`, 4× `599px`, 2× `640px`, 2× `1279px`, mais 4× `prefers-reduced-motion`. Não é mobile-first, mas a cobertura de breakpoints existe até 599px; risco residual em 360px NÃO VERIFICADO com viewport real (comando no §23 não é necessário — teste manual de navegador recomendado).

---

# 9. BLOCO G — PIPELINE EDITORIAL COMPLETO

_Cobertura inline no lado do worker; o lado do CMS está detalhado no Bloco B (B3–B5), citado aqui por elo._

**A corrente, elo a elo:**

```
CMS hook afterChange (apps/cms/src/hooks/articles.ts → workflow.ts:260-275)
  → publication-outbox (colecao interna imutavel pela API; apps/cms/src/collections.ts:864)
  → evento publication-event-v1 (packages/editorial-contracts/src/publication-event-v1.ts:30)
  → worker claim via HTTP POST /internal/publication-outbox/claim (services/news-ingestion/bin/project-editorial.ts:109-113)
  → parser do contrato (services/news-ingestion/src/editorial-event-mapper.ts:13 — parsePublicationEventV1)
  → projeção (services/news-ingestion/src/editorial-projection.ts)
  → banco público (articles/article_translations/entity_news_links/editorial_media_assets/editorial_projection_receipts)
  → /pt/noticias (apps/web/src/server/news-pages.ts + app/_components/article-body.tsx)
```

**G1 — Quem escreve na outbox**: só o hook `emitPublicationEvent` (afterChange de `articles`) — a coleção tem `create: false` para TODOS, inclusive admin. Só em 4 transições: chegada a `published` (published/updated, decidido consultando a própria outbox), `published→retracted` e `published→blocked|archived` (`workflow.ts:260-275`); evento inválido derruba a transação da publicação (`articles.ts:456-464`). _(Evidência completa no Bloco B3.)_

**G2 — Contrato compartilhado**: versão `publication-event-v1` (`publication-event-v1.ts:30`). Producer importa `@screena/editorial-contracts` em 8 pontos de `apps/cms/src` (`auto-publication.ts:26`, `collections.ts:21`, `draft-intake.ts:19`, `endpoints/editorial-publications.ts:25`…); consumer no worker via `editorial-event-mapper.ts:13`. **Os dois lados usam o mesmo pacote — provado por import.**

**G3 — Idempotência (3 camadas)**: (1) `eventId` @unique + `idempotencyKey` @unique na outbox (`collections.ts`, campos da outbox); (2) recibo `editorial_projection_receipts.event_id` @unique no banco público — evento com recibo retorna `skipped_duplicate` (`editorial-projection.ts:383-384`); (3) anti-fora-de-ordem por `projectedSequence` — evento atrasado retorna `skipped_stale` (`:398`). Chave de idempotência = `articleId:articleVersionId:eventType` (`apps/cms/src/outbox.ts:25-28`).

**G4 — Retry e falha**: claim com lease (`PROJECTION_LEASE_MS` default 60s, margem de segurança 10s — `project-editorial.ts:225`); item cujo tempo de lease acabou não é processado ("e como convidar outro worker a projetar", `:219`). `attempts` é contado na outbox; status possíveis `pending → processing → processed | failed | dead_letter` (`outbox.ts:31-38`). Falha de MAPEAMENTO não retenta: "o corpo nao vai mudar sozinho. Vai direto para dead-letter" (`project-editorial.ts:128`). Ack/fail validam o `leaseToken` da vez e são idempotentes (Bloco B3: `publication-outbox.ts:149-199` com claim por SQL CAS, porque `payload.update({where})` não é atômico).

**G5 — Fronteira de bancos (PROVADA)**: o worker abre Prisma APENAS no banco público (`createPrismaClient({ datasourceUrl: config.screenDatabaseUrl })`, `project-editorial.ts:307`) e fala com o CMS APENAS por HTTP autenticado (`fetch(config.payloadInternalServiceUrl + '/api' + path)`, `:87`). O teste de governança `tests/governance/editorial-worker-boundary.test.ts` varre o FECHO de imports do worker e: proíbe Payload/adapter Postgres do CMS/Drizzle (`:214-218`), exige `@screena/db/server` + `fetch(` (`:222-226`), com **controle negativo** (código sintético com import proibido é acusado, `:172-181`) e **controle positivo** (import legítimo parecido não é acusado, `:186-193`), e prova que a varredura andou (`:196-201`). Do outro lado, o CMS aborta o boot se `PAYLOAD_DATABASE_URL` tiver cara do banco público (Bloco B1: `env.ts:98-168`).

**G6 — Mídia editorial**: o site nunca consome URL do CMS. Bytes saem só por `GET /internal/publication-media/:mediaId` com escopo `publication_projection` (`apps/cms/src/endpoints/publication-media.ts:89-97`); o worker valida/replica para o storage público (local ou S3 — `src/media/{local-storage,s3-storage,storage-port}.ts`), a referência pública é **caminho por hash**, nunca URL http(s) (`storage-port.ts:41`), deduplicada por `contentHash` em `editorial_media_assets` (schema:2699-2708), com flags de uso fail-closed. Bloco de imagem sem `mediaRef` gera aviso, não crash (`project-editorial.ts:141`).

**G7 — Vínculos notícia↔entidade**: no CMS, blocos `entityCard`/`relatedContent` + campos de automação; na projeção, `entity_news_links` com FK composta polimórfica para `entities` (schema:1695, FK via SQL bruto); na ponta pública, páginas de entidade carregam notícias relacionadas via `getRelatedNewsForEntity` (`apps/web/src/server/movie-page.ts:136`) e a página de notícia lista entidades vinculadas. Canário dedicado ponta a ponta no CI: `canary:editorial-entity-links` (`ci.yml:172`; commit `953696a` é exatamente esse canário, PR #99).

**G8 — Despublicação/edição pós-publicação**: existem nos dois lados. Eventos `article.unpublished` e `article.retracted` são aceitos (`editorial-projection.ts:34-35`) e aplicados como remoção: retração ⇒ `reviewStatus: 'blocked'` + `retractionReason` em `correctionNote`; despublicação ⇒ `'archived'` (`:420-460`). Republicação/edição chega como `published/updated` com `contentVersion` novo. **Invalidação de cache: não é necessária** — todas as rotas públicas são `force-dynamic`/SSR por request (Bloco F1; produção serve `cache-control: no-store`), então a mudança aparece no request seguinte. Não há ISR para invalidar (isso é um custo de latência, não um bug de frescor).

**G9 — Canários e cobertura no CI**: `test:publication-projection:integration` (`ci.yml:108`), `test:manual-editorial:integration` (`:136`), `test:manual-editorial:e2e` — navegador real até a outbox (`:148`), `canary:manual-editorial` — Next real + PG efêmero cobrindo o gate de indexação nos DOIS estados da flag (`:159`; `canary-manual-editorial-real-postgres.ts:913-916`), `canary:editorial-entity-links` (`:172`), deployment-readiness do CMS e do worker (`:183,186`). **O que NENHUM canário cobre**: o pedaço entre o repositório e o mundo — outbox de PRODUÇÃO drenando (worker vivo), storage público real, e o MNScr externo publicando de verdade. Exatamente o que o Bloco M4 e o formulário N medem.

---

# 10. BLOCO H — ENTITY WRITER E PROMPTS

_Cobertura inline._

## H1. Os 12 block_types — estado ponta a ponta

O schema valida os 12 (`ContentBlockType` no enum do Prisma + `packages/schemas/src/entity-writer-output.ts`). O pipeline atual gera SOMENTE o slice do prompt combinado. O render público (movie/series/person-page) lê `content_blocks` **sem filtrar por block_type** — qualquer tipo com `review_status` publicável renderiza (`apps/web/src/server/movie-page.ts:125-134`: filtro é `reviewStatus IN RENDERABLE_REVIEW_STATUSES`, defesa reaplicada em `selectRenderableBlocks`).

| block_type | schema | prompt | pipeline gera | persiste | renderiza | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| `editorial_intro` | ✔ | `entity_intro_pt.md` | ✔ (prompt combinado — `src/prompt/`: "gera editorial_intro + cast_intro") | ✔ (`content-block-store.ts`) | ✔ | **ATIVO** |
| `cast_intro` | ✔ | idem (combinado) | ✔ | ✔ | ✔ | **ATIVO** |
| `faq` | ✔ | `faq_entity_pt.md` | ✘ (sem chamador no pipeline) | — | ✔ (se existisse) | CONTRATO |
| `ratings_explanation` | ✔ | `ratings_explanation_pt.md` | ✘ | — | ✔ | CONTRATO (bloqueado por licença de ratings) |
| `where_to_watch_text` | ✔ | `where_to_watch_pt.md` + `where_to_watch.md` | ✘ | — | ✔ | CONTRATO (bloqueado por licença de streaming) |
| `review_summary` | ✔ | `review_summary.md` | ✘ | — | ✔ | ROADMAP |
| `news_context` | ✔ | `news_linking.md` | ✘ | — | ✔ | ROADMAP |
| `summary_without_spoilers` | ✔ | ✘ (sem prompt) | ✘ | — | ✔ | ROADMAP |
| `similar_titles_intro` | ✔ | ✘ | ✘ | — | ✔ | ROADMAP |
| `franchise_context` | ✔ | ✘ | ✘ | — | ✔ | ROADMAP |
| `season_guide` | ✔ | ✘ | ✘ | — | ✔ | ROADMAP |
| `episode_context` | ✔ | ✘ | ✘ | — | ✔ | ROADMAP |

## H2. Os 8 arquivos de `prompts/`

`entity_intro_pt.md` (**ligado** — o loader extrai `prompt_version` do frontmatter), `entity_intro.md` e `where_to_watch.md` (variantes/legado), `faq_entity_pt.md`, `ratings_explanation_pt.md`, `where_to_watch_pt.md`, `review_summary.md`, `news_linking.md` (contrato/roadmap — nenhum referenciado pelo pipeline).

## H3. Validação e o que acontece quando bloqueia

- Gate de forma + anti-alucinação: `validateEntityWriterOutput` + `validateAgainstPayload` (`packages/schemas/src/entity-writer-output.ts`) — nome próprio fora do payload vira warning `fato fora do payload: <nome>`.
- Decisão de status: `services/entity-writer/src/pipeline/decide-status.ts` — bloco com falha de validação **nasce `blocked`** e o anterior é arquivado no padrão `archive + insert` (ADR 0016: em blocos, `blocked` = falha de geração, `archived` = versão superada — NÃO é retratação como em artigo).
- Efeito na página: com a política 2026-07, **a página indexa mesmo sem bloco**; bloco não-publicável simplesmente não renderiza (`RENDERABLE_REVIEW_STATUSES` = `human_reviewed`/`published`). Não há texto genérico de fallback — a seção fica ausente. **O gate anti-thin de indexação NÃO existe mais no código** (`evaluateIndexability` usa `countValueBlocks` só como sinal; confirmado no Bloco E2/A4).

## H4. Adapter Gemini

- Adapter separado do render em `services/entity-writer/src/gemini/`; **fake adapter existe** (`src/gemini/fake.ts`) e alimenta `bin/run-offline.ts` — o CI nunca chama Gemini real.
- Chamada real só via `bin/run.ts`/`bin/smoke-gemini.ts` com `GEMINI_API_KEY` + `GEMINI_MODEL` (presentes no `.env` local; validade NÃO VERIFICADA — regra do diagnóstico proíbe chamar).
- Custo por geração: NÃO DESCOBRÍVEL do código (não há tabela de preço nem contagem de tokens com custo; `entity_writer_logs` grava tokens por execução — schema A1 — então o custo é derivável DEPOIS de rodar, não antes).

---

# 11. BLOCO I — PLATAFORMA DE USUÁRIO

_Cobertura inline; rotas do manifesto real de build + verificação pontual de código + produção._

## I1. Rotas

**Páginas**: `/pt/entrar` (200, 1 form), `/pt/criar-conta` (200, form com `nome`,`email`,`senha` + 3 checkboxes), `/pt/recuperar-senha` (200, 1 form), `/pt/redefinir-senha`, `/pt/verificar-email`, `/pt/conta`, `/pt/conta/privacidade` — todas confirmadas vivas em produção. **APIs**: 15 rotas auth/conta + 19 `/api/me/**` (tabela no Bloco F2), todas delegadoras reais para `@screena/user-platform`.

## I2. Fluxo de cadastro (formulário → usuário ativo)

1. Form client (`signup-form.tsx`): aceite de termos **obrigatório e desmarcado por default** ("a LGPD proibe pre-marcado", `:8-9`); botão desabilitado sem aceite (`:150` — `disabled={... || !aceitouTermos}`); marketing e analytics **opcionais** e separados (`:130-146`).
2. `POST /api/auth/signup` → runtime user-platform: validação, criação de user + `PasswordCredential` (scrypt, formato PHC — schema A1 :1988), consentimento versionado persistido.
3. E-mail de verificação via **Brevo REST sem SDK** (`BREVO_API_KEY`/`BREVO_SENDER_*` no `.env`; expiração controlada por `EMAIL_VERIFICATION_EXPIRATION_MINUTES`); token com hash e consumo atômico (`VerificationToken`, schema :2040).
4. Sessão: `UserSession` com `tokenHash` + `csrfTokenHash` e rotação 1-1 (schema :2017); cookies limpos/emitidos pelo runtime.
5. Expiração de sessão e de tokens por env (`PASSWORD_RESET_EXPIRATION_MINUTES` etc.).

**Defeito bloqueante no passo 1**: os links do aceite apontam para `/pt/termos` e `/pt/privacidade` (`signup-form.tsx:125-126`) — **as rotas não existem** (`ls apps/web/app/pt/termos` → No such file) e **404 em produção** (testado: ambos 404). O usuário é obrigado a "ler e aceitar" documentos inalcançáveis.

## I3. Recuperação, verificação, logout, exclusão

- Recuperação: `password-reset/request` + `confirm` (rotas reais); página `/pt/recuperar-senha` viva.
- Verificação de e-mail: `email-verification/request|confirm` + página `/pt/verificar-email`.
- Logout e logout-all: rotas dedicadas (revogação de sessão; `logout-all` revoga todas).
- **I4. Exclusão de conta EXISTE** (requisito LGPD atendido no software): `POST /api/account/close` exige **reautenticação por senha + CSRF**, leva a conta a `pending_deletion`, revoga todas as sessões e limpa cookies (`close/route.ts:1-5`); UI em `/pt/conta/privacidade` com confirmação de senha inline (`privacy-panel.tsx:116-127`) e **exportação LGPD** ao lado (`:99-103`; "nunca inclui senhas, tokens", `:191`). Ressalvas conhecidas do código: (a) `cancelClosure` existe mas é inalcançável porque `pending_deletion` não autentica (achado C7D, memória do projeto — reconferir); (b) a exportação lê `UserReview`/`UserStatsSnapshot`, tabelas que **nenhum código popula** (Bloco A2) — o export desses domínios sai vazio.

## I5. Listas, watchlist, tracker, histórico, importação

| Produto | Persiste em | Tela |
| --- | --- | --- |
| Watchlist | `user_watch_states` (`planned`) | `/pt/minha-lista` (biblioteca por status) |
| Favoritos | `user_lists` de sistema + `user_list_items` | `/pt/listas` |
| Listas custom | `user_lists`/`user_list_items` (posição, polimórfico) | `/pt/listas/[id]` |
| Tracker de séries | `user_episode_progress` (FK real p/ episodes) | `/pt/tracker` |
| Histórico | `user_viewing_events` (append-only, idempotência por `(userId, idempotencyKey, eventType)`) | `/pt/historico` |
| Importação | `user_imports` + preview fail-closed (Cinerie/Letterboxd CSV) | `/pt/importar` (máquina de estados completa) |
| Notas pessoais | `user_ratings` (0.5–5.0, SEM relação com external_ratings — inv. 1/2) | páginas de entidade (`entity-actions`) |

## I6. Segurança

- **Hash de senha**: scrypt (PHC) — `services/user-platform` (`credentials`); decoy para timing.
- **Oráculo de tempo no login: MITIGADO** — sem credencial, verifica contra ISCA (`decoyPasswordHash`, `auth-runtime/account.ts:323-330`; gerada em `composition.ts:282`).
- **CSRF**: `csrfTokenHash` na sessão (schema :2017) + exigido nos endpoints mutantes (`close` exige "senha e CSRF", `close/route.ts:2-3`).
- **Rate limit/throttle**: `AuthThrottle` por email/ip_hash durável (schema :2057) + `CINERIE_IP_HASH_SALT` no `.env`.
- **Cookies/segredo de sessão**: sessão opaca com hash no banco (não JWT); flags de cookie definidas no runtime (C7C/C7D).
- **Auditoria**: `AuthAuditLog` append-only com trigger SQL (schema :2075).

## I7. LGPD — quadro

| Item | Estado | Evidência |
| --- | --- | --- |
| Consentimento explícito, não pré-marcado, granular | ✔ | `signup-form.tsx:8-9,117-146` |
| Consentimento versionado persistido | ✔ | `/api/account/consent` + runtime C7D |
| Exportação de dados | ✔ (com lacuna de domínios vazios) | `privacy-panel.tsx:99` + A2 |
| Exclusão/anonimização | ✔ | `close/route.ts` + `pending_deletion` |
| **Páginas de Termos e Privacidade** | ✘ **404 no código e em produção** | `ls` + fetch 404 — **bloqueador** |
| Banner de consentimento de cookie | ✘ não existe (`grep -rin "cookie.*consent"` → vazio) | Mitigante: não foi encontrado nenhum tracker de terceiro no app; cookies são estritamente de sessão. Ainda assim, a política de privacidade precisa declarar isso — e ela não existe. |
| Dado pessoal gravado | `users`, `user_profiles`, credenciais, sessões, consentimentos, auditoria — tudo no banco público `screena` | schema A1 grupo 5 |

---

# 12. BLOCO J — CI, DEPLOY E CONFIGURAÇÃO

_Cobertura inline._

## J1. CI — 1 workflow (`ci.yml`), 3 jobs, 61 passos (contado: `grep -c "- name:"` = 61)

| Job | Papel | Passos notáveis |
| --- | --- | --- |
| `build` | gate principal | install → db:generate → typecheck (3 variantes) → lint → audits rápidos (invariants/render/api:coverage, "rodam a cada push, antes dos gates caros", `ci.yml:181`) → vitest completo → integração editorial com PG16 efêmero (`:108,136,148,159`) → canários Next real (`:159,172`) → deployment-readiness CMS/worker (`:183,186`) → backend D com PG16 (`:256`) → build |
| `backup-restore` | prova de fidelidade | PG16 de serviço, `RESTORE_TEST_ADMIN_URL` isolada, migrations+seed na origem, `verify-backup-restore.sh` (`:300-364`) |
| `docker-image` | prova da imagem | build com `--build-arg CINERIE_BUILD_SHA/${GITHUB_SHA}` + VERSION + TIME, container não-root, aguarda HEALTHCHECK ficar `healthy`, valida HTTP + versão + migrations + gravabilidade (`:365-420+`) |

## J2. Branch protection — **NÃO EXISTE (verificado por implicação)**

`gh api repos/maquinanerd/screena/branches/main/protection` → **HTTP 403: "Upgrade to GitHub Pro or make this repository public to enable this feature."** Em repo privado no plano free o recurso é indisponível ⇒ **não há required checks na `main`**: o CI é informativo, não autoridade. Dá para mergear com check vermelho e dá para push direto na `main`. Isso é coerente com o histórico do phantom commit (memória do projeto). **Decisão humana**: GitHub Pro, ou repo público, ou disciplina operacional documentada.

## J3. As 3 imagens Docker (evidência detalhada no Bloco A3)

| Imagem | Base | Migration no boot | Falha de migration | Healthcheck |
| --- | --- | --- | --- | --- |
| `Dockerfile` (web) | node por DIGEST pinado, não-root | `prisma migrate deploy` antes do `next start` (`Dockerfile:105`) | aborta o boot (`exit 1`) | `/api/health/` (CI espera `healthy`) |
| `Dockerfile.cms` (Payload) | idem padrão | `payload migrate` antes do servidor (`Dockerfile.cms:90`) | aborta o boot | `/healthz` + `/readyz` (rotas Next sem auth, deliberado) |
| `Dockerfile.publication-worker` | idem | **não migra** (`Dockerfile.publication-worker:68`) — depende dos outros dois | — | health server próprio (`worker-health-server.ts`, porta `PUBLICATION_WORKER_HEALTH_PORT`) |

## J4. Deploy — como é disparado

- **O CI NÃO publica imagem**: nenhum `docker push`/registry/login no workflow (grep literal). O job `docker-image` constrói e descarta.
- Deploy real é **manual via EasyPanel** construindo do repositório (runbooks `PRODUCTION_DEPLOY.md` + `EASYPANEL_EDITORIAL.md`); "A imagem nao assa nenhuma env publica. Configure no EasyPanel" (`PRODUCTION_DEPLOY.md:68`).
- **Rastreabilidade: FALHA HOJE.** O mecanismo existe (`/api/health` devolve `version.commit` dos build args `CINERIE_BUILD_SHA/...`; o CI prova que funciona), mas produção respondeu `{"commit":"unknown","version":"unknown","builtAt":"unknown"}` — **o build de produção não recebeu os build args**. Não é possível saber qual commit está no ar. Correção: definir os build args no build do EasyPanel (runbook `PRODUCTION_DEPLOY.md:163-164` já manda fazer isso).

## J5. Variáveis de ambiente (censo por `process.env` + env tipado + worker config; NENHUM `.env.example` existe no repo — achado)

| Variável | Serviço | Obrigatória | Controla | No `.env` local? |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | web, workers, db | sim | banco público `screena` | ✔ (aponta p/ PRODUÇÃO: `rss_prime_screen-db:5432/screena`) |
| **`CINERIE_PUBLIC_INDEXING_ENABLED`** | web | sim p/ indexar | **noindex/robots global** (robots.ts:21-24; meta robots; lido por REQUEST) | ✔ (`false`) |
| `CINERIE_PUBLIC_SITE_URL` | web | sim | URL oficial; precisa ser exatamente `https://cinerie.com` p/ liberar crawl | ✔ |
| `THE_SCREEN_PUBLIC_*` / `SCREENA_PUBLIC_SITE_URL` | web | não | fallbacks legados aceitos | ✔ |
| `PAYLOAD_DATABASE_URL` | cms | sim | banco do CMS; **`DATABASE_URL` nunca é fallback**; URL "com cara" de banco público aborta o boot (`apps/cms/src/env.ts:98-168`) | ✘ (esperada só no EasyPanel) |
| `PAYLOAD_SECRET`, `PAYLOAD_PUBLIC_SERVER_URL` | cms | sim | segredo/URL do Payload | ✘ |
| `PAYLOAD_UPLOAD_STORAGE_DRIVER` (`local`\|`s3`) + `PAYLOAD_UPLOAD_LOCAL_ROOT` + `PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED` | cms | sim em prod | storage de upload; local exige confirmação explícita de persistência (`upload-storage-config.ts:105,154-163`) | ✘ |
| `EDITORIAL_AUTO_PUBLISH_ENABLED` + 5 limites (`DAILY/PER_SECTION/PER_CONTENT_TYPE/PER_AUTHOR/PER_ARTICLE_UPDATE_LIMIT`) + `TIME_ZONE` | cms | não (default off) | autopublicação MNScr + tetos diários | ✘ |
| `PROJECTION_BATCH_SIZE`/`LEASE_MS`/`POLL_INTERVAL_MS` + `SCREEN_DATABASE_URL` + URL interna do Payload + credencial da conta técnica | worker | sim | loop de projeção (defaults 10/60s/15s) | ✘ |
| `EDITORIAL_MEDIA_CMS_STATIC_DIR`, storage público (local/S3) | worker | sim p/ mídia | projeção de mídia | ✘ |
| `TMDB_READ_ACCESS_TOKEN` (pref.) / `TMDB_API_KEY` / legado `SCREENA_TMDB_API_KEY` | ingestion | sim p/ sync | credencial TMDB | ✔ |
| `RAPIDAPI_FILM_SHOW_RATINGS_{KEY,HOST,BASE_URL}` | ratings | sim p/ sync | RapidAPI ratings | ✔ |
| `RAPIDAPI_STREAMING_AVAILABILITY_{KEY,HOST,BASE_URL}` | streaming | sim p/ sync | RapidAPI streaming | ✔ |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | entity-writer | sim p/ gerar | Gemini offline | ✔ |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL/NAME`, `BREVO_REPLY_TO_EMAIL` | user-platform | sim p/ e-mail | e-mail transacional | ✔ |
| `CINERIE_IP_HASH_SALT`, `EMAIL_VERIFICATION_EXPIRATION_MINUTES`, `PASSWORD_RESET_EXPIRATION_MINUTES` | user-platform | sim | throttle/tokens | ✔ |
| `ADMIN_PROTECTION_ENABLED`, `ADMIN_BASIC_AUTH_USER/PASSWORD`, `ADMIN_EDITORIAL_ACTIONS_ENABLED` | admin | sim p/ admin | proteção e ações editoriais do apps/admin | ✘ |
| `CINERIE_BUILD_SHA/VERSION/TIME` | web (build args) | não | rastreabilidade `/api/health` | — (produção NÃO os define — J4) |
| `NODE_ENV`, `SCREENA_REDIS_URL`, `NEXT_PUBLIC_AD_SLOTS`, `PUBLIC_APP_URL`, `NIXPACKS_NODE_VERSION`, `PNPM_CONFIG_PROD` | diversos | — | — | ✔ (Redis presente no `.env` mas nenhum uso encontrado no código — candidato a sobra) |

## J6. Backup

- **Código real**: `scripts/backup/{backup.sh, backup-with-alert.sh, restore-test.sh, verify-backup-restore.sh, lib}` — `pg_dump -Fc` + SHA-256 + off-site opcional via rclone; restore-test em base efêmera com `DROP DATABASE ... WITH (FORCE)` (falha barulhenta em PG<13); regra operacional: "sem backup validado, sem sync/promote em producao" (`scripts/backup/README.md`).
- **Prova**: o job `backup-restore` do CI executa dump+restore com fidelidade de dados a cada push.
- **Agendamento**: exemplo de cron documentado (`/etc/cron.d/cinerie-postgres-backup`, `BACKUP_RESTORE.md:52`) — **instalação real no host NÃO VERIFICÁVEL do repo** (item do formulário N).

## J7. Observabilidade

- Runbook `docs/runbooks/OBSERVABILITY.md` + build args de versão + `/api/health` (status+database+duração+versão) + `/healthz`/`/readyz` no CMS + health server no worker + `backup-with-alert.sh` (webhook de alerta).
- **Não existem**: métricas exportadas (Prometheus etc.), agregação de logs, alertas gerenciados no repo. Logs são stdout estruturado simples (`[projecao] ...`). O que existe em produção (alertas EasyPanel?) é item do formulário N.

---

# 13. BLOCO K — GATES

## K1. Node — AVISO

Node local: **v24.14.0**. Engines do repo: `>=22 <23`. Não há Node 22 na máquina (sem nvm/volta/fnm; só `C:\Program Files\nodejs`). O pnpm emitiu `WARN Unsupported engine` em todos os passos. **TODOS os resultados abaixo são EXPERIMENTAIS, não oficiais** — e a memória do projeto registra que Node 24 já produziu verde falso matando suíte de integração na coleção. O CI (Node 22, Ubuntu) segue sendo a referência oficial — e estava verde no commit `953696a` (merge da PR #99).

## K2. Exit codes (executados neste worktree limpo em `953696a`, sequência real com horários)

| Gate | Exit | Duração aprox. |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | **0** | ~6 min |
| `pnpm --filter @screena/db db:generate` | **0** | 45 s |
| `pnpm typecheck` | **0** | 24 s |
| `pnpm typecheck:catalog-runtime` | **0** | 7 s |
| `pnpm typecheck:apps` (web+admin+cms) | **0** | 30 s |
| `pnpm lint` | **0** | 18 s |
| `pnpm audit:invariants` | **0** | 1 s |
| `pnpm audit:render` | **0** | 2 s |
| `pnpm api:coverage` | **0** | <1 s (TMDB 6+32, ratings 2, streaming 5 endpoints conferidos) |
| `pnpm test` | **0** | 48 s |
| `pnpm build` (`@screena/web`) | **0** | 58 s (compilou em 13,2 s; 7 páginas estáticas geradas; manifesto completo no Bloco F) |

## K3. Contagem real de testes

`pnpm test` (vitest raiz): **341 arquivos, 4.404 testes, 4.404 passed, 0 skipped/todo** — bate com a auditoria de 31/07. Ressalva de coleta: o vitest raiz NÃO coleta as suítes do CMS (`pnpm test:cms`, `test:cms:integration`, `test:e2e` rodam por filtro próprio no CI — `ci.yml:136,148,183`) nem os validadores PG16 (`validate:*`) nem os canários — no CI eles são passos separados do job `build`. Ou seja: os 4.404 são o piso, não o total do CI. Arquivos de teste que NENHUMA config coleta: não encontrados (as suítes fora do vitest raiz têm passo de CI próprio).

# 14. BLOCO L — RUNTIME: PRODUÇÃO

_Método: browser real contra `https://cinerie.com` (o `curl` da sessão foi negado por política); análise do HTML SSR — o que o crawler vê. Horário: noite de 2026-07-31 (BRT)._

## L1. robots.txt, sitemap, meta robots

- **robots.txt**: bloco Cloudflare gerenciado (Content-Signals; `ai-train=no`; `Disallow: /` para GPTBot, ClaudeBot, CCBot, Google-Extended, Amazonbot, Applebot-Extended, Bytespider, meta-externalagent, CloudflareBrowserRenderingCrawler) **+ stanza final da aplicação: `User-Agent: * / Disallow: /`** — site inteiro fechado. **Sem linha `Sitemap:`** (coerente com `robots.ts`: só anuncia sitemap quando indexação oficial ligada).
- **Meta robots**: `noindex, nofollow` em TODAS as rotas de página testadas (18); 404 serve `noindex`.
- **Sitemap index** (`/sitemap.xml`): 6 shards pt-BR, todos 200, `lastmod 2026-07-10T01:29Z` (3 semanas antes da auditoria):

| Shard | URLs |
| --- | --- |
| movies-1 | **129** |
| series-1 | **110** |
| people-1 | **22.410** |
| seasons-1 | 53 |
| episodes-1 | 559 |
| static-1 | 5 |
| **Total** | **23.266** |

- **Contradição**: sitemap com 23.266 URLs enquanto robots bloqueia tudo e toda página é noindex. Sob a regra do próprio projeto ("sitemap e meta tag nunca podem discordar", `.claude/rules/seo.md` §5) o estado atual é inconsistente — inofensivo enquanto o robots bloquear o fetch do sitemap, mas deve se resolver sozinho ao ligar a flag (robots passa a anunciar; meta vira index). `news-sitemap.xml`: `<urlset>` **vazio**.

## L2. Rota por rota (produção, HTML SSR)

| Rota | Status | KB | h1 | `<img>` | form | JSON-LD | canonical | robots |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` → `/pt/` | 200 (redir.) | 54,4 | Cinerie — filmes, séries e pessoas | 21 | 0 | Organization+WebSite | `/pt/` | noindex,nofollow |
| `/pt/filmes/` | 200 | 47,5 | Filmes | 15 | 0 | CollectionPage+BreadcrumbList | auto | noindex,nofollow |
| `/pt/series/` | 200 | 92,8 | Séries | 50 | 0 | CollectionPage+BreadcrumbList | auto | noindex,nofollow |
| `/pt/pessoas/` | 200 | 44,9 | Pessoas | 9 | 0 | CollectionPage+BreadcrumbList | auto | noindex,nofollow |
| `/pt/noticias/` | 200 | 15,5 | Notícias | 2 | 0 | CollectionPage+BreadcrumbList | auto | noindex,nofollow |
| `/pt/explorar/` | 200 | 33,0 | Explorar | 18 | 1 | CollectionPage+BreadcrumbList | auto | noindex,nofollow |
| `/pt/filmes/a-origem/` | 200 | 34,5 | A Origem | 13 | 0 | **Movie**+BreadcrumbList | auto | noindex,nofollow |
| `/pt/series/game-of-thrones/` | 200 | 60,9 | Game of Thrones | 23 | 0 | **TVSeries**+BreadcrumbList | auto | noindex,nofollow |
| `/pt/series/.../temporadas/1/` | 200 | 29,4 | GoT — Temporada 1 | 2 | 0 | **TVSeason**+BreadcrumbList | auto | noindex,nofollow |
| `/pt/series/.../episodios/1/` | 200 | 22,7 | O Inverno Está Chegando | 2 | 0 | **TVEpisode**+BreadcrumbList | auto | noindex,nofollow |
| `/pt/pessoas/leonardo-dicaprio/` | 200 | 22,7 | Leonardo DiCaprio | 6 | 0 | **Person**+BreadcrumbList | auto | noindex,nofollow |
| `/pt/busca/` (e `?q=batman`) | 200 | 14,4 | Busca | 2 | 1 | — | — | noindex,nofollow |
| `/pt/onde-assistir/` | 200 | 16,4 | O seu guia de streaming… | 2 | 0 | BreadcrumbList | auto | noindex,nofollow |
| `/pt/em-breve/` | 200 | 18,5 | Mais Aguardados | 3 | 0 | — | — | noindex,nofollow |
| `/pt/entrar/` | 200 | 14,4 | Entrar na Cinerie | 3 | **1** | — | — | noindex,nofollow |
| `/pt/criar-conta/` | 200 | — | Criar conta na Cinerie | — | **1** (nome, email, senha + 3 consentimentos) | — | — | noindex,nofollow |
| `/pt/conta/`, `/pt/conta/privacidade/`, `/pt/listas/`, `/pt/minha-lista/`, `/pt/tracker/`, `/pt/historico/`, `/pt/importar/`, `/pt/recuperar-senha/` | 200 | 12–22 | corretos | 2–3 | conforme | — | — | noindex,nofollow |
| `/pt/termos/`, `/pt/privacidade/` | **404** | — | — | — | — | — | — | — |
| `/entrar`, `/criar-conta`, `/conta` (sem `/pt`) | **404** | — | 404 | — | — | — | — | noindex |
| `/pt/rota-inexistente/` | **404** | 12 | 404 | 2 | 0 | — | — | noindex |
| `/dev/`, `/dev/ad-preview/`, `/dev/movie-page-preview/` | **404** | — | — | — | — | — | — | noindex |
| `/api/health/` | 200 | 0,2 | — | — | — | — | — | — |

## L3. A pergunta central — produção serve o frontend da PR #88?

**SIM.** A main tem **57** ocorrências de `<img` em apps/web (contagem real neste worktree; zero `next/image` — decisão deliberada) e produção serve páginas com 6–50 `<img>` por rota, 19/21 imagens da home vindo de `image.tmdb.org` (hero "A Odisseia" com direção e elenco reais). **A hipótese de deploy defasado/casca em branco está REFUTADA.** O que não dá para afirmar é paridade exata de commit — por causa do L4.

## L4. Identificação da build — **FALHA DE RASTREABILIDADE**

`/api/health/` responde `"version":{"commit":"unknown","version":"unknown","builtAt":"unknown"}`. Headers: só `server: cloudflare`, `x-powered-by: Next.js` — nenhum header de build; sem `buildId` no HTML. O mecanismo existe e é provado no CI (`docker-image` valida que a versão casa com os build args); produção simplesmente não define `CINERIE_BUILD_SHA/VERSION/TIME` no build do EasyPanel. **Não é possível saber qual commit está em produção.**

## L5. Um humano consegue criar conta hoje pelo navegador?

Aparentemente sim — `/pt/criar-conta/` serve formulário completo e `POST /api/auth/signup` está no ar com banco ok — mas o aceite obrigatório referencia Termos/Privacidade que dão 404, e o e-mail de verificação depende do Brevo em produção (não testado: esta auditoria não cria contas).

---

# 15. BLOCO M — DADOS REAIS (pacote de queries — o banco não é alcançável desta máquina)

**Por que não rodou**: `DATABASE_URL` local aponta para `rss_prime_screen-db:5432/screena` (usuário/senha mascarados) — hostname interno do EasyPanel; `dns.lookup` → `ENOTFOUND` desta máquina. O banco do CMS (`PAYLOAD_DATABASE_URL`) nem consta no `.env` local. **Nenhuma conexão foi tentada além do DNS.** Abaixo, o caminho pronto (a) e as queries (b) — tudo SOMENTE SELECT.

## (a) Caminho preferido — auditoria read-only de catálogo

No console do EasyPanel, num container/serviço com o monorepo e acesso ao `screen-db` (ou num clone com `DATABASE_URL` exportada via túnel SSH):

```bash
NODE_ENV=production pnpm catalog audit-database --human --confirm-production-read
```

(Read-only por construção: só count/findMany/groupBy/aggregate; sem a flag em produção sai com exit 3 sem tocar o banco — `docs/runbooks/catalog-production-audit.md`. Cobre M1 e parte de M2/M6: contagens por entidade, cobertura de mídia/trailer DISTINTA, fila por status, dead-letters, checkpoints, docs de busca por locale.)

## (b) Queries diretas — psql no serviço `screen-db` (banco público `screena`)

```sql
-- M1 CATÁLOGO: totais + imagem + sinopse + slug canônico
SELECT 'movies' k, count(*) total,
  count(*) FILTER (WHERE poster_path IS NOT NULL) com_poster,
  count(*) FILTER (WHERE overview IS NOT NULL AND overview <> '') com_sinopse
FROM movies
UNION ALL SELECT 'tv_shows', count(*),
  count(*) FILTER (WHERE poster_path IS NOT NULL),
  count(*) FILTER (WHERE overview IS NOT NULL AND overview <> '') FROM tv_shows
UNION ALL SELECT 'seasons', count(*), count(*) FILTER (WHERE poster_path IS NOT NULL), 0 FROM seasons
UNION ALL SELECT 'episodes', count(*), count(*) FILTER (WHERE still_path IS NOT NULL), 0 FROM episodes
UNION ALL SELECT 'people', count(*), count(*) FILTER (WHERE profile_path IS NOT NULL), 0 FROM people;

SELECT entity_type, count(*) slugs_canonicos
FROM slugs WHERE is_canonical = true AND language_code IN ('pt-BR','pt')
GROUP BY entity_type ORDER BY 2 DESC;

-- M2 PROPORÇÃO + pessoas sem nenhum crédito (index bloat)
SELECT (SELECT count(*) FROM people) pessoas_total,
       (SELECT count(*) FROM movies) filmes_total;
SELECT count(*) AS pessoas_sem_credito
FROM people p
WHERE NOT EXISTS (SELECT 1 FROM cast_members c WHERE c.person_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM crew_members w WHERE w.person_id = p.id);

-- M3 EDITORIAL (banco público — o que foi PROJETADO)
SELECT count(*) FROM articles;
SELECT review_status, count(*) FROM article_translations GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) FILTER (WHERE hero_media_asset_id IS NOT NULL) com_imagem FROM articles;
SELECT count(DISTINCT article_id) artigos_com_vinculo FROM entity_news_links;
SELECT outcome, count(*) FROM editorial_projection_receipts GROUP BY 1;

-- M5 USUÁRIOS (só contagens; zero dado pessoal)
SELECT count(*) total,
  count(*) FILTER (WHERE email_verified_at IS NOT NULL) verificados,
  count(*) FILTER (WHERE status = 'deleted') excluidos
FROM users;
SELECT count(*) listas FROM user_lists;
SELECT count(*) itens_watchlist FROM user_watch_states WHERE status = 'planned';

-- M6 ENTITY WRITER
SELECT block_type, review_status, count(*)
FROM content_blocks GROUP BY 1,2 ORDER BY 1,2;
SELECT count(DISTINCT (entity_type, entity_id)) entidades_com_bloco FROM content_blocks;
```

> Nota: nomes de coluna acima seguem os `@@map` do schema Prisma (snake_case). Se alguma coluna divergir (ex.: `email_verified_at`), rode `\d users` antes e ajuste — a intenção de cada contagem está no alias.

## (c) M4 — OUTBOX (banco do CMS, `PAYLOAD_DATABASE_URL` — serviço/database SEPARADO)

```sql
-- Ache o nome real da tabela primeiro (Payload gera snake_case do slug):
\dt *outbox*

SELECT status, count(*) FROM publication_outbox GROUP BY status;
-- presos: processing com lease vencida
SELECT count(*) AS presos FROM publication_outbox
WHERE status = 'processing' AND lease_expires_at < now();
-- evento mais antigo não processado (o worker está vivo?)
SELECT min(created_at) AS mais_antigo_pendente
FROM publication_outbox WHERE status IN ('pending','failed');
SELECT status, max(attempts) FROM publication_outbox GROUP BY status;
-- quota do dia
SELECT * FROM autopublish_quota_counters ORDER BY id DESC LIMIT 10;
```

**Leitura do resultado**: `pending` antigo (> algumas horas) com worker "up" = worker morto ou sem credencial; `dead_letter` > 0 = eventos com corpo inválido (ver G4); tabela vazia = nenhuma publicação jamais passou pelo CMS em produção (consistente com `/pt/noticias` vazio e `news-sitemap` vazio).

---

# 16. BLOCO N — EASYPANEL (extração do repo; sem acesso ao painel)

## O que o repo PROVA vs supõe

| Serviço esperado | Papel | Evidência no repo | Status |
| --- | --- | --- | --- |
| `screen-app` | site público (Next) | `Dockerfile` (migrate no boot, `/api/health`); runbook `EASYPANEL_EDITORIAL.md:20` diz "já existe" | **Confirmado no ar** (cinerie.com responde com `database: ok`) |
| `screen-db` | PostgreSQL público | `DATABASE_URL` local aponta `rss_prime_screen-db` | **Confirmado indiretamente** (health do site diz database ok) |
| `feed` | RSS Prime (sistema EXTERNO) | citado no runbook `:8` ("o repositório não verificou nada disso") | SUPOSIÇÃO |
| `cinerie-cms` | Payload CMS | `Dockerfile.cms`; runbook manda CRIAR (`:22`) | **NÃO VERIFICADO** — pode não existir ainda |
| `cinerie-publication-worker` | projeção editorial | `Dockerfile.publication-worker`; runbook manda CRIAR (`:23`) | **NÃO VERIFICADO** |

Decisões que o runbook deixa para o operador: database lógico do CMS no `screen-db` vs serviço PG novo (`EASYPANEL_EDITORIAL.md:91-101`); storage do CMS (volume confirmado vs S3, `:101-119`); storage público editorial separado por prefixo (o preflight do worker checa colisão, `:119-123`).

O formulário completo para preencher olhando o painel está na **seção 24**.

---

# 17. A MATRIZ

Colunas: **Código** (existe e é real) · **Ligado** (conectado ao fluxo de produto) · **Testado** (suite/canário cobre) · **No ar** (responde em produção) · **Tem dado** (conteúdo real em produção) · **Alcançável** (um usuário chega nela navegando). PRONTO exige todas. "N/V" = não verificável desta máquina (Bloco M/N pendente).

| Funcionalidade | Código | Ligado | Testado | No ar | Tem dado | Alcançável | Estado | O que falta |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home | ✔ | ✔ | ✔ | ✔ | ✔ (hero+rails reais) | ✔ | **PRONTO** (sob noindex) | — |
| Busca | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | PRONTO | risco de perf no ramo de alias (A4) |
| Explorar | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | PRONTO | — |
| Filmes (listagem+detalhe) | ✔ | ✔ | ✔ | ✔ | ⚠ só **129** | ✔ | **PARCIAL** | escala de catálogo (decisão+execução) |
| Séries | ✔ | ✔ | ✔ | ✔ | ⚠ 110 | ✔ | PARCIAL | idem |
| Temporadas | ✔ | ✔ | ✔ | ✔ | ⚠ 53 | ✔ | PARCIAL | idem |
| Episódios | ✔ | ✔ | ✔ | ✔ | ⚠ 559 | ✔ | PARCIAL | idem + índice `episodes.air_date` (A4) |
| Pessoas | ✔ | ✔ | ✔ | ✔ | ⚠ 22.410 (desproporção) | ✔ | PARCIAL | política de thin content; paginação da listagem (A4) |
| Notícias (superfície) | ✔ | ✔ | ✔ | ✔ | ✘ **zero matérias** | ✔ | **PARCIAL** | conteúdo + CMS/worker no ar (M4/N) |
| Publicação editorial (CMS→site) | ✔ | ✔ | ✔ (integração+E2E+canários) | N/V | ✘ | — | PARCIAL | subir `cinerie-cms` + worker no EasyPanel; publicar matéria canário |
| Mídia editorial | ✔ | ✔ | ✔ | N/V | ✘ | — | PARCIAL | storage público em produção |
| Vínculos notícia↔entidade | ✔ | ✔ | ✔ (canário dedicado, PR #99) | N/V | ✘ | — | PARCIAL | dado real |
| CMS (Payload) | ✔ | ✔ | ✔ | N/V | N/V | — | PARCIAL | deploy + PR #94 (UI) em aberto |
| Admin (apps/admin) | ✔ | ✔ (flag off por default) | ✔ | N/V | — | — | PARCIAL | deploy/decisão de exposição |
| Cadastro | ✔ | ✔ | ✔ | ✔ | — | ✔ | **BLOQUEADO** | **/pt/termos e /pt/privacidade 404** |
| Login/Sessão | ✔ | ✔ | ✔ | ✔ | — | ✔ | PRONTO | — |
| Conta (perfil/consentimento/exportação) | ✔ | ✔ | ✔ | ✔ | — | ✔ | PRONTO | export de reviews/stats sai vazio (A2) |
| Exclusão de conta (LGPD) | ✔ | ✔ | ✔ | ✔ | — | ✔ | PRONTO | reconferir `cancelClosure` inalcançável |
| Listas | ✔ | ✔ | ✔ | ✔ | — | ✔ | PRONTO | — |
| Watchlist | ✔ | ✔ | ✔ | ✔ | — | ✔ | PRONTO | — |
| Tracker de séries | ✔ | ✔ | ✔ | ✔ | — | ✔ | PRONTO | — |
| Histórico | ✔ | ✔ | ✔ | ✔ | — | ✔ | PRONTO | — |
| Importação (CSV) | ✔ | ✔ | ✔ | ✔ | — | ✔ | PRONTO | — |
| Favoritos | ✔ (lista de sistema) | ✔ | ✔ | ✔ | — | ✔ | PRONTO | — |
| Reviews de usuário | ⚠ domínio puro (C5B) | ✘ **sem caminho de escrita** (A2: `UserReview` só-lido) | ⚠ | ✘ | ✘ | ✘ | **AUSENTE como produto** | adapter + UI + moderação |
| Ratings externos | ✔ | ✘ gate proíbe produção (`gate.ts` isProd) | ✔ | ✘ | ✘ | ✘ | AUSENTE por decisão de licença | matriz legal humana (PR #74) |
| Streaming/onde assistir | ✔ | ⚠ painel gateado por licença; guia textual no ar | ✔ | ✔ (página) | N/V (`watch_availability`) | ✔ | PARCIAL | licença/atribuição + sync habilitado |
| Entity Writer | ✔ | ✔ (2 block_types) | ✔ | — (offline) | N/V (M6) | — | PARCIAL | rodar geração + revisão humana; 10 block_types são contrato |
| Cinerie Score | ✔ (motor) | ✘ `blocked_by_decision` | ✔ | ✘ | ✘ | ✘ | AUSENTE por decisão | `docs/product/cinerie-score-decision.md` (humano) |
| SEO (schema/canonical/robots) | ✔ | ✔ | ✔ | ✔ | ✔ | — | PRONTO (desligado) | ligar a flag (decisão) |
| Sitemap | ✔ | ✔ | ✔ | ✔ | ✔ (23.266 URLs) | — | PRONTO | regenerado de 10/07 — confirmar frescor pós-deploy |
| Redirects persistidos | ✔ | ✔ | ✔ | ✔ (`/api/seo/redirect` responde) | N/V | — | PRONTO | — |
| Locales (pt-BR; en/es draft) | ✔ | ✔ | ✔ | ✔ | pt-BR only | — | PRONTO (conforme política) | — |
| Deploy | ✔ (Dockerfiles+runbooks) | ⚠ manual EasyPanel | ✔ (imagem provada no CI) | ✔ | — | — | PARCIAL | build args de rastreabilidade; CI não publica imagem |
| Backup | ✔ | ⚠ cron é do host | ✔ (CI prova restore) | N/V | — | — | PARCIAL | comprovar cron+último dump em produção (N) |
| Observabilidade | ⚠ health+logs | ⚠ | ⚠ | ✔ (health) | — | — | PARCIAL | métricas/alertas inexistentes no repo |
| LGPD (conjunto) | ⚠ | ⚠ | ⚠ | ⚠ | — | ⚠ | **BLOQUEADO** | Termos+Privacidade 404 |

# 18. A) BLOQUEADORES DE LANÇAMENTO, ordenados

| # | Bloqueador | Camada | Por que bloqueia | Tamanho | Decisão ou execução? |
| --- | --- | --- | --- | --- | --- |
| 1 | **Termos de Uso e Política de Privacidade não existem** (`/pt/termos`, `/pt/privacidade` → 404 no código e em produção) com consentimento obrigatório apontando para eles | Produto/Jurídico | Cadastro juridicamente inválido (LGPD); abre o site com formulário que exige aceitar documento inalcançável | Conteúdo jurídico: dias (humano). Rota: horas | **Decisão (conteúdo) + execução (rota)** |
| 2 | **Indexação global desligada** (`CINERIE_PUBLIC_INDEXING_ENABLED=false` ⇒ robots `Disallow: /` + noindex em tudo) | Config/Decisão | O site não existe para buscadores; é O gate final de lançamento | Minutos (flip de env no EasyPanel; sem rebuild — robots.ts é dinâmico) | **Decisão sua** |
| 3 | **Catálogo raso**: 129 filmes / 110 séries vs 22.410 pessoas no sitemap | Dados | Abrir assim = site "de elenco" sem obras; risco de thin content/index bloat no dia em que indexar | Dias de worker (runbooks prontos: plan-bootstrap → bootstrap → media) + decisão de escala | Decisão (escopo) + execução |
| 4 | **Editorial sem conteúdo e cadeia não comprovada em produção** (zero matérias; CMS/worker possivelmente nem deployados — N) | Infra+Conteúdo | "Notícias" no menu com página vazia; o diferencial editorial não existe publicamente | 1–2 dias de deploy (runbook passo a passo existe) + redação | Execução (+ MNScr externo) |
| 5 | **Rastreabilidade de deploy quebrada** (`/api/health` → commit unknown; CI não publica imagem) | Deploy | Impossível auditar o que está no ar; já causou 5 auditorias erradas | Minutos (build args no EasyPanel) | Execução |
| 6 | **Sem branch protection na `main`** (plano GitHub free, provado por 403) | Governança | CI não bloqueia merge; phantom commits já aconteceram | Decisão de plano/visibilidade | **Decisão sua** |
| 7 | **Backup em produção não comprovado** (código+CI ok; cron do host invisível) | Operação | Perder o banco = perder catálogo promovido + editorial; irreversível | Horas (instalar cron + rodar restore-test 1×) | Execução |
| 8 | Índices ausentes em `episodes.air_date`, `seasons.air_date`, `article_translations.published_at` + listagem de pessoas sem paginação + news index sem `take` | Perf | Home/notícias degradam linearmente com o crescimento do catálogo/autopublicação | Horas (migration aditiva + 2 fixes de query) | Execução |
| 9 | Ambiente local fora do engines (Node 24 vs 22) | Dev | Validação local não é oficial; verde falso já documentado | Minutos (instalar Node 22 via nvm-windows) | Execução |

# 19. B) O QUE PODE LANÇAR INCOMPLETO (sem prometer o que não entrega)

- **Ratings externos, Cinerie Score, reviews de usuário**: já estão invisíveis por gates fail-closed (licença/decisão/ausência de UI) — nada a esconder, só NÃO anunciar.
- **Notícias**: a página tem empty state íntegro; alternativa é tirar "Notícias" do menu até a primeira matéria real — mudança de header, não de arquitetura.
- **Onde assistir**: guia textual no ar; painel por título só aparece com `display_allowed=true`, então lança "vazio-honesto" por construção.
- **en/es**: draft/noindex por política — já corretos.
- **Recomendações personalizadas** (C6): domínio puro sem adapter — não aparece; ok.
- **Pessoas**: dá para lançar com o catálogo atual SE aceitar a desproporção temporariamente noindex nas pessoas (decisão editorial: excluir people do sitemap até o catálogo de obras crescer — o gate de elegibilidade já existe e a mudança é localizada em `sitemap-index.ts`).

# 20. C) O CAMINHO ATÉ O AR (D = decisão sua; E = execução)

1. **(D)** Definir o corte de lançamento: catálogo navegável + conta + notícias, sem ratings/score/reviews (recomendado — é o que o código sustenta hoje).
2. **(E)** Escrever e publicar `/pt/termos` e `/pt/privacidade` (conteúdo humano/jurídico; rotas estáticas simples) e conferir os 3 checkboxes do cadastro contra o texto final.
3. **(E)** Preencher o formulário N no EasyPanel + rodar o pacote M (§15/§23). Isso responde: worker vivo? outbox vazia? backup agendado? quantos filmes com poster?
4. **(E)** Subir `cinerie-cms` e `cinerie-publication-worker` conforme `EASYPANEL_EDITORIAL.md` (ordem: banco lógico → CMS → storage → worker → preflights) e publicar **1 matéria canário** de ponta a ponta até `/pt/noticias`.
5. **(D+E)** Escala de catálogo: decidir o universo do lançamento (ex.: top N mil filmes/séries) e rodar `plan-bootstrap` → `bootstrap` → mídia (runbooks `catalog-bootstrap.md`/`catalog-incremental-sync.md`), com backup validado ANTES (regra do próprio repo).
6. **(D)** Política de pessoas no sitemap para o dia 1 (manter 22k vs restringir por crédito mínimo/obra publicável).
7. **(E)** Build args `CINERIE_BUILD_SHA/VERSION/TIME` no build do EasyPanel; conferir `/api/health` mostrando o commit.
8. **(E)** Instalar cron de backup no host + 1 `restore-test.sh` verde em produção; instalar timer do catálogo se sync contínuo for desejado.
9. **(E)** Migration aditiva de índices (episodes/seasons `air_date`, article_translations `published_at`) + `take` no news index + paginação de `/pt/pessoas`.
10. **(D)** Virar a chave: `CINERIE_PUBLIC_INDEXING_ENABLED=true` no EasyPanel (robots passa a `Allow: /` + anuncia os 2 sitemaps; páginas viram index). Registrar a decisão (indexação em massa exige humano — CLAUDE.md §6).
11. **(E)** Pós-virada: Search Console (propriedade + sitemaps), monitorar `api_sync_logs`/health/quota diariamente na primeira semana.

# 21. D) PRONTIDÃO

**Conta explícita (matriz §17, 36 funcionalidades):** PRONTO = 17 · PARCIAL = 14 · BLOQUEADO = 2 · AUSENTE = 3.

- Prontidão bruta por funcionalidade: **17/36 = 47%** prontas de ponta a ponta; **31/36 = 86%** com código real e testado (PRONTO+PARCIAL).
- **Recuso dar um "percentual de lançamento" único** além dessas duas contas: as colunas "Tem dado" e "No ar" de editorial/CMS/worker/backup dependem do Bloco M e do formulário N, que só você pode rodar — qualquer número que as inclua seria estimativa, não medida. Com M+N preenchidos, a conta fecha em minutos.
- Leitura honesta: **a plataforma está ~pronta; o PRODUTO não está** — falta conteúdo (catálogo+editorial), 2 páginas jurídicas e 1 decisão de chave.

---

# 22. NÃO VERIFICADOS — o que faltou e como resolver

| Item | Por que faltou | Como resolver |
| --- | --- | --- |
| M1–M6 (dados reais dos 2 bancos) | `rss_prime_screen-db` não resolve DNS fora do EasyPanel | Rodar §15/§23 no console do EasyPanel (ou túnel SSH) |
| Estado real dos serviços EasyPanel (CMS? worker? backup? alertas?) | Sem acesso ao painel | Formulário §24 |
| Commit em produção | `/api/health` → `unknown` (build sem args) | Passo 7 do §20; depois `curl https://cinerie.com/api/health/` |
| Detalhes de branch protection | 403 (plano free) — a AUSÊNCIA está provada; a configuração fina não existe para inspecionar | Decisão do bloqueador #6 |
| Timers systemd/cron instalados no host | invisível ao repo | `systemctl list-timers` + `ls /etc/cron.d/` no host (§23) |
| EXPLAIN dos seq scans suspeitos (A4) | sem acesso a banco | Rodar os `EXPLAIN` do §23 junto com o pacote M |
| Validade da chave Gemini | regra do diagnóstico: não chamar | `pnpm --filter @screena/entity-writer` smoke (`bin/smoke-gemini.ts`) quando decidir gerar blocos |
| Comportamento transacional do runner de migrations do Payload | código fora do repo | risco baixo; observar no primeiro `payload migrate` em produção |
| Gate interno de `services/streaming/src/promotion/run.ts` | arquivo não aberto pelo agente D1 | leitura pontual em sessão futura |
| Responsividade real em 360px | auditoria foi de HTML/CSS, não viewport | teste manual (DevTools) nas 5 rotas principais |
| PR #94 em runtime | branch não deployada | revisar/mergear a PR (defeito do badge `=== 'true'` anotado no Bloco B7) |

# 23. COMANDOS PARA VOCÊ RODAR (PowerShell, prontos)

```powershell
# 1) Auditoria read-only do catálogo em produção (no console do serviço com o repo, ou via túnel):
$env:NODE_ENV = "production"; pnpm catalog audit-database --human --confirm-production-read
```

```powershell
# 2) Túnel SSH para rodar o pacote SQL do §15 da sua máquina (ajuste usuário/host do VPS):
ssh -L 15432:rss_prime_screen-db:5432 usuario@SEU_VPS
# em outra janela (senha será pedida; nunca a cole em arquivo):
psql "postgresql://USUARIO@localhost:15432/screena" -f queries-m.sql
```

```powershell
# 3) Verificar commit em produção depois de configurar os build args:
curl.exe -s https://cinerie.com/api/health/ | ConvertFrom-Json | Select-Object -ExpandProperty version
```

```powershell
# 4) No host (via SSH): timers e cron reais
ssh usuario@SEU_VPS "systemctl list-timers --all | grep -Ei 'cinerie|screena'; ls -la /etc/cron.d/"
```

```powershell
# 5) EXPLAIN dos suspeitos de seq scan (rodar no psql do túnel, banco screena):
# EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM episodes WHERE air_date >= now() - interval '30 days' ORDER BY air_date DESC LIMIT 20;
# EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM article_translations WHERE review_status = 'published' ORDER BY published_at DESC LIMIT 12;
```

```powershell
# 6) Instalar Node 22 para validação local oficial (nvm-windows):
winget install CoreyButler.NVMforWindows; nvm install 22; nvm use 22; node --version
```

# 24. FORMULÁRIO DO EASYPANEL (preencher olhando o painel — NUNCA copiar valores de env)

**Projeto `rss_prime` — para cada serviço abaixo, preencha:**

| Campo | `screen-app` | `screen-db` | `feed` | `cinerie-cms` (existe?) | `cinerie-publication-worker` (existe?) | outro PG do CMS? |
| --- | --- | --- | --- | --- | --- | --- |
| Existe? (sim/não) | | | | | | |
| Status (up/down/restarting) | | | | | | |
| Imagem + tag/branch de build | | | | | | |
| Data/hora do último deploy | | | | | | |
| Uptime e nº de restarts nas últimas 24h | | | | | | |
| Healthcheck configurado? qual URL? | | | | | | |
| Domínios + SSL (emissor, validade) | | | | | | |
| Volumes (nome → caminho no container) | | | | | | |
| NOMES das env vars definidas (só nomes!) | | | | | | |

**Perguntas únicas:**

1. Últimas 50 linhas de log de cada serviço (cole em arquivos separados; se houver segredo em log, é ACHADO — não cole o valor).
2. Existe backup agendado no painel ou no host? Frequência? Data e tamanho do último dump? Onde ele é gravado (volume? off-site/rclone)?
3. Existem alertas configurados (EasyPanel/uptime externo)? Notificam onde?
4. O build do `screen-app` define `CINERIE_BUILD_SHA`/`CINERIE_BUILD_VERSION`/`CINERIE_BUILD_TIME`? (se não: bloqueador #5)
5. Entre as envs do `screen-app`: `CINERIE_PUBLIC_INDEXING_ENABLED` existe? (valor pode ser dito: é `true`/`false`, não é segredo)
6. O `screen-db` tem um database separado para o CMS (`\l` no psql) ou o CMS ainda não foi criado?
7. Qual o hostname interno que os serviços usam para falar com o `screen-db` (confirmar `rss_prime_screen-db`)?

---

*Fim do diagnóstico. Nenhum commit, push, merge, deploy ou publicação foi feito. A única escrita foi este documento.*
