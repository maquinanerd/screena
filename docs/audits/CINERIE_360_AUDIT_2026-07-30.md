# Auditoria Cinerie 360 — 2026-07-30

> **Auditoria somente.** Nenhum codigo, banco, migration, deploy, commit, PR ou servico foi
> alterado. Nenhum segredo foi lido ou impresso. Nenhuma API externa foi chamada.
> Identidade do repositorio e mapa de componentes: [`CINERIE_ARCHITECTURE_MAP_2026-07-30.md`](./CINERIE_ARCHITECTURE_MAP_2026-07-30.md).

**Legenda de estado usada em todo o documento:**
`COMPLETO` · `FUNCIONAL, MAS INCOMPLETO` · `PARCIAL` · `SOMENTE ESTRUTURA` ·
`SOMENTE DOCUMENTACAO` · `SOMENTE TESTE` · `SEED/MOCK` · `NAO IMPLANTADO` ·
`NAO COMPROVADO` · `INEXISTENTE`

---

## Resumo executivo

O Screen-App **nao e um projeto incompleto — e um projeto com tres cortes de fio**.

A plataforma de catalogo, o produto pessoal do usuario, o CMS editorial e o worker de
projecao existem, sao reais, tem testes de integracao com PostgreSQL efemero e passam por um
CI de ~30 passos. Nada disso precisa ser reconstruido.

O que falta sao **conexoes**, e as tres mais caras sao invisiveis em teste unitario porque
cada lado esta correto isoladamente:

1. **A projecao editorial descarta os vinculos de entidade.** O contrato os carrega, o CMS os
   emite, o worker nunca os le, e `entity_news_links` — de que quatro modulos de render
   dependem — so tem escritor num script de QA. Uma noticia publicada chega ao site sem
   nenhuma ligacao com o catalogo.
2. **O corpo estruturado da materia nao e renderizado.** `body_blocks` e projetado e nunca
   lido por `apps/web`. Imagem inline, video, factBox, sourceList e entityCard desaparecem.
3. **O ciclo continuo do catalogo nao tem onde rodar.** O script e o timer existem; o proprio
   runbook registra que as units systemd "nunca foram instaladas — o deploy e container
   EasyPanel, sem systemd", e nao ha Dockerfile para o catalogo.

Alem disso, a **ponte catalogo → Payload nao existe em nenhuma forma** (nem endpoint, nem
client, nem componente): `entityId` no CMS e um campo de texto livre digitado a mao.

---

## ETAPA 1 — Mapa da arquitetura

Ver [`CINERIE_ARCHITECTURE_MAP_2026-07-30.md`](./CINERIE_ARCHITECTURE_MAP_2026-07-30.md),
secoes 1 a 8.

---

## ETAPA 2 — Catalogo da Cinerie

### 2.1 Entidades no schema (`packages/db/prisma/schema.prisma`, 74 models)

| Entidade | Model | Pagina publica | API publica | Ingestao | Job/fila | Slug | Traducao |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Filme | `Movie:501` | `/pt/filmes/[slug]` ✅ | — | ✅ | `sync_details` | ✅ | ✅ |
| Serie | `TvShow:542` | `/pt/series/[slug]` ✅ | — | ✅ | `sync_details` | ✅ | ✅ |
| Temporada | `Season:584` | `.../temporadas/[season]` ✅ | — | ✅ | `sync_seasons` | ✅ | ✅ |
| Episodio | `Episode:607` | `.../episodios/[episode]` ✅ | — | ✅ | `sync_episodes` | ✅ | ✅ |
| Pessoa | `Person:633` | `/pt/pessoas/[slug]` ✅ | — | ✅ | `sync_details` | ✅ | ✅ |
| Elenco/equipe | `CastMember:681`, `CrewMember:702` | dentro da ficha ✅ | — | ✅ | `sync_credits` | n/a | n/a |
| Colecao/franquia | `Collection:1400` | **INEXISTENTE** | — | ✅ | ✅ | ❌ | ❌ |
| Produtora | `ProductionCompany:1431` | **INEXISTENTE** | — | ✅ | ✅ | ❌ | ❌ |
| Emissora | `Network:1475` | **INEXISTENTE** | — | ✅ | ✅ | ❌ | ❌ |
| Genero | `Genre:1169` | filtro em listagem ✅ | — | ✅ | taxonomia | n/a | ✅ |
| Keyword | `Keyword:1505` | **INEXISTENTE** | — | ✅ | ✅ | ❌ | ❌ |
| Imagem | `TmdbImage:1183` | ✅ | — | ✅ | `sync_media` | n/a | n/a |
| Video/trailer | `TmdbVideo:1211` | **NAO RENDERIZADO** | — | ✅ | `sync_media` | n/a | n/a |
| Rating externo | `ExternalRating:891` | ✅ (gateado) | — | `services/ratings` | ❌ sem job na fila | n/a | n/a |
| Onde assistir | `WatchAvailability:965` | ✅ (gateado) | — | `services/streaming` | ❌ sem job na fila | n/a | n/a |
| Cinerie Score | `CinerieScoreCalculation:475` | ✅ (gateado) | — | `packages/cinerie-score` | ❌ | n/a | n/a |
| Documento de busca | `SearchDocument:1315` | `/pt/busca` ✅ | — | `search-reindex` | ✅ | n/a | ✅ |
| Personagem | — | — | — | — | — | — | **INEXISTENTE como model** (`character` so existe como opcao de `entityKind` no CMS) |
| Recomendacao | `RecommendationSnapshot:2314` | **INEXISTENTE** | **INEXISTENTE** | dominio puro | ❌ | n/a | n/a |

**Achado:** `entityKind` no CMS (`apps/cms/src/collections.ts:180`) oferece `character` e
`franchise`, mas **nao ha model `Character`** no schema publico e `Collection` nao tem slug
nem pagina. Um editor pode selecionar um tipo de entidade que o lado publico nao sabe resolver.

### 2.2 Robustez da fila (`services/ingestion/src/catalog-jobs`)

| Requisito | Estado | Evidencia |
| --- | --- | --- |
| Fila duravel | `COMPLETO` | `CatalogJob:1273`, `CatalogJobStatus:224` |
| Idempotencia | `COMPLETO` | `catalog-jobs/idempotency.ts` (`buildIdempotencyKey`) |
| Retry | `COMPLETO` | `CatalogJob` tem contadores; `catalog dead-letter` na CLI |
| Dead-letter | `COMPLETO` | `docs/runbooks/catalog-dead-letter.md` + subcomando |
| Claim concorrente | `COMPLETO` | `SKIP LOCKED` (documentado em `catalog-operations.md:117`) |
| Heartbeat | `COMPLETO` | `catalog-jobs/worker.ts:222` |
| Sentinela anti-falso-positivo | `COMPLETO` | `scripts/catalog/lib/queue-health.mjs` — compara snapshots e falha se jobs concluem sem o catalogo crescer |
| Metricas | `PARCIAL` | `src/metrics/` com sink de log estruturado; sem exporter |
| **Execucao continua em producao** | **NAO IMPLANTADO** | ver §ETAPA 15 |

