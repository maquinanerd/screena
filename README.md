# Screen

> **Movies, series, ratings and where to watch.**

**Screen** é uma **base global de entretenimento _entity-first_**: filmes, séries, temporadas, episódios, pessoas, ratings externos, onde assistir, reviews e notícias — organizados em torno da **entidade** (a obra), e não de uma página solta. Sobre esses dados, Screen escreve uma **camada editorial própria**, em português (pt-BR) primeiro, com `en`/`es` nascendo em rascunho.

Domínio canônico público: **https://thescreen.media**

**Screen** é a marca pública principal. **The Screen** pode aparecer apenas como referência histórica, explicativa ou nome expandido não-principal. **Screena** é namespace técnico/legado interno (`@screena/*`, tokens `--screena-*`, nomes antigos de scripts/services), não a marca pública. **screena.media** e **The Nerd News** são legados históricos e não devem voltar como identidade do produto.

---

## O que é

Screen trata cada obra como uma **entidade canônica** com identidade estável (slug, IDs externos, schema.org) e agrega ao seu redor tudo o que importa para quem decide o que assistir:

- ficha da obra (filme / série / temporada / episódio / pessoa);
- **ratings externos atribuídos** (IMDb, Rotten Tomatoes, Metacritic, Letterboxd, FilmAffinity…), sempre com fonte, escala e atribuição corretas;
- **onde assistir** por país, com licença e disponibilidade reais;
- **camada editorial própria** (introduções, contexto, comparações, FAQ, reviews) gerada e revisada offline.

O resultado é um produto que **não é um agregador cru de API**: cada página indexável precisa carregar valor editorial próprio.

## Posicionamento

> **As APIs fornecem os dados. Screen escreve a camada editorial.**

Fornecedores externos (TMDB, provedores de rating via RapidAPI, etc.) são **fontes de dados técnicos**. Eles não são, e nunca aparecem como, a voz editorial do Screen. O valor do produto está na curadoria, na contextualização e na escrita própria — construída sobre dados licenciados e atribuídos corretamente.

## Regra central

> **Zero API externa no render. Zero Gemini no render.**

Toda página pública indexável lê **apenas PostgreSQL/cache local**. Nenhuma chamada a TMDB, a provedores de rating ou ao Gemini acontece durante a renderização. A IA (Gemini) só gera blocos de conteúdo **offline**, que são salvos, validados e revisados antes de qualquer publicação. Sincronização externa e geração de conteúdo são pipelines _separados_ do render.

---

## Mapa do monorepo

Monorepo **pnpm** com workspaces (`apps/*`, `packages/*`, `api-clients/*`, `services/*`). Estrutura de alto nível:

| Diretório       | Conteúdo                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| `apps/`         | Aplicações Next.js: `@screena/web` (site público Screen) e `@screena/admin` (painel editorial planejado). |
| `packages/`     | Pacotes compartilhados: `config`, `schemas`, `seo`, `ui`, `types`, `db`.                  |
| `services/`     | Serviços de domínio; `ingestion`, `sync` e `entity-writer` já têm implementação TS/Node parcial. |
| `workers/`      | Workers Python 3.12 como roadmap/shim futuro; TMDB Python é legado/scaffold.             |
| `api-clients/`  | Clientes de APIs externas; `tmdb` é real em TS/Node, demais clients estão como contratos/roadmap. |
| `database/`     | Documentação histórica de modelagem; fonte executável atual vive em `packages/db/prisma`. |
| `seo/`          | Regras de SEO programático, indexabilidade e geração de sitemaps/metadados.               |
| `prompts/`      | Prompts versionados do Entity Writer e demais agentes de IA (offline).                     |
| `tests/`        | Testes de invariantes e utilitários puros (Vitest).                                       |
| `scripts/`      | Scripts de auditoria e automação (ex.: checagem de invariantes e pureza de render).        |
| `docs/`         | Documentação canônica (SPEC, plano de build, fontes de API, SEO, deploy…).                |
| `.claude/`      | Governança operacional: regras, skills e agents que guiam a construção assistida por IA.   |

### Convenção de pacotes

- **Pacotes:** `@screena/config`, `@screena/schemas`, `@screena/seo`, `@screena/ui`, `@screena/types`, `@screena/db`.
- **Apps:** `@screena/web`, `@screena/admin`.

Cada pacote expõe `src/index.ts` (`"main": "./src/index.ts"`, `"type": "module"`), estende `tsconfig.base.json` e traz seu próprio `README.md`.

