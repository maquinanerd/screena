# Auditoria 360 da plataforma antes do reset visual público

> **⚠️ Documento HISTÓRICO — marca anterior (Gate 1.5, 2026-07).**
> Este relatório é um SNAPSHOT de um estado passado do projeto e usa a marca
> e o domínio anteriores (**Screen** / **The Screen**, `thescreen.media`).
> O texto **não** foi reescrito para Cinerie de propósito: ele registra
> achados *sobre* a marca antiga e traz datas, branches e commits de então —
> trocar a marca no corpo falsificaria o registro e tornaria os achados
> incoerentes. A marca pública atual é **Cinerie** (`https://cinerie.com`);
> a fonte viva é [`CLAUDE.md`](../CLAUDE.md) e
> [`REBRANDING-CINERIE.md`](../REBRANDING-CINERIE.md).
>
> **Achados de ESTADO tambem estao superados (2026-07-28).** Este snapshot afirma que
> `services/news-ingestion` e "apenas um README", sem `package.json` e sem codigo. Isso era
> verdade na data da auditoria e **deixou de ser** com o Prompt 10 (commit `812417a`): hoje o
> pacote e um workspace ativo, com nucleo puro, adapters Prisma, CLI e testes. As afirmacoes
> historicas nao foram reescritas de proposito (falsificariam o registro). O estado vivo esta em
> [`CLAUDE.md`](../CLAUDE.md), [`docs/editorial/README.md`](./editorial/README.md) e
> [`docs/adr/0015-editorial-boundaries.md`](./adr/0015-editorial-boundaries.md).

> Snapshot auditado: `origin/main` em `df0a89c` (`feat(web): port canonical cinematic frontend exactly (#61)`), em 14/07/2026.
>
> Branch de trabalho: `chore/audit-and-reset-public-design`, criada diretamente de `origin/main` em worktree isolado. A PR #60 (`feat/public-frontend-final-polish`) continua aberta como draft, com merge state `DIRTY`; ela não foi usada, alterada ou mergeada.
>
> Escopo desta fase: leitura de código, schema, testes, scripts, documentação e histórico Git/GitHub. Nenhum banco foi consultado, nenhuma migration foi executada, nenhuma API externa foi chamada e nenhum dado foi promovido/publicado.

## 1. Resumo executivo

O produto não é apenas um frontend. O repositório contém uma plataforma entity-first com:

- catálogo de filmes, séries, temporadas, episódios e pessoas no PostgreSQL;
- Prisma, migrations e seeds;
- slugs canônicos e redirects;
- ingestão TMDB offline, tanto pelo fluxo direto quanto por um piloto raw;
- cache e logs de sincronização;
- Entity Writer offline com Gemini, payload controlado, hashes e revisão;
- clientes e serviços offline para ratings e streaming via RapidAPI;
- promoção humana de `watch_availability` e leitura pública fail-closed;
- notícias editoriais persistidas e render público, mas sem ingestão RSS funcional;
- rotas públicas, metadata, canonical, robots, sitemap e JSON-LD;
- admin protegido, com leitura e algumas ações editoriais gateadas;
- testes de domínio, governança, render, presenters, serviços e deploy.

O reset desta PR pode apagar somente a composição visual. Não pode apagar nem reescrever banco, APIs, serviços, getters, presenters, rotas, SEO, licenças ou contratos de dados.

Estado resumido por capacidade:

| Capacidade | Estado comprovado no código | Observação |
| --- | --- | --- |
| Monorepo, TypeScript, Next, Prisma | Funcional | pnpm 9.15.4; Node exigido `>=22 <23` |
| Catálogo TMDB | Funcional/parcial | Fluxo direto operacional; fluxo raw ainda é piloto |
| Rotas públicas entity-first | Funcional | Dependem de PostgreSQL em runtime |
| SEO técnico | Funcional com gaps | Canonical/robots/schema existem; decisões persistidas não são a fonte efetiva do render |
| Entity Writer | Funcional/parcial | Offline; movie/tv; dois tipos de bloco; riscos operacionais documentados abaixo |
| Ratings externos | Pipeline offline parcial | Sem licenciamento/promoção e sem superfície pública |
| Streaming | Pipeline + promoção + leitura parcial | Fail-closed na ingestão; há gap crítico de atribuição/licença na promoção pública |
| Notícias | Models, admin e render | Sem RSSPRIME/MN26 funcional |
| Admin | Parcial, não estritamente read-only | Escrita editorial existe atrás de flag e autenticação |
| Workers Python | Inativo/scaffold | Implementações reais atuais são majoritariamente TS/Node |
| Deploy | Parcial e divergente | EasyPanel/Nixpacks nos docs; Dockerfile real no repo; operação externa não verificada |

