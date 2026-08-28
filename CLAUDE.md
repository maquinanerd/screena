# CLAUDE.md — Governanca canonica da Cinerie

> Este documento e autoritativo. Ele e carregado em toda sessao do Claude Code neste repositorio. Quando houver conflito entre uma instrucao pontual e este arquivo, **este arquivo vence** — exceto ordem humana explicita que o sobreponha conscientemente. Mantenha-o afiado: sem redundancia, sem prosa decorativa.

## 1. Resumo do projeto

**Cinerie** e uma **base global de entretenimento entity-first**: filmes, series, temporadas, episodios, pessoas, ratings, onde assistir, reviews e noticias — com uma **camada editorial propria** por cima do dado bruto.

- Marca publica principal: **Cinerie**.
- Dominio canonico publico: `https://cinerie.com`.
- **Screen** / **The Screen** e `thescreen.media` sao a marca e o dominio ANTERIORES (renomeados no Gate 1.5, 2026-07). Podem aparecer apenas como referencia historica em snapshots datados; nunca como identidade ativa. Ver [`REBRANDING-CINERIE.md`](./REBRANDING-CINERIE.md).
- `Screena` permanece como namespace tecnico/legado interno (`@screena/*`, tokens CSS `--screena-*`, nomes antigos de services/scripts). Nao e a marca publica atual e nao muda no Gate 1.5.
- `screena.media` e legado historico e nao deve ser usado como dominio publico/canonico ativo.
- **The Nerd News** e legado mais antigo e nao deve voltar como identidade do produto.
- MVP publica em **pt-BR**; `en` e `es` publicam e indexam quando completos (dado + i18n de UI + hreflang), controlados por **PUBLISHED_LOCALES** — nao nascem mais permanentemente noindex. _(politica atualizada 2026-07)_
- Entity-first: cada pagina gira em torno de uma entidade canonica (um filme, uma serie, uma pessoa), nao em torno de uma fonte de API.
- O diferencial competitivo e a **camada editorial verificavel** (content_blocks versionados, gerados offline e revisaveis), nunca a reexibicao crua de dados de terceiros.

Estado real atual: **fundacao avancada / vertical slice tecnica**. O repositorio nao e mais uma Fase 0 pura. Ja existem partes reais de Fase 1, Fase 2 e Fase 3A: monorepo pnpm, `apps/web` em Next.js App Router, Prisma/PostgreSQL em `packages/db`, migrations/seeds reais, client TMDB em TypeScript, ingestao TMDB em `services/ingestion`, sync/stale policy, Entity Writer offline em TypeScript, adapter Gemini separado do render, rotas publicas para filmes/series/pessoas/noticias, presenters puros, gates de indexabilidade/licenca, testes de governanca e CI.

Ainda **nao** estao funcionais como produto: ratings externos, streaming/onde assistir, ingestao de noticias ponta a ponta, redacao editorial (autoria/corpo/midia/taxonomia), usuarios/community publicos e app publicavel em escala. Nao implemente essas features por inferencia neste ciclo de alinhamento.

**RSS Prime e MNScr sao sistemas EXTERNOS, em repositorios proprios** — nao estao neste monorepo e nao devem ser classificados como inexistentes. O que existe aqui e a camada editorial que os recebe (ver secao 5 e [`docs/adr/0015-editorial-boundaries.md`](docs/adr/0015-editorial-boundaries.md)). **MN26 esta fora da arquitetura da Cinerie**: permanece exclusivo da Maquina Nerd e nao participa de nenhum fluxo daqui.

## 2. REGRAS DE OURO (invariantes inegociaveis)

Estas 13 invariantes sao a lei do projeto. Nao reescreva o sentido delas; cite-as.