---

## Stack

- **Monorepo:** pnpm (workspaces `apps/*`, `packages/*`).
- **Frontend:** Next.js App Router, TypeScript **strict**, React Server Components, ISR/`revalidate`.
- **Estilo:** Tailwind CSS com tokens técnicos/legados `--screena-*`.
- **Banco:** PostgreSQL + Prisma em `packages/db`, com schema/migrations/seeds reais.
- **Workers:** Python **3.12** como roadmap/shim futuro; TMDB e Entity Writer rodam hoje em TypeScript/Node + Prisma.
- **IA:** Gemini — **somente offline**, nunca no render.
- **Deploy:** VPS + CloudPanel; Next via Node/PM2/systemd; workers via systemd timers.
- **Runtime:** Node **22 LTS**, pnpm **9.15.4**, TypeScript strict.

## Pré-requisitos

- **Node 22 LTS** (ver `.nvmrc`).
- **pnpm 9.15.4** (fixado em `packageManager`).
- **Python 3.12** (para workers Python futuros/roadmap; TMDB e Entity Writer atuais rodam em TS/Node).
- **PostgreSQL** para fluxos locais com banco real.

Recomendado com Corepack:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
node -v   # deve ser v22.x
pnpm -v   # deve ser 9.15.4
```

## Banco Local De Desenvolvimento

O jeito mais simples de subir um PostgreSQL local para desenvolvimento é usar o
compose dedicado da raiz. Ele cria um banco `screena` com usuário `screena` e
senha de desenvolvimento definida em `.env`.

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d postgres
npx pnpm@9.15.4 --filter @screena/db db:generate
npx pnpm@9.15.4 --filter @screena/db db:migrate:deploy
npx pnpm@9.15.4 --filter @screena/db db:seed
```

Use esta `DATABASE_URL` no `.env` local:

```env
DATABASE_URL="postgresql://screena:screena_dev_password@localhost:5432/screena"
```

### Testar a pagina de filme no navegador

