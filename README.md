# Screen

> **Movies, series, ratings and where to watch.**

Screen é uma **base global de entretenimento _entity-first_**: filmes, séries, temporadas, episódios, pessoas, ratings externos, onde assistir, reviews e notícias — organizados em torno da **entidade** (a obra), e não de uma página solta. Sobre esses dados, Screen escreve uma **camada editorial própria**, em três idiomas (**pt-BR, en, es**).

**Domínio canônico público:** https://thescreen.media

**Marca.** _Screen_ é a marca pública principal. _The Screen_ aparece apenas como referência histórica/explicativa ou nome expandido não-principal. _Screena_ é namespace técnico/legado interno (`@screena/*`, tokens `--screena-*`, nomes antigos de scripts/services), **não** a marca pública. `screena.media` e _The Nerd News_ são legados históricos e não voltam como identidade do produto.

---

## Visão

Screen trata cada obra como uma **entidade canônica** com identidade estável (slug, IDs externos, schema.org) e agrega ao seu redor tudo o que importa para quem decide o que assistir:

- **ficha da obra** — filme / série / temporada / episódio / pessoa;
- **ratings externos atribuídos** — IMDb, Rotten Tomatoes, Metacritic, Letterboxd, FilmAffinity… — sempre com fonte, escala e atribuição corretas;
- **onde assistir por país**, com disponibilidade real e deep links;
- **camada editorial própria** (introduções, contexto, comparações, reviews) gerada e revisada offline;
- **grafo entre entidades** — filme ↔ pessoa ↔ obra, série → temporada → episódio, coleção/franquia — com links internos que dão contexto e autoridade.

O diferencial não é reexibir dado de terceiro: é a **voz editorial própria**, os **sinais de entidade** (`sameAs` para Wikidata/IMDb/TMDB) e a **profundidade** que fazem cada página valer por si.

### Posicionamento

> **As APIs fornecem os dados. Screen escreve a camada editorial.**

Fornecedores externos (TMDB, TVMaze, provedores de rating e de streaming via RapidAPI, etc.) são **fontes de dados técnicos**. Eles não são, e nunca aparecem como, a voz editorial do Screen. O valor do produto está na curadoria, na contextualização e na escrita própria — construída sobre dados atribuídos corretamente.

### Regra central

> **Zero API externa no render. Zero Gemini no render.**

Toda página pública lê apenas **PostgreSQL/cache local**. Nenhuma chamada a TMDB, a provedores de rating/streaming ou ao Gemini acontece durante a renderização. A IA (Gemini) só gera blocos de conteúdo **offline**, salvos, validados e revisados antes de publicar. Sincronização externa e geração de conteúdo são pipelines _separados_ do render.

---

## Fontes de dados

Screen ingere de várias fontes e guarda o **payload bruto (raw)** antes de promover para tabelas tipadas — paga cada API uma vez e nada se perde.

| Fonte | Papel | Licença / observação |
| --- | --- | --- |
| **TMDB** | Núcleo: fichas, elenco/equipe, imagens, vídeos, keywords, coleções, external_ids, watch providers, **traduções (todos os idiomas)** | API oficial; imagens remotas via CDN (guardamos só `file_path`) |
| **TVMaze** | Episódios, temporadas, datas de exibição, elenco de série | CC BY-SA 4.0 — **crédito + linkback obrigatórios** |
| **streaming-availability** (Movie of the Night) | Onde assistir em ~66 países, com deep links | RapidAPI — atribuição conforme provedor |
| **imdb236** | Ratings IMDb | RapidAPI — `provider_api = imdb236`, nunca `imdb` |
| **movies-ratings2** | Ratings agregados | RapidAPI |
| **film-show-ratings** | Ratings de filme/série | RapidAPI |

**Arquitetura raw-payload.** Cada fonte tem um worker que salva a resposta crua em uma tabela `*_raw` (`tmdb_raw`, `tvmaze_raw`, `streaming_raw`, `ratings_raw`). A **promoção** para tabelas tipadas (`entity_translations`, `external_ratings`, `watch_availability`, imagens, vídeos…) acontece em passo separado, **só do que tem uso**, sem re-bater na API. Descoberta em massa via **Daily ID Exports** do TMDB (filtrando conteúdo adulto).

---

## Idiomas

Screen é **trilíngue**: `/pt`, `/es`, `/en`. As traduções de título/sinopse vêm do TMDB (`append_to_response=translations`, todos os idiomas em um request) e são promovidas por locale. Um idioma só entra no ar (`PUBLISHED_LOCALES`) quando está **completo**: dado traduzido + interface (i18n) traduzida + hreflang recíproco. A raiz (`/`) redireciona por idioma do navegador, com **fallback para `/pt`** enquanto es/en não estiverem completos.

---

## Mapa do monorepo

Monorepo **pnpm** com workspaces (`apps/*`, `packages/*`, `api-clients/*`, `services/*`).