## 2. Arquitetura geral

### 2.1 Monorepo

`pnpm-workspace.yaml` inclui:

- `apps/*`;
- `packages/*`;
- `api-clients/*`;
- `services/*`.

`workers/` não é workspace pnpm; contém scaffolds Python 3.12.

### 2.2 Apps

| Caminho | Papel | Estado |
| --- | --- | --- |
| `apps/web` | Next.js App Router público; RSC; leitura server-only do PostgreSQL | Funcional |
| `apps/admin` | Diagnóstico, revisão e ações editoriais protegidas | Parcial; possui escrita gateada |

### 2.3 Packages

| Pacote | Papel | Pode ser tocado no reset? |
| --- | --- | --- |
| `@screena/config` | Invariantes, escalas, idiomas e env tipado | Não |
| `@screena/db` | Prisma, migrations, seed e client server-only | Não |
| `@screena/schemas` | Ratings e contrato/validação do Entity Writer | Não |
| `@screena/seo` | Indexabilidade, value blocks e schema.org | Não |
| `@screena/types` | Tipos compartilhados | Não |
| `@screena/ui` | Tokens e resolução semântica de vertical | Não; é contrato das invariantes 9–11 |

### 2.4 Serviços e clientes

| Área | Implementação | Estado |
| --- | --- | --- |
| TMDB | `api-clients/tmdb`, `services/ingestion`, `services/sync` | Real |
| RapidAPI comum | `api-clients/rapidapi-core` | Real |
| Film Show Ratings | client + `services/ratings` | Real como piloto offline |
| Streaming Availability | client + `services/streaming` | Real como piloto offline + promoção |
| Gemini/Entity Writer | `services/entity-writer` | Real/parcial |
| News ingestion | `services/news-ingestion/README.md` | Não implementado |
| IMDb/Kaso/Rotten Tomatoes | apenas READMEs | Contrato/roadmap |

### 2.5 Testes, auditorias e CI

- Vitest cobre `tests/governance`, `tests/web`, `tests/admin` e testes locais de clients/services/packages.
- `scripts/audit/check-invariants.mjs` faz smoke textual de invariantes e padrões proibidos.
- `scripts/audit/check-render-purity.mjs` fiscaliza a separação de render público.
- `.github/workflows/ci.yml` instala dependências, gera Prisma Client e roda typecheck, lint, test, auditorias e build.
- A CI também valida a sintaxe dos scripts de backup.

## 3. Rotas públicas antes do reset

### 3.1 Matriz principal

