# Cinerie — Documentação do Projeto

> **Cinerie** é uma plataforma global de entretenimento entity-first para filmes, séries, temporadas, episódios, pessoas, ratings externos, disponibilidade de streaming, reviews e notícias/editorial. O estado atual do repositório já tem uma fundação técnica avançada, mas ainda não é um produto completo de tracking, ratings e streaming.

> **⚠️ Política atualizada (2026-07).** Trechos que citem o _gate anti-thin_ (≥ 2 blocos para indexar) ou "en/es nascem noindex" refletem a política antiga. Agora: indexação **total** (invariante 5 — `noindex` só em caso técnico; blocos = qualidade/ranqueamento) e en/es publicam via `PUBLISHED_LOCALES` (invariante 7). Fonte viva: [`CLAUDE.md`](./CLAUDE.md) + [`.claude/rules/`](./.claude/rules).

---

## Visão Geral do Produto

O nome público principal do produto é **Cinerie**, no domínio canônico **https://cinerie.com**. O nome **Cinerie** aparece neste documento como referência expandida/histórica ao projeto; a marca pública preferencial continua sendo **Cinerie**. `Screena` permanece como namespace técnico/legado interno em pacotes, variáveis e scripts.

O projeto é uma base global de entretenimento **entity-first**. A entidade é o centro da arquitetura: filmes, séries, temporadas, episódios e pessoas são páginas evergreen; notícias e editoriais funcionam como camada de frescor e contexto. A camada editorial é própria da Cinerie: APIs externas fornecem dados estruturados, mas não viram voz editorial.

A inspiração de produto combina padrões de bases como IMDb, Letterboxd, TV Time, Rotten Tomatoes e Banco de Séries, mas o repositório atual não implementa todos esses módulos. O que existe hoje é a vertical slice técnica: ingestão TMDB, banco PostgreSQL via Prisma, páginas públicas entity-first em pt-BR, admin editorial controlado, Entity Writer offline e testes de invariantes.

Diferenças importantes:

- **Base de dados**: dados estruturados vindos de PostgreSQL/local cache, com ingestão externa fora do render.
- **Camada editorial**: `content_blocks`, artigos e traduções revisáveis, com status e versionamento.
- **Tracking do usuário**: planejado, mas não implementado no schema atual.
- **Ratings e onde assistir**: modelagem parcial existe, mas as features públicas ainda não estão completas.

---

## Template/Base Utilizada

Não há evidência de um template único como Replit, artifacts-monorepo ou boilerplate externo específico. A base real encontrada é um **monorepo pnpm** com Next.js App Router, pacotes compartilhados, Prisma/PostgreSQL, serviços TypeScript/Node e CI no GitHub Actions.

| Necessidade | Solução adotada |
|---|---|
| Frontend | Next.js App Router em `apps/web` e `apps/admin` |
| Backend | Server Components, Server Actions controladas no admin e serviços Node/TypeScript offline |
| Banco de dados | PostgreSQL com Prisma em `packages/db` |
| Contrato de API | Não há contrato OpenAPI identificado; contratos internos são tipos TypeScript, Prisma e schemas Zod |
| TypeScript | TypeScript strict com aliases em `tsconfig.base.json` |
| Deploy | Documentação para VPS/CloudPanel, systemd workers e CI; app web buildado por `@screena/web` |

---

## Base Principal Escolhida

A base principal do Cinerie é o repositório atual em **Next.js App Router + Prisma + PostgreSQL + serviços offline em TypeScript**.

O projeto Replit/artifacts-monorepo deve ser usado apenas como referência de funcionalidades de produto, não como base arquitetural principal. Ele é útil para observar fluxos app-like como busca, watchlist, perfil, tracking por sessão e ratings de usuário, mas não é o destino técnico do produto.

A decisão técnica é manter o projeto principal atual porque ele está mais alinhado com:

- SEO programático;
- páginas entity-first indexáveis;
- render público lendo PostgreSQL/cache local;
- ingestão externa fora do render;
- Entity Writer offline;
- admin editorial;
- schema.org;
- sitemap, robots e canonical;
- controle explícito de indexabilidade;
- expansão futura para mídia/editorial em escala.

O Replit é útil como referência para:

- busca pública;
- watchlist;
- perfil;
- tracking;
- ratings de usuário;
- experiência mais app-like;
- cards com ações rápidas;
- estados vazios de produto.

Essas features devem ser implementadas no repositório principal, respeitando a arquitetura Next.js/Prisma/PostgreSQL e as invariantes de render puro, licença, indexabilidade e revisão editorial.

---

## Estrutura do Repositório

```text
Screnaa/
|-- .claude/
|-- .github/
|-- api-clients/
|-- apps/
|   |-- admin/
|   `-- web/
|-- database/
|-- design-handoff/
|-- docs/
|-- packages/
|   |-- config/
|   |-- db/
|   |-- schemas/
|   |-- seo/
|   |-- types/
|   `-- ui/
|-- prompts/
|-- scripts/
|-- seo/
|-- services/
|   |-- entity-writer/
|   |-- ingestion/
|   |-- news-ingestion/
|   |-- ratings/
|   |-- streaming/
|   `-- sync/
|-- tests/
|-- workers/
|-- package.json
|-- pnpm-workspace.yaml
|-- tsconfig.json
`-- tsconfig.base.json
```

Diretórios principais:

- `.claude/`: regras, agentes e skills locais que reforçam invariantes do projeto.
- `.github/`: workflow de CI para typecheck, lint, testes, auditorias e build.
- `api-clients/`: clientes e contratos de integrações externas. O cliente TMDB está implementado; outros diretórios são documentação/planejamento.
- `apps/web/`: site público Cinerie, com rotas públicas em pt-BR.
- `apps/admin/`: painel editorial interno com leitura, diagnóstico e ações editoriais limitadas por flag.
- `database/`: documentação histórica/explicativa de schema; a fonte executável é o Prisma em `packages/db`.
- `docs/`: documentação técnica de fontes, deploy, Entity Writer, SEO programático e planos de fases.
- `packages/`: pacotes compartilhados de configuração, banco, schemas, SEO, tipos e UI.
- `prompts/`: materiais de prompt/editorial usados como referência.
- `scripts/`: auditorias, validações e scripts de deploy.
- `services/`: ingestão TMDB, sync, Entity Writer e módulos planejados de ratings/streaming/news ingestion.
- `tests/`: testes Vitest de governança, web, admin e invariantes.
- `workers/`: material futuro/legado de workers; a implementação funcional atual de TMDB e Entity Writer é TypeScript/Node.