| Diretório | Conteúdo |
| --- | --- |
| `apps/` | Next.js: `@screena/web` (site público) e `@screena/admin` (painel editorial). |
| `packages/` | Compartilhados: `config`, `schemas`, `seo`, `ui`, `types`, `db`. |
| `services/` | Serviços de domínio: `ingestion`, `sync`, `entity-writer` (+ workers de fontes externas). |
| `api-clients/` | Clientes de APIs externas; `tmdb` real em TS/Node, demais em implementação. |
| `database/` | Documentação histórica de modelagem; fonte executável em `packages/db/prisma`. |
| `prompts/` | Prompts versionados do Entity Writer e agentes de IA (offline). |
| `tests/` | Testes de invariantes e utilitários puros (Vitest). |
| `scripts/` | Auditoria e automação (invariantes, pureza de render, backup). |
| `docs/` | Documentação canônica (SPEC, build plan, fontes de API, SEO, deploy…). |
| `.claude/` | Governança operacional: regras, skills e agents que guiam a construção assistida por IA. |

**Convenção de pacotes.** `@screena/config`, `@screena/schemas`, `@screena/seo`, `@screena/ui`, `@screena/types`, `@screena/db`; apps `@screena/web`, `@screena/admin`. Cada pacote expõe `src/index.ts` (`"main": "./src/index.ts"`, `"type": "module"`), estende `tsconfig.base.json` e traz seu próprio `README.md`.

---

## Stack

- **Monorepo:** pnpm (workspaces `apps/*`, `packages/*`).
- **Frontend:** Next.js App Router, TypeScript strict, React Server Components, ISR/`revalidate`.
- **Estilo:** Tailwind CSS com tokens `--screena-*`.
- **Banco:** PostgreSQL + Prisma em `packages/db`, com schema/migrations/seeds reais.
- **IA:** Gemini — **somente offline**, nunca no render.
- **Deploy:** **EasyPanel + Nixpacks** sobre VPS (Contabo). _(CloudPanel/PM2/systemd são referência histórica.)_
- **Runtime:** Node 22 LTS, pnpm 9+, TypeScript strict.

---

## Pré-requisitos

- Node 22 LTS (ver `.nvmrc`).
- pnpm 9+.
- Python 3.12 (workers; não necessário para o fluxo web).
- PostgreSQL para fluxos locais com banco real.

## Banco local de desenvolvimento

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d postgres
npx pnpm@9.15.4 --filter @screena/db db:generate
npx pnpm@9.15.4 --filter @screena/db db:migrate:deploy
npx pnpm@9.15.4 --filter @screena/db db:seed
```

`.env` local:

```env
DATABASE_URL="postgresql://screena:screena_dev_password@localhost:5432/screena"
```

### Testar a página de filme

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d postgres
npx pnpm@9.15.4 --filter @screena/db db:migrate:deploy
npx pnpm@9.15.4 --filter @screena/db db:seed
npx pnpm@9.15.4 --filter @screena/web seed:dev-movie
npx pnpm@9.15.4 --filter @screena/web dev
```

Abra: `/pt/filmes/interestelar/`

`seed:dev-movie` é dev-only e idempotente: cria/atualiza um filme de exemplo (Interstellar / slug `interestelar`). Não chama Gemini, TMDB nem API externa; não cria ratings/streaming.

Parar o banco: `docker compose -f docker-compose.dev.yml down` · Resetar e apagar o volume: `docker compose -f docker-compose.dev.yml down -v`