| Rota | Arquivo | Dados / getter | SEO e JSON-LD | H1 / estado atual | Reset seguro |
| --- | --- | --- | --- | --- | --- |
| `/` | `apps/web/middleware.ts` | Nenhum DB; `root-locale.ts` | 307 para locale publicado | Não renderiza página | Preservar redirect |
| `/pt/` | `apps/web/app/pt/page.tsx` | catálogo, notícias, hero e upcoming do PostgreSQL | canonical `/pt/`, robots calculado, `Organization` + `WebSite` | 1 H1 oculto; home cinematográfica | H1 visível e listas textuais reais; preservar cálculo e schemas |
| `/pt/filmes/` | `apps/web/app/pt/filmes/page.tsx` | `getMovieIndexData`, upcoming e notícias | canonical, robots, `CollectionPage` + `BreadcrumbList` via `CategoryHome` | 1 H1; hoje não mostra a lista usada no gate | Trocar por `EntityIndex` textual com `view` real |
| `/pt/filmes/[slug]/` | `apps/web/app/pt/filmes/[slug]/page.tsx` | `getMoviePageData`: movie, slug, tradução, blocks, cast, watch, notícias, IDs | `Movie` + `BreadcrumbList`, canonical, robots, `sameAs` | 1 H1 e badge Filme | Remover mídia/chrome; manter toda informação textual e gates |
| `/pt/series/` | `apps/web/app/pt/series/page.tsx` | `getSeriesIndexData`, upcoming e notícias | canonical, robots, `CollectionPage` + `BreadcrumbList` | 1 H1; hoje não mostra a lista usada no gate | Trocar por `EntityIndex` textual com `view` real |
| `/pt/series/[slug]/` | `apps/web/app/pt/series/[slug]/page.tsx` | `getSeriesPageData`: show, seasons, episodes, blocks, cast, watch, notícias, IDs | `TVSeries` + `BreadcrumbList`, canonical limpo mesmo com query | 1 H1 e badge Série | Manter seleção `?temporada=`, anchors e listas textuais |
| `/pt/pessoas/` | `apps/web/app/pt/pessoas/page.tsx` | `getPersonIndexData` | canonical, robots, `CollectionPage` + `BreadcrumbList` | 1 H1; lista real | Neutralizar `EntityIndex` |
| `/pt/pessoas/[slug]/` | `apps/web/app/pt/pessoas/[slug]/page.tsx` | `getPersonPageData`: pessoa, blocks, créditos, notícias, IDs | `Person` + `BreadcrumbList`, canonical, robots, `sameAs` | 1 H1 | Remover retrato/chrome; manter bio, créditos e IDs |
| `/pt/noticias/` | `apps/web/app/pt/noticias/page.tsx` | `getNewsIndexData` | canonical, robots, `CollectionPage` + `BreadcrumbList` | 1 H1 oculto; magazine visual | H1 visível e lista textual real |
| `/pt/noticias/[slug]/` | `apps/web/app/pt/noticias/[slug]/page.tsx` | `getNewsArticleData` | `NewsArticle` + `BreadcrumbList`, canonical e robots | 1 H1 | Manter corpo, autoria, fonte, aviso de IA e estado |
| `/pt/explorar/` | `apps/web/app/pt/explorar/page.tsx` | `getHomeUpcomingMovies` + `takeUpcomingWeek` | canonical, robots, `CollectionPage` + `BreadcrumbList` | 1 H1; cards/ads | Links reais, contagens/lista textual e empty state |
| `/sitemap.xml` | `apps/web/app/sitemap.ts` | `getSitemapEntries` (PostgreSQL; fallback estático em erro) | MetadataRoute.Sitemap | N/A | Não tocar |
| `/robots.txt` | `apps/web/app/robots.ts` | puro; env | libera apenas origem oficial + flag; staging/dev bloqueados | N/A | Não tocar |

### 3.2 Rotas adicionais

- `/filmes/` e `/series/` usam `permanentRedirect` para as rotas localizadas.
- `/en/*` e `/es/*` não têm páginas públicas; não há fallback silencioso de idioma.
- Temporadas/episódios não têm rotas próprias; vivem dentro de `/pt/series/[slug]/`.
- `/dev/movie-page-preview/` é preview estático `noindex` com conteúdo fictício. A rota será preservada, mas reduzida a uma página técnica mínima, sem ficha ou JSON-LD fictício.

### 3.3 Pureza do render

Todos os getters públicos ficam em `apps/web/src/server/**` e usam `@screena/db/server`. A inspeção encontrou zero client TMDB/RapidAPI/Gemini no caminho de render. Imagens podem apontar ao CDN do TMDB, mas nenhum fetch de API ocorre no servidor durante o render.

Auditorias executadas antes de qualquer alteração:

- `corepack pnpm audit:invariants` — passou;
- `corepack pnpm audit:render` — passou.

O ambiente local está em Node 24.14.0 e emitiu warning, pois o repo exige Node 22. Isso será registrado em todas as validações.

## 4. Banco e Prisma

Nenhum schema, migration ou dado será alterado nesta PR.

### 4.1 Modelos de referência e governança

| Modelo/tabela | Finalidade | Escrita | Leitura/front | Criticidade |
| --- | --- | --- | --- | --- |
| `Language` / `languages` | locales e publicação | seed/admin futuro | relações e gates | Crítica para i18n/SEO |
| `Country` / `countries` | países ISO | seed | watch availability | Crítica para streaming |
| `RatingSource` / `rating_sources` | fonte editorial e escala | seed/governança | ratings | Crítica; IMDb ≠ RT |
| `ApiProvider` / `api_providers` | fornecedor técnico | seed/services | cache/log/ratings | Crítica; provider ≠ source |
| `SourceLicense` / `source_licenses` | direitos e atribuição | decisão humana | gates de exibição | Não alterar sem revisão humana |