---

## Stack Técnica Completa

### Backend

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 LTS |
| Framework | Next.js App Router nos apps; serviços Node/TypeScript fora do render |
| Banco de dados | PostgreSQL |
| ORM | Prisma 6 em `packages/db` |
| Validação | Zod em `packages/schemas`; Prisma constraints; auditorias próprias |
| Logging | Logs estruturais em `api_sync_logs` e `entity_writer_logs`; scripts registram sync/import |
| Build | Next.js build para apps; TypeScript/tsx para serviços e CLIs |

### Frontend

| Camada | Tecnologia |
|---|---|
| Bundler/framework | Next.js 15 |
| Roteamento | App Router |
| Data fetching | React Server Components lendo PostgreSQL/cache local via módulos server |
| UI | React 19, componentes locais e pacote `@screena/ui` |
| Estilização | Tailwind CSS e CSS global em `apps/web/app/globals.css` / `apps/admin/app/globals.css` |
| Ícones | Não há biblioteca de ícones consolidada identificada |
| Animações | Não há camada de animação dedicada identificada |

### Tooling Transversal

| Ferramenta | Função |
|---|---|
| TypeScript | Linguagem principal, em modo strict |
| pnpm | Gerenciador de pacotes e workspaces, fixado em `pnpm@9.15.4` via Corepack |
| OpenAPI/codegen | Não identificado no estado atual |
| Testes | Vitest para invariantes, utilitários, presenters, admin e serviços |
| Lint/typecheck | ESLint e `tsc --noEmit` |
| CI | GitHub Actions em Node 22 rodando install, typecheck, lint, test, auditorias e build |

---

## Banco de Dados

O banco real é definido em `packages/db/prisma/schema.prisma`, com PostgreSQL. A modelagem usa enums, índices compostos, slugs canônicos, decisões de indexabilidade, logs de sync e versionamento editorial. Várias relações de entidades usam pares polimórficos (`entityType`, `entityId`) em vez de foreign keys diretas.

Enums principais:

- `EntityType`: `movie`, `tv_show`, `season`, `episode`, `person`
- `ContentBlockType`: blocos editoriais como `editorial_intro`, `cast_intro`, `why_watch`, `review_summary`, `news_context`
- `ContentSource`: `human`, `gemini`, `imported`, `system`
- `ReviewStatus`: `draft`, `ai_generated`, `needs_review`, `human_reviewed`, `rejected`, `published`
- `TranslationStatus`: `draft`, `review`, `published`, `archived`
- `IndexDecision`: `index`, `noindex`, `pending`
- `LicenseStatus`: `unknown`, `allowed`, `restricted`, `blocked`
- `ProviderKind`: `data`, `ratings`, `streaming`, `news`, `ai`

### Entidades de Conteúdo

| Model | Tabela | Função | Campos/constraints relevantes |
|---|---|---|---|
| `Movie` | `movies` | Filme como entidade evergreen | `tmdbId` único, `title`, `originalTitle`, datas, imagens, `overview`, `runtime`, `status`, timestamps |
| `TvShow` | `tv_shows` | Série como entidade evergreen | `tmdbId` único, `name`, `originalName`, datas, `status`, `numberOfSeasons`, `numberOfEpisodes` |
| `Season` | `seasons` | Temporada vinculada a série | `tvShowId`, `seasonNumber`, `tmdbId`, constraint única por série/temporada |
| `Episode` | `episodes` | Episódio vinculado a série e temporada | `tvShowId`, `seasonId`, `episodeNumber`, `tmdbId`; composite FK para temporada |
| `Person` | `people` | Pessoa/cast/crew | `tmdbId` único, `name`, `knownForDepartment`, imagens, biografia, datas |
| `Article` | `articles` | Notícia/editorial base | `category`, `authorName`, `sourceName`, `sourceUrl`, `publishedAt`, `licenseStatus`, `displayAllowed`, relação `entityLinks` |
| `ArticleTranslation` | `article_translations` | Conteúdo localizado de artigo | `languageCode`, `slug`, `title`, `body`, `reviewStatus`, `indexStatus`, unique por artigo/idioma e por idioma/slug |

Não há models de coleções/listas pessoais, reviews de usuário, comentários, auth, sessões ou tracking no schema atual.

### Relações de Conteúdo

| Model | Função | Relações/constraints |
|---|---|---|
| `CastMember` | Elenco de filme, série, temporada ou episódio | Referência polimórfica para entidade e FK para `Person`; unique por entidade/pessoa/ordem |
| `CrewMember` | Equipe técnica | Referência polimórfica para entidade e FK para `Person`; campos `department` e `job` |
| `EntityExternalId` | IDs externos por entidade | `entityType`, `entityId`, `provider`, `externalId`; unique por provider/externalId e por entidade/provider |
| `Slug` | Slugs canônicos por idioma | `entityType`, `entityId`, `languageCode`, `slug`, `isCanonical`; unique por idioma/slug |
| `Redirect` | Redirecionamentos de slug | `fromPath` único, `toPath`, `statusCode` |
| `EntityTranslation` | Títulos/overviews localizados | `languageCode`, `title`, `overview`, `source`, unique por entidade/idioma |
| `ContentBlock` | Blocos editoriais versionados | `promptVersion`, `inputHash`, `outputHash`, `modelProvider`, `modelName`, `reviewStatus`; unique por entidade/idioma/tipo/versão |
| `ExternalRating` | Rating externo por fonte licenciada | FK para `RatingSource`, `SourceLicense` opcional, score/display separados, attribution obrigatória |
| `WatchAvailability` | Disponibilidade de streaming | `providerName`, país, tipo de oferta, datas e `licenseStatus`; ainda não aparece como feature pública completa |
| `PageIndexabilityDecision` | Decisão de index/noindex | Motivo, contagem de blocos de valor, `decidedBy`, unique por entidade/idioma |
| `EntityNewsLink` | Relação entre artigo e entidade | `articleId`, `entityType`, `entityId`, unique por artigo/entidade |