Depois de subir o banco local, semeie uma fixture dev de filme e rode o app:

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d postgres
npx pnpm@9.15.4 --filter @screena/db db:migrate:deploy
npx pnpm@9.15.4 --filter @screena/db db:seed
npx pnpm@9.15.4 --filter @screena/web seed:dev-movie
npx pnpm@9.15.4 --filter @screena/web dev
```

Abra:

```txt
/pt/filmes/interestelar/
```

`seed:dev-movie` e **dev-only** e **idempotente**: cria/atualiza um filme de
exemplo (`Interstellar` / slug `interestelar`) com 2 blocos renderizaveis para a
pagina ficar indexavel localmente. Nao chama Gemini, nao chama TMDB, nao usa API
externa, nao cria ratings/streaming.

Para parar o banco:

```bash
docker compose -f docker-compose.dev.yml down
```

Para resetar tudo e apagar o volume local:

```bash
docker compose -f docker-compose.dev.yml down -v
```

## Comandos

> **Fundação avançada / vertical slice técnica.** O app público, banco, client TMDB, ingestão TMDB e Entity Writer já existem parcialmente. O produto ainda não está completo/publicável em escala.

| Comando          | O que faz                                                                 |
| ---------------- | ------------------------------------------------------------------------- |
| `pnpm install`   | Instala as dependências do monorepo.                                      |
| `pnpm dev`       | Servidor de desenvolvimento do app público quando as dependências estiverem instaladas. |
| `pnpm test`      | Roda os testes (Vitest): invariantes e utilitários puros.                 |
| `pnpm lint`      | Roda o ESLint em todo o repositório.                                      |
| `pnpm typecheck` | Checagem de tipos (`tsc --noEmit`).                                       |
| `pnpm audit:invariants`     | Audita as invariantes do projeto (ex.: pureza de render, atribuição).      |
| `pnpm audit:render`         | Audita pureza de render do app público.                                    |
| `pnpm build`     | Roda o build do app público Next.js (`@screena/web`).                     |

---

## Invariantes (resumo)

As 13 invariantes inegociáveis que governam todo o produto. A íntegra está em `CLAUDE.md` e em `.claude/rules`.

1. **IMDb ≠ Rotten Tomatoes** — nunca misturar fontes, escalas, ícones ou linguagem.
2. **provider_api ≠ rating_source** — o fornecedor técnico (ex.: RapidAPI) nunca é a fonte editorial.
3. **Zero API externa no render** — páginas indexáveis leem apenas PostgreSQL/cache local.
4. **Zero Gemini no render** — a IA só gera `content_blocks` offline, salvos e validados.
5. **Página fina recebe `noindex`** — sem ao menos 2 blocos de valor próprios além do dado cru, não indexa.
6. **Sem licença clara, não aparece** — `license_status` `unknown`/`blocked` ou `display_allowed=false` ⇒ fora de página indexável.
7. **pt-BR publica primeiro** — `en`/`es` nascem em draft/`noindex` até revisão humana.
8. **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed pirata.
9. **Filmes usam acento vermelho** (`--screena-movie-red`).
10. **Séries usam acento verde** (`--screena-series-green`).
11. **Filme vs. série nunca depende só da cor** — sempre label + badge + breadcrumb + schema + URL.
12. **Entity Writer só escreve com payload controlado** do PostgreSQL — não inventa fatos, não cria entidades, não chama APIs, não publica sozinho.
13. **`content_blocks` são versionados e revisáveis** — `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name` e `review_status` obrigatórios.

---

## Governança

A construção do Screen é guiada por regras explícitas e versionadas, que valem tanto para pessoas quanto para agentes de IA:

- **`CLAUDE.md`** — contexto canônico do projeto e fonte da verdade das invariantes.
- **`.claude/rules/`** — regras operacionais detalhadas (render, ratings, indexabilidade, i18n, legal).
- **`.claude/skills/`** — habilidades reutilizáveis para tarefas recorrentes do produto.
- **`.claude/agents/`** — definições dos agentes (ex.: Entity Writer) e seus limites de atuação.

Regra geral de escrita: **docs, regras e prompts em pt-BR**; **código e identificadores em inglês** (comentários podem ser em pt-BR). Utilitários TypeScript são puros, sem rede/DB/IO.

## Legal

- **Sem pirataria.** Nenhum torrent, IPTV, player ilegal, link de download ou embed pirata — em nenhuma hipótese.
- **Atribuição de ratings.** Toda nota externa carrega fonte, escala e atribuição corretas. Nota IMDb **nunca** vira Tomatometer; Tomatometer/Popcornmeter pertencem apenas ao Rotten Tomatoes. Nada de `AggregateRating` fingindo nota própria.
- **Licenças.** Dados sem licença clara (`license_status` `unknown`/`blocked` ou `display_allowed=false`) não aparecem em páginas indexáveis. Flags de exibição, logo, score, citação de review, atribuição e linkback são respeitadas conforme `source_licenses`.
- **Chaves de API.** Sempre em variáveis de ambiente, nunca no frontend. Todo sync externo gera log.

---

## Documentação

A documentação canônica vive em [`docs/`](./docs):

- [`docs/SPEC.md`](./docs/SPEC.md) — especificação do produto e do modelo de entidades.
- [`docs/BUILD_PLAN.md`](./docs/BUILD_PLAN.md) — plano de construção por fases.
- [`docs/API_SOURCES.md`](./docs/API_SOURCES.md) — fontes de dados externas e seus contratos.
- [`docs/SEO_PROGRAMMATIC.md`](./docs/SEO_PROGRAMMATIC.md) — SEO programático, indexabilidade e gate anti-thin.
- [`docs/RATING_ATTRIBUTION.md`](./docs/RATING_ATTRIBUTION.md) — regras de atribuição de ratings e licenças.
- [`docs/ENTITY_WRITER.md`](./docs/ENTITY_WRITER.md) — o agente editorial offline e seus limites.
- [`docs/CLOUDPANEL_DEPLOY.md`](./docs/CLOUDPANEL_DEPLOY.md) — deploy em VPS + CloudPanel.

---

## Status do projeto

**Estado atual — fundação avançada / vertical slice técnica.** ✅

A fundação do monorepo está em pé e já avançou além da Fase 0 pura: há Prisma/PostgreSQL em `packages/db`, migrations/seeds reais, client TMDB real em TypeScript, ingestão TMDB em `services/ingestion`, sync/stale policy, Entity Writer offline em TypeScript, adapter Gemini separado do render, rotas públicas para filmes/séries/pessoas/notícias, presenters puros, gates anti-thin, testes de governança e CI.

Ainda **não** estão funcionais como produto completo: ratings externos, streaming/onde assistir, RSSPRIME/MN26, admin editorial completo, usuários/community, reviews/favoritos/listas/watchlist e publicação em escala.