### 4.2 Catálogo e identidade

| Modelo/tabela | Finalidade | Escrita | Leitura/front | Reset |
| --- | --- | --- | --- | --- |
| `Movie` / `movies` | filme e snapshot TMDB; certification; Screen Score próprio | ingestão/seed | home, índices e ficha | Preservar |
| `TvShow` / `tv_shows` | série e snapshot TMDB | ingestão/seed | índices e ficha | Preservar |
| `Season` / `seasons` | temporadas | ingestão | ficha de série | Preservar |
| `Episode` / `episodes` | episódios; season number derivado por FK | ingestão | ficha de série | Preservar |
| `Person` / `people` | pessoas e gate de biografia | ingestão | índice/ficha/cast | Preservar |
| `CastMember` / `cast_members` | créditos de elenco | ingestão | fichas | Preservar |
| `CrewMember` / `crew_members` | créditos de equipe | ingestão | direção/filmografia | Preservar |
| `EntityExternalId` / `entity_external_ids` | IDs/URLs TMDB, IMDb etc. | ingestão | `sameAs`, links, matching offline | Preservar |
| `Slug` / `slugs` | URL por tipo/idioma e canonicidade | ingestão/editorial | rotas, canonical, sitemap | Preservar |
| `Redirect` / `redirects` | histórico 301 | ingestão/editorial | ainda não é lido diretamente no render | Preservar |
| `EntityTranslation` / `entity_translations` | título, meta, resumo, estado por idioma | ingestão/admin/editorial | rotas públicas | Preservar |

### 4.3 Editorial, ratings, streaming e SEO

| Modelo/tabela | Finalidade | Escrita | Leitura/front | Reset |
| --- | --- | --- | --- | --- |
| `ContentBlock` / `content_blocks` | texto versionado/revisável | Entity Writer/admin | fichas | Preservar |
| `EntityWriterJob` / `entity_writer_jobs` | fila de geração | Entity Writer | admin/inspect | Preservar |
| `EntityWriterLog` / `entity_writer_logs` | trilha técnica do writer | Entity Writer | inspect/admin | Preservar |
| `ExternalRating` / `external_ratings` | notas externas atribuídas | ratings service | não aparece no front atual | Preservar |
| `WatchAvailability` / `watch_availability` | ofertas legais por país | streaming sync/promotion | fichas movie/tv quando permitidas | Preservar |
| `PageIndexabilityDecision` / `page_indexability_decisions` | decisão persistida de SEO | pipeline/editorial | hoje não é fonte efetiva do render | Preservar; gap documentado |
| `ApiCache` / `api_cache` | payload bruto/cache | clients/services | workers; não como UI crua | Preservar |
| `ApiSyncLog` / `api_sync_logs` | auditoria de sincronização | clients/services | operação/admin | Preservar |
| `TmdbRaw` / `tmdb_raw` | payload permanente do piloto raw | raw sync | raw promotion | Preservar |
| `TmdbImageConfig` / `tmdb_image_config` | config de imagens TMDB | raw sync | workers | Preservar |
| `Article` / `articles` | fatos/licença de notícia | admin/validadores; sem ingestor real | notícias | Preservar |
| `ArticleTranslation` / `article_translations` | texto/status/slug por idioma | admin/validadores | notícias | Preservar |
| `EntityNewsLink` / `entity_news_links` | relação notícia-entidade | admin/validadores | relacionadas | Preservar |

### 4.4 Integridade e gaps do schema

Pontos fortes:

- `Episode` usa FK composta com `Season` para coerência de série/temporada.
- `ExternalRating` materializa `rating_source` e `provider_api` em tabelas distintas.
- Defaults de licença/exibição são fail-closed.
- Migrations adicionam constraints para redirects, preço/moeda, conteúdo AI e índices parciais.

Gaps conhecidos, fora do escopo deste reset:

- referências polimórficas não têm FK para a entidade-alvo;
- `PageIndexabilityDecision` não é único por entidade/idioma;
- `WatchAvailability` não tem chave natural única nem colunas próprias de licença/atribuição;
- `SourceLicense` não tem FK real para source/provider;
- algumas faixas/escala/licença dependem da aplicação e testes;
- comentários/defaults históricos ainda citam a política anti-thin antiga;
- `Article.category` e `authorName` são texto livre;
- `news_clusters`, `platforms` e `providers` citados em documentação não existem no Prisma atual.