### Referência, Licenças e Infra

| Model | Função |
|---|---|
| `Language` | Idiomas suportados, com flags de publicação/indexação. Seed: pt-BR publicável/indexável; en/es não. |
| `Country` | Países suportados por ISO-2. |
| `RatingSource` | Fonte editorial de rating, separada de fornecedor técnico. |
| `ApiProvider` | Fornecedor técnico de API, separado de fonte editorial. |
| `SourceLicense` | Licenças/flags por fonte e uso: `displayAllowed`, `scoreAllowed`, `requiresAttribution`. |
| `ApiCache` | Cache local de respostas externas, usado fora do render. |
| `ApiSyncLog` | Log de sincronização/importação externa. |
| `EntityWriterJob` | Fila de geração offline de blocos editoriais. |
| `EntityWriterLog` | Logs de execução/validação do Entity Writer. |

### Usuário / Rastreamento

Não implementado ainda. Não há models de usuário, sessão, autenticação, watchlist, progresso de episódios, listas pessoais, favoritos ou ratings de usuário.

---

## API / Backend Routes

O repositório atual não expõe uma API HTTP JSON própria em `app/api/*`, Express ou rota equivalente. O backend operacional aparece em três formas:

- páginas Next.js com Server Components lendo PostgreSQL/cache local;
- Server Actions internas do admin, limitadas a revisão/status editorial e protegidas por flag;
- CLIs/serviços Node para ingestão, sync e Entity Writer offline.

### Discovery

| Método | Rota | Descrição |
|---|---|---|
| GET | `/pt/explorar/` | Página pública de descoberta com seções reais de filmes, séries, pessoas e notícias. Não é API JSON. |

### Movies / Filmes

| Método | Rota | Descrição |
|---|---|---|
| GET | `/pt/filmes/` | Índice público de filmes com dados locais e gates de indexabilidade. |
| GET | `/pt/filmes/[slug]/` | Página pública de filme, com schema.org `Movie`, breadcrumbs e blocos editoriais revisáveis. |

### Series / TV Shows

| Método | Rota | Descrição |
|---|---|---|
| GET | `/pt/series/` | Índice público de séries. |
| GET | `/pt/series/[slug]/` | Página pública de série, com schema.org `TVSeries`, temporadas/episódios reais quando presentes. |

### People / Pessoas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/pt/pessoas/` | Índice público de pessoas. |
| GET | `/pt/pessoas/[slug]/` | Página pública de pessoa, com schema.org `Person`, biografia/filmografia e notícias relacionadas. |

### Search / Busca

Não implementado ainda. Não há rota pública de busca ou endpoint de search identificado.

### Tracking / Usuário

Não implementado ainda. Não há endpoints ou páginas de watchlist, perfil, progresso ou avaliações de usuário.

### News / Editorial

| Método | Rota | Descrição |
|---|---|---|
| GET | `/pt/noticias/` | Índice público de notícias/artigos publicáveis. |
| GET | `/pt/noticias/[slug]/` | Página pública de artigo, com schema.org `NewsArticle`, corpo editorial e entidades relacionadas. |

