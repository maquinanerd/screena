# CLAUDE.md — Governanca canonica da Screena

> Este documento e autoritativo. Ele e carregado em toda sessao do Claude Code neste repositorio. Quando houver conflito entre uma instrucao pontual e este arquivo, **este arquivo vence** — exceto ordem humana explicita que o sobreponha conscientemente. Mantenha-o afiado: sem redundancia, sem prosa decorativa.

## 1. Resumo do projeto

Screena e uma **base global de entretenimento entity-first**: filmes, series, temporadas, episodios, pessoas, ratings, onde assistir, reviews e noticias — com uma **camada editorial propria** por cima do dado bruto.

- Dominio: `screena.media`.
- MVP publica em **pt-BR**. As linguas `en` e `es` nascem em **draft/noindex** ate revisao humana.
- Entity-first: cada pagina gira em torno de uma entidade canonica (um filme, uma serie, uma pessoa), nao em torno de uma fonte de API.
- O diferencial competitivo e a **camada editorial verificavel** (content_blocks versionados, gerados offline e revisaveis), nunca a reexibicao crua de dados de terceiros.

Estamos na **Fase 0 (Fundacao)**: construimos a estrutura do monorepo, contratos, schemas e tipos (TypeScript puro, sem dependencia de runtime), regras de governanca, prompts e esqueletos. **Nao** implementamos produto real nesta fase — sem banco real, sem migrations completas, sem clients TMDB/Gemini, sem ratings reais, sem app final.

## 2. REGRAS DE OURO (invariantes inegociaveis)

Estas 13 invariantes sao a lei do projeto. Nao reescreva o sentido delas; cite-as.

1. **IMDb != Rotten Tomatoes** — nunca misturar fontes, escalas, icones ou linguagem.
2. **provider_api != rating_source** — o fornecedor tecnico (ex.: RapidAPI) nunca e a fonte editorial.
3. **Zero API externa no render** — paginas publicas indexaveis leem apenas PostgreSQL/cache local.
4. **Zero Gemini no render** — a IA so gera content_blocks offline, salvos e validados.
5. **Pagina fina recebe noindex** — sem pelo menos 2 blocos de valor proprios alem de dado cru de API, nao indexa.
6. **Dados sem licenca clara** (`license_status` unknown/blocked ou `display_allowed=false`) nao aparecem em pagina indexavel.
7. **pt-BR publica primeiro** — en/es nascem em draft/noindex ate revisao humana.
8. **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed pirata.
9. **Screena Movies usa acento vermelho** (`--screena-movie-red`).
10. **Screena Series usa acento verde** (`--screena-series-green`).
11. **A diferenciacao filme/serie NUNCA depende so da cor** — sempre label + badge + breadcrumb + schema + URL.
12. **Entity Writer so escreve com base em payload controlado do PostgreSQL** — nao inventa fatos, nao cria entidades, nao chama APIs externas, nao publica sozinho.
13. **content_blocks sao versionados e revisaveis** — `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name` e `review_status` obrigatorios.

### Regras complementares (mesmo peso)

- **API keys so em env vars**, nunca no frontend nem em codigo versionado.
- **Todo sync externo gera log** (`api_sync_logs`) — nenhuma ingestao silenciosa.
- **Nota IMDb nunca vira Tomatometer** — escalas e rotulos sao fixos por fonte.
- **Sem AggregateRating falsa** — nada de fingir nota propria; `AggregateRating` so quando permitido e corretamente atribuido.
- **Tomatometer/Popcornmeter pertencem so ao Rotten Tomatoes** — nao replicar esses rotulos para outra fonte.
- **WordPress nao entra no core** — pode existir na borda, nunca no caminho de render canonico.

## 3. Arquitetura e pureza de render

O render publico e **puro de IO externo**:

- O Next (App Router, RSC, ISR/revalidate) le **somente PostgreSQL e cache local** (`api_cache`). Nunca chama TMDB, RapidAPI, Rotten Tomatoes, Gemini ou qualquer rede no caminho de render.
- A IA (Gemini) roda **offline**: gera `content_blocks`, que sao validados (anti-alucinacao), versionados e salvos. O render apenas **le** blocos ja `published`.
- Ingestao e ratings rodam em **workers Python** (systemd timers), fora do render, sempre gerando log.
- O **gate anti-thin** decide indexacao: uma pagina so e `index` se tiver `>= 2` blocos de valor proprios (ver secao 9). Caso contrario: `noindex`.

Fluxo mental: **API externa -> worker (offline, com log) -> PostgreSQL -> [Entity Writer offline -> content_blocks] -> Next le PostgreSQL/cache -> render**.

## 4. Stack e versoes