## 5. APIs e provedores

### 5.1 Matriz

| Provider | Client/adapter | Comandos | Persistência | Front atual | Status |
| --- | --- | --- | --- | --- | --- |
| TMDB | `api-clients/tmdb`; `services/ingestion` | import, catálogo, discovery, raw sync/promotion, sync | `api_cache`, `api_sync_logs`, `tmdb_raw`, catálogo, slugs/créditos | sim, via tabelas normalizadas | Funcional/parcial |
| Film Show Ratings (RapidAPI) | `api-clients/film_show_ratings`; `services/ratings` | `sync-film-show-ratings.ts` | cache/log + `external_ratings` fail-closed | não | Piloto funcional |
| Streaming Availability (RapidAPI) | client + `services/streaming` | sync, review, promote/revoke | cache/log + `watch_availability` | sim quando `display_allowed=true` | Parcial |
| Gemini | `services/entity-writer/src/gemini` | enqueue, inspect, fake/offline, run/smoke | jobs, logs, blocks | blocks revisados são lidos | Parcial |
| RSSPRIME/MN26 | README/stub Python | nenhum fluxo real | nenhuma ingestão real | notícias apenas se já persistidas | Não implementado |
| IMDb/Kaso/RT direto | READMEs | nenhum | nenhuma | nenhuma | Contrato/roadmap |

### 5.2 Variáveis de ambiente conhecidas

Sem imprimir valores:

- banco/SEO: `DATABASE_URL`, `THE_SCREEN_PUBLIC_SITE_URL`, `THE_SCREEN_PUBLIC_INDEXING_ENABLED`;
- TMDB: `TMDB_READ_ACCESS_TOKEN`, `TMDB_API_KEY`, `TMDB_API_BASE_URL`, `TMDB_DEFAULT_LANGUAGE`, limites/retries/breaker/cache;
- Gemini: `GEMINI_API_KEY`, `GEMINI_MODEL`, base URL e limites/retries/breaker;
- ratings: `RAPIDAPI_FILM_SHOW_RATINGS_KEY` e opções de host/base URL/TTL/limites;
- streaming: `RAPIDAPI_STREAMING_AVAILABILITY_KEY` e opções de host/base URL/TTL/limites;
- admin: `ADMIN_PROTECTION_ENABLED`, `ADMIN_BASIC_AUTH_USER`, `ADMIN_BASIC_AUTH_PASSWORD`, `ADMIN_EDITORIAL_ACTIONS_ENABLED`;
- operação: `BACKUP_DIR`, `BACKUP_PREFIX`, `BACKUP_OFFSITE_RCLONE_REMOTE`, URLs de restore-test.

O `.env.example` está desalinhado: documenta `SCREENA_RATINGS_PROVIDER_KEY`, `SCREENA_STREAMING_PROVIDER_KEY` e Redis, mas os clients reais usam os nomes RapidAPI acima e não há uso real de Redis. Também faltam variáveis do admin e opções dos pilotos.

### 5.3 Segurança e resiliência

- Chaves ficam em env vars e headers/query do worker, nunca no frontend.
- TMDB e RapidAPI possuem retry/backoff, rate limit e circuit breaker.
- Cache e logs são persistidos por chamada nos fluxos principais.
- O client TMDB não possui timeout HTTP explícito.
- `discover-ids` faz rede mesmo sem `--apply`; “dry-run” não tem significado uniforme entre CLIs.

## 6. Streaming / onde assistir

Fluxo atual:

1. `sync-streaming-availability.ts` seleciona entidades com IMDb ID persistido.
2. Chama a Streaming Availability API offline.
3. Lê apenas `streamingOptions.br`, mapeia modalidades legais e recusa links/tipos inseguros.
4. Grava `api_cache`, `api_sync_logs` e `watch_availability` com `display_allowed=false`.
5. `review-watch-availability.ts` lista candidatas sem mutação.
6. `promote-watch-availability.ts --ids=... --confirm` ou `--revoke` altera somente ofertas explícitas.
7. O render consulta somente PostgreSQL e filtra `provider_api=streaming_availability`, país BR, `display_allowed=true` e validade.
8. O presenter reaplica filtros, deduplica e expõe links legais; o painel sai com `nofollow sponsored noopener`.

O que está validado no repositório:

- fixture sanitizada realista de Titanic cobre assinatura, grátis, aluguel, compra, addon descartado e país não-BR descartado;
- testes provam ingestão fail-closed, promoção por IDs, zero rede na promoção e gate duplo no front;
- testes de A Origem/Inception cobrem normalização e slug canônico (`/pt/filmes/a-origem/`), não uma promoção real de streaming.

O que não foi comprovado nesta auditoria:

- estado atual de `watch_availability` em produção;
- promoção real de A Origem/Inception;
- execução live de RapidAPI;
- licença/atribuição aprovada por humano.

Gap crítico: o provider declara atribuição obrigatória à Streaming Availability API/Movie of the Night, mas o modelo, os guardrails de promoção e o painel não garantem/renderizam essa atribuição. Portanto, nenhuma oferta deve ser promovida por esta tarefa. O próximo sync também recria as rows como `display_allowed=false`, exigindo nova revisão.

## 7. Ratings

Existem três conceitos separados:

1. `external_ratings`: notas de IMDb/RT/Metacritic/Letterboxd/FilmAffinity, com fonte editorial, escala, fornecedor técnico, licença e gate.
2. `screen_score`: nota editorial própria do Screen, escala 5, com `screen_score_display` fail-closed.
3. `vote_average_tmdb`: sinal técnico do TMDB; nunca nota editorial.

Estado atual:

- o client Film Show Ratings e o serviço offline são reais;
- o mapper valida fonte, label e escala, recusando TMDB como rating editorial;
- a persistência força `display_allowed=false`, `license_status=unknown` e atribuição vazia;
- o serviço ainda não cruza `source_licenses`, não possui promoção/licenciamento operacional e pode rebloquear uma linha antes aprovada ao atualizar;
- `apps/web` não lê `external_ratings`;
- nenhuma `AggregateRating` externa é emitida;
- Screen Score só aparece quando a origem editorial e o gate próprio permitem; o reset visual não deve transformá-lo em nota externa nem inventar valor.

## 8. Entity Writer, admin e notícias

### 8.1 Entity Writer

- roda offline em TS/Node + Prisma;
- usa payload do PostgreSQL e gera atualmente `editorial_intro` e `cast_intro` para movie/tv;
- registra prompt/model/hashes/warnings/status;
- saída automática não nasce publicada;
- validação anti-alucinação é heurística e cobre principalmente nomes próprios;
- não há reclaim robusto de jobs presos, transação única para todo o ciclo ou teto efetivo de tentativas;
- `bin/run-offline.ts` exige confirmação live, mas `bin/run.ts` usa Gemini real por padrão se não receber flags seguras;
- logs do writer vivem em `entity_writer_logs`, não em `api_sync_logs`.

### 8.2 Admin

Apesar de documentação que ainda diz “read-only”, existem ações reais atrás de autenticação e `ADMIN_EDITORIAL_ACTIONS_ENABLED=true`:

- alteração de `ArticleTranslation.reviewStatus/indexStatus`;
- alteração de `ContentBlock.reviewStatus`;
- lote de até 20 itens.

Riscos fora do reset:

- a allowlist inclui `published`/`human_reviewed`;
- blocos ficam públicos pelo `reviewStatus` mesmo sem `publishedAt`;
- não existe trilha editorial completa de ator/antes/depois;
- Basic Auth compartilhado não identifica revisor;
- bulk update não é transacional.

### 8.3 Notícias

- models, getters, presenters, rotas e ligações com entidades são reais;
- publicação exige review/status, licença, `display_allowed` e data;
- RSSPRIME/MN26 não têm implementação de ingestão;
- não há writer de produto para criar artigos fora de admin/validadores;
- o gate de notícia não verifica de forma completa `requiresAttribution`/`requiresLinkback`;
- notícia que exige linkback pode ter a fonte omitida.

## 9. SEO técnico

### 9.1 Preservado e funcional

- domínio canônico configurável, com fallback oficial `https://thescreen.media`;
- canonical absoluto por rota;
- metadata e robots calculados;
- robots fail-closed fora da origem oficial com opt-in explícito;
- slugs por idioma e redirect de slug antigo nas fichas;
- JSON-LD correto por tipo: `Movie`, `TVSeries`, `Person`, `NewsArticle`, `CollectionPage`, `Organization`, `WebSite` e `BreadcrumbList`;
- nenhum `AggregateRating`, `Review` ou `FAQPage` fabricado;
- `sameAs` só com IDs persistidos;
- filme/série distinguem-se por label/badge, breadcrumb, schema e URL nas fichas;
- render sem API/Gemini.