### 2.3 O catalogo esta populado?

**NAO COMPROVADO.** Nenhum banco foi consultado nesta auditoria. O repositorio prova que a
maquina existe e e correta; **nao prova volume**.

O comando que responderia isso ja existe e e read-only:

```bash
pnpm catalog audit-database --json
```

**Advertencia registrada no proprio repositorio** (`docs/backend/catalog-operations.md:63-66`):
em banco novo, pular `db:seed`, taxonomias ou configuration cache produz *"o sintoma mais
traicoeiro do sistema — fila saudavel, zero entidades"*.

---

## ETAPA 3 — TMDB

| Funcao TMDB | Codigo | Teste | Job na fila | Producao comprovada | Lacuna |
| --- | --- | --- | --- | --- | --- |
| Client + auth (v4 Bearer / v3 fallback) | `api-clients/tmdb` ✅ | ✅ | n/a | **NAO COMPROVADO** | — |
| Configuration cache (imagens) | `services/ingestion/src/config-sync` + `bin/sync-tmdb-config.ts` ✅ | ✅ | ✅ | NAO COMPROVADO | agendamento semanal nao instalado |
| `tmdb_raw` (cache bruto) | `TmdbRaw:1125` + `raw-sync/` ✅ | ✅ | ✅ | NAO COMPROVADO | — |
| Daily ID Exports (descoberta) | `src/discovery/` + `bin/discover-ids.ts` ✅ | ✅ | ✅ | NAO COMPROVADO | — |
| Exclusao de conteudo adulto (2 camadas) | `src/discovery/` ✅ | ✅ | n/a | n/a | — |
| `/changes` incremental | `src/changes/` ✅ | ✅ | ✅ | NAO COMPROVADO | agendamento diario nao instalado |
| Detalhe (movie/tv/person) | `sync-details-handler.ts` ✅ | ✅ | ✅ | NAO COMPROVADO | — |
| Creditos | `sync-credits` ✅ | ✅ | ✅ | NAO COMPROVADO | — |
| Imagens | `sync-media` ✅ | ✅ | ✅ | NAO COMPROVADO | — |
| Videos/trailers | `sync-media` ✅ (grava `TmdbVideo`) | ✅ | ✅ | NAO COMPROVADO | **nao renderizado** (ETAPA 5) |
| Temporadas | `sync-seasons` ✅ | ✅ | ✅ | NAO COMPROVADO | — |
| Episodios | `sync-episodes-handler.ts` ✅ | ✅ | ✅ | NAO COMPROVADO | — |
| Traducoes | `EntityTranslation:774` ✅ | ✅ | ✅ | NAO COMPROVADO | so pt-BR publica |
| External IDs | `EntityExternalId:724` ✅ | ✅ | ✅ | NAO COMPROVADO | **e a chave para IMDb/RT** |
| Colecoes / companies / networks / keywords | `catalog-entities/` ✅ | ✅ | ✅ | NAO COMPROVADO | sem pagina publica |
| Rate limit / retry / circuit breaker | `api-clients/rapidapi-core` + client TMDB ✅ | ✅ | n/a | NAO COMPROVADO | — |
| Hash de payload (evitar update inutil) | `TmdbRaw` + `payload_hash` ✅ | ✅ | n/a | NAO COMPROVADO | — |
| Log obrigatorio | `ApiSyncLog:1101` ✅ | ✅ | n/a | NAO COMPROVADO | — |
| Checkpoint de sync | `TmdbSyncCheckpoint:1241` ✅ | ✅ | n/a | NAO COMPROVADO | — |

**Estado do TMDB: `FUNCIONAL, MAS INCOMPLETO` — a plataforma esta pronta; a operacao continua nao.**

---

## ETAPA 4 — Ratings e fontes externas

| Fonte | Client | Provedor tecnico | Oficial/terceiro | Credencial | Persistencia | Exibicao publica | Licenca | Estado real |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **TMDB** | `api-clients/tmdb` real | TMDB | oficial | `TMDB_READ_ACCESS_TOKEN` / `TMDB_API_KEY` | `movies`/`tv_shows` (`vote_average`) | ficha | `services/legal` | `FUNCIONAL, MAS INCOMPLETO` |
| **IMDb** | `api-clients/film_show_ratings` (real) | `imdb236` via RapidAPI | **TERCEIRO** — nao e a IMDb | `RAPIDAPI_FILM_SHOW_RATINGS_KEY` | `external_ratings` | gateada por licenca | matriz em `services/legal/src/authorization-spec.ts` | `SOMENTE ESTRUTURA` — nenhum job, nenhuma execucao comprovada |
| `api-clients/imdb` | **so `README.md`** | — | — | — | — | — | — | `PLACEHOLDER` |
| **Rotten Tomatoes** | `api-clients/rotten_tomatoes` = **so `README.md`** | — | — | — | — | — | — | `PLACEHOLDER` — sem client, sem job, sem dado |
| **Metacritic** | — | — | — | — | escala definida em `@screena/config` | — | — | `SOMENTE ESTRUTURA` (so a escala existe) |
| **Letterboxd** | — | — | — | — | escala definida | — | — | `SOMENTE ESTRUTURA` |
| **FilmAffinity** | — | — | — | — | escala definida | — | — | `SOMENTE ESTRUTURA` |
| **Streaming availability** | `api-clients/streaming_availability` (real) | RapidAPI | terceiro | `RAPIDAPI_STREAMING_AVAILABILITY_KEY` | `watch_availability` | gateada | `services/legal` | `SOMENTE ESTRUTURA` |
| `api-clients/kaso` | **so `README.md`** | — | — | — | — | — | — | `PLACEHOLDER` |
| Trakt / TV Time / AdoroCinema | — | — | — | — | — | — | — | `INEXISTENTE` |

### Achados de ratings

1. **"IMDb" no repositorio nao e a IMDb.** O unico caminho executavel e
   `imdb236` via RapidAPI (`services/ratings/bin/sync-film-show-ratings.ts:34`) — um
   agregador de terceiro. Isso esta corretamente modelado
   (`provider_api = rapidapi_film_show_ratings`, `rating_source = imdb`,
   invariante 2), mas **muda a conversa de licenca**: exibir nota da IMDb obtida de um
   agregador nao licenciado nao e o mesmo que exibir nota licenciada da IMDb.
2. **Rotten Tomatoes nao existe em nenhuma forma executavel.** Existe a escala (`100`), o
   rotulo protegido (`Tomatometer`/`Popcornmeter` so podem pertencer ao RT —
   `.claude/rules/ratings.md`) e um `README.md`. Nao ha client, credencial, job ou dado.
3. **Nenhum dos dois roda.** `services/ratings` e `services/streaming` **nao tem consumidor**
   fora de `package.json`, testes de governanca e `tsconfig`/`vitest` (grep confirmado).
   Nao ha job de catalogo, nao ha agendamento, nao ha Dockerfile.