1. **IMDb != Rotten Tomatoes** — nunca misturar fontes, escalas, icones ou linguagem.
2. **provider_api != rating_source** — o fornecedor tecnico (ex.: RapidAPI) nunca e a fonte editorial.
3. **Zero API externa no render** — paginas publicas indexaveis leem apenas PostgreSQL/cache local.
4. **Zero Gemini no render** — a IA so gera content_blocks offline, salvos e validados.
5. **Indexacao total** — toda entidade sincronizada e indexada em todos os idiomas publicados; noindex fica so para casos tecnicos (404, erro, entidade sem slug/traducao). Conteudo editorial e alavanca de ranqueamento, nao pre-requisito de indexacao. _(politica atualizada 2026-07; substitui o antigo gate anti-thin de >= 2 blocos)_
6. **Dados sem licenca clara** (`license_status` unknown/blocked ou `display_allowed=false`) nao aparecem em pagina indexavel.
7. **pt-BR publica primeiro** — `en` e `es` sao publicados e indexados quando completos (dado + i18n de UI + hreflang), controlados por **PUBLISHED_LOCALES**; nao nascem mais permanentemente noindex. _(politica atualizada 2026-07)_
8. **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed pirata.
9. **Screena Movies usa acento vermelho** (`--screena-movie-red`) — nome legado do token; a marca publica e Cinerie.
10. **Screena Series usa acento verde** (`--screena-series-green`) — nome legado do token; a marca publica e Cinerie.
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
- TMDB e Entity Writer rodam hoje em **TypeScript/Node + Prisma**, fora do render, sempre com separacao de providers e logs quando ha sync/persistencia.
- Workers Python permanecem como roadmap/shim futuro para ratings, streaming, RSS/news e orquestracao por systemd. Nao reimplemente TMDB do zero em Python por causa de documentacao antiga.
- A **indexacao e total** (politica 2026-07): toda entidade sincronizada e `index`; `noindex` fica so para casos tecnicos (404, erro, entidade sem slug/traducao) e a licenca (invariante 6) continua bloqueando dado sem permissao. Blocos de valor proprios sao alavanca de ranqueamento, nao pre-requisito (ver secao 9).

Fluxo mental: **API externa -> worker (offline, com log) -> PostgreSQL -> [Entity Writer offline -> content_blocks] -> Next le PostgreSQL/cache -> render**.

## 4. Stack e versoes

- **Monorepo pnpm** (`pnpm@9.15.4` via Corepack). Workspaces: `apps/*`, `packages/*`, `api-clients/*`, `services/*`.
- **Node 22 LTS**, **TypeScript strict**, ESM (`"type": "module"`).
- **Frontend**: Next.js App Router, RSC, ISR/revalidate.
- **Estilo**: Tailwind CSS com tokens `--screena-*` legados/tecnicos.
- **Banco**: PostgreSQL + Prisma em `packages/db`, com schema/migrations/seeds reais ja existentes.
- **Workers**: Python 3.12 apenas para esqueletos legados/roadmap. TMDB, sync e Entity Writer estao atualmente em TypeScript/Node + Prisma.
- **IA**: Gemini — **apenas offline**, nunca no render.
- **Deploy**: VPS + CloudPanel; Next via Node/PM2/systemd; workers via systemd timers.
- Qualidade: ESLint + Prettier; testes com Vitest (`pnpm test`); `pnpm typecheck`, `pnpm lint`, `pnpm audit:invariants`, `pnpm audit:render` e `pnpm build`.

## 5. Mapa do monorepo