### 9.2 Gaps encontrados, não corrigidos pelo reset

1. `page_indexability_decisions` e estados persistidos de tradução não são a fonte efetiva de páginas/sitemap; o runtime recalcula um estado simplificado.
2. `stale`/`blocked` persistidos podem não alcançar HTML/sitemap.
3. `/pt/explorar/` decide robots com lançamentos da semana, enquanto o sitemap considera catálogo geral.
4. Em falha de banco, o sitemap retorna rotas estáticas que podem divergir do meta robots.
5. Existe apenas `/sitemap.xml`, não sitemap index segmentado por idioma.
6. Redirect persistido como 301 não é lido diretamente; `permanentRedirect` do Next responde 308.
7. JSON-LD usa `JSON.stringify` direto em HTML, sem serializador central HTML-safe.
8. O gate de atribuição/linkback de notícias é incompleto.
9. Não existem rotas próprias de temporada/episódio.

Esses itens envolvem indexabilidade, schema, licença ou arquitetura. Permanecem documentados para PR específica e revisão humana; não serão alterados junto ao reset visual.

## 10. Testes e auditorias

### 10.1 Gates obrigatórios do repo

- `corepack pnpm typecheck`;
- `corepack pnpm lint`;
- `corepack pnpm test`;
- `corepack pnpm audit:invariants`;
- `corepack pnpm audit:render`;
- `corepack pnpm --filter @screena/web build`.

### 10.2 Cobertura relevante

- governança de ratings, escalas e separação provider/source;
- pureza de render e isolamento de TMDB raw/RapidAPI;
- indexabilidade e idiomas publicados;
- schema safe defaults e diferenciação vertical;
- fake streaming e UI honesta;
- redirects e URLs canônicas;
- robots e sitemap presenters;
- movie/series/person/news presenters e getters com PostgreSQL efêmero;
- watch availability mapping, sync, promoção, presenter e painel;
- Entity Writer, jobs, persistência, validação e fake Gemini;
- admin auth, políticas, ações e ausência de segredo.

### 10.3 Limites dos auditores

`audit:invariants` é um smoke textual/padrões; `audit:render` fiscaliza layering/imports, não equivalência semântica entre banco, robots, sitemap e HTML. Testes completos e validações com PostgreSQL efêmero continuam necessários.

## 11. Deploy e operação

### 11.1 Estado documentado

- `docs/EASYPANEL_DEPLOY.md` declara EasyPanel + Nixpacks como caminho ativo.
- `docs/CLOUDPANEL_DEPLOY.md` é referência histórica/alternativa com PM2/systemd.
- `Dockerfile` real agora instala, gera Prisma, builda e executa migration + Next.
- a configuração real de produção não foi acessada nesta auditoria.

### 11.2 Divergências e riscos

- o guia Nixpacks manda iniciar saída `standalone`, mas `next.config.ts` não habilita `output: "standalone"`;
- o Dockerfile não está refletido no guia ativo;
- imagem single-stage roda como root, mantém dev dependencies e não tem `HEALTHCHECK`;
- migration roda implicitamente em todo start, enquanto o guia a trata como release step;
- build args defaultam para domínio oficial e indexação habilitada; um staging sem override pode nascer indexável porque `robots.txt` é estático no build;
- units reais systemd são antigas e cobrem apenas TMDB;
- automação de ratings/streaming/RSS/Entity Writer não está comprovada em produção;
- backups possuem guards, checksum, off-site opcional e restore-test, mas agendamento/restore real não foi verificado.

### 11.3 Smoke e comandos

Relativamente seguros/local-only:

- typecheck, lint, test, auditorias e build;
- validadores com PostgreSQL efêmero;
- Entity Writer `inspect`;
- revisão read-only de watch availability;
- diagnósticos do admin.

Com rede ou mutação e proibidos nesta tarefa:

- Prisma migrate/seed contra qualquer DB não efêmero;
- import/sync TMDB direto;
- discovery `--apply`, raw sync/promotion `--apply`, catálogo `--apply`/download;
- ratings/streaming `--sample` ou `--apply`;
- streaming promotion `--confirm`;
- Gemini smoke/run live, enqueue/apply;
- admin seeds e ações editoriais;
- restore contra DB não descartável.