4. As invariantes 1 e 2 estao **travadas por teste** (`tests/governance/ratings.test.ts`,
   `rating-scales-mirror.test.ts`, `tmdb-provider-separation.test.ts`) — a governanca esta
   solida; o que falta e produto.

### Cinerie Score

| Dimensao | Estado | Evidencia |
| --- | --- | --- |
| Calculo | `packages/cinerie-score` real | pacote proprio |
| Persistencia | `CinerieScoreCalculation:475` com `status` (`CinerieScoreStatus:183`) | schema |
| Versionamento | ✅ campo `version` | `CinerieScorePayload.version` |
| Leitura publica | ✅ com gate de procedencia | `apps/web/src/server/editorial-score.ts:67-107` — so exibe se houver calculo `calculated` **coerente** (valor + escala batem, epsilon) |
| Fonte de dados | **bloqueada** — depende de ratings externos que nao rodam | — |
| Risco de misturar escalas | mitigado — a procedencia e verificada antes de exibir | `editorial-score.ts:101-104` |
| **Estado real** | **`SOMENTE ESTRUTURA`** | sem ratings, o score nao tem insumo |

---

## ETAPA 5 — Onde assistir e videos

| Item | Estado | Evidencia |
| --- | --- | --- |
| `watch_availability` + `platforms`/`providers` | `SOMENTE ESTRUTURA` | `WatchAvailability:965`, `WatchProvider:429`, `WatchProviderAlias:447` |
| Sync real | `SOMENTE ESTRUTURA` | `services/streaming/bin/sync-streaming-availability.ts` sem agendamento |
| Promocao humana | `COMPLETO` | `bin/review-watch-availability.ts` + `bin/promote-watch-availability.ts` |
| UI gateada por licenca | `COMPLETO` | `apps/web/src/lib/watch-availability-presenter.ts` + `tests/governance/no-fake-streaming-in-ui.test.ts` |
| Carimbo "Atualizado em" | `COMPLETO` | presenter + regra de ingestao |
| Logo de provedor | corretamente **suprimido** — `logo_allowed=false` → provedores como texto | `apps/web/app/pt/onde-assistir/page.tsx:14-16` |
| **Trailers/videos** | **`SOMENTE ESTRUTURA`** | `TmdbVideo:1211` existe e e sincronizado; `grep trailer apps/web` retorna so um comentario: *"celula de trailer sem play fake (sem contrato de video na pagina)"* (`apps/web/app/pt/filmes/[slug]/page.tsx:28`) |
| YouTube / Vimeo / player | `INEXISTENTE` | — |
| Pirataria | **zero** | travado por `tests/governance/no-fake-streaming-in-ui.test.ts` |

**Achado:** o bloco de valor #8 ("trailer incorporado") tem o dado no banco e **nenhum
consumidor**. E a lacuna de menor custo e maior efeito visual do catalogo.

---

## ETAPA 6 — Funcionalidades do usuario

| Funcao | Backend | API | UI | Persistencia | Testes | Pronta? |
| --- | --- | --- | --- | --- | --- | --- |
| Cadastro | ✅ | `/api/auth/signup` | `/pt/criar-conta` | `User:1929` | ✅ | ✅ |
| Login / sessao | ✅ | `/api/auth/login`, `/session` | `/pt/entrar` | `UserSession:2017` (so hash) | ✅ | ✅ |
| Logout / logout-all | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Verificacao de e-mail | ✅ (Brevo REST) | `/api/auth/email-verification/**` | `/pt/verificar-email` | `VerificationToken:2040` | ✅ | ✅ |
| Recuperacao de senha | ✅ | `/api/auth/password-reset/**` | `/pt/recuperar-senha`, `/pt/redefinir-senha` | ✅ | ✅ | ✅ |
| Troca de senha | ✅ | `/api/auth/password-change` | `/pt/conta` | ✅ | ✅ | ✅ |
| Throttle / CSRF | ✅ | `AuthThrottle:2057` | n/a | ✅ | ✅ | ✅ |
| Perfil | ✅ | `/api/account/profile` | `/pt/conta` | `UserProfile:1971` | ✅ | ✅ |
| Privacidade / consentimento | ✅ | `/api/account/consent`, `/privacy` | `/pt/conta/privacidade` | `ConsentRecord:2366` | ✅ | ✅ |
| Exportacao (LGPD) | ✅ | `/api/account/export` | ✅ | `DataRequest:2382` | ✅ | ✅ |
| Encerramento / anonimizacao | ✅ | `/api/account/close` | ✅ | ✅ | ✅ | ✅ |
| Watchlist / assistido / abandonado | ✅ | `/api/me/watch-state` | `/pt/minha-lista`, `/pt/tracker` | `UserWatchState:2095` (`WatchState:1765`) | ✅ | ✅ |
| Progresso de episodios | ✅ | `/api/me/episodes`, `/bulk`, `/series-progress/[id]` | `/pt/tracker` | `EpisodeProgress:2118` | ✅ | ✅ |
| Historico | ✅ | `/api/me/history` | `/pt/historico` | `ViewingEvent:2139` | ✅ | ✅ |
| Avaliacoes | ✅ | `/api/me/ratings` | ✅ | `UserRating:2211` | ✅ | ✅ |
| Listas (publicas/privadas) | ✅ | `/api/me/lists/**` (6 rotas) | `/pt/listas`, `/pt/listas/[id]` | `UserList:2167`, `UserListItem:2191` | ✅ | ✅ |
| Importacao (Cinerie/Letterboxd CSV) | ✅ | `/api/me/imports/**` (4 rotas) | `/pt/importar` | `ImportJob:2404` | ✅ | ✅ |
| **Reviews de usuario** | ✅ dominio + moderacao | **INEXISTENTE** | **INEXISTENTE** | `UserReview:2231`, `ReviewReport:2254` | ✅ | ❌ `SOMENTE ESTRUTURA` |
| **Recomendacoes** | ✅ dominio puro | **INEXISTENTE** | **INEXISTENTE** | `RecommendationSnapshot:2314`, `RecommendationFeedback:2342` | ✅ | ❌ `SOMENTE ESTRUTURA` |
| Notificacoes | — | — | — | — | — | `INEXISTENTE` |
| Bloqueio de usuario | ✅ | ❌ | ❌ | `UserBlock:2274` | ✅ | `SOMENTE ESTRUTURA` |

**Estado geral: `FUNCIONAL, MAS INCOMPLETO`.** O produto pessoal e a area mais madura do
repositorio. As duas ausencias (reviews e recomendacoes) tem dominio pronto e testado e
faltam apenas API + UI — a pagina `/pt/onde-assistir` inclusive **declara honestamente**
a ausencia em vez de simular ("nao ha servico de recomendacao exposto ao app publico ainda",
`page.tsx:16-18`).

---

## ETAPA 7 — Portal de noticias

### Respostas diretas