| Caminho | Conteudo |
| --- | --- |
| `apps/web` | App publico `@screena/web` (Next App Router, render puro). |
| `apps/admin` | Painel interno `@screena/admin`. Leitura editorial sempre; ESCRITA (revisao/publicacao de `content_blocks`/`article_translations`) existe e e real, gateada pela flag `ADMIN_EDITORIAL_ACTIONS_ENABLED` (default desligada) — nao e "read-only puro". |
| `packages/config` | `@screena/config` — config compartilhada, constantes, env tipado, locales (fonte unica). |
| `packages/schemas` | `@screena/schemas` — validadores e contratos de dados (TS puro: ratings, saida do Entity Writer). |
| `packages/seo` | `@screena/seo` — indexabilidade, schema.org, sitemap, robots, canonical, redirects. UNICA logica de SEO (o antigo `seo/` na raiz era codigo morto e foi removido no Prompt 01). |
| `packages/ui` | `@screena/ui` — componentes, tokens de cor, badges filme/serie. |
| `packages/types` | `@screena/types` — tipos TS compartilhados. |
| `packages/db` | `@screena/db` — schema Prisma, migrations, seeds e acesso server-only ao PostgreSQL. |
| `packages/public-contracts` | `@screena/public-contracts` — contratos de apresentacao do render publico (unico lugar autorizado ao host de imagem TMDB). |
| `packages/cinerie-score` | `@screena/cinerie-score` — calculo do Cinerie Score (bloqueado por licenca; nao publico). |
| `services/ingestion` | `@screena/ingestion` — plataforma TMDB: discovery, catalogo, midia, fila de jobs, busca. |
| `services/sync` | `@screena/sync` — politica de frescor/stale sobre `ingestion`. |
| `services/entity-writer` | `@screena/entity-writer` — Entity Writer offline (adapter Gemini separado do render). |
| `services/ratings` | `@screena/ratings` — ratings externos via RapidAPI (governado; nao publico ativo). |
| `services/streaming` | `@screena/streaming` — disponibilidade de streaming via RapidAPI (gateado por licenca). |
| `services/legal` | `@screena/legal` — registro de autorizacao de fontes e atribuicao. |
| `services/user-platform` | `@screena/user-platform` — identidade, credencial, sessao, tokens, e-mail transacional (runtime de auth WIRED nas rotas `/api/auth/**`). |
| `services/news-ingestion` | `@screena/news-ingestion` — **workspace ATIVO e real** (nao e placeholder). Plataforma editorial: identidade de item, deduplicacao determinista, ciclo de vida do artigo, slug/redirect, projecao de busca/indexabilidade, metricas e portas. Nucleo PURO em `src/` (sem Prisma), adapters Prisma em `src/persistence/`, CLI de desenvolvimento em `bin/editorial.ts` (com barreira anti-producao) e testes proprios. **Nao reconstroi RSS Prime nem MN26**: implementa o contrato de entrada e a projecao publica governada. Desde a FASE 2C tambem hospeda o **worker de projecao editorial** (`bin/project-editorial.ts`): consome a outbox do CMS por HTTP e projeta no banco publico. E o UNICO processo que fala com os DOIS LADOS — e a ponte e assimetrica: **API do Payload** (HTTP autenticado) de um lado, **banco publico do Screen-App** (Prisma) do outro. Ele NAO abre conexao com o banco do CMS; a proibicao e travada por `tests/governance/editorial-worker-boundary.test.ts`. |
| `api-clients/imdb`, `api-clients/kaso`, `api-clients/rotten_tomatoes` | Placeholders de roadmap (apenas `README.md`, sem `package.json` nem codigo). Nao sao workspaces ativos. |
| `workers/` | Workers Python (esqueletos/roadmap): ratings, streaming, news e scheduler; TMDB legado/scaffold nao substitui o client TS atual. `rssprime_worker.py` descreve um contrato antigo (inclusive `news_clusters`, tabela que NAO existe) — nao e fonte de verdade. |
| `api-clients/` | Clients externos; `tmdb`, `rapidapi-core`, `film_show_ratings` e `streaming_availability` sao reais em TS/Node. `imdb`, `kaso` e `rotten_tomatoes` sao placeholders. |
| `database/` | Legado: `migrations/` vazio e `seeds/` so com README. A fonte executavel atual e `packages/db/prisma`. |
| `prompts/` | Prompts de IA (pt-BR) para os content_blocks. |
| `docs/` | `SPEC.md`, `BUILD_PLAN.md`, `API_SOURCES.md`, `SEO_PROGRAMMATIC.md`, `RATING_ATTRIBUTION.md`, `ENTITY_WRITER.md`, `CLOUDPANEL_DEPLOY.md`. |
| `tests/governance/` | Testes que travam as invariantes de governanca. |

### Convencao de pacotes

Cada pacote em `packages/*` tem: `package.json` (com `"main": "./src/index.ts"` e `"type": "module"`), `tsconfig.json` (extends `../../tsconfig.base.json`), `README.md` e `src/index.ts`.

### Aliases (devem bater entre `vitest.config.ts` e `tsconfig.base.json`)