## 12. Inventário da camada visual a zerar

### 12.1 CSS visual a remover

- `apps/web/app/_components/category-home.module.css`;
- `apps/web/app/pt/explorar/explore-canonical.module.css`;
- `apps/web/app/pt/filmes/[slug]/movie-canonical.module.css`;
- `apps/web/app/pt/series/[slug]/series-canonical.module.css`;
- `apps/web/app/pt/pessoas/[slug]/person-canonical.module.css`;
- `apps/web/app/pt/noticias/news-canonical.module.css`;
- `apps/web/app/pt/noticias/[slug]/article-canonical.module.css`.

`apps/web/app/globals.css` será reduzido de 4.263 linhas a reset básico, Montserrat local, branco/preto, links, foco, skip link, visually-hidden, container, header/footer e listas.

### 12.2 Componentes puramente visuais a remover

- `ad-slot.tsx`;
- `category-home.tsx`;
- `hero-carousel.tsx`;
- `coming-soon-rail.tsx`;
- `screen-logo.tsx`;
- `rating-stars.tsx`;
- `certification-badge.tsx`;
- `cast-strip.tsx`;
- `news-card.tsx`;
- `related-news-section.tsx`;
- `entity-card.tsx`;
- conteúdo fictício e composição cinematográfica de `/dev/movie-page-preview/` (a rota continua viva como shell técnico `noindex`);
- `canonical-ad-inventory.ts`;
- `canonical-image-inventory.ts`;
- `home-placeholder-governance.ts`;
- helper `isCinematicHeroPath`.

### 12.3 Componentes a neutralizar/preservar

- header: marca textual `Screen` e links reais para Filmes, Séries, Pessoas, Notícias e Explorar;
- footer: marca, links reais e atribuição TMDB;
- `EntityIndex`: H1, descrição, breadcrumb, lista textual e JSON-LD;
- `EntityExternalIds`: links governados sem ícones decorativos;
- `WatchAvailabilityPanel`: grupos, gates, links legais e carimbo de atualização;
- `EntityFacts`: `<dl>` simples;
- páginas: metadata, canonical, robots, H1, JSON-LD, getters e conteúdo real.

### 12.4 Itens que permanecem dormentes

- `packages/ui` e tokens `--screena-*`, pois são contratos de governança, embora não sejam aplicados ao shell branco;
- Montserrat e licença OFL;
- `screen-logo-black.svg`, referenciado pelo JSON-LD da home;
- demais SVGs de marca, sem render ativo;
- mídia demo e gerador, pois são fixtures referenciadas por seeds e não serão renderizadas como placeholders;
- presenters de hero/upcoming e getters server-only, ainda que deixem de ter consumidor visual.

### 12.5 Testes visuais afetados

Os testes que exigem hero, ads, grids, CSS modules e geometria do pacote canônico serão removidos ou reescritos como contrato do shell branco. Testes de presenters, SEO, redirects, ratings, streaming, banco, admin, render e governança permanecem.

## 13. Limite exato da Fase 2

A próxima alteração desta branch deve:

- tocar apenas `apps/web` visual e testes de contrato visual;
- renderizar fundo branco, texto preto, navegação/listas simples e empty states honestos;
- manter um H1 por página;
- preservar metadata, canonical, robots, JSON-LD e redirects;
- manter dados reais, blocos revisados, watch gateado, cast/créditos e links externos;
- não usar hero, cards, posters, backdrops, rails, ads, sombras, gradientes, animações, newsletter, social fake ou affordance inexistente;
- não chamar API, banco de produção ou Gemini;
- não alterar schema, migration, licença, indexabilidade persistida, publicação ou dados.

## 14. Decisões explícitas

- A marca textual do shell será **Screen**, conforme `CLAUDE.md`. “cinerie” não será introduzido.
- A PR #60 permanece congelada e fora da base.
- A PR #61 já está em `main`; esta branch remove apenas sua camada visual ativa, preservando getters/presenters e as capacidades do produto.
- Gaps críticos de SEO, licença, streaming, admin e deploy são registrados aqui, mas não misturados ao reset visual.
- Nenhum pacote visual será portado nesta PR; após o merge, o repositório aguardará
  o design público final e um novo escopo humano explícito.