| # | Pergunta | Resposta |
| --- | --- | --- |
| 1 | Uma noticia publicada no Payload consegue aparecer no site? | **Sim, o texto sim** — desde que o worker esteja implantado. Mas **sem entidades vinculadas e sem corpo estruturado** (ver 13-15). |
| 2 | Qual componente faz a projecao? | `services/news-ingestion/bin/project-editorial.ts` (`--loop`/`--once`) |
| 3 | Esta implantado? | **NAO COMPROVADO** — `Dockerfile.publication-worker` existe; `docs/operations/easypanel-deployment-checkpoint.md:1` diz *"Nada foi implantado"* na data daquele commit |
| 4 | Variaveis exigidas? | validador em `services/news-ingestion/src/projection-worker-config.ts` + `media/storage-config.ts` (`EDITORIAL_MEDIA_S3_*`) |
| 5 | Tabelas que recebe? | `articles`, `article_translations`, `editorial_media_assets`, `editorial_projection_receipts` — **e mais nenhuma** |
| 6 | Contrato versionado? | **Sim** — `publication-event-v1` |
| 7 | Idempotente? | **Sim** — `EditorialProjectionReceipt:2654` + `projectedSequence` (trava anti-fora-de-ordem, `schema.prisma:1591-1598`) |
| 8 | Retry? | **Sim** — ciclo claim/ack/fail |
| 9 | Lease? | **Sim** — migration `20260729_011649_outbox_lease_and_scopes` |
| 10 | Dead-letter? | **PARCIAL** — ha `fail` com desfechos (`EditorialProjectionOutcome:2638`); nao ha fila morta dedicada |
| 11 | Observabilidade? | `/healthz` + `/readyz` (`worker-health-server.ts`), `src/metrics.ts` |
| 12 | Teste E2E real? | **Sim** — `pnpm test:manual-publication-projection:integration` (canario CMS→publico com 2 PG16 efemeros, no CI) |
| 13 | **Card de filme/serie no fim da noticia existe?** | **O bloco existe no CMS; o vinculo nao chega ao banco publico.** Ver §7.1 |
| 14 | **O frontend resolve entidade associada?** | **Sim, se `entity_news_links` existir** (`news-pages.ts:266`). Mas nada em producao escreve essa tabela. |
| 15 | Card usa dado atual ou copia? | **Dado atual** — o presenter resolve via `entity_news_links` → catalogo. A arquitetura esta certa; falta o elo. |

### 7.1 O corte de fio (achado mais grave da auditoria)

```
CMS: entityReferences[] (verified por humano)
  └─► publication.ts:271,308  →  evento carrega `entities: publishedEntityLink[]`
        └─► worker: NUNCA LE   ✗
              └─► entity_news_links: 0 escritores em runtime
                    └─► render depende dela em 4 lugares  ✗✗✗
```

Escritores de `entity_news_links` em todo o repositorio:
`services/news-ingestion/bin/qa-editorial-seed.ts:227` — **um script de QA**.

Leitores (render de producao):
- `apps/web/src/server/home-editorial.ts:89` — destaques editoriais da home
- `apps/web/src/server/news-pages.ts:266` — card de entidade da materia
- `apps/web/src/server/news-pages.ts:378` — relacionadas
- `apps/web/src/server/related-news.ts:47` — "noticias relacionadas" nas fichas de filme/serie/pessoa

Efeito pratico: uma noticia real publicada hoje nao mostra card de entidade, nao aparece nas
"noticias relacionadas" de nenhum filme e nao entra nos destaques editoriais da home.

### 7.2 Segundo corte: corpo estruturado nao renderizado

`article_translations.body_blocks` recebe 10 tipos de bloco do CMS.
`grep -rn "bodyBlocks" apps/web` → **vazio**. O render usa `view.bodyParagraphs` (coluna
`body` em texto). Perdem-se: `image` inline, `video`, `factBox`, `relatedContent`,
`sourceList`, `entityCard`, `heading`, `quote` com atribuicao.