```
@screena/config                     -> packages/config/src/index.ts
@screena/schemas                    -> packages/schemas/src/index.ts
@screena/seo                        -> packages/seo/src/index.ts
@screena/ui                         -> packages/ui/src/index.ts
@screena/types                      -> packages/types/src/index.ts
@screena/db                         -> packages/db/src/index.ts
@screena/public-contracts           -> packages/public-contracts/src/index.ts
@screena/cinerie-score              -> packages/cinerie-score/src/index.ts
@screena/legal                      -> services/legal/src/index.ts
@screena/news-ingestion             -> services/news-ingestion/src/index.ts
@screena/tmdb-client                -> api-clients/tmdb/src/index.ts
@screena/rapidapi-core              -> api-clients/rapidapi-core/src/index.ts
@screena/film-show-ratings-client   -> api-clients/film_show_ratings/src/index.ts
@screena/streaming-availability-client -> api-clients/streaming_availability/src/index.ts
```

## 6. Como trabalhar

- **Fases pequenas**: uma issue -> uma branch -> um PR pequeno e revisavel. Nada de PR gigante.
- **Branches**: parta da branch base; nomeie por escopo (ex.: `feat/seo-indexability`, `chore/schemas-ratings`).
- **Testes**: cada utilitario puro chega com teste (Vitest). As invariantes tem testes em `tests/governance/`. Rode `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit:invariants`, `pnpm audit:render` e `pnpm build` antes de abrir PR.
- **Commits/PRs**: descreva o "porque". Aponte qual invariante o codigo respeita ou protege.
- **Revisao HUMANA obrigatoria** para: decisoes de **licenca** (o que pode ou nao aparecer), **indexacao em massa** (mudar muitas paginas para index/noindex) e **publicacao** de conteudo (`published`). Agente nunca decide isso sozinho.
- Nao chame APIs externas, nao rode Gemini real e nao publique conteudo automaticamente. Builds/testes locais sao esperados quando a tarefa pedir validacao.

## 7. Ponteiros (regras, skills, agentes)

As regras detalhadas vivem (ou viverao) em `.claude/`. Consulte-as antes de mexer no dominio correspondente:

- `.claude/rules/ratings.md` — fontes, escalas, atribuicao, licenca (invariantes 1, 2 e complementares de rating).
- `.claude/rules/seo.md` — indexabilidade (total; gate anti-thin removido em 2026-07), schema.org, sitemap/robots (invariantes 3, 5).
- `.claude/rules/ingestion.md` — workers, sync com log, cache, `api_cache`/`api_sync_logs`.
- `.claude/rules/i18n.md` — pt-BR primeiro; en/es em draft/noindex (invariante 7).
- `.claude/rules/entity-writer.md` — payload controlado, anti-alucinacao, versionamento (invariantes 12, 13).
- `docs/adr/0015-editorial-boundaries.md` — **fronteiras canonicas da arquitetura editorial**: quem e externo (RSS Prime, MNScr), quem esta fora (MN26), qual e o CMS aprovado (Payload), o que o `apps/admin` e e nao e, qual e o papel de `services/news-ingestion`, e as DUAS entradas do MNScr (`rss-prime-event-v1` + `cinerie-editorial-context-v1`).
- [`docs/operations/route-cache-and-isr-disk.md`](docs/operations/route-cache-and-isr-disk.md) — **o que e guardado em cache, onde, e quanto disco custa**. O `no-store` das rotas publicas nunca foi nosso: e o default do Next para render dinamico. `revalidate` sem `generateStaticParams` e INERTE. A home e as listagens continuam dinamicas porque o build do release nao alcanca o banco — o que as tirou dos 3-4 s foi a consulta parar de varrer o catalogo. Leia antes de mexer em `revalidate`, em `generateStaticParams` ou no disco do `screen-app`.
- `docs/operations/editorial-projection-worker.md` — operacao do **worker de projecao editorial** (CMS -> banco publico): escopos da conta tecnica, ciclo claim/ack/fail com lease, desfechos do recibo e diagnostico. Leia antes de mexer na outbox ou na projecao.
- `docs/operations/editorial-media-projection.md` — **projecao de midia editorial**: endpoint interno de bytes, autorizacao por licenca/finalidade, formatos e limites, storage port (local + S3-compatible), chave por hash e referencia publica. Leia antes de mexer em imagem de materia.
- [`docs/operations/legal-supersede-carries-rows.md`](docs/operations/legal-supersede-carries-rows.md) — **por que `legal sources apply` apagou as notas e as ofertas da pagina em 2026-08-20, e o que impede de novo**. `external_ratings`/`watch_availability` apontam para uma LINHA de `data_usage_decisions`: o `supersede` trocava o id embaixo delas e o gate de leitura exige `is_current`. O supersede passa a CARREGAR as linhas na mesma transacao; licenca mais restritiva continua ocultando, mas o `review` diz quantas ANTES de escrever; `legal sources rebind` conserta o que ja ficou orfao. Leia antes de rodar `apply` com dado publicado no banco.
- `docs/adr/0016-content-block-lifecycle-separation.md` — `content_blocks` e `article_translations` compartilham o enum `ReviewStatus` e **nao** a maquina de estados. Leia antes de assumir simetria entre os dois dominios.
- `docs/adr/0018-machine-entity-links-verification-state.md` + `docs/adr/0019-entity-link-confidence-verification.md` — **com que estado de verificacao um vinculo de entidade vindo de maquina nasce**. O 0018 decidiu "sempre `false`"; o 0019 o **emenda** numa linha: `confidence >= 0.9` (limiar configuravel), para `movie`/`tv`/`person`, nasce verificado — porque desde entao existe a rota `/api/internal/entity-resolve`, que recusa ambiguidade e devolve `null` em vez de palpite. Curadoria humana nunca e rebaixada, e `verificationSource` distingue quem afirmou. Leia os DOIS antes de mexer em `entityReferences`.
- `docs/adr/0017-automation-publisher-actor.md` — **ingestao e autopublicacao sao ATORES diferentes**, derivados do escopo da credencial. `draft_ingest` continua confinado a `automation_draft`; `editorial_auto_publish` sobe ate `published` sem atravessar estados que afirmam revisao humana. Leia antes de mexer na maquina de estados ou em permissao de conta tecnica.
- `docs/operations/editorial-auto-publication-quota.md` — **tetos diarios da autopublicacao**: as cinco dimensoes, o dia civil da redacao por fuso IANA, a reserva transacional (contador e publicacao vivem e morrem juntos) e os desfechos quando um teto esgota. Leia antes de mexer em limite, fuso ou contador.
- `.claude/skills/*` — skills operacionais do projeto.
- `.claude/agents/*` — agentes especializados (ingestao, ratings, entity writer, SEO).