- **Monorepo pnpm** (`pnpm@9`). Workspaces: `apps/*`, `packages/*`.
- **Node 22 LTS**, **TypeScript strict**, ESM (`"type": "module"`).
- **Frontend**: Next.js App Router, RSC, ISR/revalidate.
- **Estilo**: Tailwind CSS com tokens de cor da Screena.
- **Banco**: PostgreSQL. ORM recomendado: **Prisma** (alternativa documentada: Drizzle). **Na Fase 0 nao crie schema real nem migrations.**
- **Workers**: Python 3.12 (apenas esqueletos nesta fase).
- **IA**: Gemini — **apenas offline**, nunca no render.
- **Deploy**: VPS + CloudPanel; Next via Node/PM2/systemd; workers via systemd timers.
- Qualidade: ESLint + Prettier; testes com Vitest (`pnpm test`); `pnpm typecheck`, `pnpm lint`, `pnpm audit:invariants` / `pnpm audit:render`.

## 5. Mapa do monorepo

| Caminho | Conteudo |
| --- | --- |
| `apps/web` | App publico `@screena/web` (Next App Router, render puro). |
| `apps/admin` | Painel interno `@screena/admin` (revisao editorial, decisoes). |
| `packages/config` | `@screena/config` — config compartilhada, constantes, env tipado. |
| `packages/schemas` | `@screena/schemas` — validadores e contratos de dados (TS puro: ratings, saida do Entity Writer). |
| `packages/seo` | `@screena/seo` — indexabilidade, schema.org, sitemap, robots. |
| `packages/ui` | `@screena/ui` — componentes, tokens de cor, badges filme/serie. |
| `packages/types` | `@screena/types` — tipos TS compartilhados. |
| `packages/db` | `@screena/db` — contrato de acesso ao PostgreSQL (sem schema real na Fase 0). |
| `workers/` | Workers Python (esqueletos): tmdb, ratings, streaming, news, entity_writer, scheduler. |
| `services/` | Servicos de dominio (ingestion, ratings, streaming, sync, news-ingestion, entity-writer). |
| `api-clients/` | Esqueletos de clients externos (tmdb, imdb, rotten_tomatoes, streaming_availability, etc.). |
| `database/` | `schema.md`, `migrations/`, `seeds/` — referencia; sem schema real na Fase 0. |
| `seo/` | Logica de SEO no nivel raiz: `indexability.ts`, `sitemap.ts`, `robots.ts`, `rules/`, `templates/`. |
| `prompts/` | Prompts de IA (pt-BR) para os content_blocks. |
| `docs/` | `SPEC.md`, `BUILD_PLAN.md`, `API_SOURCES.md`, `SEO_PROGRAMMATIC.md`, `RATING_ATTRIBUTION.md`, `ENTITY_WRITER.md`, `CLOUDPANEL_DEPLOY.md`. |
| `tests/governance/` | Testes que travam as invariantes de governanca. |

### Convencao de pacotes

Cada pacote em `packages/*` tem: `package.json` (com `"main": "./src/index.ts"` e `"type": "module"`), `tsconfig.json` (extends `../../tsconfig.base.json`), `README.md` e `src/index.ts`.

### Aliases (devem bater entre `vitest.config.ts` e `tsconfig.base.json`)

```
@screena/config  -> packages/config/src/index.ts
@screena/schemas -> packages/schemas/src/index.ts
@screena/seo     -> packages/seo/src/index.ts
@screena/ui      -> packages/ui/src/index.ts
@screena/types   -> packages/types/src/index.ts
@screena/db      -> packages/db/src/index.ts
```

## 6. Como trabalhar

- **Fases pequenas**: uma issue -> uma branch -> um PR pequeno e revisavel. Nada de PR gigante.
- **Branches**: parta da branch base; nomeie por escopo (ex.: `feat/seo-indexability`, `chore/schemas-ratings`).
- **Testes**: cada utilitario puro chega com teste (Vitest). As invariantes tem testes em `tests/governance/`. Rode `pnpm typecheck` e `pnpm test` antes de abrir PR.
- **Commits/PRs**: descreva o "porque". Aponte qual invariante o codigo respeita ou protege.
- **Revisao HUMANA obrigatoria** para: decisoes de **licenca** (o que pode ou nao aparecer), **indexacao em massa** (mudar muitas paginas para index/noindex) e **publicacao** de conteudo (`published`). Agente nunca decide isso sozinho.
- Na Fase 0: **nao** instale dependencias, **nao** rode build/test pesado, **nao** chame APIs, **nao** rode git por conta propria, **nao** crie schema/migrations reais.

## 7. Ponteiros (regras, skills, agentes)