---

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm install` | Instala as dependências do monorepo. |
| `pnpm dev` | Servidor de desenvolvimento do app público. |
| `pnpm start` | Inicia o app público buildado (`@screena/web`). |
| `pnpm test` | Testes (Vitest): invariantes e utilitários puros. |
| `pnpm lint` | ESLint em todo o repositório. |
| `pnpm typecheck` | Checagem de tipos (`tsc --noEmit`). |
| `pnpm audit:invariants` | Audita as invariantes do projeto. |
| `pnpm audit:render` | Audita pureza de render do app público. |

---

## Invariantes

As invariantes inegociáveis que governam o produto. A íntegra vive em `CLAUDE.md` e `.claude/rules`. Duas mudaram de política e estão marcadas abaixo.

1. **IMDb ≠ Rotten Tomatoes** — nunca misturar fontes, escalas, ícones ou linguagem.
2. **`provider_api` ≠ `rating_source`** — o fornecedor técnico (ex.: RapidAPI, `imdb236`) nunca é a fonte editorial.
3. **Zero API externa no render** — páginas públicas leem apenas PostgreSQL/cache local.
4. **Zero Gemini no render** — a IA só gera `content_blocks` offline, salvos e validados.
5. **Indexação total** _(política atualizada — 2026-07)_ — toda entidade sincronizada é indexada, em todos os idiomas. O antigo gate anti-thin (≥2 blocos para indexar) foi **removido**. `noindex` fica apenas para casos técnicos (404, erro, entidade sem slug/tradução). O conteúdo editorial próprio deixou de ser pré-requisito de indexação e passou a ser alavanca de **qualidade e ranqueamento** (E-E-A-T, citação em AI Overview).
6. **Atribuição e licença de ratings** — toda nota externa carrega fonte, escala e atribuição; `license_status`/`display_allowed` são respeitados por fonte (hoje as fontes novas entram com `license_status='unverified'` reversível, nunca `official` por default).
7. **Idiomas** _(política atualizada — 2026-07)_ — pt-BR primeiro; **en e es são publicados e indexados** quando completos (dado + i18n de UI + hreflang), controlados por `PUBLISHED_LOCALES`. Não nascem mais permanentemente em `noindex`.
8. **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed pirata.
9. Filmes usam acento vermelho (`--screena-movie-red`).
10. Séries usam acento verde (`--screena-series-green`).
11. Filme vs. série nunca depende só da cor — sempre label + badge + breadcrumb + schema + URL.
12. **Entity Writer só escreve com payload controlado do PostgreSQL** — não inventa fatos, não cria entidades, não chama APIs, não publica sozinho.
13. **`content_blocks` versionados e revisáveis** — `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`, `review_status` obrigatórios.

---

## Governança

A construção do Screen é guiada por regras explícitas e versionadas, para pessoas e agentes de IA:

- `CLAUDE.md` — contexto canônico e fonte da verdade das invariantes.
- `.claude/rules/` — regras operacionais (render, ratings, indexabilidade, i18n, legal).
- `.claude/skills/` — habilidades reutilizáveis.
- `.claude/agents/` — definições dos agentes (ex.: Entity Writer) e seus limites.

**Regra de escrita:** docs, regras e prompts em pt-BR; código e identificadores em inglês (comentários podem ser pt-BR). Utilitários TypeScript são puros, sem rede/DB/IO.

---

## Legal

- **Sem pirataria.** Nenhum torrent, IPTV, player ilegal, link de download ou embed pirata — em nenhuma hipótese.
- **Atribuição de ratings.** Toda nota externa carrega fonte, escala e atribuição. Nota IMDb nunca vira Tomatometer; Tomatometer/Popcornmeter pertencem apenas ao Rotten Tomatoes. Nada de `AggregateRating` fingindo nota própria.
- **Licenças.** Flags de exibição, logo, score, citação de review, atribuição e linkback são respeitadas conforme `source_licenses`. Fontes com licença ainda não verificada entram com `license_status='unverified'` (reversível por fonte).
- **Chaves de API.** Sempre em variáveis de ambiente **de runtime**, nunca no frontend nem em build-args. Todo sync externo gera log.

---

## Documentação

Documentação canônica em `docs/`:

- `docs/SPEC.md` — especificação do produto e do modelo de entidades.
- `docs/BUILD_PLAN.md` — plano de construção por fases.
- `docs/API_SOURCES.md` — fontes de dados externas e seus contratos.
- `docs/SEO_PROGRAMMATIC.md` — SEO programático, indexação e sitemaps.
- `docs/RATING_ATTRIBUTION.md` — regras de atribuição de ratings e licenças.
- `docs/ENTITY_WRITER.md` — o agente editorial offline e seus limites.
- `docs/EASYPANEL_DEPLOY.md` — deploy real (EasyPanel + Nixpacks). _(`docs/CLOUDPANEL_DEPLOY.md` é referência histórica.)_

---

## Status do projeto

**Estado atual — fundação avançada / vertical slice técnica.**

**Já em pé:** monorepo pnpm; Prisma/PostgreSQL em `packages/db` com migrations/seeds reais; client TMDB real em TypeScript; ingestão TMDB; sync/stale policy; Entity Writer offline (pt-BR) com adapter Gemini separado do render; rotas públicas de filmes/séries/pessoas/notícias; presenters puros; testes de governança; CI.

**Decisões recentes já refletidas no plano (ver playbook de execução):** raw-payload multi-fonte (TMDB + TVMaze + streaming + 3 ratings); indexação total (gate anti-thin removido); trilíngue global (`/pt` `/es` `/en`); captura de todos os idiomas via `translations`; deploy EasyPanel/Nixpacks.

**Ainda NÃO funcionais como produto completo:**

- **Catálogo em escala** — hoje protótipo (~20 títulos); o raw sync completo do TMDB é o próximo passo de fundação.
- **Ratings externos e onde-assistir** — schema pronto e testado, mas ainda sem writer/reader ligado em produção.
- **`screen_score`** (nota própria) — só existe no seed demo; por decisão, a **estrela fica escondida** até haver pipeline editorial real de nota.
- **Trilíngue de fato** — `/es` e `/en` têm rota, mas dependem de promoção das traduções + i18n da UI antes de entrar em `PUBLISHED_LOCALES`.
- **Notícias, admin editorial pleno, e toda a camada de usuário** (community, reviews, favoritos, listas, watchlist) — a camada de usuário é ausência **intencional** (Screen é entity-first, não rede social).
- **Operação production-grade** — CI com gates, scripts de backup/restore e
  documentação de migration obrigatória existem; ainda faltam configuração real
  de branch protection no GitHub, agendamento no servidor, healthcheck e
  validação de staging.