### Admin / Importação

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` no app admin | Dashboard interno com métricas e estado editorial. |
| GET | `/articles` | Lista interna de traduções de artigos. |
| GET | `/articles/[id]` | Detalhe/revisão de tradução de artigo; ações controladas por flag. |
| GET | `/content-blocks` | Lista interna de blocos editoriais. |
| GET | `/content-blocks/[id]` | Detalhe/revisão de bloco editorial; ações controladas por flag. |
| GET | `/review-queue` | Fila de revisão editorial com ações em lote limitadas. |
| GET | `/workflow` | Fluxo operacional editorial. |
| GET | `/qa` | Diagnóstico interno de qualidade/indexabilidade. |
| GET | `/staging` | Checklist interno de staging/readiness. |
| GET | `/health` | Saúde do banco e contagens básicas. |
| GET | `/security` | Diagnóstico de proteção do admin, sem expor segredos. |

As ações de escrita do admin não são rotas HTTP REST; são Server Actions em `apps/admin/src/server/editorial-actions.ts`, limitadas a:

- `reviewStatus` e `indexStatus` de `ArticleTranslation`;
- `reviewStatus` de `ContentBlock`;
- ações em lote com limite de 20 itens;
- execução apenas quando `ADMIN_EDITORIAL_ACTIONS_ENABLED=true`.

Não há endpoint de importação/admin para disparar seed ou ingestão diretamente pela UI.

---

## OpenAPI / Codegen

Não há contrato OpenAPI identificado no estado atual do projeto.

Também não há evidência de Orval, Swagger ou client gerado a partir de OpenAPI. Os contratos atuais são:

- Prisma schema em `packages/db/prisma/schema.prisma`;
- tipos TypeScript em pacotes e serviços;
- schemas Zod em `packages/schemas`;
- contratos documentais em `docs/` e READMEs dos serviços/API clients.

---

## Frontend — Páginas

### App público (`apps/web`)

| Rota | Componente/Arquivo | Descrição |
|---|---|---|
| `/pt/` | `apps/web/app/pt/page.tsx` | Home pública pt-BR, com seções reais e gate para evitar página fina. |
| `/pt/explorar/` | `apps/web/app/pt/explorar/page.tsx` | Hub de exploração de entidades e notícias. |
| `/pt/filmes/` | `apps/web/app/pt/filmes/page.tsx` | Índice de filmes. |
| `/pt/filmes/[slug]/` | `apps/web/app/pt/filmes/[slug]/page.tsx` | Detalhe de filme. |
| `/pt/series/` | `apps/web/app/pt/series/page.tsx` | Índice de séries. |
| `/pt/series/[slug]/` | `apps/web/app/pt/series/[slug]/page.tsx` | Detalhe de série. |
| `/pt/pessoas/` | `apps/web/app/pt/pessoas/page.tsx` | Índice de pessoas. |
| `/pt/pessoas/[slug]/` | `apps/web/app/pt/pessoas/[slug]/page.tsx` | Detalhe de pessoa. |
| `/pt/noticias/` | `apps/web/app/pt/noticias/page.tsx` | Índice de notícias. |
| `/pt/noticias/[slug]/` | `apps/web/app/pt/noticias/[slug]/page.tsx` | Detalhe de notícia/artigo. |
| `/dev/movie-page-preview` | `apps/web/app/dev/movie-page-preview/page.tsx` | Preview de desenvolvimento para página de filme. |
| `/robots.txt` | `apps/web/app/robots.ts` | Metadata route de robots. |
| `/sitemap.xml` | `apps/web/app/sitemap.ts` | Metadata route de sitemap. |

Não há página raiz `/` pública identificada no app web; a entrada canônica documentada é `/pt/`. Não há páginas de `/search`, `/watchlist`, `/profile` ou erro customizado identificadas.

### App admin (`apps/admin`)

| Rota | Componente/Arquivo | Descrição |
|---|---|---|
| `/` | `apps/admin/app/page.tsx` | Dashboard interno. |
| `/articles` | `apps/admin/app/articles/page.tsx` | Lista de traduções de artigos. |
| `/articles/[id]` | `apps/admin/app/articles/[id]/page.tsx` | Detalhe/revisão de artigo. |
| `/content-blocks` | `apps/admin/app/content-blocks/page.tsx` | Lista de blocos editoriais. |
| `/content-blocks/[id]` | `apps/admin/app/content-blocks/[id]/page.tsx` | Detalhe/revisão de bloco editorial. |
| `/review-queue` | `apps/admin/app/review-queue/page.tsx` | Fila de revisão. |
| `/workflow` | `apps/admin/app/workflow/page.tsx` | Workflow operacional. |
| `/qa` | `apps/admin/app/qa/page.tsx` | Diagnóstico de qualidade. |
| `/staging` | `apps/admin/app/staging/page.tsx` | Readiness de staging. |
| `/health` | `apps/admin/app/health/page.tsx` | Saúde do admin/banco. |
| `/security` | `apps/admin/app/security/page.tsx` | Diagnóstico de segurança. |

Todas as páginas do admin são marcadas como `noindex` no layout e protegidas por middleware de Basic Auth em modo production-like.

---

## Frontend — Componentes Compartilhados

### App público

| Componente | Função |
|---|---|
| `SiteHeader` | Cabeçalho público com logo local Cinerie e navegação para Filmes, Séries, Pessoas, Notícias e Explorar. |
| `EntityCardLink` | Card de entidade com imagem segura/local, badge textual de tipo e link canônico. |
| `EntityIndex` | Componente de listagem para índices de filmes, séries e pessoas. |
| `NewsCard` | Card de notícia/editorial. |
| `RelatedNewsSection` | Seção de notícias relacionadas, renderizada apenas quando há dados. |

Presenters importantes em `apps/web/src/lib`:

- `movie-presenter.ts`
- `series-presenter.ts`
- `person-presenter.ts`
- `news-presenter.ts`
- `entity-index-presenter.ts`
- `portal-presenter.ts`
- `related-news-presenter.ts`
- `sitemap-presenter.ts`
- `site.ts`
- `navigation.ts`

### Admin

| Componente | Função |
|---|---|
| `BulkActionPanel` | Painel para ações editoriais em lote controladas. |
| `BulkSelectTable` | Seleção tabular para itens de revisão. |
| `EditorialActionForm` | Formulário controlado para mudanças de status editorial permitidas. |

Não há componentes de tracking, botões de watchlist, rating display público, carrosséis ou filtros avançados implementados como experiência final de produto.

---

## Design System / Identidade Visual

### Identidade Visual

- **Nome público principal**: Cinerie.
- **Referência expandida/histórica**: Cinerie.
- **Domínio canônico**: https://cinerie.com.
- **Namespace técnico/legado**: `Screena`, `@screena/*`, `--screena-*`.
- **Tom visual atual**: editorial, limpo, cinematográfico e predominantemente claro no app público atual.
- **Assets de marca**: SVGs locais em `apps/web/public/brand/`.

A diferenciação entre filme e série nunca deve depender só de cor. A regra técnica atual combina label, badge, breadcrumb, schema.org e URL.

### Tokens de Cor

Tokens compartilhados identificados em `packages/config`, `packages/ui` e CSS global:

```css
--screena-black: #000000;
--screena-white: #f5f5f5;
--screena-movie-red: #ff3b30;
--screena-series-green: #7aa66d;
--screena-bg-dark: #050505;
--screena-bg-light: #f4f4f4;
```

Tokens de layout/tema do app público identificados em `apps/web/app/globals.css`:

```css
--bg-page: #fdfdfd;
--bg-surface: #ffffff;
--bg-muted: #efede7;
--bg-media: #0a0a0a;
--text-strong: #101010;
--text-body: #242424;
--text-heading: #3a3a3a;
--text-muted: #6e6e6e;
--text-faint: #9a958c;
--accent-movie: var(--screena-movie-red);
--link-movie: #8a1e1a;
--border: #e3ded6;
--border-soft: #f1eee8;
--border-dashed: #c9c2b6;
```

### Tipografia

O CSS do app público usa stack sans-serif com `"Montserrat"` como primeira opção, seguida de fontes de sistema. Não há import local ou externo de fonte identificado no app.

### Espaçamento / Layout

Tokens identificados:

```css
--container-max: 1280px;
--container-pad: 80px;
--measure: 68ch;
```

O layout público usa containers centralizados, superfícies claras, cards com bordas discretas, imagens de poster/backdrop quando disponíveis e fallback seguro para assets locais. O admin tem layout utilitário, voltado para diagnóstico e operação editorial.

### Regras de Marca

Regras sustentadas por `AGENTS.md`, `CLAUDE.md`, `.claude/rules/` e implementação atual:

- A marca pública deve ser Cinerie.
- `screena.media` é legado histórico e não deve aparecer como domínio canônico público ativo.
- The Nerd News é legado antigo e não deve voltar como identidade do produto.
- Filmes usam acento vermelho `--screena-movie-red`.
- Séries usam acento verde `--screena-series-green`.
- Filme vs. série exige label, badge, breadcrumb, schema e URL, não apenas cor.
- Imagens de poster/backdrop devem servir a conteúdo editorial, não decoração genérica.
- Nada de aparência genérica de IA, ornamentos sem função, blobs/bolinhas decorativas ou elementos flutuantes sem significado claro.
- Evitar emojis na interface pública/editorial.

---

## Dados Seed / Conteúdo Inicial

O seed estruturado fica em `packages/db/src/seed-data.ts` e é aplicado por `packages/db/prisma/seed.ts`. Ele popula dados de referência, não um catálogo completo de filmes/séries.

| Grupo | Conteúdo seedado |
|---|---|
| Idiomas | `pt-BR` publicável/indexável; `en` e `es` nascem como não publicáveis/não indexáveis |
| Países | BR, US, GB, PT, ES, FR, DE, IT, MX, AR, CA, AU, JP |
| Rating sources | IMDb, Rotten Tomatoes, Metacritic, Letterboxd, FilmAffinity |
| API providers | TMDB, Gemini, imdb236, Streaming Availability |
| Source licenses | Licenças conservadoras, em geral `unknown` e sem display liberado por padrão |

Há scripts de seed/dev para amostras de filme no app web, mas o seed canônico documentado é o de referência acima. Não há seed estruturado de catálogo amplo, usuários, reviews, watchlist ou listas pessoais.

---

## Integrações Externas

### Implementadas

| Integração | Estado | Observações |
|---|---|---|
| TMDB | Implementada em TypeScript | Cliente real em `api-clients/tmdb`; ingestão em `services/ingestion`; sync/stale policy em `services/sync`. |
| Gemini | Implementado como adapter offline | Usado pelo Entity Writer fora do render; também há adapter fake para testes/offline. |
| PostgreSQL | Implementado | Persistência via Prisma. |

### Planejadas ou Parciais

| Integração | Estado | Observações |
|---|---|---|
| Ratings externos via RapidAPI/provedores | Parcial/planejado | Há schema, README e invariantes; feature pública ainda não está completa. |
| Streaming/onde assistir | Parcial/planejado | `WatchAvailability` existe no Prisma e há README; UI pública ainda não entrega a feature. |
| RSSPRIME/MN26/news ingestion | Planejado | Há documentação/README, mas não implementação completa equivalente à TMDB. |
| Redis | Opcional/documentado | Aparece em `.env.example` como futuro/cache opcional. |
| CloudPanel/VPS/systemd | Documentado | Guia em `docs/CLOUDPANEL_DEPLOY.md`; deploy real não é comprovado pelo repo. |

Não há integração implementada identificada com YouTube trailers, WordPress, Cloudflare, OpenAI, JustWatch ou Watchmode.

---

## SEO / Conteúdo Programático

O SEO atual é parte central da arquitetura e aparece em código, pacotes e testes.

- **Domínio canônico**: `https://cinerie.com`, definido em helpers do app web e `.env.example`.
- **Idioma MVP**: `pt-BR`; `en`/`es` não devem indexar sem revisão humana.
- **Slugs**: model `Slug`, helpers de rota em `apps/web/src/lib/site.ts`, slugs canônicos por idioma.
- **Schema.org**: páginas de filme, série, pessoa e notícia geram dados estruturados adequados (`Movie`, `TVSeries`, `Person`, `NewsArticle`) com breadcrumbs.
- **Sitemap**: `apps/web/app/sitemap.ts` usa dados locais e fallback estático.
- **Robots**: `apps/web/app/robots.ts` permite público e bloqueia `/api/`, `/dev/` e `/admin/`.
- **Canonical**: helpers de canonical URL usam o domínio `cinerie.com`.
- **Anti-thin**: `packages/seo` e presenters aplicam gates para `noindex` quando a página não tem valor próprio suficiente.
- **Render puro**: páginas públicas indexáveis não chamam TMDB, ratings provider ou Gemini no caminho de render.
- **Notícias vs evergreen**: notícias entram como camada editorial/frescor; entidades permanecem como páginas centrais.
- **Open Graph/Twitter**: há metadados Next em layouts/páginas, mas não há pipeline identificado de imagem OG dinâmica.

Regras críticas:

- Zero API externa no render.
- Zero Gemini no render.
- Página fina recebe `noindex`.
- Sem licença clara, rating/availability não aparece em página indexável.
- `provider_api` nunca é tratado como `rating_source`.

---

## O Que Já Está Feito

### Fundação técnica

- Monorepo pnpm com workspaces `apps/*`, `packages/*`, `api-clients/*` e `services/*`.
- TypeScript strict.
- Next.js App Router nos apps `web` e `admin`.
- Prisma/PostgreSQL com migrations e seed de referência.
- Pacotes compartilhados para config, banco, schemas, SEO, tipos e UI.
- Zod para validação de schemas críticos.
- Vitest cobrindo governança, presenters, admin, clientes e serviços.
- CI no GitHub Actions com typecheck, lint, testes, auditorias e build.

### Produto público

- Home pública em pt-BR em `/pt/`.
- Página de explorar em `/pt/explorar/`.
- Índices de filmes, séries, pessoas e notícias.
- Páginas entity-first de filme, série e pessoa por slug.
- Página de notícia/artigo por slug.
- Rotas públicas com helpers de canonical.
- Uso de schema.org onde já implementado: `Movie`, `TVSeries`, `Person`, `NewsArticle` e breadcrumbs.
- Componentes públicos para header, cards de entidade, índices, news card e notícias relacionadas.

### SEO e indexabilidade

- Sitemap em `apps/web/app/sitemap.ts`.
- Robots em `apps/web/app/robots.ts`.
- Canonical baseado em `https://cinerie.com`.
- Breadcrumbs nas páginas de entidade/notícia.
- Schema.org nas páginas principais.
- Anti-thin gates em pacote/presenters.
- Render público sem chamadas externas para TMDB, ratings provider ou Gemini.
- Regras de `noindex` para páginas fracas, idiomas não revisados e conteúdo sem valor próprio suficiente.

### Dados e ingestão

- Prisma schema executável em `packages/db/prisma/schema.prisma`.
- PostgreSQL como banco principal.
- Cliente TMDB real em `api-clients/tmdb`.
- Serviços de ingestão TMDB em `services/ingestion`.
- Sync/stale policy em `services/sync`.
- Cache local de API em `ApiCache`.
- Logs de sync em `ApiSyncLog`.
- Separação entre `ApiProvider` técnico e `RatingSource` editorial.

### Editorial/Admin

- Admin interno em `apps/admin`.
- Dashboard, review queue, QA, staging, health, security e workflow.
- Listagem/detalhe de `ContentBlock`.
- Listagem/detalhe de `ArticleTranslation`.
- Server Actions estreitas e protegidas por `ADMIN_EDITORIAL_ACTIONS_ENABLED`.
- Entity Writer offline em `services/entity-writer`.
- Jobs e logs do Entity Writer.
- Validação de output e hashes/versionamento de `content_blocks`.

---

## O Que Ainda Falta Virar Produto

O projeto já tem fundação técnica forte, mas ainda faltam features visíveis e recorrentes para o usuário final.

### Experiência do usuário

- Busca pública.
- Watchlist.
- Perfil.
- Tracking de filmes e séries.
- Progresso de episódios.
- Favoritos.
- Ratings do usuário.
- Reviews de usuários.
- Listas e coleções pessoais.
- Auth/session pública.

### Produto editorial

- Páginas mais ricas de filme, série e pessoa.
- Blocos editoriais revisados em escala.
- Relações melhores entre notícias e entidades.
- Rankings e listas editoriais.
- Recomendações.
- Páginas programáticas por gênero, década, franquia, plataforma e pessoa.
- Pipeline de imagem OG dinâmica, se a estratégia de SEO pedir isso.

### Streaming e ratings

- Onde assistir como feature pública completa.
- Licenças de exibição para availability.
- Ratings externos com fonte, escala e atribuição corretas.
- Política clara e revisada para IMDb, Rotten Tomatoes, Metacritic, Letterboxd, FilmAffinity e outras fontes.
- UI pública de ratings que não misture fonte editorial com fornecedor técnico.

### Admin e operação

- Importação TMDB pelo admin.
- Disparo controlado de sync pelo admin.
- Edição completa e revisável de conteúdo.
- Gestão de indexabilidade por interface.
- Gestão de licenças/fonte por interface, com revisão humana.
- Staging validado.

### Design/produto visual

- Refinamento visual menos genérico.
- Componentes mais fortes de poster, backdrop, rankings, listas e estados de mídia.
- Páginas com cara de produto real, não apenas estrutura técnica.
- Estados vazios editoriais para busca, watchlist, listas e tracking.

---

## O Que Aproveitar do Projeto Replit

O projeto Replit não é a base principal, mas contém boas referências de funcionalidades que devem inspirar o roadmap do Cinerie.

Aproveitar como referência:

- `/search`;
- `/watchlist`;
- `/profile`;
- tracking por sessão;
- ratings de usuário;
- cards com ações rápidas;
- estado vazio editorial;
- página de temporadas;
- fluxo simples de API/cliente para features interativas.

Não aproveitar como direção principal:

- migrar o projeto principal para Vite SPA;
- trocar Next.js por Vite;
- substituir a arquitetura server-rendered/indexável por uma SPA fechada;
- abandonar Prisma/PostgreSQL;
- remover ingestão offline;
- chamar APIs externas no render público;
- transformar o produto em app fechado sem SEO.

As funcionalidades boas do Replit devem ser reimplementadas no repositório principal, com dados locais, páginas indexáveis quando fizer sentido e separação entre experiência pública evergreen e experiência interativa do usuário.

---

## Arquitetura — Decisões Não Óbvias

1. **Entity-first em vez de portal apenas noticioso**: entidades são páginas evergreen; notícias complementam.
2. **Render público isolado de APIs externas**: sync/ingestão escrevem no banco/cache; render só lê local.
3. **Gemini separado do render**: IA só atua offline no Entity Writer e grava `content_blocks` versionados.
4. **Camada editorial própria**: fornecedores externos são dados, não voz editorial.
5. **Licenças conservadoras por padrão**: seed e schema começam com `unknown`/display bloqueado quando não há licença clara.
6. **Ratings com fonte editorial separada do provedor técnico**: `RatingSource` e `ApiProvider` são models distintos.
7. **Indexabilidade explícita**: `PageIndexabilityDecision`, `packages/seo` e presenters evitam indexar páginas finas.
8. **Polimorfismo controlado por entidade**: várias tabelas usam `entityType` + `entityId` para cobrir filmes, séries, temporadas, episódios e pessoas.
9. **Admin com escrita estreita**: ações editoriais existem, mas são limitadas por flag e só alteram status permitidos.
10. **Monorepo com pacotes puros**: regras de SEO, schemas, tokens e tipos são extraídos para pacotes testáveis.
11. **pt-BR primeiro**: outros idiomas existem como preparação, não como publicação automática.
12. **Screena como legado técnico**: pacotes ainda usam `@screena/*`, mas a marca pública deve ser Cinerie.

---

## Comandos Úteis

Use preferencialmente `corepack pnpm ...` para respeitar a versão fixada.

### Instalação

```bash
corepack pnpm install
```

### Desenvolvimento

```bash
corepack pnpm dev
corepack pnpm --filter @screena/web dev
corepack pnpm --filter @screena/admin dev
```

### Build

```bash
corepack pnpm build
corepack pnpm --filter @screena/web build
corepack pnpm --filter @screena/admin build
```

### Typecheck, lint e testes

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm audit:invariants
corepack pnpm audit:render
```

### Banco

```bash
corepack pnpm --filter @screena/db db:validate
corepack pnpm --filter @screena/db db:format
corepack pnpm --filter @screena/db db:generate
corepack pnpm --filter @screena/db db:migrate:dev
corepack pnpm --filter @screena/db db:migrate:deploy
corepack pnpm --filter @screena/db db:seed
corepack pnpm --filter @screena/db db:validate:real
```

### Entity Writer

```bash
corepack pnpm --filter @screena/entity-writer run:offline
corepack pnpm --filter @screena/entity-writer inspect
corepack pnpm --filter @screena/entity-writer validate:real
corepack pnpm --filter @screena/entity-writer smoke:gemini
```

### Web utilitário

```bash
corepack pnpm --filter @screena/web seed:dev-movie
corepack pnpm --filter @screena/web validate:movie-page
corepack pnpm --filter @screena/web validate:movie-page:real
```

Não há comando real de OpenAPI/codegen identificado.

---

## Variáveis de Ambiente

Variáveis documentadas em `.env.example`:

| Variável | Função | Obrigatória? |
|---|---|---|
| `POSTGRES_PASSWORD` | Senha do Postgres local/docker | Sim para Postgres local |
| `DATABASE_URL` | URL de conexão Prisma/PostgreSQL | Sim para banco real |
| `THE_SCREEN_PUBLIC_SITE_URL` | URL pública canônica da Cinerie | Sim para produção |
| `SCREENA_PUBLIC_SITE_URL` | Legado comentado para migração | Não usar como canônico |
| `TMDB_READ_ACCESS_TOKEN` | Token TMDB v4 | Sim para ingestão TMDB real |
| `TMDB_API_KEY` | Chave TMDB v3 alternativa | Alternativa ao token v4 |
| `TMDB_API_BASE_URL` | Base URL da API TMDB | Opcional se default for suficiente |
| `TMDB_DEFAULT_LANGUAGE` | Idioma padrão de consulta TMDB | Opcional |
| `TMDB_MAX_RPS` | Limite de requisições por segundo | Opcional |
| `TMDB_MAX_RETRIES` | Tentativas máximas TMDB | Opcional |
| `TMDB_BREAKER_THRESHOLD` | Threshold de circuit breaker | Opcional |
| `TMDB_BREAKER_COOLDOWN_MS` | Cooldown do circuit breaker | Opcional |
| `TMDB_CACHE_TTL_MS` | TTL de cache TMDB | Opcional |
| `GEMINI_API_KEY` | Chave Gemini para Entity Writer offline | Sim para Gemini real |
| `GEMINI_MODEL` | Modelo Gemini | Opcional |
| `GEMINI_API_BASE_URL` | Base URL Gemini | Opcional |
| `GEMINI_MAX_RPS` | Limite de requisições Gemini | Opcional |
| `GEMINI_MAX_RETRIES` | Tentativas máximas Gemini | Opcional |
| `GEMINI_BREAKER_THRESHOLD` | Threshold de circuit breaker Gemini | Opcional |
| `GEMINI_BREAKER_COOLDOWN_MS` | Cooldown do circuit breaker Gemini | Opcional |
| `SCREENA_RATINGS_PROVIDER_KEY` | Chave futura para provider de ratings | Planejada |
| `SCREENA_STREAMING_PROVIDER_KEY` | Chave futura para provider de streaming | Planejada |
| `SCREENA_REDIS_URL` | Redis opcional/futuro | Opcional |
| `NODE_ENV` | Ambiente Node | Sim por runtime |

Variáveis usadas pelo código do admin e não listadas em `.env.example` no momento da auditoria:

| Variável | Função | Observação |
|---|---|---|
| `ADMIN_PROTECTION_ENABLED` | Liga/desliga proteção explícita do admin | Deve ser documentada antes de deploy |
| `ADMIN_BASIC_AUTH_USER` | Usuário Basic Auth do admin | Não expor valor |
| `ADMIN_BASIC_AUTH_PASSWORD` | Senha Basic Auth do admin | Não expor valor |
| `ADMIN_EDITORIAL_ACTIONS_ENABLED` | Libera Server Actions editoriais | Deve ficar `false` por padrão em ambientes não revisados |
| `VERCEL_ENV` | Detecção production-like no middleware | Usada para fail closed |

---

## Estado Atual do Projeto

### Implementado

- Monorepo pnpm com workspaces `apps/*`, `packages/*`, `api-clients/*` e `services/*`.
- Next.js App Router para app público e admin.
- Prisma/PostgreSQL com migrations, seed de referência e pacote `@screena/db`.
- Cliente TMDB real em TypeScript.
- Ingestão TMDB e sync/stale policy em serviços TypeScript/Node.
- Entity Writer offline com adapter Gemini separado do render, adapter fake, validações e persistência.
- Rotas públicas pt-BR para home, explorar, filmes, séries, pessoas e notícias.
- Presenters puros para páginas públicas e sitemap.
- Gates anti-thin, guardas de idioma e auditorias de pureza de render.
- Admin interno com diagnóstico e ações editoriais limitadas por flag.
- Testes Vitest e CI com typecheck, lint, testes, auditorias e build.

### Parcial

- Ratings externos: schema, seed, regras e documentação existem; experiência pública ainda não está funcional como produto.
- Streaming/onde assistir: model `WatchAvailability` e README existem; UI pública e integração real ainda estão incompletas.
- Admin editorial: já tem ações de status, mas não edição completa de conteúdo/title/slug/body/publicação.
- Notícias/editorial: páginas e models existem; ingestão RSSPRIME/MN26 ainda não está completa.
- Internacionalização: en/es existem como preparação, mas devem ficar draft/noindex até revisão humana.
- Deploy CloudPanel/systemd: documentado, mas não validado por evidência de ambiente neste repo.

### Não implementado

- Tracking de usuário: watchlist, perfil, progresso, listas pessoais, favoritos e ratings do usuário.
- Auth/session de usuário público.
- Busca pública.
- Reviews de usuários/comunidade.
- OpenAPI/codegen.
- Pipeline completo de imagens OG dinâmicas.
- Feature pública completa de trailers, onde assistir e ratings licenciados.

### Riscos / Pontos de Atenção

- O worktree usa nomes técnicos `Screena` por legado; isso não deve vazar como marca pública.
- `.env.example` não documenta todas as variáveis usadas pelo admin.
- Alguns READMEs ainda descrevem o admin como estritamente read-only, enquanto o código já tem Server Actions estreitas e feature-gated.
- `packages/types` contém tipo `franchise`, mas `EntityType` do Prisma não inclui franchise no estado atual.
- `database/schema.md` é histórico/explicativo; a fonte real é `packages/db/prisma/schema.prisma`.
- Ratings e streaming exigem decisão/licença humana antes de exibição indexável.
- Qualquer relaxamento de anti-thin, licença, Entity Writer ou indexação em massa exige revisão humana.

### Riscos principais

- O projeto ficar preso em documentação e auditoria, sem produto visível.
- A fundação técnica estar boa, mas o usuário final ainda não ter motivos fortes para voltar.
- Tracking, watchlist, reviews e listas demorarem demais para chegar.
- Ratings e streaming serem exibidos sem licença clara.
- Páginas finas serem indexadas.
- APIs externas vazarem para o render público.
- O design ficar genérico, com aparência de IA ou template.
- Namespaces legados como Screena vazarem como marca pública onde não deveriam.

---

## Próxima Fase Recomendada

A próxima fase não deve ser mais uma auditoria ampla. O projeto já tem fundação suficiente para avançar em produto visível, desde que as invariantes de render puro, licença, SEO e revisão editorial continuem preservadas.

Prioridade recomendada:

### Fase 1 — Busca pública local

Implementar busca pública usando dados locais do PostgreSQL, sem API externa no render.

Entregar:

- rota `/pt/busca` ou equivalente;
- busca por filmes, séries, pessoas e notícias;
- resultados agrupados por tipo;
- empty state editorial;
- canonical/noindex conforme regra de SEO;
- testes mínimos de presenter, rota e invariantes de render.

### Fase 2 — Watchlist e tracking inicial

Implementar primeira camada de usuário sem complexidade excessiva.

Entregar:

- modelo de sessão ou usuário mínimo;
- salvar “quero assistir”, “assistindo” e “assistido”;
- página de watchlist;
- botões em páginas de filme/série;
- persistência local/banco conforme decisão técnica;
- separação clara entre páginas públicas indexáveis e experiência interativa do usuário.

### Fase 3 — Página de entidade mais forte

Melhorar filme, série e pessoa para parecer produto real.

Entregar:

- hero com poster/backdrop;
- blocos editoriais revisados;
- elenco/crew;
- notícias relacionadas;
- ratings permitidos;
- disponibilidade de streaming apenas quando licenciada;
- schema.org preservado;
- anti-thin preservado.

### Fase 4 — Admin de importação

Criar fluxo controlado para importar/enriquecer entidades.

Entregar:

- campo para buscar/importar por TMDB ID ou título;
- preview antes de gravar;
- logs de importação;
- proteção por flag/admin;
- nenhuma chamada externa no render público;
- tratamento claro de erro, cache e stale policy.

### Fase 5 — Reviews/listas/comunidade

Avançar para comunidade somente depois da base pública e do tracking inicial.

Entregar:

- ratings de usuário;
- reviews;
- listas pessoais;
- listas editoriais;
- perfil público;
- moderação/revisão compatível com a estratégia editorial.

---

## Decisão Técnica Final

A direção correta é continuar no repositório principal atual.

Não migrar para o projeto Replit.

O projeto Replit deve ser usado como referência de produto e UX para funcionalidades interativas, principalmente busca, watchlist, perfil, tracking e ratings de usuário.

A base Next.js + Prisma + PostgreSQL deve continuar sendo a fundação do Cinerie, porque ela favorece SEO, páginas evergreen, render indexável, ingestão offline, admin editorial e crescimento programático.

---

## Resumo Executivo Final

O Cinerie está no caminho técnico correto.

A arquitetura atual é mais forte que a versão Replit para o objetivo principal do produto: construir uma plataforma entity-first, indexável, editorial e escalável para entretenimento.

O projeto já tem uma boa fundação de monorepo, Next.js, Prisma, PostgreSQL, ingestão TMDB, admin editorial, Entity Writer offline, SEO programático e render local.

O que falta agora é transformar essa base em produto visível: busca, watchlist, tracking, perfil, reviews, listas, páginas de entidade mais ricas e admin de importação.

A próxima etapa deve priorizar implementação de features públicas concretas, com validações mínimas, sem relaxar as regras de SEO, licença, render puro e revisão editorial.

---

## Regras de Qualidade para Evolução

- Documentação, regras e prompts em pt-BR.
- Código e identificadores em inglês.
- TypeScript strict.
- Utilitários puros com testes.
- Export nomeado em utilitários.
- Nenhuma API externa no render público indexável.
- Nenhum Gemini no render.
- Nenhuma publicação automática sem revisão humana.
- Nenhum rating/availability sem licença clara.
- Nenhum link, player, torrent, IPTV, download ou embed pirata.
- Antes de PR: `typecheck`, `lint`, `test`, `audit:invariants`, `audit:render` e `build` verdes.