Referencias de produto/dominio: `docs/SPEC.md`, `docs/API_SOURCES.md`, `docs/RATING_ATTRIBUTION.md`, `database/schema.md`.

> Se um arquivo apontado acima ainda nao existir, ele e o destino canonico — crie-o nesse caminho quando a tarefa pedir, nao em outro lugar.

## 8. Convencoes de codigo

- **TypeScript strict, puro e testavel**: utilitarios sem rede/DB/IO externo; funcoes puras; `export` **nomeado** (evite `default`).
- **Docs, READMEs, regras e prompts em pt-BR**. Codigo e identificadores em **ingles**; comentarios podem ser pt-BR.
- **Sem chaves no front**: nenhuma API key, secret ou token em codigo de cliente. So `env` no servidor/worker.
- **Tema unico: o produto e CLARO, sempre.** O canonico e o White Cinematic Editorial System e nao tem uma unica tela escura. Nao ha `@media (prefers-color-scheme: dark)` nem `[data-theme='dark']` em `apps/web/app/globals.css`, e nao deve haver — travado por `tests/web/tema-unico.test.ts`. Consequencia pratica: com uma superficie so, **hexadecimal literal quente sobre fundo claro esta certo**; nao tokenize cor para "sobreviver ao tema". _(decisao do dono, 2026-08-21)_
- **Tokens de cor** (use as variaveis, nunca hardcode hex em componente):
  - **A fonte da verdade dos acentos e o CANONICO** (`Screen Screens v4.dc.html`, revisao fixada em `MANIFESTO-CANONICO.json`), nao esta lista. Os dois acentos vivos, como declarados em `globals.css`:
  - `--c-accent-movie = #f0443e` (filme)
  - `--c-accent-series = #7fa56f` (serie)
  - Os nomes `--screena-*` sao legado tecnico. Os valores `#FF3B30` / `#7AA66D` que este documento trazia ate 2026-08-21 estavam **errados**: nao aparecem em lugar nenhum do canonico. Onde ainda restarem (`packages/config` `COLOR_TOKENS`, `AGENTS.md`, `docs/SPEC.md`, `CINERIE.md`, READMEs), sao residuo — corrija pelo canonico, nunca o contrario.
  - **Valor do canonico que reprova em contraste NAO entra.** Legibilidade ganha de fidelidade de pixel; a divergencia fica registrada. Caso vivo: a sobrancelha do canonico e `#9A958C` (2,93:1 sobre `#fdfdfd`) e a producao usa `--c-text-muted-aa` (`#6e6a61`, 5,30:1). Travado por `tests/web/detalhe-contraste.test.ts`. _(decisao do dono, 2026-08-21)_
  - Regra: **filme = vermelho, serie = verde, home/busca/misto/institucional = neutro**. Nunca so cor: sempre **label + badge + breadcrumb + schema + URL**.