As regras detalhadas vivem (ou viverao) em `.claude/`. Consulte-as antes de mexer no dominio correspondente:

- `.claude/rules/ratings.md` — fontes, escalas, atribuicao, licenca (invariantes 1, 2 e complementares de rating).
- `.claude/rules/seo.md` — indexabilidade, gate anti-thin, schema.org, sitemap/robots (invariantes 3, 5).
- `.claude/rules/ingestion.md` — workers, sync com log, cache, `api_cache`/`api_sync_logs`.
- `.claude/rules/i18n.md` — pt-BR primeiro; en/es em draft/noindex (invariante 7).
- `.claude/rules/entity-writer.md` — payload controlado, anti-alucinacao, versionamento (invariantes 12, 13).
- `.claude/skills/*` — skills operacionais do projeto.
- `.claude/agents/*` — agentes especializados (ingestao, ratings, entity writer, SEO).

Referencias de produto/dominio: `docs/SPEC.md`, `docs/API_SOURCES.md`, `docs/RATING_ATTRIBUTION.md`, `database/schema.md`.

> Se um arquivo apontado acima ainda nao existir, ele e o destino canonico — crie-o nesse caminho quando a tarefa pedir, nao em outro lugar.

## 8. Convencoes de codigo

- **TypeScript strict, puro e testavel**: utilitarios sem rede/DB/IO externo; funcoes puras; `export` **nomeado** (evite `default`).
- **Docs, READMEs, regras e prompts em pt-BR**. Codigo e identificadores em **ingles**; comentarios podem ser pt-BR.
- **Sem chaves no front**: nenhuma API key, secret ou token em codigo de cliente. So `env` no servidor/worker.
- **Tokens de cor** (use as variaveis, nunca hardcode hex em componente):
  - `--screena-black = #000000`
  - `--screena-white = #F5F5F5`
  - `--screena-movie-red = #FF3B30`
  - `--screena-series-green = #7AA66D`
  - `--screena-bg-dark = #050505`
  - `--screena-bg-light = #F4F4F4`
  - Regra: **filme = vermelho, serie = verde, home/busca/misto/institucional = neutro**. Nunca so cor: sempre **label + badge + breadcrumb + schema + URL**.
- **Escalas de rating fixas por fonte**: `imdb=10`, `rotten_tomatoes=100`, `metacritic=100`, `letterboxd=5`, `filmaffinity=10`. Nao converta entre escalas para fingir equivalencia.
- **Aliases**: importe via `@screena/*`; mantenha `tsconfig.base.json` e `vitest.config.ts` em sincronia.

## 9. Gate anti-thin (referencia rapida)

Uma pagina so indexa com **>= 2 blocos de valor proprios** alem do dado cru de API. Blocos aceitos:

1 introducao editorial propria · 2 onde assistir por pais · 3 ratings externos atribuidos · 4 comparacao critica vs audiencia · 5 review propria · 6 noticias relacionadas · 7 FAQ util · 8 trailer incorporado · 9 elenco comentado · 10 contexto de franquia · 11 ordem cronologica · 12 guia de temporadas · 13 obras parecidas · 14 historico de atualizacao · 15 analise sem/com spoiler separada.

Um bloco gerado por IA so conta como valor se: veio de **payload controlado**; passou na **validacao anti-alucinacao**; esta salvo em `content_blocks`; tem `prompt_version` e `input_hash`; **nao copia sinopse externa**; e tem `review_status` permitido.

## 10. Lista NUNCA

- **NUNCA** pirataria (torrent, IPTV, player ilegal, link de download, embed pirata).
- **NUNCA** chamar API externa no render de pagina indexavel.
- **NUNCA** chamar Gemini (ou qualquer IA) no render.
- **NUNCA** indexar pagina fina (sem `>= 2` blocos de valor proprios).
- **NUNCA** misturar IMDb e Rotten Tomatoes (fontes, escalas, icones, linguagem).
- **NUNCA** tratar `provider_api` como `rating_source`.
- **NUNCA** exibir dado sem licenca clara em pagina indexavel.
- **NUNCA** publicar conteudo automaticamente — publicacao passa por humano.
- **NUNCA** deixar o Entity Writer inventar fatos, criar entidades ou chamar API externa.
- **NUNCA** relaxar o gate anti-thin para forcar indexacao.
- **NUNCA** colocar API key/secret no frontend ou no repositorio.
- **NUNCA** fabricar `AggregateRating` ou transformar nota de uma fonte no rotulo de outra.
- **NUNCA** publicar en/es sem revisao humana (nascem draft/noindex).
- **NUNCA** criar schema/migrations reais na Fase 0.