O schema documenta a intencao correta (*"os blocos sao aditivos: quem sabe renderiza-los usa,
quem nao sabe continua com `body`"*, `schema.prisma:1650-1652`) — **ninguem sabe ainda**.

### 7.3 Superficies publicas de noticia

| Item | Estado | Evidencia |
| --- | --- | --- |
| Listagem `/pt/noticias` | `COMPLETO` | `app/pt/noticias/page.tsx` |
| Materia `/pt/noticias/[slug]` | `FUNCIONAL, MAS INCOMPLETO` | 391 linhas; sem `bodyBlocks` |
| Sitemap de noticias | `COMPLETO` | `app/news-sitemap.xml/route.ts` — janela 48 h, teto 1.000, namespace proprio |
| JSON-LD `NewsArticle` + `BreadcrumbList` | `COMPLETO` | `page.tsx:118-160` |
| Recomendacao de `schemaType` recusavel pelo render | `COMPLETO` (boa decisao) | `page.tsx:156-158` — *"`Review` sem review propria seria schema falso"* |
| Gate de agendamento (`publishedAt` futuro) | `COMPLETO` | `isPublishableArticle` em `@screena/seo` |
| Correcao / retratacao | `COMPLETO` | `correctedAt` + `correctionNote` com CHECK |
| **Categoria** | `PARCIAL` | `articles.category` e **`String?` texto livre** (`schema.prisma:1569`) — o proprio comentario diz *"v2: FK ArticleCategory"* |
| **Tags** | **`INEXISTENTE`** | nenhum model, nenhuma coluna, nenhuma rota |
| **Rota de categoria/tag** | **`INEXISTENTE`** | — |
| Autor | `PARCIAL` | `articles.author_name` texto livre (*"v2: FK Author"*); o CMS ja tem collection `authors` real, mas ela **nao e projetada** |

---

## ETAPA 8 — Payload CMS

| Funcao do CMS | Existe | Qualidade | Operacional | Falta |
| --- | --- | --- | --- | --- |
| Collections (`editorial-users`, `service-accounts`, `authors`, `media`, `articles`, `publication-outbox`, `autopublish-quota-counters`, `autopublish-quota-usage`) | ✅ 8 | alta | sim | — |
| Papeis humanos (5) | ✅ | alta | sim | — |
| Workflow de 12 estados | ✅ | alta — `workflowStatus` proprio porque *"`_status` do Payload tem 2 valores; o fluxo real tem 12"* (`workflow.ts:33`) | sim | — |
| Ator de automacao separado | ✅ | ADR 0017 | sim | — |
| Drafts / autosave / versoes | ✅ | alta | sim | — |
| Publicacao manual | ✅ | E2E Playwright no CI | sim | — |
| Autopublicacao governada | ✅ | 5 dimensoes de quota, reserva transacional, kill switch | gateada por `EDITORIAL_AUTO_PUBLISH_ENABLED` | MNScr |
| Outbox + lease + CAS atomico | ✅ | corrigido em `2f10aa5` | sim | — |
| Service accounts + escopos | ✅ | 3 escopos, API key nao-legivel apos criacao | sim | — |
| Auditoria humana / de automacao | ✅ | migration `human_publication_trail` | sim | — |
| Fontes (`externalSources`) e claims | ✅ | com `origin` e `conflictsWith` | sim | **nao projetados para o publico como bloco visivel** |
| SEO editorial | ✅ | `metaTitle`, `focusKeyphrase`, `socialTitle`, `canonicalOverride`, `noindex`, `schemaTypeRecommendation` | sim | score de SEO, preview SERP |
| Midia (credito, licenca, 3 permissoes fail-closed, focal point, hash) | ✅ | alta — *"ausencia de decisao = proibicao"* | sim | **conversao WebP** |
| Endpoint de bytes para o worker | ✅ | `publication-media.ts` | sim | — |
| Storage de upload (local/S3) | ✅ | `upload-storage-config.ts` recusa local em producao | sim | — |
| Migrations | ✅ 9 | sim | sim | — |
| Health / readiness | ✅ | `/healthz` + `/readyz` | sim | — |
| **Categorias reais** | ❌ | `section` e **texto** (`collections.ts:560`) | — | taxonomia |
| **Tags reais** | ❌ | `internalTags` e **`text[]`** e **nao e publicado** | — | taxonomia |
| **Seletor de entidades** | ❌ | `entityId` e **`type: 'text'`** digitado a mao (`collections.ts:606`) | — | **ponte catalogo** |
| **Seletor de imagens do catalogo** | ❌ | — | — | ponte catalogo |
| **Importacao de imagem externa por URL** | ❌ | so upload manual | — | MNScr |
| **Conversao WebP / derivados / focal crop** | ❌ | `sharp` esta registrado (`payload.config.ts:108`) mas **nao ha `imageSizes` nem `formatOptions`** no `upload` da collection `media` (`collections.ts:411-422`) | — | pipeline de imagem |
| **Exclusao segura do original apos conversao** | ❌ | nao existe conversao | — | idem |
| Score SEO / preview SERP / links internos sugeridos | ❌ | so `approvedInternalLinks` como Json | — | — |
| Search Console / GA4 | ❌ | **INEXISTENTE** (ETAPA 13) | — | — |
| Calendario editorial / agendamento na UI / comentarios internos / checklist / home placement / newsletter | ❌ | — | — | — |

**Estado do CMS: `FUNCIONAL, MAS INCOMPLETO` — o nucleo de governanca e forte; falta a camada
de conforto editorial e a ponte com o catalogo.**

---

## ETAPA 9 — Ponte catalogo → Payload

### Classificacao: **D. NAO EXISTE**

Verificacao exaustiva:

| Item procurado | Resultado |
| --- | --- |
| API interna de busca de entidades em `apps/web` | **nenhuma** — as 40 rotas de API sao auth/account/me/health/sitemap |
| Endpoint de resolucao por TMDB ID / IMDb ID | **nenhum** |
| Client HTTP do CMS para o Screen-App | **nenhum** — `grep -in "catalog\|SCREEN_APP_URL\|entitySearch" apps/cms/src` retorna so `entityCard` como slug de bloco |
| Autenticacao CMS ↔ Screen-App | **nenhuma** — as service accounts existem no sentido oposto (MNScr/worker → CMS) |
| Componente de UI de selecao de entidade | **nenhum** — campo de texto puro |
| Validacao de entidade no CMS | **nenhuma** — `entityId` aceita qualquer string |
| Tratamento de ambiguidade | **nenhum** |
| `cinerie-editorial-context-v1` (contrato que serviria isso) | **contrato tipado, zero produtores** — o proprio arquivo declara: *"O Cinerie Context Service que o serve NAO faz parte desta fase"* (`cinerie-editorial-context-v1.ts:4-6`) |

### Menor conjunto de trabalho para fechar a ponte

1. **Endpoint de busca no Screen-App** — `GET /api/internal/entities/search?q=&kind=&limit=`,
   autenticado por token de servico, lendo `SearchDocument:1315` (que ja existe, ja e indexado
   e ja tem `search-reindex`). Retorna `{entityKind, entityId, title, year, posterPath, slug,
   canonicalUrl, externalIds}`.
2. **Endpoint de resolucao** — `GET /api/internal/entities/:kind/:id` para hidratar o card e
   validar um `entityId` ja gravado.
3. **Componente de campo customizado no Payload** substituindo `entityId: text` — busca,
   mostra poster/ano/tipo, grava o id canonico. O Payload suporta `admin.components.Field`.
4. **O worker passar a projetar `event.article.entities` para `entity_news_links`** — esta e a
   pecinha que desbloqueia card, relacionadas e destaques da home **de uma vez**.

Os passos 1-3 sao a ponte editorial; **o passo 4 e independente e mais barato**, e sozinho ja
faz o card funcionar para `entityId` digitado a mao.

---

## ETAPA 10 — Midia

### 10.1 Midia editorial

| Item | Estado | Evidencia |
| --- | --- | --- |
| Upload manual | `COMPLETO` | collection `media` |
| Credito / fonte / URL de origem / detentor | `COMPLETO` | `credit`, `sourceName`, `sourceUrl`, `rightsHolder` |
| Licenca (6 estados) + validade | `COMPLETO` | `licenseStatus`, `licenseExpiresAt` |
| 3 permissoes fail-closed (`editorial`/`hero`/`social`) | `COMPLETO` | default `false` — *"Ausencia de decisao = proibicao"* |
| Proveniencia | `COMPLETO` | `provenanceType` (5 valores) |
| Focal point | `SOMENTE ESTRUTURA` | campo existe; nenhum consumidor faz crop |
| `contentHash` | `COMPLETO` | usado na chave de storage |
| Autorizacao por finalidade no endpoint de bytes | `COMPLETO` | `media-authorization.ts` |
| **Importacao por URL (imagem da fonte)** | **`INEXISTENTE`** | so upload |

### 10.2 Midia do catalogo

| Item | Estado |
| --- | --- |
| `TmdbImage:1183` (posters, backdrops, logos, profiles, stills) sincronizada | `FUNCIONAL, MAS INCOMPLETO` |
| Exposta ao CMS | **`INEXISTENTE`** |
| Host de imagem TMDB centralizado | `COMPLETO` — `packages/public-contracts` e o unico lugar autorizado (`tests/governance/image-host-single-source.test.ts`) |

### 10.3 Pipeline tecnico — resposta exata as perguntas

| Pergunta | Resposta | Evidencia |
| --- | --- | --- |
| Converte JPG/PNG para WebP? | **NAO** | `upload` da collection `media` define apenas `staticDir` e `mimeTypes` (`collections.ts:411-422`); nao ha `imageSizes` nem `formatOptions`. `sharp` esta registrado no `payload.config.ts:108` mas nao configurado para converter. |
| Mantem ou apaga o original? | **Mantem** (nao ha conversao para justificar remocao) | idem |
| Gera derivados? | **NAO** | nenhum `imageSizes` |
| Preserva alta resolucao? | **Sim** (por inacao — o arquivo original e servido) | — |
| Evita upscale? | n/a | nao ha redimensionamento |
| Valida integridade antes de excluir? | n/a | nao ha exclusao |
| Possui testes? | **Sim, do que existe** | `media-validation.test.ts` valida sniff de MIME (JPEG/PNG/WebP/AVIF) e dimensoes por cabecalho; AVIF devolve `null` de proposito |
| Deduplicacao | **Sim** | chave por `contentHash` (`media-storage.test.ts:146` — `editorial/aa/<HASH>.webp`) |
| Storage | `COMPLETO` | port com adapter local + S3-compatible (R2), `EDITORIAL_MEDIA_S3_*` |
| CDN / URLs publicas | `PARCIAL` | URLs derivadas do storage; sem camada de CDN declarada |
| Rollback | `PARCIAL` | idempotencia por hash; sem rollback explicito |

**Achado:** o nome de chave nos testes usa `.webp`, mas **a conversao que produziria esse
`.webp` nao existe**. A extensao vem do MIME de entrada. Se a redacao subir um JPEG, a chave
sera `.jpeg`.

---

## ETAPA 11 — O que o Screen-App ja aceita do MNScr

| Capacidade | Estado | Evidencia |
| --- | --- | --- |
| Service account + API key | `COMPLETO` | collection `service-accounts`, `disableLocalStrategy: true`, chave nao-legivel apos criacao |
| Escopos | `COMPLETO` | `draft_ingest`, `publication_projection`, `editorial_auto_publish` |
| Draft intake | `COMPLETO` | `POST /internal/editorial-drafts` (`draft_ingest`) → nasce em `automation_draft` |
| Autopublicacao governada | `COMPLETO` | `POST /internal/editorial-publications` (`editorial_auto_publish`) + quotas em 5 dimensoes + fuso IANA + reserva transacional |
| Contrato `editorial-draft-v1` | `COMPLETO` | Zod, versionado, publicado em `/internal/contracts` |
| Idempotency key | `COMPLETO` | `apps/cms/src/idempotency.ts` |
| Fontes (`externalSources`) | `COMPLETO` no intake | — |
| Claims (com `origin` e `conflictsWith`) | `COMPLETO` no intake | — |
| Entidades candidatas | `COMPLETO` no intake — **`verified` sempre `false` vindo da automacao** | `collections.ts:625-627` |
| SEO sugerido | `COMPLETO` | `seo-proposal.ts` |
| QA (`blockingErrors`, `warnings`, `qaVersion`) | `COMPLETO` | — |
| Erros / resposta | `COMPLETO` | — |
| Documentacao | `COMPLETO` | ADR 0015, ADR 0017, `docs/operations/editorial-auto-publication-quota.md` |
| **Imagens da fonte (por URL)** | **NAO ACEITO** | o intake nao baixa imagem externa; a collection `media` so aceita upload |
| **Contexto Cinerie → MNScr** | **NAO OFERECIDO** | `cinerie-editorial-context-v1` sem produtor |

**Resumo:** o MNScr **ja poderia hoje** enviar um draft estruturado completo — texto, fontes,
claims, SEO, entidades candidatas e QA — e ate autopublicar. **Nao pode** enviar imagem por
URL nem consultar o catalogo da Cinerie.

---

## ETAPA 12 — SEO

| Recurso | Implementado | Automatico | Manual | Testado | Lacuna |
| --- | --- | --- | --- | --- | --- |
| `title` / `meta description` | ✅ | ✅ | ✅ (CMS) | ✅ | — |
| Slug por idioma | ✅ | ✅ | ✅ | ✅ | — |
| Canonical autorreferente | ✅ | ✅ derivado de `slugs`/`redirects` | `canonicalOverride` | ✅ | — |
| `robots` | ✅ `app/robots.ts` | ✅ | — | ✅ `no-raw-robots-metadata.test.ts` | — |
| `noindex` tecnico | ✅ | ✅ `evaluateIndexability` | — | ✅ `indexability.test.ts` | — |
| Sitemap paginado por shard | ✅ | ✅ | — | ✅ | — |
| **News sitemap** | ✅ | ✅ janela 48 h / 1.000 URLs | — | ✅ | — |
| Structured data por tipo | ✅ `Movie`/`TVSeries`/`TVSeason`/`TVEpisode`/`Person`/`NewsArticle` | ✅ | — | ✅ `schema-safe-defaults`, `json-ld-safe-serialization` | — |
| `BreadcrumbList` | ✅ | ✅ | — | ✅ | — |
| `hreflang` | ✅ (logica) | ✅ | — | ✅ | so pt-BR publicado → cluster vazio, **correto** |
| Idiomas | `PUBLISHED_LOCALES` = `pt-BR`,`pt` | ✅ | decisao humana | ✅ `index-language-guard.test.ts` | en/es incompletos |
| Open Graph / Twitter | ✅ | ✅ | `socialTitle`/`socialDescription` | ✅ | — |
| Redirects 301/308 | ✅ | ✅ | — | ✅ | — |
| Datas / autor / secao | ✅ | ✅ | ✅ | ✅ | autor e texto livre |
| **Entidades / links internos** | ⚠️ | **quebrado** — `entity_news_links` vazio | `approvedInternalLinks` (Json, nao renderizado) | — | **ETAPA 7.1** |
| **Google News** | ✅ sitemap | ✅ | — | ✅ | falta submissao/verificacao (operacional) |
| **Discover** | ❌ | — | — | — | depende de imagem grande + AMP-free + E-E-A-T |
| **Score SEO editorial** | ❌ | — | — | — | `INEXISTENTE` |
| **Preview de SERP no CMS** | ❌ | — | — | — | `INEXISTENTE` |

**Fonte unica de SEO:** `packages/seo` — travada por `tests/governance/no-render-external-api.test.ts`,
`web-render-layering.test.ts`, `home-seo-identity.test.ts`. O antigo `seo/` na raiz foi removido.

---

## ETAPA 13 — Google Search Console e GA4

**Ambos: `INEXISTENTE`.**

`grep -rn "searchconsole|search-console|gtag|GA4|googletagmanager"` em `apps`, `packages`,
`services`, `docs` retorna **zero** ocorrencia de integracao. Os unicos matches de "analytics"
sao:

- `ConsentKind` com finalidade `analytics` no consentimento LGPD (`schema.prisma:1845`)
- checkbox de consentimento no cadastro (`apps/web/app/pt/criar-conta/signup-form.tsx:28`)
- rotulo de UI em `/pt/conta/privacidade`

Ou seja: **o consentimento para analytics existe; o analytics nao.** Nao ha client, OAuth,
service account, env var, job, tabela, cache, dashboard nem metrica.

---

## ETAPA 14 — Frontend publico

| Rota | Renderiza | Dados reais | Imagens | Videos | Placeholder/fake | Testada |
| --- | --- | --- | --- | --- | --- | --- |
| `/pt` (home) | ✅ | ✅ PostgreSQL | ✅ TMDB | ❌ | secao "PARA VOCE" declara ausencia | ✅ QA real PG |
| `/pt/explorar` | ✅ | ✅ | ✅ | ❌ | — | ✅ |
| `/pt/filmes` | ✅ | ✅ | ✅ | ❌ | — | ✅ `validate:entity-indexes` |
| `/pt/filmes/[slug]` | ✅ | ✅ | ✅ | ❌ **celula de trailer sem play** | comentario declara a ausencia | ✅ `validate:movie-page` |
| `/pt/series` + `[slug]` | ✅ | ✅ | ✅ | ❌ | — | ✅ `validate:series-page` |
| `/pt/series/.../temporadas/[season]` | ✅ | ✅ | ✅ | ❌ | — | ✅ |
| `.../episodios/[episode]` | ✅ | ✅ | ✅ | ❌ | — | ✅ |
| `/pt/pessoas` + `[slug]` | ✅ | ✅ | ✅ | ❌ | — | ✅ `validate:person-page` |
| `/pt/noticias` | ✅ | ✅ | ✅ | ❌ | — | ✅ `validate:news-pages` |
| `/pt/noticias/[slug]` | ✅ | ✅ | ✅ hero | ❌ | **sem `bodyBlocks`, sem card de entidade real** | ✅ |
| `/pt/busca` | ✅ | ✅ `SearchDocument` | ✅ | ❌ | — | ✅ |
| `/pt/onde-assistir` | ✅ | ✅ gateado | ✅ | ❌ | **"PARA VOCE" declara honestamente a ausencia de recomendacao** | ✅ |
| `/pt/em-breve` | ✅ | ✅ | ✅ | ❌ | estreia sem data → estado ambar, nunca data inventada | ✅ |
| `/pt/conta` + `/privacidade` | ✅ | ✅ | n/a | n/a | — | ✅ |
| `/pt/minha-lista`, `/listas`, `/listas/[id]` | ✅ | ✅ | ✅ | ❌ | — | ✅ |
| `/pt/historico`, `/tracker`, `/importar` | ✅ | ✅ | ✅ | ❌ | — | ✅ |
| `/pt/entrar`, `/criar-conta`, `/recuperar-senha`, `/redefinir-senha`, `/verificar-email` | ✅ | ✅ | n/a | n/a | — | ✅ E2E |
| `/filmes`, `/series` | 308 → `/pt/...` | n/a | n/a | n/a | — | ✅ |
| `/dev/ad-preview`, `/dev/movie-page-preview` | ✅ | mock | — | — | **dev-only, nao noindex-verificado nesta auditoria** | — |

### Achados de frontend

1. **Nenhum video em lugar nenhum.** `TmdbVideo` sincronizado, zero render.
2. **Honestidade e a norma, nao a excecao.** Onde falta backend, a UI **declara** em vez de
   simular (recomendacoes, trailer, provedores como texto por `logo_allowed=false`). Isso e
   qualidade, nao debito.
3. **Rotas `/dev/*` em `apps/web/app`** merecem confirmacao de que estao fora do sitemap e
   `noindex` em producao — **nao verificado nesta auditoria**.
4. **Nao ha rota de categoria nem de tag de noticia** — o portal editorial nao tem navegacao
   por assunto.

---

## ETAPA 15 — Producao e EasyPanel (esperado pelo repositorio)

| Servico | Dockerfile | Porta | Banco | Healthcheck | Implantado? | Falta |
| --- | --- | --- | --- | --- | --- | --- |
| `screen-app` | `Dockerfile` | 3000 | `screen-db` | `/api/health` | **NAO COMPROVADO** (usuario declara) | — |
| `screen-db` | servico PG | 5432 | — | — | **NAO COMPROVADO** | — |
| `cinerie-cms` | `Dockerfile.cms` | 3000 | `cinerie-cms-db` | `/healthz` + `/readyz` | **NAO COMPROVADO**; PR #93 sugere deploy real com incidente de secrets | storage persistente de upload |
| `cinerie-cms-db` | servico PG | 5432 | — | — | **NAO COMPROVADO** | — |
| `cinerie-publication-worker` | `Dockerfile.publication-worker` | 3003 | `screen-db` (Prisma) + CMS (HTTP) | `/healthz` + `/readyz` | **NAO IMPLANTADO** (`easypanel-deployment-checkpoint.md:1`: *"Nada foi implantado"*) | criar servico, service account `publication_projection`, `EDITORIAL_MEDIA_S3_*` |
| **`cinerie-catalog-worker`** | **NENHUM** | — | `screen-db` | — | **INEXISTENTE** | **criar Dockerfile + servico** |
| `apps/admin` | **NENHUM** | — | `screen-db` | `/health` | **INEXISTENTE como servico** | — |
| Redis | — | — | — | — | **INEXISTENTE** — nao ha dependencia de Redis em lugar nenhum | n/a |
| R2/S3 | n/a | — | — | — | **NAO COMPROVADO** | `EDITORIAL_MEDIA_S3_*` |
| Backups | `scripts/backup/*.sh` (validados no CI por `bash -n`) | — | — | — | **NAO COMPROVADO** | agendar + validar restore |

### O achado operacional decisivo

`docs/backend/catalog-operations.md:123-124` registra, com todas as letras:

> "as units se declaram 'ilustrativas' e **nunca foram instaladas** — o deploy e container
> EasyPanel, **sem systemd**."

E `docs/EASYPANEL_DEPLOY.md:106-116` descreve os servicos offline como *"tarefas agendadas
(scheduled task do EasyPanel, cron do host, ou systemd timer — a escolha depende de como o
VPS foi montado)"* — ou seja, **a escolha nunca foi feita**.

Resultado: `scripts/catalog/catalog-cycle-with-alert.sh` e um ciclo completo, com lock,
sentinela e alerta, **que nao tem processo que o dispare em producao**.

---

## ETAPA 16 — Testes e qualidade

| Camada | Comando | Cobertura | Observacao |
| --- | --- | --- | --- |
| Unitario/puro | `pnpm test` (Vitest) | 342 arquivos `*.test.ts` | maior parte |
| Governanca | `tests/governance/` | **33 arquivos** | invariantes travadas por teste |
| Auditoria de invariantes | `pnpm audit:invariants` | script proprio | CI |
| Pureza de render | `pnpm audit:render` | detecta `fetch(` para host externo em `apps/web` | CI |
| Cobertura de API | `pnpm api:coverage` | drift registry vs codigo | CI |
| Typecheck (5 alvos) | `typecheck`, `:catalog-runtime`, `:web`, `:admin`, `:cms` | inclui `bin/` e `persistence/` | CI |
| Integracao CMS (PG16 efemero) | `test:cms:integration` | Payload real | CI |
| Projecao editorial (2× PG16) | `test:publication-projection:integration` | dois bancos | CI |
| Midia editorial (2× PG16 + storage) | `test:editorial-media-projection:integration` | ✅ | CI |
| Caminho editorial humano | `test:manual-editorial:integration` | CMS sem MNScr | CI |
| **E2E painel (Playwright/Chromium)** | `test:manual-editorial:e2e` | ✅ | CI |
| **Canario CMS → pagina publica** | `test:manual-publication-projection:integration` | ✅ **prova ponta a ponta** | CI |
| Prontidao de deploy (CMS + worker) | `test:cms:deployment-readiness`, `test:publication-worker:deployment-readiness` | ✅ | CI |
| Validadores com PG16 descartavel | `validate:all` (movie/series/person/news/indexes) | ✅ | CI |
| Migrations cenario A (zero) e B (upgrade) | `db:validate:real`, `db:validate:upgrade` | ✅ | CI |
| Backup shell | `bash -n` no CI | sintaxe apenas | **restore real nunca executado** |

### Lacunas de teste

- **Nenhum teste cobre a projecao de `entity_news_links`** — porque a funcionalidade nao
  existe. O canario passa porque so verifica que a materia aparece, nao que ela esta ligada
  ao catalogo.
- **Nenhum teste cobre o render de `bodyBlocks`** — mesma razao.
- `services/ratings` e `services/streaming` tem testes proprios mas **zero teste de integracao
  com o produto** (nao ha produto).
- **Nenhum teste executado nesta sessao** — `node_modules` ausente.

---

## ETAPA 17 — Seguranca

| Frente | Estado | Evidencia |
| --- | --- | --- |
| Segredos so em env | `COMPLETO` | `grep process.env` mostra 33 vars, todas server-side; `.env` ausente do worktree |
| Segredo em build-arg | **evitado** | `Dockerfile.cms` + `docs/operations/cms-easypanel-runtime-secrets.md` (PR #93 — segredos lidos de arquivos em runtime) |
| API key nao-legivel apos criacao | `COMPLETO` | `collections.ts:271` — `access: { read: () => false }` no `apiKey`, **com teste de vazamento que pegou o bug** |
| Escopos minimos | `COMPLETO` | 3 escopos; lista vazia = revogacao sem apagar a conta |
| Fronteira do worker (nao toca banco do CMS) | `COMPLETO` | `tests/governance/editorial-worker-boundary.test.ts` — fecho transitivo de imports |
| Pureza de render (zero API externa) | `COMPLETO` | `audit:render` + `tests/governance/no-render-external-api.test.ts` |
| Zero Gemini no render | `COMPLETO` | `tests/governance/` + Entity Writer offline |
| `tmdb_raw` fora do render | `COMPLETO` | `tests/governance/tmdb-raw-not-in-render.test.ts` |
| CSRF | `COMPLETO` | rotas `/api/auth/**` |
| Throttle duravel | `COMPLETO` | `AuthThrottle:2057` + `CINERIE_IP_HASH_SALT` |
| Hash de IP (nunca IP bruto) | `COMPLETO` | comentario normativo em `schema.prisma:1727-1728` |
| Sessoes e tokens so em hash | `COMPLETO` | `UserSession`, `VerificationToken` |
| Uploads (MIME allowlist + sniff de bytes) | `COMPLETO` | `media-validation.ts` — sniff real, nao confia no header |
| Protecao do admin | `COMPLETO` | `ADMIN_PROTECTION_ENABLED` + basic auth, posture `blocked-missing-credentials` |
| Acoes editoriais do admin | gateadas | `ADMIN_EDITORIAL_ACTIONS_ENABLED` (default off) |
| Anti-pirataria | `COMPLETO` | `tests/governance/no-fake-streaming-in-ui.test.ts` |
| Bytes de controle em arquivo | travado | `tests/governance/no-raw-control-bytes.test.ts` |
| **SSRF** | **NAO AVALIADO** | nao ha fetch de URL fornecida por usuario hoje; **vira risco real quando a importacao de imagem por URL existir** |
| **XSS / HTML livre** | **PARCIAL** | o corpo e texto/blocos estruturados, nao HTML livre; `serializeJsonLd` e testado (`json-ld-safe-serialization.test.ts`). Ao renderizar `bodyBlocks`, revalidar. |
| CORS / rate limiting nos endpoints `/internal/*` do CMS | **NAO AVALIADO** nesta auditoria | — |

Nenhum valor secreto foi lido ou impresso.

---

## Riscos criticos (ordenados)

| # | Risco | Severidade | Evidencia |
| --- | --- | --- | --- |
| 1 | **Noticia publicada chega ao site sem nenhum vinculo de catalogo.** Card, relacionadas e destaques da home ficam vazios em producao, silenciosamente. | **CRITICO** | `publication.ts:308` emite `entities`; nenhum leitor em `services/news-ingestion`; unico escritor de `entity_news_links` e um script de QA |
| 2 | **Corpo estruturado projetado e nunca renderizado.** Imagem inline, video, factBox e sourceList somem entre o CMS e a pagina. | **CRITICO** | `grep bodyBlocks apps/web` → vazio |
| 3 | **Catalogo nao tem execucao continua em producao.** O ciclo existe; o agendador declarado nunca foi instalado e e incompativel com o deploy em container. | **CRITICO** | `docs/backend/catalog-operations.md:123-124` |
| 4 | **Worker de projecao nao implantado.** Sem ele o Payload publica internamente e nada aparece no site. | **ALTO** | `docs/operations/easypanel-deployment-checkpoint.md:1` |
| 5 | **`entityId` no CMS e texto livre sem validacao.** Um digito errado grava um vinculo para uma entidade inexistente, sem erro. | **ALTO** | `collections.ts:606` |
| 6 | **`entityKind` oferece `character` e `franchise` que o lado publico nao resolve.** | **MEDIO** | `collections.ts:180` vs schema sem model `Character` e `Collection` sem slug |
| 7 | **Sem WebP/derivados.** Imagem editorial servida no formato original, sem tamanhos responsivos — custo de LCP e banda. | **MEDIO** | `collections.ts:411-422` |
| 8 | **Ratings sao codigo sem operacao.** IMDb via agregador de terceiro, RT inexistente. O Cinerie Score depende deles e portanto nao tem insumo. | **MEDIO** | grep de consumidores retorna vazio |
| 9 | **Taxonomia inexistente.** Categoria e texto livre; tags nao existem. Sem navegacao por assunto e sem sinal de secao para SEO. | **MEDIO** | `schema.prisma:1569`; nenhum model de tag |
| 10 | **Zero observabilidade de busca/trafego.** Sem GSC e sem GA4 nao ha como medir se qualquer coisa acima funcionou. | **MEDIO** | grep retorna zero |
| 11 | **Restore de backup nunca executado.** O CI valida sintaxe do shell, nao o restore. | **MEDIO** | `.github/workflows/ci.yml:38-45` |
| 12 | **Rotas `/dev/*` em `apps/web/app`** — confirmar exclusao de sitemap e `noindex`. | **BAIXO** | nao verificado |
| 13 | **ADR 0014 referenciada no schema mas ausente** de `docs/adr/`. | **BAIXO** | `schema.prisma:1704` vs `ls docs/adr` |

---

## Confirmacao final

Nesta sessao **nao** houve: alteracao de codigo, criacao ou execucao de migration, commit,
push, PR, merge, deploy, acesso ao EasyPanel, conexao com qualquer banco, chamada a API
externa, leitura ou impressao de segredo, checkout ou troca de branch.

Os unicos arquivos criados sao os quatro documentos em `docs/audits/`.