- **Escalas de rating fixas por fonte**: `imdb=10`, `rotten_tomatoes=100`, `metacritic=100`, `letterboxd=5`, `filmaffinity=10`. Nao converta entre escalas para fingir equivalencia.
- **Aliases**: importe via `@screena/*`; mantenha `tsconfig.base.json` e `vitest.config.ts` em sincronia.

## 9. Blocos de valor e qualidade (referencia rapida)

_(politica atualizada 2026-07: o antigo gate anti-thin de `>= 2 blocos` para indexar foi **removido**. Indexacao e total — ver invariante 5. Os blocos de valor abaixo deixaram de ser pre-requisito de `index` e passaram a ser **alavanca de qualidade e ranqueamento** — E-E-A-T, profundidade, citacao em AI Overview.)_

Blocos de valor proprios (o que enriquece uma pagina alem do dado cru de API):

1 introducao editorial propria · 2 onde assistir por pais · 3 ratings externos atribuidos · 4 comparacao critica vs audiencia · 5 review propria · 6 noticias relacionadas · 7 FAQ util · 8 trailer incorporado · 9 elenco comentado · 10 contexto de franquia · 11 ordem cronologica · 12 guia de temporadas · 13 obras parecidas · 14 historico de atualizacao · 15 analise sem/com spoiler separada.

Um bloco gerado por IA so conta como valor de qualidade se: veio de **payload controlado**; passou na **validacao anti-alucinacao**; esta salvo em `content_blocks`; tem `prompt_version` e `input_hash`; **nao copia sinopse externa**; e tem `review_status` permitido.

## 10. Lista NUNCA

- **NUNCA** pirataria (torrent, IPTV, player ilegal, link de download, embed pirata).
- **NUNCA** chamar API externa no render de pagina indexavel.
- **NUNCA** chamar Gemini (ou qualquer IA) no render.
- **NUNCA** indexar pagina tecnicamente invalida (404, erro, entidade sem slug/traducao) — esse e o unico caso de `noindex` sob indexacao total.
- **NUNCA** misturar IMDb e Rotten Tomatoes (fontes, escalas, icones, linguagem).
- **NUNCA** tratar `provider_api` como `rating_source`.
- **NUNCA** exibir dado sem licenca clara em pagina indexavel.
- **NUNCA** publicar conteudo automaticamente — publicacao passa por humano.
- **NUNCA** deixar o Entity Writer inventar fatos, criar entidades ou chamar API externa.
- **NUNCA** confundir "indexacao total" com indexar lixo: a licenca (invariante 6) continua bloqueando dado sem permissao, e mocks/placeholders/dados sem licenca nunca viram pagina indexavel.
- **NUNCA** colocar API key/secret no frontend ou no repositorio.
- **NUNCA** fabricar `AggregateRating` ou transformar nota de uma fonte no rotulo de outra.
- **NUNCA** ligar um idioma (en/es) em `PUBLISHED_LOCALES` sem completude (dado + i18n de UI + hreflang) e revisao humana — traducao cega nunca e indexada.
- **NUNCA** criar ou alterar schema/migrations fora de tarefa aprovada para banco.
- **NUNCA** tratar a `Public Marketing Home v4` (`/pt`) como `Public Catalog Index`, nem tratar um ajuste do `Home Hero Carousel` como autorizacao para reescrever a home inteira. Antes de qualquer alteracao visual, consultar [`docs/frontend/page-map.md`](docs/frontend/page-map.md) (mapa de telas e escopo).
