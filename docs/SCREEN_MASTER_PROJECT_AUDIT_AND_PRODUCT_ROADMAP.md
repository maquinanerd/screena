# Screen — Auditoria Mestre do Projeto, Produto, Arquitetura e Roadmap

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

> **Escopo desta auditoria.** Documento somente-leitura. Nenhum arquivo de codigo, schema, CSS, banco, ingestao ou infraestrutura foi alterado. O objetivo e mapear o estado real do projeto Screen — arquitetura, dados reais vs placeholder, telas, funcoes, governanca — compara-lo com IMDb, Rotten Tomatoes, TMDB, TV Time, Trakt, Letterboxd e JustWatch, e propor um roadmap honesto.
>
> **Data:** 2026-07-08 · **Branch auditada:** `feat/home-hero-carousel` · **HEAD:** `5994755` · **Repositorio:** `maquinanerd/screena`.
>
> **Metodo.** Auditoria multi-agente: ~19 auditores especializados leram o codigo por dominio; as afirmacoes mais criticas passaram por verificadores adversariais (ceticos que tentaram refutar cada alegacao lendo o codigo) e por checagem manual direta do autor. Onde a evidencia nao foi conclusiva, o texto diz **"NAO FOI POSSIVEL CONFIRMAR"**. Todas as afirmacoes fortes citam `arquivo:linha`.
>
> **Legenda de marcadores.** **REAL** (funciona com dado real) · **PARCIAL** (existe, incompleto) · **PLACEHOLDER** (UI/dado fabricado ou de seed demo) · **NAO IMPLEMENTADO** (nao existe) · **DEBITO** (divida tecnica) · **RISCO** · **PROXIMO PASSO** · **BLOQUEIA PRODUCAO** / **NAO BLOQUEIA PRODUCAO**.

---

## Sumario executivo (TL;DR)

**O que o Screen e, hoje, na pratica:** um **catalogo de filmes/series/pessoas movido a TMDB**, com uma home v4 visualmente polida, envolto por uma **camada de governanca excepcionalmente forte** (13 invariantes travadas por testes e auditorias de render), mas com a **camada editorial propria — o diferencial competitivo declarado — ainda NAO ativada em producao**. A maior parte da superficie de dados vem do TMDB; o ativo proprio (content_blocks versionados, Screen Score, ratings atribuidos, onde-assistir) existe como **contrato de schema e pipeline offline**, nao como produto visivel.

**As cinco verdades mais importantes deste relatorio:**

1. **As estrelas nao sao reais no catalogo.** `screen_score` (nota editorial propria) so e gravado pelo **seed demo** (`apps/admin/scripts/public-demo-seed.ts`). A ingestao do TMDB **nunca** grava nota. Logo, todo titulo ingerido de verdade aparece **sem estrela**. O `vote_average` do TMDB e ingerido mas — corretamente — nunca exibido como nota. (Parte 12.)

2. **Ha placeholders que fingem dado real e vazam para producao.** O **ticker amarelo de episodios** (`EpisodesTicker`) e um array hardcoded ("Wednesday T2·E6 — Onde assistir NETFLIX") renderizado **sem gate de ambiente** (`apps/web/app/pt/page.tsx:648`), e os **chips de plataforma** nos tiles de serie tambem. Isso afirma estreia e disponibilidade de streaming inexistentes — tensiona as invariantes 6 (licenca) e 8 (anti-pirataria/afirmacao falsa). **BLOQUEIA PRODUCAO.** (Partes 7 e 13.)

3. **O canonical esta preso ao dominio de producao.** `SITE_URL = "https://thescreen.media"` e **hardcoded** (`apps/web/src/lib/site.ts:9`) e `robots.ts` libera `/` incondicionalmente. Um dominio temporario do EasyPanel serve canonical/sitemap apontando para `thescreen.media` **e fica indexavel** — risco de SEO direto. **BLOQUEIA PRODUCAO.** (Parte 20.)

4. **Falta a espinha entity-first de SEO.** Nao existem **rotas de temporada nem de episodio**; nao existe **model de usuario** (logo, nenhuma feature de tracking/social/watchlist/review de usuario, tipo TV Time/Trakt/Letterboxd); noticias, ratings externos e onde-assistir estao inativos como produto. (Partes 9, 11, 12, 13, 14, 15.)

5. **A governanca e o ativo mais maduro — mas a CI de `main` nao a aplica por inteiro.** As auditorias de pureza de render, separacao provider/fonte, IMDb≠RT e gate anti-thin sao reais e testadas. Porem o **CI commitado em `main` nao roda `audit:render` nem `build`** (existe so no working tree sujo), e nao ha teste que pegue "streaming/nota falsa na UI" — foi assim que o ticker mock passou. (Parte 22.)

**Veredito de uma linha:** o Screen esta com a **fundacao e a governanca certas**, e visualmente parece um produto, mas ainda **nao entrega o produto que promete** — antes do dominio oficial ele precisa de um ciclo curto de **saneamento (honestidade + deploy seguro)** e, depois, do **primeiro slice entity-first realmente indexavel** (temporadas/episodios + blocos de valor via Entity Writer). Detalhamento nas Partes 26–28.

---

## Indice

- **Parte 1** — Visao executiva do projeto
- **Parte 2** — Estado atual de deploy e infraestrutura
- **Parte 3** — Stack tecnica completa
- **Parte 4** — Banco de dados e modelagem
- **Parte 5** — Pipeline TMDB e ingestao
- **Parte 6** — Rotas publicas existentes
- **Parte 7** — Home `/pt` completa
- **Parte 8** — Catalogo de filmes
- **Parte 9** — Catalogo de series
- **Parte 10** — Pessoas, elenco e equipe
- **Parte 11** — Noticias e camada editorial
- **Parte 12** — Ratings, notas, estrelas e reviews
- **Parte 13** — Streaming availability / onde assistir
- **Parte 14** — Funcionalidades tipo TV Time / Trakt
- **Parte 15** — Funcionalidades tipo Letterboxd
- **Parte 16** — Funcionalidades tipo IMDb
- **Parte 17** — Funcionalidades tipo Rotten Tomatoes
- **Parte 18** — Funcionalidades tipo TMDB
- **Parte 19** — Explorar, busca e descoberta
- **Parte 20** — SEO programatico e paginas evergreen
- **Parte 21** — Admin, CMS e operacao editorial
- **Parte 22** — Governanca, invariantes e auditorias
- **Parte 23** — Performance, disco e infraestrutura de custo
- **Parte 24** — Seguranca e segredos
- **Parte 25** — Comparativo mestre de features
- **Parte 26** — Roadmap recomendado
- **Parte 27** — O que NAO fazer agora
- **Parte 28** — Conclusao executiva
- **Anexo A** — Sintese de riscos e debitos (critica de completude)

---


---

## Parte 1 — Visao executiva do projeto

### 1.1 O que e o Screen (definicao precisa, sem marketing)

**Screen** e um monorepo TypeScript/Next.js que se propoe a ser uma **base global de entretenimento _entity-first_**: filmes, series, temporadas, episodios e pessoas modelados como entidades canonicas, com ratings externos, "onde assistir", reviews e noticias agregados ao redor de cada obra, e uma **camada editorial propria** (textos gerados offline por IA, versionados e revisados) por cima do dado bruto de terceiros. A marca publica e **Screen**; o dominio canonico e `https://thescreen.media`; `Screena` e apenas namespace tecnico legado (`@screena/*`, tokens `--screena-*`). A definicao vive em `CLAUDE.md:9-19`, `README.md:5`, `THE_SCREEN.md:3-11` e `docs/SPEC.md:29-50`.

Tirando o marketing, o que **de fato existe hoje** no repositorio e um objeto muito mais modesto do que a SPEC descreve:

- Um **monorepo pnpm** (Node 22, TS strict, ESM) com `apps/web` (Next.js 15 App Router, React 19), `apps/admin` (painel interno), pacotes compartilhados (`config`, `schemas`, `seo`, `ui`, `types`, `db`) e servicos offline (`ingestion`, `sync`, `entity-writer`).
- Um **schema Prisma/PostgreSQL** robusto (804 linhas em `packages/db/prisma/schema.prisma`) com toda a governanca de ratings/licencas/indexabilidade modelada — mas com a maioria das tabelas de produto ainda **sem caminho de escrita ou leitura ativo**.
- Um **client TMDB real** (`api-clients/tmdb`) e uma **ingestao offline** (`services/ingestion`) que hoje puxa uma lista curada fixa de 10 filmes + 10 series + upcoming.
- Um conjunto de **rotas publicas pt-BR** (`/pt`, `/pt/filmes`, `/pt/series`, `/pt/pessoas`, `/pt/noticias` e detalhes por slug) que renderizam lendo **somente PostgreSQL** — sem API externa nem Gemini no render.
- Uma **camada de governanca muito forte** (13 invariantes em `CLAUDE.md`, regras em `.claude/rules/*`, testes em `tests/governance/`, auditorias `audit:render`/`audit:invariants`).

A frase mais honesta para descrever o estado atual: **na pratica, hoje o Screen e um catalogo TMDB reembalado com governanca forte e camada editorial ainda NAO ativada.** A arquitetura para ser mais que isso existe; o conteudo que a justificaria, nao.

### 1.2 A visao do produto

A visao (documentada em `docs/SPEC.md:27-50`, `README.md:13-34`, `THE_SCREEN.md:7-21`) e clara e coerente:

> **"As APIs fornecem os dados. Screen escreve a camada editorial."**

O produto-alvo trata cada obra como **entidade canonica** com identidade estavel (slug proprio, IDs externos mapeados, tipo bem definido, schema.org correspondente) e agrega ao redor dela: ficha, ratings externos atribuidos (IMDb, Rotten Tomatoes, Metacritic, Letterboxd, FilmAffinity — cada um na sua escala, com licenca e atribuicao), disponibilidade de streaming por pais, contexto editorial proprio e noticias relacionadas. O diferencial competitivo declarado **nao** e reexibir dado de terceiro, e sim a **camada editorial verificavel**: `content_blocks` versionados (`prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`, `review_status`), gerados offline pelo Entity Writer e revisados por humano antes de indexar.

A regra central que molda toda a arquitetura (`README.md:30-34`, invariantes 3/4): **zero API externa no render, zero Gemini no render.** Toda pagina publica indexavel le apenas PostgreSQL/cache local; sincronizacao externa e geracao de IA sao pipelines separados do caminho de request.

### 1.3 O que o Screen e — e o que NAO e (uma a uma, com evidencia)

| Pergunta | Veredito | Evidencia |
| --- | --- | --- |
| E um portal de noticias? | **NAO** (noticias sao camada de frescor, nao o nucleo) | `THE_SCREEN.md:11,689`; models `Article`/`ArticleTranslation` existem (`schema.prisma`), rota `/pt/noticias` existe, mas ingestao RSSPRIME/MN26 e **PLACEHOLDER** (`THE_SCREEN.md:511,837`). Legado "The Nerd News" foi explicitamente abandonado (`CLAUDE.md:12`). |
| E um catalogo de filmes/series? | **PARCIAL** — e o que mais se aproxima de real hoje | Rotas `/pt/filmes` e `/pt/series` com listagem+detalhe existem; catalogo = lista curada fixa de 10+10 titulos TMDB (`ingest-public-catalog.ts`, `MOVIE_IDS`/`TV_IDS`), sem paginacao em massa (`docs/SCREEN_STATUS...:126-129`). |
| E um tracker tipo TV Time/Trakt? | **NAO IMPLEMENTADO** | Nao existe model `User`/`Session`/`Account`/`Watchlist`/`Review` no schema (grep confirmado, 0 matches em `schema.prisma`). Sem auth, watchlist, progresso de episodio, favoritos ou ratings de usuario (`THE_SCREEN.md:227-229,842-845`). |
| E um banco de entidades tipo TMDB? | **PARCIAL** — e a ambicao estrutural real | Modelagem entity-first solida (movies, tv_shows, seasons, episodes, people, slugs, external_ids polimorficos). Mas nao ha rota de temporada nem de episodio em `apps/web/app/pt/series/` (so `/pt/series` e `/pt/series/[slug]`); e o "banco" e populado por reembalagem de TMDB, nao curadoria propria. |
| E um agregador de reviews tipo Rotten Tomatoes? | **NAO IMPLEMENTADO** | `external_ratings` existe com toda a governanca (`schema.prisma`), `validateRating` existe (`packages/schemas/src/ratings.ts`), mas **nunca e escrito nem lido** (`docs/SCREEN_STATUS...:305-309`). Reviews proprias tambem inativas. |
| E uma base editorial evergreen? | **PARCIAL / aspiracional** | O Entity Writer offline existe (`services/entity-writer`) e o slice ativo cobre `editorial_intro`/`cast_intro` em pt-BR (`.claude/rules/entity-writer.md`), mas nao ha evidencia de blocos editoriais revisados em escala populando as paginas reais. |

**Concorrente parcial de quem?** No papel, o Screen mira o espaco de IMDb + Rotten Tomatoes + TMDB + TV Time + Letterboxd + Trakt + JustWatch simultaneamente. Na entrega atual: **compete de verdade com nenhum deles.** Ele nao rastreia (TV Time/Trakt), nao agrega ratings (Rotten/IMDb/Letterboxd), nao mostra onde assistir (JustWatch) e, como banco de entidades (TMDB), e apenas um subconjunto reembalado de 20 titulos do proprio TMDB. O unico eixo em que ja tem substancia e o **eixo de governanca/SEO editorial**, que nenhum daqueles concorrentes prioriza da mesma forma.

### 1.4 O nucleo e a entidade — noticias sao camada de frescor

O ponto de posicionamento mais importante, repetido em toda a documentacao (`CLAUDE.md:11`, `THE_SCREEN.md:11,689`, `docs/SPEC.md:34-39`, `docs/frontend/page-map.md:9-12`): **Screen e entity-first.** A entidade canonica (um filme, uma serie, uma pessoa) e o centro gravitacional evergreen; noticias e editoriais funcionam como **camada de frescor e contexto** que orbita a entidade, nunca como o produto em si. Isso e reforcado por decisao arquitetural explicita ("Entity-first em vez de portal apenas noticioso", `THE_SCREEN.md:689`) e pelo contrato de escopo do `page-map.md`, que separa `Public Marketing Home v4` de `Public Catalog Index` de `Entity Detail Pages`. A home `/pt` e uma superficie editorial/cinematografica — **nao** um catalogo generico (`page-map.md:9-24`).

### 1.5 Estagio atual, camada por camada (com evidencia)

| Camada | Marcador | Evidencia |
| --- | --- | --- |
| Monorepo, TS strict, CI, pacotes puros testaveis | **REAL** | `README.md:66-76`; `THE_SCREEN.md:547-556` |
| Schema Prisma/PostgreSQL (govern. ratings/licenca/index) | **REAL** (como contrato) | `schema.prisma` 804 linhas; enums e models de governanca presentes |
| Client TMDB + ingestao offline + sync/stale + logs | **REAL** | `api-clients/tmdb`; `services/ingestion`; `docs/SCREEN_STATUS...:122-147` |
| Rotas publicas pt-BR (home, filmes, series, pessoas, noticias) | **REAL** (estrutura) / **PARCIAL** (conteudo) | `THE_SCREEN.md:327-341` |
| Render puro (zero API/Gemini no render) + gate anti-thin | **REAL** | `docs/SCREEN_STATUS...:132-141`; `packages/seo` |
| Entity Writer offline + adapter Gemini separado | **REAL** (pipeline) / **PARCIAL** (uso) | `services/entity-writer`; `.claude/rules/entity-writer.md` |
| Hero-carousel v4.1 com arte TMDB remota | **REAL** | `docs/SCREEN_STATUS...:214-236` |
| Catalogo real (10 filmes + 10 series + upcoming) | **PARCIAL** (curadoria fixa, sem escala) | `ingest-public-catalog.ts:59-60` |
| screen_score (nota editorial propria, estrelas) | **PLACEHOLDER/seed** — vazio em prod real | So `apps/admin/scripts/public-demo-seed.ts:261-323` grava; ingestao TMDB nunca escreve `screenScore` (grep confirmado: so `voteAverageTmdb` em `store.ts:161,204`) |
| Ratings externos (IMDb/RT/Metacritic) | **NAO IMPLEMENTADO** | `external_ratings` nunca escrito/lido (`docs/SCREEN_STATUS...:305-309`) |
| Streaming / onde assistir | **NAO IMPLEMENTADO** (model existe) | `WatchAvailability` no schema, UI publica ausente (`THE_SCREEN.md:509-510`) |
| Episodes Ticker (faixa amarela) | **PLACEHOLDER** que **VAZA p/ producao** | Mock hardcoded, chamado ungated em `apps/web/app/pt/page.tsx:648` (fora de `allowHomeVisualPlaceholders`) |
| Chips de plataforma nos tiles de serie | **PLACEHOLDER** sem gate | `docs/SCREEN_STATUS...:388-391` |
| Busca publica | **NAO IMPLEMENTADO** | `THE_SCREEN.md:270,845`; "Busca" no header e link p/ `/pt/explorar` |
| Usuarios / auth / watchlist / reviews / listas | **NAO IMPLEMENTADO** | Sem model `User`/`Session` (grep 0 matches); `THE_SCREEN.md:227-229` |
| Admin editorial (read-only + acoes gateadas) | **REAL** (estreito) | Server Actions atras de `ADMIN_EDITORIAL_ACTIONS_ENABLED` (`THE_SCREEN.md:299-304`) |
| Rota de temporada / episodio | **NAO IMPLEMENTADO** | So `/pt/series` e `/pt/series/[slug]` em `apps/web/app/pt/series/` |
| Deploy CloudPanel/systemd | **PLACEHOLDER** (documentado, nao validado) | `THE_SCREEN.md:513,839`; deploy real e EasyPanel/Nixpacks (`docs/SCREEN_STATUS...:99-104`) |

### 1.6 Paragrafo brutalmente honesto — o usuario que entra HOJE em thescreen.media

Um usuario que abrisse `https://thescreen.media` hoje cairia em `/pt` e veria uma **home editorial cinematografica bem construida**: um hero-carousel com arte real de TMDB (backdrops), secoes de "Destaques", "Filmes em destaque", "Series em destaque", estatisticas reais de catalogo e um bloco "Em breve" alimentado por dados reais de lancamentos. Ele conseguiria **navegar** por cerca de 10 filmes e 10 series, abrir a ficha de cada um (com sinopse, elenco, imagens de TMDB) e ler algumas paginas de pessoa e de noticia. E so isso. O que ele **NAO** conseguiria fazer: **buscar** um titulo (a "busca" e so um link para explorar), **criar conta**, montar **watchlist**, **avaliar**, **marcar como assistido**, ver **onde assistir** de verdade, ver **nota de IMDb/Rotten/Metacritic**, ou navegar por **temporadas/episodios**. Pior: em uma base populada por ingestao real (sem o seed demo), os titulos aparecem **sem estrelas** — porque `screen_score` so e escrito pelo seed demo e a ingestao TMDB nunca o preenche. E ele veria uma **faixa amarela afirmando "novo episodio hoje" com "Onde assistir Netflix"** que e 100% mock hardcoded e vaza para producao, sugerindo streaming inexistente e ferindo as invariantes 6 e 8. Em resumo: **uma vitrine bonita e honesta na maioria dos blocos, mas essencialmente nao-interativa, com catalogo minusculo, sem as features que definem cada concorrente que ela pretende enfrentar, e com pelo menos um mock enganoso escapando para o publico.**

### 1.7 Identidade prometida vs. realidade entregue

| Identidade prometida (docs) | Realidade entregue (codigo) | Marcador |
| --- | --- | --- |
| Base global de entretenimento entity-first | Modelagem entity-first real, mas catalogo = 10+10 titulos TMDB curados | **PARCIAL** |
| "As APIs fornecem dados; Screen escreve a camada editorial" | Pipeline do Entity Writer existe; camada editorial em escala **nao** popula as paginas | **PARCIAL / NAO ATIVADO** |
| Ratings externos atribuidos (IMDb/RT/Metacritic/Letterboxd/FilmAffinity) | `external_ratings` + `validateRating` existem mas nunca escritos/lidos | **NAO IMPLEMENTADO** |
| Onde assistir por pais, com licenca e disponibilidade reais | `WatchAvailability` modelado; sem UI; mocks (ticker/chips) simulam streaming | **NAO IMPLEMENTADO** + **RISCO** |
| Nota propria confiavel (screen_score, estrelas) | So o seed demo popula; base real fica sem estrelas | **PLACEHOLDER / DEBITO** |
| Zero API externa no render / zero Gemini no render | Cumprido e travado por `audit:render`/guards | **REAL** |
| Gate anti-thin (>=2 blocos de valor) decide indexacao | Implementado (`packages/seo`, `evaluatePortalIndexability`) | **REAL** |
| pt-BR primeiro; en/es draft/noindex | Cumprido no seed de `Language` e nas regras de indexabilidade | **REAL** |
| Tracker/watchlist/perfil/reviews de usuario | Sem model de usuario; nenhuma feature interativa | **NAO IMPLEMENTADO** |
| Busca publica | Ausente; header aponta para `/pt/explorar` | **NAO IMPLEMENTADO** |
| Dominio canonico `thescreen.media` configuravel | `SITE_URL` **hardcoded** em `apps/web/src/lib/site.ts:9`; env de dominio nunca lida | **DEBITO / RISCO** |
| Sem pirataria / sem dado sem licenca em pagina indexavel | Regra respeitada no geral, mas Episodes Ticker mock vaza streaming falso | **RISCO** (invariantes 6/8) |

### 1.8 Sumario executivo (bullets)

- **O Screen e, na pratica, hoje: um catalogo TMDB reembalado (20 titulos curados) com uma home v4 cinematografica honesta e uma governanca/arquitetura excepcionalmente forte — mas com a camada editorial e todas as features de produto ainda NAO ativadas.** **PARCIAL**
- A **fundacao tecnica e REAL e solida**: monorepo, TS strict, Prisma/PostgreSQL, client TMDB, ingestao offline com logs/resiliencia, render puro (zero API/Gemini), gate anti-thin, CI e testes de governanca.
- A **entidade e o nucleo**; noticias sao camada de frescor. Esse posicionamento e coerente na doc e refletido na arquitetura (entity-first, `page-map.md`). **REAL** como intencao.
- **Nao ha usuario, auth, watchlist, tracking, reviews, listas nem busca** — nao existe model `User`/`Session` no schema. O Screen **nao compete** hoje com TV Time, Trakt, Letterboxd ou IMDb social. **NAO IMPLEMENTADO**
- **Ratings externos e streaming sao contrato de schema, nao produto**: `external_ratings`/`WatchAvailability` modelados e governados, mas nunca escritos/lidos. **NAO IMPLEMENTADO**
- A **nota propria (screen_score) so existe via seed demo**; a ingestao TMDB nunca preenche o campo, entao a base real fica **sem estrelas**. **DEBITO / RISCO**
- Dois **mocks vazam para producao**: o Episodes Ticker (afirma episodio novo + "onde assistir Netflix") ungated em `page.tsx:648`, e os chips de plataforma nos tiles de serie — ambos sugerem streaming inexistente e tensionam as invariantes 6/8. **RISCO / BLOQUEIA PRODUCAO**
- O **dominio canonico e hardcoded** (`SITE_URL = "https://thescreen.media"`, `site.ts:9`); a env `THE_SCREEN_PUBLIC_SITE_URL` nunca e lida, entao canonical/OG/sitemap sempre apontam para producao mesmo em staging. **DEBITO / RISCO**
- O maior risco estrategico e o descrito pela propria doc (`THE_SCREEN.md:863`): **ficar preso em documentacao e auditoria de altissima qualidade sem entregar produto visivel** — a governanca esta muito a frente do produto.
- **PROXIMO PASSO** honesto: gatear/remover os mocks que vazam, decidir a politica de nota (screen_score editorial real ou ocultar estrela), ampliar o catalogo alem dos 20 titulos e ativar a primeira feature interativa (busca local) antes de qualquer indexacao no dominio oficial.


---

## Parte 2 — Estado atual de deploy e infraestrutura

### 2.0 Método, escopo e limites desta auditoria

Auditoria **somente leitura** do monorepo em `E:\Área de Trabalho 2\Screnaa`, branch `feat/home-hero-carousel`, HEAD local `5994755`. Nenhum arquivo do repositório foi alterado; nenhum build, migration, servidor ou chamada externa foi executado.

Limite duro e inegociável desta seção: **eu não tenho acesso ao painel EasyPanel, ao host, ao container `screen-app`, ao container `screen-db`, ao DNS, ao Cloudflare, nem a qualquer variável de ambiente de produção.** Tudo que é afirmado sobre o EasyPanel vem de duas fontes secundárias:

1. `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md` (commit `5994755`, o commit mais recente do repo) — que é ele próprio um relatório, não configuração executável;
2. relato verbal do operador (números de disco, nomes de serviço).

Portanto: **NAO FOI POSSIVEL CONFIRMAR** nada da configuração real do EasyPanel a partir do código. O que falta para confirmar: acesso ao painel (build command, start command, env vars, healthcheck, domínio, volumes) e um shell no container. Onde eu digo "reportado", trate como testemunho, não como fato verificado.

O que **é** verificável: o repositório. E o repositório diz coisas que **contradizem** o deploy descrito.

---

### 2.1 Existem DOIS deploys neste projeto, e eles não são o mesmo

Este é o achado estrutural da seção. O repositório documenta em detalhe um deploy que **não é o que está no ar**, e não documenta em lugar nenhum o deploy que **está** no ar.

| Dimensão | Deploy **documentado** (`docs/CLOUDPANEL_DEPLOY.md`) | Deploy **reportado como real** (EasyPanel) |
| --- | --- | --- |
| Plataforma | VPS + CloudPanel (`docs/CLOUDPANEL_DEPLOY.md:29-61`) | EasyPanel (PaaS sobre Docker) |
| Proxy/TLS | Nginx gerado pelo CloudPanel + Let's Encrypt (`docs/CLOUDPANEL_DEPLOY.md:123-134`) | Traefik do EasyPanel (inferido; **NAO FOI POSSIVEL CONFIRMAR**) |
| Empacotamento | Release folders + symlink `current` (`docs/CLOUDPANEL_DEPLOY.md:208-222`) | Imagem Docker construída por Nixpacks |
| Processo do app | `systemd` `the-screen-web.service` executando `.next/standalone/server.js` (`docs/CLOUDPANEL_DEPLOY.md:403-430`) | `next start` no container (inferido) |
| Workers offline | `systemd` timers (`docs/CLOUDPANEL_DEPLOY.md:373-393`) | **nenhum** — ingestão é manual |
| Banco | Postgres local no VPS ou gerenciado (`docs/CLOUDPANEL_DEPLOY.md:97-103`) | serviço `screen-db` do EasyPanel |
| Segredos | `shared/.env.production` chmod 600 (`docs/CLOUDPANEL_DEPLOY.md:224-237`) | env vars do painel EasyPanel |
| Status | **PLACEHOLDER** — guia ilustrativo, nunca executado | **PARCIAL** — no ar, mas não descrito no repo |

O próprio `docs/CLOUDPANEL_DEPLOY.md:10-14` se declara "procedimento de referência" cujos "comandos continuam ilustrativos". `THE_SCREEN.md:513` diz literalmente: *"CloudPanel/VPS/systemd | Documentado | ... deploy real não é comprovado pelo repo."* E `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:102-104` reconhece: *"o `docs/CLOUDPANEL_DEPLOY.md` descreve um caminho de deploy diferente ... não confundir os dois."*

**RISCO / NAO BLOQUEIA PRODUCAO (mas bloqueia manutenção):** o único documento de deploy do repositório descreve infraestrutura inexistente. Um mantenedor novo que seguir `docs/CLOUDPANEL_DEPLOY.md` reproduzirá um ambiente que não é o de produção, com nomes de serviço (`the-screen-web.service`), caminhos (`~/htdocs/thescreen.media/current`) e artefatos (`.next/standalone/server.js`) que não existem.

**PROXIMO PASSO:** criar `docs/EASYPANEL_DEPLOY.md` como documento operacional canônico do deploy vigente, e rebaixar `docs/CLOUDPANEL_DEPLOY.md` a "arquitetura-alvo futura / referência histórica" logo no título.

---

### 2.2 Inventário item-a-item: o que existe no repositório sobre deploy

| Artefato | Existe? | Caminho | Status | Evidência |
| --- | --- | --- | --- | --- |
| `Dockerfile` | Não | — | **NAO IMPLEMENTADO** | `find` na raiz não retorna nenhum `Dockerfile*` |
| `nixpacks.toml` | Não | — | **NAO IMPLEMENTADO** | idem; nenhuma ocorrência de "nixpacks" fora de `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md` |
| `Procfile` | Não | — | **NAO IMPLEMENTADO** | idem |
| `docker-compose.yml` (prod) | Não | — | **NAO IMPLEMENTADO** | só existe o `.dev` |
| `docker-compose.dev.yml` | Sim | `docker-compose.dev.yml` | **REAL** (só dev) | Postgres 16-alpine, porta 5432 exposta, healthcheck `pg_isready` (`docker-compose.dev.yml:1-23`) |
| Scripts de deploy | Não | `scripts/deploy/` | **NAO IMPLEMENTADO** | só `README.md`; "Scripts previstos (a implementar)" em `scripts/deploy/README.md:69-77` |
| Scripts de backup | Não | `scripts/backup/` | **NAO IMPLEMENTADO** | `scripts/backup/README.md:3-5`: *"Hoje ainda existe apenas este README ... Nenhum backup real roda agora."* |
| Unit systemd do app web | Não (só exemplo em doc) | — | **PLACEHOLDER** | bloco ilustrativo em `docs/CLOUDPANEL_DEPLOY.md:403-430` |
| Unit systemd de worker | Sim, **um par** | `services/sync/systemd/screena-tmdb-catalog.service` e `.timer` | **PARCIAL** | únicos `.service`/`.timer` reais do repo |
| CI | Sim | `.github/workflows/ci.yml` | **REAL** (sem deploy) | typecheck, lint, test, `audit:invariants`, `audit:render`, build (`.github/workflows/ci.yml:29-45`) |
| CD / workflow de deploy | Não | — | **NAO IMPLEMENTADO** | `.github/workflows/` só tem `ci.yml` |
| Healthcheck HTTP no app público | Não | — | **NAO IMPLEMENTADO** | ver §2.5 |
| Healthcheck HTTP no admin | Sim | `apps/admin/app/health/page.tsx` | **REAL** (HTML, não JSON) | ping `SELECT 1` + contagens (`apps/admin/src/server/health.ts:29-45`) |
| `.env` versionado | Não (correto) | — | **REAL** | `.gitignore` ignora `.env` e `.env.*`, exceto `.env.example`; `git ls-files` só lista `.env.example` |

Nota sobre `docker-compose.dev.yml`: é o único lugar do repo com healthcheck (`docker-compose.dev.yml:15-19`), e ele checa o **Postgres de desenvolvimento**, não o app.

---

### 2.3 EasyPanel: projeto `rss_prime`, serviços `screen-app` e `screen-db`

Verificação literal por grep em todo o repositório (excluindo `node_modules` e `.git`):

| Termo | Ocorrências no repo | Onde |
| --- | --- | --- |
| `easypanel` | 16 | **exclusivamente** em `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md` |
| `screen-app` | 2 | idem (`:106`, `:575`) |
| `screen-db` | 3 | idem (`:72`, `:106`, `:465`) |
| `rss_prime` | **0** | nenhuma. Só há `rssprime`/`RSSPRIME` como *nome de feature futura* (`.claude/rules/ingestion.md:49`, `docs/BUILD_PLAN.md:53`, `CLAUDE.md:21`) |
| `nixpacks` | 4 | idem, sempre como inferência ("Nixpacks auto-detectado") |

Conclusões honestas:

- **Projeto `rss_prime` no EasyPanel: NAO FOI POSSIVEL CONFIRMAR.** O nome não aparece em nenhum arquivo do repositório. O que existe no código é o conceito de *RSS Prime* como fonte de notícias **não implementada** (roadmap, Fase 9 em `docs/BUILD_PLAN.md:53`). O fato de o app do Screen morar dentro de um projeto EasyPanel chamado `rss_prime` é, portanto, um acidente de organização do painel — o monorepo não tem nenhuma dependência do serviço `feed`/RSS Prime (`docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:73`).
- **`screen-app` / `screen-db`: NAO FOI POSSIVEL CONFIRMAR** pelo código. São nomes de serviço do painel, não do repo. O que o repo confirma é que o app precisa de **exatamente um** Postgres alcançável por `DATABASE_URL` (§2.6).
- **Porta 3000: REAL, mas por default implícito.** Não existe `PORT` sendo lido em lugar nenhum do código (`grep process.env` não retorna `PORT` em `apps/web`). O 3000 vem do default do `next start` (`apps/web/package.json:10`). O `docs/CLOUDPANEL_DEPLOY.md:82` e `:418` fixam `PORT=3000`, mas isso é doc, não código. Se o EasyPanel injetar `PORT`, o Next respeita; se não, cai em 3000.
- **Nixpacks: PARCIAL / inferido.** É a conclusão correta por eliminação (não há `Dockerfile` nem `nixpacks.toml`), mas o *build command* e o *start command* efetivos vivem no painel, não no repo. Isso importa muito — ver §2.4.
- **RISCO:** um projeto EasyPanel compartilhado (`rss_prime`) hospedando `feed` (RSS Prime), `screen-app` e `screen-db` significa **superfície de blast radius compartilhada**: rede interna comum, mesmo host, mesmo disco. O `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:106-107` já instrui "não tocar" no `feed`. Isso é convenção humana, não isolamento técnico.

---

### 2.4 Como o app sobe: build command, start command, e três contradições

#### O que o repositório declara

| Etapa | Comando | Arquivo:linha |
| --- | --- | --- |
| Gerenciador | `pnpm@9.15.4` via Corepack | `package.json:6` |
| Runtime | Node `>=22 <23`; `.nvmrc` = `22` | `package.json:8-11`, `.nvmrc:1` |
| Build (raiz) | `corepack pnpm --filter @screena/web build` | `package.json:13` |
| Build (app) | `next build` | `apps/web/package.json:9` |
| Start (app) | `next start` | `apps/web/package.json:10` |
| Start (raiz) | **NÃO EXISTE** | `package.json:12-20` não tem `start` |

#### Contradição 1 — não há `start` na raiz  **RISCO / NAO BLOQUEIA PRODUCAO**

O `package.json` da raiz tem `build`, `lint`, `typecheck`, `test`, `audit:invariants`, `audit:render` — e nenhum `start` (`package.json:12-20`). Nixpacks, ao detectar Node/pnpm, tenta `pnpm start` na raiz por padrão. Como o script não existe, **o start command tem obrigatoriamente que ter sido configurado à mão no painel EasyPanel** (algo como `pnpm --filter @screena/web start` ou `cd apps/web && pnpm start`).

**NAO FOI POSSIVEL CONFIRMAR** qual comando está lá. **PROXIMO PASSO:** adicionar `"start": "corepack pnpm --filter @screena/web start"` ao `package.json` da raiz, para que o start pare de ser conhecimento tácito de painel.

#### Contradição 2 — `output: 'standalone'` NÃO está configurado  **DEBITO / RISCO**

`docs/CLOUDPANEL_DEPLOY.md:264-265` manda: *"Garanta `output: 'standalone'` no `next.config` para um bundle de runtime enxuto"*, e o unit systemd de exemplo executa `ExecStart=/usr/bin/node apps/web/.next/standalone/server.js` (`docs/CLOUDPANEL_DEPLOY.md:420`).

O `apps/web/next.config.ts:21-45` **não tem** a chave `output`. Só há `reactStrictMode`, `trailingSlash`, `transpilePackages` e um `webpack.resolve.extensionAlias`. Logo:

- `apps/web/.next/standalone/server.js` **não existe** — o unit systemd documentado falharia na primeira execução;
- o runtime precisa do `node_modules` **inteiro** presente ao lado do `.next`, porque `next start` não é auto-contido.

Essa é a explicação técnica direta do tamanho reportado (§2.11): `.next` ~3,8 MB (build normal, não standalone) + `node_modules` ~977 MB = ~987 MB de imagem. Com `output: 'standalone'`, a imagem de runtime cairia para a ordem de dezenas/poucas centenas de MB.

**PROXIMO PASSO (alto retorno, baixo risco):** adicionar `output: "standalone"` ao `apps/web/next.config.ts`, ajustar o start command para `node apps/web/.next/standalone/apps/web/server.js` (o caminho em monorepo tem esse aninhamento) e copiar `.next/static` + `public`. Validar em staging antes.

#### Contradição 3 — `prisma generate` não está em nenhum build  **RISCO / potencialmente BLOQUEIA PRODUCAO**

`apps/web` importa o Prisma Client **dentro do grafo de build do Next**:

- `apps/web/next.config.ts:30` põe `@screena/db` em `transpilePackages`;
- `apps/web/src/server/*.ts` importam `getPrismaClient` de `@screena/db/server` (11 arquivos: `home-hero.ts:15`, `entity-indexes.ts:15`, `home-upcoming.ts:16`, `movie-page.ts:19`, `news-pages.ts:15`, `person-page.ts:15`, `related-news.ts:16`, `entity-cast.ts:14`, `entity-watch.ts:13`, `seo/sitemap-entries.ts:18`, etc.);
- `packages/db/src/server.ts:12` faz `import { PrismaClient } from '@prisma/client'`.

O `@prisma/client` só funciona depois de `prisma generate`. O script existe (`packages/db/package.json`, `"db:generate": "prisma generate"`), mas **não é chamado por `pnpm build`** (`package.json:13` chama só `next build`), nem pelo CI (`.github/workflows/ci.yml:26-45` faz `pnpm install --frozen-lockfile` e vai direto para typecheck/build).

O que sustenta o build hoje é o `postinstall` do próprio `@prisma/client@6.19.3` (confirmei que a chave `postinstall` existe no `package.json` do pacote instalado). Isso é frágil: pnpm pode bloquear scripts de dependência, o `postinstall` pode não localizar `packages/db/prisma/schema.prisma` a partir do `INIT_CWD` da raiz, e o comportamento muda entre versões de pnpm/Prisma.

**NAO FOI POSSIVEL CONFIRMAR** se o build do EasyPanel roda `prisma generate` explicitamente. **PROXIMO PASSO:** tornar explícito — `"build": "corepack pnpm --filter @screena/db db:generate && corepack pnpm --filter @screena/web build"`.

#### O que salva o build hoje: `force-dynamic`

`next build` **não** precisa de `DATABASE_URL`, porque nenhuma página é pré-renderizada com dado:

| Rota | Diretiva | Arquivo:linha |
| --- | --- | --- |
| `/pt/` (home) | `force-dynamic` | `apps/web/app/pt/page.tsx:60` |
| `/pt/filmes/` | `force-dynamic` | `apps/web/app/pt/filmes/page.tsx:21` |
| `/pt/series/` | `force-dynamic` | `apps/web/app/pt/series/page.tsx:21` |
| `/pt/pessoas/` | `force-dynamic` | `apps/web/app/pt/pessoas/page.tsx:21` |
| `/pt/noticias/` | `force-dynamic` | `apps/web/app/pt/noticias/page.tsx:19` |
| `/pt/explorar/` | `force-dynamic` | `apps/web/app/pt/explorar/page.tsx:45` |
| `/sitemap.xml` | `force-dynamic` | `apps/web/app/sitemap.ts:20` |
| `/pt/filmes/[slug]/` | `revalidate = 3600` (ISR) | `apps/web/app/pt/filmes/[slug]/page.tsx:33` |
| `/pt/series/[slug]/` | `revalidate = 3600` | `apps/web/app/pt/series/[slug]/page.tsx:19` |
| `/pt/pessoas/[slug]/` | `revalidate = 3600` | `apps/web/app/pt/pessoas/[slug]/page.tsx:23` |
| `/pt/noticias/[slug]/` | `force-dynamic` | `apps/web/app/pt/noticias/[slug]/page.tsx:20` |

**DEBITO:** com `force-dynamic` em toda listagem e na home, **não há cache de página**. Cada request de `/pt/` executa `getHomeHeroSlides` + `getMovieIndexData` + `getSeriesIndexData` + `getNewsIndexData` + `getHomeUpcomingMovies` contra o Postgres. Isso não fere nenhuma invariante (é PostgreSQL, não API externa), mas é uma decisão de custo/latência que ninguém tomou explicitamente — veio de conveniência de build. **PROXIMO PASSO:** migrar home e listagens para `revalidate` (ISR) quando o conteúdo estabilizar.

---

### 2.5 Healthcheck: não existe no app público

| Fato | Status | Evidência |
| --- | --- | --- |
| `apps/web/app/page.tsx` (rota `/`) | **NAO IMPLEMENTADO** | a árvore de `apps/web/app` não tem `page.tsx` na raiz — só `layout.tsx`, `robots.ts`, `sitemap.ts`, `globals.css` e subpastas |
| `GET /` retorna | **404** (página não encontrada do Next) | consequência direta do acima |
| Rota `/api/health` ou `/healthz` | **NAO IMPLEMENTADO** | não há `apps/web/app/api/**` |
| Aliases de conveniência | `/filmes/` → 308 → `/pt/filmes/` | `apps/web/app/filmes/page.tsx:14-16` (`permanentRedirect`) |
| Healthcheck do admin | **REAL**, mas é uma **página HTML** e está atrás de Basic Auth | `apps/admin/app/health/page.tsx:11-13`; `apps/admin/middleware.ts:35-39` |
| `healthcheck.sh` previsto | **NAO IMPLEMENTADO** | `scripts/deploy/README.md:77` |
| Smoke test antes de promover release | **NAO IMPLEMENTADO** | descrito como alvo em `scripts/deploy/README.md:59-60` |

**RISCO / NAO BLOQUEIA PRODUCAO (mas quebra observabilidade):** se o EasyPanel estiver configurado com healthcheck HTTP em `/` (default comum), ele recebe **404** — o container pode ser marcado como não-saudável, reiniciado em loop, ou (pior) o healthcheck foi desligado e ninguém observa nada. **NAO FOI POSSIVEL CONFIRMAR** o que está configurado.

**PROXIMO PASSO:** criar `apps/web/app/api/health/route.ts` (`export const dynamic = "force-dynamic"`) que devolva `200` + JSON `{ ok: true, db: boolean }` fazendo `SELECT 1` — espelhando `apps/admin/src/server/health.ts:29-33`, que já faz exatamente isso e **nunca vaza `DATABASE_URL` nem a mensagem crua do erro** (`apps/admin/src/server/health.ts:47-50`). Alternativa mínima e imediata: apontar o healthcheck do painel para `/pt/` (que retorna 200) em vez de `/`.

---

### 2.6 Banco: como conecta, migrations, seeds

#### Conexão

| Fato | Status | Evidência |
| --- | --- | --- |
| Única fonte de conexão | `env("DATABASE_URL")` | `packages/db/prisma/schema.prisma:19-22` |
| `directUrl` / URL de pooler separada | **NAO IMPLEMENTADO** | o `datasource db` só tem `provider` e `url` |
| Pool / connection limit configurado | **NAO IMPLEMENTADO** | `new PrismaClient()` sem opções (`packages/db/src/server.ts:19`) |
| Singleton por processo | **REAL** | `packages/db/src/server.ts:15-22` (`let client: PrismaClient \| undefined`) |
| Render lê só Postgres | **REAL**, travado por auditoria | `scripts/audit/check-render-purity.mjs` (bloqueia `fetch(` a hosts externos e imports de `@screena/db` em páginas/client components) |
| `sslmode=require` em banco gerenciado | documentado, não codificado | `docs/CLOUDPANEL_DEPLOY.md:100-102`, `:559` |

**DEBITO:** `PrismaClient` sem `connection_limit` explícito. Em `next start` (não-serverless) o singleton por processo é adequado, mas com `force-dynamic` em todas as listagens, um pico de tráfego abre muitas queries concorrentes contra o pool default do Prisma (`num_cpus * 2 + 1`). Não é bug, é falta de tuning consciente.

**RISCO:** `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:466-467` registra que *"o Prisma CLI não lê o `.env` da raiz (exportar `DATABASE_URL` inline)"*. Isso vale para `prisma migrate deploy` no container. Não é bug do Prisma (a `schema` fica em `packages/db/prisma`, e o CLI procura `.env` ao lado dela); é uma armadilha operacional real: rodar `prisma migrate deploy` sem `DATABASE_URL` exportado falha, e rodar com a URL errada migra o banco errado.

#### Migrations

| Fato | Status | Evidência |
| --- | --- | --- |
| Migrations existem | **REAL** — 3 | `packages/db/prisma/migrations/20260625120000_init`, `20260701120000_add_news_articles`, `20260706120000_add_certification_screen_score` |
| Comando de deploy | **REAL** | `packages/db/package.json` → `"db:migrate:deploy": "prisma migrate deploy"` |
| Migrations **automáticas** no deploy | **NAO IMPLEMENTADO** | nenhum `build`/`start`/`postbuild`/`release` chama `db:migrate:deploy`; o CI (`.github/workflows/ci.yml`) também não |
| Migration destrutiva exige revisão | política documentada, sem enforcement | `scripts/deploy/README.md:57-58` |
| Rollback de schema | **NAO IMPLEMENTADO** | `docs/CLOUDPANEL_DEPLOY.md:367-369` reconhece que o rollback de código não desfaz o schema |

**Resposta direta: NÃO há migrations automáticas no deploy.** Elas são aplicadas **à mão**, por SSH/console do container, com `DATABASE_URL` exportado inline. Isso significa que existe uma janela real em que o código novo (com `screen_score`/`certification`, da migration `20260706120000`) pode subir contra um schema antigo, e o Prisma quebra em runtime.

**PROXIMO PASSO:** decidir uma das duas — (a) migration no **build** do EasyPanel (`pnpm --filter @screena/db db:migrate:deploy && pnpm build`), aceitando que o build precisa de rede até o banco; ou (b) um passo de release separado e obrigatório, documentado, executado antes de trocar a imagem. Nunca as duas nem nenhuma.

#### Seeds

| Seed | Caminho | Guarda | Status |
| --- | --- | --- | --- |
| Seed de referência Prisma | `packages/db/prisma/seed.ts` | exige `DATABASE_URL` | **REAL** (tabelas-semente: idiomas, países, `rating_sources`, `api_providers`, `source_licenses`) |
| Seed demo público | `apps/admin/scripts/public-demo-seed.ts` | **aborta em produção** (`:488-491`, lê `VERCEL_ENV`/`NODE_ENV`) | **PLACEHOLDER** (é o **único** lugar que grava `screen_score`) |
| Seed de staging | `apps/admin/scripts/staging-seed.ts` | dry-run default; aborta em produção (`:245-248`) | **PARCIAL** |
| Seed de filme dev | `apps/web/scripts/seed-dev-movie.ts` | exige `DATABASE_URL` (`:175`) | **PLACEHOLDER** |

---

### 2.7 Variáveis de ambiente — inventário completo e auditoria de uso

Declaradas em `.env.example` (li a versão **commitada** via `git show HEAD:.env.example`; a versão da working tree tem `+8` linhas de tunables TMDB ainda **não commitadas**, confirmado por `git diff -- .env.example`).

#### 2.7.1 As que o `.env.example` declara

| Variável | Lida em (arquivo:linha) | Escopo | Obrigatória? | Status |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | `packages/db/prisma/schema.prisma:21`; `packages/db/src/server.ts` (via Prisma); `services/ingestion/bin/ingest-public-catalog.ts:297`; `apps/admin/scripts/public-demo-seed.ts:491`; `apps/admin/scripts/staging-seed.ts:248`; `services/entity-writer/scripts/validate-real-postgres.ts:529` | web (render) + workers + admin | **Sim** | **REAL** |
| `POSTGRES_PASSWORD` | `docker-compose.dev.yml:10` (`${POSTGRES_PASSWORD:-screena_dev_password}`) | dev local | Não | **REAL** (só dev) |
| `THE_SCREEN_PUBLIC_SITE_URL` | **nenhum arquivo de código** | — | — | **PLACEHOLDER / morto** — ver abaixo |
| `SCREENA_PUBLIC_SITE_URL` (comentada) | **nenhum arquivo de código** | — | — | **PLACEHOLDER / morto** |
| `TMDB_READ_ACCESS_TOKEN` | `api-clients/tmdb/src/config.ts:69`; `services/ingestion/bin/ingest-public-catalog.ts:295` | worker offline | Sim (para ingerir) | **REAL** |
| `TMDB_API_KEY` | `api-clients/tmdb/src/config.ts:70`; `ingest-public-catalog.ts:295` | worker offline | fallback v3 | **REAL** |
| `TMDB_API_BASE_URL` | `api-clients/tmdb/src/config.ts:84` | worker | Não | **REAL** (default `https://api.themoviedb.org/3`) |
| `TMDB_DEFAULT_LANGUAGE` | `api-clients/tmdb/src/config.ts:86` | worker | Não | **REAL** (default `pt-BR`) |
| `TMDB_MAX_RPS` | `api-clients/tmdb/src/config.ts:87` | worker | Não | **REAL** (default 20) |
| `TMDB_MAX_RETRIES` | `api-clients/tmdb/src/config.ts:88` | worker | Não | **REAL** (default 4) |
| `TMDB_BREAKER_THRESHOLD` | `api-clients/tmdb/src/config.ts:89` | worker | Não | **REAL** (default 5) |
| `TMDB_BREAKER_COOLDOWN_MS` | `api-clients/tmdb/src/config.ts:90` | worker | Não | **REAL** (default 30000) |
| `TMDB_CACHE_TTL_MS` | `api-clients/tmdb/src/config.ts:91` | worker | Não | **REAL** (default 86400000) |
| `GEMINI_API_KEY` | `services/entity-writer/src/gemini/config.ts:83-86` | worker Entity Writer | só em modo live | **REAL** (falha explícita se ausente) |
| `GEMINI_MODEL` | `services/entity-writer/src/gemini/config.ts:90-93` | worker Entity Writer | só em modo live | **REAL** (sem default de produto, por decisão D3.4) |
| `GEMINI_API_BASE_URL` | `services/entity-writer/src/gemini/config.ts:100` | worker | Não | **REAL** |
| `GEMINI_MAX_RPS` / `GEMINI_MAX_RETRIES` / `GEMINI_BREAKER_THRESHOLD` / `GEMINI_BREAKER_COOLDOWN_MS` | `services/entity-writer/src/gemini/config.ts:79-80` | worker | Não | **REAL** |
| `SCREENA_RATINGS_PROVIDER_KEY` | **nenhum arquivo de código** | — | — | **PLACEHOLDER / morto** |
| `SCREENA_STREAMING_PROVIDER_KEY` | **nenhum arquivo de código** | — | — | **PLACEHOLDER / morto** |
| `SCREENA_REDIS_URL` | **nenhum arquivo de código** | — | — | **PLACEHOLDER / morto** |
| `NODE_ENV` | `apps/web/src/lib/home-placeholder-governance.ts:46`; `services/ingestion/bin/ingest-public-catalog.ts:298`; `apps/admin/src/lib/access-protection.ts`; seeds | web + workers + admin | de facto sim | **REAL** |

Grep de confirmação: `SCREENA_REDIS_URL|SCREENA_RATINGS_PROVIDER_KEY|SCREENA_STREAMING_PROVIDER_KEY` sobre `**/*.{ts,tsx,mjs,js,yml,yaml}` → **zero** ocorrências. As três só existem em `.env.example` e em `docs/CLOUDPANEL_DEPLOY.md:565-567`.

**RISCO — `THE_SCREEN_PUBLIC_SITE_URL` é uma variável fantasma.** `.env.example` a declara e `docs/CLOUDPANEL_DEPLOY.md:557-560` a chama de *"única variável pública"*, mas o código **nunca a lê**. O domínio canônico está **hardcoded**: `export const SITE_URL = "https://thescreen.media";` em `apps/web/src/lib/site.ts:9`, consumido por `apps/web/app/robots.ts` (sitemap absoluto), `apps/web/app/layout.tsx` (`metadataBase`) e por todos os canonicals. Consequência de infraestrutura: **no domínio temporário do EasyPanel, todo canonical, OG e sitemap apontam para `thescreen.media`**, que hoje não resolve. Isso é simultaneamente uma proteção (o domínio temporário nunca vira canônico) e um bug (canonical autorreferente apontando para 404), e impede staging real com URL própria. Cruza com a Parte de SEO.

**PROXIMO PASSO:** fazer `SITE_URL` ler `process.env.THE_SCREEN_PUBLIC_SITE_URL` com fallback para `https://thescreen.media`, mantendo o valor **fixo em build** (é usado em `metadataBase`). É mudança de uma linha com teste de governança.

#### 2.7.2 As que o código lê e o `.env.example` **não** declara — **DEBITO**

| Variável | Lida em | Efeito | Status |
| --- | --- | --- | --- |
| `SCREEN_HOME_VISUAL_PLACEHOLDERS` | `apps/web/src/lib/home-placeholder-governance.ts:47,50` | `=== "1"` **reabilita placeholders visuais em produção** (notícias mock, "Em breve" fake, AdSense, newsletter) | **RISCO** — não documentada, e é a chave que pode vazar mock para o público |
| `VERCEL_ENV` | `apps/admin/src/lib/access-protection.ts:57,171`; `apps/admin/middleware.ts:39`; `services/ingestion/bin/ingest-public-catalog.ts:298`; seeds | detecção de ambiente production-like | **DEBITO** (o projeto não roda na Vercel; é herança) |
| `ADMIN_PROTECTION_ENABLED` | `apps/admin/middleware.ts:35`; `apps/admin/src/server/security.ts:49` | liga Basic Auth do admin | **DEBITO** (não está no `.env.example`) |
| `ADMIN_BASIC_AUTH_USER` | `apps/admin/middleware.ts:36`; `security.ts:50` | credencial do admin | **DEBITO** |
| `ADMIN_BASIC_AUTH_PASSWORD` | `apps/admin/middleware.ts:37`; `security.ts:51` | credencial do admin | **DEBITO** |
| `ADMIN_EDITORIAL_ACTIONS_ENABLED` | `apps/admin/src/server/editorial-actions.ts:67`; `editorial-actions-status.ts:5,30` | destrava escrita editorial | **DEBITO** |
| `PORT` / `HOSTNAME` | não lidas por código próprio; respeitadas pelo `next start` | porta/bind | **PARCIAL** |

Sobre `NODE_ENV`: `next build` e `next start` **forçam** `NODE_ENV=production` no próprio processo. Portanto o gate `allowHomeVisualPlaceholders()` (`apps/web/src/lib/home-placeholder-governance.ts:50`: `env.nodeEnv !== "production" || env.flag === "1"`) fecha em produção **sem** que ninguém precise setar `NODE_ENV`. A única forma de vazar placeholder é setar `SCREEN_HOME_VISUAL_PLACEHOLDERS=1`. **Verificar no painel.**

#### 2.7.3 Segurança de segredos

- **REAL:** zero `NEXT_PUBLIC_*` de segredo. Grep de `NEXT_PUBLIC` em `apps/web/src` + `apps/web/app` retorna **uma única** ocorrência, e é um comentário explicando que a flag *não* é `NEXT_PUBLIC` (`apps/web/src/lib/home-placeholder-governance.ts:17`).
- **REAL:** grep de `TMDB_READ_ACCESS_TOKEN|TMDB_API_KEY` em `apps/web/src` + `apps/web/app` → **zero**. O token só vive no worker (`services/ingestion/bin/ingest-public-catalog.ts:294-296`) e no client (`api-clients/tmdb/src/config.ts:69-70`).
- **REAL:** `.gitignore` bloqueia `.env` e `.env.*` com exceção de `.env.example`; `git ls-files` confirma que só `.env.example` está versionado.
- **RISCO / NAO FOI POSSIVEL CONFIRMAR:** existe um `.env` real na raiz da working tree (`ls -la` mostra `.env`, 1169 bytes, modificado em 07/jul). **Não li o conteúdo** — a leitura foi negada pela política de permissão desta sessão. Não posso afirmar nem negar que ele contenha token TMDB/Gemini reais. Está corretamente gitignorado.
- **RISCO:** `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:500` registra *"warnings de segredo no Nixpacks (mencionado pelo usuário)"* — indício de que env vars estão sendo injetadas como **build args** (que ficam em camada de imagem e em log de build) em vez de env de **runtime**. **NAO FOI POSSIVEL CONFIRMAR.** Se for o caso, o `TMDB_READ_ACCESS_TOKEN` está gravado na imagem Docker. **PROXIMO PASSO:** inspecionar `docker history <imagem>` e a aba de Environment do EasyPanel; nenhum segredo deve ser necessário no build (o build não fala com TMDB).

---

### 2.8 Branch em deploy e commits relevantes

Estado do git no momento da auditoria:

| Referência | SHA | Observação |
| --- | --- | --- |
| `HEAD` (local) | `5994755` | `docs: add post-easypanel screen status report` |
| `origin/feat/home-hero-carousel` | `e46cabb` | **1 commit atrás do local** — o relatório de status ainda não foi pushado |
| `origin/main` | `ae576f4` | **28 commits atrás do HEAD** (`git rev-list --left-right --count origin/main...HEAD` → `0  28`) |
| Working tree | 30 entradas sujas | 28 modificados + 2 untracked (`THE_SCREEN.md`, `tests/admin/no-write-endpoints.test.ts`) |

**Qual branch está em deploy: NAO FOI POSSIVEL CONFIRMAR.** O repositório não carrega essa informação. O relatório de status afirma que o ambiente é `feat/home-hero-carousel`, HEAD `e46cabb` (`docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:69`).

**RISCO alto se o EasyPanel estiver apontado para `main`:** `origin/main` = `ae576f4` (`feat(web): port Claude Design public UI (#33)`). Nessa árvore **não existe** nada do que se considera "o produto atual": nem a home v4, nem `ingest-public-catalog.ts` com upcoming, nem o hero carousel, nem `screen_score`, nem imagens remotas TMDB. Ou seja: **o que está no ar não está em `main`.** Uma branch de feature de vida longa (28 commits) é a fonte de produção.

**PROXIMO PASSO:** abrir/mergear o PR de `feat/home-hero-carousel` → `main` e apontar o EasyPanel para `main` (ou uma tag). Enquanto isso não acontece, qualquer `git pull` de `main` no container derruba a home.

Commits relevantes para infra/deploy (`git log --date=short`):

| SHA | Data | Assunto | Relevância de infra |
| --- | --- | --- | --- |
| `5994755` | 2026-07-07 | `docs: add post-easypanel screen status report` | **não pushado**; é o único doc que fala de EasyPanel |
| `e46cabb` | 2026-07-07 | `polish(web): make home hero a real artwork carousel` | tip de `origin/feat/home-hero-carousel` |
| `46aac93` | 2026-07-07 | `fix(web): use remote tmdb images without local media` | **pivô de infra**: removeu `apps/web/app/media/tmdb/[...path]/route.ts`; elimina necessidade de volume persistente/disco para imagens |
| `0108e67` | 2026-07-07 | `fix(web): serve runtime tmdb media via route handler` | criou o route handler de mídia — **revertido** por `46aac93` |
| `9f92de0` | 2026-07-07 | `fix(web): serve tmdb media assets` | mexeu no `middleware.ts` matcher para excluir `/media` |
| `e4f6aa5` | 2026-07-07 | `feat(web): add tmdb-backed upcoming movies` | introduziu sync externo em `--apply` do backfill |
| `029c7f7` | 2026-07-07 | `fix(web): gate home visual placeholders` | introduziu `SCREEN_HOME_VISUAL_PLACEHOLDERS` (env não documentada) |

Consequência de infra do `46aac93`: **o `screen-app` não precisa de volume persistente**. `apps/web/public/media/tmdb/` está no `.gitignore:15` e vazio; as imagens são montadas como URL remota `image.tmdb.org` a partir do `file_path` cru guardado no banco. Isso é o que torna a imagem stateless — e é uma decisão que `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:607-615` marca como "não reverter".

---

### 2.9 Ingestão/backfill hoje: **manual**. E há uma armadilha.

#### O que existe

| Runner | Caminho | Dispara como | Guarda de ambiente | Status |
| --- | --- | --- | --- | --- |
| Backfill de catálogo | `services/ingestion/bin/ingest-public-catalog.ts` | `tsx` manual | **aborta se production** (`:298`, `:303-307`) | **PARCIAL** |
| Importador pontual | `services/ingestion/bin/import.ts` | `tsx` manual | — | **PARCIAL** |
| Refresh por stale | `services/sync/bin/run.ts` | `tsx` manual **ou** systemd timer | **nenhuma** | **PARCIAL** |
| Entity Writer | `services/entity-writer/bin/run.ts`, `run-offline.ts`, `enqueue.ts`, `inspect.ts` | `tsx` manual | `--confirm-live` exige `GEMINI_API_KEY`/`GEMINI_MODEL` (`run-offline.ts:30`) | **PARCIAL** |
| Workers Python | `workers/*.py` (`tmdb_worker.py`, `ratings_worker.py`, `streaming_worker.py`, `rssprime_worker.py`, `scheduler.py`) | nada | — | **PLACEHOLDER** (esqueletos/roadmap; `CLAUDE.md` §3) |

#### Os únicos artefatos de agendamento do repositório

`services/sync/systemd/screena-tmdb-catalog.timer`:
```
OnCalendar=*-*-* 03:00:00      # :9
Persistent=true                # :10
RandomizedDelaySec=900         # :11
```

`services/sync/systemd/screena-tmdb-catalog.service`:
```
Type=oneshot                                                              # :14
User=screena                                                              # :15
WorkingDirectory=/srv/screena                                             # :16
EnvironmentFile=/srv/screena/.env                                         # :17
ExecStart=/usr/bin/env pnpm --filter @screena/sync exec tsx bin/run.ts 50 # :19
TimeoutStartSec=1800                                                      # :21
```

**Status: PLACEHOLDER para o deploy atual.** Esses arquivos assumem VPS com `systemd`, usuário `screena`, `/srv/screena` e `EnvironmentFile`. Nada disso existe num container EasyPanel. `services/sync/systemd/screena-tmdb-catalog.service:2-3` já se declara "ilustrativo". Não há unit para o app web, nem para o `entity-writer`, nem para backup — apenas exemplos em `docs/CLOUDPANEL_DEPLOY.md:373-393` e `scripts/backup/README.md:66-79`.

#### A armadilha operacional: o backfill **aborta em produção**

```ts
// services/ingestion/bin/ingest-public-catalog.ts:298
const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
...
// :303-307
if (isProd) {
  console.error('Abortado: produção real detectada — backfill só em local/staging.')
  process.exitCode = 1
  return
}
```

Mas o próprio relatório de status manda rodar exatamente esse script **dentro do container `screen-app`** (`docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:575-578`). As duas coisas só coexistem em uma de três hipóteses:

1. o container **não** tem `NODE_ENV=production` no ambiente do shell (o `next start` seta `NODE_ENV` só no processo dele), e o script roda; **ou**
2. o operador roda `NODE_ENV= tsx …` sobrescrevendo a variável; **ou**
3. o backfill de produção nunca rodou de verdade no container e o catálogo veio de outra via.

**NAO FOI POSSIVEL CONFIRMAR** qual. Isso é importante porque a hipótese (1) significa que a guarda `isProd` é **ineficaz** — ela não protege o banco de produção, só protege quem exportou `NODE_ENV` no shell.

**RISCO / BLOQUEIA PRODUCAO (governança):** uma guarda fail-closed que só funciona por acidente de ambiente não é uma guarda. **PROXIMO PASSO:** trocar a heurística `NODE_ENV`/`VERCEL_ENV` por um sinal explícito e intencional (ex.: exigir `SCREEN_ALLOW_BACKFILL=1` **e** `--apply`, e/ou validar que `DATABASE_URL` não é a de produção via allowlist de host).

Observe a assimetria: `services/sync/bin/run.ts` **não tem guarda nenhuma** (`services/sync/bin/run.ts:1-53`) — e está correto, porque é o runner desenhado para rodar em produção por timer. Já o `ingest-public-catalog.ts` (lista curada de 10 filmes + 10 séries, `:59-60`) é ferramenta de bootstrap, não de operação contínua.

#### O que precisa virar job/cron/systemd timer

Nenhum job roda automaticamente hoje. Nada. Zero.

| Job | Cadência-alvo (fonte) | Runner que já existe | O que falta |
| --- | --- | --- | --- |
| Refresh de catálogo TMDB (stale) | 7–14 dias/entidade; timer diário 03:00 (`.claude/rules/ingestion.md`; `services/sync/systemd/…timer:9`) | `services/sync/bin/run.ts` | **REAL como código, NAO IMPLEMENTADO como agendamento no EasyPanel.** Virar cron/scheduled task do painel |
| Lançamentos / upcoming | diário (`.claude/rules/ingestion.md`) | `ingest-public-catalog.ts --include-upcoming --apply` | idem + remover a guarda `isProd` mal-desenhada |
| Trending | 6–12 h | — | endpoint `/trending` **NAO IMPLEMENTADO** no client (`api-clients/tmdb/src/endpoints.ts`) |
| Ratings externos | 12–24 h | — | **NAO IMPLEMENTADO** (feature inativa por design) |
| Onde assistir | diário | — | **NAO IMPLEMENTADO** |
| Entity Writer (content_blocks) | sob demanda | `services/entity-writer/bin/run.ts` | **NAO IMPLEMENTADO** como job; exige `GEMINI_API_KEY` no ambiente do worker (não do web) |
| Backup do Postgres | diário + semanal + mensal (`scripts/backup/README.md:31-35`) | — | **NAO IMPLEMENTADO** — nenhum `pg_dump` roda |
| Prune de `api_cache` | — | — | **NAO IMPLEMENTADO** — ninguém limpa a tabela que mais cresce |

**RISCO / BLOQUEIA PRODUCAO:** **não existe backup do banco.** `scripts/backup/README.md:3-5` é explícito: *"Nenhum backup real roda agora."* Um `screen-db` sem `pg_dump` agendado, sem off-site e sem restore testado é perda total de dados editoriais (`content_blocks`, `page_indexability_decisions`, `screen_score` atribuído por humano) num único incidente de disco.

---

### 2.10 Manual hoje vs. o que deveria ser automatizado

| Operação | Hoje | Deveria ser | Criticidade |
| --- | --- | --- | --- |
| Build da imagem | Nixpacks no push (presumido) | igual, com `prisma generate` explícito e `output: standalone` | **NAO BLOQUEIA PRODUCAO** (mas dobra/triplica custo de imagem) |
| Start do app | comando configurado no painel, ausente do repo | `"start"` no `package.json` da raiz | **NAO BLOQUEIA PRODUCAO** |
| `prisma migrate deploy` | **manual**, no container, com `DATABASE_URL` inline | passo de release versionado e obrigatório | **BLOQUEIA PRODUCAO** |
| Backfill TMDB inicial | **manual** (`tsx …ingest-public-catalog.ts --apply`), com guarda que aborta em prod | bootstrap manual é aceitável; a guarda precisa ser intencional | **BLOQUEIA PRODUCAO** (governança da guarda) |
| Refresh de catálogo (stale) | **manual / nunca rodou** | cron/scheduled task diário chamando `services/sync/bin/run.ts` | **NAO BLOQUEIA PRODUCAO** (dado envelhece silenciosamente) |
| Upcoming ("Em breve") | **manual** | diário | **NAO BLOQUEIA PRODUCAO** |
| Entity Writer | **manual**, offline | job sob demanda + fila (`entity_writer_jobs` já existe no schema) | **NAO BLOQUEIA PRODUCAO** |
| Backup do Postgres | **inexistente** | diário `pg_dump -Fc` + off-site + restore testado | **BLOQUEIA PRODUCAO** |
| Healthcheck | **inexistente** no app público | `/api/health` 200 + `SELECT 1` | **NAO BLOQUEIA PRODUCAO** |
| Rollback | **inexistente** (nem release folders, nem tag de imagem documentada) | rollback por tag de imagem no EasyPanel | **NAO BLOQUEIA PRODUCAO** |
| Deploy a partir de `main` | **não** — deploy de branch de feature | merge + deploy de `main`/tag | **BLOQUEIA PRODUCAO** (higiene) |
| Monitoramento / error tracking | **inexistente** | Sentry/uptime | **NAO BLOQUEIA PRODUCAO** |
| Limpeza de `api_cache` | **inexistente** | job de prune por `stale_after`/TTL | **NAO BLOQUEIA PRODUCAO** |

---

### 2.11 Disco e tamanho

#### Números **reportados pelo operador — NÃO medidos nesta auditoria**

Os valores abaixo foram informados pelo dono do projeto. Não tive acesso ao host, ao container nem ao banco. Trate-os como testemunho a re-verificar.

| Item | Valor reportado | Comentário técnico (este sim, verificável no repo) |
| --- | --- | --- |
| `screen-app` (total) | ~987 MB | consistente com `next start` **sem** `output: standalone` — o runtime carrega o `node_modules` inteiro (§2.4) |
| `node_modules` | ~977 MB | 99% do peso da imagem |
| `.next` (build) | ~3,8 MB | típico de build **não** standalone (standalone copiaria o runtime junto) |
| `public` | ~144 KB | coerente: só `/brand/*.svg` + 15 PNGs de demo; **sem mídia TMDB local** |
| Mídia TMDB local | ausente | **REAL**: `apps/web/public/media/tmdb/` está em `.gitignore:15` e o backfill grava `file_path` cru por padrão (`services/ingestion/bin/ingest-public-catalog.ts:14-19`) |
| `screen-db` data dir | ~71 MB | data dir > database_size é normal (WAL, catálogos, `pg_stat`) |
| `database_size` | ~16 MB | com 10 filmes + 10 séries + upcoming, o peso vem de `api_cache` (payloads TMDB brutos) |

#### Corroboração parcial que **eu consegui** medir (na máquina local, Windows, não no container)

Medi o `node_modules` do repositório local. Os números explicam a ordem de grandeza reportada:

| Pacote | Tamanho local |
| --- | --- |
| `node_modules/.pnpm` (total) | **859 MB** |
| `next@15.5.19` | 150 MB |
| `@embedded-postgres/windows-x64@16.14.0-beta.17` | **99 MB** |
| `@prisma/engines@6.19.3` | 77 MB |
| `prisma@6.19.3` (CLI) | 71 MB |

**DEBITO acionável:** `embedded-postgres` é **devDependency** de `apps/web` (`apps/web/package.json:35`) e de `packages/db`, usada apenas por scripts de validação (`packages/db/scripts/validate-real-postgres.ts`). No container Linux o equivalente é `@embedded-postgres/linux-x64` (~100 MB). Somados, `prisma` CLI (71 MB) + `@prisma/engines` (77 MB) + `embedded-postgres` (~100 MB) ≈ **250 MB de coisas que o runtime não usa**. Nenhum deles é necessário para servir `/pt/`. Só `@prisma/client` (+ o engine query correspondente) é.

**PROXIMO PASSO (redução de imagem, em ordem de retorno):**
1. `output: "standalone"` no `apps/web/next.config.ts` → runtime auto-contido;
2. estágio de runtime que **não** carrega devDependencies (`pnpm install --prod` ou multi-stage Dockerfile);
3. mover `embedded-postgres` para um pacote de teste dedicado, fora do grafo de `apps/web`.

#### Comandos exatos para medir de novo (execute você, não eu)

**No container `screen-app` (`/app`):**
```bash
du -sh /app
du -sh /app/node_modules
du -sh /app/apps/web/.next
du -sh /app/apps/web/public
du -sh /app/node_modules/.pnpm 2>/dev/null

# os 20 maiores pacotes instalados
du -sh /app/node_modules/.pnpm/* 2>/dev/null | sort -h | tail -20

# confirmar ausência de mídia TMDB local (esperado: 0 arquivos)
find /app/apps/web/public/media/tmdb -type f 2>/dev/null | wc -l
du -sh /app/apps/web/public/media 2>/dev/null

# confirmar se o build é standalone (esperado hoje: NÃO existe)
ls -la /app/apps/web/.next/standalone 2>/dev/null || echo "sem standalone (esperado)"
```

**No host do EasyPanel (Docker):**
```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker system df -v | head -40
docker exec -it $(docker ps -qf name=screen-app) du -sh /app /app/node_modules /app/apps/web/.next /app/apps/web/public

# checar se segredo foi para camada de imagem (build arg)
docker history --no-trunc $(docker ps --format '{{.Image}}' -f name=screen-app) | grep -i -E "TMDB|GEMINI|DATABASE_URL" || echo "OK: nenhum segredo visível no history"

# volume / data dir do postgres (caminho típico do EasyPanel; CONFIRME o seu)
du -sh /etc/easypanel/projects/rss_prime/screen-db/volumes/* 2>/dev/null
docker exec -it $(docker ps -qf name=screen-db) du -sh /var/lib/postgresql/data
```

**No banco (`screen-db`), tamanho total:**
```bash
psql "$DATABASE_URL" -Atc "SELECT current_database(), pg_size_pretty(pg_database_size(current_database()));"

# em bytes, para comparar histórico
psql "$DATABASE_URL" -Atc "SELECT pg_database_size(current_database());"

# data_directory efetivo
psql "$DATABASE_URL" -Atc "SHOW data_directory;"
```

**Maiores tabelas (heap + índices + toast):**
```sql
SELECT
  n.nspname                                                AS schema,
  c.relname                                                AS tabela,
  pg_size_pretty(pg_total_relation_size(c.oid))            AS total,
  pg_size_pretty(pg_relation_size(c.oid))                  AS heap,
  pg_size_pretty(pg_indexes_size(c.oid))                   AS indices,
  pg_size_pretty(COALESCE(pg_total_relation_size(c.reltoastrelid), 0)) AS toast,
  c.reltuples::bigint                                      AS linhas_aprox
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 25;
```

**Contagens das tabelas que efetivamente crescem** (nomes reais, confirmados nos `@@map` de `packages/db/prisma/schema.prisma`):
```sql
SELECT 'api_cache'      AS tabela, count(*) FROM api_cache
UNION ALL SELECT 'api_sync_logs',    count(*) FROM api_sync_logs
UNION ALL SELECT 'movies',           count(*) FROM movies
UNION ALL SELECT 'tv_shows',         count(*) FROM tv_shows
UNION ALL SELECT 'seasons',          count(*) FROM seasons
UNION ALL SELECT 'episodes',         count(*) FROM episodes
UNION ALL SELECT 'people',           count(*) FROM people
UNION ALL SELECT 'cast_members',     count(*) FROM cast_members
UNION ALL SELECT 'crew_members',     count(*) FROM crew_members
UNION ALL SELECT 'content_blocks',   count(*) FROM content_blocks
UNION ALL SELECT 'external_ratings', count(*) FROM external_ratings
UNION ALL SELECT 'watch_availability', count(*) FROM watch_availability
UNION ALL SELECT 'page_indexability_decisions', count(*) FROM page_indexability_decisions
ORDER BY 2 DESC;
```

Previsão honesta (a checar): `api_cache` deve dominar o `database_size`, porque guarda o payload TMDB **bruto** por chave de requisição, e `external_ratings`/`watch_availability`/`content_blocks` devem estar em **0** (features inativas por design — `.claude/rules/ratings.md`, `.claude/rules/seo.md:64`).

---

### 2.12 Riscos consolidados de deploy e infraestrutura

| # | Risco | Severidade | Evidência |
| --- | --- | --- | --- |
| 1 | **Sem backup do Postgres.** Nenhum `pg_dump`, nenhum off-site, nenhum restore testado. | **BLOQUEIA PRODUCAO** | `scripts/backup/README.md:3-5` |
| 2 | **Migrations manuais**, sem passo de release, contra `DATABASE_URL` exportado à mão. Janela de app-novo-contra-schema-velho. | **BLOQUEIA PRODUCAO** | nenhum script chama `db:migrate:deploy`; `packages/db/package.json` |
| 3 | **Produção roda de branch de feature**, 28 commits à frente de `main` e 1 commit à frente do próprio `origin`. | **BLOQUEIA PRODUCAO** (higiene) | `git rev-list --left-right --count origin/main...HEAD` = `0 28` |
| 4 | **Guarda `isProd` do backfill é ineficaz** se o shell do container não tiver `NODE_ENV=production`. | **BLOQUEIA PRODUCAO** (governança) | `services/ingestion/bin/ingest-public-catalog.ts:298,303-307` vs `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:575-578` |
| 5 | **`SITE_URL` hardcoded** → canonical/OG/sitemap apontam para `thescreen.media` mesmo no domínio temporário; impossível ter staging com URL própria. | **BLOQUEIA PRODUCAO** (cruza SEO) | `apps/web/src/lib/site.ts:9`; `THE_SCREEN_PUBLIC_SITE_URL` não é lida em lugar nenhum |
| 6 | **Possível segredo em build arg do Nixpacks** (warnings relatados). Token TMDB gravado em camada de imagem/log. | **RISCO alto — NAO FOI POSSIVEL CONFIRMAR** | `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:500` |
| 7 | **Sem healthcheck** no app público; `GET /` retorna **404**. | **NAO BLOQUEIA PRODUCAO** | não há `apps/web/app/page.tsx` nem `app/api/**` |
| 8 | **Imagem de ~987 MB** por falta de `output: standalone` e por devDependencies pesadas (`embedded-postgres` ~100 MB, `prisma` CLI 71 MB, `@prisma/engines` 77 MB) no runtime. | **NAO BLOQUEIA PRODUCAO** | `apps/web/next.config.ts:21-45`; medições locais |
| 9 | **`prisma generate` implícito** (depende do `postinstall` de `@prisma/client`); build pode quebrar em bump de pnpm/Prisma. | **RISCO** | `package.json:13`; `.github/workflows/ci.yml:26-45` |
| 10 | **Documentação de deploy descreve infra inexistente** (CloudPanel/systemd/standalone/release folders). | **NAO BLOQUEIA PRODUCAO** | `docs/CLOUDPANEL_DEPLOY.md` integral |
| 11 | **Env vars fantasma** no `.env.example` (`SCREENA_REDIS_URL`, `SCREENA_RATINGS_PROVIDER_KEY`, `SCREENA_STREAMING_PROVIDER_KEY`, `THE_SCREEN_PUBLIC_SITE_URL`) e **env vars reais não documentadas** (`SCREEN_HOME_VISUAL_PLACEHOLDERS`, `ADMIN_*`). | **DEBITO** | grep: zero ocorrências em código |
| 12 | **`api_cache` sem política de prune**; cresce indefinidamente com payloads TMDB brutos. | **DEBITO** | `packages/db/prisma/schema.prisma:702`; nenhum job de limpeza |
| 13 | **`force-dynamic` em toda listagem e na home** → nenhum cache de página; cada request bate no Postgres. | **DEBITO** | tabela de rotas em §2.4 |
| 14 | **Blast radius compartilhado** com o serviço `feed` (RSS Prime) no mesmo projeto EasyPanel. | **RISCO** | `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:73,106` |
| 15 | **`SCREEN_HOME_VISUAL_PLACEHOLDERS=1`** no painel reabilita mocks (AdSense, notícias falsas, "Em breve" fake) em produção. Um caractere separa produção honesta de produção mentirosa. | **RISCO** | `apps/web/src/lib/home-placeholder-governance.ts:44-51` |

---

### 2.13 Próximos passos, em ordem

**P0 — antes do domínio oficial**

1. **PROXIMO PASSO** Verificar no painel EasyPanel e registrar em `docs/EASYPANEL_DEPLOY.md`: projeto, serviços, build command, start command, healthcheck, lista de env vars, branch, volumes. Hoje isso é conhecimento tácito de uma pessoa.
2. **PROXIMO PASSO** Confirmar que `SCREEN_HOME_VISUAL_PLACEHOLDERS` **não** está setada, e que segredos são env de **runtime**, não build args (`docker history | grep TMDB`).
3. **PROXIMO PASSO** Implementar backup: `pg_dump -Fc` diário + checksum + cópia off-site + **um restore testado** numa base efêmera. Sem isso, nada mais importa.
4. **PROXIMO PASSO** Formalizar o passo de migration (`prisma migrate deploy`) como parte obrigatória do release, antes de trocar a imagem.
5. **PROXIMO PASSO** Mergear `feat/home-hero-carousel` em `main` e apontar o deploy para `main`/tag.
6. **PROXIMO PASSO** Bloquear indexação do domínio temporário (`X-Robots-Tag: noindex` no proxy, ou Basic Auth) — ver Parte de SEO.

**P1 — higiene técnica**

7. `"start"` no `package.json` da raiz; `prisma generate` explícito no `build`.
8. `output: "standalone"` + runtime sem devDependencies → imagem de ~987 MB para ordem de 150–250 MB.
9. `apps/web/app/api/health/route.ts` (200 + `SELECT 1`, sem vazar `DATABASE_URL`), espelhando `apps/admin/src/server/health.ts`.
10. `SITE_URL` lendo `THE_SCREEN_PUBLIC_SITE_URL` (com fallback), destravando staging.
11. Limpar `.env.example`: remover as 3 variáveis mortas, adicionar `SCREEN_HOME_VISUAL_PLACEHOLDERS` e as `ADMIN_*`, commitar os tunables TMDB que já estão na working tree.

**P2 — automação**

12. Scheduled task diária no EasyPanel chamando `services/sync/bin/run.ts` (refresh por stale) — o código já existe e não tem guarda de ambiente atrapalhando.
13. Redesenhar a guarda de `ingest-public-catalog.ts` (`SCREEN_ALLOW_BACKFILL=1` explícito em vez de heurística `NODE_ENV`).
14. Job de prune de `api_cache`.
15. Monitoramento de uptime + error tracking + alerta em `api_sync_logs` com `status='failed'`.

**P3 — decisão arquitetural pendente**

16. Escolher **uma** história de deploy. Ou o EasyPanel vira o caminho canônico (e `docs/CLOUDPANEL_DEPLOY.md` vira apêndice histórico), ou o CloudPanel é de fato o alvo e o EasyPanel é temporário — com prazo. Manter dois deploys "oficiais" na cabeça de uma pessoa é a dívida mais cara desta seção.

---

### 2.14 O que **não** consegui verificar (declaração explícita)

**NAO FOI POSSIVEL CONFIRMAR**, e o que faltou:

- Nome do projeto EasyPanel (`rss_prime`), nomes de serviço (`screen-app`, `screen-db`) — falta acesso ao painel; zero ocorrência no repo.
- Build command e start command efetivos — falta acesso ao painel; não existem no repo.
- Se o EasyPanel usa Nixpacks (é inferência por eliminação) e qual provider/versão de Node ele escolheu.
- Se há healthcheck configurado e qual path.
- Se `prisma migrate deploy` já foi executado contra `screen-db` e em qual migration ele parou.
- Se o backfill TMDB de produção realmente rodou dentro do container (dado o `isProd` abort).
- Se `SCREEN_HOME_VISUAL_PLACEHOLDERS`, `NODE_ENV`, `DATABASE_URL` e `TMDB_READ_ACCESS_TOKEN` estão setados e com quais valores.
- Se os segredos foram injetados como build arg (warning relatado) ou como env de runtime.
- Qual branch/commit exato está construído na imagem em execução.
- Todos os números de disco/banco (§2.11) — são testemunho do operador; forneci os comandos exatos para medir.
- Conteúdo do `.env` local (leitura negada pela política de permissão desta sessão) — não posso afirmar nem negar que contenha segredos reais. Está corretamente gitignorado (`.gitignore`, `git ls-files`).


---

## Parte 3 — Stack tecnica completa

> Escopo desta secao: o que a stack **e de fato** no working tree auditado (branch `feat/home-hero-carousel`, HEAD `5994755`), nao o que a documentacao promete. Onde documentacao e codigo divergem, a divergencia esta marcada. Nenhum build, migration, servidor ou chamada de rede foi executado durante a auditoria.

---

### 3.1 Versoes: declarado vs. instalado

O repositorio declara ranges frouxos (`^`), mas o `node_modules/.pnpm` mostra o que realmente resolveu. As duas colunas nao coincidem em nenhum caso — o que e normal com `^`, mas importa para reproducibilidade.

| Item | Declarado (arquivo) | Resolvido (`node_modules/.pnpm`) | Status |
| --- | --- | --- | --- |
| Gerenciador de pacotes | `pnpm@9.15.4` (`package.json:6`, campo `packageManager`) | — | **REAL** |
| Node (engine) | `>=22 <23` (`package.json:9`) | Node local em uso: `v24.14.0` | **DEBITO** — o ambiente local **viola** o engine declarado |
| Node (CI) | `node-version: 22` (`.github/workflows/ci.yml:22`) | — | **REAL** |
| Node (`.nvmrc`) | `22` (`.nvmrc:1`) | — | **REAL** |
| Next.js | `^15.0.0` (`apps/web/package.json:16`, `apps/admin/package.json:15`) | `next@15.5.19` | **REAL** |
| React / React DOM | `^19.0.0` (`apps/web/package.json:17-18`) | `react@19.2.7`, `react-dom@19.2.7` | **REAL** |
| TypeScript | `^5.6.0` (raiz, `package.json:26`); `^5.5.0` (apps) | `typescript@5.9.3` | **REAL** |
| Prisma / `@prisma/client` | `^6.1.0` (`packages/db/package.json:24,29`) | `prisma@6.19.3`, `@prisma/client@6.19.3` | **REAL** |
| Vitest | `^2.1.0` (`package.json:28`) | `vitest@2.1.9` | **REAL** |
| ESLint | `^9.10.0` (`package.json:23`) + `typescript-eslint@^8` | — | **REAL** |
| Prettier | `^3.3.0` (`package.json:25`) | — | **PARCIAL** — instalado, **nunca executado em CI** (ver 3.9) |
| Tailwind CSS | `^3.4.0` (`apps/web/package.json:31`) | `tailwindcss@3.4.19` | **PLACEHOLDER** — dependencia morta (ver 3.6) |
| tsx | `^4.19.0` (db/web/ingestion/sync/entity-writer) | `tsx@4.22.4` | **REAL** |
| `embedded-postgres` | `16.14.0-beta.17` (web, db, entity-writer) | — | **PARCIAL** — so usado por scripts `validate-*-real-postgres` |
| PostgreSQL | `postgres:16-alpine` em `docker-compose.dev.yml:3` | — | **REAL** (apenas dev local) |
| Python (workers) | `py312` (`workers/pyproject.toml:5`) | Nada instalado (`workers/requirements.txt:3-5`: "NAO instale agora") | **NAO IMPLEMENTADO** |
| Nixpacks | **nao existe** `Dockerfile`, `nixpacks.toml` nem `Procfile` no repo | — | **RISCO** (ver 3.10) |

`lockfileVersion: '9.0'` (`pnpm-lock.yaml:1`). O lockfile esta presente e o CI (working tree) usa `--frozen-lockfile` (`.github/workflows/ci.yml:27`).

---

### 3.2 Monorepo pnpm — o que e workspace de verdade

`pnpm-workspace.yaml` declara quatro globs:

```
apps/* · packages/* · api-clients/* · services/*
```

Mas um diretorio so vira workspace se tiver `package.json`. Inventario real:

| Caminho | `package.json`? | Nome do pacote | Estado |
| --- | --- | --- | --- |
| `apps/web` | sim | `@screena/web` | **REAL** |
| `apps/admin` | sim | `@screena/admin` | **REAL** (read-only + escrita gated) |
| `packages/config` | sim | `@screena/config` | **REAL** |
| `packages/schemas` | sim | `@screena/schemas` | **REAL** |
| `packages/seo` | sim | `@screena/seo` | **REAL** |
| `packages/ui` | sim | `@screena/ui` | **PARCIAL** — so `tokens.ts` + `vertical.ts`; **zero componentes React** |
| `packages/types` | sim | `@screena/types` | **REAL** (tipos puros) |
| `packages/db` | sim | `@screena/db` | **REAL** |
| `api-clients/tmdb` | sim | `@screena/tmdb-client` | **REAL** |
| `api-clients/imdb` | **nao** (so `README.md`) | — | **NAO IMPLEMENTADO** |
| `api-clients/rotten_tomatoes` | **nao** (so `README.md`) | — | **NAO IMPLEMENTADO** |
| `api-clients/film_show_ratings` | **nao** (so `README.md`) | — | **NAO IMPLEMENTADO** |
| `api-clients/streaming_availability` | **nao** (so `README.md`) | — | **NAO IMPLEMENTADO** |
| `api-clients/kaso` | **nao** (so `README.md`) | — | **NAO IMPLEMENTADO** |
| `services/ingestion` | sim | `@screena/ingestion` | **REAL** |
| `services/sync` | sim | `@screena/sync` | **REAL** |
| `services/entity-writer` | sim | `@screena/entity-writer` | **REAL** (pipeline offline) |
| `services/news-ingestion` | **nao** (so `README.md`) | — | **NAO IMPLEMENTADO** |
| `services/ratings` | **nao** (so `README.md`) | — | **NAO IMPLEMENTADO** |
| `services/streaming` | **nao** (so `README.md`) | — | **NAO IMPLEMENTADO** |

Ou seja: **12 workspaces reais** — `apps/web`, `apps/admin`, `packages/{config,schemas,seo,ui,types,db}` (6), `api-clients/tmdb` (1), `services/{ingestion,sync,entity-writer}` (3). Os outros **8 diretorios** sob `api-clients/` e `services/` sao **README-only** e nao existem para o pnpm (nao tem `package.json`).

`packages/ui` merece destaque: `CLAUDE.md` secao 5 diz "componentes, tokens de cor, badges filme/serie", mas `packages/ui/src/` contem apenas `index.ts`, `tokens.ts` e `vertical.ts` (`packages/ui/src/index.ts:10-11`). **PLACEHOLDER** documental: nao ha um unico componente React ali. Os componentes reais vivem em `apps/web/app/_components/` (14 arquivos, 1394 linhas somadas).

Diretorios de raiz que **nao** sao workspaces e nao entram em nenhum grafo de import:

- `seo/` (`seo/indexability.ts:1-51`, `seo/robots.ts`, `seo/sitemap.ts` — 224 linhas): auto-descritos como "PONTE (bridge) entre as rotas Next e o motor de indexabilidade" (`seo/indexability.ts:1-2`). Grep por importadores em `apps/`, `packages/`, `services/`, `tests/`: **zero**. Nao estao no `include` do `tsconfig.json` raiz (linhas 6-11), logo **nao sao typecheckados**. **DEBITO** — codigo morto que duplica conceitualmente `packages/seo`.
- `database/` — apenas `schema.md` + `.gitkeep`s. Fonte executavel e `packages/db/prisma`.
- `workers/` — 6 `.py`, 379 linhas totais, todos stubs de log ("Fase 0: nao implementado", `workers/tmdb_worker.py:41`). **NAO IMPLEMENTADO**.
- `apps/web/components/` e `apps/web/lib/` — diretorios **vazios** (scaffolding morto; o codigo real esta em `apps/web/app/_components/` e `apps/web/src/lib/`).

---

### 3.3 TypeScript: strict sim, cobertura nao

`tsconfig.base.json` e agressivo e correto:

- `"strict": true` (`tsconfig.base.json:3`)
- `"noUncheckedIndexedAccess": true` (`tsconfig.base.json:9`) — raro e bom
- `target ES2022`, `module ESNext`, `moduleResolution Bundler` (`tsconfig.base.json:4-6`)
- `paths` com 7 aliases `@screena/*` incluindo `@screena/tmdb-client` (`tsconfig.base.json:12-20`)

Os aliases estao **sincronizados** entre `tsconfig.base.json:12-20` e `vitest.config.ts:15-30` (mesmos 7). Isso e o que `CLAUDE.md` secao 8 exige.

**O problema esta no `tsconfig.json` raiz** (o que `pnpm typecheck` roda, `package.json:15`):

```
include:  packages/**/*.ts, api-clients/**/*.ts, services/**/*.ts, tests/**/*.ts   (tsconfig.json:6-11)
exclude:  packages/**/prisma/**, packages/**/scripts/**, packages/db/src/server.ts,
          api-clients/**/bin/**, services/**/persistence/**, services/**/scripts/**,
          services/**/bin/**, services/ingestion/src/composition.ts                (tsconfig.json:18-25)
```

Consequencias concretas, todas verificadas:

| Codigo | Typecheckado por `pnpm typecheck`? | Onde |
| --- | --- | --- |
| `apps/web/**` | **NAO** (nao esta no `include`) | so via `next build` |
| `apps/admin/**` | **NAO** | e o admin **nao e buildado no CI** → nunca typechecked em CI |
| `packages/db/src/server.ts` (Prisma Client) | **NAO** (`tsconfig.json:20`) | — |
| `services/entity-writer/src/persistence/**` (9 arquivos que tocam Prisma) | **NAO** (`tsconfig.json:22`) | — |
| `services/*/bin/**` (CLIs: `import.ts`, `ingest-public-catalog.ts`, `run-offline.ts`, `enqueue.ts`, `inspect.ts`, `smoke-gemini.ts`) | **NAO** (`tsconfig.json:24`) | — |
| `services/ingestion/src/composition.ts` | **NAO** (`tsconfig.json:25`) | — |
| `seo/*.ts` (raiz) | **NAO** (fora do `include`) | — |
| `apps/web/scripts/**` | **NAO** (`apps/web/tsconfig.json:16`) | — |

**DEBITO / RISCO** — **todo o codigo que escreve no PostgreSQL** (persistence dos services, `composition.ts`, `db/src/server.ts`, os `bin/*`) esta fora do `pnpm typecheck`. A justificativa nos comentarios e "depende do Prisma Client gerado em node_modules" (`packages/db/src/server.ts:3-4`), o que e legitimo em CI sem `prisma generate`, mas o efeito colateral e que os caminhos de escrita sao os **menos** verificados estaticamente do repositorio. **NAO BLOQUEIA PRODUCAO** (o render nao depende deles), mas e onde uma regressao silenciosa de ingestao nasceria.

`apps/web/tsconfig.json` habilita `isolatedModules`, `jsx: preserve`, plugin `next` e inclui `.next/types/**`. `apps/admin/tsconfig.json` existe mas seu `typecheck` (`apps/admin/package.json:12`) so roda se alguem o invocar manualmente — **nao esta no CI**.

---

### 3.4 Next.js App Router — por que server components, e onde ha client components

#### Por que server components

A arquitetura nao "escolheu" RSC por moda: as invariantes 3 e 4 (`CLAUDE.md` secao 2) exigem que a pagina publica leia **somente PostgreSQL/cache local** e que **nenhuma IA** rode no render. Um componente cliente nao pode abrir conexao Prisma (nao ha socket TCP no browser) e, se tentasse, precisaria de um endpoint HTTP — que viraria uma superficie de API no caminho de render. Server components permitem que a leitura do banco aconteca dentro do mesmo processo Node que renderiza o HTML, sem endpoint intermediario e sem vazar `DATABASE_URL`/tokens para o bundle.

O codigo declara isso explicitamente: `apps/web/next.config.ts:4-19` documenta as invariantes 3/4 no proprio config, e `apps/web/src/server/movie-page.ts:1-16` explica que server-only ali e **convencao estrutural** (diretorio + ausencia de `"use client"`), nao o pacote npm `server-only`:

> "O pacote `server-only` ainda nao esta instalado neste estagio; por isso a delimitacao e por diretorio + ausencia de 'use client', nao por import." — `apps/web/src/server/movie-page.ts:14-15`

**DEBITO** — a fronteira server/client e garantida por **regex de auditoria** (`scripts/audit/check-render-purity.mjs`) e por teste de governanca (`tests/governance/web-render-layering.test.ts`), nao pelo compilador. Se alguem adicionar `"use client"` no topo de `apps/web/src/server/movie-page.ts`, o guard pega; se alguem importar `../server/movie-page` de dentro de um client component **sem** importar `@screena/db` diretamente, os guards atuais **nao** pegam (eles casam o import de `@screena/db`, nao a cadeia transitiva). **NAO BLOQUEIA PRODUCAO**, mas e uma brecha real do guard. Instalar `server-only` fecharia isso em tempo de build.

#### Client components — inventario completo (grep `"use client"` em `apps/web`)

Sao **4 arquivos**, todos em `apps/web/app/_components/`, todos com a diretiva na **linha 1**:

| Arquivo | Linha | Motivo da interatividade | Dado que consome |
| --- | --- | --- | --- |
| `apps/web/app/_components/hero-carousel.tsx:1` | 1 | Carrossel real: crossfade, autoplay, setas, dots, teclado, swipe, `prefers-reduced-motion` | Recebe `HeroSlide[]` **serializado do server** (`apps/web/src/lib/home-hero-presenter.ts`) — **REAL** |
| `apps/web/app/_components/site-header.tsx:1` | 1 | Estado de scroll para nav adaptativa sobre o hero + `usePathname()` | Constantes puras (`src/lib/navigation`, `src/lib/site`) — **REAL** |
| `apps/web/app/_components/coming-soon-rail.tsx:1` | 1 | Setas `‹ ›` que fazem `scrollBy` no trilho (`useRef`) | Dado real TMDB `upcoming` via getter server; placeholder so em dev/preview — **PARCIAL** |
| `apps/web/app/_components/episodes-ticker.tsx:1` | 1 | Auto-rotacao 4200ms, dots, pausa no hover | **MOCK hardcoded** — `episodesToday()` em `apps/web/app/_components/episodes-ticker.tsx:53`, consumido em `:93`; literal `logo: "Max"` em `:79` — **PLACEHOLDER** |

Ocorrencias restantes do texto `"use client"` no repo sao **comentarios**, nao diretivas: `apps/web/app/_components/site-footer.tsx:14` ("Server component PURO (sem 'use client')") e `apps/web/src/server/movie-page.ts:12,15`.

`apps/admin` tem **zero** client components (grep vazio) — todo o painel e RSC + Server Actions.

**RISCO** — o `EpisodesTicker` e um client component que afirma "novo episodio hoje" e "Onde assistir <streaming>" sem nenhum `watch_availability` no banco (o proprio arquivo admite a divida em `apps/web/app/_components/episodes-ticker.tsx:16-19`). Isso toca a invariante 6 (dado sem licenca clara em pagina indexavel). Ele vive na home `/pt`, que e uma pagina publica. Ver 3.7 sobre o gate de placeholders.

#### Estrategia de render por rota

| Rota | Arquivo | Diretiva | Estrategia |
| --- | --- | --- | --- |
| `/pt/` (home) | `apps/web/app/pt/page.tsx:60` | `export const dynamic = "force-dynamic"` | SSR a cada request |
| `/pt/explorar/` | `apps/web/app/pt/explorar/page.tsx:45` | `force-dynamic` | SSR |
| `/pt/filmes/` | `apps/web/app/pt/filmes/page.tsx:21` | `force-dynamic` | SSR |
| `/pt/series/` | `apps/web/app/pt/series/page.tsx:21` | `force-dynamic` | SSR |
| `/pt/pessoas/` | `apps/web/app/pt/pessoas/page.tsx:21` | `force-dynamic` | SSR |
| `/pt/noticias/` | `apps/web/app/pt/noticias/page.tsx:19` | `force-dynamic` | SSR |
| `/pt/noticias/[slug]/` | `apps/web/app/pt/noticias/[slug]/page.tsx:20` | `force-dynamic` | SSR (sem ISR) |
| `/pt/filmes/[slug]/` | `apps/web/app/pt/filmes/[slug]/page.tsx:33` | `export const revalidate = 3600` | **ISR 1h** |
| `/pt/series/[slug]/` | `apps/web/app/pt/series/[slug]/page.tsx:19` | `revalidate = 3600` | **ISR 1h** |
| `/pt/pessoas/[slug]/` | `apps/web/app/pt/pessoas/[slug]/page.tsx:23` | `revalidate = 3600` | **ISR 1h** |
| `/sitemap.xml` | `apps/web/app/sitemap.ts:20` | `force-dynamic` | SSR |
| `/robots.txt` | `apps/web/app/robots.ts` | (nenhuma) | Estatico |
| `/filmes/` , `/series/` | `apps/web/app/filmes/page.tsx`, `apps/web/app/series/page.tsx` | — | `permanentRedirect` 308 → `/pt/...` |
| `/dev/movie-page-preview/` | `apps/web/app/dev/movie-page-preview/page.tsx` | — | **PLACEHOLDER** estatico com dados ficticios ("Interestelar", `:18-30`), `robots: noindex` (`:5`), `Disallow: /dev/` (`apps/web/app/robots.ts:25`) |

**Nao existe um unico `generateStaticParams` no repositorio** (grep global vazio). Consequencia: nenhuma pagina de entidade e pre-renderizada no build. As tres rotas `[slug]` com `revalidate = 3600` sao geradas sob demanda e cacheadas por 1h. Isso e coerente com o comentario em `apps/web/app/sitemap.ts:13-14` ("o build roda sem `DATABASE_URL` e nada e pre-renderizado"), e e o que permite `pnpm build` passar no CI sem banco. **REAL** e intencional, mas com um efeito colateral: **a home e todos os indices sao `force-dynamic`**, ou seja, cada request do Googlebot bate no PostgreSQL. Nao ha camada de cache HTTP declarada no repositorio. **DEBITO** — **NAO BLOQUEIA PRODUCAO** em escala pequena.

`trailingSlash: true` (`apps/web/next.config.ts:29`) alinha URL servida e `<link rel="canonical">`.

---

### 3.5 Como o SEO e gerado

Tres mecanismos, todos server-side, todos puros de rede:

1. **`generateMetadata`** — 10 ocorrencias, uma por rota publica:
   `apps/web/app/pt/page.tsx:113`, `pt/explorar/page.tsx:90`, `pt/filmes/page.tsx:27`, `pt/filmes/[slug]/page.tsx:42`, `pt/series/page.tsx:27`, `pt/series/[slug]/page.tsx:28`, `pt/pessoas/page.tsx:27`, `pt/pessoas/[slug]/page.tsx:40`, `pt/noticias/page.tsx:25`, `pt/noticias/[slug]/page.tsx:34`.
   Cada uma chama a mesma funcao server-only da pagina (ex.: `getMoviePageData(slug)`, memoizada com `cache()` do React — `apps/web/src/server/movie-page.ts:18`), le a decisao de indexabilidade e emite `robots: { index: shouldIndex }` + `alternates: { canonical }`.

2. **Decisao de indexabilidade** — `evaluateIndexability()` de `@screena/seo` (`packages/seo/src/indexability.ts`), reusada por `apps/web/src/lib/movie-indexability.ts`, `news-presenter.ts`, `person-presenter.ts`, `portal-presenter.ts`, `series-presenter.ts`, `entity-index-presenter.ts`. Funcao **pura**: recebe payload ja lido do banco, devolve `index | noindex | draft | stale | blocked`. Isso e o gate anti-thin (invariante 5) em codigo.

3. **JSON-LD inline** — cada pagina serializa o schema com `dangerouslySetInnerHTML` (`apps/web/app/pt/filmes/[slug]/page.tsx:102,119`; `pt/explorar/page.tsx:148,157`). Nao ha helper central de schema.org em `packages/seo` — a montagem e por rota. **DEBITO** de duplicacao, **NAO BLOQUEIA PRODUCAO**.

Complementos:

- `metadataBase: new URL(SITE_URL)` em `apps/web/app/layout.tsx:21`.
- `SITE_URL = "https://thescreen.media"` — **hardcoded**, nao vem de env (`apps/web/src/lib/site.ts:9`). **RISCO** — em ambiente de staging/preview (EasyPanel, dominio temporario) o canonical e o `sitemap` apontam para producao. **BLOQUEIA PRODUCAO** se houver um deploy publico indexavel em dominio temporario.
- `robots.txt` e gerado por `apps/web/app/robots.ts` (rota `MetadataRoute.Robots`), com `Disallow: ["/api/", "/dev/", "/admin/"]` e `sitemap: ${SITE_URL}/sitemap.xml`.
- `sitemap.xml` e `force-dynamic` e delega a `getSitemapEntries()` (`apps/web/src/server/seo/sitemap-entries.ts`), com fallback para rotas estaticas quando o banco esta indisponivel (`apps/web/app/sitemap.ts:16-18`).
- **Nao existe `alternates.languages` (hreflang) em lugar nenhum** — grep de `alternates` retorna so `canonical`. Isso e **correto** hoje pela invariante 7 (en/es nascem draft/noindex, sem contraparte publicada), e nao um esquecimento. **REAL**.
- `apps/web/middleware.ts` resolve o locale pelo primeiro segmento e injeta um header interno; **nao redireciona** por `Accept-Language` (`apps/web/middleware.ts:14-17`), respeitando a regra "sem redirect automatico de idioma em URL indexavel". O proprio arquivo se descreve como "FASE 0 - apenas placeholder" (`apps/web/middleware.ts:6`) — **PARCIAL**.

---

### 3.6 Estilo: Tailwind e uma dependencia morta

`CLAUDE.md` secao 4 diz: "**Estilo**: Tailwind CSS com tokens `--screena-*`". A realidade:

- `tailwindcss@^3.4.0` esta em `apps/web/package.json:31` e resolvido (`tailwindcss@3.4.19`).
- **Nao existe** `tailwind.config.{js,ts,mjs,cjs}` em lugar algum do repo.
- **Nao existe** `postcss.config.*` em lugar algum do repo.
- **Nao existe** nenhuma diretiva `@tailwind` ou `@apply` em nenhum `.css` (grep vazio).
- Os unicos CSS de fonte sao `apps/web/app/globals.css` (**3441 linhas**) e `apps/admin/app/globals.css` (986 linhas), escritos a mao em CSS puro com convencao BEM (`className="entity-card__image"`, `apps/web/app/_components/entity-card.tsx`).

Veredito: **PLACEHOLDER** na documentacao, **DEBITO** no `package.json`. Tailwind e peso morto de instalacao. **NAO BLOQUEIA PRODUCAO**.

Os tokens de cor canonicos vivem em `packages/config` e sao **espelhados** (nao importados) em `apps/web/app/globals.css:23-30`, com o comentario admitindo o espelhamento (`globals.css:23`). O `globals.css:12-14` tambem documenta que **nao ha fonte externa** (`next/font`, `fonts.googleapis.com`): Montserrat e apenas familia preferida, com fallback de sistema — zero rede no render.

Imagens: **nenhum `next/image`** e usado. Todas as imagens sao `<img>` cru (11 ocorrencias em `apps/web/app`). O `next.config.ts` **nao** declara `images.remotePatterns`. Isso e consistente com a decisao registrada em `apps/web/src/lib/tmdb-image-url.ts:6-10`: o servidor nao salva imagem, o banco guarda o `file_path` cru do TMDB e o helper monta `https://image.tmdb.org/t/p/{size}{path}` (`apps/web/src/lib/tmdb-image-url.ts:20`). O host so pode aparecer nesse arquivo — excecao nomeada em `scripts/audit/check-render-purity.mjs:130`.

---

### 3.7 Camada de dados: `packages/db`, Prisma, e a fronteira server-only

- Schema: `packages/db/prisma/schema.prisma`, **804 linhas**, `generator client { provider = "prisma-client-js" }` (`:16-18`), `datasource db { provider = "postgresql", url = env("DATABASE_URL") }` (`:20-23`). **27 models**, **13 enums**.
- Migrations reais: **3** — `20260625120000_init`, `20260701120000_add_news_articles`, `20260706120000_add_certification_screen_score`.
- `packages/db` exporta **dois** entrypoints (`packages/db/package.json:11-14`):
  - `.` → `src/index.ts`, que reexporta **apenas** `seed-data.js` (dados de semente tipados, puros). Nada de Prisma.
  - `./server` → `src/server.ts`, o singleton `getPrismaClient()` (`packages/db/src/server.ts:15-20`).

O comentario em `packages/db/src/server.ts:5-6` afirma: *"NUNCA pode ser importado pelo render publico (apps/web)"*. **Isso e falso na pratica.** `apps/web/src/server/*.ts` importa `@screena/db/server` em **11 lugares** (ex.: `apps/web/src/server/movie-page.ts:19`). A afirmacao correta — e que os guards de fato impoem — e: nunca importado por **arquivo de pagina/layout** nem por **client component**. O comentario esta desatualizado. **DEBITO** documental, sem impacto de seguranca (o import esta em modulos que so o servidor alcanca).

`transpilePackages: ["@screena/seo", "@screena/ui", "@screena/types", "@screena/db"]` (`apps/web/next.config.ts:33`) faz o Next compilar os pacotes como **fonte TypeScript** (`main: ./src/index.ts`). O `webpack.resolve.extensionAlias` (`apps/web/next.config.ts:37-45`) mapeia `.js → .ts` porque os pacotes usam a convencao NodeNext de importar `./x.js` apontando para `x.ts`.

Fluxo de leitura no render: `page.tsx` → `src/server/<entidade>-page.ts` (`cache()` do React) → `getPrismaClient()` → PostgreSQL → presenter puro em `src/lib/` → JSX. Nenhuma etapa toca a rede.

---

### 3.8 Onde a proibicao de API externa no render e imposta

Tres camadas, todas offline, nenhuma delas com type-checking real (sao **regex sobre texto**):

**(a) `scripts/audit/check-render-purity.mjs`** — 475 linhas, varre recursivamente `apps/web` (`:57`) e reprova:

| Regra | Escopo | Onde |
| --- | --- | --- |
| `fetch(` na mesma linha que host externo (`tmdb`, `themoviedb`, `rapidapi`, `googleapis`, `gemini`, `generativelanguage`, `rottentomatoes`, `imdb`) | **todo** arquivo de `apps/web` | `check-render-purity.mjs:83-101` |
| Literal `image.tmdb.org` | todo arquivo **exceto** `apps/web/src/lib/tmdb-image-url.ts` | `:120-130` |
| Import de `@screena/db`, `api-clients`, `services/ingestion|sync`, `@screena/tmdb-client` | **apenas** `page.*`/`layout.*`/`template.*`/`default.*` | `:136-158,192-208` |
| Import de `services/entity-writer` / SDK Gemini (`@google/genai`, `@google/generative-ai`, `google-generativeai`) | **todo** arquivo de `apps/web` | `:165-177` |
| Import de `@screena/db` ou `api-clients` | **todo** arquivo com diretiva `"use client"` | `:184-192` |

**(b) `tests/governance/no-render-external-api.test.ts`** — varre `apps/web/app` (so o diretorio de render) com regexes equivalentes; passa trivialmente se o diretorio nao existir (`:12`).

**(c) `tests/governance/web-render-layering.test.ts`** — espelha explicitamente as regras do auditor (`:14-16`), metade com fixtures inline, metade varrendo a arvore real.

Limites conhecidos destes guards (**RISCO**, **NAO BLOQUEIA PRODUCAO**):

- Sao **lexicais**. Um `fetch(url)` onde `url` e uma variavel montada em outra linha passa. Um `import` dinamico (`await import(...)`) passa. Um alias de reexport (`export { getPrismaClient } from "@screena/db/server"` num arquivo intermediario, importado por `page.tsx`) passa.
- A regra de `@screena/db` em `page.tsx` e por **nome de arquivo**, nao por grafo de imports. Nao ha analise transitiva.
- `apps/admin` **nao e varrido** por `check-render-purity.mjs` (`WEB_DIR = apps/web`, `:57`). O admin importa Prisma livremente — o que e o desenho —, mas nao ha guard equivalente contra API externa la (existe outra familia de testes: `tests/admin/no-server-writes.test.ts`, `no-write-endpoints.test.ts`, `no-secret-leak.test.ts`, `pages-no-write.test.ts`).

**(d) `scripts/audit/check-invariants.mjs`** — 359 linhas. Faz duas coisas: (i) exige frases-chave em `CLAUDE.md` e nos 5 `.claude/rules/*.md` (`:43-78`); (ii) varre `apps`, `packages`, `services`, `api-clients`, `seo` (`:86`) procurando `imdb` adjacente a `tomatometer`/`popcornmeter`/`tomate` (`:121-135`) — protege as invariantes 1 e 2 no nivel de texto.

---

### 3.9 CI, testes e o buraco entre HEAD e working tree

`.github/workflows/ci.yml` (working tree) roda, em `ubuntu-latest`, Node 22 + pnpm 9.15.4:

1. `pnpm install --frozen-lockfile` (`:27`)
2. `pnpm typecheck` (`:30`)
3. `pnpm lint` (`:33`)
4. `pnpm test` (`:36`)
5. `pnpm audit:invariants` (`:39`)
6. `pnpm audit:render` (`:42`)
7. `pnpm build` (`:45`)

**Mas os passos 6 e 7 e o proprio script `build` NAO ESTAO COMMITADOS.** `git diff` contra `HEAD` mostra que a versao commitada (`git show HEAD:package.json`, `git show HEAD:.github/workflows/ci.yml`) tem:

- `scripts` **sem** `"build"` (o `pnpm build` nao existe no HEAD);
- CI com `pnpm install --no-frozen-lockfile`;
- CI **sem** o passo "Auditoria de render publico" e **sem** "Build do app publico";
- `pnpm/action-setup@v4` **sem** `version:` fixada;
- `engines` frouxos (`node: ">=22"`, `pnpm: ">=9"`).

**RISCO** — **BLOQUEIA PRODUCAO** (do ponto de vista de garantia): no estado **commitado** do repositorio, **`audit:render` nunca roda em CI** e **`next build` nunca roda em CI**. A invariante 3 (zero API externa no render) esta protegida em CI apenas pelo teste `tests/governance/no-render-external-api.test.ts` (que varre so `apps/web/app`, nao `apps/web/src`) e por `web-render-layering.test.ts`. O auditor mais completo — o unico que conhece a excecao governada do `image.tmdb.org` e a regra de client components — nao e executado. **PROXIMO PASSO**: commitar `package.json` + `ci.yml` do working tree, ou explicar por que ficaram pendentes.

Suite de testes (Vitest, `environment: 'node'`, `vitest.config.ts:12`):

| Area | Arquivos `.test.ts` |
| --- | --- |
| `tests/admin/` | 33 |
| `services/entity-writer/src/__tests__/` | 22 |
| `tests/web/` | 18 |
| `tests/governance/` | 13 |
| `services/ingestion/src/__tests__/` | 9 |
| `api-clients/tmdb/src/__tests__/` | 3 |
| `services/sync/src/__tests__/` | 1 |
| **Total** | **99** |

Observacoes:

- `vitest.config.ts:6-11` inclui `tests/**`, `packages/**`, `api-clients/**`, `services/**`. **`apps/**` nao esta no include** — mas os testes de `apps` existem sob `tests/web/` e `tests/admin/`, importando por caminho relativo (`../../apps/web/src/lib/movie-presenter`). Funciona; e fragil a mover arquivos.
- `packages/**/*.test.ts` esta no include mas **nao ha nenhum teste dentro de `packages/`** — a cobertura de `@screena/seo`, `@screena/schemas`, `@screena/ui` mora em `tests/governance/`.
- `tests/e2e/`, `tests/integration/`, `tests/seo/`, `tests/unit/` contem **apenas `.gitkeep`**. **NAO IMPLEMENTADO** — zero teste E2E, zero teste de integracao com banco no CI.
- Testes de governanca (13): `docs-invariants-present`, `entity-writer-output`, `episode-no-season-number`, `index-language-guard`, `indexability`, `no-render-external-api`, `rating-scales-mirror`, `ratings`, `schema-safe-defaults`, `seed-disjoint`, `tmdb-provider-separation`, `vertical`, `web-render-layering`.
- **NAO FOI POSSIVEL CONFIRMAR** que `pnpm test` esta verde: nao executei a suite (a auditoria e read-only e o enunciado proibe rodar build/servidor). Ha registro de memoria de sessao anterior indicando 2 falhas pre-existentes em `tests/web/public-navigation.test.ts`; nao consegui verificar isso sem executar o Vitest.

Lint: `eslint .` na raiz (`package.json:14`), flat config em `eslint.config.mjs`. Usa `eslint.configs.recommended` + `tseslint.configs.recommended` (**sem** type-aware linting: nao ha `parserOptions.project`), `no-undef` desligado em `.ts/.tsx` (`eslint.config.mjs:60-66`), globais Node/Web declarados a mao para nao depender do pacote `globals` (`eslint.config.mjs:5-24`). Ignora `**/.next/**`, `**/dist/**`, `**/next-env.d.ts` (`:29-40`).

Prettier: `.prettierrc.json` pede `semi: false, singleQuote: true`. **O codigo de `apps/web` usa ponto-e-virgula e aspas duplas.** Como `eslint-config-prettier` apenas **desliga** regras de formatacao (nao aplica), e **nao ha script `format:check` nem passo de CI**, a formatacao do repo diverge do proprio `.prettierrc.json`. **DEBITO**, **NAO BLOQUEIA PRODUCAO**.

---

### 3.10 Deploy: Nixpacks vs. CloudPanel — duas verdades no repo

Fatos verificaveis:

- **Nao existe** `Dockerfile`, `nixpacks.toml`, `Procfile` ou qualquer manifesto de build de container no repositorio (busca por nome + `find` retornam vazio; o unico `.toml` e `workers/pyproject.toml`).
- O unico artefato de container e `docker-compose.dev.yml`, que sobe **apenas** o `postgres:16-alpine` para dev local.
- `docs/CLOUDPANEL_DEPLOY.md` descreve um deploy **VPS + CloudPanel + PM2/systemd**, com units `the-screen-worker-rssprime.service` etc. (`docs/CLOUDPANEL_DEPLOY.md:382`).
- `scripts/deploy/README.md:3-5` admite: *"Hoje ainda existe **apenas** este README descrevendo o contrato e o fluxo"* — os scripts de deploy **nao existem**.
- `services/sync/systemd/screena-tmdb-catalog.service` e `.timer` existem, mas o proprio arquivo se declara "Ilustrativo" e usa `tsx` em producao (`:19`).
- `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:99-103` afirma que o deploy real e **EasyPanel via Nixpacks auto-detectado** (pnpm + Next), e que `CLOUDPANEL_DEPLOY.md` e "o alvo historico/futuro, **nao** o deploy EasyPanel atual".

Veredito: **Nixpacks nao esta configurado no repositorio** — e auto-deteccao da plataforma. **PLACEHOLDER** de infraestrutura versionada. Nao ha `start` script na raiz (`package.json:12-20`); a plataforma precisa descobrir sozinha que deve rodar `apps/web`. **RISCO** — **BLOQUEIA PRODUCAO** para reprodutibilidade: nao ha nenhum arquivo no repo que descreva como o app de producao e construido e iniciado. Duas documentacoes contraditorias (`docs/CLOUDPANEL_DEPLOY.md` vs. `docs/SCREEN_STATUS_*.md`) sao pior que nenhuma. **PROXIMO PASSO**: commitar um `nixpacks.toml` (ou Dockerfile) explicito com `pnpm install --frozen-lockfile && pnpm build` e `next start` a partir de `apps/web`.

Nota tecnica: `pnpm build` = `corepack pnpm --filter @screena/web build` (`package.json:13`). Chamar `corepack pnpm` de dentro de um script `pnpm` e redundante e assume `corepack` no PATH do builder. **DEBITO** menor.

---

### 3.11 Clients externos

#### TMDB — **REAL**

`api-clients/tmdb/` (`@screena/tmdb-client`), 6 modulos + 3 suites de teste. Caracteristicas verificadas:

- Auth por env, v4 Bearer preferido sobre v3 `api_key` (`api-clients/tmdb/src/config.ts:65-69`); lanca `TmdbConfigError` se nenhum existir (nunca chama rede sem auth).
- `loadTmdbConfig(env)` e **puro** (recebe o env como argumento, `config.ts:5-6`).
- Tunables por env: `TMDB_API_BASE_URL`, `TMDB_DEFAULT_LANGUAGE`, `TMDB_MAX_RPS`, `TMDB_MAX_RETRIES`, `TMDB_BREAKER_THRESHOLD`, `TMDB_BREAKER_COOLDOWN_MS`, `TMDB_CACHE_TTL_MS`.
- Separacao explicita `provider_api` vs. namespace de external id: `TMDB_PROVIDER_API = 'tmdb'` (para `api_cache`/`api_sync_logs`/`api_providers`) vs. `tmdbExternalIdSource(kind)` → `tmdb_movie|tmdb_tv|tmdb_person` (para `entity_external_ids.source`) — `api-clients/tmdb/src/provider.ts:14-23,43-48`. Isso e a invariante 2 codificada; travada por `tests/governance/tmdb-provider-separation.test.ts`.
- Endpoints implementados: `/movie/{id}`, `/tv/{id}`, `/tv/{id}/season/{n}`, `/person/{id}`, `/movie/upcoming` (`api-clients/tmdb/src/endpoints.ts:54,61,68,72,79`). **PARCIAL** — nao ha `/search`, `/trending`, `/watch/providers`, `/movie/{id}/images`.

#### Gemini — **REAL** (adapter), **PARCIAL** (uso)

Existe e e substancial: `services/entity-writer/src/gemini/{config.ts, adapter.ts, fake.ts}`.

- `GeminiAdapter implements GeminiPort` (`adapter.ts:159`), REST puro sobre `fetch` — **sem SDK** (`adapter.ts:5`).
- Chave **so** no header `x-goog-api-key`, nunca na URL nem em log (`adapter.ts:271-276`).
- `loadGeminiConfig` exige `GEMINI_API_KEY` **e** `GEMINI_MODEL`; nao ha modelo default de produto (`gemini/config.ts:88-95`).
- Resiliencia: throttle por `maxRps`, retry com backoff exponencial + jitter, `Retry-After` em 429, 4xx (exceto 429) permanente e nao conta pro breaker, circuit breaker com cooldown (`adapter.ts:196-240`).
- `fake.ts` para CI (nenhum teste chama rede).
- Exportado como subpath isolado: `"./gemini": "./src/gemini/adapter.ts"` (`services/entity-writer/package.json:13`), o que permite que `check-render-purity.mjs:165-177` bloqueie o import inteiro em `apps/web`.

Onde roda: `services/entity-writer/bin/{run-offline.ts, run.ts, smoke-gemini.ts}` — todos em `bin/`, **excluidos do typecheck** (`tsconfig.json:24`) e do bundle. **Invariante 4 (zero Gemini no render): respeitada** — nenhum arquivo de `apps/web` importa `@screena/entity-writer` nem qualquer SDK Gemini, e o guard bloqueia globalmente (nao so em `page.tsx`).

O que **nao foi possivel confirmar**: se o adapter ja gerou `content_blocks` reais em producao. O codigo existe e tem 22 testes, mas isso nao prova execucao contra a API real.

#### RSS Prime / MN26 — **NAO IMPLEMENTADO**

Grep exaustivo por `rssprime|rss_prime|rss prime|mn26` em `.ts/.py/.md/.json/.mjs`: **zero linhas de codigo**. Todas as 24 ocorrencias sao:

- comentarios de negacao ("nao chama TMDB/Gemini/WordPress/MN26" — `apps/web/src/server/news-pages.ts:6`, `related-news.ts:7`, `seo/sitemap-entries.ts:6`, `apps/admin/scripts/staging-seed.ts:15`);
- documentacao de roadmap (`docs/BUILD_PLAN.md:53-54,305,325`: "Fase 9 — RSSPRIME", "Fase 10 — MN26 News", ambas **Planejada**);
- regras de governanca listando as features como inativas (`.claude/rules/seo.md:64`, `.claude/rules/ingestion.md:49`, `CLAUDE.md:21`);
- `workers/rssprime_worker.py` — 48 linhas de stub que so loga "nao implementado";
- `docs/ENTITY_WRITER.md:25,57-59`, onde MN26 aparece como **ancestral conceitual** do Entity Writer, nao como integracao.

`services/news-ingestion/` tem **so um README**. Nao ha feed parser, nao ha `articles` sendo ingeridos de RSS. O que existe de noticias e a **tabela** (`migration 20260701120000_add_news_articles`), as rotas `/pt/noticias/**` e os presenters — populados por seed/demo, nao por ingestao. **PLACEHOLDER** de pipeline.

#### Demais clients — **NAO IMPLEMENTADO**

`api-clients/{imdb, rotten_tomatoes, film_show_ratings, streaming_availability, kaso}`: README apenas. Sem `package.json`, sem `src/`. Consistente com `CLAUDE.md:21` ("ratings externos, streaming/onde assistir ... nao estao funcionais").

---

### 3.12 `packages/schemas`

Tres arquivos (`packages/schemas/src/`): `index.ts`, `ratings.ts`, `entity-writer-output.ts`. **Nao usa Zod nem nenhuma lib** — validacao escrita a mao, TS puro, sem dependencia de runtime alem de `@screena/config` (`packages/schemas/package.json:12-14`).

- `ratings.ts` — `validateRating` / `assertRatingIntegrity`: cross-label (IMDb x Tomatometer), `provider_api !== rating_source`, escala canonica por fonte. Travado por `tests/governance/ratings.test.ts` (4 casos, 3 devem falhar).
- `entity-writer-output.ts` — `validateEntityWriterOutput` (forma) + `validateAgainstPayload` (anti-alucinacao: nome proprio fora do payload vira warning). Travado por `tests/governance/entity-writer-output.test.ts`.

**Nao e importado por `apps/web`** (grep vazio) — o app publico nao valida ratings porque **nao exibe ratings externos**. Consumido por `services/entity-writer` (`services/entity-writer/package.json:19`). **REAL**, mas com superficie de uso restrita.

`packages/config` expoe `INVARIANTS` (as 13, texto fiel — `packages/config/src/invariants.ts:24+`), `RATING_SOURCES`, `RATING_SCALES`, tokens de cor, e `getEnv`/`requireEnv` (`packages/config/src/env.ts:20,35`) que nunca leem env no import (puro para tree-shaking).

---

### 3.13 Inventario de scripts `package.json`

#### Raiz (`package.json:12-20`)

| Script | Comando | O que faz |
| --- | --- | --- |
| `build` | `corepack pnpm --filter @screena/web build` | `next build` **so** do app publico. Admin nunca e buildado. **Nao existe no HEAD commitado.** |
| `lint` | `eslint .` | Flat config, todo o repo (menos ignores). Sem type-aware rules. |
| `typecheck` | `tsc -p tsconfig.json --noEmit` | Cobre `packages`, `api-clients`, `services`, `tests` — **exclui `apps/**` e toda a camada de persistencia** (ver 3.3). |
| `test` | `vitest run` | 99 arquivos de teste, `environment: node`. |
| `test:watch` | `vitest` | Modo watch. |
| `audit:invariants` | `node scripts/audit/check-invariants.mjs` | Frases das invariantes nos docs + varredura `imdb`≈`tomatometer`. |
| `audit:render` | `node scripts/audit/check-render-purity.mjs` | Pureza de render em `apps/web`. **Nao roda no CI commitado.** |

#### `apps/web` (`apps/web/package.json:7-17`)

| Script | Comando | O que faz |
| --- | --- | --- |
| `dev` / `build` / `start` / `lint` / `typecheck` | padrao Next | `typecheck` = `tsc --noEmit` com `apps/web/tsconfig.json` (exclui `scripts/`). |
| `validate:movie-page` | `tsx scripts/validate-movie-page-real-postgres.ts` | Valida a pagina de filme contra um PostgreSQL **embedded** real (sem subir Next). |
| `validate:series-page` | idem | Idem para serie. |
| `validate:person-page` | idem | Idem para pessoa. |
| `validate:entity-indexes` | idem | Valida os indices (listagens). |
| `validate:news-pages` | idem | Valida `/pt/noticias/**`; o cabecalho do script (`:9`) reafirma "nao chama TMDB/Gemini/WordPress/MN26". |
| `seed:dev-movie` | `tsx scripts/seed-dev-movie.ts` | Semeia **um filme de demo** no banco de dev. **PLACEHOLDER**. |
| `gen:demo-media` | `node scripts/generate-demo-media.mjs` | Gera midia de demonstracao local. **PLACEHOLDER**. |

#### `apps/admin` (`apps/admin/package.json:7-13`)

Apenas `dev`, `build`, `start`, `lint`, `typecheck`. **DEBITO**: os tres scripts reais de `apps/admin/scripts/` (`public-demo-seed.ts`, `public-demo-seed-plan.ts`, `staging-seed.ts`) **nao tem entrada em `package.json`** e o pacote **nao declara `tsx`** como devDependency — dependem de resolucao hoisted a partir da raiz.

#### `packages/db` (`packages/db/package.json:16-23`)

| Script | Comando |
| --- | --- |
| `db:validate` | `prisma validate` |
| `db:format` | `prisma format` |
| `db:generate` | `prisma generate` |
| `db:migrate:dev` | `prisma migrate dev` |
| `db:migrate:deploy` | `prisma migrate deploy` |
| `db:seed` | `tsx prisma/seed.ts` |
| `db:validate:real` | `tsx scripts/validate-real-postgres.ts` (embedded-postgres) |

Bloco `prisma` (`packages/db/package.json:14-17`): `schema: prisma/schema.prisma`, `seed: tsx prisma/seed.ts`.

#### `services/entity-writer` (`services/entity-writer/package.json:16-21`)

| Script | Comando | O que faz |
| --- | --- | --- |
| `validate:real` | `tsx scripts/validate-real-postgres.ts` | Valida persistencia contra Postgres embedded. |
| `smoke:gemini` | `tsx bin/smoke-gemini.ts` | Smoke test do adapter (usa `SMOKE_TEST_FAKE_KEY` quando fake). |
| `run:offline` | `tsx bin/run-offline.ts` | Roda a geracao editorial offline. |
| `inspect` | `tsx bin/inspect.ts` | Inspeciona jobs/blocos gravados. |

`bin/enqueue.ts` e `bin/run.ts` existem mas **nao tem script correspondente**.

#### `services/ingestion` e `services/sync`

**Nenhum script.** Os CLIs (`services/ingestion/bin/import.ts`, `bin/ingest-public-catalog.ts`, `services/sync/bin/run.ts`) sao invocados a mao via `tsx`. O `ingest-public-catalog.ts` e o worker que popula o catalogo publico real: dry-run por padrao, exige `--apply`, **aborta em producao**, exige token + `DATABASE_URL` (`services/ingestion/bin/ingest-public-catalog.ts:24-27`). A flag `--download-images` e explicitamente **legado** (`:18-20`).

---

### 3.14 Variaveis de ambiente efetivamente lidas pelo codigo

Extraidas por grep de `process.env.*` em `apps/`, `packages/`, `services/`, `api-clients/`, `scripts/`:

| Variavel | Consumidor | Observacao |
| --- | --- | --- |
| `DATABASE_URL` | `packages/db/prisma/schema.prisma:22`, workers | Obrigatoria em runtime; **nao** no build (`apps/web/app/sitemap.ts:13`) |
| `TMDB_READ_ACCESS_TOKEN` / `TMDB_API_KEY` | `api-clients/tmdb/src/config.ts:65-69` | v4 preferido; worker-only |
| `TMDB_API_BASE_URL`, `TMDB_DEFAULT_LANGUAGE`, `TMDB_MAX_RPS`, `TMDB_MAX_RETRIES`, `TMDB_BREAKER_THRESHOLD`, `TMDB_BREAKER_COOLDOWN_MS`, `TMDB_CACHE_TTL_MS` | idem | Tunables |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `services/entity-writer/src/gemini/config.ts:81-95` | Ambos obrigatorios; sem default de modelo |
| `GEMINI_API_BASE_URL`, `GEMINI_MAX_RPS`, `GEMINI_MAX_RETRIES`, `GEMINI_BREAKER_THRESHOLD`, `GEMINI_BREAKER_COOLDOWN_MS` | idem | Tunables |
| `ADMIN_PROTECTION_ENABLED`, `ADMIN_BASIC_AUTH_USER`, `ADMIN_BASIC_AUTH_PASSWORD` | `apps/admin/src/lib/access-protection.ts` | Basic Auth stateless |
| `ADMIN_EDITORIAL_ACTIONS_ENABLED` | `apps/admin/src/server/editorial-actions*.ts` | Feature flag de escrita |
| `NODE_ENV`, `VERCEL_ENV` | `apps/admin/src/lib/access-protection.ts:56-57` | Deteccao "production-like". **DEBITO**: `VERCEL_ENV` nao existe em EasyPanel/CloudPanel — deteccao depende so de `NODE_ENV` no deploy real |
| `SCREEN_HOME_VISUAL_PLACEHOLDERS` | `apps/web/src/lib/home-placeholder-governance.ts:30` | `"1"` libera placeholders em producao. **Nao** e `NEXT_PUBLIC_*` (`:17`) |
| `SMOKE_TEST_FAKE_KEY` | `services/entity-writer/src/smoke/smoke-gemini.ts` | Teste |

**Zero ocorrencias de `NEXT_PUBLIC_*` em codigo** (as duas linhas encontradas sao comentarios proibindo o uso). Nenhum segredo atravessa para o bundle. **REAL**.

**NAO FOI POSSIVEL CONFIRMAR** o conteudo de `.env.example`: o arquivo existe (`.env.example`, 2531 bytes) mas a leitura foi **negada pelas permissoes** do ambiente de auditoria (padrao de bloqueio de `.env*`). A lista acima e derivada do codigo, nao do exemplo — e possivel que `.env.example` documente variaveis que ninguem le, ou omita variaveis que o codigo exige.

---

### 3.15 Resumo de debitos e riscos da stack

| # | Item | Severidade | Evidencia |
| --- | --- | --- | --- |
| 1 | `audit:render` e `pnpm build` **nao existem no CI commitado**; so no working tree sujo | **BLOQUEIA PRODUCAO** | `git show HEAD:.github/workflows/ci.yml` vs. `.github/workflows/ci.yml:41-45` |
| 2 | `SITE_URL` hardcoded → canonical/sitemap de producao em qualquer ambiente | **BLOQUEIA PRODUCAO** | `apps/web/src/lib/site.ts:9` |
| 3 | Nenhum manifesto de build/deploy versionado (sem Dockerfile/nixpacks.toml/Procfile/`start`) | **BLOQUEIA PRODUCAO** | ausencia verificada; `scripts/deploy/README.md:3-5` |
| 4 | `EpisodesTicker` (client component na home `/pt`) afirma episodio novo + plataforma de streaming com dados hardcoded | **BLOQUEIA PRODUCAO** (invariantes 6 e 8 em risco) | `apps/web/app/_components/episodes-ticker.tsx:53,79,93` |
| 5 | Toda a camada de escrita no Postgres esta fora do `pnpm typecheck` | NAO BLOQUEIA PRODUCAO | `tsconfig.json:20,22,24,25` |
| 6 | `apps/admin` nunca e typechecked nem buildado em CI | NAO BLOQUEIA PRODUCAO | `.github/workflows/ci.yml` (sem passo de admin) |
| 7 | Guards de pureza de render sao regex lexical, sem analise de grafo de imports | NAO BLOQUEIA PRODUCAO | `scripts/audit/check-render-purity.mjs:136-208` |
| 8 | Pacote `server-only` nao instalado; fronteira e convencao de diretorio | NAO BLOQUEIA PRODUCAO | `apps/web/src/server/movie-page.ts:14-15` |
| 9 | Tailwind instalado, zero config, zero uso; doc afirma que e a stack de estilo | NAO BLOQUEIA PRODUCAO | `apps/web/package.json:31`; `CLAUDE.md` secao 4 |
| 10 | `seo/*.ts` (224 linhas) e codigo morto, nao typechecked, nao importado | NAO BLOQUEIA PRODUCAO | `seo/indexability.ts`; grep de importadores vazio |
| 11 | `packages/ui` nao tem componentes; doc diz que tem | NAO BLOQUEIA PRODUCAO | `packages/ui/src/index.ts:10-11` |
| 12 | Comentario em `packages/db/src/server.ts` afirma que nunca e importado por `apps/web` — e importado 11x | NAO BLOQUEIA PRODUCAO | `packages/db/src/server.ts:5-6` vs. `apps/web/src/server/movie-page.ts:19` |
| 13 | Prettier configurado (`semi:false`) diverge do codigo (`semi:true`); sem `format:check` em CI | NAO BLOQUEIA PRODUCAO | `.prettierrc.json`; `apps/web/**/*.tsx` |
| 14 | `VERCEL_ENV` como sinal de ambiente num deploy que nao e Vercel | NAO BLOQUEIA PRODUCAO | `apps/admin/src/lib/access-protection.ts:56-57` |
| 15 | Node local (`v24.14.0`) viola `engines: node >=22 <23` | NAO BLOQUEIA PRODUCAO | `package.json:9` |
| 16 | Home e todos os indices sao `force-dynamic`: cada crawl bate no Postgres, sem cache HTTP declarado | NAO BLOQUEIA PRODUCAO | `apps/web/app/pt/page.tsx:60` e demais |
| 17 | Zero teste E2E / integracao (`tests/e2e`, `tests/integration` so `.gitkeep`) | NAO BLOQUEIA PRODUCAO | `tests/e2e/.gitkeep` |
| 18 | `services/ingestion` e `services/sync` sem scripts npm; CLIs invocados a mao | NAO BLOQUEIA PRODUCAO | `services/ingestion/package.json` (sem `scripts`) |

---

### 3.16 Incertezas declaradas

- **NAO FOI POSSIVEL CONFIRMAR** que `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm audit:invariants` e `pnpm audit:render` passam hoje: a auditoria e read-only e nao executei nenhum deles.
- **NAO FOI POSSIVEL CONFIRMAR** o conteudo de `.env.example` — leitura negada pela politica de permissoes do ambiente.
- **NAO FOI POSSIVEL CONFIRMAR** se o `GeminiAdapter` ja foi executado contra a API real (existe `bin/smoke-gemini.ts`, mas nenhum artefato de execucao no repo).
- **NAO FOI POSSIVEL CONFIRMAR** o conteudo real do banco de producao (EasyPanel): as afirmacoes sobre "so seed/demo" nesta secao referem-se ao que o **codigo** popula, nao ao estado do banco remoto.
- **NAO FOI POSSIVEL CONFIRMAR** como o EasyPanel injeta segredos (build arg vs. runtime env) — nao ha configuracao de plataforma versionada no repo.


---

## Parte 4 — Banco de dados e modelagem

### 4.0 Escopo, fonte executavel e metodo desta auditoria

A fonte executavel unica do banco e `packages/db/prisma/schema.prisma` (804 linhas, 27 `model`, 13 `enum`), com tres migrations em `packages/db/prisma/migrations/`. `database/schema.md` e documentacao historica e ele mesmo se declara nao-executavel (`database/schema.md:3`).

| Artefato | Caminho | Fato |
| --- | --- | --- |
| Schema Prisma | `packages/db/prisma/schema.prisma` | 27 models, 13 enums, 50 `@@index`, 12 `@@unique` |
| Migration 1 (init) | `packages/db/prisma/migrations/20260625120000_init/migration.sql` | 24 tabelas + 13 enums + 3 indices unicos parciais + 7 CHECKs em SQL bruto (`:731-773`) |
| Migration 2 (noticias) | `packages/db/prisma/migrations/20260701120000_add_news_articles/migration.sql` | `articles`, `article_translations`, `entity_news_links` |
| Migration 3 (score/cert) | `packages/db/prisma/migrations/20260706120000_add_certification_screen_score/migration.sql` | `certification`, `screen_score`, `screen_score_scale`, `screen_score_display` em `movies`/`tv_shows` |
| Seed runner | `packages/db/prisma/seed.ts` | Upsert idempotente de 5 tabelas-semente |
| Dados de seed | `packages/db/src/seed-data.ts` | 3 idiomas, 13 paises, 5 rating sources, 4 api providers, 5 licencas |
| Acessor Prisma | `packages/db/src/server.ts` | Singleton `getPrismaClient()` |
| Harness de validacao | `packages/db/scripts/validate-real-postgres.ts` | Sobe Postgres embarcado e testa constraints (nao e codigo de produto) |

Metodo: leitura integral do schema e das 3 migrations; `grep` de `prisma.<model>.`, `tx.<model>.`, `$executeRaw`/`$queryRaw` e nomes de tabela crus por todo `apps/`, `services/`, `scripts/`, `packages/`, `tests/`, `workers/`, `api-clients/`. Onde afirmo "nenhum uso", o grep cobriu tanto o acessor Prisma quanto SQL bruto.

**RISCO — a migration 3 nao esta em `main`.** `git merge-base --is-ancestor 5732c9e main` retorna falso: o commit `5732c9e feat(web): add public home hero carousel` — que carrega `20260706120000_add_certification_screen_score` — existe **apenas** na branch `feat/home-hero-carousel`. `main` (`ae576f4`) nao tem as colunas `certification`/`screen_score*`, mas `apps/web/src/server/home-hero.ts:122-125` e `apps/web/src/server/entity-indexes.ts:108-110` fazem `select` delas. Um deploy a partir de `main` quebra o hero e as listagens em runtime. **BLOQUEIA PRODUCAO** se o pipeline de deploy apontar para `main`.

---

### 4.1 Inventario completo dos 27 models

| # | Model | Tabela | Linha | Grupo |
| --- | --- | --- | --- | --- |
| 1 | `Language` | `languages` | `schema.prisma:144` | semente/i18n |
| 2 | `Country` | `countries` | `schema.prisma:165` | semente |
| 3 | `RatingSource` | `rating_sources` | `schema.prisma:176` | semente/ratings |
| 4 | `ApiProvider` | `api_providers` | `schema.prisma:188` | semente/infra |
| 5 | `SourceLicense` | `source_licenses` | `schema.prisma:202` | licenca |
| 6 | `Movie` | `movies` | `schema.prisma:228` | midia |
| 7 | `TvShow` | `tv_shows` | `schema.prisma:267` | midia |
| 8 | `Season` | `seasons` | `schema.prisma:307` | midia |
| 9 | `Episode` | `episodes` | `schema.prisma:330` | midia |
| 10 | `Person` | `people` | `schema.prisma:356` | pessoas |
| 11 | `CastMember` | `cast_members` | `schema.prisma:383` | creditos |
| 12 | `CrewMember` | `crew_members` | `schema.prisma:401` | creditos |
| 13 | `EntityExternalId` | `entity_external_ids` | `schema.prisma:423` | identidade |
| 14 | `Slug` | `slugs` | `schema.prisma:438` | rotas/SEO |
| 15 | `Redirect` | `redirects` | `schema.prisma:457` | rotas/SEO |
| 16 | `EntityTranslation` | `entity_translations` | `schema.prisma:473` | i18n/SEO |
| 17 | `ContentBlock` | `content_blocks` | `schema.prisma:504` | editorial/IA |
| 18 | `EntityWriterJob` | `entity_writer_jobs` | `schema.prisma:531` | jobs |
| 19 | `EntityWriterLog` | `entity_writer_logs` | `schema.prisma:561` | jobs/observabilidade |
| 20 | `ExternalRating` | `external_ratings` | `schema.prisma:590` | ratings |
| 21 | `WatchAvailability` | `watch_availability` | `schema.prisma:626` | streaming |
| 22 | `PageIndexabilityDecision` | `page_indexability_decisions` | `schema.prisma:654` | SEO/governanca |
| 23 | `ApiCache` | `api_cache` | `schema.prisma:686` | cache |
| 24 | `ApiSyncLog` | `api_sync_logs` | `schema.prisma:705` | logs |
| 25 | `Article` | `articles` | `schema.prisma:741` | noticias |
| 26 | `ArticleTranslation` | `article_translations` | `schema.prisma:766` | noticias/i18n |
| 27 | `EntityNewsLink` | `entity_news_links` | `schema.prisma:791` | noticias/ligacao |

Models citados no prompt que **NAO EXISTEM no schema**: `Franchise`, `Image`, `Trailer`, `Platform`, `Provider` (existe `ApiProvider`, que e fornecedor tecnico de API, nao provedor de streaming), alem de `NewsCluster` e `Review`, ambos citados em `.claude/rules/ingestion.md` e `docs/`. `database/schema.md:27,36,55,62,70` ja registra essas tabelas como planejadas — o documento e honesto nesse ponto.

Existe um 28o model no prompt implicitamente: `RatingSource`/`SourceLicense` sao **dois** models distintos, nao um.

---

### 4.2 Grupo A — Entidades de midia

| Model | Para que serve | Usado no codigo? | Tem dado real hoje? | Fundacao futura? | Relacoes principais | Campos criticos |
| --- | --- | --- | --- | --- | --- | --- |
| `Movie` | Filme canonico | **REAL** — escrito por `services/ingestion/src/persistence/store.ts:168`; lido por 6 loaders de `apps/web/src/server/` | **REAL** para campos TMDB (`titleOriginal`, `releaseDate`, `posterPath`...). **PLACEHOLDER** para `screenScore`/`certification` (so o demo seed grava, ver 4.9) | — | `language` (FK opcional `original_language -> languages.code`) | `tmdbId @unique`, `imdbId @unique`, `voteAverageTmdb`, `screenScore*`, `staleAfter` |
| `TvShow` | Serie canonica | **REAL** — `store.ts:211`; lido por `series-page.ts:69`, `entity-indexes.ts:145`, `home-hero.ts:165` | idem `Movie` | — | `language`, `seasons[]` | `tmdbId @unique`, `numberOfSeasons/Episodes`, `screenScore*` |
| `Season` | Temporada | **PARCIAL** — escrito em `store.ts:255`; lido em `series-page.ts:112` (guia de temporadas) e `content-qa.ts:108` | **REAL** quando `importTvShow` roda (`services/ingestion/src/import/import-tv.ts:63`) | Nao ha rota `/pt/series/{slug}/temporada-{n}/` — `find apps/web/app -type d` nao lista nenhuma pasta de temporada | `tvShow` (Cascade), `episodes[]` | `@@unique([tvShowId, seasonNumber])`, `@@unique([id, tvShowId])` (alvo da FK composta) |
| `Episode` | Episodio | **PARCIAL** — escrito em `store.ts:273`; lido apenas aninhado em `series-page.ts:122` e por contagem em `content-qa.ts:109` | **REAL** via ingestao de serie | Sem rota propria; sem slug; sem `content_blocks` de episodio gerados | `season` via **FK composta** `(seasonId, tvShowId) -> seasons(id, tvShowId)` (`migration.sql:678`) | `@@unique([seasonId, episodeNumber])`; **nao armazena `season_number`** por design (`schema.prisma:345-348`, travado por `tests/governance/episode-no-season-number.test.ts`) |

Observacao de design forte e correta: a FK composta de `Episode` impede que o `tv_show_id` do episodio divirja do da temporada. Isso e verificado no harness `packages/db/scripts/validate-real-postgres.ts:16` (teste 16).

**DEBITO — todos os `Decimal` sao `DECIMAL(65,30)`.** `popularity`, `voteAverageTmdb`, `screenScore`, `ratingValue`, `price` usam o default do Prisma (`migration.sql:118-119`, `:382`, `:409`). Nenhuma precisao declarada. Alem do custo de armazenamento/serializacao, forca `decimalToNumber()` defensivo em cada loader (`apps/web/src/server/home-hero.ts:41`, `entity-indexes.ts:53`). **NAO BLOQUEIA PRODUCAO**.

---

### 4.3 Grupo B — Pessoas e creditos

| Model | Para que serve | Usado no codigo? | Tem dado real hoje? | Fundacao futura? | Relacoes | Campos criticos |
| --- | --- | --- | --- | --- | --- | --- |
| `Person` | Pessoa (ator/diretor/equipe) | **REAL** — upsert de stub em `store.ts:72`, upsert completo em `store.ts:324`; lido em `person-page.ts:81`, `entity-indexes.ts:191`, `entity-cast.ts:50` | **REAL** (stubs criados de `credits` do TMDB) | — | `castCredits[]`, `crewCredits[]` | `tmdbId @unique`, `imdbId @unique`, `biographySourceStatus` |
| `CastMember` | Elenco (polimorfico `movie|tv`) | **REAL** — replace-set em `store.ts:104-122`; lido em `entity-cast.ts:42`, `person-page.ts:118`, `payload-source.ts:31` | **REAL** | — | `person` (Cascade); entidade por `(entityType, entityId)` **sem FK** (D1) | `creditId @unique`, `billingOrder`, `@@index([entityType, entityId])` |
| `CrewMember` | Equipe (polimorfico) | **REAL** — `store.ts:140`; lido em `home-hero.ts:89` (diretor), `person-page.ts:127`, `payload-source.ts:36` | **REAL** | — | `person` (Cascade) | `department`, `job` (`"Director"` e a chave usada para o hero e para o payload do Entity Writer) |

**RISCO — `Person.biographySourceStatus` governa uma coluna que nao existe.** O comentario diz "governa EXIBICAO da bio (inv. 6)" (`schema.prisma:367`), mas `Person` **nao tem coluna `biography`**. O gate de licenca existe sem o dado licenciado. Grep confirma: `biographySourceStatus` tem 0 ocorrencias em `apps/web`. **NAO BLOQUEIA PRODUCAO** (nada e exibido), mas o modelo mente sobre sua propria capacidade.

**RISCO — pessoas nunca ganham slug na ingestao real.** `services/ingestion/bin/ingest-public-catalog.ts:173` so cria slug para `entityType` `movie|tv` (a funcao `finalize` recebe `'movie' | 'tv'`). Os unicos criadores de slug de `person` sao `apps/admin/scripts/public-demo-seed.ts:359` e os harnesses `apps/web/scripts/validate-*.ts`. Consequencia direta: apos uma ingestao real do TMDB, a tabela `people` fica populada (via credits) mas `/pt/pessoas/` renderiza vazio, porque `getPersonIndexData` parte de `prisma.slug.findMany({ entityType: "person", isCanonical: true })` (`apps/web/src/server/entity-indexes.ts:186`), e o elenco nas paginas de detalhe nunca vira link (`entity-cast.ts:58-75` devolve `slug: null`). **BLOQUEIA PRODUCAO** para a rota de pessoas.

---

### 4.4 Grupo C — Identidade, rotas e i18n

| Model | Para que serve | Usado no codigo? | Tem dado real hoje? | Fundacao futura? | Relacoes | Campos criticos |
| --- | --- | --- | --- | --- | --- | --- |
| `EntityExternalId` | Mapa de IDs externos | **REAL** — `store.ts:36-50` (delete+createMany, sem `skipDuplicates` por decisao explicita) | **REAL** | — | polimorfico sem FK | `@@unique([entityType, entityId, source])`, `@@unique([source, externalId])` |
| `Slug` | URL canonica por entidade/idioma | **REAL** — upsert em `ingest-public-catalog.ts:173`; lido em **todos** os loaders publicos | **REAL** para `movie`/`tv`; **PLACEHOLDER** para `person` (so demo seed) | `season`/`episode` sao valores validos de `EntityType` mas nunca recebem slug | `language` (FK) | `@@unique([entityType, languageCode, slug])` + indice unico **parcial** `slugs_canonical_unique` (`migration.sql:734-736`) |
| `Redirect` | 301 quando slug publicado muda | **NAO IMPLEMENTADO na pratica** — 0 usos de `prisma.redirect.*`; unica referencia e o teste negativo em `packages/db/scripts/validate-real-postgres.ts:175` | Nenhum | Tabela + CHECK `from_path <> to_path` prontos (`migration.sql:766-768`) | `language` (FK opcional) | `fromPath @unique`, `statusCode` default 301 |
| `EntityTranslation` | Campos traduziveis da entidade | **PARCIAL** — escrito por `ingest-public-catalog.ts:179` (so `title`+`summary`) e pelos seeds; lido por `movie-page.ts:98`, `series-page.ts:90`, `person-page.ts:101`, `entity-indexes.ts:85`, `home-hero.ts:73`, `home-upcoming.ts:68`, `sitemap-entries.ts:62` | **REAL** para `title`/`summary`/`metaTitle`/`metaDescription` | `status`, `indexStatus`, `editorialIntro`, `faqJson`, `reviewedBy`, `publishedAt` sao colunas mortas (ver 4.11) | `language` (FK) | `@@unique([entityType, entityId, languageCode])`; `status @default(draft)`, `indexStatus @default(noindex)` |

**Bug concreto (integridade de slug) — `**BLOQUEIA PRODUCAO**` para re-ingestao.**
`services/ingestion/bin/ingest-public-catalog.ts:170-177` monta `slug = slugify(title) + "-" + year` e faz:

```ts
await prisma.slug.upsert({
  where: { entityType_languageCode_slug: { entityType, languageCode: LANGUAGE, slug } },
  update: { entityId: entity.id, isCanonical: true },
  create: { entityType, entityId: entity.id, languageCode: LANGUAGE, slug, isCanonical: true },
})
```

Dois defeitos independentes:

1. **Violacao do unique parcial em mudanca de titulo/ano.** Se o TMDB alterar `title` ou `release_date`, o `slug` derivado muda. O `where` nao acha a linha antiga, o `create` insere uma **segunda** linha `isCanonical=true` para o mesmo `(entity_type, entity_id, language_code)` e o indice unico parcial `slugs_canonical_unique` (`migration.sql:734-736`) rejeita a insercao. A ingestao falha (nao degrada). Nao ha `Redirect` gerado nem `isCanonical=false` no slug antigo.
2. **Roubo de slug entre entidades.** O `update: { entityId: entity.id }` reatribui uma linha de slug existente para outra entidade. Dois titulos que colidem no slugify (mesmo titulo + mesmo ano) fazem o segundo import **sequestrar** silenciosamente a URL do primeiro, sem log e sem redirect.

**DEBITO — a tabela `languages` acumula dois vocabularios incompativeis.** `Movie.originalLanguage`/`TvShow.originalLanguage` sao FK para `languages.code`, cujo seed contem BCP-47 de publicacao (`pt-BR`, `en`, `es`) (`packages/db/src/seed-data.ts:68-72`). O TMDB devolve ISO-639-1 (`en`, `ja`, `pt`). O normalizador contorna descartando tudo que nao esta no seed: `services/ingestion/src/utils/normalize.ts:40-44` (`return KNOWN_LANGUAGE_CODES.has(code) ? code : null`). Efeito pratico: `movies.original_language` e `'en'` ou `NULL` — inclusive filmes brasileiros (`'pt'`) viram `NULL`. Os indices `movies_original_language_idx` / `tv_shows_original_language_idx` cobrem uma coluna quase sempre nula. **NAO BLOQUEIA PRODUCAO**.

---

### 4.5 Grupo D — Conteudo editorial e IA

| Model | Para que serve | Usado no codigo? | Tem dado real hoje? | Fundacao futura? | Relacoes | Campos criticos |
| --- | --- | --- | --- | --- | --- | --- |
| `ContentBlock` | Bloco editorial versionado (inv. 13) | **REAL** — escrito por `services/entity-writer/src/persistence/content-block-store.ts:59` (archive+insert em transacao); lido por `movie-page.ts:107`, `series-page.ts:103`, `person-page.ts:109`, `sitemap-entries.ts:78`; escrito pelos 3 seeds | **PARCIAL**: o pipeline real existe, mas os blocos que hoje habilitam indexacao no site vem de `public-demo-seed.ts:210-216` (ver 4.9) | `summary_without_spoilers`, `ratings_explanation`, `where_to_watch_text`, `news_context`, `review_summary` etc. sao valores validos do enum sem produtor | `language` (FK), `producedByJobs[]` | `promptVersion`, `inputHash`, `outputHash`, `modelProvider`, `modelName`, `reviewStatus`, `warningsJson`; CHECK `content_blocks_ai_requires_model` (`migration.sql:751-753`) |
| `EntityWriterJob` | Fila de geracao (1 job ativo por alvo) | **REAL** — `job-enqueue.ts`, `job-claim.ts`, `job-store.ts`, `inspect-store.ts` | Depende de rodar o writer offline; **NAO FOI POSSIVEL CONFIRMAR** se ha linhas em producao (auditoria e estatica, sem acesso ao banco) | — | `language`, `resultBlock` (`SET NULL`), `logs[]` | Indice unico **parcial** `entity_writer_jobs_active_unique` WHERE `status IN (queued, claimed, running)` (`migration.sql:739-741`); `job-claim.ts:88-105` usa `$queryRaw` (provavelmente `FOR UPDATE SKIP LOCKED`) |
| `EntityWriterLog` | Log de execucao/validacao | **REAL** — `entity-writer-log-store.ts:18`, lido em `inspect-store.ts:83` | idem acima | — | `job` (Cascade) | `validationStatus`, `warningsJson`, `tokenInput/Output`, `inputHash`, `outputHash` |

Pontos fortes verificados:

- `content-block-store.ts:47-56` reaplica um filtro defensivo no `updateMany` de arquivamento (`sourceType: "ai"`, `reviewStatus IN (ai_generated, needs_review)`), de modo que um bloco `human`/`hybrid` nunca e arquivado por corrida. Bom.
- O writer **nunca** grava `published`/`human_reviewed` (comentario em `content-block-store.ts:6-7`, e o planner puro `pipeline/persistence-plan.ts` decide o status).
- `payload-source.ts:31-46` monta o `EntityPayload` **apenas** de `movies`/`tv_shows` + `cast_members`/`crew_members`/`people`. Zero ratings, zero streaming, zero rede — coerente com invariante 12.

**DEBITO — `content_blocks` nao tem unique de negocio.** Nao existe `@@unique([entityType, entityId, languageCode, blockType])` nem unique parcial "1 bloco ativo por tipo". A unicidade depende inteiramente da logica de archive+insert em `content-block-store.ts`. Qualquer escritor fora desse adapter (os 3 seeds escrevem direto) pode duplicar. `apps/web/src/lib/movie-presenter.ts` ordena por `BLOCK_TYPE_ORDER` mas nao deduplica por tipo — e `evaluateMovieIndexability` conta **linhas**, nao **tipos distintos** (`apps/web/src/server/movie-page.ts:125` -> `view.renderableBlockCount`). Dois `editorial_intro` publicados = gate anti-thin satisfeito com um unico tipo de valor. **RISCO** de contornar a invariante 5 por duplicata.

**DEBITO — `warningsJson`, `promptVersion`, `inputHash`, `outputHash`, `modelProvider`, `modelName` sao gravados e nunca lidos.** O painel de QA do admin seleciona apenas `id, entityType, entityId, languageCode, blockType, reviewStatus, content` (`apps/admin/src/server/content-qa.ts:148-156`). Nao ha nenhuma superficie que mostre ao revisor humano os warnings anti-alucinacao antes de aprovar. A invariante 13 esta cumprida na **persistencia** e furada na **revisao**. **BLOQUEIA PRODUCAO** do fluxo editorial (o humano aprova as cegas).

**DEBITO — `ContentBlock.publishedAt` nunca e escrito nem lido** (grep: 0 ocorrencias fora do schema/migration).

**Divergencia de vocabulario entre `ContentBlockType` e o gate anti-thin canonico.** `packages/seo/src/value-blocks.ts:21-36` define 15 tipos (`where_to_watch_by_country`, `external_ratings_attributed`, `commented_cast`, `own_review`, ...) que **nao** sao os 12 valores do enum `ContentBlockType` (`schema.prisma:36-49`). Apenas `editorial_intro`, `franchise_context` e `season_guide` coincidem. Na pratica `countValueBlocks()` nunca e alimentado com `content_blocks.block_type`: as paginas passam uma **contagem crua** de blocos renderizaveis como `valueBlocksCount` (`apps/web/src/lib/movie-indexability.ts:57`). Ou seja, `cast_intro` conta como bloco de valor sem estar na lista canonica. **RISCO** de SEO/governanca.

---

### 4.6 Grupo E — Ratings e licencas

| Model | Para que serve | Usado no codigo? | Tem dado real hoje? | Fundacao futura? | Relacoes | Campos criticos |
| --- | --- | --- | --- | --- | --- | --- |
| `RatingSource` | Catalogo de fontes editoriais | **PARCIAL** — so o seed (`packages/db/prisma/seed.ts:36`) | **REAL** (5 linhas de semente) | Sim | `ratings[]` | `key` PK, `scale` (espelha `RATING_SCALES` de `@screena/config`, travado por `tests/governance/rating-scales-mirror.test.ts`) |
| `ApiProvider` | Catalogo de fornecedores tecnicos | **PARCIAL** — so o seed (`seed.ts:40`) | **REAL** (4 linhas: `tmdb`, `gemini`, `imdb236`, `streaming_availability`) | Sim | `ratings[]`, `syncLogs[]`, `cacheEntries[]` | `key` PK, `kind: ProviderKind` |
| `SourceLicense` | Gate de licenca por fonte | **PARCIAL** — so o seed (`seed.ts:46-53`); **nunca consultado no render** | **REAL** mas conservador: 5 linhas, todas `license_status=unknown`, todas as flags `false` (`packages/db/src/seed-data.ts:127-140`) | Sim | **Nenhuma FK** (ver abaixo) | `licenseStatus`, `displayAllowed`, `logoAllowed`, `scoreAllowed`, `reviewQuoteAllowed`, `requiresAttribution`, `requiresLinkback` |
| `ExternalRating` | Nota externa atribuida | **NAO IMPLEMENTADO na pratica** — **zero** `prisma.externalRating.*`, zero `tx.externalRating.*`, zero SQL bruto em `apps/`, `services/`, `scripts/`, `packages/` (exceto o harness `validate-real-postgres.ts:156`) | Nenhum | Sim — e a materializacao correta da invariante 2 | `source -> rating_sources.key`, `provider -> api_providers.key` (**FKs distintas**, `migration.sql:708-711`) | `ratingSource` vs `providerApi`, `ratingScale`, `licenseStatus`, `displayAllowed @default(false)`, `providerPayloadHash`, `fetchedAt`, `attributionText/Url` |

A separacao `rating_source != provider_api` esta **corretamente materializada no DDL**: sao duas FKs para duas tabelas distintas (`schema.prisma:611-613`), e a disjuncao dos conjuntos de chaves e travada por `tests/governance/seed-disjoint.test.ts` e pelo teste 9 de `packages/db/scripts/validate-real-postgres.ts:145`. Alem disso `tests/governance/tmdb-provider-separation.test.ts:27` proibe que o codigo de ingestao sequer **mencione** `external_ratings`/`rating_source`.

**DEBITO — `source_licenses` nao tem FK nenhuma.** `sourceKey` e `providerKey` sao `String` puros (`schema.prisma:204-205`); a migration nao cria `AddForeignKey` para essa tabela. Um `source_key` inexistente entra sem erro. Existe apenas o unique parcial `source_licenses_default_unique` (`migration.sql:744-746`). **NAO BLOQUEIA PRODUCAO** enquanto ratings estiverem inativos.

**Fato honesto:** ratings externos estao **NAO IMPLEMENTADO** como produto. `services/ratings/` contem apenas `README.md`. `api-clients/imdb`, `api-clients/rotten_tomatoes`, `api-clients/film_show_ratings` existem como diretorios, mas nenhum escreve em `external_ratings`. As "estrelas" visiveis no site vem de `screen_score`, coisa completamente diferente (4.9).

---

### 4.7 Grupo F — Streaming / onde assistir

| Model | Para que serve | Usado no codigo? | Tem dado real hoje? | Fundacao futura? | Relacoes | Campos criticos |
| --- | --- | --- | --- | --- | --- | --- |
| `WatchAvailability` | Oferta legal por entidade+pais | **PARCIAL** — lido em `apps/web/src/server/entity-watch.ts:41`; escrito **so** por `apps/admin/scripts/public-demo-seed.ts:234` | **PLACEHOLDER** — o unico produtor e o demo seed, que grava `providerApi: "public-demo-seed"` e `displayAllowed: true` (`public-demo-seed.ts:229-247`) | Sim | `country -> countries.code` (unica FK) | `offerType: OfferType`, `deepLink`, `displayAllowed @default(false)`, `fetchedAt`, `staleAfter`, `providerApi` |
| `Platform` | — | **NAO EXISTE no schema** | — | Planejada (`database/schema.md:55`) | — | — |
| `Provider` (streaming) | — | **NAO EXISTE no schema** | — | Planejada (`database/schema.md:55`) | — | — |

O gate de licenca no render esta correto e em duas camadas: a query ja filtra `displayAllowed: true` (`entity-watch.ts:46`) e o presenter reaplica (`entity-watch.ts:1-11`). CHECKs de integridade tambem estao presentes: `watch_availability_price_requires_currency` e `watch_availability_price_only_transactional` (`migration.sql:756-763`).

**RISCO — `WatchAvailability.providerApi` nao tem FK para `api_providers`.** Diferente de `ExternalRating.providerApi` (FK em `migration.sql:711`) e de `ApiCache`/`ApiSyncLog`, aqui a coluna e texto livre (`schema.prisma:642`). Por isso o demo seed consegue gravar `provider_api = "public-demo-seed"` — um "fornecedor" que nao existe. Assimetria de enforcement da invariante 2. **NAO BLOQUEIA PRODUCAO**, mas convida a poluicao.

**RISCO — a secao "Onde assistir" no site e integralmente alimentada por seed demo.** Se `public-demo-seed.ts --apply` rodar num ambiente que depois vira publico, o site exibe plataformas de streaming inventadas com `display_allowed=true`, sem `deep_link` e sem licenca real. Isso e exatamente o que a invariante 6 proibe. **BLOQUEIA PRODUCAO** se o seed demo tocar a base de producao.

---

### 4.8 Grupo G — Noticias

| Model | Para que serve | Usado no codigo? | Tem dado real hoje? | Fundacao futura? | Relacoes | Campos criticos |
| --- | --- | --- | --- | --- | --- | --- |
| `Article` | Fato de noticia independente de idioma | **PARCIAL** — lido (aninhado) em `news-pages.ts:73-81`, `sitemap-entries.ts:210-216`, `content-qa.ts:142`; **escrito apenas** por harnesses `apps/web/scripts/validate-*-real-postgres.ts` | **Nenhum dado real.** Nao ha ingestao de noticias: `services/news-ingestion/` contem so `README.md` | Sim | `translations[]`, `entityLinks[]` | `licenseStatus @default(unknown)`, `displayAllowed @default(false)`, `aiAssisted`, `sourceName/Url`, `requiresAttribution/Linkback` |
| `ArticleTranslation` | Versao por idioma (slug proprio) | **REAL como codigo** — 36 usos de `prisma.articleTranslation.*` (admin: `articles.ts`, `review-queue.ts`, `editorial-actions.ts`, `editorial-workflow.ts`, `content-qa.ts`, `dashboard.ts`; web: `news-pages.ts`, `related-news.ts`, `sitemap-entries.ts`) | Nenhum dado real | — | `article` (Cascade), `language` (FK) | `@@unique([languageCode, slug])`, `@@unique([articleId, languageCode])`, `reviewStatus @default(draft)`, `indexStatus @default(noindex)` |
| `EntityNewsLink` | Liga noticia a `movie|tv|person` | **REAL como codigo** — lido em `related-news.ts:47`, `news-pages.ts:219` | Nenhum dado real | — | `article` (Cascade); entidade polimorfica **sem FK** | `@@unique([articleId, entityType, entityId])` |
| `NewsCluster` | — | **NAO EXISTE no schema** | — | Planejada (`database/schema.md:62`) | — | — |

Notavel: `article_translations` e a **unica** tabela em que o admin escreve `indexStatus` de fato (`apps/admin/src/server/editorial-actions.ts:100-106`). Nenhuma outra decisao de indexacao e persistida em lugar nenhum (ver 4.10). Artigos nao usam a tabela `slugs` — tem `slug` proprio na traducao, decisao documentada em `schema.prisma:729-733`.

---

### 4.9 Campos editoriais proprios: `screen_score`, `screen_score_display`, `certification`

Este e o ponto mais sensivel da modelagem atual.

| Coluna | Onde nasce | Quem escreve | Quem le | Status |
| --- | --- | --- | --- | --- |
| `movies.screen_score` / `tv_shows.screen_score` | `migrations/20260706120000_.../migration.sql:8,14` | **apenas** `apps/admin/scripts/public-demo-seed.ts:261,274,306,321` (valores fixos `4`, `3.5`, `4.5` de `public-demo-seed-plan.ts:239,268,296,344,371,401`) | `home-hero.ts:149,200`; `entity-indexes.ts:123,169` | **PLACEHOLDER** |
| `screen_score_scale` | idem | idem (sempre `5`) | idem | **PLACEHOLDER** |
| `screen_score_display` | idem, `DEFAULT false` | idem (sempre `true` no demo) | `home-hero-presenter.ts:142`, `entity-index-presenter.ts:202` | **PLACEHOLDER** |
| `movies.certification` / `tv_shows.certification` | idem | **apenas** `public-demo-seed.ts:260,273,305,320` | `home-hero.ts:148,199` -> `hero-carousel.tsx:62` | **PLACEHOLDER** |

Prova de que a ingestao real nunca preenche esses campos: `services/ingestion/src/persistence/store.ts:153-167` (movie) e `:194-210` (tv) listam explicitamente os campos gravados — `certification` e `screen_score*` **nao estao la**. `services/ingestion/bin/ingest-public-catalog.ts:209` so atualiza `posterPath`/`backdropPath`. Grep global de `screenScore` retorna zero ocorrencias em `services/`.

Consequencia direta e verificavel: **num banco alimentado exclusivamente pela ingestao TMDB real, `screen_score` e `certification` sao NULL em 100% das linhas.** O hero e os cards da home simplesmente nao exibem nota nem classificacao indicativa (`resolveHeroRating` retorna `null` quando `screenScoreDisplay` e falso — `home-hero-presenter.ts:142`). O comportamento e **seguro** (o default `false` protege), mas a home foi desenhada assumindo dados que so o seed demo produz. **DEBITO**, nao violacao.

Ponto positivo, importante de registrar: `screen_score` **nao** e `vote_average_tmdb`. A separacao esta feita de forma consciente e correta — `voteAverageTmdb` e comentado como "dado tecnico TMDB; NUNCA nota editorial (inv. 1/2)" (`schema.prisma:238`) e tem **zero** ocorrencias em `apps/web` (grep). Nenhuma nota do TMDB vaza para a UI como nota do Screen. `certification` tambem esta corretamente marcado como advisory, nao rating source (`schema.prisma:242-244`).

**RISCO — os `content_blocks` do demo seed falsificam a proveniencia.** `public-demo-seed.ts:210-216` grava `sourceType: "human"`, `modelProvider: null`, `promptVersion: "public-demo-seed"`, `inputHash: "public-demo-seed"`, `outputHash: "public-demo-seed"` e `reviewStatus: "published" | "human_reviewed"` (`public-demo-seed-plan.ts:213,218,316,321,421`). Isso significa: (a) o CHECK `content_blocks_ai_requires_model` e satisfeito por declarar-se humano; (b) `input_hash`/`output_hash` **nao sao hashes** — sao a string literal `"public-demo-seed"`; (c) os blocos entram direto no estado publicavel e **satisfazem o gate anti-thin**, tornando as paginas demo `index`. O conteudo comeca com `[PUBLIC DEMO SEED]` e o script exige dupla confirmacao e aborta em producao (`public-demo-seed.ts:10-21`), mas a governanca de `content_blocks` (invariante 13) e contornada por construcao. **BLOQUEIA PRODUCAO** se o seed vazar para a base publica.

---

### 4.10 Campos e tabelas de SEO / governanca

| Coluna / tabela | Onde vive | Escrita? | Leitura? | Veredito |
| --- | --- | --- | --- | --- |
| `slugs.is_canonical` | `schema.prisma:444` | ingestao + seeds | todos os loaders publicos | **REAL** |
| `entity_translations.index_status` | `schema.prisma:485` | **ninguem** | **ninguem** | **NAO IMPLEMENTADO** (coluna morta) |
| `entity_translations.status` (`TranslationStatus`) | `schema.prisma:484` | **ninguem** | **ninguem** | **NAO IMPLEMENTADO**; o enum `TranslationStatus` inteiro nao aparece em nenhum `.ts` de produto |
| `content_blocks.review_status` | `schema.prisma:517` | writer + admin (`editorial-actions.ts:132`) + seeds | `movie-page.ts:114`, `series-page.ts:108`, `person-page.ts:114`, `sitemap-entries.ts:84` | **REAL** |
| `article_translations.review_status` / `index_status` | `schema.prisma:776-777` | admin (`editorial-actions.ts:100-106`, `editorial-workflow.ts`) | `news-pages.ts`, `sitemap-entries.ts:207` | **REAL como codigo**, sem dado |
| `articles.license_status` / `display_allowed` | `schema.prisma:751-752` | so harnesses | `news-pages.ts:78-80`, `sitemap-entries.ts:213-214`, `content-qa.ts:142` | **PARCIAL** |
| `external_ratings.license_status` / `display_allowed` | `schema.prisma:606-607` | **ninguem** | **ninguem** | **NAO IMPLEMENTADO** |
| `watch_availability.display_allowed` | `schema.prisma:643` | demo seed | `entity-watch.ts:46` | **PLACEHOLDER** |
| `source_licenses.*` (6 flags) | `schema.prisma:207-212` | seed | **ninguem** | **NAO IMPLEMENTADO** — o gate de licenca por fonte nunca e consultado no render |
| `page_indexability_decisions` (tabela inteira) | `schema.prisma:654-680` | **ninguem** | **ninguem** | **NAO IMPLEMENTADO** |

**RISCO ALTO — `page_indexability_decisions` nunca recebe uma linha.** Grep de `prisma.pageIndexabilityDecision` em `apps/`, `services/`, `scripts/`, `packages/`, `tests/`: zero. Grep do nome de tabela cru em SQL: so `packages/db/scripts/validate-real-postgres.ts:83` (lista de tabelas esperadas) e comentarios. Isso contradiz frontalmente:

- `.claude/rules/seo.md` §3: "A decisao de indexabilidade de cada pagina e registrada em `page_indexability_decisions`".
- `.claude/rules/seo.md` §5: "O sitemap e gerado a partir de `page_indexability_decisions` — a mesma fonte que decide o `<meta robots>`."
- `.claude/rules/entity-writer.md` §15.8: "Registrar decisao em `page_indexability_decisions`."

Na realidade o sitemap e derivado **ao vivo** de uma contagem de `content_blocks` por entidade (`apps/web/src/server/seo/sitemap-entries.ts:72-91`) e o `<meta robots>` de cada pagina e recalculado por presenters puros (`movie-indexability.ts`, `series-presenter.ts`, `person-presenter.ts`, `news-presenter.ts`). Meta tag e sitemap concordam **por coincidencia de codigo**, nao por fonte unica persistida. Nao ha trilha de auditoria de por que uma pagina indexou. **DEBITO estrutural**, **NAO BLOQUEIA PRODUCAO** hoje (o comportamento e o mesmo), mas invalida a auditabilidade prometida pela invariante 5.

**RISCO — `redirects` nunca e escrito.** Combinado com o bug de slug de 4.4, qualquer mudanca de titulo no upstream produz erro de ingestao (na melhor hipotese) ou URL orfa (se alguem "consertar" desativando o unique). Nenhum caminho gera 301. **BLOQUEIA PRODUCAO** assim que o catalogo comecar a re-sincronizar (o `services/sync/bin/run.ts:22-45` faz exatamente isso, selecionando `staleAfter` vencido).

---

### 4.11 Cache, logs e jobs

| Model | Usado? | Escritor | Leitor | Observacao |
| --- | --- | --- | --- | --- |
| `ApiCache` | **REAL** | `services/ingestion/src/persistence/cache.ts:52` (upsert) | `cache.ts:33` (`findUnique`) | `@@unique([providerApi, requestKey, paramsHash])`; TTL por `expiresAt`; `payloadHash` habilita o short-circuit "sem mudanca". FK `provider_api -> api_providers.key` |
| `ApiSyncLog` | **REAL** | `services/ingestion/src/persistence/sync-log.ts:19` | **ninguem** (nenhum painel/admin le) | Cumpre "todo sync gera log". `@@index([providerApi])`, `@@index([createdAt])`. **DEBITO**: log gravado e nunca observado |
| `EntityWriterJob` | **REAL** | `job-enqueue.ts`, `job-claim.ts`, `job-store.ts` | `inspect-store.ts` (read-only, sem raw — travado por `services/entity-writer/src/__tests__/inspect-store-readonly.test.ts`) | unique parcial de job ativo |
| `EntityWriterLog` | **REAL** | `entity-writer-log-store.ts:18` | `inspect-store.ts:83` | `warningsJson` gravado, nao exposto ao revisor |

`ApiCache` e o unico lugar onde o payload bruto do TMDB e guardado (`payload Json`). Nao ha politica de expurgo (`expiresAt` so controla validade de leitura, nao delecao). **DEBITO de crescimento** de tabela `JSONB` sem TTL de purge.

---

### 4.12 Mapeamento de campos por origem

#### Campos vindos do TMDB (ingestao real)

`movies`: `tmdb_id`, `imdb_id`, `title_original`, `original_language`(filtrado), `release_date`, `runtime_minutes`, `status`, `popularity`, `vote_average_tmdb`, `vote_count_tmdb`, `poster_path`, `backdrop_path` — todos em `store.ts:153-167`.
`tv_shows`: idem + `name_original`, `first_air_date`, `last_air_date`, `number_of_seasons`, `number_of_episodes` (`store.ts:194-210`).
`seasons`: `tmdb_id`, `season_number`, `name`, `overview`, `air_date`, `episode_count`, `poster_path` (`store.ts:246-254`).
`episodes`: `tmdb_id`, `episode_number`, `name`, `overview`, `air_date`, `runtime_minutes`, `still_path` (`store.ts:264-272`).
`people`: `tmdb_id`, `imdb_id`, `name`, `known_for_department`, `gender`, `birthday`, `deathday`, `place_of_birth`, `profile_path` (`store.ts:313-323`).
`cast_members`/`crew_members`: `character`, `billing_order`, `department`, `job`, `credit_id` (`store.ts:107-141`).
`entity_external_ids`: `source` namespaceado (`tmdb_movie`/`tmdb_tv`/`tmdb_person`/`imdb`), `external_id`, `url` (`services/ingestion/src/normalizers/external-ids.ts:29-35`).
`entity_translations.title`/`summary`: `title`/`overview` pt-BR do TMDB (`ingest-public-catalog.ts:187-188`). **Nota:** `summary` recebe o `overview` **literal** do TMDB. Isso e dado cru de API, nao conteudo proprio — e e exibido no hero (`home-hero.ts:78` -> `HeroSlideInput.summary`). Nao viola invariante alguma isoladamente, mas **nao conta** como bloco de valor.
`poster_path`/`backdrop_path`: por padrao gravam o `file_path` **cru** do TMDB (`ingest-public-catalog.ts:199-208`, helper `resolveCatalogImagePath`).

#### Campos editoriais proprios

`movies.screen_score`, `screen_score_scale`, `screen_score_display`, `certification`; `tv_shows.*` (mesmas quatro). `entity_translations.editorial_intro`, `faq_json`, `meta_title`, `meta_description`. `content_blocks.content`. `articles.*` editorial. **Todos hoje: seed ou vazio.**

#### Campos de SEO

`slugs.slug`, `slugs.is_canonical`, `redirects.from_path/to_path/status_code`, `entity_translations.meta_title/meta_description/index_status`, `article_translations.slug/meta_title/meta_description/index_status`, `page_indexability_decisions.*` (10 colunas), `languages.index_default`, `languages.is_published`.

#### Campos de governanca

`review_status` (em `content_blocks`, `article_translations`), `index_status` (em `entity_translations`, `article_translations`), `decision` (em `page_indexability_decisions`), `license_status` (em `source_licenses`, `external_ratings`, `articles`, `people.biography_source_status`), `display_allowed` (em `source_licenses`, `external_ratings`, `watch_availability`, `articles`), `screen_score_display`, `logo_allowed`, `score_allowed`, `review_quote_allowed`, `requires_attribution`, `requires_linkback`, `ai_assisted`, `validation_status`, `warnings_json`, `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`, `source_type`.

Todos os defaults sao **fail-closed** e isso esta travado por `tests/governance/schema-safe-defaults.test.ts:56-90`.

#### Campos de rating

`external_ratings`: `rating_source`, `rating_label`, `metric`, `rating_value`, `rating_scale`, `rating_count`, `rating_url`, `provider_api`, `provider_payload_hash`, `fetched_at`, `attribution_text`, `attribution_url`, `license_status`, `display_allowed`. `rating_sources`: `key`, `label`, `scale`, `homepage_url`.
Campos que **parecem** rating mas nao sao: `movies.vote_average_tmdb`/`vote_count_tmdb` (dado tecnico TMDB), `movies.screen_score` (nota editorial propria), `movies.certification` (advisory).

#### Campos de streaming

`watch_availability`: `country_code`, `provider_key`, `provider_name`, `offer_type`, `deep_link`, `price`, `currency`, `quality`, `available_from`, `available_until`, `fetched_at`, `stale_after`, `provider_api`, `display_allowed`.

---

### 4.13 O que alimenta a Home, o que alimenta o detalhe, e o que nao aparece em lugar nenhum

#### Home (`apps/web/app/pt/page.tsx`)

| Bloco visual | Loader | Campos lidos |
| --- | --- | --- |
| Hero carousel | `src/server/home-hero.ts` | `slugs.slug/entity_id/is_canonical`; `movies.id/title_original/release_date/certification/screen_score/screen_score_scale/screen_score_display/backdrop_path/poster_path`; `tv_shows.*` equivalente + `number_of_seasons/number_of_episodes`; `entity_translations.title/summary`; `crew_members.job|department` + `people.name`; `cast_members` via `getCastForEntity` |
| Cards Filmes/Series/Pessoas | `src/server/entity-indexes.ts` | `movies.id/title_original/release_date/poster_path/screen_score*`; `tv_shows.id/name_original/first_air_date/last_air_date/poster_path/screen_score*`; `people.id/name/known_for_department/profile_path`; `entity_translations.title`; `slugs` |
| "Em breve" | `src/server/home-upcoming.ts` | `movies.id/title_original/release_date/backdrop_path/poster_path` (filtro `releaseDate > hoje`), `entity_translations.title`, `slugs` |
| Noticias | `src/server/news-pages.ts` (`getNewsIndexData`) | `article_translations.slug/title/deck/review_status/published_at` + `articles.author_name/category/hero_image_path/published_at/read_time_minutes/license_status/display_allowed` |
| Episodes Ticker / chips de plataforma | — | **PLACEHOLDER**: nao ha loader; ver `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md` |

#### Paginas de detalhe

| Rota | Loader | Campos lidos |
| --- | --- | --- |
| `/pt/filmes/[slug]` | `movie-page.ts:79-121` | `movies.title_original/release_date/runtime_minutes/poster_path/backdrop_path`; `slugs`; `entity_translations.title/meta_title/meta_description/summary`; `content_blocks.block_type/content/review_status`; `cast_members`+`people`; `watch_availability`; `entity_news_links`+`article_translations` |
| `/pt/series/[slug]` | `series-page.ts:69-138` | idem + `tv_shows.number_of_seasons/number_of_episodes/first_air_date/last_air_date`; `seasons.season_number/name/overview/air_date/episode_count/poster_path`; `episodes.episode_number/name/overview/air_date/runtime_minutes/still_path` |
| `/pt/pessoas/[slug]` | `person-page.ts:81-137` | `people.name/known_for_department/birthday/deathday/place_of_birth/profile_path`; `entity_translations.title/meta_title/meta_description`; `content_blocks`; `cast_members`+`crew_members` (filmografia) |
| `/pt/noticias/[slug]` | `news-pages.ts:108-145` | `article_translations.*` + `articles.*` (12 colunas, incluindo `ai_assisted`, `source_name/url`, `requires_attribution/linkback`) |

Observacao: **as paginas de detalhe de filme e serie NAO leem `screen_score` nem `certification`** (`movie-page.ts:81-87`, `series-page.ts:71-79`). A nota editorial so aparece na home e nas listagens. Inconsistencia de produto.

#### Colunas que existem no banco e nao aparecem em nenhum lugar do frontend (grep como prova)

Comando: `grep -rn "<campo>" apps/web/src apps/web/app` -> `0` ocorrencias para cada um:

| Coluna | Grep em `apps/web` | Grep em `apps/admin` |
| --- | --- | --- |
| `movies.vote_average_tmdb` / `vote_count_tmdb` | 0 | 0 |
| `tv_shows.vote_average_tmdb` / `vote_count_tmdb` | 0 | 0 |
| `movies.popularity` / `tv_shows.popularity` | 0 | 0 |
| `movies.imdb_id` / `tv_shows.imdb_id` / `people.imdb_id` | 0 | 0 |
| `movies.original_language` / `tv_shows.original_language` | 0 | 0 |
| `movies.status` / `tv_shows.status` | escrito por seeds; nao renderizado | 0 |
| `people.gender` | 0 | 0 |
| `people.biography_source_status` | 0 | 0 |
| `entity_translations.editorial_intro` | 0 (so schema) | 0 |
| `entity_translations.faq_json` | 0 (so schema) | 0 |
| `entity_translations.reviewed_by` | 0 (so schema) | 0 |
| `entity_translations.status` / `index_status` | 0 | 0 |
| `content_blocks.published_at` | 0 | 0 |
| `content_blocks.warnings_json` | 0 | 0 (escrito pelo writer, nunca lido) |
| `content_blocks.prompt_version` / `input_hash` / `output_hash` / `model_provider` / `model_name` | 0 | 0 (nao aparecem em `content-qa.ts:148-156`) |
| `watch_availability.deep_link` / `price` / `currency` / `quality` / `available_from` / `available_until` / `provider_key` | 0 | 0 |
| `external_ratings.*` (todas as 18 colunas) | 0 | 0 |
| `source_licenses.*` (todas) | 0 | 0 |
| `page_indexability_decisions.*` (todas) | 0 | 0 |
| `redirects.*` (todas) | 0 | 0 |
| `entity_external_ids.*` | 0 | 0 (escrito pela ingestao, nunca lido) |
| `api_sync_logs.*` | 0 | 0 (escrito, nunca lido) |
| `movies.last_synced_at` / `stale_after` | 0 | usado apenas por `services/sync/bin/run.ts:22` |
| `articles.attribution_text` / `attribution_url` | **NAO EXISTEM** em `articles` (so em `external_ratings`); `articles` usa `source_name`/`source_url` | — |

Resumo: **6 das 27 tabelas nunca sao escritas nem lidas por codigo de produto** — `ExternalRating`, `PageIndexabilityDecision`, `Redirect`, e (parcialmente) `SourceLicense`, `RatingSource`, `ApiProvider` (estas tres so recebem seed). `EntityExternalId` e `ApiSyncLog` sao write-only.

---

### 4.14 Indices, unique constraints e enums

#### Indices unicos parciais (SQL bruto — Prisma nao expressa `WHERE`)

| Nome | Definicao | Arquivo |
| --- | --- | --- |
| `slugs_canonical_unique` | `UNIQUE (entity_type, entity_id, language_code) WHERE is_canonical = true` | `migration.sql:734-736` |
| `entity_writer_jobs_active_unique` | `UNIQUE (entity_type, entity_id, language_code, job_type) WHERE status IN ('queued','claimed','running')` | `migration.sql:739-741` |
| `source_licenses_default_unique` | `UNIQUE (source_key) WHERE provider_key IS NULL` | `migration.sql:744-746` |

#### CHECK constraints

| Nome | Regra | Arquivo |
| --- | --- | --- |
| `content_blocks_ai_requires_model` | `source_type='human' OR (model_provider IS NOT NULL AND model_name IS NOT NULL)` | `migration.sql:751-753` |
| `watch_availability_price_requires_currency` | `price IS NULL OR currency IS NOT NULL` | `migration.sql:756-758` |
| `watch_availability_price_only_transactional` | `offer_type IN ('rent','buy') OR price IS NULL` | `migration.sql:761-763` |
| `redirects_no_self_redirect` | `from_path <> to_path` | `migration.sql:766-768` |
| `movies_imdb_id_not_empty` / `tv_shows_imdb_id_not_empty` / `people_imdb_id_not_empty` | `imdb_id IS NULL OR imdb_id <> ''` | `migration.sql:771-773` |

#### Unicidade de negocio

Uniques de **campo** (`@unique`, 9): `movies.tmdb_id`, `movies.imdb_id`, `tv_shows.tmdb_id`, `tv_shows.imdb_id`, `people.tmdb_id`, `people.imdb_id`, `cast_members.credit_id`, `crew_members.credit_id`, `redirects.from_path`.

Uniques **compostos** (`@@unique`, 12): `seasons(id,tv_show_id)`, `seasons(tv_show_id,season_number)`, `episodes(season_id,episode_number)`, `entity_external_ids(entity_type,entity_id,source)`, `entity_external_ids(source,external_id)`, `slugs(entity_type,language_code,slug)`, `entity_translations(entity_type,entity_id,language_code)`, `external_ratings(entity_type,entity_id,rating_source,metric)`, `api_cache(provider_api,request_key,params_hash)`, `article_translations(article_id,language_code)`, `article_translations(language_code,slug)`, `entity_news_links(article_id,entity_type,entity_id)`.

Ausencias notaveis: `content_blocks` nao tem unique de negocio; `page_indexability_decisions` tambem nao (ledger append-only por design); `watch_availability` nao tem unique por `(entity, country, provider, offer_type)` — duplicatas de oferta sao possiveis.

#### Indices notaveis e seu uso real

| Indice | Existe | Usado por query real? |
| --- | --- | --- |
| `movies_popularity_idx`, `tv_shows_popularity_idx` | sim | **Nao.** Nenhum `orderBy: { popularity }` em `apps/`, `services/` |
| `movies_stale_after_idx`, `tv_shows_stale_after_idx` | sim | Sim — `services/sync/bin/run.ts:30,42` (`orderBy: { staleAfter: 'asc' }`) |
| `movies_release_date_idx` | sim | Sim — `home-upcoming.ts:66` |
| `movies_status_idx`, `tv_shows_status_idx` | sim | **Nao** (nenhum filtro por `status`) |
| `movies_original_language_idx` | sim | **Nao** (coluna quase sempre NULL, ver 4.4) |
| `slugs(entity_type, entity_id, language_code)` | sim | Sim, intensamente |
| `content_blocks(entity_type, entity_id, language_code)` | sim | Sim |
| `content_blocks(review_status)` | sim | Sim (`sitemap-entries.ts:84`) |
| `page_indexability_decisions_decision_idx` | sim | **Nao** (tabela vazia) |
| `external_ratings_*` (3 indices) | sim | **Nao** (tabela vazia) |

**DEBITO de escalabilidade.** `home-hero.ts:52` e `entity-indexes.ts:66` fazem `prisma.slug.findMany({ ... isCanonical: true })` **sem `take`**, depois `prisma.movie.findMany({ where: { id: { in: ids } } })` com **todos** os ids do catalogo, e so entao cortam no presenter (`entity-index-presenter.ts:245`, `INDEX_ITEM_LIMIT = 24`). Com 20 titulos e irrelevante; com 20 mil, e uma varredura completa por request de home. Nao ha `orderBy` no banco (a ordenacao por ano acontece em memoria — `home-hero.ts:231`). Alem disso `home-hero.ts:237-239` dispara 2 queries adicionais por slide (diretor + elenco) — N+1 controlado a 5 slides, mas N+1. **NAO BLOQUEIA PRODUCAO** no volume atual.

#### Enums (13) e uso real

| Enum | Valores | Usado no codigo de produto? |
| --- | --- | --- |
| `EntityType` | `movie, tv, season, episode, person` | **REAL** (145 refs). `season`/`episode` nunca recebem slug nem content_block |
| `ContentBlockType` | 12 valores | **PARCIAL** — so `editorial_intro` e `cast_intro` sao produzidos (`movie-presenter.ts:17-22`, `.claude/rules/entity-writer.md`) |
| `ContentSource` | `ai, human, hybrid` | **PARCIAL** — `ai` (writer) e `human` (seeds). `hybrid` nunca escrito |
| `ReviewStatus` | 8 valores | **REAL** (115 refs). Renderizaveis: so `human_reviewed` e `published` (`movie-indexability.ts:19`) |
| `TranslationStatus` | 6 valores | **NAO IMPLEMENTADO** — 0 refs fora de schema/migration/harness |
| `IndexDecision` | `index, noindex, draft, stale, blocked` | **PARCIAL** — usado como tipo em `article_translations.index_status` e nos presenters; `stale` nunca e escrito por ninguem |
| `JobType` | `generate_block, regenerate_block, translate_block` | **PARCIAL** — `translate_block` sem produtor |
| `JobStatus` | 7 valores | **REAL** (entity-writer) |
| `LicenseStatus` | `official, licensed, third_party, unknown, blocked` | **PARCIAL** — na pratica so `unknown` (seed) e o que os harnesses gravam |
| `OfferType` | `subscription, rent, buy, free, ads, cinema` | **PLACEHOLDER** — so demo seed; rotulos em `apps/web/src/lib/watch-presenter.ts:30-35` |
| `SyncStatus` | `success, partial, failed, empty, aborted` | **REAL** (`sync-log.ts`, `ingest-public-catalog.ts:271`) |
| `ValidationStatus` | `passed, warnings, failed` | **REAL** (`entity-writer-log-store.ts`) |
| `ProviderKind` | `data, ratings, streaming, ai, news` | **PARCIAL** — so no seed de `api_providers` |

---

### 4.15 Contradicoes entre documentacao/comentario e realidade

| Afirmacao | Onde | Realidade |
| --- | --- | --- |
| "`server.ts` ... Importado APENAS por workers/CLIs offline (services/*, bin/*). NUNCA pode ser importado pelo render publico (apps/web)" | `packages/db/src/server.ts:6-8` | `apps/web/src/server/movie-page.ts:19`, `series-page.ts:11`, `person-page.ts:15`, `home-hero.ts:15`, `entity-indexes.ts:15`, `entity-watch.ts:13`, `news-pages.ts:15`, `sitemap-entries.ts:18` importam `@screena/db/server`. Nao viola a invariante 3 (Postgres e permitido), mas o comentario esta **errado** e induz a erro |
| "O sitemap e gerado a partir de `page_indexability_decisions`" | `.claude/rules/seo.md` §5 | Gerado de `content_blocks.groupBy` ao vivo (`sitemap-entries.ts:78-91`). Tabela vazia |
| "Registrar decisao em `page_indexability_decisions`" | `.claude/rules/entity-writer.md` §15.8 | Nunca acontece |
| "Superficies de 'onde assistir' exibem sempre um carimbo 'Atualizado em' com base em `last_synced_at`" | `.claude/rules/ingestion.md` | `entity-watch.ts:54` usa `fetched_at` (correto), nao `last_synced_at`. Discrepancia de nomenclatura na regra |
| "Mudanca de slug publicado gera redirect 301 (tabela `redirects`)" | `.claude/rules/i18n.md` §3 | Nenhum codigo escreve `redirects` |
| `Person.biography_source_status` "governa EXIBICAO da bio" | `schema.prisma:367` | Nao existe coluna `biography` |
| `ContentBlockType` = os blocos de valor do gate anti-thin | implicito em `.claude/rules/seo.md` §1 | Vocabularios diferentes (`packages/seo/src/value-blocks.ts:21-36` vs `schema.prisma:36-49`); so 3 valores coincidem |

---

### 4.16 Sintese honesta do estado do banco

O **DDL e de qualidade acima da media**: defaults fail-closed em todas as flags de exibicao, invariante 2 materializada como duas FKs para tabelas distintas, FK composta impedindo divergencia episodio/temporada, tres indices unicos parciais e sete CHECKs em SQL bruto, tudo travado por `tests/governance/schema-safe-defaults.test.ts`, `seed-disjoint.test.ts`, `rating-scales-mirror.test.ts` e pelo harness `packages/db/scripts/validate-real-postgres.ts`.

O **preenchimento e muito menor do que o schema sugere**:

- 6 tabelas nunca escritas nem lidas por produto (`external_ratings`, `page_indexability_decisions`, `redirects`, e `rating_sources`/`api_providers`/`source_licenses` so via seed).
- 2 tabelas write-only (`entity_external_ids`, `api_sync_logs`).
- A camada de valor visivel (nota, classificacao indicativa, "onde assistir", noticias) e **100% seed demo**; a ingestao real produz apenas ficha tecnica + poster + sinopse crua do TMDB.
- A promessa central da invariante 5 (decisao de indexacao auditavel) nao tem persistencia.
- A promessa central da invariante 13 (bloco versionado e **revisavel**) tem versionamento mas nao tem superficie de revisao dos warnings.

Nada disso e mentira do schema — e a distancia entre a fundacao (boa) e o produto (fino).

---

### 4.17 Proximos passos concretos

1. **PROXIMO PASSO** (**BLOQUEIA PRODUCAO**) — resolver a divergencia de migration: `20260706120000_add_certification_screen_score` precisa estar em `main` antes de qualquer deploy a partir de `main`, ou o deploy precisa fixar a branch. Verificar `prisma migrate deploy` no pipeline EasyPanel.
2. **PROXIMO PASSO** (**BLOQUEIA PRODUCAO**) — corrigir o upsert de slug em `services/ingestion/bin/ingest-public-catalog.ts:173`: buscar o slug canonico existente por `(entityType, entityId, languageCode, isCanonical)`, despromover (`isCanonical=false`) antes de criar o novo, e gravar `Redirect(from_path, to_path, 301)`. Sem isso, o re-sync (`services/sync/bin/run.ts`) e uma bomba-relogio.
3. **PROXIMO PASSO** (**BLOQUEIA PRODUCAO**) — garantir que `apps/admin/scripts/public-demo-seed.ts` jamais toque a base publica: hoje o unico freio e `NODE_ENV`/`VERCEL_ENV` + env de confirmacao (`public-demo-seed.ts:10-21`). Considerar um marcador de ambiente no proprio banco (linha sentinela) e um teste de smoke que falhe se `content_blocks.content LIKE '[PUBLIC DEMO SEED]%'` existir em producao.
4. **PROXIMO PASSO** (**NAO BLOQUEIA PRODUCAO**) — criar slug canonico pt-BR para `person` na ingestao real, senao `/pt/pessoas/` e os links de elenco continuam mortos.
5. **PROXIMO PASSO** — persistir `page_indexability_decisions` a partir dos presenters (ou de um worker offline) e passar o sitemap a ler dessa tabela, alinhando codigo e `.claude/rules/seo.md`.
6. **PROXIMO PASSO** — expor `warnings_json` / `prompt_version` / `input_hash` no painel de QA (`apps/admin/src/server/content-qa.ts`) antes de qualquer aprovacao humana; sem isso o `human_reviewed` e uma assinatura em branco.
7. **PROXIMO PASSO** — decidir: ou `screen_score` ganha um produtor editorial real (admin + revisao), ou some do hero/cards. Manter uma nota que so o seed demo cria e o pior dos mundos.
8. **PROXIMO PASSO** — adicionar unique parcial "1 bloco ativo por (entidade, idioma, tipo)" em `content_blocks`, ou fazer o gate anti-thin contar **tipos distintos** em vez de linhas.
9. **PROXIMO PASSO** — corrigir o comentario de `packages/db/src/server.ts:6-8` (o render **le** Postgres via este client, por design).
10. **PROXIMO PASSO** — reconciliar `packages/seo/src/value-blocks.ts` com `ContentBlockType`, ou documentar explicitamente o mapa entre os dois vocabularios.


---

## Parte 5 — Pipeline TMDB e ingestao

### 5.0 Sumario executivo (sem maquiagem)

O pipeline TMDB e a **unica ingestao externa real** do repositorio. Ele existe, roda offline,
grava `api_cache` e `api_sync_logs`, e faz upsert idempotente por `tmdb_id`. Isso e **REAL**.

Tudo o mais que a documentacao de governanca descreve como "ingestao" — ratings externos,
streaming/onde assistir, RSSPRIME/noticias, workers Python, scheduler — e **NAO IMPLEMENTADO**:
sao READMEs e stubs Python que so logam `"Fase 0: nao implementado"`.

O TMDB coberto e um **subset estreito**: 4 endpoints de detalhe + 1 de lista. Nao ha discovery
(`popular`, `trending`, `changes`, `search`, `discover`), nao ha generos, franquias, imagens,
trailers, providers de streaming, keywords, videos, nem `/tv/{id}/season/{n}/episode/{e}`.

E o pipeline **nao e um cron hoje**: ha exatamente **um** par systemd (`.service`/`.timer`) no
repositorio, para o refresh de catalogo stale, marcado como "ilustrativo". O backfill que
realmente popula a home (`bin/ingest-public-catalog.ts`) **aborta em producao por design** e
nao tem unit systemd nenhuma.

---

### 5.1 Inventario: o que existe em codigo vs. o que e README

| Caminho | Estado | Evidencia |
| --- | --- | --- |
| `api-clients/tmdb/src/**` | **REAL** — 5 arquivos TS, 620 linhas, 3 suites de teste | `api-clients/tmdb/src/http.ts:105`, `api-clients/tmdb/src/endpoints.ts:50` |
| `services/ingestion/src/**` | **REAL** — normalizers puros + orquestracao por ports + adapters Prisma | `services/ingestion/src/import/import-movie.ts:15`, `services/ingestion/src/persistence/store.ts:145` |
| `services/ingestion/bin/import.ts` | **REAL** (CLI por id / `--seed`) | `services/ingestion/bin/import.ts:51` |
| `services/ingestion/bin/ingest-public-catalog.ts` | **PARCIAL** — backfill de lista curada; aborta em producao | `services/ingestion/bin/ingest-public-catalog.ts:303` |
| `services/sync/src/stale-policy.ts` | **REAL** (20 linhas, puro, testado) | `services/sync/src/stale-policy.ts:12` |
| `services/sync/bin/run.ts` | **PARCIAL** — refresh de stale so para `movies` e `tv_shows` | `services/sync/bin/run.ts:27`, `services/sync/bin/run.ts:37` |
| `services/sync/systemd/*` | **PARCIAL** — 1 timer diario, auto-declarado "ilustrativo" | `services/sync/systemd/screena-tmdb-catalog.service:3` |
| `services/ratings/` | **NAO IMPLEMENTADO** — so `README.md` | `services/ratings/README.md` (unico arquivo do diretorio) |
| `services/streaming/` | **NAO IMPLEMENTADO** — so `README.md` | `services/streaming/README.md` |
| `services/news-ingestion/` | **NAO IMPLEMENTADO** — so `README.md` | `services/news-ingestion/README.md` |
| `api-clients/imdb`, `rotten_tomatoes`, `streaming_availability`, `film_show_ratings`, `kaso` | **NAO IMPLEMENTADO** — cada um so tem `README.md` | ex.: `api-clients/imdb/README.md` |
| `workers/*.py` (6 arquivos, 379 linhas) | **PLACEHOLDER** — cada `main()` so faz `logger.info("...: Fase 0: nao implementado")` | `workers/tmdb_worker.py:41`, `workers/scheduler.py:74` |

Detalhe que merece registro: `workers/tmdb_worker.py` continua no repositorio descrevendo
"Fase 0" e periodicidades (populares diario, trending 6-12h) que **nenhum codigo executa**.
`workers/scheduler.py:22-46` documenta timers `screena-tmdb-popular.timer`,
`screena-tmdb-trending.timer`, `screena-ratings.timer`, `screena-streaming.timer`,
`screena-rssprime.timer`, `screena-entity-writer.timer` — **nenhum desses arquivos existe**
no repositorio. O unico `.timer` real e `services/sync/systemd/screena-tmdb-catalog.timer`.

---

### 5.2 Endpoints TMDB: declarados vs. realmente chamados

Todos os endpoints vivem em `api-clients/tmdb/src/endpoints.ts`. Sao **cinco**, e — este e o
ponto positivo — **todos os cinco sao efetivamente exercitados** pela ingestao. Nao ha endpoint
morto.

| Endpoint TMDB | Declarado em | Chamado por | Status |
| --- | --- | --- | --- |
| `GET /movie/{id}` (`append_to_response=external_ids,credits`) | `api-clients/tmdb/src/endpoints.ts:54` | `services/ingestion/src/import/import-movie.ts:23`; `services/ingestion/bin/ingest-public-catalog.ts:362` | **REAL** |
| `GET /tv/{id}` (`append_to_response=external_ids,credits`) | `api-clients/tmdb/src/endpoints.ts:61` | `services/ingestion/src/import/import-tv.ts:26`; `services/ingestion/bin/ingest-public-catalog.ts:378` | **REAL** |
| `GET /tv/{id}/season/{n}` | `api-clients/tmdb/src/endpoints.ts:68` | `services/ingestion/src/import/import-tv.ts:56` | **REAL** |
| `GET /person/{id}` (`append_to_response=external_ids`) | `api-clients/tmdb/src/endpoints.ts:72` | `services/ingestion/src/import/import-person.ts:18` (so via `bin/import.ts --person`/`--seed`) | **PARCIAL** — nao e chamado pelo backfill de catalogo nem pelo sync de stale |
| `GET /movie/upcoming` (`region=BR`, `page=1`) | `api-clients/tmdb/src/endpoints.ts:79` | `services/ingestion/bin/ingest-public-catalog.ts:249`, apenas sob `--include-upcoming` **e** `--apply` | **PARCIAL** |

`language` default = `pt-BR` (`api-clients/tmdb/src/config.ts:86`), `region` default = `BR`
(`api-clients/tmdb/src/endpoints.ts:23`).

#### Endpoints TMDB que **NAO existem** no client

Ausencia relevante porque a governanca (`.claude/rules/ingestion.md`, tabela de
periodicidades) e `workers/tmdb_worker.py:20-23` prometem "populares", "trending",
"lancamentos", "trailers/imagens":

| Capacidade | Endpoint TMDB tipico | Status |
| --- | --- | --- |
| Discovery de populares | `/movie/popular`, `/tv/popular` | **NAO IMPLEMENTADO** |
| Trending | `/trending/{media_type}/{window}` | **NAO IMPLEMENTADO** |
| Changes (delta) | `/movie/changes`, `/tv/changes` | **NAO IMPLEMENTADO** |
| Busca / discover | `/search/*`, `/discover/*` | **NAO IMPLEMENTADO** |
| Imagens (galeria) | `/movie/{id}/images` | **NAO IMPLEMENTADO** (so `poster_path`/`backdrop_path` do detalhe) |
| Trailers/videos | `/movie/{id}/videos` | **NAO IMPLEMENTADO** |
| Providers de streaming | `/movie/{id}/watch/providers` | **NAO IMPLEMENTADO** |
| Generos / keywords / franquias | `/genre/*`, `/collection/{id}` | **NAO IMPLEMENTADO** |
| Detalhe de episodio | `/tv/{id}/season/{n}/episode/{e}` | **NAO IMPLEMENTADO** (episodios vem embutidos no detalhe da temporada) |
| Series "upcoming"/"airing today" | `/tv/on_the_air`, `/tv/airing_today` | **NAO IMPLEMENTADO** — a descoberta de "Em breve" e **so de filmes** (`services/ingestion/bin/ingest-public-catalog.ts:234`) |

Consequencia direta: `WatchAvailability` existe no schema (`packages/db/prisma/schema.prisma:626`)
mas **nenhuma linha de codigo a popula**. Nao ha nem tabela `platforms`/`providers` no schema
(`grep "^model " packages/db/prisma/schema.prisma` retorna 27 modelos; nenhum deles e
`Platform`/`Provider`/`Franchise`/`Image`/`Trailer`/`NewsCluster`), embora
`.claude/rules/ingestion.md` liste essas tabelas como alvo canonico do fluxo normalizado.
**DEBITO** de divergencia regra-vs-schema.

---

### 5.3 O que e importado hoje

| Dado | Status | Evidencia |
| --- | --- | --- |
| Filmes (`movies`) | **REAL** | `services/ingestion/src/persistence/store.ts:147` |
| Series (`tv_shows`) | **REAL** | `services/ingestion/src/persistence/store.ts:188` |
| Temporadas (`seasons`) | **REAL** — iteradas a partir de `tv.seasons[]` | `services/ingestion/src/normalizers/tv.ts:58`; `services/ingestion/src/import/import-tv.ts:52` |
| Episodios (`episodes`) | **REAL** — vem de `season.episodes[]`, sem chamada por episodio | `services/ingestion/src/normalizers/season.ts:26`; `services/ingestion/src/persistence/store.ts:263` |
| Pessoas ricas (`people` via `/person/{id}`) | **PARCIAL** — so por `bin/import.ts --person`/`--seed`, nunca pelo backfill de catalogo | `services/ingestion/bin/import.ts:67` |
| Pessoas "stub" (derivadas de creditos) | **REAL** — upsert por `tmdbId`, sem rebaixar campos ja preenchidos | `services/ingestion/src/persistence/store.ts:54-91` |
| Elenco (`cast_members`) | **REAL** — replace-set transacional | `services/ingestion/src/persistence/store.ts:104-124` |
| Equipe (`crew_members`) | **REAL** — replace-set transacional | `services/ingestion/src/persistence/store.ts:125-141` |
| IDs externos (`entity_external_ids`) | **REAL** — `tmdb_movie`/`tmdb_tv`/`tmdb_person` + `imdb` | `services/ingestion/src/normalizers/external-ids.ts:29-35` |
| `poster_path` / `backdrop_path` / `still_path` / `profile_path` | **REAL** (string crua, ver 5.9) | `services/ingestion/src/normalizers/movie.ts:48` |
| Upcoming (filmes em estreia) | **PARCIAL** — 1 pagina, cap de 20, regiao BR, so com `--include-upcoming --apply` | `services/ingestion/bin/ingest-public-catalog.ts:67-69` |
| Slugs pt-BR (`slugs`) | **PARCIAL** — so no backfill, nunca no `importMovie`/`importTvShow` | `services/ingestion/bin/ingest-public-catalog.ts:173` |
| Traducoes pt-BR (`entity_translations`) | **PARCIAL** — idem; nascem `status=draft`, `index_status=noindex` (defaults do schema) | `services/ingestion/bin/ingest-public-catalog.ts:179`; `packages/db/prisma/schema.prisma:487-488` |
| Trending / popular / changes | **NAO IMPLEMENTADO** | — |
| Ratings externos (`external_ratings`) | **NAO IMPLEMENTADO** | tabela existe (`packages/db/prisma/schema.prisma:590`); zero writers |
| Onde assistir (`watch_availability`) | **NAO IMPLEMENTADO** | tabela existe (`:626`); zero writers |
| Noticias (`articles`, `entity_news_links`) | **NAO IMPLEMENTADO** pela ingestao (populadas so por seeds/admin) | `services/news-ingestion/` sem codigo |
| `screen_score` (nota editorial propria) | **PLACEHOLDER** | unicos writers sao seeds demo: `apps/admin/scripts/public-demo-seed.ts:261-263`, `:306-308`; a ingestao TMDB **nunca** grava `screenScore` |
| `certification` | **NAO IMPLEMENTADO** pela ingestao | coluna existe (`packages/db/prisma/schema.prisma:245`); nenhum normalizer TMDB a preenche |
| `redirects` | **NAO IMPLEMENTADO** | nenhum caminho de ingestao escreve `redirects` |

> **RISCO / BLOQUEIA PRODUCAO.** As estrelas da home vem de `screen_score`
> (`apps/web/src/lib/home-hero-presenter.ts:141-149`, gate `screenScoreDisplay`). A ingestao
> TMDB **nunca** grava `screen_score`; TMDB `vote_average` cai em `voteAverageTmdb`
> (`services/ingestion/src/normalizers/movie.ts:46`), que e explicitamente marcado como
> "dado tecnico TMDB; NUNCA nota editorial" (`packages/db/prisma/schema.prisma:238`). Ou seja:
> **uma base populada apenas por ingestao real nao tem nenhuma estrela**; so o seed demo
> (`apps/admin/scripts/public-demo-seed.ts`) produz notas. Isto e consistente com as
> invariantes 1/2 (nao converter nota de terceiro em nota propria) — o problema nao e
> governanca, e que a UI espera um dado que nenhum pipeline produz.

---

### 5.4 Idempotencia e deduplicacao

O pipeline e idempotente por construcao, em tres camadas independentes:

**(a) Upsert por chave natural externa.** Todo upsert usa `where: { tmdbId }`:
`services/ingestion/src/persistence/store.ts:169` (movie), `:212` (tv), `:325` (person).
Temporadas usam `(tvShowId, seasonNumber)` (`:243`), episodios `(seasonId, episodeNumber)`
(`:274-276`). Reimportar nao duplica. **REAL**, testado em
`services/ingestion/src/__tests__/import.test.ts:152-164`.

**(b) Short-circuit por `payload_hash`.** `hashPayload` = SHA-256 de um `stableStringify`
com chaves ordenadas recursivamente (`services/ingestion/src/utils/hash.ts:13,38`). Se o hash
bate com o armazenado, `changed=false` (`services/ingestion/src/persistence/cache.ts:48`) e a
orquestracao **nao reescreve a tabela final** — so chama `touchMovie`/`touchTvShow`/`touchSeason`
(`services/ingestion/src/import/import-movie.ts:30`), que sao `$executeRaw` de UPDATE apenas em
`last_synced_at`/`stale_after`, sem bumpar `updated_at`
(`services/ingestion/src/persistence/store.ts:180-186`). Isto cumpre exatamente o requisito 5
de `.claude/rules/ingestion.md` ("sem mudanca, nao reescreve nem bumpa `updated_at`"). **REAL**.

**(c) Chave de cache deterministica.** `buildCacheKey` ordena a querystring antes de hashear
(`services/ingestion/src/utils/cache-key.ts:21-28`), casando com o unique
`(provider_api, request_key, params_hash)` de `api_cache`
(`packages/db/prisma/schema.prisma:699`). **REAL**.

**Deduplicacao de pessoas.** Creditos podem repetir a mesma pessoa; `upsertPeopleStubs`
deduplica por `tmdbId` num `Map` antes do upsert (`services/ingestion/src/persistence/store.ts:59-62`)
e, no `update`, so escreve campos nao-nulos, para nao rebaixar uma pessoa rica (importada por
`/person/{id}`) com o stub magro de um credito (`:65-70`). **REAL** e bem pensado.

**Deduplicacao de ids externos.** `entity_external_ids` tem unique `(source, external_id)`
(`packages/db/prisma/migrations/20260625120000_init/migration.sql:585`). O namespace por tipo
(`tmdb_movie`/`tmdb_tv`/`tmdb_person`) evita colisao entre espacos de id do TMDB
(`api-clients/tmdb/src/provider.ts:51`). `replaceExternalIds` deliberadamente **nao** usa
`skipDuplicates`, para que roubo de id externo por outra entidade falhe alto e reverta a
transacao (`services/ingestion/src/persistence/store.ts:38-51`). **REAL**.

#### Furos de idempotencia (encontrados)

1. **DEBITO / NAO BLOQUEIA PRODUCAO — `touch*` mascara entidade ausente.**
   Dentro do TTL de 24h, `getOrFetch` devolve `changed:false` **mesmo que a linha na tabela
   final nao exista** (`services/ingestion/src/persistence/cache.ts:37-44`). `importMovie`
   entao chama `touchMovie` e **ignora o boolean de retorno**
   (`services/ingestion/src/import/import-movie.ts:30`), logando `status:'success'`,
   `itemsProcessed:1` (`:31-38`). Cenario concreto: banco recriado (`prisma migrate reset`)
   mantendo `api_cache`, ou upsert que falhou num run anterior. O log diz sucesso; a entidade
   nunca entra. Nenhum teste cobre isso — `FakeCache` em
   `services/ingestion/src/__tests__/import.test.ts:29-41` ignora TTL por construcao.

2. **DEBITO — `finalize` conta OK mesmo quando nao escreve nada.**
   `services/ingestion/bin/ingest-public-catalog.ts:167` faz `if (entity === null) return`
   silenciosamente; o chamador incrementa `ok += 1` logo depois (`:365`). Combinado com (1),
   um run pode imprimir `Ingestão concluída (idempotente): 20 OK, 0 falha(s).` sem uma unica
   linha em `movies`.

3. **RISCO / BLOQUEIA PRODUCAO — colisao e mudanca de slug.**
   O slug e `slugify(titulo) + '-' + ano` (`services/ingestion/bin/ingest-public-catalog.ts:170-171`),
   sem nenhum desambiguador por entidade. Dois problemas:
   - **Colisao entre entidades**: `prisma.slug.upsert` tem `where` no unique
     `(entityType, languageCode, slug)` e `update: { entityId: entity.id, isCanonical: true }`
     (`:173-177`). Se dois filmes distintos gerarem o mesmo slug, o segundo **rouba** a linha
     e reaponta `entityId`. O primeiro filme fica sem slug canonico -> 404 silencioso.
   - **Mudanca de titulo upstream**: um novo slug produz uma **nova** linha com
     `isCanonical: true`, violando o indice unico parcial
     `slugs_canonical_unique ON slugs (entity_type, entity_id, language_code) WHERE is_canonical`
     (`packages/db/prisma/migrations/20260625120000_init/migration.sql:733-736`). Prisma lanca
     P2002 dentro de `finalize`, que **nao esta em try/catch** — o `main()` inteiro aborta
     (`services/ingestion/bin/ingest-public-catalog.ts:395`). E nenhum `redirects` e criado,
     contrariando `.claude/rules/i18n.md` §3 ("mudanca de slug publicado gera redirect 301").
     **NAO FOI POSSIVEL CONFIRMAR** empiricamente (nao rodei o script, conforme regra de
     auditoria); a conclusao vem da leitura do indice parcial + do `upsert`.

4. **DEBITO — `finalize` bumpa `updated_at` em todo run.**
   `model.update({ ... posterPath, backdropPath })` em
   `services/ingestion/bin/ingest-public-catalog.ts:209` roda incondicionalmente, mesmo quando
   `changed=false`. `Movie.updatedAt` e `@updatedAt` (`packages/db/prisma/schema.prisma:252`),
   entao o carimbo sobe sem mudanca real — exatamente o que a regra 5 de
   `.claude/rules/ingestion.md` proibe (o `importMovie` respeita a regra; o backfill a viola
   logo depois).

5. **DEBITO — temporadas/episodios removidos upstream nunca sao apagados.**
   `importTvShow` itera `normalized.seasonNumbers` e faz upsert
   (`services/ingestion/src/import/import-tv.ts:52-74`); nao ha `deleteMany` de temporadas/
   episodios orfaos. Creditos, sim, sao replace-set; temporadas nao.

---

### 5.5 Slugs e traducoes pt-BR

- O `services/ingestion` **nao grava slug nem traducao**. Isso e explicito no proprio README:
  "Escopo da Fase 2: NAO grava `slugs`/`redirects`, `entity_translations` nem
  `images`/`trailers`/`franchises`/`genres`" (`services/ingestion/README.md`, bloco de citacao).
- Quem grava e **apenas** o backfill: `prisma.slug.upsert` em
  `services/ingestion/bin/ingest-public-catalog.ts:173-177` e `prisma.entityTranslation.upsert`
  em `:179-189`. **PARCIAL**.
- A traducao pt-BR recebe **so** `title` + `summary` (do `overview` do TMDB). `metaTitle`,
  `metaDescription`, `editorialIntro`, `faqJson` ficam nulos (`:186-188`).
- **RISCO (SEO/licenca):** `summary` = `detail.overview` — a **sinopse crua do TMDB**, copiada
  literalmente. `.claude/rules/entity-writer.md` §4 proibe copiar sinopses externas *para o
  Entity Writer*; a regra nao veta a persistencia do `overview` como dado cru, mas a home/detalhe
  exibem esse texto. Se `summary` aparecer como texto de pagina indexavel, e reexibicao crua de
  terceiro — nao conta como bloco de valor (`.claude/rules/seo.md` §1) e depende de atribuicao
  TMDB. Recomendo tratar `summary` como dado cru interno, nunca como "introducao editorial".
- `entity_translations.status` nasce `draft` e `index_status` nasce `noindex`
  (`packages/db/prisma/schema.prisma:487-488`); o backfill **nao** os promove. Correto do ponto
  de vista da invariante 7, mas significa que **nenhuma entidade ingerida chega a `published`
  sem passo humano/admin** — nao ha caminho automatizado (nem deveria haver).
- `slugify` remove diacriticos via `.normalize('NFD').replace(/[̀-ͯ]/g, '')`
  (`services/ingestion/bin/ingest-public-catalog.ts:100-102`). O range aparece **literal no
  arquivo** (nao como `̀-ͯ`), o que e fragil a normalizacao de encoding do arquivo.
  **DEBITO** cosmetico/robustez.
- Fallback `tmdb-${id}` quando o titulo slugifica para vazio (`:170`) — bom.

---

### 5.6 `api_cache` e `api_sync_logs`: o que e gravado, e sob quais flags

#### `api_cache`

- Escrito em `services/ingestion/src/persistence/cache.ts:52-65` (`prisma.apiCache.upsert`).
- Chave: `(providerApi='tmdb', requestKey, paramsHash)`; `providerApi` default vem de
  `TMDB_PROVIDER_API` (`api-clients/tmdb/src/provider.ts:19`), com FK para `api_providers`
  (`packages/db/prisma/schema.prisma:700`), semeada em `packages/db/src/seed-data.ts:117`.
- Guarda o **payload bruto** (`payload: Json`) + `payloadHash` + `fetchedAt` + `expiresAt`
  (`= now + cacheTtlMs`, default 24h — `api-clients/tmdb/src/config.ts:91`).
- Leitura dentro do TTL evita rede (`cache.ts:37-44`). **REAL**.
- **DEBITO:** nao ha job de expurgo de `api_cache`. O indice `@@index([expiresAt])` existe
  (`packages/db/prisma/schema.prisma:700`), mas nada limpa linhas vencidas — a tabela cresce
  monotonicamente com payloads JSON completos de TMDB.

#### `api_sync_logs`

- Escrito em `services/ingestion/src/persistence/sync-log.ts:19-32`.
- Campos gravados: `providerApi`, `endpoint`, `status`, `errorCode`, `itemsProcessed`,
  `itemsCreated`, `itemsUpdated`, `durationMs`, `quotaCost`, `payloadHash`.
- **1 log por ciclo de entidade** (nao por request): `importTvShow` grava um unico log com
  `itemsProcessed = 1 + seasonNumbers.length` e `quotaCost` somado
  (`services/ingestion/src/import/import-tv.ts:76-85`).
- Falha de rede vira `status:'failed'`; circuito aberto vira `status:'aborted'`
  (`services/ingestion/src/import/errors.ts:22`, `import-movie.ts:79`). Nunca relanca.
- A descoberta de upcoming tambem loga (`status` `success`/`empty`/`failed`)
  (`services/ingestion/bin/ingest-public-catalog.ts:269-277`). **REAL**.
- `status:'partial'` existe no enum (`packages/db/prisma/schema.prisma:120`) e **nunca e usado**.
- **DEBITO / furo de log:** o `finalize` do backfill chama `ctx.cache.getOrFetch` uma **segunda
  vez** para o mesmo endpoint (`services/ingestion/bin/ingest-public-catalog.ts:359-363` e
  `:375-379`) **sem escrever nenhum log**. Na pratica sempre bate no cache quente que
  `importMovie` acabou de gravar, mas se o TTL expirasse entre as duas chamadas haveria um
  **sync externo sem log** — violacao direta de "todo sync externo gera log, sem excecao".
- **DEBITO:** `quotaCost` e sempre `0` ou `1` (contagem de chamadas de rede,
  `import-movie.ts:27`), nao a cota real reportada pelo provider. Nenhum header de rate-limit
  do TMDB e lido.

#### Flags de CLI (a resposta direta a pergunta)

`services/ingestion/bin/ingest-public-catalog.ts:285-291`:

| Flag | Efeito | Escreve no banco? | Faz sync externo? |
| --- | --- | --- | --- |
| *(nenhuma)* | **dry-run implicito** — imprime o plano e sai (`:321-331`) | Nao | Nao |
| `--apply` | executa o backfill; upsert idempotente | Sim (`api_cache`, `api_sync_logs`, entidades, `slugs`, `entity_translations`) | Sim |
| `--include-upcoming` | descobre ids via `/movie/upcoming` (so tem efeito junto com `--apply`, `:343`) | Sim | Sim |
| `--download-images` | LEGADO/opt-in: baixa poster/backdrop para `apps/web/public/media/tmdb/` e grava path local | Sim | Sim (fetch direto ao CDN, `:130`) |
| `--refresh-images` | so faz sentido com `--download-images`; re-baixa arquivos existentes (`:129`) | Sim | Sim |

**Nao existe uma flag `--dry-run`.** O dry-run e a ausencia de `--apply`. Guards fail-closed
antes de qualquer escrita: aborta se `NODE_ENV=production`/`VERCEL_ENV=production` (`:303-307`),
se falta `DATABASE_URL` (`:308-312`), se falta token TMDB (`:313-319`).

`services/ingestion/bin/import.ts` tem outra convencao: `--movie <id>`, `--tv <id>`,
`--person <id>`, `--seed` (`bin/import.ts:28-49`). **Nao tem dry-run e nao tem guard de
producao** — escreve direto. **DEBITO / RISCO** de assimetria: o CLI mais antigo e o mais
perigoso.

---

### 5.7 Resiliencia: item a item

| Mecanismo obrigatorio (`.claude/rules/ingestion.md`) | Status | Evidencia |
| --- | --- | --- |
| **Retry com backoff exponencial** | **REAL** | `api-clients/tmdb/src/http.ts:204-212` — `BACKOFF_BASE_MS * 2**attempt`, teto `BACKOFF_MAX_MS = 10_000` (`:72-73`), `maxRetries` default 4 (`config.ts:88`) |
| **Jitter** | **REAL** | `api-clients/tmdb/src/http.ts:210` — `this.random() * BACKOFF_BASE_MS` |
| **`Retry-After` em 429** | **REAL** | `api-clients/tmdb/src/http.ts:168-170`, parser em `:97-102` (so formato em segundos; formato data e ignorado — **DEBITO** menor) |
| **Nao retentar 4xx permanente** | **REAL** | `api-clients/tmdb/src/http.ts:92-94` + `:160-163` (4xx exceto 429 lanca sem retry e **sem contar para o breaker**) |
| **Rate limit por provider** | **PARCIAL** | `api-clients/tmdb/src/http.ts:198-202` — throttle por intervalo minimo `ceil(1000/maxRps)`, `maxRps` default 20 (`config.ts:87`). E **por instancia de client**, nao por processo/host; e `nextAllowedAt` nao e seguro sob concorrencia (read-then-write sem lock). Na pratica a ingestao e sequencial, entao funciona. |
| **Circuit breaker por API** | **PARCIAL** | `api-clients/tmdb/src/http.ts:180-196` — abre apos `breakerThreshold` (default 5) falhas *transitorias esgotadas*, cooldown 30s (`config.ts:89-90`). **Nao ha half-open explicito**: `assertCircuitClosed` (`:180`) so bloqueia enquanto `now < openUntil`; passado o cooldown a proxima chamada e livre e um sucesso zera o contador (`onSuccess`, `:186`). Funcionalmente equivalente a half-open de 1 prova, mas sem estado nomeado. |
| **Cache local (`api_cache`)** | **REAL** | `services/ingestion/src/persistence/cache.ts:33-44` |
| **Hash de payload (evitar update sem mudanca)** | **REAL** | `services/ingestion/src/persistence/cache.ts:48`; `services/ingestion/src/utils/hash.ts:38` |
| **Log de todo sync** | **REAL (com 1 furo)** | `services/ingestion/src/persistence/sync-log.ts:19`; furo em `bin/ingest-public-catalog.ts:359` (ver 5.6) |
| **Degradacao graciosa: servir do `api_cache` quando o breaker abre** | **NAO IMPLEMENTADO** | `cache.ts:37` so devolve cache **dentro** do TTL. Se o TTL expirou e o breaker esta aberto, `input.fetcher()` lanca `TmdbCircuitOpenError` (`http.ts:181-183`) e a entidade vira `aborted` — o cache vencido, que ainda tem dado bom, nao e usado como fallback. `.claude/rules/ingestion.md` §"Circuit breaker" exige exatamente esse fallback. |
| **`provider_payload_hash` em `external_ratings`** | **NAO IMPLEMENTADO** | coluna existe (`packages/db/prisma/schema.prisma:590+`); nenhum writer |
| **Chaves so em env var** | **REAL** | `api-clients/tmdb/src/config.ts:68-81` (`TMDB_READ_ACCESS_TOKEN` v4 preferido, `TMDB_API_KEY` v3 fallback, `TmdbConfigError` se nenhum). Token nunca vai ao bundle: `check-render-purity.mjs:152-155` bane o import de `@screena/tmdb-client` em paginas. |

Ambiente parametrizavel: `TMDB_API_BASE_URL`, `TMDB_DEFAULT_LANGUAGE`, `TMDB_MAX_RPS`,
`TMDB_MAX_RETRIES`, `TMDB_BREAKER_THRESHOLD`, `TMDB_BREAKER_COOLDOWN_MS`, `TMDB_CACHE_TTL_MS`
(`api-clients/tmdb/src/config.ts:84-92`). **NAO FOI POSSIVEL CONFIRMAR** que todas estao
documentadas em `.env.example`: a leitura desse arquivo foi negada pela sandbox de permissoes
desta auditoria.

Cobertura de teste da resiliencia: `api-clients/tmdb/src/__tests__/http.test.ts` exercita
retry, 4xx permanente, breaker abrindo (`:106-108`) e reabrindo apos cooldown (`:120-124`),
com transporte/relogio injetados (`api-clients/tmdb/src/http.ts:64-70`). **REAL** e bem feito.

---

### 5.8 Frescor (`last_synced_at` / `stale_after`) e o runner de sync

- `stale_after = now + 7 dias` — constante duplicada em dois lugares:
  `services/sync/src/stale-policy.ts:9` (`DEFAULT_STALE_WINDOW_MS`) e
  `services/ingestion/src/composition.ts:18` (`STALE_WINDOW_MS`), com um comentario admitindo a
  duplicacao para evitar ciclo de dependencia (`composition.ts:8-9`). **DEBITO** de fonte unica.
- A tabela de periodicidades de `.claude/rules/ingestion.md` (lancamentos diario, ratings
  12-24h, onde assistir diario, trending 6-12h, midia 7 dias) **nao existe em codigo**: ha
  **uma unica janela de 7 dias** para tudo. **NAO IMPLEMENTADO**.
- `stale_after` so existe em `movies` e `tv_shows`
  (`packages/db/prisma/schema.prisma:254`, `:292`). `seasons`, `episodes` e `people` tem so
  `last_synced_at` (`:319`, `:343`, `:370`). Consequencia: **`people` nunca e reprocessada pelo
  sync** — `services/sync/bin/run.ts` seleciona apenas `movie` (`:27`) e `tvShow` (`:37`).
  **DEBITO**.
- `services/sync/bin/run.ts` seleciona `staleAfter: null OR < now`, ordena por `staleAfter asc`,
  `take: limit` (default 50, `:15`) e reimporta. **REAL**, mas: `staleAfter: null` ordena
  primeiro/ultimo de forma dependente do Postgres (`NULLS LAST` no `asc` por padrao), o que
  significa que entidades **nunca sincronizadas** (`staleAfter = null`) sao processadas **por
  ultimo**. Provavelmente nao e o desejado. **DEBITO** menor.
- O runner nao trata `aborted` como sinal de parada: se o breaker abrir, ele continua iterando
  as 50 entidades, cada uma logando `aborted` (`services/ingestion/src/import/import-movie.ts:79`).
  Custo baixo (nao ha rede), mas gera 50 linhas de log inuteis por ciclo degradado.

---

### 5.9 Decisao de imagem TMDB (secao obrigatoria)

Verifiquei cada afirmacao. **Todas confirmadas.**

| Afirmacao a verificar | Veredito | Evidencia |
| --- | --- | --- |
| Nao salva JPG/WebP local (por padrao) | **CONFIRMADO** | `services/ingestion/bin/ingest-public-catalog.ts:291` define `downloadImages = argv.includes('--download-images')` — default `false`. `:192-197` so chamam `downloadImage` quando a flag esta ligada. |
| Nao usa `/media/tmdb` | **CONFIRMADO** | `find apps/web/public/media -type f` retorna **apenas** `media/demo/*.png` (assets do seed demo, commitados). O diretorio `apps/web/public/media/tmdb/` **nao existe** e esta em `.gitignore:15`. |
| Guarda `file_path` cru no banco | **CONFIRMADO** | `resolveCatalogImagePath` retorna `normalizeRawTmdbPath(rawPath)` quando `downloadImages=false` (`services/ingestion/src/public-catalog-image.ts:40-45`); `normalizeRawTmdbPath` exige string comecando com `/` e **nao** monta URL nem troca extensao (`:28-33`). O `importMovie` ja gravava o cru desde o normalizer (`services/ingestion/src/normalizers/movie.ts:48-49`). |
| Frontend monta `image.tmdb.org` via helper governado | **CONFIRMADO** | `apps/web/src/lib/tmdb-image-url.ts:20` (`TMDB_IMAGE_BASE`), `:40-53` (`buildTmdbImageUrl`). E o **unico** arquivo de producao de `apps/web` com esse literal (grep repo-wide: as demais ocorrencias sao testes, docs, comentarios do worker e o proprio guard). |
| `audit:render` tem excecao **apenas** para o helper | **CONFIRMADO** | `scripts/audit/check-render-purity.mjs:130` — `IMAGE_URL_HELPER_REL = 'apps/web/src/lib/tmdb-image-url.ts'`; a excecao e aplicada so nesse caminho (`:364`, `:372-378`), e cobre **somente** `FORBIDDEN_LITERAL_PATTERNS`. `FETCH_PATTERNS` (`:95-99`, que inclui os hosts `tmdb`/`themoviedb`) continua aplicado a **todos** os arquivos, inclusive ao helper (`:381-385`). |
| Usa o optimizer do `next/image`? | **NAO** | Zero import de `next/image` em `apps/web` (as unicas ocorrencias sao `_next/image` no matcher do middleware, `apps/web/middleware.ts:60`, e o `next-env.d.ts` gerado). `apps/web/next.config.ts` **nao tem chave `images:`**, logo **sem `remotePatterns` e sem `unoptimized`**. As imagens sao `<img src>` cru: `apps/web/app/_components/hero-carousel.tsx:172-174`, `apps/web/app/pt/page.tsx:289`, `apps/web/app/pt/filmes/[slug]/page.tsx:181`. |

Ordem de resolucao nos presenters (local-first, depois remoto). Confirmada em todos:

| Presenter | Linha | `tmdbSize` usado |
| --- | --- | --- |
| `apps/web/src/lib/movie-presenter.ts` | `:146` | poster `w500` (`:42`), backdrop `w1280` (`:46`) |
| `apps/web/src/lib/series-presenter.ts` | `:199` | poster `w500`, backdrop `w1280`, still `original` (`:31-33`) |
| `apps/web/src/lib/person-presenter.ts` | `:221` | profile `original` (`:43`) |
| `apps/web/src/lib/cast-presenter.ts` | `:97` | profile `original` (`:31`) |
| `apps/web/src/lib/entity-index-presenter.ts` | `:179` | poster `w500`, profile `original` (`:30-31`) |
| `apps/web/src/lib/home-hero-presenter.ts` | `:164-165` | backdrop `w1280` -> fallback poster `w780` (`:25`, `:28`) |
| `apps/web/src/lib/home-upcoming-presenter.ts` | `:105` | backdrop `w780` -> fallback poster `w500` |

Detalhe correto e nao-obvio: `TmdbImageSize` (`apps/web/src/lib/tmdb-image-url.ts:26`) so
oferece `w300|w500|w780|w1280|original`. O TMDB tem conjuntos de tamanhos **distintos por tipo**
(profile: `w45/w185/h632/original`; still: `w92/w185/w300/original`). Por isso perfis e stills
usam `original` — a unica chave valida em todos os tipos. Ou seja, **nao ha URL invalida**, mas
ha **DEBITO de banda**: perfis de elenco declarados `200x300` (`cast-presenter.ts:31`) baixam a
imagem `original` (frequentemente >1 MB).

Guardas do helper (todas com teste em `tests/web/tmdb-image-url.test.ts`): rejeita `null`/vazio,
path que nao comeca com `/`, protocolo-relativo `//host`, URL absoluta, prefixos locais legados
`/media/`, `/uploads/`, `/brand/`, `..`, `?`, `#`, backslash e espaco
(`apps/web/src/lib/tmdb-image-url.ts:44-51`). O helper **preserva a extensao** — nunca reescreve
`.jpg` para `.webp` (`:14-16`).

**Residuos do modelo antigo (nao removidos):**
- `services/ingestion/bin/ingest-public-catalog.ts:50` ainda define `IMAGE_CDN` e `:119-139`
  ainda implementa `downloadImage` (caminho legado atras da flag). **DEBITO / NAO BLOQUEIA
  PRODUCAO** — e opt-in e documentado, mas mantem viva a possibilidade de gravar
  `/media/tmdb/...` no banco, que o helper de render **rejeita**
  (`tmdb-image-url.ts:49`) — resultando em card sem imagem em vez de erro visivel.
  Ou seja: usar `--download-images` **hoje quebra silenciosamente as imagens** de qualquer
  presenter que so use `buildTmdbImageUrl` (hero e upcoming), embora funcione nos presenters
  que testam `normalizeLocalImagePath` antes.
- `apps/web/middleware.ts:60` ainda exclui `media|brand|uploads` do matcher — inofensivo.

**RISCO (produto, nao invariante):** o render agora depende de um terceiro (`image.tmdb.org`)
para renderizar acima da dobra. Nao ha cache proprio nem fallback de imagem. Isto **nao viola**
a invariante 3 (nao ha `fetch` no servidor; e o browser do usuario que busca a imagem), como o
proprio guard documenta (`scripts/audit/check-render-purity.mjs:12-18`).

---

### 5.10 Governanca: as invariantes que este pipeline toca

| Invariante | Como o pipeline se comporta |
| --- | --- |
| **2 — `provider_api` != `rating_source`** | **REAL e explicito.** `TMDB_PROVIDER_API='tmdb'` so vai para `api_cache`/`api_sync_logs`/`api_providers` (`api-clients/tmdb/src/provider.ts:14-19`); `entity_external_ids.source` usa namespace `tmdb_movie`/`tmdb_tv`/`tmdb_person` (`:51`). `vote_average` do TMDB e persistido em `voteAverageTmdb` com comentario de schema marcando que **nao** e nota editorial (`packages/db/prisma/schema.prisma:238`). Nenhum `rating_source` e escrito pela ingestao. |
| **3 — zero API externa no render** | **REAL.** Todo `fetch` vive em `api-clients/tmdb/src/http.ts:76-89` e no `downloadImage` do bin (`ingest-public-catalog.ts:130`). `check-render-purity.mjs:147-155` bane import de `services/ingestion`, `services/sync` e `@screena/tmdb-client` em paginas. |
| **6 — dado sem licenca clara** | Nao aplicavel hoje: a ingestao nao grava nada em `source_licenses` nem `external_ratings`. Mas **a sinopse crua do TMDB (`overview`) e persistida e exibida** sem atribuicao visivel no dado (ver 5.5). **RISCO** de atribuicao TMDB. |
| **7 — pt-BR primeiro** | **REAL por construcao**: o backfill so escreve `languageCode: 'pt-BR'` (`ingest-public-catalog.ts:49`, usado em `:174` e `:183`). Nao ha caminho para gerar en/es. |
| **8 — sem pirataria** | **REAL trivialmente**: nenhuma fonte de disponibilidade e consumida. |
| **12/13 — Entity Writer** | Fora do escopo desta parte; a ingestao **nao** gera texto editorial e nao chama Gemini. |
| **"todo sync gera log"** | **REAL, com 1 furo** documentado em 5.6 (`ingest-public-catalog.ts:359`). |

Escopo de typecheck/lint (relevante para confianca no codigo):
`tsconfig.json:22-25` exclui `services/**/persistence/**`, `services/**/bin/**` e
`services/ingestion/src/composition.ts` do `pnpm typecheck`. Ou seja, as **398 linhas** de
`bin/ingest-public-catalog.ts` — o script que mais escreve no banco — **nao passam pelo
compilador** e nao tem teste proprio (`vitest.config.ts:6-11` inclui `services/**/*.test.ts`;
o unico teste do backfill e do helper puro `public-catalog-image.test.ts`). O ESLint, esse sim,
varre o bin (`eslint.config.mjs:30-42` nao o ignora). **DEBITO / BLOQUEIA PRODUCAO** para
qualquer operacao de backfill em escala.

---

### 5.11 Debitos e riscos consolidados

| # | Item | Severidade |
| --- | --- | --- |
| 1 | Colisao/mudanca de slug: hijack silencioso entre entidades e P2002 no indice parcial `slugs_canonical_unique`; zero `redirects` gerados | **RISCO — BLOQUEIA PRODUCAO** |
| 2 | `bin/ingest-public-catalog.ts` (398 linhas, maior escritor de banco) fora do `typecheck` e sem teste de integracao | **DEBITO — BLOQUEIA PRODUCAO** |
| 3 | `touch*` ignora retorno; cache quente + tabela vazia produz log `success` sem linha gravada | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 4 | Breaker aberto nao serve `api_cache` vencido (degradacao graciosa exigida pela regra) | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 5 | Segundo `getOrFetch` no `finalize` pode ir a rede sem escrever `api_sync_logs` | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 6 | `finalize` bumpa `updated_at` em todo run, mesmo com `changed=false` | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 7 | `bin/import.ts` escreve no banco sem dry-run e sem guard de producao | **RISCO — NAO BLOQUEIA PRODUCAO** |
| 8 | `screen_score` (estrelas da UI) so vem de seed demo; base real de ingestao fica sem nota | **RISCO — BLOQUEIA PRODUCAO** (produto, nao invariante) |
| 9 | `people` nunca entra no ciclo de refresh (sem `stale_after`, ausente do runner) | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 10 | Janela de stale unica (7d) para tudo; periodicidades da regra (diario/6-12h/12-24h) inexistentes | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 11 | `api_cache` sem expurgo — cresce sem limite com payloads JSON | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 12 | Temporadas/episodios removidos upstream nunca sao deletados | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 13 | `--download-images` grava `/media/tmdb/...`, que `buildTmdbImageUrl` rejeita -> imagem some em hero/upcoming | **RISCO — NAO BLOQUEIA PRODUCAO** (opt-in) |
| 14 | `summary` = `overview` cru do TMDB, exibido em pagina, sem atribuicao no dado | **RISCO (SEO/licenca) — NAO BLOQUEIA PRODUCAO** |
| 15 | `workers/*.py` e `workers/scheduler.py` descrevem timers que nao existem; `services/ratings|streaming|news-ingestion` sao READMEs vazios de codigo | **DEBITO (documentacao enganosa) — NAO BLOQUEIA PRODUCAO** |
| 16 | Constante de janela de stale duplicada (`sync` e `ingestion`) | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 17 | Regra `.claude/rules/ingestion.md` cita tabelas (`platforms`, `providers`, `franchises`, `images`, `trailers`, `news_clusters`) que nao existem no schema Prisma | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 18 | `quotaCost` e contagem de chamadas, nao cota real do provider | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 19 | `parseRetryAfterMs` ignora `Retry-After` em formato de data HTTP | **DEBITO — NAO BLOQUEIA PRODUCAO** |
| 20 | `packages/db/src/server.ts:6` afirma "NUNCA importado pelo render publico", mas `apps/web/src/server/*` o importa (uso legitimo, comentario obsoleto) | **DEBITO (doc) — NAO BLOQUEIA PRODUCAO** |

---

### 5.12 O que precisa virar cron/job

Estado atual dos agendamentos:

| Job | Existe unit? | Estado |
| --- | --- | --- |
| Refresh de catalogo stale (`services/sync/bin/run.ts 50`) | Sim — `screena-tmdb-catalog.service` + `.timer` (`OnCalendar=*-*-* 03:00:00`, `Persistent=true`, `RandomizedDelaySec=900`) | **PARCIAL** — o `.service:3` se auto-declara "Ilustrativo: ajuste WorkingDirectory, usuario e o comando"; `ExecStart` usa `tsx` (`:19`), com o proprio arquivo admitindo que producao deveria usar entrypoint compilado |
| Backfill de catalogo publico (`ingest-public-catalog.ts --apply`) | Nao | **NAO IMPLEMENTADO** — e alem disso **aborta se `NODE_ENV=production`** (`:298`, `:303-307`), entao hoje **nao pode** virar cron de producao sem mudanca de codigo |
| Descoberta de upcoming (`--include-upcoming`) | Nao | **NAO IMPLEMENTADO** — a home "Em breve" so atualiza quando alguem roda o script a mao |
| Entity Writer (drenar `entity_writer_jobs`) | Nao | **NAO IMPLEMENTADO** (existe `services/entity-writer/bin/run.ts`, mas nenhuma unit) |
| Ratings / streaming / noticias | Nao | **NAO IMPLEMENTADO** (nem codigo) |
| Expurgo de `api_cache` vencido | Nao | **NAO IMPLEMENTADO** |
| Reconciliacao de `stale_after` para `people`/`seasons` | Nao | **NAO IMPLEMENTADO** |

**PROXIMO PASSO — ordem sugerida, do que destrava producao ao que e higiene:**

1. **Corrigir o slug antes de qualquer backfill em escala.** Desambiguar por `tmdbId` no
   colidido, detectar mudanca de slug e emitir `redirects` 301, e proteger `finalize` com
   try/catch por entidade. Sem isso, o job de ingestao e uma bomba-relogio
   (`services/ingestion/bin/ingest-public-catalog.ts:170-177`).
2. **Tirar `bin/ingest-public-catalog.ts` da exclusao de typecheck** (`tsconfig.json:24`) ou
   mover a logica de `finalize` para `services/ingestion/src/` (typechecked e testavel),
   deixando no `bin` so o parsing de argv. Hoje a parte mais perigosa e a menos verificada.
3. **Transformar o backfill em job de producao de verdade**: substituir o abort por
   `NODE_ENV=production` (`:303`) por um gate explicito (ex.: `SCREEN_INGEST_ALLOW_PRODUCTION=1`
   + `--apply`), e criar `screen-tmdb-backfill.service`/`.timer` (semanal) e
   `screen-tmdb-upcoming.service`/`.timer` (diario, `--include-upcoming`).
4. **Job de refresh diferenciado por tipo de dado.** Trocar a janela unica de 7 dias
   (`services/sync/src/stale-policy.ts:9`) por janelas por classe (lancamentos: diario;
   catalogo: 7-14d), como a regra ja manda. Incluir `people` no runner (exige adicionar
   `stale_after` a `people` — **tarefa de schema, precisa de aprovacao humana**).
5. **Fallback de cache vencido quando o breaker abre** (`api-clients/tmdb/src/http.ts:181` +
   `services/ingestion/src/persistence/cache.ts:37`): servir o payload expirado, marcar a fonte
   como degradada no `api_sync_logs` e nunca cair para chamada no render.
6. **Job de expurgo de `api_cache`** (usar `@@index([expiresAt])`, ja existe).
7. **`screen-entity-writer.timer`** para drenar `entity_writer_jobs`, quando o slice editorial
   for liberado.
8. **Decidir o destino de `workers/*.py`.** Ou viram shim real, ou saem do repositorio — hoje
   sao 379 linhas de documentacao que contradizem o estado do codigo TS.

---

### 5.13 O que NAO FOI POSSIVEL CONFIRMAR

- **Conteudo de `.env.example`**: a leitura do arquivo foi **negada pela sandbox de permissoes**
  desta sessao (tanto via `Grep` quanto via `Bash`). Nao consegui verificar se as sete variaveis
  lidas por `api-clients/tmdb/src/config.ts:84-92` estao documentadas la, nem se
  `SCREENA_TMDB_API_KEY` (nome legado citado em `.claude/rules/ingestion.md`) foi removido.
- **Comportamento em runtime do P2002 de slug** (item 3 de 5.4 e item 1 de 5.11): a conclusao vem
  de leitura estatica do `upsert` (`ingest-public-catalog.ts:173-177`) contra o indice unico
  parcial (`migration.sql:733-736`). Nao executei o script nem o banco (regra da auditoria:
  somente leitura, sem migrations).
- **Se a base atualmente hospedada (EasyPanel) foi populada por `--apply` ou por seed demo.**
  Nao ha acesso ao banco. O sinal indireto e que `apps/web/public/media/demo/*.png` esta
  commitado e `screen_score` so tem writers em `apps/admin/scripts/public-demo-seed.ts`.
- **Se algum `.service`/`.timer` esta de fato instalado no VPS.** No repositorio existe apenas
  o par `services/sync/systemd/screena-tmdb-catalog.{service,timer}`.


---

## Parte 6 — Rotas publicas existentes

> Nota de procedimento: o orquestrador passou o caminho de saida como `undefined`. Esta secao foi escrita em
> `C:\Users\pablo\AppData\Local\Temp\claude\E---rea-de-Trabalho-2-Screnaa\a6d4b6d3-564f-4bbe-976c-1ee35530e4f4\scratchpad\sections\06-rotas.md`.
> Auditoria 100% estatica (leitura de codigo + manifesto de build ja existente em `apps/web/.next/`). Nenhum servidor foi
> iniciado, nenhum build foi rodado, nenhum teste foi executado. Toda afirmacao sobre comportamento em runtime deriva do
> codigo-fonte e do `app-path-routes-manifest.json`, nao de observacao ao vivo.

---

### 6.1 Inventario bruto: tudo que existe em `apps/web/app/**`

O App Router do app publico tem **exatamente 16 entradas de rota**, confirmadas de duas formas independentes:

1. varredura do filesystem (`apps/web/app/**`);
2. o manifesto do ultimo build local, `apps/web/.next/app-path-routes-manifest.json` (BUILD_ID de 07/07, mesmo dia da auditoria).

```
/_not-found          (gerado pelo Next; nao ha app/not-found.tsx proprio)
/robots.txt          -> apps/web/app/robots.ts
/sitemap.xml         -> apps/web/app/sitemap.ts
/filmes              -> apps/web/app/filmes/page.tsx              (redirect 308)
/series              -> apps/web/app/series/page.tsx              (redirect 308)
/dev/movie-page-preview -> apps/web/app/dev/movie-page-preview/page.tsx
/pt                  -> apps/web/app/pt/page.tsx
/pt/filmes           -> apps/web/app/pt/filmes/page.tsx
/pt/filmes/[slug]    -> apps/web/app/pt/filmes/[slug]/page.tsx
/pt/series           -> apps/web/app/pt/series/page.tsx
/pt/series/[slug]    -> apps/web/app/pt/series/[slug]/page.tsx
/pt/pessoas          -> apps/web/app/pt/pessoas/page.tsx
/pt/pessoas/[slug]   -> apps/web/app/pt/pessoas/[slug]/page.tsx
/pt/noticias         -> apps/web/app/pt/noticias/page.tsx
/pt/noticias/[slug]  -> apps/web/app/pt/noticias/[slug]/page.tsx
/pt/explorar         -> apps/web/app/pt/explorar/page.tsx
```

Fora das rotas: `apps/web/app/layout.tsx` (layout raiz), `apps/web/app/globals.css`, `apps/web/app/_components/*` (14 componentes),
`apps/web/app/README.md`, `apps/web/app/.gitkeep`. Fora de `app/`, mas no caminho de request: `apps/web/middleware.ts`.

**Nao existe** `apps/web/app/page.tsx`. **Nao existe** `not-found.tsx` nem `error.tsx` proprios. **Nao existe** nenhum diretorio
`en/` ou `es/` em lugar nenhum de `apps/web/app` — o manifesto de build confirma: nenhuma rota `/en*` ou `/es*`.

Tambem **nao existe** nenhuma rota `route.ts` (API handler). O commit `0108e67` ("serve runtime tmdb media via route handler") foi
revertido; a arquitetura final usa URL remota do TMDB montada como string (`apps/web/src/lib/tmdb-image-url.ts:40`).

---

### 6.2 Tabela mestra de rotas

Legenda das colunas: **le banco?** = a rota consulta PostgreSQL via `@screena/db`; **nota?** = exibe nota/estrela;
**streaming?** = exibe plataforma/"onde assistir"; **noticias?** = renderiza artigos.

| Rota | Existe? | Arquivo | Dinamica/estatica | Le banco? | Placeholder? | generateMetadata/SEO? | JSON-LD? | Dados reais? | Imagem real? | Nota? | Streaming? | Noticias? | **PROXIMO PASSO** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/` (raiz) | **NAO IMPLEMENTADO** | — (nao ha `app/page.tsx`) | — | nao | — | nao | nao | — | — | — | — | — | **RISCO / BLOQUEIA PRODUCAO**: `https://thescreen.media/` cai em `_not-found` (404). Criar `app/page.tsx` com `permanentRedirect(HOME_PATH)` (mesmo padrao de `app/filmes/page.tsx:15`) ou um redirect no proxy |
| `/pt` | Sim | `apps/web/app/pt/page.tsx` | `export const dynamic = "force-dynamic"` (`pt/page.tsx:60`) — SSR por request, sem ISR, sem `generateStaticParams` | Sim (4 getters: `getMovieIndexData`/`getSeriesIndexData`/`getPersonIndexData`/`getNewsIndexData` + `getHomeHeroSlides` + `getHomeUpcomingMovies`, `pt/page.tsx:79-84,522-523`) | **Sim, vários** (ver 6.4) | Sim (`pt/page.tsx:113-124`): `robots` por gate + `alternates.canonical` | **NAO** — a home nao emite nenhum `ld+json` (nem `WebSite`, nem `Organization`, nem `BreadcrumbList`) | **PARCIAL** — hero/cards/stats/upcoming reais; ticker/ads/news mock | **REAL** (URL remota TMDB, `home-hero-presenter.ts:164`, `entity-index-presenter.ts:179`) | **PLACEHOLDER** — `screenScore` so e escrito por `apps/admin/scripts/public-demo-seed.ts:261` | **PLACEHOLDER** (ticker + chips) | **PLACEHOLDER** em dev; oculto em prod | Remover/gatear o `EpisodesTicker` (ver 6.5); adicionar `WebSite`+`Organization` JSON-LD |
| `/pt/filmes` | Sim | `apps/web/app/pt/filmes/page.tsx` | `force-dynamic` (`:21`) | Sim (`getMovieIndexData`) | Nao | Sim (`:27-38`) | Sim — `CollectionPage` + `ItemList` + `BreadcrumbList` (via `_components/entity-index.tsx:48-70,118-123`) | **REAL** | **REAL** (poster w500 remoto) | Nao (o card de listagem nao mostra nota) | Nao | Nao | Nenhum bloqueio; `index` so com `>= 3` itens (`entity-index-presenter.ts:25`) |
| `/pt/filmes/[slug]` | Sim | `apps/web/app/pt/filmes/[slug]/page.tsx` | `export const revalidate = 3600` (`:33`) — ISR; **sem `generateStaticParams`** (nenhum arquivo do repo exporta essa funcao) | Sim (`getMoviePageData`, `src/server/movie-page.ts`) | Nao (secoes vazias sao omitidas) | Sim (`:42-75`) | Sim — `Movie` + `BreadcrumbList` (`:119-127,287-294`); **sem `AggregateRating`** (comentado explicitamente em `:117`) | **PARCIAL** — ficha real; blocos editoriais dependem do Entity Writer | **REAL** | Nao | **PLACEHOLDER** — `WatchProviders` so aparece com `watch_availability`, e a unica escrita dessa tabela e o seed demo | Sim (`RelatedNewsSection`, vazio na pratica) | Rodar Entity Writer + revisao humana; sem `>= 2` blocos `human_reviewed`/`published` a pagina fica `noindex` (`movie-indexability.ts:26`) |
| `/pt/series` | Sim | `apps/web/app/pt/series/page.tsx` | `force-dynamic` (`:21`) | Sim (`getSeriesIndexData`) | Nao | Sim (`:27-38`) | Sim (mesmo `EntityIndex`) | **REAL** | **REAL** | Nao | Nao | Nao | idem `/pt/filmes` |
| `/pt/series/[slug]` | Sim | `apps/web/app/pt/series/[slug]/page.tsx` | `revalidate = 3600` (`:19`) | Sim (`getSeriesPageData`) | Nao | Sim (`:28-60`) | Sim — `TVSeries` + `BreadcrumbList` (`:100-110,314-321`) | **PARCIAL** (temporadas/episodios reais se ingeridos) | **REAL** | Nao | **PLACEHOLDER** (mesma dependencia de seed) | Sim | **DEBITO**: `SERIES_INDEX_PATH` esta redeclarado localmente em `:21` em vez de importado de `src/lib/site.ts` |
| `/pt/pessoas` | Sim | `apps/web/app/pt/pessoas/page.tsx` | `force-dynamic` (`:21`) | Sim (`getPersonIndexData`) | Nao | Sim (`:27-38`) | Sim (`EntityIndex`) | **REAL** | **REAL** (`profile`, size `original`, `entity-index-presenter.ts:31`) | Nao | Nao | Nao | — |
| `/pt/pessoas/[slug]` | Sim | `apps/web/app/pt/pessoas/[slug]/page.tsx` | `revalidate = 3600` (`:23`) | Sim (`getPersonPageData`) | Nao | Sim (`:40-70`) | Sim — `Person` + `BreadcrumbList` (`:105-118,243-250`) | **PARCIAL** (filmografia real; biografia depende de `content_blocks`) | **REAL** | Nao | Nao | Sim (`RelatedNewsSection`) | Filmografia crua **nao** conta no gate anti-thin (`:20`) — precisa de blocos editoriais |
| `/pt/noticias` | Sim | `apps/web/app/pt/noticias/page.tsx` | `force-dynamic` (`:19`) | Sim (`getNewsIndexData`) | Nao | Sim (`:25-36`) | Sim — `CollectionPage` + `ItemList` + `BreadcrumbList` (`:45-72,125-132`) | **NAO IMPLEMENTADO na pratica** — nenhum worker escreve `articles`/`article_translations` (ver 6.6) | n/a (imagem de noticia so aceita path local, `news-presenter.ts:35`) | Nao | Nao | **PLACEHOLDER/vazio** | Ativar pipeline de noticias ou aceitar `noindex` permanente (`MIN_NEWS_INDEX_ITEMS = 3`, `news-presenter.ts:30`) |
| `/pt/noticias/[slug]` | Sim | `apps/web/app/pt/noticias/[slug]/page.tsx` | `force-dynamic` (`:20`) | Sim (`getNewsArticleData`) | Nao | Sim (`:34-63`) | Sim — `NewsArticle` + `BreadcrumbList` (`:90-105,194-201`) | **NAO IMPLEMENTADO na pratica** — sem artigo no banco, sempre `notFound()` (`:72`) | n/a | Nao | Nao | Sim (por definicao) | Sem fonte de artigo, a rota e um 404 garantido em producao |
| `/pt/explorar` | Sim | `apps/web/app/pt/explorar/page.tsx` | `force-dynamic` (`:45`) | Sim (4 getters, `:52-57`) | Nao (contagens sao `totalCount` real; `null` quando 0) | Sim (`:90-101`) | Sim — `CollectionPage` + `BreadcrumbList` (`:157-163,280-287`) | **REAL** | **REAL** | Nao | Nao | Sim (secao some se vazia) | — |
| `/robots.txt` | Sim | `apps/web/app/robots.ts` | **Estatico** (sem `dynamic`; consta em `prerender-manifest.json`) | Nao | Nao | e o proprio SEO | n/a | **REAL** | n/a | n/a | n/a | n/a | Ver 6.7: `Disallow: /dev/` conflita com o `noindex` de `/dev/movie-page-preview` |
| `/sitemap.xml` | Sim | `apps/web/app/sitemap.ts` | `export const dynamic = "force-dynamic"` (`:20`) | Sim (`getSitemapEntries`, `src/server/seo/sitemap-entries.ts:237`) | **Sim, no fallback** (`buildStaticSitemapEntries`, `sitemap-presenter.ts:145`) | e o proprio SEO | n/a | **PARCIAL** — reusa os mesmos gates das paginas | n/a | n/a | n/a | n/a | Ver 6.8: fallback sem banco lista rotas que o `<meta robots>` marca `noindex` |
| `/dev/movie-page-preview` | Sim | `apps/web/app/dev/movie-page-preview/page.tsx` | **Estatico** (prerender no build; sem `dynamic`, sem `revalidate`) | Nao | **Sim, 100%** | Sim (`:3-7`) — `robots: {index:false, follow:false}` + canonical autorreferente | Sim — `Movie` + `BreadcrumbList` com dados **ficticios** ("Interestelar", `:44-65`) | **PLACEHOLDER** | Nao (skeletons) | Skeletons de "Avaliacoes" | Skeletons de "Onde assistir" | Nao | **RISCO** (ver 6.7): rota acessivel em producao sem gate de ambiente/auth |
| `/filmes` | Sim | `apps/web/app/filmes/page.tsx` | Estatico (prerender); `permanentRedirect(MOVIES_INDEX_PATH)` (`:15`) → **308** | Nao | Nao | Nao (nunca emite HTML) | Nao | n/a | n/a | n/a | n/a | n/a | Sem risco de duplicata (ver 6.9). Considerar aliases equivalentes para `/pessoas`, `/noticias`, `/explorar` |
| `/series` | Sim | `apps/web/app/series/page.tsx` | Estatico; `permanentRedirect(SERIES_INDEX_PATH)` (`:15`) → **308** | Nao | Nao | Nao | Nao | n/a | n/a | n/a | n/a | n/a | idem |
| `layout.tsx` (raiz) | Sim | `apps/web/app/layout.tsx` | n/a (layout) | Nao | Nao | `metadata` estatico: `metadataBase = SITE_URL`, `title.template`, `openGraph`, `twitter` (`:20-27`) | Nao | n/a | Logo local `public/brand/*.svg` | n/a | n/a | n/a | Ver 6.10: `SITE_URL` **hardcoded** em `src/lib/site.ts:9`, nao vem de env |
| `middleware.ts` | Sim | `apps/web/middleware.ts` | Edge, roda em todas as rotas exceto `_next/static`, `_next/image`, `favicon.ico`, `api`, `media`, `brand`, `uploads` (`:60`) | Nao | Nao | n/a | n/a | Injeta `x-screena-locale` (`:45`) e **nao redireciona** — correto para a invariante 7 | n/a | n/a | n/a | n/a | Header injetado nao e consumido por ninguem (grep: zero leitores). **DEBITO** cosmetico |
| `/en/**`, `/es/**` | **NAO IMPLEMENTADO** | — | — | — | — | — | — | — | — | — | — | — | Coerente com a invariante 7. `middleware.ts:24` ja reconhece `en`/`es` como locales, mas nao ha rota; um `/en/movies/` hoje bate no `_not-found` |

---

### 6.3 Pureza de render (invariantes 3 e 4) — verificacao rota a rota

Confirmado por leitura: **nenhuma rota publica chama rede no render**. Todas as leituras passam pela camada server-only
`apps/web/src/server/*`, que usa `getPrismaClient()` de `@screena/db/server`. O guard `scripts/audit/check-render-purity.mjs`
proibe `fetch(` para hosts externos em qualquer arquivo de `apps/web` e proibe importar `@screena/db` dentro de componentes de
pagina/layout ou de client components.

Ponto sensivel, mas **conforme e documentado**: as imagens do TMDB sao **remotas** (`https://image.tmdb.org/t/p/...`). O host so
aparece em `apps/web/src/lib/tmdb-image-url.ts:20`, unico arquivo com excecao nomeada no guard
(`check-render-purity.mjs`, docblock linhas 13-19). A URL e concatenacao de string a partir do `file_path` cru ja lido do
PostgreSQL — **nao ha fetch no servidor**. O `next.config.ts` ainda documenta a politica antiga ("a rota publica so renderiza
paths locais seguros `/media/`, `/uploads/`, `/brand/`"), que **nao descreve mais o comportamento real** dos presenters.
**DEBITO / NAO BLOQUEIA PRODUCAO**: comentario obsoleto em `apps/web/next.config.ts`.

Todos os presenters aceitam **local-first, remoto como fallback**:
`entity-index-presenter.ts:179`, `movie-presenter.ts:146`, `series-presenter.ts:199`, `person-presenter.ts:221`,
`cast-presenter.ts:97`, `home-hero-presenter.ts:164-165`, `home-upcoming-presenter.ts:105`.
Excecao: `news-presenter.ts:190` (`heroImageAsset`) **so aceita path local** (`/media/`, `/uploads/`, `/brand/`) — logo, imagem
de noticia sera sempre `null` no estado atual. Isso torna seguro o `articleJsonLd.image = ${SITE_URL}${view.heroImage.src}` em
`pt/noticias/[slug]/page.tsx:104` (que quebraria se o src fosse absoluto).

---

### 6.4 A home `/pt`: o que e real e o que e fabricado

`apps/web/app/pt/page.tsx` (849 linhas) e a rota com a maior concentracao de conteudo fabricado do app.

| Bloco da home | Linha | Status | Gate de ambiente? |
|---|---|---|---|
| `HeroCarousel` (5 slides) | `:624` | **REAL** — `getHomeHeroSlides` le `movies`/`tv_shows` + slug pt-BR + crew/cast; imagem remota TMDB | n/a (fallback institucional se `[]`) |
| Nota em estrelas no hero e nos cards | `rating-stars.tsx`, `:329-339`, `:369-374`, `:408-413` | **PLACEHOLDER** — `screen_score` so e populado por `apps/admin/scripts/public-demo-seed.ts:261-323`. Nenhum servico de ingestao escreve essa coluna (grep em `services/`, `scripts/`, `packages/`: zero ocorrencias) | **Nao** — mas some sozinho porque `screen_score_display` default e `false` (`migration.sql:10`) |
| `EpisodesTicker` (faixa amarela) | `:648` | **PLACEHOLDER** — 5 series hardcoded em `_components/episodes-ticker.tsx:53-91` ("Wednesday T2·E6 · novo episodio hoje", CTA "Onde assistir NETFLIX") | **NAO. Renderiza em producao.** Ver 6.5 |
| "Destaques no The Screen" (4 grandes + 6 compactos) | `:658-689` | **PARCIAL** — cards reais, mas `fillSlots` (`:73-76`) **repete o mesmo item** para encher 10 slots e o `#N` e posicao de slot, nao ranking | Nao |
| "Avaliar" / "Marcar como assistido" | `:336-342` | **PLACEHOLDER** — `aria-disabled`, sem `onClick`, sem mutation | Nao (afordancia morta visivel em prod) |
| Chip de plataforma nos tiles de Serie | `:454-456`, `homeVisualPlatform` `:142` | **PLACEHOLDER** — ciclo deterministico sobre `["Max","Netflix","Apple TV+","Star+","Prime Video","Disney+"]` (`:133-140`), sem `watch_availability` | **Nao.** `aria-hidden`, mas visivel |
| Faixa de estatisticas | `:722-742` | **REAL** — `totalCount` do banco | condicional a `hasCounts` |
| "Em breve" | `:778-801` | **REAL quando ha upcoming** (`getHomeUpcomingMovies`, filtra `releaseDate > hoje`); mock `HOME_COMING_SOON_ITEMS` (`:153-160`) | **Sim** (`allowPlaceholders`) |
| Caixa "Google AdSense 728x90" | `:810-818` | **PLACEHOLDER** (sem script/iframe) | **Sim** (`allowPlaceholders`) |
| Noticias (1 destaque + 2x2) | `:826-846` | **PLACEHOLDER** — `HOME_FEATURED_NEWS`/`HOME_GRID_NEWS` (`:185-218`): manchetes inventadas ("Por que Oppenheimer dominou a temporada de premios") | **Sim** (`allowPlaceholders`) |
| Newsletter no rodape | `site-footer.tsx:77,196-200` | **PLACEHOLDER** (`aria-hidden`, sem form) | **Sim** (`allowPlaceholders`) |

O gate `allowHomeVisualPlaceholders()` (`src/lib/home-placeholder-governance.ts:44-51`) retorna
`nodeEnv !== "production" || flag === "1"`. Ou seja: em producao normal, ads/news-mock/coming-soon-mock/newsletter somem.
**O ticker e os chips de plataforma nao passam por esse gate.**

**DEBITO adicional (SEO)**: `fillSlots` (`pt/page.tsx:73-76`) faz o mesmo `href` aparecer varias vezes na mesma pagina quando o
catalogo e pequeno, e o rank `#1..#10` sugere um ranking editorial que nao existe. Nao viola invariante escrita, mas e sinal
enganoso para usuario e crawler. **NAO BLOQUEIA PRODUCAO**.

**DEBITO (honestidade de CTA)**: no hero, o botao "Onde assistir" (`hero-carousel.tsx:221-225`) e o botao "Ver ficha"
(`:226-229`) apontam para **o mesmo `slide.href`** (a ficha da entidade). "Onde assistir" promete uma superficie de streaming
que nao existe naquela pagina (a secao `WatchProviders` so aparece com `watch_availability`, alimentado exclusivamente por seed).

---

### 6.5 `EpisodesTicker` — o placeholder que vaza para producao

Este e o achado mais duro desta secao.

- `apps/web/app/pt/page.tsx:648` renderiza `<EpisodesTicker />` **sem nenhuma condicao**.
- `apps/web/app/_components/episodes-ticker.tsx:53-91` retorna uma lista hardcoded no modulo (`const EPISODES = episodesToday()`,
  linha `:93`), com afirmacoes factuais: *"Wednesday · T2 · E6 · novo episodio hoje"* e um CTA *"Onde assistir"* + wordmark
  *"NETFLIX"* / *"Star+"* / *"Apple TV+"* / *"Max"* / *"prime video"* com as cores de marca (`:57-89`).
- O proprio docblock do arquivo assume: *"MOCK VISUAL — DIVIDA TECNICA (...) nao ha `watch_availability` confirmada, entao
  'Onde assistir <streaming>' e 'novo episodio hoje' NAO afirmam disponibilidade/estreia real (tensiona a invariante 6)"*
  (`:15-22`).

Consequencia direta: a home `/pt` em producao **afirma disponibilidade de streaming e estreia de episodio sem nenhum dado
licenciado por tras**, e desenha wordmarks de plataformas de terceiros. Isso colide com a **invariante 6** (dado sem licenca
clara nao aparece em pagina indexavel) e com `.claude/rules/entity-writer.md` secao 3 ("Nao afirma que algo esta na Netflix /
Prime / Max sem uma `watch_availability` confirmada"). A home e a pagina de maior autoridade do dominio e e candidata a `index`.

**RISCO / BLOQUEIA PRODUCAO.**
**PROXIMO PASSO**: envolver `<EpisodesTicker />` em `allowHomeVisualPlaceholders()` (uma linha, mesmo gate do bloco de
publicidade em `pt/page.tsx:810`) ou remover o componente ate existir `watch_availability` real. Mesmo tratamento para o chip
`homeVisualPlatform` (`pt/page.tsx:454-456`).

---

### 6.6 Que rotas tem dado real hoje

Reconstrucao de quem escreve cada tabela lida pelas rotas:

| Tabela lida pelo render | Escrita por | Status |
|---|---|---|
| `movies`, `tv_shows`, `seasons`, `episodes`, `people`, `cast_members`, `crew_members`, `slugs`, `entity_translations` | `services/ingestion/bin/ingest-public-catalog.ts` (TMDB offline) + seeds | **REAL** |
| `content_blocks` | `services/entity-writer/src/persistence/content-block-store.ts:57`; `apps/admin/scripts/public-demo-seed.ts:203`; `apps/admin/scripts/staging-seed.ts:125`; `apps/web/scripts/seed-dev-movie.ts:142` | **PARCIAL** — o Entity Writer cria em `ai_generated`/`needs_review` (`content-block-store.ts:51`), e o render so aceita `human_reviewed`/`published` (`movie-indexability.ts:19`) |
| `screen_score` / `screen_score_display` | **so** `apps/admin/scripts/public-demo-seed.ts:261,274,306,321` | **PLACEHOLDER** |
| `watch_availability` | **so** `apps/admin/scripts/public-demo-seed.ts` | **PLACEHOLDER** |
| `articles`, `article_translations` | **so** scripts de validacao descartaveis (`apps/web/scripts/validate-*-real-postgres.ts`) | **NAO IMPLEMENTADO** — `services/news-ingestion/` contem **apenas um `README.md`** |
| `external_ratings` | ninguem | **NAO IMPLEMENTADO** (coerente com `.claude/rules/ratings.md`) |

Corolario pratico, importante para nao maquiar o relatorio:

- Numa base **de producao alimentada so pela ingestao TMDB** (`ingest-public-catalog.ts`), `/pt/filmes/[slug]` e
  `/pt/series/[slug]` **nao tem nenhum `content_block` publicavel** → `evaluateMovieIndexability` (`movie-indexability.ts:50`)
  devolve `noindex` para **todas** as fichas, e nenhuma ficha entra no sitemap (`sitemap-presenter.ts:294-323`).
- Nessa mesma base, **nenhuma estrela aparece** (sem `screen_score`), **nenhuma secao "Onde assistir" aparece** (sem
  `watch_availability`) e **nenhuma noticia existe** — mas o `EpisodesTicker` continua afirmando streaming.
- As unicas paginas potencialmente `index` numa base real seriam: `/pt`, `/pt/filmes`, `/pt/series`, `/pt/pessoas`,
  `/pt/explorar` (as listagens exigem `>= 3` itens; `/pt/noticias` exige `>= 3` artigos, logo fica `noindex`).

**RISCO conceitual (gate anti-thin)**: a home e o hub tratam **"secao com pelo menos 1 card"** como bloco de valor proprio
(`portal-presenter.ts:44-49,62-74`); as listagens tratam **">= 3 itens"** como sinal de nao-thin
(`entity-index-presenter.ts:340-352`). Nenhum desses e um dos 15 blocos de valor da secao 9 do `CLAUDE.md` — sao **grades de
dado cru de API**. Isto e uma leitura permissiva da invariante 5. Nao chamo de violacao (o codigo passa pelo evaluator canonico
`@screena/seo`), mas e uma decisao que **precisa de decisao humana explicita** antes de indexacao em massa.
**NAO BLOQUEIA PRODUCAO**, mas e o tipo de coisa que o Google penaliza.

---

### 6.7 `/dev/movie-page-preview` — investigacao dedicada

**Esta acessivel em producao? Sim.**

- Nao ha gate de ambiente no arquivo (`apps/web/app/dev/movie-page-preview/page.tsx` — 220 linhas, nenhuma leitura de
  `process.env`, nenhum `notFound()` condicional).
- Nao ha auth: `apps/web/middleware.ts` so injeta um header, nunca bloqueia.
- O manifesto de build (`.next/prerender-manifest.json`) lista `/dev/movie-page-preview` como rota **pre-renderizada estatica**,
  ou seja, o HTML e gerado no build e servido a qualquer visitante.

**Tem noindex? Sim** — `robots: { index: false, follow: false }` (`:5`).

**Entao qual e o problema?** Tres, e eles se somam:

1. **`Disallow: /dev/` cancela o `noindex`.** `apps/web/app/robots.ts:25` bloqueia `/dev/` no `robots.txt`. Um crawler que
   respeita `Disallow` **nunca busca a pagina e portanto nunca le a meta tag `noindex`**. Se a URL for descoberta por link
   externo, o Google pode indexa-la como URL-only ("Indexada, porem bloqueada pelo robots.txt"). O padrao correto e o oposto:
   **permitir o crawl e deixar o `noindex` fazer o trabalho** — que e exatamente o principio que o proprio docblock do
   `robots.ts:9-11` enuncia e depois contraria para `/dev/`.
2. **JSON-LD `Movie` ficticio.** A pagina emite structured data completo para um filme chamado **"Interestelar" (2014)**
   (`:44-50`), com `url: "/dev/movie-page-preview/"`. Emitir schema `Movie` sobre conteudo declaradamente ficticio
   (`:17-31`: *"Texto ficticio de preview"*) e poluicao de dados estruturados no dominio canonico.
3. **Canonical autorreferente para a rota de dev** (`:6`). Combinado com o `metadataBase` do layout
   (`layout.tsx:21`), o canonical resolvido e `https://thescreen.media/dev/movie-page-preview/` — uma URL de preview interno
   se declarando canonica no dominio publico.

Ha ainda um detalhe estetico relevante: essa rota e a **unica** superficie que desenha as colunas "Avaliacoes" (com skeletons
de logo/nota, `:101-117`) e "Onde assistir" (chips, `:119-135`). A rota real de filme deliberadamente **nao** desenha esses
headings vazios (comentario em `pt/filmes/[slug]/page.tsx:143-148`). Ou seja, a preview e um mock de features inexistentes,
publicado no dominio de producao.

**RISCO — recomendo BLOQUEIA PRODUCAO** (custo de correcao: uma linha).
**PROXIMO PASSO**: `if (process.env.NODE_ENV === "production") notFound();` no topo do componente (ou mover a rota para um
Storybook/route group nao compilado), e remover `/dev/` do `Disallow` para que o `noindex` seja legivel enquanto a rota existir.
Nao remover o `noindex`.

---

### 6.8 `/robots.txt` e `/sitemap.xml`

`apps/web/app/robots.ts` (30 linhas), **estatico**:

```
User-agent: *
Allow: /
Disallow: /api/   (nenhuma rota /api existe hoje)
Disallow: /dev/   (ver 6.7)
Disallow: /admin/ (o admin e outro app, apps/admin; nao ha /admin em apps/web)
Sitemap: https://thescreen.media/sitemap.xml
```

`/_next/` deliberadamente nao e bloqueado (`robots.ts:14-15`) — correto.

`apps/web/app/sitemap.ts` (`force-dynamic`, `:20`) delega a `getSitemapEntries()`
(`src/server/seo/sitemap-entries.ts:237`), que le PostgreSQL e passa o snapshot ao presenter puro `buildSitemapEntries`
(`src/lib/sitemap-presenter.ts:233`). O presenter **reaplica os mesmos evaluators das paginas** — sitemap e `<meta robots>` nao
divergem no caminho feliz. So `/pt/...` entra; nunca `/en`, `/es`, `/admin`, `/dev`, `/api` (`sitemap-presenter.ts:8-9`).

**RISCO (SEO, contido)**: o `catch` em `sitemap-entries.ts:248-253` cai em `buildStaticSitemapEntries()`, que lista as 6 rotas
estaticas (`HOME`, `filmes`, `series`, `pessoas`, `noticias`, `explorar`) **sem nenhum gate**. Com PostgreSQL indisponivel, o
sitemap anuncia `/pt/noticias/` (que renderiza `noindex`) e as listagens vazias. O codigo assume isso explicitamente
(`sitemap-presenter.ts:21-26`), mas contraria a regra dura de `.claude/rules/seo.md` secao 5 ("Sitemap e meta tag **nunca**
podem discordar"). **NAO BLOQUEIA PRODUCAO** (so acontece em outage), mas e uma divergencia registrada.

Nao existe `sitemap_index.xml`, nem `sitemap-pt.xml`/`sitemap-en.xml`/`sitemap-es.xml` segmentados — ha um unico
`/sitemap.xml`. Como so pt-BR publica, isso e funcionalmente equivalente hoje, mas **diverge do que `.claude/rules/seo.md`
secao 5 prescreve**. **DEBITO / NAO BLOQUEIA PRODUCAO**.

Nao ha `hreflang` em nenhuma rota (grep: zero `alternates.languages`). Correto: sem contraparte publicada, nao se declara
alternate (`.claude/rules/i18n.md` secao 5).

---

### 6.9 `/filmes` e `/series` sem prefixo: sao duplicatas?

**Nao.** Ambos sao **redirects 308 permanentes**, nao paginas:

```ts
// apps/web/app/filmes/page.tsx:14-16
export default function MoviesAliasPage(): never {
  permanentRedirect(MOVIES_INDEX_PATH);   // "/pt/filmes/"
}
```
```ts
// apps/web/app/series/page.tsx:14-16
export default function SeriesAliasPage(): never {
  permanentRedirect(SERIES_INDEX_PATH);   // "/pt/series/"
}
```

`permanentRedirect` do Next emite **308** (nao 301, mas equivalente para o Google, preservando o metodo). O componente nunca
retorna JSX — nao ha HTML, nao ha `<meta robots>`, nao ha canonical, nao ha JSON-LD. **Nao ha risco de conteudo duplicado nem
de canonical concorrente.** Os aliases tambem nao entram no sitemap (`STATIC_ROUTES` em `sitemap-presenter.ts:114-121` lista so
os `/pt/...`).

Tampouco sao "redirect de idioma": o destino e fixo, nao depende de `Accept-Language`/geo-IP (o docblock deixa isso explicito,
`filmes/page.tsx:10-12`), portanto respeitam `.claude/rules/seo.md` secao 8.

**Assimetria a registrar (DEBITO / NAO BLOQUEIA PRODUCAO)**: existem aliases so para `filmes` e `series`. `/pessoas`,
`/noticias` e `/explorar` **nao tem alias** e retornam 404 (`_not-found`). E uma inconsistencia de UX/link-rot, nao um risco de
SEO.

---

### 6.10 `layout.tsx`, `SITE_URL` e o dominio canonico

`apps/web/app/layout.tsx:20-27` define `metadataBase: new URL(SITE_URL)`, `lang="pt-BR"` no `<html>`, `openGraph.locale = pt_BR`,
`twitter.card = summary`. Sem `og:image` (decisao explicita, `:23-24`). Renderiza `SiteHeader` + `children` + `SiteFooter`.

`SITE_URL` e uma **constante hardcoded**:

```ts
// apps/web/src/lib/site.ts:9
export const SITE_URL = "https://thescreen.media";
```

Nao ha leitura de `process.env.NEXT_PUBLIC_SITE_URL` nem equivalente em lugar nenhum de `apps/web`.

**RISCO / BLOQUEIA PRODUCAO** (confirmando o que o relatorio de status pos-EasyPanel ja apontava): enquanto o app estiver
servido por um dominio temporario (EasyPanel/IP/subdominio de staging), **todas** as paginas emitem
`<link rel="canonical" href="https://thescreen.media/...">` e o `robots.txt` publica
`Sitemap: https://thescreen.media/sitemap.xml`. Isso e um canonical cross-domain apontando para um dominio que talvez ainda nao
sirva o conteudo — e, no sentido inverso, o dominio temporario e crawlavel (`Allow: /` em `robots.ts:24`) e pode ser indexado.

**PROXIMO PASSO**: (a) `SITE_URL` a partir de env com fallback para `https://thescreen.media`; (b) enquanto o dominio canonico
nao estiver ativo, forcar `X-Robots-Tag: noindex` no proxy do ambiente temporario (ou um `Disallow: /` condicional).

---

### 6.11 Deriva de documentacao

`apps/web/app/README.md` documenta como "Rotas do MVP" um conjunto que **em boa parte nao existe**:

| Rota documentada | Existe? |
|---|---|
| `/pt/filmes/`, `/pt/filmes/{slug}/`, `/pt/series/`, `/pt/series/{slug}/`, `/pt/pessoas/{slug}/`, `/pt/noticias/{slug}/` | Sim |
| `/pt/filmes/{slug}/onde-assistir/` | **NAO IMPLEMENTADO** |
| `/pt/filmes/{slug}/elenco/` | **NAO IMPLEMENTADO** |
| `/pt/filmes/{slug}/avaliacoes/` | **NAO IMPLEMENTADO** |
| `/pt/series/{slug}/temporada-{n}/` | **NAO IMPLEMENTADO** (schema `TVSeason` nunca e emitido) |
| `/pt/series/{slug}/onde-assistir/` | **NAO IMPLEMENTADO** |
| `/pt/streaming/netflix/melhores-filmes/` | **NAO IMPLEMENTADO** |
| `/pt/onde-assistir/{slug}/` | **NAO IMPLEMENTADO** |

Alem disso o README **nao menciona** `/pt` (home), `/pt/explorar`, `/pt/pessoas` (listagem), `/pt/noticias` (listagem),
`/filmes`, `/series` nem `/dev/movie-page-preview`. **DEBITO / NAO BLOQUEIA PRODUCAO** — mas e a documentacao que um agente le
primeiro ao mexer em rotas, e ela mente por omissao e por excesso.

Duplicacao de constantes de rota (todas deveriam vir de `src/lib/site.ts`):
`pt/series/[slug]/page.tsx:21` (`SERIES_INDEX_PATH`), `pt/pessoas/[slug]/page.tsx:25` (`PESSOAS_INDEX_PATH`),
`pt/noticias/[slug]/page.tsx:22` (`NEWS_INDEX_PATH`), e literais `"/pt/"` espalhados em breadcrumbs
(`pt/filmes/[slug]/page.tsx:106,134`, `pt/series/[slug]/page.tsx:89,118`, etc.).

---

### 6.12 O que NAO foi possivel confirmar

- **NAO FOI POSSIVEL CONFIRMAR** o comportamento real de `https://thescreen.media/` (raiz) em producao. No codigo nao ha
  `app/page.tsx`, nao ha `redirects()` em `next.config.ts` e nao ha `middleware` que redirecione. Se existir um redirect no
  reverse proxy (CloudPanel/EasyPanel/Nginx), ele nao esta versionado neste repositorio — `scripts/deploy/` contem apenas um
  `README.md` e nao ha `Dockerfile`/`nixpacks.toml` no repo. Falta acesso a configuracao de infraestrutura.
- **NAO FOI POSSIVEL CONFIRMAR** o conteudo real do banco de producao (quantos filmes/series/pessoas com slug pt-BR, quantos
  `content_blocks` `published`). Todas as afirmacoes sobre "o que a home mostraria em producao" derivam de **quem escreve cada
  tabela no codigo**, nao de uma consulta. Se alguem rodou `public-demo-seed.ts` contra a base de producao, notas e "onde
  assistir" apareceriam la — e seriam dados de demonstracao servidos como reais.
- **NAO FOI POSSIVEL CONFIRMAR** se o status `_not-found` e servido com HTTP 404 real (e nao 200) — depende de o app rodar em
  `next start` padrao; nao ha `not-found.tsx` customizado que pudesse alterar isso.
- **NAO FOI POSSIVEL CONFIRMAR** o estado da suite de testes: nenhum teste foi executado nesta auditoria (regra de somente
  leitura). Existe `tests/web/public-navigation.test.ts` cobrindo "nenhum link morto no header" e "portais sem busca/ratings/
  streaming fake" — nao verifiquei se ele passa hoje, nem se o assert de "streaming fake" cobre o `EpisodesTicker` (ele checa o
  fonte de `pt/page.tsx`, e o mock esta em `_components/episodes-ticker.tsx`, provavelmente fora do escopo do assert).

---

### 6.13 Sintese de criticidade

**BLOQUEIA PRODUCAO**

1. `EpisodesTicker` renderiza sem gate na home (`pt/page.tsx:648`) e afirma streaming/estreia sem `watch_availability` —
   invariantes 6 e (pela exibicao de wordmarks de terceiros) higiene legal.
2. `SITE_URL` hardcoded (`src/lib/site.ts:9`) — canonical/sitemap cross-domain enquanto o dominio final nao esta ativo;
   ambiente temporario indexavel.
3. `/dev/movie-page-preview` servido publicamente com JSON-LD `Movie` ficticio e canonical no dominio de producao, com o
   `noindex` neutralizado pelo `Disallow: /dev/`.
4. `/` (raiz) retorna 404 — nao ha `app/page.tsx` nem redirect versionado.

**NAO BLOQUEIA PRODUCAO (mas registrar)**

5. Estrelas na home vem de `screen_score`, populado apenas pelo seed demo → base real fica sem nota (nao e bug de codigo, e
   ausencia de pipeline).
6. Chip de plataforma nos tiles de serie (`homeVisualPlatform`) e placeholder nao gateado.
7. `fillSlots` duplica cards e desenha `#1..#10` como se fosse ranking.
8. Botao "Onde assistir" do hero aponta para a mesma URL de "Ver ficha".
9. Gate anti-thin de portais/listagens conta grade de dado cru como bloco de valor.
10. Sitemap unico (sem `sitemap_index.xml` por idioma) e fallback estatico que pode discordar do `<meta robots>`.
11. `apps/web/app/README.md` e `next.config.ts` descrevem uma arquitetura de rotas/imagens que nao e mais a atual.
12. Constantes de rota reduplicadas em 3 arquivos de pagina.
13. `middleware.ts` injeta `x-screena-locale` que ninguem consome.


---

## Parte 7 — Home `/pt` completa

A home publica pt-BR e um **server component puro** (`apps/web/app/pt/page.tsx:521`) com `export const dynamic = "force-dynamic"` (`apps/web/app/pt/page.tsx:60`). Ela le exclusivamente PostgreSQL via Prisma (`getMovieIndexData`/`getSeriesIndexData`/`getPersonIndexData`/`getNewsIndexData`/`getHomeHeroSlides`/`getHomeUpcomingMovies`), sem nenhuma chamada de rede no caminho de render — invariantes 3 e 4 preservadas. As imagens sao URLs **remotas** do CDN do TMDB (`https://image.tmdb.org/t/p/...`) montadas por concatenacao de string a partir do `file_path` cru guardado no banco (`apps/web/src/lib/tmdb-image-url.ts:40`), o que nao e chamada de API, mas **e** dependencia de terceiro no HTML renderizado.

O `SiteHeader` e o `SiteFooter` vem do layout raiz (`apps/web/app/layout.tsx:37` e `apps/web/app/layout.tsx:39`), nao da home.

---

### 7.1 Inventario bloco a bloco

| # | Bloco | Componente | arquivo:linha | Fonte de dados exata | Status | Aparece em producao? | Gate de ambiente |
|---|---|---|---|---|---|---|---|
| 1 | Header | `SiteHeader` | `apps/web/app/_components/site-header.tsx:34` (render em `apps/web/app/layout.tsx:37`) | Constantes puras `NAV_ITEMS` (`apps/web/src/lib/navigation.ts:28`) + SVGs locais em `/brand/` | **REAL** (nav) / **PARCIAL** (busca e link, nao campo) | Sim | Nao |
| 2 | Hero / carrossel | `HeroCarousel` | `apps/web/app/_components/hero-carousel.tsx:68`, render em `apps/web/app/pt/page.tsx:624` | `movies`/`tv_shows` + `slugs` (canonico pt-BR) + `entity_translations` + `crew_members` + `cast_members` (`apps/web/src/server/home-hero.ts:225`) | **REAL** (titulo/ano/slug/imagem/diretor/elenco/sinopse) · **PLACEHOLDER de fato ausente** para estrelas e classificacao com catalogo TMDB real | Sim | Nao |
| 2b | Hero institucional (fallback) | inline `<section className="sc-hero--institutional">` | `apps/web/app/pt/page.tsx:627`–`641` | Copy hardcoded (`HOME_DESCRIPTION`, `apps/web/app/pt/page.tsx:63`) | **PLACEHOLDER honesto** (copy institucional, sem dado fabricado) | Sim, so se `heroSlides.length === 0` | Nao |
| 3 | Ticker amarelo de episodios | `EpisodesTicker` | `apps/web/app/_components/episodes-ticker.tsx:95`, render em `apps/web/app/pt/page.tsx:648` | **Array literal** `episodesToday()` (`apps/web/app/_components/episodes-ticker.tsx:53`–`91`) | **PLACEHOLDER** | **SIM — vaza para producao** | **NAO TEM GATE** |
| 4 | Destaques no The Screen (4 grandes + 6 compactos) | `HomeV4BigCard` / `HomeV4CompactCard` | `apps/web/app/pt/page.tsx:313`, `:355`, secao em `:658`–`689` | `movies`+`tv_shows` reais (via `entity-index-presenter`), notas de `movies.screen_score`/`tv_shows.screen_score` | **PARCIAL** — cards reais, mas `#N` (rank) e posicao de slot fabricada, `fillSlots` repete itens, `Avaliar`/`Marcar como assistido` sao affordances mortas | Sim | Nao |
| 5 | Filmes em destaque (grid 6) | `HomeV4PosterCard` | `apps/web/app/pt/page.tsx:390`, secao em `:695`–`717` | `movies` + `slugs` + `entity_translations` + `movies.poster_path` (`apps/web/src/server/entity-indexes.ts:94`) | **REAL** (com `fillSlots` repetindo se houver < 6 filmes) | Sim | Nao |
| 6 | Catalogo / estatisticas | inline `home-v4-stats-band` | `apps/web/app/pt/page.tsx:722`–`742` | `view.totalCount` de filmes/series/pessoas (`apps/web/app/pt/page.tsx:98`–`102`) | **REAL** | Sim (se algum count > 0) | Nao |
| 7 | Series em destaque (grid 6 tiles) | `HomeV4SeriesTile` | `apps/web/app/pt/page.tsx:426`, secao em `:748`–`769` | `tv_shows` reais **+ chip de plataforma hardcoded** (`HOME_VISUAL_PLATFORMS`, `apps/web/app/pt/page.tsx:133`) | **PARCIAL** (card real) / **PLACEHOLDER** (chip de streaming) | **SIM — o chip vaza para producao** | **NAO TEM GATE** |
| 8 | Em breve | `ComingSoonRail` | `apps/web/app/_components/coming-soon-rail.tsx:36`, secao em `apps/web/app/pt/page.tsx:778`–`801` | Real: `movies.release_date > hoje` + slug pt-BR (`apps/web/src/server/home-upcoming.ts:37`). Fallback: `HOME_COMING_SOON_ITEMS` (`apps/web/app/pt/page.tsx:153`) | **REAL** quando ha upcoming ingerido; **PLACEHOLDER** no fallback | Real: sim. Mock: **nao** | Sim (`allowHomeVisualPlaceholders`) |
| 9 | Publicidade (leaderboard) | inline `home-v4-ad-placeholder` | `apps/web/app/pt/page.tsx:810`–`818` | Hardcoded ("Google AdSense · 728×90") | **PLACEHOLDER** | **Nao** | Sim (`allowHomeVisualPlaceholders`) |
| 10 | Noticias (1 destaque + grade 2×2) | `HomeV4NewsFeature` / `HomeV4NewsMiniCard` | `apps/web/app/pt/page.tsx:468`, `:497`, secao em `:826`–`846` | Real: `article_translations` + `articles` com licenca/`review_status` publicavel (`apps/web/src/server/news-pages.ts:59`). Fallback: `HOME_FEATURED_NEWS`/`HOME_GRID_NEWS` (`apps/web/app/pt/page.tsx:185`, `:193`) | **PLACEHOLDER na pratica** (nao ha pipeline de noticias: `services/news-ingestion/` contem so `README.md`) | Real: nunca (hoje). Mock: **nao** | Sim (`allowHomeVisualPlaceholders`) |
| 11 | Newsletter | dentro de `SiteFooter` | `apps/web/app/_components/site-footer.tsx:166`–`203` | Hardcoded; pseudo-form com `<span>` `aria-hidden` | **PLACEHOLDER** (degradacao honesta em prod: "Newsletter em breve") | Bloco existe, o pseudo-form **nao** | Sim (`allowHomeVisualPlaceholders`) |
| 12 | Footer | `SiteFooter` | `apps/web/app/_components/site-footer.tsx:74` (render em `apps/web/app/layout.tsx:39`) | Constantes hardcoded (`CATALOG_COLUMNS`, `INSTITUTIONAL_ITEMS`, `LEGAL_ITEMS`) + atribuicao TMDB | **PARCIAL** — links de catalogo apontam ao indice pai; rotulos de filtro ("Top 250", "Em breve", "Mais vistos") sao rotas inexistentes disfarcadas de link | Sim | Parcial (so a newsletter) |

---

### 7.2 O gate de ambiente, exatamente

`apps/web/src/lib/home-placeholder-governance.ts:44`–`51`:

```
export function allowHomeVisualPlaceholders(
  env: PlaceholderEnv = {
    nodeEnv: process.env.NODE_ENV,
    flag: process.env.SCREEN_HOME_VISUAL_PLACEHOLDERS,
  },
): boolean {
  return env.nodeEnv !== "production" || env.flag === "1";
}
```

- **Liga** o placeholder: `NODE_ENV !== "production"` (dev, preview, test) **OU** `SCREEN_HOME_VISUAL_PLACEHOLDERS === "1"` (string exata `"1"`; `"true"`, `"yes"`, `1` numerico nao ligam).
- **Desliga**: `NODE_ENV === "production"` **e** a flag ausente/diferente de `"1"`.
- A flag **nao** e `NEXT_PUBLIC_*` — a decisao e server-side e nao vaza para o bundle. Coberto por `tests/web/home-placeholder-governance.test.ts`.

**Cobertura do gate (o ponto critico):** `allowHomeVisualPlaceholders()` e chamado em exatamente **dois lugares**: `apps/web/app/pt/page.tsx:531` e `apps/web/app/_components/site-footer.tsx:77`. Na home ele gateia apenas tres blocos: `comingSoonItems` (fallback mock, `:609`–`613`), o bloco de publicidade (`:810`) e a secao de Noticias (`:826`).

**Nao estao sob gate nenhum:**

1. `<EpisodesTicker />` (`apps/web/app/pt/page.tsx:648`) — renderizado incondicionalmente.
2. O chip de plataforma dos tiles de Series (`apps/web/app/pt/page.tsx:764` chamando `homeVisualPlatform(index)`).
3. Os rank badges `#1`…`#10` dos Destaques (`apps/web/app/pt/page.tsx:674`, `:684`).
4. As affordances mortas `☆ Avaliar` e `✓ Marcar como assistido` (`apps/web/app/pt/page.tsx:336`, `:340`).
5. A repeticao ciclica de itens por `fillSlots` (`apps/web/app/pt/page.tsx:73`–`76`).

---

### 7.3 Hero — auditoria profunda

**E carrossel real?** Sim, tecnicamente completo. `apps/web/app/_components/hero-carousel.tsx`:

| Recurso | Implementado? | Evidencia |
|---|---|---|
| Slides empilhados | Sim | Todos os slides sao renderizados no DOM (`:155` `slides.map`); CSS `position:absolute; inset:0; opacity:0` e `[data-active="true"] { opacity: 1 }` (`apps/web/app/globals.css:1085`–`1097`) |
| Crossfade | Sim | `transition: opacity 0.7s ease` (`apps/web/app/globals.css:1093`) |
| Autoplay | Sim, 6000 ms | `AUTOPLAY_MS = 6000` (`:41`); `useEffect` com `setTimeout` reagendado a cada `index` (`:95`–`101`) |
| Setas ‹ › | Sim | `:262`–`277`, so quando `count > 1` |
| Dots | Sim | `:279`–`292`, `role="tablist"` + `aria-selected` |
| Teclado (setas) | Sim | `onKeyDown` no `<section>` (`:103`–`115`, ligado em `:147`) |
| Swipe | Sim | `onTouchStart`/`onTouchEnd`, `SWIPE_THRESHOLD = 40` px (`:44`, `:117`–`133`) |
| Pausa em hover/foco | Sim | `onMouseEnter/onMouseLeave/onFocus/onBlur` -> `setPaused` (`:148`–`151`) |
| `prefers-reduced-motion` | Sim | `matchMedia` reativo com listener (`:85`–`91`); autoplay curto-circuita se `reduceMotion` (`:96`); CSS `transition: none` (`apps/web/app/globals.css:1098`–`1103`) |

Ressalva de a11y: o `<section>` recebe `onKeyDown` mas **nao tem `tabIndex`**, entao o teclado so funciona quando o foco esta em um descendente focavel (setas, dots, links). Nao ha `aria-live` para anunciar a troca de slide (o ticker amarelo tem; o hero nao).

**De onde vem a imagem.** `HeroSlide.imageUrl` e resolvido por `resolveHeroImage()` (`apps/web/src/lib/home-hero-presenter.ts:159`–`167`): backdrop 16:9 em `w1280` preferido, senao poster em `w780`, ambos passando pelo helper governado `buildTmdbImageUrl` (`apps/web/src/lib/tmdb-image-url.ts:40`) que concatena `https://image.tmdb.org/t/p/{size}{file_path}`. O `file_path` cru vem de `movies.backdrop_path`/`movies.poster_path` e `tv_shows.backdrop_path`/`tv_shows.poster_path` (`apps/web/src/server/home-hero.ts:126`–`127`, `:177`–`178`). Sem `file_path` valido -> `null` -> `sc-hero__wash` (gradiente por vertical). Nenhuma imagem e salva no servidor.

**Quantos `<h1>` a pagina emite.** Exatamente **1**. `apps/web/app/_components/hero-carousel.tsx:196`–`200`: apenas o slide ativo usa `<h1 className="sc-hero__title">`; os demais renderizam `<p className="sc-hero__title">` com o mesmo texto. O fallback institucional (`apps/web/app/pt/page.tsx:635`) tambem emite um unico `<h1>`, e os dois caminhos sao mutuamente exclusivos. Nenhum outro componente da home emite `h1` (secoes usam `h2`, cards de noticia usam `h3`/`h4`, cards do trilho usam `h3`). O layout raiz nao emite `h1`.

**RISCO (SEO, nao bloqueia producao):** o `<h1>` da home e o **titulo de um filme** (ex.: "Duna"), nao uma descricao da home. Pior: ele **muda a cada 6 s** no cliente conforme o autoplay avanca. O `<h1>` renderizado no servidor e sempre o primeiro slide. Isso e legivel por crawler como "a home /pt e sobre <filme X>".

**Selecao de slides.** `apps/web/src/server/home-hero.ts:233`: `[...movies, ...series].slice(0, HOME_HERO_SLIDE_LIMIT)` com `HOME_HERO_SLIDE_LIMIT = 5` (`:27`). Filmes vem **sempre antes** de series. **DEBITO:** com >= 5 filmes com slug canonico pt-BR no banco (cenario garantido pos-ingestao TMDB), **nenhuma serie entra no hero** — o eyebrow "Serie em destaque" (`apps/web/src/lib/home-hero-presenter.ts:225`) e codigo morto na pratica, e o acento verde nunca aparece no hero.

**Dependencias do hero:**

- TMDB: sim (imagem, titulo original, `release_date`, `poster_path`/`backdrop_path`).
- Screen Score: sim, para as estrelas (`RatingStars`, `apps/web/app/_components/rating-stars.tsx:30`), gateadas por `resolveHeroRating()` (`apps/web/src/lib/home-hero-presenter.ts:141`) que exige `screen_score_display = true` **e** `screen_score_scale === 5`.
- Streaming availability: **nao** — mas o botao primario diz **"Onde assistir"** (`apps/web/app/_components/hero-carousel.tsx:224`) e aponta para `slide.href` (a ficha da entidade), nao para uma oferta de streaming. Ver 7.5.
- Noticias: nao.

**Consequencia critica do Screen Score.** `screen_score_display` tem `@default(false)` no schema (`packages/db/prisma/schema.prisma:250` e `:288`). O unico codigo do repositorio que grava `screenScore`/`screenScoreScale`/`screenScoreDisplay` e o **seed demo do admin** (`apps/admin/scripts/public-demo-seed.ts:260`–`263`, `:305`–`308`), com valores literais no plano (`apps/admin/scripts/public-demo-seed-plan.ts:239` `screenScore: 4`, `:268` `3.5`, `:296` `4.5`, …). A ingestao TMDB (`services/ingestion/`) **nunca** escreve esses campos — `grep -rl "screenScore" services/ api-clients/` nao retorna nada. Idem `certification`.

Portanto, **numa base populada so pela ingestao TMDB real (EasyPanel), o hero nunca mostra estrelas nem classificacao indicativa**, e os cards da home nunca mostram nota (`resolveCardScreenScore`, `apps/web/src/lib/entity-index-presenter.ts:201`, exige `screenScoreDisplay === true`). As estrelas so aparecem na base de seed demo. Isso e o oposto de um risco de invariante — e um risco de **produto**: o design v4 assume estrelas em todo card, e a base real nao as tem.

---

### 7.4 Ticker amarelo — auditoria profunda

Fonte de dados: **array literal em codigo cliente**, `episodesToday()` em `apps/web/app/_components/episodes-ticker.tsx:53`–`91`, congelado em `const EPISODES = episodesToday()` (`:93`). Cinco entradas hardcoded: `Wednesday T2·E6 / NETFLIX`, `The Bear T3·E4 / Star+`, `Severance T2·E5 / Apple TV+`, `The Last of Us T2·E3 / Max`, `The Boys T4·E7 / prime video`.

O que ele **afirma ao usuario final**:

1. `"<Serie> · T2 · E6 · novo episodio hoje"` (`apps/web/app/_components/episodes-ticker.tsx:130`–`135`) — afirmacao de **estreia de episodio na data de hoje**, sem nenhuma linha de `episodes`/`seasons` por tras. Nenhuma dessas series precisa sequer existir no catalogo.
2. `"Onde assistir"` + wordmark do streaming colorido com a cor da marca (`:157`–`165`, `logoColor: "#E50914"` para a Netflix etc.) — afirmacao de **disponibilidade em plataforma nomeada**, sem uma unica linha de `watch_availability`, sem `provider`, sem `country`, sem `display_allowed`, sem `license_status`.
3. Badge `NOVO` e `aria-live="polite"` (`:128`–`129`) — ou seja, a afirmacao falsa e ativamente anunciada a leitores de tela.

Mitigacao existente: os `href` apontam para `SERIES_INDEX_PATH` (`/pt/series/`), nao para slugs que dariam 404 (`:24`–`27`). Isso resolve o link quebrado, **nao** a afirmacao falsa.

**Isso vaza para producao?** Sim. `<EpisodesTicker />` esta em `apps/web/app/pt/page.tsx:648`, **fora** de qualquer condicional. `allowHomeVisualPlaceholders()` e calculado em `:531` e nunca aplicado a ele. O comentario do proprio arquivo admite: *"Antes de producao/indexacao, trocar por dado real governado ... ou remover o componente"* (`apps/web/app/_components/episodes-ticker.tsx:15`–`22`). A divida esta documentada e **nao foi paga**.

**Qual invariante fere.**

- **Invariante 6** (dado sem licenca clara nao aparece em pagina indexavel): frontal. `watch_availability` nao existe para esses itens; nao ha `license_status`, nao ha `display_allowed`, nao ha atribuicao. O `.claude/rules/entity-writer.md` §3 e explicito: *"Nao afirma que algo 'esta na Netflix / Prime / Max' sem uma `watch_availability` confirmada no payload, com pais e `display_allowed` validos."* A regra vale para o writer, mas o principio ("nao afirmar streaming sem availability") e do produto — e a UI o viola diretamente.
- **`.claude/rules/seo.md` §12**: *"'Onde assistir' lista **apenas** disponibilidade oficial/licenciada (`watch_availability` com provider legitimo)."* — violado.
- **Invariante 8 (pirataria):** **NAO** ferida. Nao ha torrent/IPTV/player/embed. O texto so nomeia servicos legais.
- Risco adicional nao coberto pelas invariantes: **marca de terceiros** — wordmarks textuais "NETFLIX", "Apple TV+", "Max", "prime video" com as cores oficiais, usados para sugerir disponibilidade inexistente. Isso e exposicao legal (publicidade enganosa / uso indevido de marca), nao so SEO.
- E ainda: a home e **indexavel** quando >= 2 secoes tem dado real (ver 7.7). Um crawler que indexe `/pt/` indexa junto a afirmacao "Wednesday T2·E6 novo episodio hoje — Onde assistir NETFLIX".

**RISCO — BLOQUEIA PRODUCAO.** **PROXIMO PASSO:** remover `<EpisodesTicker />` de `apps/web/app/pt/page.tsx:648`, ou no minimo envolve-lo em `{allowPlaceholders ? <EpisodesTicker /> : null}` como primeira medida (uma linha), e so depois substituir por dado de `watch_availability` licenciado.

---

### 7.5 Outras afirmacoes de streaming sem `watch_availability`

| Onde | Texto exibido | Fonte | Gate | Veredito |
|---|---|---|---|---|
| Ticker | "Onde assistir NETFLIX" | literal | nenhum | **RISCO — BLOQUEIA PRODUCAO** (invariante 6) |
| Tile de serie | chip `Max` / `Netflix` / `Apple TV+` / `Star+` / `Prime Video` / `Disney+`, ciclado por indice de slot (`homeVisualPlatform`, `apps/web/app/pt/page.tsx:142`) | literal `HOME_VISUAL_PLATFORMS` (`:133`) | nenhum | **RISCO — BLOQUEIA PRODUCAO** (invariante 6). Esta `aria-hidden="true"` (`:454`), o que esconde de leitores de tela mas **nao** do usuario vidente nem do crawler visual. O chip fica **sobre o poster da serie real**, o que amarra a afirmacao a uma entidade concreta — e pior que o ticker nesse aspecto |
| Hero | botao primario "Onde assistir" -> `/pt/filmes/{slug}/` | rota real | n/a | **PARCIAL / NAO BLOQUEIA** — nao nomeia plataforma; e um label enganoso que leva a ficha. Ver se a ficha tem bloco "onde assistir" com dado real |
| Footer | tagline "Filmes, series, pessoas, noticias e **onde assistir** — em um so lugar." (`apps/web/app/_components/site-footer.tsx:97`) | literal | nenhum | **NAO BLOQUEIA** — promessa de produto, nao afirmacao factual sobre um titulo |

---

### 7.6 Estatisticas de catalogo — reais ou hardcoded?

**REAIS.** `apps/web/app/pt/page.tsx:98`–`102`:

```
const counts = {
  movies: movies.view.totalCount,
  series: series.view.totalCount,
  people: people.view.totalCount,
};
```

`totalCount` vem de `buildIndexView()` (`apps/web/src/lib/entity-index-presenter.ts:244`): `valid.length`, ou seja, o numero de entidades que (a) tem `slug` canonico pt-BR em `slugs` e (b) tem titulo/nome nao vazio. Os dados sao lidos de `prisma.movie.findMany`/`tvShow.findMany`/`person.findMany` em `apps/web/src/server/entity-indexes.ts:101`, `:145`, `:191`.

Ressalvas honestas:

- **Nao e `COUNT(*)`.** E `findMany()` sem `take`, materializando **todas** as linhas com slug canonico em memoria a cada request (a home e `force-dynamic`). Com um catalogo de milhares de titulos isso e um **DEBITO de performance** real — tres full scans + traducoes por pageview. **NAO BLOQUEIA PRODUCAO** hoje (catalogo pequeno), bloqueia em escala.
- O rotulo e "NO CATALOGO DO SCREEN" (`apps/web/app/pt/page.tsx:727`) e nao promete watchlist/assistidos/avaliacoes. Honesto.
- A secao inteira e omitida se todos os counts forem zero (`hasCounts`, `apps/web/app/pt/page.tsx:525`, condicional em `:722`).
- Nenhum numero de "usuarios", "reviews" ou "avaliacoes" e exibido. Nao ha numero fabricado.

---

### 7.7 Indexabilidade da home e o gate anti-thin

`generateMetadata()` (`apps/web/app/pt/page.tsx:113`–`124`) emite `robots: index,follow` quando `evaluatePortalIndexability(...).decision === "index"`.

`evaluatePortalIndexability` (`apps/web/src/lib/portal-presenter.ts:62`–`75`) chama o gate canonico de `@screena/seo` com:

```
valueBlocksCount: count,                 // secoes populadas: filmes, series, noticias
thinContentScore: count >= 2 ? 0 : 1,
hasReliableStructuredData: true,         // <-- HARDCODED
displayedRatings: [],                    // <-- HARDCODED
reviewStatusOk: true,                    // <-- HARDCODED
```

`count` = `countPopulatedSections([movieCards.length, seriesCards.length, newsCards.length])` (`apps/web/app/pt/page.tsx:104`–`108`). O hero, as estatisticas, "Em breve", o ticker e a publicidade **nao contam** — correto.

Com a base TMDB real (filmes + series ingeridos, zero noticias) `count === 2` -> **`index`**. Ou seja: **a home indexa hoje, com o ticker mock e os chips de plataforma dentro dela.** Este e o mecanismo exato pelo qual a divida do ticker vira violacao da invariante 6 em pagina indexavel.

**RISCO adicional (SEO, honesto):**

- `hasReliableStructuredData: true` e uma **afirmacao nao verificada**. A home `/pt/` **nao emite nenhum JSON-LD**: `grep -rn "ld+json" apps/web/app/` retorna `/pt/explorar/page.tsx`, `/pt/filmes/[slug]`, `/pt/noticias/...`, `/pt/series/...` — mas **nao** `apps/web/app/pt/page.tsx`. Sem `WebSite`, sem `Organization`, sem `CollectionPage`, sem `BreadcrumbList`. O gate esta passando um `true` que a pagina nao sustenta.
- Os 15 "blocos de valor" de `.claude/rules/seo.md` §1 sao definidos para paginas de entidade. A home reinterpreta "bloco de valor" como "secao com >= 1 card". Nenhuma das tres secoes contadas e conteudo **proprio**: sao listagens de dado cru de API (TMDB). Sob leitura estrita da invariante 5 ("alem do dado cru de API"), a home **nao deveria** somar 2 blocos de valor proprios. **NAO FOI POSSIVEL CONFIRMAR** que essa reinterpretacao foi aprovada por decisao humana registrada — nao encontrei nota nesse sentido em `.claude/rules/seo.md` nem em `docs/frontend/page-map.md` (que nao inspecionei nesta secao). Registro como **RISCO de SEO / DEBITO de governanca**, nao como violacao provada.
- `SITE_URL = "https://thescreen.media"` e **hardcoded** (`apps/web/src/lib/site.ts:9`), nao lido de env. O `canonical` da home (`apps/web/app/pt/page.tsx:122`) sempre aponta para o dominio oficial, mesmo servido de um dominio temporario de staging/EasyPanel. Combinado com `robots: index` isso e **RISCO P0 de SEO** (deploy temporario indexavel apontando canonical para o dominio de producao). **BLOQUEIA PRODUCAO** se houver ambiente publico intermediario.

---

### 7.8 Fidelidade honesta vs. fabricacao — os detalhes que sobraram

| Item | arquivo:linha | Problema | Severidade |
|---|---|---|---|
| Rank `#1`…`#10` nos Destaques | `apps/web/app/pt/page.tsx:674`, `:684` (renderizado em `:321`, `:365`) | O numero e `index + 1` do slot, **nao** um ranking. O usuario le "#1" como "o mais bem colocado". O comentario admite: "o rank e VISUAL (posicao do slot, nao ranking real)" (`:306`) | **PLACEHOLDER**, **NAO BLOQUEIA PRODUCAO** mas e desonestidade visual num bloco chamado "Destaques" |
| `fillSlots` repete o mesmo card | `apps/web/app/pt/page.tsx:73`–`76`, usado em `:549`, `:553`, `:554`, `:581` | Com < 10 filmes+series, o **mesmo titulo aparece varias vezes** com ranks diferentes (`#1` e `#5` sendo o mesmo filme). Idem grids de 6 e a grade de noticias. `key` combina href+indice para nao quebrar o React | **DEBITO**, **NAO BLOQUEIA PRODUCAO** (catalogo grande resolve), mas produz conteudo duplicado numa pagina indexavel |
| `☆ Avaliar` / `✓ Marcar como assistido` | `apps/web/app/pt/page.tsx:336`, `:340` | `<span aria-disabled="true">` sem `onClick`, sem estado, sem watchlist. Sao affordances mortas que parecem botoes | **PLACEHOLDER**, **NAO BLOQUEIA PRODUCAO** |
| Filtros do footer | `apps/web/app/_components/site-footer.tsx:44`–`54` | "Top 250", "Em breve", "Mais vistos", "Mais premiados", "Nascidos hoje", "Em alta" sao `<a href>` para o indice pai. Nao dao 404, mas prometem features inexistentes e criam 4 links identicos por coluna (canibalizacao de anchor text) | **DEBITO** SEO, **NAO BLOQUEIA PRODUCAO** |
| Marca "The Screen" na UI | `apps/web/app/pt/page.tsx:664` ("Destaques no The Screen"), `:633` (eyebrow "The Screen"), `site-footer.tsx:154` (coluna "The Screen"), `:183` ("newsletter do The Screen"), `:212` ("© 2026 The Screen · thescreen.media") | `CLAUDE.md` §1: marca publica principal e **Screen**; "The Screen" so como referencia historica/nao-principal. A home usa "The Screen" como marca principal em 5 pontos visiveis | **DEBITO** de governanca de marca, **NAO BLOQUEIA PRODUCAO** |
| Copyright "© 2026" | `apps/web/app/_components/site-footer.tsx:212` | Hardcoded | trivial |
| `og:image` | `apps/web/app/layout.tsx:26` | Ausente por decisao explicita ("sem og:image fabricada") | honesto, **DEBITO** de produto |
| Busca | `apps/web/app/_components/site-header.tsx:82` | Icone de lupa que e `<a href="/pt/explorar/">`. Nao ha campo de busca | **PARCIAL**, honesto (`aria-label="Explorar"`) |
| Imagens do TMDB no HTML | `apps/web/src/lib/tmdb-image-url.ts:20` | Todo `<img>` de poster/backdrop aponta para `image.tmdb.org`. Nao viola a invariante 3 (nao ha fetch no render), mas cria dependencia de disponibilidade e de politica de hotlink do TMDB no caminho critico de LCP da home | **DEBITO**, **NAO BLOQUEIA PRODUCAO** (a atribuicao exigida esta em `site-footer.tsx:205`–`208`) |
| Hero sempre so com filmes | `apps/web/src/server/home-hero.ts:233` | `[...movies, ...series].slice(0, 5)` -> series nunca aparecem se houver >= 5 filmes | **DEBITO** de produto |

---

### 7.9 Dependencias por bloco

| Bloco | TMDB | Screen Score | Streaming availability | Noticias reais |
|---|---|---|---|---|
| Header | nao | nao | nao | nao |
| Hero | **sim** (imagem, titulo, ano) | sim (estrelas — ausentes na base real) | **nao** (mas usa o label "Onde assistir") | nao |
| Ticker | nao | nao | **afirma sem ter** | nao |
| Destaques | **sim** | sim (nota — ausente na base real) | nao | nao |
| Filmes em destaque | **sim** | sim (nota) | nao | nao |
| Estatisticas | sim (indireto: entidades ingeridas) | nao | nao | nao |
| Series em destaque | **sim** | nao (tile nao mostra nota) | **afirma sem ter** (chip) | nao |
| Em breve | **sim** (`/movie/upcoming` ingerido offline) | nao | nao | nao |
| Publicidade | nao | nao | nao | nao |
| Noticias | nao | nao | nao | **sim** (`articles`; pipeline inexistente) |
| Newsletter | nao | nao | nao | nao |
| Footer | nao (so atribuicao) | nao | nao | nao |

---

### 7.10 O que precisa ser removido/corrigido antes do dominio oficial

Ordenado por criticidade.

1. **`<EpisodesTicker />`** — remover ou gatear. **BLOQUEIA PRODUCAO.** `apps/web/app/pt/page.tsx:648`.
2. **Chip de plataforma nos tiles de Series** — remover `homeVisualPlatform` e o `<span className="home-v4-series-platform">`. **BLOQUEIA PRODUCAO.** `apps/web/app/pt/page.tsx:133`–`144`, `:454`–`456`, `:764`.
3. **`SITE_URL` hardcoded + `robots: index`** — tornar o origin canonico dependente de env e forcar `noindex` fora do dominio oficial. **BLOQUEIA PRODUCAO** se existir staging publico. `apps/web/src/lib/site.ts:9`.
4. **Rank `#N` fabricado nos Destaques** — remover o badge ou implementar ranking real (nao existe fonte de popularidade governada hoje). **NAO BLOQUEIA PRODUCAO.**
5. **`fillSlots` repetindo cards** — trocar por "renderiza o que existe" e omitir slots vazios; conteudo duplicado em pagina indexavel. **NAO BLOQUEIA PRODUCAO.**
6. **`Avaliar` / `Marcar como assistido`** — remover ate haver conta de usuario. **NAO BLOQUEIA PRODUCAO.**
7. **`hasReliableStructuredData: true` sem JSON-LD** — ou emitir `WebSite`/`CollectionPage` na home, ou passar `false` e aceitar `noindex`. **NAO BLOQUEIA PRODUCAO** (nao ha schema errado; ha schema ausente). `apps/web/src/lib/portal-presenter.ts:70`.
8. **`<h1>` = titulo de filme** — considerar um `<h1>` visualmente oculto descrevendo a home e rebaixar os titulos de slide para `<h2>`/`<p>`. **NAO BLOQUEIA PRODUCAO.**
9. **Rotulos de filtro do footer** ("Top 250" etc.) — virar texto (como ja foi feito com a coluna institucional) ate as rotas existirem. **NAO BLOQUEIA PRODUCAO.**
10. **Marca "The Screen"** na UI — alinhar com `CLAUDE.md` §1 (marca publica = "Screen"). **NAO BLOQUEIA PRODUCAO.**
11. **Screen Score ausente na base real** — decidir: (a) gerar `screen_score` editorialmente com revisao humana, ou (b) aceitar cards sem estrela e ajustar o design. Hoje o design v4 pressupoe (a) e o pipeline entrega (b). **NAO BLOQUEIA PRODUCAO**, mas e a maior lacuna entre o design aprovado e a realidade dos dados.

---

### 7.11 O que foi verificado e o que nao foi

Verificado por leitura de codigo: todos os arquivos citados; `packages/db/prisma/schema.prisma:244`–`290` (defaults de `screen_score*`/`certification`); ausencia de `screenScore` em `services/` e `api-clients/`; ausencia de JSON-LD em `apps/web/app/pt/page.tsx`; `services/news-ingestion/` contem apenas `README.md`.

**NAO FOI POSSIVEL CONFIRMAR:**

- O estado real do banco em producao (EasyPanel). Todas as afirmacoes sobre "a base real nao tem estrelas" derivam de que **nenhum codigo do repositorio grava `screen_score` fora do seed demo do admin** — se alguem tiver rodado o seed demo ou um `UPDATE` manual em producao, o comportamento observado muda. Nao tenho acesso ao banco.
- Se `NODE_ENV` esta efetivamente `production` no runtime do EasyPanel (Nixpacks/`next start` normalmente garante isso, mas nao inspecionei a config de deploy nesta secao). Se **nao** estiver, entao **noticias mock, "Em breve" mock, publicidade "Google AdSense" e o pseudo-form de newsletter tambem estao visiveis em producao** — o que promoveria varios itens de "**NAO BLOQUEIA**" para "**BLOQUEIA PRODUCAO**".
- Se `SCREEN_HOME_VISUAL_PLACEHOLDERS` esta setada em algum ambiente.
- Se `docs/frontend/page-map.md` registra uma decisao humana aprovando a contagem de "secao populada" como bloco de valor proprio para o gate anti-thin.
- Nao existe teste cobrindo a **presenca condicional dos blocos na pagina** (`tests/web/` cobre so as funcoes puras: `home-placeholder-governance.test.ts`, `home-hero-presenter.test.ts`, `home-upcoming-presenter.test.ts`, `portal-presenter.test.ts`). Nenhum teste garante que o ticker/chips nao aparecem em producao — porque, de fato, aparecem.


---

## Parte 8 — Catalogo de filmes

Escopo auditado: rota de listagem `/pt/filmes/` e rota de detalhe `/pt/filmes/[slug]/`, suas camadas server-only, presenters puros, componentes de apresentacao, o schema Prisma que as sustenta e os pipelines (ingestao TMDB, Entity Writer, seed demo) que populam — ou nao — cada campo. Auditoria estatica de codigo: **nao foi possivel confirmar** o conteudo real do PostgreSQL de producao (nao ha acesso a banco nesta auditoria). Toda afirmacao sobre "existe dado real" refere-se ao que o codigo de ingestao **grava**, nao ao que hoje esta gravado.

---

### 8.1 Topologia das rotas

| Rota | Arquivo | Estrategia de render | Observacao |
| --- | --- | --- | --- |
| `/filmes/` (sem prefixo de idioma) | `apps/web/app/filmes/page.tsx:14` | `permanentRedirect` 308 | Alias fixo -> `/pt/filmes/`. Nao e redirect por idioma (respeita a regra de "sem redirect automatico de idioma em URL indexavel"). |
| `/pt/filmes/` | `apps/web/app/pt/filmes/page.tsx` | `export const dynamic = "force-dynamic"` (`:21`) | Sem ISR: cada request bate no PostgreSQL. Sem paginacao. |
| `/pt/filmes/[slug]/` | `apps/web/app/pt/filmes/[slug]/page.tsx` | `export const revalidate = 3600` (`:33`) | Sem `generateStaticParams`; primeira visita SSR, depois cache ISR de 1 h. |
| `/dev/movie-page-preview/` | `apps/web/app/dev/movie-page-preview/page.tsx` | Estatica, `robots: noindex` (`:5`) | Preview visual com dados **ficticios** ("Interestelar"), emitindo JSON-LD `Movie`. Bloqueada tambem em `apps/web/app/robots.ts:26` (`Disallow: /dev/`). |

Pureza de render: **REAL**. `apps/web/src/server/movie-page.ts` e `apps/web/src/server/entity-indexes.ts` importam apenas `@screena/db/server` (Prisma) — nenhuma chamada de rede, nenhum Gemini (invariantes 3 e 4). As imagens do TMDB sao **hotlink remoto** montado por concatenacao de string a partir de `movies.poster_path` ja lido do banco (`apps/web/src/lib/tmdb-image-url.ts:20,40-53`), com excecao nomeada no guard `scripts/audit/check-render-purity.mjs`. Isso nao e chamada de API no render, mas e uma dependencia de disponibilidade de terceiro no First Paint — **DEBITO**, **NAO BLOQUEIA PRODUCAO**.

---

### 8.2 Listagem `/pt/filmes/`

Fluxo: `page.tsx` -> `getMovieIndexData()` (`apps/web/src/server/entity-indexes.ts:94-136`) -> `buildMovieIndexView()` (`apps/web/src/lib/entity-index-presenter.ts:294-305`) -> componente `EntityIndex` (`apps/web/app/_components/entity-index.tsx`) -> `EntityCardLink` (`apps/web/app/_components/entity-card.tsx`).

Fatos apurados:

- **So entra filme com slug canonico pt-BR.** A query parte de `slugs` (`entity-indexes.ts:62-77`, `isCanonical: true`) e so entao busca `movies`. Filme ingerido sem slug e invisivel na listagem (mas continua no banco).
- **Cap rigido de 24 itens, sem paginacao.** `INDEX_ITEM_LIMIT = 24` (`entity-index-presenter.ts:19`). Quando ha mais, a UI escreve "Mostrando os primeiros 24 de N" (`entity-index.tsx:103-107`) e **nao existe pagina 2**. Acima de 24 filmes, o catalogo fica inalcancavel pela navegacao — so via sitemap/links diretos. **DEBITO**, **NAO BLOQUEIA PRODUCAO** hoje (o backfill curado tem ~10 filmes: `services/ingestion/bin/ingest-public-catalog.ts:62`), mas **BLOQUEIA PRODUCAO** no momento em que o catalogo escalar.
- **Ordenacao unica:** ano desc, depois `title_original` asc (`entity-index-presenter.ts:238-243`). Sem filtros, sem busca, sem facetas de genero/plataforma/ano.
- **Gate anti-thin da listagem:** `MIN_INDEX_ITEMS = 3` (`entity-index-presenter.ts:25`); abaixo disso -> `noindex` via `evaluateEntityIndexIndexability` (`:340-352`). Coerente com o sitemap (`apps/web/src/lib/sitemap-presenter.ts:244-257`).
- **JSON-LD:** `CollectionPage` + `ItemList` (`entity-index.tsx:57-75`) e `BreadcrumbList` de 2 niveis (`:48-55`). Sem `AggregateRating`, sem `Movie` na listagem — correto.
- **Bug de codigo morto:** `buildMovieCard` calcula `screenScore` via `resolveCardScreenScore` (`entity-index-presenter.ts:260`), mas `EntityCardLink` **nao renderiza** `card.screenScore` (`entity-card.tsx:41-71`). A nota so aparece nos cards da home (`apps/web/app/pt/page.tsx:330,369,408`). Ou seja: a listagem de filmes nao exibe nota nenhuma. **DEBITO** (campo computado e descartado), **NAO BLOQUEIA PRODUCAO**.

---

### 8.3 Detalhe `/pt/filmes/[slug]/`

Fluxo: `getMoviePageData(slug)` (`apps/web/src/server/movie-page.ts:65-160`) -> `presentMovie` (`apps/web/src/lib/movie-presenter.ts:224-237`) + `evaluateMovieIndexability` (`apps/web/src/lib/movie-indexability.ts:50-62`) + `getCastForEntity` + `getWatchForEntity` + `getRelatedNewsForEntity`.

**O `select` do filme e minusculo** (`movie-page.ts:81-87`):

```
titleOriginal, releaseDate, runtimeMinutes, posterPath, backdropPath
```

Nao le `certification`, `screen_score`, `status`, `original_language`, `imdb_id`, `popularity`, `vote_average_tmdb`. Portanto, **a pagina de filme nao exibe nota alguma** — nem propria, nem externa — e o JSON-LD nao tem `AggregateRating` (`[slug]/page.tsx:117-126`). Isso esta **correto** perante as invariantes 1, 2 e a regra "sem AggregateRating falsa", mas tambem significa que a pagina e factualmente pobre.

**Resolucao do slug e canonical.** O lookup usa `prisma.slug.findFirst` **sem** `isCanonical` (`movie-page.ts:69-72`), depois busca separadamente o slug canonico (`:89-97`) e monta o canonical com ele (`:154`). Consequencia: um slug alias antigo responde **200** com canonical apontando para outro lugar, em vez de **301**. A tabela `redirects` existe (`packages/db/prisma/schema.prisma:457`) e **nenhum codigo em `apps/web` a consulta** (`middleware.ts` so injeta `x-screena-locale`). **DEBITO** de SEO, **NAO BLOQUEIA PRODUCAO** enquanto nao houver troca de slug publicado.

**Gate anti-thin.** `evaluateMovieIndexability` conta apenas `content_blocks` com `review_status` em `human_reviewed`/`published` (`movie-indexability.ts:19,32-34`), exige `>= 2` (`:26`), e delega a `evaluateIndexability` de `@screena/seo` com `displayedRatings: []`, `hasReliableStructuredData: true` e `reviewStatusOk: true` **hardcoded** (`:54-61`). Duas leituras:

1. O gate esta correto e severo hoje.
2. Os tres literais sao uma bomba-relogio: quando ratings entrarem, `displayedRatings: []` fara o gate **nunca** retornar `blocked` por licenca (invariante 6). **RISCO**, **NAO BLOQUEIA PRODUCAO** hoje (nenhum rating e lido), mas **BLOQUEIA PRODUCAO** no dia em que `external_ratings` for exibido.

Efeito pratico: como o Entity Writer nunca produz bloco `published`/`human_reviewed` (ele grava `ai_generated`/`needs_review`/`blocked` — ver `services/entity-writer/src/__tests__/decide-status.test.ts:32,45,90`), **todo filme ingerido do TMDB nasce `noindex` e fica fora do sitemap** (`sitemap-presenter.ts:294-303`). Os unicos filmes indexaveis hoje sao os que receberam blocos `published` pelo seed demo (`apps/admin/scripts/public-demo-seed-plan.ts:68-69`) ou promocao manual pelo admin atras da flag `ADMIN_EDITORIAL_ACTIONS_ENABLED` (`apps/admin/src/lib/editorial-action-policy.ts:38-39`).

**Sinopse: texto do TMDB apresentado como texto proprio.** O backfill grava `entity_translations.summary = detail.overview` cru (`services/ingestion/bin/ingest-public-catalog.ts:163,187-188`). O presenter usa `meta_description ?? summary` (`movie-presenter.ts:172-178`), e a pagina renderiza esse valor em tres lugares:

- paragrafo visivel `movie-topbar__synopsis` (`[slug]/page.tsx:166-168`);
- `<meta name="description">` (`:71-73`);
- `description` do JSON-LD `Movie` (`:126`).

Alem disso, `movie-page.ts:98-106` le `entity_translations` **sem filtrar** `status` nem `indexStatus` — colunas que existem e nascem `draft`/`noindex` (`schema.prisma:484-485`). Ou seja: uma traducao pt-BR em rascunho e servida publicamente. Nao viola a invariante 7 (pt-BR e o idioma de publicacao), mas fura o ciclo de vida por idioma descrito em `.claude/rules/i18n.md`. **RISCO** (conteudo de terceiro reexibido como proprio + bypass do estado de revisao da traducao). Atenuante: ha atribuicao ao TMDB no rodape (`apps/web/app/_components/site-footer.tsx:206-207`). **NAO BLOQUEIA PRODUCAO** (TMDB permite uso com atribuicao), mas contraria o espirito do "diferencial editorial verificavel" e de "nao copiar sinopse externa".

**Placeholders decorativos em producao.** A faixa de midia renderiza:

- um icone de **play** sobre o backdrop (`[slug]/page.tsx:200-204`), `aria-hidden`, sem trailer por tras;
- **tres tiles vazios** (`:206-210`) que imitam uma galeria de fotos inexistente.

O proprio comentario do arquivo admite que sao placeholders (`:173-176`). Um usuario ve um botao de play e uma galeria e conclui que ha video e fotos. **PLACEHOLDER** + **RISCO** de UX enganosa. **NAO BLOQUEIA PRODUCAO**, mas e o item mais visivel de "feature falsa" nesta rota.

**Secoes condicionais honestas.** Elenco (`:263-267`), Onde assistir (`:271-275`) e Noticias relacionadas (`:277`) sao omitidas quando nao ha dado — nunca renderizam heading vazio. `CastStrip` retorna `null` com lista vazia (`cast-strip.tsx:52`), `WatchProviders` idem (`watch-providers.tsx:27`), `RelatedNewsSection` idem (`related-news-section.tsx:20`). Isso e o comportamento correto.

---

### 8.4 Tabela mestre de features (comparacao com IMDb / TMDB / Rotten Tomatoes)

| Feature | Existe hoje? | Status | Arquivo/tabela que sustenta | **PROXIMO PASSO** |
| --- | --- | --- | --- | --- |
| **Poster** | Sim, detalhe + card | **REAL** | `movies.poster_path` (`schema.prisma:240`); `movie-presenter.ts:155`; URL remota em `tmdb-image-url.ts:40-53` | Adicionar `loading`/`fetchpriority` explicitos e `srcset` por tamanho TMDB; considerar proxy para nao depender de `image.tmdb.org` no LCP. |
| **Backdrop** | Sim, detalhe | **REAL** | `movies.backdrop_path` (`schema.prisma:241`); `movie-presenter.ts:156` | Idem poster; hoje `w1280` fixo (`movie-presenter.ts:43-47`). |
| **Titulo localizado (pt-BR)** | Sim | **PARCIAL** | `entity_translations.title` (`schema.prisma:478`); `movie-presenter.ts:161-166`; escrita em `ingest-public-catalog.ts:187` | Filtrar por `status`/`index_status` da traducao antes de renderizar (hoje `movie-page.ts:98-106` ignora ambos). |
| **Titulo original** | No banco; nunca exibido como campo | **PARCIAL** | `movies.title_original` (`schema.prisma:232`) usado so como fallback (`movie-presenter.ts:165`) | Exibir "Titulo original: X" quando divergir do titulo pt-BR (dado ja existe, custo zero). |
| **Ano de lancamento** | Sim | **REAL** | `movies.release_date` -> `getUTCFullYear()` (`movie-page.ts:134-135`); render em `[slug]/page.tsx:153-155` | Emitir `datePublished` com a data completa ISO no JSON-LD, nao so o ano (`[slug]/page.tsx:125`). |
| **Duracao** | Sim | **REAL** | `movies.runtime_minutes` (`schema.prisma:235`); `formatRuntime` (`movie-presenter.ts:181-188`) | Emitir `duration` ISO-8601 (`PT2H1M`) no JSON-LD `Movie`. |
| **Classificacao indicativa** | Coluna existe; componente existe; **nao e lido nesta rota** | **PLACEHOLDER** | `movies.certification` (`schema.prisma:244`); `CertificationBadge` usado **so** no hero da home (`hero-carousel.tsx:63`); populado **so** pelo seed demo (`public-demo-seed.ts:260,273`) | Ingerir `release_dates` do TMDB (BR) e adicionar `certification` ao `select` de `movie-page.ts:81-87`; ate la, nao exibir. |
| **Generos** | Nao existe (nem coluna, nem tabela) | **NAO IMPLEMENTADO** | Ausente de `schema.prisma`; reconhecido em `services/ingestion/README.md:12` e `docs/PHASE_2_TMDB_PLAN.md:199` | Criar `genres` + `entity_genres` (tarefa aprovada de schema); e o bloqueio raiz para navegacao facetada e SEO programatico. |
| **Sinopse** | Sim, mas e o `overview` cru do TMDB | **PARCIAL** / **RISCO** | `entity_translations.summary` <- `detail.overview` (`ingest-public-catalog.ts:163,187-188`); render em `[slug]/page.tsx:166-168` e `:126` | Escrever `summary_without_spoilers` proprio via Entity Writer e parar de servir `overview` como texto do Screen; no minimo, atribuir na propria secao. |
| **Direcao** | Dado no banco; **nunca consultado no render** | **NAO exibido** (dado **REAL**) | `crew_members` (`schema.prisma:401`), gravado por `store.ts:126-142`; consumido so pelo Entity Writer (`payload-source.ts:35-39,48`) | Adicionar query de `crew_members` (job `Director`) em `movie-page.ts` e emitir `director` no JSON-LD `Movie`. Ganho alto, custo baixo. |
| **Roteiro** | Idem direcao | **NAO exibido** (dado **REAL**) | `crew_members.job` (`Writer`/`Screenplay`) (`schema.prisma:409`) | Mesma query; renderizar ficha tecnica "Direcao / Roteiro". |
| **Elenco** | Sim | **REAL** | `cast_members` + `people` (`schema.prisma:383,356`); `entity-cast.ts:42-52`; `cast-presenter.ts:132-153`; `CastStrip` | Cap atual: 24 lidos, 12 exibidos (`entity-cast.ts:31`, `cast-presenter.ts:34`). Sem "ver elenco completo". Criar rota/expansao. |
| **Equipe (crew completa)** | Dado no banco; nao exibido | **NAO exibido** (dado **REAL**) | `crew_members` (`schema.prisma:401`) | Secao "Ficha tecnica" agrupada por `department`. |
| **Trailers** | Nao | **NAO IMPLEMENTADO** + **PLACEHOLDER** de UI | Sem tabela `trailers` (`database/schema.md:36`); botao play decorativo em `[slug]/page.tsx:200-204` | Remover o icone de play ate existir trailer legal; depois criar `trailers` e embed licenciado (invariante 8). |
| **Videos (featurettes, clips)** | Nao | **NAO IMPLEMENTADO** | Ausente do schema | Mesmo caminho do trailer. |
| **Fotos / galeria** | Nao | **NAO IMPLEMENTADO** + **PLACEHOLDER** de UI | Sem tabela `images` (`database/schema.md:36`); 3 tiles vazios em `[slug]/page.tsx:206-210` | Remover os tiles vazios; galeria depende de tabela `images` + licenca. |
| **Onde assistir** | Codigo pronto e governado; **sem dado real** | **PLACEHOLDER** (dados) / **REAL** (codigo) | `watch_availability` (`schema.prisma:626`); `entity-watch.ts:41-55` (filtra `display_allowed` + `country=BR`); `watch-presenter.ts:116-157`; unico produtor de linhas: `public-demo-seed.ts:229-245` | Implementar worker de streaming (TMDB `/watch/providers` ou JustWatch licenciado) com `display_allowed` decidido por humano. Ate la, so filmes demo mostram a secao. |
| **Ratings externos (IMDb/RT/Metacritic)** | Nao | **NAO IMPLEMENTADO** | `external_ratings` (`schema.prisma:590`) e `validateRating` existem; **nenhum** codigo em `apps/`, `services/` ou `scripts/` le ou escreve a tabela (grep confirma: so `packages/seo`, `packages/db/scripts/validate-real-postgres.ts` e testes) | Antes de ativar: decidir licenca por fonte (`source_licenses`), e corrigir `movie-indexability.ts:58` (`displayedRatings: []` hardcoded) para receber os ratings realmente exibidos. |
| **Nota propria (screen_score)** | Coluna + gate; **so seed demo**; nao lida na rota de detalhe | **PLACEHOLDER** | `movies.screen_score/_scale/_display` (`schema.prisma:248-250`, default `display=false`); `resolveCardScreenScore` (`entity-index-presenter.ts:201-209`); populado so em `public-demo-seed.ts:261-263` | Definir de onde vem a nota editorial (quem avalia, com que criterio) antes de expandir. Hoje as estrelas do hero da home saem de dado de seed. |
| **Reviews (proprias)** | Nao | **NAO IMPLEMENTADO** | `content_blocks.block_type = review_summary` existe no enum (`schema.prisma:36-50`), sem pipeline; `.claude/rules/seo.md` proibe emitir `Review` por inferencia | Nao emitir `Review` no JSON-LD ate existir review humana real. |
| **Critica (audiencia vs critica)** | Nao | **NAO IMPLEMENTADO** | Depende de `external_ratings` | Bloqueado por ratings + licenca. |
| **Noticias relacionadas** | Codigo real; pipeline de noticias inativo | **PARCIAL** | `entity_news_links` + `articles` + `article_translations` (`schema.prisma:791,741,766`); `related-news.ts:47-101` aplica gate de licenca/review/index | RSSPRIME/MN26 nao existe como worker. Sem ingestao de noticias, a secao nunca aparece para filmes reais. |
| **Recomendacoes** | Nao | **NAO IMPLEMENTADO** | Nenhuma tabela/relacao | Requer modelagem (`similar_titles`) ou heuristica por genero — que tambem nao existe. |
| **Filmes similares** | Nao | **NAO IMPLEMENTADO** | `content_blocks.block_type = similar_titles_intro` existe no enum, sem prompt/pipeline ativo | Depende de generos/franquias. |
| **Colecoes / franquias** | Nao | **NAO IMPLEMENTADO** | Sem tabela `franchises` (`database/schema.md:27`), embora `docs/SPEC.md:93` a prometa | Criar `franchises` + `entity_franchise`; TMDB ja retorna `belongs_to_collection`. |
| **Status de lancamento** | Coluna ingerida; nunca exibida | **NAO exibido** (dado **REAL**) | `movies.status` (`schema.prisma:236`), gravado em `normalizers/movie.ts:44` | Exibir "Em cartaz / Anunciado / Pos-producao"; util para "Em breve". |
| **Bilheteria (revenue)** | Nao | **NAO IMPLEMENTADO** | Sem coluna em `schema.prisma:228-265`; TMDB retorna `revenue` | Adicionar coluna em migration aprovada; e um bloco de valor barato. |
| **Orcamento (budget)** | Nao | **NAO IMPLEMENTADO** | Sem coluna; TMDB retorna `budget` | Idem bilheteria. |
| **Idioma original** | Coluna ingerida; nunca exibida | **NAO exibido** (dado **REAL**) | `movies.original_language` -> FK `languages` (`schema.prisma:233,256`) | Exibir na ficha tecnica e emitir `inLanguage` no JSON-LD. |
| **Pais de origem** | Nao | **NAO IMPLEMENTADO** | Sem coluna; `Country` (`schema.prisma:165`) so serve `watch_availability` | Adicionar `production_countries` em migration aprovada. |
| **Empresas produtoras** | Nao | **NAO IMPLEMENTADO** | Sem tabela | Baixa prioridade de SEO; alta de "produto maduro". |
| **Links externos (IMDb etc.)** | Ids no banco; nunca renderizados | **NAO exibido** (dado **REAL**) | `movies.imdb_id` (`schema.prisma:231`); `entity_external_ids` (`schema.prisma:423`), gravado por `store.ts:36-52` | Link `rel="nofollow"` para IMDb/TMDB na ficha. Cuidado: `imdb_id` e **identificador**, nunca fonte de rating (invariante 2 — o proprio schema anota isso na linha 231). |
| **SEO / schema `Movie`** | Sim, minimo | **PARCIAL** | `[slug]/page.tsx:119-126`: so `@type`, `name`, `url`, `datePublished` (ano), `description` | Faltam `image`, `duration`, `director`, `actor`, `genre`, `inLanguage`, `sameAs`. **`AggregateRating` corretamente AUSENTE** — nao adicionar sem licenca + atribuicao. |
| **Breadcrumb** | Sim | **REAL** | `BreadcrumbList` 3 niveis (`[slug]/page.tsx:102-115`) + `<nav class="breadcrumb">` (`:131-141`) | OK. Corrigir acentuacao de "Inicio"/"navegacao" (cosmetico). |
| **Canonical** | Sim, autorreferente absoluto | **REAL** | `alternates: { canonical: canonicalUrl }` (`[slug]/page.tsx:68`); `movieCanonicalUrl` (`site.ts:38-40`) usa o slug **canonico** | Falta 301 de slug alias -> canonico (tabela `redirects` nao e consultada). |
| **hreflang** | Nao emitido | **NAO IMPLEMENTADO** (correto no MVP) | Nenhum `alternates.languages` na rota | Correto: en/es nascem draft/noindex (invariante 7). So emitir quando houver versao publicada e revisada. |
| **`og:image` / preview social** | Nao (so `og:type=website` global) | **NAO IMPLEMENTADO** | `apps/web/app/layout.tsx:20-25`; `generateMetadata` da rota nao define `openGraph` | Adicionar `openGraph.images` com o poster/backdrop e `og:type` adequado. |
| **Meta robots (gate anti-thin)** | Sim | **REAL** | `[slug]/page.tsx:64-68` + `movie-indexability.ts:50-62`; espelhado no sitemap (`sitemap-presenter.ts:294-303`) | Trocar os literais `hasReliableStructuredData: true` / `reviewStatusOk: true` / `displayedRatings: []` por valores reais antes de ativar ratings. |
| **Aviso "em revisao editorial"** | Sim | **REAL** | `[slug]/page.tsx:279-285` quando `indexability.decision !== "index"` | Honesto. Manter. |
| **Busca / filtros / paginacao no catalogo** | Nao | **NAO IMPLEMENTADO** | `entity-index-presenter.ts:19` (cap 24, sem offset) | Paginacao + facetas dependem de generos/anos indexados. |

---

### 8.5 Campos que existem no schema e nao chegam a tela

Inventario direto do gap entre `packages/db/prisma/schema.prisma` (modelo `Movie`, linhas 228-265) e o `select` da pagina (`apps/web/src/server/movie-page.ts:81-87`):

| Coluna | Ingerida? | Lida pela pagina? | Comentario |
| --- | --- | --- | --- |
| `tmdb_id` | Sim (`normalizers/movie.ts:38`) | Nao | Interno; ok nao exibir. |
| `imdb_id` | Sim (`:36`) | Nao | Poderia virar link externo. |
| `original_language` | Sim (`:41`) | Nao | Ficha tecnica + `inLanguage`. |
| `status` | Sim (`:44`) | Nao | "Released" / "Post Production". |
| `popularity` | Sim (`:45`) | Nao | Sinal de ordenacao nao usado. |
| `vote_average_tmdb` | Sim (`:46`) | Nao | **Correto nao exibir**: o schema anota que e "dado tecnico TMDB; NUNCA nota editorial" (`schema.prisma:238`). Nao promover a rating. |
| `vote_count_tmdb` | Sim (`:47`) | Nao | Idem. |
| `certification` | **Nao** (so seed demo) | Nao | Coluna orfa no caminho real. |
| `screen_score*` | **Nao** (so seed demo) | Nao (detalhe) / Sim (home) | Ver 8.6. |
| `last_synced_at` / `stale_after` | Sim (via `store.ts`) | Nao | Habilitaria bloco de valor "Historico de atualizacao" (bloco 14 do gate anti-thin). |

E o gap entre tabelas povoadas e tela: `crew_members` (direcao, roteiro, fotografia, trilha) e escrito em toda ingestao (`services/ingestion/src/persistence/store.ts:126-142`) e **jamais** lido por `apps/web`. Isso e a maior oportunidade de valor imediato: dado real, ja no banco, zero custo de API, e adiciona `director`/ficha tecnica ao JSON-LD e a pagina.

---

### 8.6 O que e seed demo e o que e dado real

Distincao critica para nao maquiar o estado:

| Superficie | Origem do dado | Status |
| --- | --- | --- |
| Filmes do catalogo curado (`Inception`, `Interstellar`, ...) | `services/ingestion/bin/ingest-public-catalog.ts:62` — 10 TMDB ids fixos + `--include-upcoming` (cap 20, regiao BR, `:68-70`) | **REAL** (TMDB), mas **sem** content_blocks -> `noindex` |
| Filmes `demo-*` ("The Silent Lighthouse", "City of Glass", "The Last Frontier") | `apps/admin/scripts/public-demo-seed-plan.ts:227,256,284`; slug com prefixo `demo-` (`:29`), `tmdb_id >= 992000000` (`:39`) | **PLACEHOLDER** — filmes ficticios que aparecem em `/pt/filmes/` como qualquer outro |
| `content_blocks` `published`/`human_reviewed` | So `public-demo-seed.ts:203-217` (ou promocao manual no admin) | **PLACEHOLDER** |
| `watch_availability` (Netflix, Prime Video, Max, Disney+, Apple TV) | So `public-demo-seed.ts:229-245`, `display_allowed: true` | **PLACEHOLDER** |
| `screen_score` + `certification` | So `public-demo-seed.ts:255-280`, `screenScoreScale: 5`, `screenScoreDisplay: true` | **PLACEHOLDER** |
| `external_ratings` | Ninguem escreve | **NAO IMPLEMENTADO** |

Consequencia direta e desconfortavel: **os unicos filmes que hoje podem ser `index` no Screen sao filmes que nao existem**. Os filmes reais do TMDB estao todos `noindex` por falta de bloco editorial. Se o seed demo for aplicado no mesmo banco do catalogo real (o script tem guarda de ambiente e confirmacao dupla, mas roda com `--apply`), o site publico exibe fichas ficticias com nota, classificacao e "assista na Netflix". **RISCO** de credibilidade e de invariantes 6/8 (afirmar disponibilidade em plataforma real para obra inexistente). Ha teste de disjuncao (`tests/governance/seed-disjoint.test.ts`), mas ele nao impede coexistencia no mesmo banco.

---

### 8.7 JSON-LD emitido — verificacao literal

`/pt/filmes/[slug]/` emite **dois** scripts `application/ld+json` (`[slug]/page.tsx:287-294`):

1. `Movie` (`:119-126`):
   - `@type: "Movie"` — **correto** por tipo de rota (regra de `.claude/rules/seo.md` secao 9).
   - `name`, `url` sempre; `datePublished` (string do ano) e `description` (a `meta_description`/`summary`) condicionais.
   - **Sem `AggregateRating`.** Confirmado por leitura direta: o objeto e construido do zero e nenhum ramo adiciona `aggregateRating`. Comentario explicito em `:117-118`.
   - **Sem `Review`**, sem `image`, sem `director`, sem `actor`, sem `duration`, sem `genre`.
2. `BreadcrumbList` (`:102-115`) com Inicio -> Filmes -> titulo, todos com `item` absoluto derivado de `SITE_URL`.

`/pt/filmes/` emite `CollectionPage` (+ `ItemList` quando ha cards) e `BreadcrumbList` (`entity-index.tsx:57-75,48-55`). Sem `Movie` por item, sem rating.

`/dev/movie-page-preview/` emite um `Movie` **ficticio** para "Interestelar" (`apps/web/app/dev/movie-page-preview/page.tsx:44-49`) com `url` relativo. Esta `noindex` + `Disallow: /dev/`. **DEBITO** menor; um JSON-LD `Movie` de obra real com texto inventado nao deveria existir nem em preview. **NAO BLOQUEIA PRODUCAO**.

---

### 8.8 Governanca: o que a rota respeita e o que ela fura

Respeita:

- Invariante 3/4: zero rede e zero IA no render (`movie-page.ts:1-16`; guard `pnpm audit:render` + `tests/governance/no-render-external-api.test.ts`).
- Invariante 5: `>= 2` blocos publicaveis, senao `noindex`; sitemap e meta robots usam o **mesmo** evaluator.
- Invariante 6 (parcial): `watch_availability` filtrado por `display_allowed` na query **e** no presenter (`entity-watch.ts:46`, `watch-presenter.ts:124`).
- Invariante 8: nenhum deep link renderizado; so nome do provedor + modalidade legal do enum `OfferType` (`watch-presenter.ts:19-36`).
- Invariante 11: filme diferenciado por label ("Filme"), badge (`screena-badge--movie`), breadcrumb (`/pt/filmes/`), schema (`Movie`) e URL — cinco sinais, nao so cor (`[slug]/page.tsx:157-162`).
- Invariantes 1/2: nenhuma nota externa e exibida; `vote_average_tmdb` fica no banco e nunca vira rating.

Fura ou tensiona:

- **`SITE_URL` hardcoded** (`apps/web/src/lib/site.ts:9` = `https://thescreen.media`), nao vem de env. Em staging/dominio temporario, canonical e breadcrumb apontam para producao. **RISCO** de SEO, **BLOQUEIA PRODUCAO** se houver ambiente indexavel fora do dominio canonico.
- **Sinopse de terceiro** servida como conteudo da pagina e como `description` do schema (8.3).
- **Estado de revisao da traducao ignorado** (`status`/`index_status` de `entity_translations` nunca sao lidos).
- **Placeholders visuais** (play + tiles) que sugerem trailer e galeria inexistentes.
- **`displayedRatings: []` hardcoded** no gate — invariante 6 nao sera aplicada automaticamente quando ratings entrarem.

---

### 8.9 Cobertura de testes desta fatia

| Alvo | Teste | Cobre |
| --- | --- | --- |
| Gate anti-thin do filme | `tests/web/movie-indexability.test.ts` (71 linhas) | `review_status` publicavel; `<2` -> noindex; `>=2` -> index |
| Presenter do filme | `tests/web/movie-presenter.test.ts` (203 linhas) | titulo/fallback, `formatRuntime`, dedupe de blocos, normalizacao de imagem |
| Listagem | `tests/web/entity-index-presenter.test.ts` | cards, cap, gate, `resolveCardScreenScore` |
| Sitemap | `tests/web/sitemap-presenter.test.ts` | coerencia sitemap x meta robots |
| Elenco / onde assistir | `tests/web/cast-presenter.test.ts`, `tests/web/watch-presenter.test.ts` | ordenacao, licenca, modalidade legal |
| Pureza de render | `tests/governance/no-render-external-api.test.ts`, `tests/governance/web-render-layering.test.ts` | sem import de rede/DB fora de `src/server` |

Nao ha teste que valide **o JSON-LD efetivamente emitido** pela rota (o objeto e montado inline em `[slug]/page.tsx`, nao em modulo puro testavel). A skill `schema-validate` existe, mas nao ha assercao automatizada. **DEBITO**, **NAO BLOQUEIA PRODUCAO**. Tambem nao ha teste garantindo a **ausencia** de `AggregateRating` — a protecao e apenas "ninguem escreveu o campo".

---

### 8.10 Prioridades recomendadas

1. **PROXIMO PASSO (alto valor, custo baixo):** consumir `crew_members` na pagina de filme (direcao/roteiro) e enriquecer o JSON-LD `Movie` com `director`, `actor`, `image`, `duration`, `inLanguage`. Dado ja esta no banco; nao exige API nem migration.
2. **PROXIMO PASSO (risco):** remover o botao de play e os tres tiles vazios de `[slug]/page.tsx:200-210` ate existirem trailer/galeria reais.
3. **PROXIMO PASSO (risco SEO):** mover `SITE_URL` para env var e falhar fechado quando ausente.
4. **PROXIMO PASSO (governanca):** filtrar `entity_translations` por `status`/`index_status` em `movie-page.ts`; parar de reexibir `overview` do TMDB como texto proprio.
5. **PROXIMO PASSO (bomba-relogio):** parametrizar `displayedRatings` / `hasReliableStructuredData` / `reviewStatusOk` em `movie-indexability.ts:54-61` antes de qualquer feature de ratings.
6. **PROXIMO PASSO (schema, exige tarefa aprovada de banco):** `genres`, `franchises`, `images`, `trailers`, `budget`/`revenue`, `production_countries`. Sao a diferenca entre uma ficha de 5 campos e um catalogo comparavel a TMDB.
7. **PROXIMO PASSO (produto):** paginacao/filtros em `/pt/filmes/` antes de o catalogo passar de 24 titulos.
8. **PROXIMO PASSO (honestidade):** decidir se o seed demo pode coexistir com o catalogo real em ambiente publico. Hoje ele e a unica fonte de paginas indexaveis — e elas descrevem filmes que nao existem.

---

### 8.11 O que nao foi possivel confirmar

- **NAO FOI POSSIVEL CONFIRMAR** o conteudo atual do PostgreSQL (producao/EasyPanel): quantos filmes existem, quantos tem slug canonico, quantos tem `content_blocks` publicados, se o seed demo esta aplicado la. A auditoria e estatica; nao houve acesso a `DATABASE_URL` nem execucao de query.
- **NAO FOI POSSIVEL CONFIRMAR** se `pnpm audit:render` de fato bloqueia todos os caminhos de import (li o comentario de excecao em `tmdb-image-url.ts:3-5`, nao o script `scripts/audit/check-render-purity.mjs` em detalhe).
- **NAO FOI POSSIVEL CONFIRMAR** o comportamento de `hasMore`/`totalCount` em volume real; a analise de cap 24 e derivada do codigo, nao de execucao.


---

## Parte 9 — Catalogo de series

### 9.1 Superficie de rotas realmente existente

O catalogo de series do Screen tem exatamente **duas** rotas publicas e um alias de redirect:

| Rota | Arquivo | Natureza |
| --- | --- | --- |
| `/pt/series/` | `apps/web/app/pt/series/page.tsx:40` | Listagem (`CollectionPage` + `ItemList`), `force-dynamic` (`apps/web/app/pt/series/page.tsx:21`) |
| `/pt/series/[slug]/` | `apps/web/app/pt/series/[slug]/page.tsx:62` | Detalhe (`TVSeries` + `BreadcrumbList`), `revalidate = 3600` (`apps/web/app/pt/series/[slug]/page.tsx:19`) |
| `/series/` | `apps/web/app/series/page.tsx:14` | Alias 308 -> `/pt/series/`, nao serve conteudo |

Inventario completo de `page.tsx` sob `apps/web/app` (comando `find apps/web/app -name page.tsx`): `dev/movie-page-preview`, `filmes`, `pt/explorar`, `pt/filmes`, `pt/filmes/[slug]`, `pt/noticias`, `pt/noticias/[slug]`, `pt/page.tsx`, `pt/pessoas`, `pt/pessoas/[slug]`, `pt/series`, `pt/series/[slug]`, `series`. **Nao existe nenhum outro arquivo de rota.**

### 9.2 CRITICO — rota de temporada e rota de episodio

**NAO IMPLEMENTADO.** Nao existe `/pt/series/[slug]/temporada-[n]/` nem qualquer rota de episodio. Evidencias:

- O `find` de rotas acima nao retorna nenhum diretorio abaixo de `apps/web/app/pt/series/[slug]/` — o unico arquivo la e `page.tsx`.
- `grep -rn "temporada-\|TVSeason\|TVEpisode"` em `apps`, `packages`, `seo`, `scripts` retorna **apenas** `packages/ui/src/vertical.ts:151` e `packages/ui/src/vertical.ts:153`, que resolvem `schemaType = "TVEpisode"` / `"TVSeason"` a partir de flags `opts.isEpisode`/`opts.isSeason`. Nenhum caller passa essas flags — e um contrato de UI orfao.
- O JSON-LD emitido na pagina de serie tem apenas `@type: "TVSeries"` (`apps/web/app/pt/series/[slug]/page.tsx:100-105`) e um `BreadcrumbList` de 3 niveis (`apps/web/app/pt/series/[slug]/page.tsx:85-98`). Nao ha `containsSeason`, `hasPart`, `episode` nem link algum para uma URL de temporada.
- `.claude/rules/seo.md` declara as rotas `/pt/series/{slug}/temporada-{n}/` e episodio como parte do mapa canonico de schema (`TVSeason`, `TVEpisode`). O codigo nao entrega nenhuma das duas.

Em vez de rotas, as temporadas e episodios sao renderizados **inteiros dentro da pagina da serie**, como um acordeao plano: `apps/web/app/pt/series/[slug]/page.tsx:218-286` itera `view.seasons` e, dentro de cada temporada, `season.episodes` (`apps/web/app/pt/series/[slug]/page.tsx:245-279`), imprimindo numero, titulo, runtime, ano e `overview` de **cada episodio**.

**Custo disso para SEO programatico (o ponto mais caro desta secao):**

1. **Perda total do long-tail de temporada/episodio.** IMDb, TMDB e TV Time monetizam exatamente as buscas "the last of us temporada 2", "the boys s04e07 explicado", "quantos episodios tem wednesday temporada 2". Sem URL propria, essas consultas nao tem alvo indexavel no Screen. Para uma serie como Game of Thrones (`TV_IDS` inclui `1399` em `services/ingestion/bin/ingest-public-catalog.ts:60`), sao 8 temporadas + 73 episodios = **81 URLs potenciais perdidas em uma unica entidade**. Nas 10 series curadas, a ordem de grandeza e de centenas de URLs.
2. **Canibalizacao interna e diluicao de relevancia.** Todo o texto de todas as temporadas e episodios (titulos + `overview` de cada episodio) fica concentrado numa unica URL. A pagina passa a ranquear mal para tudo: nao e especifica o suficiente para "s02e05" e fica sobrecarregada para o termo da serie.
3. **Peso de pagina e crawl budget.** Uma serie com 73 episodios renderiza 73 blocos de texto com sinopse por request. Nao ha paginacao, `<details>`, lazy-load ou limite — `apps/web/src/server/series-page.ts:112-134` busca **todas** as temporadas com **todos** os episodios em uma unica query Prisma, sem `take`.
4. **Schema.org incompleto e nao escalavel.** `TVSeason`/`TVEpisode` sao os tipos que o Google usa para rich results de series. Nenhum e emitido. Nem mesmo `numberOfSeasons`, `numberOfEpisodes`, `image` ou `actor` entram no `TVSeries` atual (`apps/web/app/pt/series/[slug]/page.tsx:100-110` so emite `name`, `url`, `startDate`, `endDate`, `description`) — apesar de esses dados estarem no banco e ja renderizados em HTML.
5. **Gate anti-thin nao aproveita o dado.** O contador de valor da pagina (`apps/web/src/lib/series-presenter.ts:283-295`) ignora completamente temporadas, episodios, elenco e "onde assistir": conta **so** `content_blocks`. Ou seja, o dado que existe nao ajuda a indexar, e a rota que indexaria esse dado nao existe.

**RISCO** / **NAO BLOQUEIA PRODUCAO** (nao vaza dado ilegal nem quebra invariante) mas **e a maior perda de receita organica do catalogo de series**.

**PROXIMO PASSO**: criar `apps/web/app/pt/series/[slug]/temporada-[n]/page.tsx` lendo `Season` + `Episode` via um `season-page.ts` server-only, emitindo `TVSeason` com `partOfSeries` e `BreadcrumbList` de 4 niveis; adicionar `containsSeason` (lista de URLs de temporada) ao `TVSeries` da pagina-mae; substituir a lista inline de episodios por um sumario com link para a temporada. Aplicar o gate anti-thin proprio da temporada (>= 2 blocos de valor) para nao criar centenas de paginas finas — o que reverteria o beneficio.

### 9.3 Pipeline de dados: Season e Episode SAO populados pela ingestao?

**Sim — pela ingestao TMDB real, e SOMENTE por ela.** **REAL**.

Cadeia verificada:

- `services/ingestion/src/import/import-tv.ts:32` normaliza o detalhe da serie e extrai `seasonNumbers` de `detail.seasons[]` (`services/ingestion/src/normalizers/tv.ts:58-60`).
- Para cada `seasonNumber`, faz `GET /tv/{id}/season/{n}` via cache (`services/ingestion/src/import/import-tv.ts:52-58`), respeitando short-circuit por hash de payload: se nao mudou, so `touchSeason` (`services/ingestion/src/import/import-tv.ts:72`).
- `normalizeSeason` (`services/ingestion/src/normalizers/season.ts:22-37`) monta `SeasonUpsert` + `EpisodeUpsert[]`; `episodeCount` e **derivado** de `episodes.length` (comentario explicito em `services/ingestion/src/normalizers/season.ts:5-6`).
- `upsertSeasonWithEpisodes` (`services/ingestion/src/persistence/store.ts:231-280`) grava `seasons` e `episodes` em transacao, com FK composta `(seasonId, tvShowId)`.
- Um unico `api_sync_logs` por ciclo, no endpoint raiz (`services/ingestion/src/import/import-tv.ts:76-85`), com `quotaCost` acumulado das temporadas. Regra "todo sync gera log" cumprida, ainda que com granularidade de serie e nao de temporada.
- Idioma: `getTvSeason` envia `language` (`api-clients/tmdb/src/endpoints.ts:67-69`) e o default e `pt-BR` (`api-clients/tmdb/src/config.ts:86`). Logo, nome/overview de temporada e episodio chegam em pt-BR quando o TMDB tem tradução.

Entrada de producao: `services/ingestion/bin/ingest-public-catalog.ts:368-383` chama `importTvShow(ctx, id)` para os 10 ids curados em `services/ingestion/bin/ingest-public-catalog.ts:60` (`1399, 1396, 66732, 100088, 119051, 94997, 60625, 1402, 82856, 71912`), e depois `finalize()` cria o slug canonico pt-BR e a `entity_translation` pt-BR (`services/ingestion/bin/ingest-public-catalog.ts:173-189`).

**Contraste importante — o seed demo NAO cria temporada nenhuma.** `apps/admin/scripts/public-demo-seed.ts:296-326` faz upsert de `tvShow` gravando `numberOfSeasons`/`numberOfEpisodes` como **numeros soltos**, e `grep -n "season\|episode"` naquele arquivo retorna apenas essas duas linhas de contagem. Nao ha `prisma.season.create` nem `prisma.episode.create` em lugar algum do repo fora de `services/ingestion/src/persistence/store.ts`. Consequencia pratica, e contraintuitiva:

- **Na base demo** (3 series de `apps/admin/scripts/public-demo-seed-plan.ts:327-410`): a pagina diz "3 temporadas / 24 episodios" no cabecalho (`apps/web/app/pt/series/[slug]/page.tsx:73-74`) mas a secao "Temporadas" **nao renderiza** (`hasSeasons = view.seasons.length > 0`, `apps/web/app/pt/series/[slug]/page.tsx:83`). A pagina afirma um numero que ela propria nao consegue listar. **DEBITO** de coerencia (nao e mentira: `numberOfSeasons` vem do TMDB no caso real; no demo e valor fabricado do plano de seed).
- **Na base real ingerida**: a secao "Temporadas" renderiza com dado TMDB verdadeiro, mas a pagina inteira fica **`noindex`**, porque nao ha `content_blocks` com `review_status` publicavel (ver 9.5).

Ou seja: **hoje nao existe nenhum estado do sistema em que uma pagina de serie com temporadas reais seja indexavel.** Demo = indexavel sem temporadas; real = temporadas sem indexacao.

### 9.4 Tabela mestre de features (comparacao com IMDb / TMDB / Rotten Tomatoes / TV Time)

Legenda de "Existe?": Sim = renderiza na pagina publica; Dado = existe no PostgreSQL mas nao aparece na UI; Nao = ausente do codigo.

| Feature | Existe? | Status | Sustentacao (arquivo/model) | **PROXIMO PASSO** |
| --- | --- | --- | --- | --- |
| Poster | Sim | **REAL** | `TvShow.posterPath` (`packages/db/prisma/schema.prisma:281`); `selectSeriesMedia` (`apps/web/src/lib/series-presenter.ts:204-210`); render `apps/web/app/pt/series/[slug]/page.tsx:152-161`. `file_path` cru vira URL remota `image.tmdb.org` via `buildTmdbImageUrl` (`apps/web/src/lib/series-presenter.ts:199`) | Nenhum. Adicionar `image` ao JSON-LD `TVSeries` |
| Backdrop | Sim | **REAL** | `TvShow.backdropPath` (`schema.prisma:282`), spec `w1280` (`series-presenter.ts:32`), render `page.tsx:164-172` | Nenhum |
| Titulo localizado (pt-BR) | Sim | **REAL** | `EntityTranslation.title` (`schema.prisma:473`), `selectSeriesTitle` (`series-presenter.ts:212-217`), gravado por `finalize()` (`ingest-public-catalog.ts:179-189`) | Nenhum |
| Titulo original | Dado | **PARCIAL** | `TvShow.nameOriginal` (`schema.prisma:271`) e lido (`series-page.ts:73`) e usado **so como fallback** de titulo (`series-presenter.ts:216`). Nunca exibido ao lado do titulo pt-BR | Exibir "Titulo original: X" quando divergir do pt-BR (IMDb/TMDB fazem) |
| Ano / periodo (2011–2019) | Sim | **REAL** | `firstAirDate`/`lastAirDate` (`schema.prisma:273-274`), `formatSeriesPeriod` (`series-presenter.ts:227-236`), render `page.tsx:131-134` | Nenhum |
| Status (em exibicao / encerrada) | Dado | **NAO IMPLEMENTADO** na UI | `TvShow.status` existe (`schema.prisma:275`) e e gravado pela ingestao (`services/ingestion/src/normalizers/tv.ts:48`) e pelo seed (`public-demo-seed.ts:302`). **`series-page.ts` nao seleciona `status`** (grep de `status` naquele arquivo so retorna `reviewStatus`). Nenhum componente exibe "Em exibicao"/"Encerrada" | Selecionar `status`, mapear `Returning Series`/`Ended`/`Canceled` para rotulo pt-BR e exibir como chip; nunca deixar cru em ingles |
| Numero de temporadas | Sim | **REAL** (com ressalva demo) | `TvShow.numberOfSeasons` (`schema.prisma:276`), `formatCountLabel` (`series-presenter.ts:247-255`), render `page.tsx:73-74,140-142` | Emitir `numberOfSeasons` no JSON-LD |
| Numero de episodios | Sim | **REAL** (com ressalva demo) | `TvShow.numberOfEpisodes` (`schema.prisma:277`), mesmo caminho acima | Emitir `numberOfEpisodes` no JSON-LD |
| Temporada atual / ultima temporada | Nao | **NAO IMPLEMENTADO** | Nenhum campo, nenhuma derivacao. `Season` nao tem flag de "atual" (`schema.prisma:307-328`) | Derivar da maior `season_number` com `air_date <= now` — nunca inventar |
| Lista de temporadas | Sim | **REAL** (so com ingestao) | `Season` (`schema.prisma:307-328`) -> `series-page.ts:112-134` -> `buildSeasonView` (`series-presenter.ts:308-322`) -> render `page.tsx:224-283`. Titulo cai em `Temporada {n}` quando `name` e nulo (`series-presenter.ts:312`) | Mover para rota propria (secao 9.2); filtrar/rotular temporada 0 (especiais) |
| Lista de episodios | Sim | **REAL** (so com ingestao), inline | `Episode` (`schema.prisma:330-354`) carregado como `season.episodes` sem `take` (`series-page.ts:122-132`); render `page.tsx:246-278` | Paginar/mover para rota de temporada; hoje 73 episodios = 73 blocos numa URL |
| Proximo episodio (next episode to air) | Nao | **NAO IMPLEMENTADO** | TMDB expoe `next_episode_to_air` no detalhe de serie; `normalizeTvShow` (`services/ingestion/src/normalizers/tv.ts:41-56`) nao le esse campo, e o schema nao tem coluna | So implementar junto do calendario; e o dado que sustenta o ticker da home (hoje mock) |
| Episodios recentes | Nao | **NAO IMPLEMENTADO** | Nenhuma query por `air_date` recente. `Episode.airDate` existe (`schema.prisma:338`) e permitiria | Bloco "Ultimos episodios" ordenado por `air_date desc` — dado ja existe |
| Elenco | Sim | **REAL** | `CastMember` + `Person` (`schema.prisma:383-399`), ingerido por `normalizeCredits` (`services/ingestion/src/normalizers/credits.ts:31-41`), lido em `entity-cast.ts:42-52`, render `page.tsx:290-294` (`CastStrip`). Link para `/pt/pessoas/{slug}/` so quando ha slug canonico (`entity-cast.ts:58-68`) | Adicionar `actor` ao JSON-LD `TVSeries` |
| Criadores (creator/showrunner) | Dado | **NAO IMPLEMENTADO** na UI | `CrewMember` (`schema.prisma:401+`) e ingerido para series (`credits.ts:43-53` a partir de `append_to_response=credits`, `import-tv.ts:14`). `series-page.ts` **nao consulta `crewMember`** (grep de `crewMember` em `apps/web` so retorna `home-hero.ts:89` e `person-page.ts:127`) | Filtrar `job in ("Creator","Executive Producer")` e exibir; e sinal E-E-A-T barato |
| Equipe (crew completa) | Dado | **NAO IMPLEMENTADO** na UI | Idem acima. Dado persistido, zero superficie | Bloco "Equipe" agrupado por `department` |
| Onde assistir | Sim (codigo) | **PARCIAL** — codigo real, fonte de dados inexistente | `WatchAvailability` (`schema.prisma:626`), lido com gate de licenca `displayAllowed: true` + `countryCode = "BR"` (`apps/web/src/server/entity-watch.ts:41-55`), presenter reaplica o filtro e emite carimbo "Atualizado em" a partir de `fetched_at` (`apps/web/src/lib/watch-presenter.ts:154`). **Nenhum worker escreve `watch_availability`**: `grep -rn "watchAvailability"` fora de node_modules retorna so `apps/admin/scripts/public-demo-seed.ts:94,229,234,437` (seed demo) e o leitor. `services/streaming/` contem **apenas** um `README.md` | Implementar `services/streaming` com licenca por provider antes de qualquer promessa de "onde assistir" |
| Ratings externos (IMDb, RT, Metacritic) | Nao | **NAO IMPLEMENTADO** | `ExternalRating` existe no schema (`schema.prisma:590`) e `packages/schemas/src/ratings.ts` valida invariantes 1 e 2, mas `series-page.ts` **nao consulta** `externalRating`, e `evaluateSeriesIndexability` passa `displayedRatings: []` fixo (`series-presenter.ts:291`). `services/ratings/` = so `README.md` | Nao ativar sem licenca decidida por humano (invariante 6). O gate de licenca hoje esta desarmado por construcao |
| Nota propria (screen_score) na pagina de serie | Nao | **NAO IMPLEMENTADO** | `TvShow.screenScore`/`screenScoreScale`/`screenScoreDisplay` (`schema.prisma:286-288`) existem, mas `series-page.ts:69-80` nao os seleciona e a pagina de detalhe nao exibe nota alguma | Coerente com governanca (nota nasce `display=false`). Sem acao |
| Nota propria nos cards de `/pt/series/` | Nao (silenciosamente) | **DEBITO** | `buildSeriesCard` **calcula** `screenScore` (`apps/web/src/lib/entity-index-presenter.ts:274` via `resolveCardScreenScore`, `:201-209`), mas `EntityCardLink` **nao renderiza o campo** (`apps/web/app/_components/entity-card.tsx:63-68`). Apenas a home (`apps/web/app/pt/page.tsx:330,369,408`) exibe a nota | Decidir: renderizar no card do indice ou remover o campo morto de `EntityCard` |
| Reviews (proprias ou de criticos) | Nao | **NAO IMPLEMENTADO** | `content_blocks` prevê `review_summary` (`.claude/rules/entity-writer.md`), mas nenhum bloco desse tipo e gerado; nenhum `Review` no JSON-LD | Fora de escopo ate haver linha editorial |
| Noticias relacionadas | Sim (codigo) | **PARCIAL** — codigo real, fonte inexistente | `EntityNewsLink` (`schema.prisma:791`) -> `apps/web/src/server/related-news.ts` -> `RelatedNewsSection` (`page.tsx:304`), com gate de publicacao/licenca espelhado das paginas de noticia. **`services/news-ingestion/` contem apenas `README.md`** — nenhum artigo entra por pipeline | Nenhuma acao no catalogo de series; depende de RSSPRIME/MN26 |
| Trailers | Nao | **NAO IMPLEMENTADO** | **Nao existe `model Trailer` no `schema.prisma`.** O unico `hasTrailer` e um boolean de auditoria em `PageIndexabilityDecision` (`schema.prisma:669`). `database/schema.md` cita `trailers` como tabela planejada — nao migrada | Sem modelo, sem bloco de valor "trailer incorporado" (item 8 do gate anti-thin fica inalcancavel) |
| Fotos / galeria | Nao | **NAO IMPLEMENTADO** | **Nao existe `model Image`.** So `posterPath`/`backdropPath` no `TvShow` e `stillPath` no `Episode` (`schema.prisma:340`). O `stillPath` e ate mapeado no presenter (`series-presenter.ts:304`) mas **nunca renderizado** (`page.tsx:246-278` ignora `episode.still`) | Renderizar o still do episodio (dado ja ingerido e ja no view) ou remover o campo morto |
| Recomendacoes / obras parecidas | Nao | **NAO IMPLEMENTADO** | Nenhuma tabela de similaridade, nenhum `model Franchise` no schema (grep de `Franchise` em `schema.prisma` = 0 ocorrencias), nenhuma query. `content_blocks` prevê `similar_titles_intro` mas nenhum e gerado | Depende de modelagem de franquia/similaridade |
| Seguir serie | Nao | **NAO IMPLEMENTADO** | Nenhum model de usuario no `schema.prisma`. `apps/web/app/_components/site-header.tsx:26` documenta explicitamente que login/watchlist estao inativos e nao sao renderizados | Fora de escopo (exige camada de usuarios) |
| Marcar episodios vistos | Nao | **NAO IMPLEMENTADO** | Idem. `apps/web/app/pt/page.tsx:97` reforca "nunca watchlist/assistidos/avaliacoes" | Fora de escopo |
| Calendario de episodios | Nao | **NAO IMPLEMENTADO** | Nenhuma rota, nenhuma query por `air_date` futura. O `EpisodesTicker` da home **finge** ter um: `apps/web/app/_components/episodes-ticker.tsx:53-91` hardcoda `Wednesday T2·E6`, `The Bear T3·E4`, `Severance T2·E5`, `The Last of Us T2·E3`, `The Boys T4·E7` com wordmarks de streaming | Ver 9.7 — **RISCO** ativo |
| Notificacoes | Nao | **NAO IMPLEMENTADO** | Nenhum codigo | Fora de escopo |
| Progresso do usuario | Nao | **NAO IMPLEMENTADO** | Nenhum codigo | Fora de escopo |

Resumo numerico: de 27 features auditadas, **8 sao REAL**, **3 PARCIAL**, **1 DEBITO** (campo calculado e nao renderizado), **15 NAO IMPLEMENTADO** (das quais 4 tem dado no banco e zero UI: `status`, criadores, equipe, still de episodio). Zero features de usuario (seguir/vistos/progresso/notificacoes) — coerente com um produto sem camada de contas.

### 9.5 Indexabilidade: o gate anti-thin de serie ignora tudo que nao seja `content_blocks`

`evaluateSeriesIndexability` (`apps/web/src/lib/series-presenter.ts:283-295`) recebe **um unico numero**: `renderableBlockCount`. E chamado assim em `apps/web/src/server/series-page.ts:180-182`. Esse numero vem de `selectRenderableSeriesBlocks` (`series-presenter.ts:266-281`), que so aceita `content_blocks` com `review_status` em `human_reviewed` ou `published` (`series-presenter.ts:36-39`), dedupando por `block_type`.

Implicacoes verificadas linha a linha:

1. **`displayedRatings: []` e `reviewStatusOk: true` sao literais hardcoded** (`series-presenter.ts:290-293`). O gate de licenca (invariante 6) do `evaluateIndexability` **nunca dispara** para series, porque a pagina nunca declara ratings exibidos. Isso hoje e seguro (a pagina de fato nao exibe rating nenhum), mas e um **DEBITO** perigoso: no dia em que alguem renderizar um `external_rating` no template, a decisao `blocked` nao vai acontecer sozinha. **BLOQUEIA PRODUCAO** se ratings forem ativados sem reescrever esse evaluator.
2. **`hasReliableStructuredData: true` tambem e hardcoded** (`series-presenter.ts:289`) — a pagina se autodeclara com structured data confiavel mesmo quando o JSON-LD tem so `name` + `url`.
3. **Temporadas, episodios, elenco e "onde assistir" nao contam como bloco de valor**, apesar de os itens 2, 9 e 12 da lista canonica de 15 blocos (`CLAUDE.md` secao 9) preverem "onde assistir por pais", "elenco comentado" e "guia de temporadas". A pagina renderiza esses tres e mesmo assim pode ser `noindex`.
4. **Consequencia direta na base ingerida do EasyPanel**: as 10 series de `ingest-public-catalog.ts:60` entram sem nenhum `content_block` (o script nao cria nenhum; o Entity Writer produz `draft`/`ai_generated`, que `series-presenter.ts:36-39` recusa). Logo **todas as 10 paginas de serie reais sao `noindex`**, exibem o aviso "Esta pagina ainda esta em revisao editorial" (`apps/web/app/pt/series/[slug]/page.tsx:306-312`) e ficam fora do sitemap (`apps/web/src/lib/sitemap-presenter.ts:161-179`, `entityDetailEntry` exige `decideIndex(renderableBlockCount)`).
5. Ao mesmo tempo, **`/pt/series/` fica `index`**, porque `evaluateEntityIndexIndexability` so exige `MIN_INDEX_ITEMS = 3` cards validos (`apps/web/src/lib/entity-index-presenter.ts:25,340-352`). Resultado: **uma listagem indexavel apontando para 10 paginas `noindex`**. Isso e coerente com a invariante 5 (melhor `noindex` que thin), mas e um sinal de qualidade ruim para o crawler e desperdicia crawl budget. **RISCO** / **NAO BLOQUEIA PRODUCAO**.

**PROXIMO PASSO**: (a) fazer `evaluateSeriesIndexability` receber tambem `hasSeasons`, `castCount`, `watchProviderCount` e os ratings de fato exibidos, contando os blocos canonicos 2/9/12 quando presentes; (b) alimentar `displayedRatings` de verdade antes de qualquer exibicao de rating; (c) gerar e revisar `editorial_intro` + `summary_without_spoilers` pt-BR para as 10 series reais, que e o caminho ja suportado hoje para tirar a pagina do `noindex`.

### 9.6 Sinopse: origem do texto e risco de conteudo duplicado

A "Sinopse" exibida no topo (`apps/web/app/pt/series/[slug]/page.tsx:143-145`) e `view.metaDescription`, resolvido por `selectSeriesMetaDescription` (`apps/web/src/lib/series-presenter.ts:219-225`): `translation.metaDescription ?? translation.summary`.

Na ingestao real, `finalize()` grava `summary: overview` — o `overview` cru do TMDB (`services/ingestion/bin/ingest-public-catalog.ts:186-188`) — e nunca preenche `metaTitle`/`metaDescription`. Portanto, em toda serie ingerida:

- o texto visivel de "Sinopse" e a **sinopse do TMDB copiada literalmente**;
- a `<meta name="description">` e o mesmo texto (`page.tsx:56-58`);
- o `description` do JSON-LD `TVSeries` e o mesmo texto (`page.tsx:108-110`).

Somado a isso, `season.overview` e `episode.overview` (tambem TMDB cru) sao renderizados na integra (`page.tsx:242-244`, `page.tsx:269-273`), e `services/ingestion/src/normalizers/season.ts:6` reconhece por escrito que "`overview` e dado cru estrutural — nao e bloco de valor editorial".

`.claude/rules/entity-writer.md` secao 4 proibe copiar sinopse externa **para o Entity Writer**; a regra nao alcanca a camada de ingestao/render. Ainda assim, uma pagina cuja unica prosa e a sinopse do TMDB (mais N sinopses de episodio do TMDB) e exatamente a definicao de thin/duplicada que a invariante 5 quer evitar, e a atribuicao TMDB exigida pelos termos da API nao aparece na pagina de serie (o rodape global tem atribuicao — `apps/web/app/_components/site-footer.tsx` — mas nao ha credito junto ao texto). **RISCO** / **NAO BLOQUEIA PRODUCAO** hoje, porque as paginas reais estao `noindex`. Vira **BLOQUEIA PRODUCAO** no instante em que um `editorial_intro` publicado tirar a pagina do `noindex` sem que a sinopse cru seja substituida ou creditada.

**PROXIMO PASSO**: separar `summary` (dado TMDB, uso interno/admin) de `metaDescription` (redacao propria); nunca promover `overview` cru a `<meta description>` nem a `description` de JSON-LD; creditar TMDB junto ao texto sempre que ele aparecer.

### 9.7 O `EpisodesTicker` da home e um mock que fala de series

Nao e rota de serie, mas e a superficie que mais afirma coisas sobre series e por isso pertence a esta auditoria.

`apps/web/app/_components/episodes-ticker.tsx:53-91` retorna cinco itens **hardcoded** (`Wednesday`, `The Bear`, `Severance`, `The Last of Us`, `The Boys`), cada um com `T{n} · E{n}`, o wordmark de um streaming (`NETFLIX`, `Star+`, `Apple TV+`, `Max`, `prime video`) e a copy "novo episodio hoje" + CTA "Onde assistir" (`episodes-ticker.tsx:129-165`). O proprio arquivo documenta a divida em `episodes-ticker.tsx:15-28`.

Duas afirmacoes falsas sao emitidas em pagina publica:

1. **"novo episodio hoje"** — nao existe `next_episode_to_air` no schema, nenhuma query de `air_date`, nenhum calendario. A afirmacao e fabricada.
2. **"Onde assistir <streaming>"** — associa serie a plataforma **sem nenhuma linha em `watch_availability`** (nenhum worker escreve nessa tabela; `services/streaming/` e so um README). Isso tensiona diretamente a invariante 6 (dado sem licenca clara em pagina indexavel) e a invariante 8 na leitura estrita ("onde assistir" so cita disponibilidade legal confirmada).

Mitigacoes ja presentes: todo `href` aponta para `SERIES_INDEX_PATH` (safe-link, sem 404) e nada disso vira schema.org nem e persistido.

**RISCO** / **BLOQUEIA PRODUCAO** — a home `/pt/` e a rota mais indexavel do site.

**PROXIMO PASSO**: remover o ticker do render de producao (ou gatea-lo pelo mesmo mecanismo de `home-placeholder-governance.ts` usado pelos demais placeholders) ate existir `watch_availability` real + coluna de proximo episodio.

### 9.8 Outros achados menores (com citacao)

| Achado | Status | Citacao |
| --- | --- | --- |
| Temporada 0 (especiais) e ingerida e renderizada como "Temporada 0" | **DEBITO** | `services/ingestion/src/normalizers/tv.ts:58-60` nao filtra `season_number === 0`; fallback de titulo em `series-presenter.ts:312` |
| Slug nao-canonico serve 200 sem 301 | **DEBITO** / **RISCO** SEO | `apps/web/src/server/series-page.ts:59-63` usa `findFirst` sem `isCanonical`; o `model Redirect` (`schema.prisma:457`) nunca e consultado no render (`grep prisma.redirect` em `apps/web` = 0) |
| Sem `hreflang` / `alternates.languages` | **NAO IMPLEMENTADO** (correto no MVP) | Só `alternates: { canonical }` (`page.tsx:54`); `apps/web/middleware.ts:15-21` documenta que nao ha redirect por idioma |
| Query de temporadas sem `take`/paginacao | **DEBITO** / **RISCO** de performance | `apps/web/src/server/series-page.ts:112-134` |
| `series-media__tiles` = tres `<span>` vazios decorativos | **PLACEHOLDER** visual | `apps/web/app/pt/series/[slug]/page.tsx:177-181` |
| `certification` e `screen_score` da serie so existem no seed demo | **PLACEHOLDER** | `apps/admin/scripts/public-demo-seed.ts:305-308`; `normalizeTvShow` (`services/ingestion/src/normalizers/tv.ts:41-56`) nao grava nenhum dos dois |
| Diferenciacao filme/serie na pagina (invariante 11) | **REAL** | label + badge (`page.tsx:135-139`), breadcrumb (`page.tsx:115-125`), schema `TVSeries` (`page.tsx:102`), URL `/pt/series/` (`page.tsx:21`), acento verde via `data-vertical="series"` (`page.tsx:113`) |
| Pureza de render (invariantes 3 e 4) | **REAL** | `series-page.ts` importa so `@screena/db/server`; nenhum `fetch`/Gemini no caminho. Imagens sao `<img src="https://image.tmdb.org/...">` montado por helper governado (`series-presenter.ts:199`) — request do **browser**, nao do servidor |
| Cobertura de teste do presenter de serie | **PARCIAL** | `tests/web/series-presenter.test.ts` (284 linhas, 12 casos) cobre periodo, blocos, indexabilidade e midia. **Nao ha teste** para `buildSeasonView`/`buildEpisodeView` com ordenacao, nem teste de rota |

### 9.9 O que a pagina de serie e, honestamente

Uma **ficha tecnica de serie com listagem inline de temporadas e episodios**, alimentada exclusivamente por TMDB, sem status de exibicao, sem criadores, sem trailers, sem fotos, sem ratings, sem recomendacoes, sem calendario e sem nenhuma feature de usuario. Comparada a IMDb ou TV Time, ela cobre a coluna "metadados basicos" e nada mais. O elenco e o "onde assistir" existem como codigo correto e governado, mas o segundo nao tem nenhum worker que o alimente.

O bloqueio estrutural nao e falta de dado — `Season`, `Episode`, `CastMember`, `CrewMember` estao populados por `services/ingestion` com cache, hash de payload e log. O bloqueio e que **(a) nao ha rota de temporada/episodio para exportar esse dado ao indice**, e **(b) o gate anti-thin so conta `content_blocks`**, entao nem a serie mais completa do banco consegue indexar sem redacao editorial revisada.


---

## Parte 10 — Pessoas, elenco e equipe

### 10.1 Resumo executivo (sem maquiagem)

A vertical de pessoas é a **mais bem escrita e a menos utilizável** do repositório. O código de render (`person-page.ts`, `person-presenter.ts`, `cast-presenter.ts`, `entity-cast.ts`) é puro, testado, disciplinado e não inventa nada. O problema não está no render: está **a montante**, na ingestão, e **a jusante**, no gate anti-thin.

Três fatos que definem o estado real:

1. **A ingestão real de catálogo (`services/ingestion/bin/ingest-public-catalog.ts`) nunca cria slug canônico pt-BR para pessoa.** Ela cria slug e tradução apenas para `movie` e `tv` (`ingest-public-catalog.ts:173-189`). Pessoas entram no banco só como *stub* derivado de créditos. Sem slug, `getPersonIndexData` não as vê (`entity-indexes.ts:186`) e `getPersonPageData` não resolve nenhuma rota (`person-page.ts:71-75`). Resultado: **na base real ingerida do TMDB, `/pt/pessoas/` renderiza vazio e nenhuma `/pt/pessoas/[slug]/` existe.**
2. **Nenhuma página de pessoa é indexável hoje, em nenhum caminho automatizado.** O gate exige `>= 2` blocos renderizáveis (`person-presenter.ts:60`), e o único caminho que cria pessoas com slug — o seed de demonstração — gera **exatamente 1 bloco** por pessoa (`public-demo-seed-plan.ts:417-424`). Logo, mesmo o demo produz `noindex` em 100% das pessoas.
3. **O Entity Writer não sabe escrever para `person`.** `payload-source.ts:24-26` lança erro para qualquer `entityType` que não seja `movie`/`tv`. Os 2 blocos exigidos pelo gate teriam de ser escritos à mão hoje.

Ou seja: a rota **existe, está no menu principal** (`navigation.ts:31`) e no hub `/pt/explorar` (`explorar/page.tsx:133-134`), mas aponta para uma seção que, com dado de produção, está vazia. Isso é **RISCO** de UX e de SEO (link de navegação primária para porta de entrada vazia), não só dívida.

**Filmografia bidirecional: NÃO funciona na base real.**
- Filme → pessoa: `CastStrip` só vira link quando a pessoa tem slug canônico pt-BR (`entity-cast.ts:58-68`, `cast-presenter.ts:122`). Sem slug → nome como texto simples. **É o estado da base real.**
- Pessoa → filme: `person-page.ts:252-313` resolve título + slug do alvo; títulos ingeridos *têm* slug. Esse sentido funcionaria — mas a página de pessoa é inalcançável, porque a pessoa não tem slug.
- Conclusão: o ciclo `filme -> pessoa -> filme` **só fecha no seed demo** (`public-demo-seed.ts:359`). **PLACEHOLDER**.

---

### 10.2 Rotas e pureza de render

| Rota | Arquivo | Estratégia | Fonte de dados |
| --- | --- | --- | --- |
| `/pt/pessoas/` | `apps/web/app/pt/pessoas/page.tsx:40` | `dynamic = "force-dynamic"` (`page.tsx:21`) | `getPersonIndexData` → Prisma (`entity-indexes.ts:184`) |
| `/pt/pessoas/[slug]/` | `apps/web/app/pt/pessoas/[slug]/page.tsx:72` | `revalidate = 3600` (`[slug]/page.tsx:23`) | `getPersonPageData` → Prisma (`person-page.ts:67`) |

**Invariante 3 (zero API externa no render): respeitada.** Os dois loaders usam só `getPrismaClient()` de `@screena/db/server` (`person-page.ts:15`, `entity-indexes.ts:15`). As fotos de perfil são `<img src>` remoto do `image.tmdb.org`, montado por concatenação de string a partir do `file_path` já lido do PostgreSQL (`tmdb-image-url.ts:40-53`), o que **não é chamada de API no render** — é o mesmo padrão governado usado no hero. **REAL**.

**Invariante 4 (zero Gemini no render): respeitada.** Nenhum import de IA em nenhum arquivo da vertical.

**Invariante 7 (pt-BR primeiro): respeitada por omissão.** Só existe segmento `/pt/`; não há rota `en`/`es`, não há `hreflang` emitido em nenhum dos dois arquivos de página. `LANGUAGE_CODE = "pt-BR"` é constante hardcoded (`person-page.ts:31`, `entity-indexes.ts:30`).

**Invariante 11 (filme/série nunca só por cor): respeitada.** A página de pessoa é neutra (`data-vertical="person"`, `[slug]/page.tsx:121`) e o tipo de crédito na filmografia carrega label textual *visually-hidden* além do dot colorido (`[slug]/page.tsx:216-219`, com `CREDIT_TYPE_LABELS` em `:31-34`), mais `data-entity-type` e a URL (`/pt/filmes/` vs `/pt/series/`, `person-presenter.ts:46-47,316-319`).

---

### 10.3 Modelo de dados

`packages/db/prisma/schema.prisma:356-377` (`Person` → tabela `people`):

| Coluna | Tipo | Populada pela ingestão real? |
| --- | --- | --- |
| `tmdb_id` | `Int @unique` | Sim (stub de crédito) |
| `imdb_id` | `String?` | **Não** — só via `importPerson` (`store.ts:314`) |
| `name` | `String` | Sim |
| `known_for_department` | `String?` | Sim |
| `gender` | `Int?` | Sim (persistido, **nunca renderizado**) |
| `birthday` | `Date?` | **Não** — só via `importPerson` |
| `deathday` | `Date?` | **Não** — só via `importPerson` |
| `place_of_birth` | `String?` | **Não** — só via `importPerson` |
| `profile_path` | `String?` | Sim |
| `biography_source_status` | `LicenseStatus @default(unknown)` | Fica no default; **nenhum código lê** (grep: só comentários em `person-presenter.ts:12,385` e `normalizers/person.ts:4`) |
| `last_synced_at` | `DateTime?` | Sim |

**Campos que simplesmente não existem no schema:** `biography` (texto), `popularity`, `homepage`, `also_known_as`, `birth_name`, `gender_label`. `popularity` e `homepage_url` existem em `Movie`/`TvShow` (`schema.prisma:180,192,237,278`), **não** em `Person`.

`CastMember` (`schema.prisma:383-399`): `person_id`, `entity_type` (polimórfico), `entity_id`, `character`, `billing_order`, `credit_id`. `CrewMember` (`schema.prisma:401-417`): idem, com `department` e `job` no lugar de `character`/`billing_order`.

---

### 10.4 A ingestão: o que ela realmente grava

Existem **dois** caminhos de escrita de pessoa, e eles não são equivalentes.

**(a) Stub de crédito** — `upsertPeopleStubs` (`services/ingestion/src/persistence/store.ts:54-91`), alimentado por `toPersonStub` (`normalizers/credits.ts:13-21`). Grava **apenas** `tmdbId`, `name`, `knownForDepartment`, `gender`, `profilePath`, `lastSyncedAt`. Sem `imdbId`, sem `birthday`, sem `deathday`, sem `placeOfBirth`. Sem `entity_external_ids`. Sem slug. Sem tradução. É este o caminho que `importMovie`/`importTvShow` disparam via `replaceCredits` (`store.ts:93-142`) — logo, **é o caminho que a ingestão pública real usa** (`ingest-public-catalog.ts:353,369`).

**(b) Detalhe completo** — `importPerson` (`services/ingestion/src/import/import-person.ts:10`) + `normalizePerson` (`normalizers/person.ts:26-49`) + `store.upsertPerson` (`store.ts:309-337`). Traz `imdbId`, `birthday`, `deathday`, `placeOfBirth` e grava `entity_external_ids` (`store.ts:330`). Passa por `api_cache` + `api_sync_logs` (`import-person.ts:15-59`) e por hash de payload (`result.changed`, `import-person.ts:23`) — respeita `.claude/rules/ingestion.md`. **Só é invocado por `services/ingestion/bin/import.ts:67`, com IDs passados à mão ou pelo seed dev `DEV_SEED_IDS.people = [287, 6193]` (`seed-ids.ts:19`)** — ou seja, 2 pessoas (Brad Pitt, Sean Bean).

**Nem (a) nem (b) criam slug ou `entity_translations` para pessoa.** Grep exaustivo: as únicas escritas de slug `person` no repo são `apps/admin/scripts/public-demo-seed.ts:359` (demo) e os scripts de validação `apps/web/scripts/validate-person-page-real-postgres.ts:237,239` e `validate-entity-indexes-real-postgres.ts:170`.

> **RISCO / BLOQUEIA PRODUCAO.** Toda a vertical de pessoas depende de um passo de slug que nenhum worker executa. A rota está publicada e linkada no header.

---

### 10.5 Tabela por feature (comparação com o que IMDb/TMDB expõem)

| Feature | Existe? | Status | Campo no schema / arquivo | **PROXIMO PASSO** |
| --- | --- | --- | --- | --- |
| **Foto (perfil)** | Sim | **PARCIAL** | `people.profile_path` (`schema.prisma:366`); render em `person-presenter.ts:218-224` e `[slug]/page.tsx:139-146`; card em `entity-index-presenter.ts:278-292` | Trocar `tmdbSize: "original"` (`person-presenter.ts:43`) por `w300`/`w500`; hoje o slot 300×450 baixa o arquivo original do TMDB. **DEBITO** de LCP |
| **Nome** | Sim | **REAL** | `people.name`; `selectPersonName` (`person-presenter.ts:227-232`) | — |
| **Nome original / alternativo** | Sim | **PARCIAL** | `selectPersonOriginalName` (`person-presenter.ts:238-247`) — só aparece se houver `entity_translations.title` divergente; a ingestão nunca cria essa tradução | Depende de 10.4; sem tradução pt-BR de pessoa, sempre `null` |
| **Biografia** | Não (como dado) | **NAO IMPLEMENTADO** | Não há coluna `biography` em `Person`. `normalizers/person.ts:4` documenta a ausência explicitamente | Decisão de licença humana (invariante 6) antes de qualquer coluna; hoje a seção "Biografia" (`[slug]/page.tsx:173-192`) renderiza `content_blocks` próprios, não bio de terceiro — **isto está correto** |
| **Bio curta / meta description** | Sim | **PLACEHOLDER** | `entity_translations.meta_description` → `view.metaDescription` (`person-presenter.ts:386`), usada como parágrafo de intro (`[slug]/page.tsx:166-168`) e como `description` do JSON-LD (`:118`) | Nenhuma ingestão a preenche; só o demo/validate. `summary` é deliberadamente **não** usado como bio (`person-presenter.ts:383-386`) por causa de `biography_source_status` — decisão correta, mantenha |
| **Data de nascimento** | Sim | **PARCIAL** | `people.birthday` → `birthDateIso` → `formatLifeLabel` (`person-presenter.ts:273-283`) e `Person.birthDate` no JSON-LD (`[slug]/page.tsx:113`) | Só populada por `importPerson` (caminho b). Chamar `importPerson` para as pessoas dos créditos no `ingest-public-catalog` |
| **Local de nascimento** | Sim | **PARCIAL** | `people.place_of_birth` → `view.placeOfBirth`; render em `metaItems` (`[slug]/page.tsx:84-86,163-165`) e `Person.birthPlace` (`:115-117`) | Idem acima |
| **Falecimento** | Sim | **PARCIAL** | `people.deathday` → `formatLifeLabel` produz `"1970–2020"` ou `"Falecimento: 2020"`; `Person.deathDate` (`[slug]/page.tsx:114`) | Idem acima |
| **Idade calculada** | Não | **NAO IMPLEMENTADO** (por decisão) | `person-presenter.ts:270-272` documenta: "Nunca calcula idade (mutável, não armazenada)" | Manter. Não é lacuna, é higiene |
| **Profissão / departamento** | Sim | **PARCIAL** | `people.known_for_department` → `mapKnownForDepartment` (`person-presenter.ts:254-260`), mapa pt-BR em `:66-79`. Valor fora do mapa → `null` (não vaza inglês) | Mapa cobre 12 departamentos TMDB; `"Editing"→"Edicao"` etc. Sem acentos (débito de copy) |
| **Filmografia (lista)** | Sim | **PARCIAL** | `resolveCredits` (`person-page.ts:198-227`) + `buildPersonCredits` (`person-presenter.ts:327-350`); render em `[slug]/page.tsx:194-231` | Sem paginação e **sem cap**: um ator prolífico renderiza N centenas de `<li>`. Adicionar limite + "ver mais" |
| **Créditos por filme/série** | Sim | **PARCIAL** | `cast_members` + `crew_members`, polimórficos (`schema.prisma:386-387,404-405`); só alvos `movie`/`tv` são resolvidos (`person-page.ts:235`) | `season`/`episode` como alvo de crédito são silenciosamente ignorados |
| **Papel (character)** | Sim | **REAL** (quando há dado) | `cast_members.character` → `roleLabel` (`person-page.ts:218`); na strip de elenco `cast-presenter.ts:121` | — |
| **Função de equipe (job)** | Sim | **PARCIAL + BUG** | `person-page.ts:222`: `const role = row.job ?? row.department` — valor **cru do TMDB, em inglês** ("Director", "Screenplay", "Original Music Composer") renderizado numa página pt-BR (`[slug]/page.tsx:223-225`) | Traduzir `job`/`department` com um mapa versionado, ou omitir. **RISCO** editorial (idioma) — **NAO BLOQUEIA PRODUCAO**, mas é visível |
| **Dedupe cast+crew do mesmo título** | Não | **DEBITO** | `resolveCredits` empurra cast e crew em sequência (`person-page.ts:217-225`); quem atua e dirige o mesmo filme aparece 2×. A `key` do React já prevê colisão com `index` (`[slug]/page.tsx:207`) | Agrupar por `(entityType, entityId)` e concatenar papéis |
| **Ordenação da filmografia** | Sim | **REAL** | Ano desc, nulos ao fim, desempate por título (`person-presenter.ts:343-348`) | — |
| **Popularidade** | Não | **NAO IMPLEMENTADO** | Não há `popularity` em `Person` (`schema.prisma:356-377`); existe em `Movie`/`TvShow` (`:237,278`) | Só adicionar se houver uso editorial; TMDB `popularity` é sinal volátil, não fato |
| **Notícias relacionadas** | Sim (código) | **PLACEHOLDER** | `getRelatedNewsForEntity(prisma, "person", id)` (`person-page.ts:136`, `related-news.ts:30,44`); render `RelatedNewsSection` (`[slug]/page.tsx:233`) | Não há ingestão de `articles` no repo (grep: `prisma.article.create` só em `apps/web/scripts/validate-*`). Sempre `[]` em produção |
| **SEO / schema `Person`** | Sim | **PARCIAL** | `[slug]/page.tsx:105-118`: `@type: Person`, `name`, `url`, `alternateName`, `jobTitle`, `birthDate`, `deathDate`, `birthPlace`, `description` | **Falta `image`** (a foto existe em `view.profile.src` e não vai para o JSON-LD) e **falta `sameAs`** |
| **`BreadcrumbList`** | Sim | **REAL** | `[slug]/page.tsx:90-103` (3 níveis) e índice `entity-index.tsx:48-55` (2 níveis) | — |
| **`CollectionPage` + `ItemList` (índice)** | Sim | **REAL** | `entity-index.tsx:57-75` | — |
| **Links externos (imdb id, homepage)** | Não no render | **NAO IMPLEMENTADO** | `people.imdb_id` (`schema.prisma:359`) e `entity_external_ids` (`store.ts:330`) existem; **nenhum** arquivo de `apps/web` os lê | Emitir `Person.sameAs: [imdb_url]` — mas checar licença/atribuição antes de linkar. Não existe coluna `homepage` para pessoa |
| **Breadcrumb visual** | Sim | **REAL** | `[slug]/page.tsx:123-133`, `entity-index.tsx:80-87` | — |
| **Canonical** | Sim | **PARCIAL** | `personCanonicalUrl` (`person-page.ts:44-46`) usa `SITE_URL` **hardcoded** `"https://thescreen.media"` (`site.ts:9`); metadata em `[slug]/page.tsx:64` e `page.tsx:36` | Canonical autorreferente e correto — mas o domínio não vem de env. Em domínio temporário (EasyPanel) o canonical aponta para outro host. **RISCO SEO**, já registrado no relatório de status |
| **`hreflang`** | Não | **NAO IMPLEMENTADO** (correto) | Nenhum `alternates.languages` nos dois arquivos | Só emitir quando houver en/es revisado (invariante 7 / `.claude/rules/i18n.md:5`) |
| **`noindex` de página fina** | Sim | **REAL** | `evaluatePersonIndexability` (`person-presenter.ts:352-364`) delega a `evaluateIndexability` de `@screena/seo`; limiar `MIN_PERSON_RENDERABLE_BLOCKS = 2` (`:60`); `robots` em `[slug]/page.tsx:61-63` | — |
| **Aviso "em revisão"** | Sim | **REAL** | `[slug]/page.tsx:235-241` (`data-editorial-state="in-review"`) | Aparece em **todas** as pessoas hoje (ver 10.6) |
| **Onde assistir / ratings na página de pessoa** | Não | **NAO IMPLEMENTADO** (correto) | Nada de `external_ratings` nem `watch_availability` toca a vertical de pessoa | Manter |

---

### 10.6 O gate anti-thin trava 100% das pessoas

`evaluatePersonIndexability` só devolve `index` com `renderableBlockCount >= 2` (`person-presenter.ts:60,361`). Blocos renderizáveis = `content_blocks` com `review_status ∈ {human_reviewed, published}`, conteúdo não-vazio, **um por `block_type`** (`person-presenter.ts:299-314`). Duplicata do mesmo tipo não infla a contagem — correto e alinhado a `.claude/rules/seo.md`.

Quem produz `content_blocks` de pessoa hoje?

| Produtor | Blocos por pessoa | Consequência |
| --- | --- | --- |
| `apps/admin/scripts/public-demo-seed.ts:361` (via `personBlocks`, `public-demo-seed-plan.ts:417-424`) | **1** (`editorial_intro`, `published`) | `1 < 2` → **`noindex` em todas as 3 pessoas demo** |
| Entity Writer (`services/entity-writer`) | **0** | `payload-source.ts:24-26` lança `"payload nao suportado na Fase 3A para entityType=person"` |
| Ingestão TMDB | **0** | Não gera texto |

O `enqueue-cli` do Entity Writer **aceita** `"person"` na lista de tipos (`services/entity-writer/src/runner/enqueue-cli.ts:24`) e o `inspect-cli` também (`inspect/inspect-cli.ts:22`), mas o `run-offline-cli` rejeita (`__tests__/run-offline-cli.test.ts:68` espera `kind === "error"`) e o `smoke-gemini` idem (`__tests__/smoke-gemini.test.ts:90`). **DEBITO**: a CLI oferece um tipo que o pipeline não sabe executar.

> **Conclusão dura:** hoje **nenhuma** `/pt/pessoas/[slug]/` chega a `index`, nem no seed demo. Toda página de pessoa exibe o aviso "Esta pagina ainda esta em revisao editorial." (`[slug]/page.tsx:238`). E como a listagem exige `MIN_INDEX_ITEMS = 3` (`entity-index-presenter.ts:25,349`), `/pt/pessoas/` só indexaria com 3+ pessoas com slug — o que só o demo entrega.
>
> Do ponto de vista de governança isto é **correto** (invariante 5 sendo obedecida). Do ponto de vista de produto, significa que **a vertical de pessoas não gera uma única URL indexável**.

---

### 10.7 Elenco nas páginas de filme/série

`getCastForEntity` (`apps/web/src/server/entity-cast.ts:37-79`):

- Lê `cast_members` filtrando por `(entityType, entityId)`, ordenando por `billing_order` asc (nulls last), com `take: 24` (`entity-cast.ts:31,44-45`).
- Busca slugs canônicos pt-BR das pessoas (`entity-cast.ts:58-66`).
- Passa para `buildCastStrip` com cap `DEFAULT_CAST_LIMIT = 12` (`cast-presenter.ts:34,78`).

`buildCastMemberView` (`cast-presenter.ts:113-125`): descarta entrada sem nome; `href` só quando há slug (`:122`); foto local segura **ou** URL remota TMDB (`:94-100`).

Render: `CastStrip` (`apps/web/app/_components/cast-strip.tsx:51`), montado em `/pt/filmes/[slug]` (`filmes/[slug]/page.tsx:263-265`) e `/pt/series/[slug]` (`series/[slug]/page.tsx:290-292`).

Status: **PARCIAL**. O elenco aparece com dado real ingerido do TMDB (nome + personagem + foto remota). Mas:

- **Sem slug de pessoa, o nome é texto morto** (`cast-strip.tsx:48`). Na base real ingerida, **todos** os nomes são texto morto.
- O `CastStrip` usa `heading="Elenco principal"` hardcoded nas duas páginas e `id="cast-strip-title"` fixo — só há uma faixa por página, ok.
- **Equipe / direção não aparece em nenhuma página de detalhe.** `crew_members` só é lido em `home-hero.ts:89` (`directorNameForEntity`, para a linha do hero) e em `person-page.ts:129-135`. Não há seção "Direção / Roteiro" em `/pt/filmes/[slug]` nem em `/pt/series/[slug]`. **NAO IMPLEMENTADO**.
- "Elenco comentado" (bloco de valor nº 9 do gate anti-thin, `CLAUDE.md` §9) **não existe**: a faixa é dado cru de catálogo, sem `cast_intro`. Ela **não conta** para o gate — e corretamente não é contada (`movie-indexability.ts:50-53` conta só `renderableBlockCount` de `content_blocks`).

---

### 10.8 Listagem `/pt/pessoas/`

`getPersonIndexData` (`entity-indexes.ts:184-215`) → `buildPersonIndexView` (`entity-index-presenter.ts:322-335`) → `buildPersonCard` (`:278-292`).

| Aspecto | Comportamento | Status |
| --- | --- | --- |
| Fonte | Slugs canônicos pt-BR `person` → `people` + `entity_translations` | **REAL** (código) / **PLACEHOLDER** (dado) |
| Ordem | Nome asc, determinístico (`entity-index-presenter.ts:331`) | **REAL** |
| Cap | `INDEX_ITEM_LIMIT = 24`, sem paginação (`:19,245`) | **DEBITO** |
| Card | Foto (`profile_path`, `tmdbSize: "original"`), nome, departamento traduzido; `screenScore: null` explicitamente (`:290-291`) | **REAL** |
| JSON-LD | `CollectionPage` + `ItemList` + `BreadcrumbList` (`entity-index.tsx:48-75`) | **REAL** |
| Gate | `MIN_INDEX_ITEMS = 3` → `noindex` abaixo disso (`:25,349`) | **REAL** |
| Estado vazio | `"Ainda nao ha pessoas publicados nesta secao."` — concordância errada (`entity-index.tsx:111-113` usa `breadcrumbLabel.toLowerCase()` + "publicados") | **DEBITO** cosmético |
| Cache | `force-dynamic` (`page.tsx:21`) — cada request bate no Postgres, sem ISR (a rota `[slug]` tem `revalidate = 3600`) | **DEBITO** de custo |

---

### 10.9 Sitemap

`sitemap-presenter.ts:314-322` inclui `input.people`, filtrando por `evaluatePersonIndexability(...).decision === "index"`. Como nenhuma pessoa atinge 2 blocos (10.6), **nenhuma pessoa entra no sitemap hoje**. O comportamento é consistente com `robots` da página (sitemap e meta tag não discordam — exigência de `.claude/rules/seo.md` §5). **REAL** (a mecânica), **PLACEHOLDER** (o resultado).

---

### 10.10 Cobertura de testes

| Arquivo | Linhas | O que trava |
| --- | --- | --- |
| `tests/web/person-presenter.test.ts` | 276 | Não inventar bio/função/datas/filmografia; gate anti-thin; imagens locais seguras; créditos só com título+slug |
| `tests/web/cast-presenter.test.ts` | 100 | Ordenação por `billing_order`, descarte sem nome, href só com slug |
| `services/ingestion/src/__tests__/person.test.ts` | — | `normalizePerson` (id, nome, `known_for_department`) |
| `apps/web/scripts/validate-person-page-real-postgres.ts` | 420+ | Validação contra Postgres real (slug canônico + alias, blocos por `review_status`, notícias relacionadas com `draft`/`noindex`) |

Cobertura de presenter é boa. **Não há teste que trave a lacuna real**: nenhum teste afirma "a ingestão pública deve criar slug de pessoa". A falha de 10.4 passa por todos os gates de CI.

---

### 10.11 Dívidas e riscos consolidados

| # | Item | Severidade |
| --- | --- | --- |
| 1 | `ingest-public-catalog.ts` não cria slug/tradução pt-BR de pessoa → `/pt/pessoas/` vazia e cast sem link na base real | **BLOQUEIA PRODUCAO** |
| 2 | `/pt/pessoas/` está no menu primário (`navigation.ts:31`) e no `/pt/explorar` apontando para seção vazia | **BLOQUEIA PRODUCAO** (UX/SEO) |
| 3 | Nenhuma pessoa atinge `>= 2` blocos → 0 URLs indexáveis; demo entrega 1 bloco | **NAO BLOQUEIA PRODUCAO** (é a invariante 5 funcionando), mas anula a vertical |
| 4 | Entity Writer rejeita `entityType=person` (`payload-source.ts:24-26`) mas `enqueue-cli` o aceita | **NAO BLOQUEIA PRODUCAO** |
| 5 | `job`/`department` de crew renderizados crus em inglês na filmografia pt-BR (`person-page.ts:222`) | **NAO BLOQUEIA PRODUCAO** |
| 6 | Fotos de perfil usam `tmdbSize: "original"` em slots 200×300 / 300×450 (`cast-presenter.ts:31`, `person-presenter.ts:43`, `entity-index-presenter.ts:31`) | **NAO BLOQUEIA PRODUCAO** (LCP/banda) |
| 7 | Filmografia sem cap nem paginação; sem dedupe cast+crew do mesmo título | **NAO BLOQUEIA PRODUCAO** |
| 8 | `Person` JSON-LD sem `image` e sem `sameAs` (o `imdb_id` existe no banco e não é usado) | **NAO BLOQUEIA PRODUCAO** |
| 9 | `SITE_URL` hardcoded (`site.ts:9`) contamina canonical/breadcrumb de pessoa em domínio temporário | **BLOQUEIA PRODUCAO** (já reportado em outras partes) |
| 10 | `biography_source_status` existe no schema e nenhum código lê — contrato dormente | **NAO BLOQUEIA PRODUCAO** |
| 11 | Notícias relacionadas de pessoa: código pronto, zero dado (não há ingestão de `articles`) | **NAO BLOQUEIA PRODUCAO** |
| 12 | `force-dynamic` no índice de pessoas (sem ISR) | **NAO BLOQUEIA PRODUCAO** |
| 13 | Créditos com alvo `season`/`episode` são descartados silenciosamente (`person-page.ts:235`) | **NAO BLOQUEIA PRODUCAO** |

---

### 10.12 **PROXIMO PASSO** (ordem recomendada)

1. **Fechar o loop de slug de pessoa.** Estender `ingest-public-catalog.ts` (ou criar `finalizePerson`) para, após `importMovie`/`importTvShow`, iterar as pessoas dos créditos e criar `slugs` (`person`, `pt-BR`, `is_canonical`) + `entity_translations` (`title = people.name`). Idempotente, com colisão de slug resolvida por sufixo estável (`-tmdb-{id}`), como já se faz para títulos (`ingest-public-catalog.ts:170-177`). Sem isso, tudo o mais é decorativo.
2. **Chamar `importPerson` para as pessoas com página.** Só o caminho (b) traz `birthday`/`deathday`/`place_of_birth`/`imdb_id`. Rodar em lote, respeitando `api_cache`/`api_sync_logs`/breaker que `import-person.ts` já implementa.
3. **Decidir a política de indexação da vertical.** Ou (a) habilitar `person` no Entity Writer (`payload-source.ts` + prompt versionado) para produzir `editorial_intro` + um segundo bloco (ex.: `cast_intro`/`franchise_context`), sempre com revisão humana; ou (b) assumir que pessoas são `noindex` por design nesta fase e **remover "Pessoas" do menu primário**, mantendo-as só como destino de link interno a partir do elenco. Não fazer nada é a pior opção — hoje o site publica uma porta de entrada vazia.
4. **Traduzir `job`/`department`** de crew num mapa versionado (espelhando `KNOWN_FOR_DEPARTMENT_LABELS`) ou omitir o `roleLabel` quando não houver tradução, seguindo a mesma regra de "nunca vaza inglês" já aplicada em `mapKnownForDepartment` (`person-presenter.ts:259`).
5. **Corrigir o tamanho das imagens de perfil** (`original` → `w300`) nos três presenters.
6. **Adicionar `image` e (após decisão de licença) `sameAs`** ao JSON-LD `Person`.
7. **Cap + dedupe na filmografia**, e agrupamento por papel (`Atuação` / `Direção` / `Roteiro`).
8. **Teste de governança** que falhe se a ingestão pública criar `cast_members` sem criar slug canônico da pessoa correspondente — a lacuna atual deveria ter sido pega pelo CI.

---

### 10.13 O que NÃO FOI POSSÍVEL CONFIRMAR

- **Estado do banco de produção (EasyPanel).** A auditoria é estática. Afirmo com base no código que `ingest-public-catalog.ts` não escreve slug de pessoa; **NAO FOI POSSÍVEL CONFIRMAR** por consulta ao Postgres real que a tabela `slugs` esteja de fato sem linhas `entity_type='person'`. Faltou acesso ao banco (a auditoria é read-only e proibida de conectar).
- **Se o operador rodou `apps/admin/scripts/public-demo-seed.ts` em produção.** Se rodou, `/pt/pessoas/` mostra 3 pessoas fictícias marcadas com `PUBLIC_DEMO_MARKER` — o que seria **RISCO** de conteúdo fabricado em superfície pública. **NAO FOI POSSÍVEL CONFIRMAR**.
- **Se `bin/import.ts --person` foi executado** para os IDs 287/6193 (`seed-ids.ts:19`). Mesmo se sim, sem slug essas pessoas não têm página.
- **Comportamento real do `<img>` remoto sob CSP** do host de produção. Não executei o app.


---

## Parte 11 — Noticias e camada editorial

### 11.0 Veredito em uma frase

O Screen tem uma **camada de apresentacao de noticias tecnicamente bem construida e governada** (rotas, presenter puro, gate de licenca, gate anti-thin, JSON-LD `NewsArticle`, `generateMetadata`, relacionamento noticia↔entidade), mas **nao tem nenhuma noticia**: **nao existe uma unica linha de codigo de producao que crie `Article` ou `ArticleTranslation`**. O pipeline de ingestao editorial (RSSPRIME / MN26) e **NAO IMPLEMENTADO** — o que existe e um `README.md` sem codigo (`services/news-ingestion/`) e um stub Python que so imprime "nao implementado" (`workers/rssprime_worker.py:40`). A tabela `news_clusters` **nao existe** no Prisma. O bloco de Noticias da Home cai em manchetes fabricadas (`Oppenheimer`, `Duna`, `Stranger Things`) quando nao ha artigo real, gateadas por ambiente.

Traduzindo: **o vaso esta pronto e vazio.** O que aparece hoje em `/pt/noticias/` num banco de producao real e a mensagem "Ainda nao ha noticias publicadas nesta secao." (`apps/web/app/pt/noticias/page.tsx:119-121`).

---

### 11.1 Inventario de superficie

| Item | Caminho | Status |
| --- | --- | --- |
| Listagem `/pt/noticias/` | `apps/web/app/pt/noticias/page.tsx` (135 linhas) | **REAL** (codigo) / **PLACEHOLDER** (dado: zero artigos) |
| Detalhe `/pt/noticias/[slug]/` | `apps/web/app/pt/noticias/[slug]/page.tsx` (204 linhas) | **REAL** (codigo) / sem dado |
| Camada de dados server-only | `apps/web/src/server/news-pages.ts` (320 linhas) | **REAL** |
| Presenter puro | `apps/web/src/lib/news-presenter.ts` (417 linhas) | **REAL** |
| Noticias relacionadas (entidade → artigos) | `apps/web/src/server/related-news.ts` (102) + `apps/web/src/lib/related-news-presenter.ts` (42) | **REAL** (codigo), sem dado |
| Componente de card | `apps/web/app/_components/news-card.tsx` | **REAL** |
| Secao "Noticias relacionadas" nas fichas | `apps/web/app/_components/related-news-section.tsx` | **REAL** |
| Entrada de noticia no sitemap | `apps/web/src/server/seo/sitemap-entries.ts:194-230`, `apps/web/src/lib/sitemap-presenter.ts:186-225` | **REAL** |
| Ingestao de noticias | `services/news-ingestion/` — **so `README.md` (33 linhas)**, sem `package.json`, sem `src/`, sem `bin/` | **NAO IMPLEMENTADO** |
| Worker RSSPRIME | `workers/rssprime_worker.py` — stub Fase 0 (`logger.info("rssprime_worker: Fase 0: nao implementado")`, linha 40) | **NAO IMPLEMENTADO** |
| Clusters de noticia (`news_clusters`) | ausente do Prisma; `database/schema.md:62` diz "planejada para fases futuras; ainda nao existe no Prisma atual" | **NAO IMPLEMENTADO** |
| Admin: listar artigos | `apps/admin/src/server/articles.ts:101-102` (`count`/`findMany`) | **REAL** (read-only) |
| Admin: publicar/indexar artigo | `apps/admin/src/server/editorial-actions.ts:85-113` (`articleTranslation.update` de `reviewStatus`/`indexStatus`, atras de flag) | **PARCIAL** |
| Admin: criar artigo | nao existe | **NAO IMPLEMENTADO** |

Comparativo com os irmaos de `services/`: `ingestion`, `sync` e `entity-writer` tem `package.json` + `src/` + `bin/`. `news-ingestion`, `ratings` e `streaming` tem **apenas `README.md`**. O README de `news-ingestion` descreve em detalhe um servico que nao existe ("Le feeds do RSSPRIME", "Agrupa noticias relacionadas em `news_clusters`", `services/news-ingestion/README.md:8-12`) — **e documentacao de roadmap escrita em tempo presente**, o que e, por si so, um **RISCO** de leitura errada do estado do projeto.

---

### 11.2 Existem noticias reais no pipeline? Quem escreve `Article`/`ArticleTranslation`?

Grep exaustivo por escrita em `article` / `articleTranslation` / `entityNewsLink` em todo o codigo TS/TSX (excluindo `node_modules` e `.next`):

| Arquivo que escreve | Natureza | Producao? |
| --- | --- | --- |
| `apps/web/scripts/validate-news-pages-real-postgres.ts:107,125,142` | Harness de validacao contra PostgreSQL **efemero embutido** (`EmbeddedPostgres`, `mkdtempSync`, derrubado no `finally`, linhas 268-316) | Nao |
| `apps/web/scripts/validate-movie-page-real-postgres.ts:103,111,123` | Idem (fixture para provar "noticias relacionadas" na ficha de filme) | Nao |
| `apps/web/scripts/validate-series-page-real-postgres.ts:84,92,104` | Idem | Nao |
| `apps/web/scripts/validate-person-page-real-postgres.ts:88,96,108` | Idem | Nao |
| `apps/admin/src/server/editorial-actions.ts:98,103,210` | **Somente `update`** de `reviewStatus`/`indexStatus` de uma traducao ja existente | Sim, mas nao cria |

**Nenhum outro `create`/`upsert` de `Article`, `ArticleTranslation` ou `EntityNewsLink` existe no repositorio.** Confirmado tambem que:

- `packages/db/prisma/seed.ts` **nao** semeia noticias (grep por `article|notic|news` retorna vazio).
- `apps/admin/scripts/staging-seed.ts` e `apps/admin/scripts/public-demo-seed.ts` **nao** semeiam noticias (mesmo grep, vazio).
- `services/ingestion` (TMDB) nao toca `articles`.

Consequencia direta e verificavel: **num banco de producao (o do EasyPanel), `article_translations` esta vazio.** `getNewsIndexData()` retorna `totalCount = 0`, `featured = null`, a listagem renderiza o `<p className="news-index__empty">` e `evaluateNewsIndexIndexability({ itemCount: 0 })` devolve `noindex` (`apps/web/src/lib/news-presenter.ts:380-392`). Nao ha risco de indexar lixo; ha risco de **secao publica vazia no menu** (`apps/web/src/lib/navigation.ts:32` linka "Notícias" no header).

Status consolidado: **PLACEHOLDER** no sentido de dado (nem seed demo existe — pior que seed, e vazio total), **REAL** no sentido de codigo.

> Correcao a um mal-entendido comum: os quatro `validate-*-real-postgres.ts` **nao** sao seeds. Eles sobem um Postgres embarcado num diretorio temporario, rodam `prisma migrate deploy`, criam fixtures, checam ~19 asserts e destroem tudo (`apps/web/scripts/validate-news-pages-real-postgres.ts:267-325`). Nenhum dado deles sobrevive.

---

### 11.3 Gate de licenca — existe e e restritivo (invariante 6)

Sim, existe, e e a parte mais solida desta fatia.

**Defaults seguros no schema** (`packages/db/prisma/schema.prisma`):

```
751:  licenseStatus       LicenseStatus @default(unknown) @map("license_status") // default seguro (inv. 6)
752:  displayAllowed      Boolean       @default(false) @map("display_allowed") // gate-mestra de exibicao
776:  reviewStatus    ReviewStatus  @default(draft) @map("review_status")
777:  indexStatus     IndexDecision @default(noindex) @map("index_status")
```

Um artigo inserido "no bruto" (por SQL manual, por exemplo) **nasce invisivel**: `unknown` + `display_allowed=false` + `draft` + `noindex`.

**Gate de publicacao** (`apps/web/src/lib/news-presenter.ts:249-265`), aplicado tanto na listagem (via `buildNewsCard`, linha 274) quanto no detalhe (`apps/web/src/server/news-pages.ts:152-164`, que faz `return null` → `notFound()`):

- `reviewStatus ∈ {human_reviewed, published}` (`news-presenter.ts:20`);
- `licenseStatus ∈ {official, licensed, third_party}` (`news-presenter.ts:24`) — `unknown` e `blocked` sao rejeitados;
- `displayAllowed === true`;
- `slug`, `title` e `publishedAt` reais (nao vazios).

O mesmo predicado e reusado pelo sitemap (`apps/web/src/lib/sitemap-presenter.ts:186-198`) e pelas noticias relacionadas (`apps/web/src/lib/related-news-presenter.ts:32`), de modo que **um artigo bloqueado nao aparece em nenhuma superficie** — nem card, nem detalhe, nem sitemap, nem "Leia tambem". Testado em `tests/web/news-presenter.test.ts:143` e `tests/web/related-news-presenter.test.ts:43`.

**Imagem hero** so aceita caminho **local seguro** (`/media/`, `/uploads/`, `/brand/` + extensao de imagem), rejeitando `http(s)://`, `//`, `?`, `#`, `\`, `..` (`news-presenter.ts:178-188`). URL externa vira `null` → fallback visual. Isso impede hotlink nao licenciado de imagem de terceiro.

#### 11.3.1 O buraco: atribuicao e linkback nunca sao renderizados — **RISCO**

`Article` tem `sourceName`, `sourceUrl`, `requiresAttribution`, `requiresLinkback` (`schema.prisma:749-754`). O que o codigo faz com eles:

- `requiresAttribution` — **lido do banco e passado ao presenter (`news-pages.ts:180`) e nunca usado em lugar nenhum.** Grep em `apps/`/`packages/` confirma: nenhuma leitura de `facts.requiresAttribution`.
- `sourceUrl` — **selecionado (`news-pages.ts:136`), tipado (`news-presenter.ts:66`), e nunca renderizado.** Nao existe `<a href={sourceUrl}>` em lugar algum.
- `requiresLinkback` — usado uma unica vez, e de forma **invertida em relacao a regra**:

```ts
// apps/web/src/lib/news-presenter.ts:357-358
const source: NewsArticleSource | null =
  sourceName !== null && facts.requiresLinkback === false ? { name: sourceName } : null;
```

Ou seja: se a licenca **exige** linkback, o codigo **esconde o credito da fonte** e **continua exibindo o artigo inteiro**. `.claude/rules/ratings.md:§5` e `.claude/rules/entity-writer.md:§4` dizem o oposto — `requires_linkback = true` → `attribution_url` **obrigatorio e renderizado como link**; sem ele, o dado **nao e exibido**. O comentario do proprio arquivo (linhas 354-356) admite a escolha ("linkback clicavel fica fora daqui"), mas a escolha degrada para o lado errado: preserva a exibicao e sacrifica o credito.

Hoje isso e inofensivo (zero artigos). No dia em que um artigo `third_party` com `requires_linkback=true` entrar, a pagina publica exibe corpo + hero + data sem creditar a fonte. **DEBITO** / **RISCO** legal.
Criticidade: **NAO BLOQUEIA PRODUCAO** hoje (tabela vazia); **BLOQUEIA PRODUCAO** no instante em que qualquer artigo de terceiro for ingerido.

**PROXIMO PASSO**: ou (a) renderizar `attribution_text`/`sourceUrl` como link quando `requiresAttribution`/`requiresLinkback`, ou (b) incluir `requiresLinkback && sourceUrl === null` no `isPublishableArticle` para bloquear a exibicao. Nunca (c) manter o estado atual.

---

### 11.4 RSS Prime — nao e feed do Screen, e nao existe como codigo

**Confirmado por leitura de todo o codigo que menciona o termo.** Ocorrencias de `RSSPRIME` no repositorio:

| Arquivo | O que e |
| --- | --- |
| `workers/rssprime_worker.py` | Stub. Docstring de 25 linhas + `main()` que so faz `logger.info("rssprime_worker: Fase 0: nao implementado")` (linha 40). Explicitamente: "Nesta fase NAO ha cliente HTTP, nem parsing de feed, nem acesso a banco" (linha 25). |
| `services/news-ingestion/README.md:3-12` | Descricao em tempo presente de um servico inexistente. |
| `workers/requirements.txt:10` | Comentario: `httpx  # cliente HTTP assincrono para ingestao (TMDB, ratings, streaming, RSSPRIME)` — dependencia **declarada e nao instalada** ("Fase 0: estas dependencias sao apenas DECLARADAS. NAO instale agora"). |
| `workers/scheduler.py:35` | Comentario de timer planejado: `# screena-rssprime.timer -> OnUnitActiveSec=15min`. Nenhum timer real. |
| `docs/BUILD_PLAN.md:53,305,311` | Fase 9 — status "Planejada". |
| `.claude/rules/ingestion.md:49`, `.claude/rules/seo.md:64` | Governanca: "RSSPRIME/MN26 continuam como roadmap/produto inativo". |

E a governanca do proprio projeto ja o classifica corretamente: **RSSPRIME e transporte/upstream tecnico, nunca fonte editorial do Screen** — `workers/rssprime_worker.py:18-19` ("provider_api != fonte editorial: RSSPRIME e o transporte/upstream tecnico, nao a fonte editorial da Screena"). Nao ha nenhum arquivo que trate RSSPRIME como feed proprio do Screen. **A afirmacao "RSS Prime nao e feed do Screen" esta correta e o codigo nao a contradiz.**

Nao consegui inspecionar `.env.example` (leitura negada pelo sistema de permissoes nesta sessao). **NAO FOI POSSIVEL CONFIRMAR** se existe alguma variavel de ambiente `RSS*`/`NEWS*` declarada la. Como nao existe nenhum consumidor dessas variaveis no codigo TS ou Python, a existencia ou nao delas nao altera o veredito.

---

### 11.5 MN26 — outro pipeline editorial, herdado apenas conceitualmente

Nao ha **nenhuma linha de codigo** de integracao MN26. Todas as ocorrencias sao (a) documentacao ou (b) comentarios negativos ("nao chama MN26"):

| Arquivo:linha | Tipo |
| --- | --- |
| `docs/ENTITY_WRITER.md:25` | "O Entity Writer e o motor editorial **derivado do MN26**, adaptado para o mundo [entity-first]" |
| `docs/ENTITY_WRITER.md:57-77` | Tabela "Diferenca para o MN26 News": MN26 = `RSSPRIME → clusters → articles`; Entity Writer = `PostgreSQL → payload → Gemini → content_blocks` |
| `docs/BUILD_PLAN.md:54,325,331` | Fase 10 — "MN26 News", status **Planejada** |
| `apps/web/src/server/news-pages.ts:6` | Comentario: "Nao chama TMDB, Gemini, WordPress, MN26 ou qualquer API externa" |
| `apps/web/src/server/related-news.ts:7`, `apps/web/src/server/seo/sitemap-entries.ts:6`, `apps/web/app/pt/noticias/[slug]/page.tsx:12` | Idem |
| `CLAUDE.md:21`, `AGENTS.md:18` | "Ainda **nao** estao funcionais como produto: ... RSSPRIME/MN26" |

Portanto: **MN26 e um pipeline editorial separado (externo ao Screen), do qual o Entity Writer herdou disciplina de prompt/versionamento, e nada mais.** O Screen **nao tem editorial real integrado**. O unico gerador editorial que roda hoje e o Entity Writer, e ele produz **apenas `editorial_intro` e `cast_intro`** (`services/entity-writer/src/pipeline/run-generation.ts:66` — `const BLOCK_FIELDS: readonly Phase3aBlockType[] = ["editorial_intro", "cast_intro"]`), nunca `news_context` (que existe no enum `ContentBlockType`, `schema.prisma:47`, mas nao e gerado por ninguem).

Status: **NAO IMPLEMENTADO** para RSS Prime e MN26. Nao ha nada a "reativar" — ha que construir.

---

### 11.6 Relacionamento noticia ↔ entidade (`EntityNewsLink`)

**REAL como codigo, exercitado apenas em teste efemero.** Funciona nos dois sentidos:

**Artigo → entidades** (`apps/web/src/server/news-pages.ts:215-320`, `resolveRelated`):
1. le `entityNewsLink` por `articleId` (linha 219);
2. separa por `entityType ∈ {movie, tv, person}` (linhas 228-232) — outros tipos sao ignorados (linha 244);
3. resolve titulo via `entityTranslation` pt-BR com fallback para `titleOriginal`/`nameOriginal`/`name` (linhas 283-319);
4. resolve `slug` canonico pt-BR (`isCanonical: true`, linha 270);
5. `buildNewsRelated` (`news-presenter.ts:328-339`) **descarta qualquer alvo sem titulo OU sem slug** — nunca inventa link.

Isso e validado pelo harness: alvo `person` deliberadamente semeado **sem slug** e omitido, e so o `movie` com slug aparece (`apps/web/scripts/validate-news-pages-real-postgres.ts:254`, check 15).

**Entidade → artigos** (`apps/web/src/server/related-news.ts:42-102`): parte da entidade, reusa o mesmo gate de publicacao via `buildNewsCard`, **e adiciona um filtro extra** `indexStatus === "index"` (`related-news.ts:61` no SQL e `related-news-presenter.ts:32` no presenter). Wired em `movie-page.ts:118`, `series-page.ts:135`, `person-page.ts:136`. Lista vazia → a secao inteira desaparece (`related-news-section.tsx:20`).

Ponto importante de governanca: **"noticias relacionadas" NAO conta para o gate anti-thin das fichas.** `evaluateMovieIndexability` recebe apenas `renderableBlockCount` de `content_blocks` (`apps/web/src/server/movie-page.ts:144-146`, `apps/web/src/lib/movie-indexability.ts:49-61`). Ou seja, um filme nao vira `index` por ter noticias grudadas nele. Correto e conservador.

`news_clusters`: **NAO IMPLEMENTADO**. Nao existe `model NewsCluster` em `packages/db/prisma/schema.prisma`; `database/schema.md:62` reconhece explicitamente. O README de `news-ingestion` promete cluster (`README.md:9`) e o `workers/rssprime_worker.py:11` tambem — ambos descrevem tabela inexistente.

---

### 11.7 JSON-LD e `generateMetadata`

**Ambos existem. REAL.**

| Rota | `generateMetadata` | JSON-LD emitido |
| --- | --- | --- |
| `/pt/noticias/` | `apps/web/app/pt/noticias/page.tsx:25-36` | `CollectionPage` (+ `mainEntity: ItemList` so quando ha itens, linhas 61-72) e `BreadcrumbList` (linhas 45-52) |
| `/pt/noticias/[slug]/` | `apps/web/app/pt/noticias/[slug]/page.tsx:34-63` | **`NewsArticle`** (linhas 90-105) e `BreadcrumbList` (linhas 80-88) |

Detalhes verificados:

- **robots** derivado da decisao de indexabilidade, nao hardcoded: `robots: shouldIndex ? {index:true,follow:true} : {index:false,follow:false}` (`page.tsx:31-33`; `[slug]/page.tsx:56-58`).
- **canonical absoluto e autorreferente**: `${SITE_URL}/pt/noticias/${slug}/` (`news-pages.ts:55-57`), validado no harness (check 11: `https://thescreen.media/pt/noticias/noticia-rica/`).
- Slug inexistente ou artigo nao publicavel → `generateMetadata` retorna `robots: noindex` **e** a pagina faz `notFound()` (`[slug]/page.tsx:42-47, 72`).
- `NewsArticle` so inclui campos que existem: `datePublished`, `description`, `author` (`Person`), `articleSection`, `image` — cada um sob `if (... !== null)` (linhas 96-105). **Nao fabrica dado.** Nenhum `AggregateRating`, nenhum `Review`. Coerente com `.claude/rules/seo.md:§9`.

**DEBITO (SEO, NAO BLOQUEIA PRODUCAO)** no `NewsArticle`:
- sem `publisher` (`Organization` com logo) — o Google trata como sinal fraco para Top Stories;
- sem `dateModified` (a coluna `updated_at` existe, `schema.prisma:780`);
- sem `mainEntityOfPage`;
- `image` so quando ha hero **local**; como o projeto migrou o catalogo para imagens **remotas** da TMDB (`apps/web/src/lib/tmdb-image-url.ts`), o presenter de noticias ficou local-only e divergente do resto (`docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:496` registra a mesma divergencia). Em pratica, sem `/media/news/*.webp` no disco, **toda noticia sai sem imagem**.
- Nenhum `hreflang`/`alternates.languages` e emitido — correto no MVP (so pt-BR publicado), coerente com `.claude/rules/i18n.md:§5`.

---

### 11.8 Indexabilidade de noticia (`evaluateArticleIndexability` / `evaluateNewsIndexIndexability`)

Ambas existem em `apps/web/src/lib/news-presenter.ts` e delegam a `evaluateIndexability` de `@screena/seo` (`packages/seo/src/indexability.ts`), sem reimplementar a regra.

**Artigo** (`news-presenter.ts:398-417`):

```ts
const base = evaluateIndexability({
  language: "pt-BR",
  hasReliableStructuredData: true,
  valueBlocksCount: input.bodySufficient ? 2 : 0,
  displayedRatings: [],
  thinContentScore: input.bodySufficient ? 0 : 1,
  reviewStatusOk: input.reviewStatusOk,
});
if (base.decision === "index" && input.indexStatus !== "index") { ...noindex... }
```

- `bodySufficient` = corpo com `>= 200` chars apos trim (`MIN_ARTICLE_BODY_CHARS`, linha 33). Corpo fino → `valueBlocksCount = 0` e `thinContentScore = 1 > THIN_THRESHOLD (0.5)` → **`noindex`** (invariante 5). Testado: `tests/web/news-presenter.test.ts:186`.
- A **decisao editorial `index_status` tem palavra final**: mesmo corpo rico, se `index_status != 'index'` → `noindex` (linhas 409-415; teste na linha 198). Agente/codigo nunca promove artigo a `index` sozinho — so um humano no admin (`editorial-actions.ts:103`) muda `indexStatus`. Alinhado com a invariante 12 em espirito e com `.claude/rules/seo.md:§3`.
- **Observacao critica sobre a modelagem**: `valueBlocksCount: bodySufficient ? 2 : 0` **finge** dois blocos de valor a partir de um unico sinal (comprimento do corpo). Nao ha contagem real de blocos (`countValueBlocks` de `packages/seo/src/value-blocks.ts` **nao** e usada aqui). Um artigo de 201 caracteres, sem FAQ, sem relacionados, sem nada, satisfaz o gate anti-thin. Isso e um **DEBITO** de rigor: o gate existe, mas com um proxy generoso. **NAO BLOQUEIA PRODUCAO** (nenhum artigo hoje), mas convida a thin content em escala.
- `reviewStatusOk` e passado **hardcoded `true`** (`news-pages.ts:200`; `sitemap-presenter.ts:208`). E seguro **apenas porque** `isPublishableArticle` ja rejeitou reviews nao publicaveis antes (`news-pages.ts:152-164`; `sitemap-presenter.ts:204`). E um acoplamento implicito: se alguem chamar `evaluateArticleIndexability` sem o gate anterior, o parametro mente. **DEBITO** de design.

**Listagem** (`news-presenter.ts:380-392`): `valueBlocksCount = itemCount` e `thinContentScore = itemCount >= 3 ? 0 : 1`. Logo `/pt/noticias/` so indexa com `>= 3` artigos publicaveis.

- **DEBITO / RISCO SEO (NAO BLOQUEIA PRODUCAO hoje)**: `isPublishableArticle` **nao exige corpo suficiente**. Consequencia logica: com 3 artigos publicaveis porem **finos** (`body` curto, `index_status='index'` nem sequer necessario para a contagem), a **listagem `/pt/noticias/` vira `index` e entra no sitemap** (`sitemap-presenter.ts:237-263`), enquanto **as 3 paginas de detalhe sao `noindex`**. Isso cria um hub indexado cujos links todos apontam para paginas noindex — exatamente o padrao de "thin hub" que a invariante 5 quer evitar. Nao encontrei teste cobrindo esse cenario.
- Prova parcial do contrario nao existe: `tests/web/news-presenter.test.ts:178` so testa "vazia/fina -> noindex; suficiente -> index" pela contagem, sem cruzar com o corpo.

**Pureza de render (invariantes 3 e 4)**: confirmada. `news-pages.ts` e `related-news.ts` importam somente `@screena/db/server` e `react.cache`; nenhum `fetch`, nenhum client TMDB, nenhum Gemini. As duas rotas sao `export const dynamic = "force-dynamic"` (`page.tsx:19`; `[slug]/page.tsx:20`) — leem Postgres a cada request, sem ISR. Nao ha `api_cache`/`api_sync_logs` envolvidos porque **nao ha sync de noticia nenhum** (o requisito "todo sync gera log" de `.claude/rules/ingestion.md` e vacuamente satisfeito).

---

### 11.9 O bloco de Noticias na Home e placeholder?

**Sim — PLACEHOLDER com degradacao gateada por ambiente.**

`apps/web/app/pt/page.tsx`:

- `getHomeData()` chama `getNewsIndexData()` real (linha 83) e monta `newsCards` a partir de artigos publicaveis (linhas 89-95).
- Se **existe** pelo menos um artigo real (`firstNews !== undefined`, linha 561), o destaque e a grade 2x2 usam dado real (linhas 562-598).
- Se **nao existe** (o caso de hoje), cai em constantes fabricadas:

```ts
// apps/web/app/pt/page.tsx:185-191
const HOME_FEATURED_NEWS: HomeNewsFeature = {
  badge: "Em alta esta semana",
  title: "Por que Oppenheimer dominou a temporada de prêmios",
  sub: "A leitura de Nolan sobre ciência, culpa e poder rendeu o maior sucesso adulto do ano.",
  href: NEWS_INDEX_PATH,
  image: null,
};
```
mais `HOME_GRID_NEWS` com 4 manchetes fabricadas ("Duna: onde Feyd-Rautha se encaixa, explicado", "Bilheteria: Arthur, o Rei faz US$ 825 mil em previas", "Stranger Things: o que esperar da temporada final") — `page.tsx:193-218`. Todas linkam para `/pt/noticias/` (indice real), nenhuma para um artigo inexistente.

**O gate**: `apps/web/src/lib/home-placeholder-governance.ts:44-51`

```ts
export function allowHomeVisualPlaceholders(env = {nodeEnv: process.env.NODE_ENV, flag: process.env.SCREEN_HOME_VISUAL_PLACEHOLDERS}): boolean {
  return env.nodeEnv !== "production" || env.flag === "1";
}
```

e a renderizacao: `{hasRealNews || allowPlaceholders ? (<section className="home-v4-news">...) : null}` (`page.tsx:826-846`).

Avaliacao honesta:

- Em **producao sem a flag**, a secao inteira de Noticias **desaparece** da home. Nao ha manchete falsa em producao. Isso e correto.
- O gate e **server-side** e a flag **nao** e `NEXT_PUBLIC_*` — nao vaza para o bundle.
- Coberto por `tests/web/home-placeholder-governance.test.ts`.
- **RISCO residual**: `SCREEN_HOME_VISUAL_PLACEHOLDERS=1` em producao (ou `NODE_ENV` mal setado no container do EasyPanel) publica manchetes inventadas sobre pessoas e obras reais numa pagina indexavel. E a mais sensivel das dividas visuais — o proprio comentario do codigo diz isso (`page.tsx:168`: "E a mais sensivel das dividas visuais (conteudo editorial)"). **NAO BLOQUEIA PRODUCAO** desde que a flag permaneca ausente e `NODE_ENV=production`.
- Os placeholders **nao inflam a indexabilidade**: `evaluatePortalIndexability` conta `newsCards.length` (reais), nao os mocks (`page.tsx:103-109`).
- Nada disso vira JSON-LD: a home nao emite `ItemList` de noticias.

Contexto vizinho (nao e desta parte, mas contamina a leitura de "noticias"): a mesma home tem chips de plataforma fabricados (`HOME_VISUAL_PLATFORMS`, `page.tsx:133-144`) e um trilho "Em breve" cujos itens `HOME_COMING_SOON_ITEMS` (`page.tsx:153-160`) tambem sao mock — esses **nao** estao no escopo desta secao, mas compartilham o mesmo gate.

---

### 11.10 Testes existentes

| Arquivo | Cobertura | Natureza |
| --- | --- | --- |
| `tests/web/news-presenter.test.ts` (274 linhas, 16 `it`) | imagem local/externa, formatadores, gate de publicacao, ordenacao, indexabilidade de artigo e de listagem, "nao inventa autor/data/imagem", fonte so sem linkback | Unitario puro |
| `tests/web/related-news-presenter.test.ts` (94 linhas, 6 `it`) | filtro `index`, descarte de nao publicaveis, imagem, ordenacao, limite, lista vazia | Unitario puro |
| `apps/web/scripts/validate-news-pages-real-postgres.ts` | 19 checks contra Postgres embarcado efemero: rascunho→404, display bloqueado→404, fino→noindex, imagem crua→null, rico→index, canonical, relacionado sem slug omitido, listagem `>=3`→index, featured mais recente | Harness manual (`pnpm --filter @screena/web validate:news-pages`), **nao roda no CI de teste** |

Nao ha teste de governanca dedicado a noticias em `tests/governance/`. Nao ha teste que cubra o cenario "3 artigos finos indexam a listagem" (11.8) nem o cenario "`requiresLinkback=true` esconde a fonte mas publica o artigo" (11.3.1) — este ultimo e apenas **descrito** no teste `tests/web/news-presenter.test.ts:245` ("fonte so aparece com sourceName e sem exigir linkback"), consagrando o comportamento em vez de questiona-lo.

---

### 11.11 Sintese de dividas e riscos

| # | Item | Severidade | Onde |
| --- | --- | --- | --- |
| 1 | `requiresAttribution` e `sourceUrl` nunca renderizados; `requiresLinkback=true` esconde a fonte mas mantem o artigo publicado | **RISCO** legal · **NAO BLOQUEIA PRODUCAO** hoje (zero artigos) / **BLOQUEIA** no 1º artigo de terceiro | `news-presenter.ts:357-358`; `news-pages.ts:177-181` |
| 2 | Pipeline de ingestao editorial inexistente (`services/news-ingestion` = so README; `rssprime_worker.py` = stub) | **NAO IMPLEMENTADO** · **NAO BLOQUEIA PRODUCAO** (secao apenas fica vazia) | `services/news-ingestion/README.md`; `workers/rssprime_worker.py:40` |
| 3 | `news_clusters` documentado em 2 lugares e ausente do Prisma | **DEBITO** de documentacao · **NAO BLOQUEIA** | `database/schema.md:62` vs `services/news-ingestion/README.md:9` |
| 4 | Listagem `/pt/noticias/` pode indexar com 3 artigos finos cujos detalhes sao todos `noindex` (thin hub) | **RISCO** SEO · **NAO BLOQUEIA** hoje | `news-presenter.ts:380-392` + `sitemap-presenter.ts:237-263` |
| 5 | Gate anti-thin de artigo usa proxy `body >= 200 chars → 2 blocos de valor` em vez de `countValueBlocks` | **DEBITO** · **NAO BLOQUEIA** | `news-presenter.ts:404` |
| 6 | `reviewStatusOk: true` hardcoded nos dois chamadores | **DEBITO** de design · **NAO BLOQUEIA** | `news-pages.ts:200`; `sitemap-presenter.ts:208` |
| 7 | Manchetes fabricadas na Home; so um `NODE_ENV` errado (ou a flag) separa producao de conteudo editorial falso sobre obras/pessoas reais | **RISCO** · **NAO BLOQUEIA** com config correta | `page.tsx:185-218, 826`; `home-placeholder-governance.ts:44-51` |
| 8 | `NewsArticle` sem `publisher`, `dateModified`, `mainEntityOfPage` | **DEBITO** SEO · **NAO BLOQUEIA** | `[slug]/page.tsx:90-105` |
| 9 | Hero de noticia local-only enquanto o resto do site migrou para imagens remotas TMDB → artigos nascerao sem imagem | **DEBITO** · **NAO BLOQUEIA** | `news-presenter.ts:35-36, 178-188` |
| 10 | Sem paginacao: `NEWS_INDEX_LIMIT = 24` e `hasMore` so imprime "Mostrando as primeiras N de M"; nao ha `/pt/noticias/pagina/2` | **DEBITO** · **NAO BLOQUEIA** | `news-presenter.ts:27`; `page.tsx:112-116` |
| 11 | Item "Notícias" no header aponta para uma secao publica que hoje so diz "Ainda nao ha noticias publicadas" | **RISCO** de produto · **NAO BLOQUEIA** | `navigation.ts:32`; `noticias/page.tsx:119-121` |
| 12 | README de `news-ingestion` escrito em tempo presente descrevendo servico inexistente | **DEBITO** de honestidade documental | `services/news-ingestion/README.md:8-12` |

### 11.12 Proximos passos recomendados (ordem)

1. **PROXIMO PASSO** — Fechar o buraco de atribuicao **antes** de qualquer ingestao: bloquear exibicao quando `requiresLinkback && sourceUrl === null`, e renderizar `<a rel="nofollow noopener" href={sourceUrl}>` quando exigido. Teste de governanca em `tests/governance/`.
2. **PROXIMO PASSO** — Corrigir o thin-hub: exigir `isSufficientBody(body)` (ou `indexStatus === 'index'`) na contagem que alimenta `evaluateNewsIndexIndexability`, para que a listagem nunca indexe apontando so para `noindex`.
3. **PROXIMO PASSO** — Reescrever `services/news-ingestion/README.md` e `workers/rssprime_worker.py` em tempo futuro/condicional, ou marcar `NAO IMPLEMENTADO` no topo, para nao induzir agentes e humanos a acreditar que ha pipeline.
4. **PROXIMO PASSO** — Decidir explicitamente se noticia e feature do MVP. Se **nao** for, remover "Notícias" do header e devolver 404 em `/pt/noticias/` (ou manter `noindex` + sem link), em vez de expor um indice vazio.
5. **PROXIMO PASSO** — Se for, o menor caminho honesto ate a primeira noticia real e: modelar `news_clusters` (migration aprovada), escrever `services/news-ingestion` em TS/Node + Prisma (como `services/ingestion`), com `api_cache` + `api_sync_logs` + retry/backoff/circuit-breaker por `.claude/rules/ingestion.md`, gravando `license_status` e `display_allowed` **explicitos por fonte** e nunca `official` por default.


---

## Parte 12 — Ratings, notas, estrelas e reviews

### 12.0 Respostas diretas (leia isto primeiro)

**(a) As estrelas da UI vem de onde exatamente?**
Vem **exclusivamente** das colunas `movies.screen_score` / `tv_shows.screen_score` (com `screen_score_scale` e o gate `screen_score_display`), definidas em `packages/db/prisma/schema.prisma:248-250` (filmes) e `packages/db/prisma/schema.prisma:286-288` (series). Nao ha nenhuma outra origem de estrela/nota no render publico. O gate de exibicao esta em `apps/web/src/lib/home-hero-presenter.ts:141-149` (`resolveHeroRating`) e `apps/web/src/lib/entity-index-presenter.ts:201-209` (`resolveCardScreenScore`) — os dois exigem `screenScoreDisplay === true`, `escala === 5` e `0 < valor <= 5`; qualquer desvio retorna `null` (sem estrela, sem fallback). O desenho das estrelas fica em `apps/web/app/_components/rating-stars.tsx:30-48`.

**(b) O que aparece na Home (`/pt/`)?**
Tres superficies consomem nota, todas condicionadas ao mesmo gate:
1. Hero-carousel — `RatingStars` (5 estrelas douradas, preenchimento parcial) na linha de metadados: `apps/web/app/_components/hero-carousel.tsx:56-61`.
2. Cards grandes/compactos de "Destaques no The Screen" — glifo `★` + numero cru: `apps/web/app/pt/page.tsx:330-334` e `apps/web/app/pt/page.tsx:369-374`.
3. Cards de "Filmes em destaque" — `★` + numero: `apps/web/app/pt/page.tsx:408-413`.
Alem disso a home exibe as affordances **desabilitadas** "☆ Avaliar" (`apps/web/app/pt/page.tsx:336-338`) e "✓ Marcar como assistido" (`apps/web/app/pt/page.tsx:340-342`) — sem `onClick`, sem mutation, sem backend.

**(c) O que aparece nos detalhes (`/pt/filmes/{slug}/`, `/pt/series/{slug}/`, `/pt/pessoas/{slug}/`)?**
**Nada.** Nenhuma nota, estrela ou rating. `movie-presenter.ts` nao tem sequer um campo de score em `MoviePageView` (`apps/web/src/lib/movie-presenter.ts:99-109`); o mesmo vale para `series-presenter.ts` e `person-presenter.ts`. O JSON-LD `Movie` e montado sem `AggregateRating`, com comentario explicito em `apps/web/app/pt/filmes/[slug]/page.tsx:117-126`. As paginas de detalhe exibem apenas classificacao indicativa? — nao: nem isso; o `CertificationBadge` so e usado no hero (`apps/web/app/_components/hero-carousel.tsx:62-64`).

**(d) TMDB `vote_average` esta sendo usado como estrela?**
**Nao.** Ele e ingerido e persistido (`services/ingestion/src/normalizers/movie.ts:46-47`, `services/ingestion/src/persistence/store.ts:161-162`, colunas `movies.vote_average_tmdb` / `tv_shows.vote_average_tmdb` em `packages/db/prisma/schema.prisma:238-239` e `:279-280`), mas **nenhum arquivo de `apps/web` le `voteAverageTmdb`** — busca por `voteAverage|vote_average` em `apps/web` retorna zero ocorrencias. O dado fica morto no banco, com o comentario correto de que e dado tecnico do provider e nunca nota editorial (`packages/db/prisma/schema.prisma:238`, `services/ingestion/src/types.ts:9-10`).

**(e) `ExternalRating` esta ativo?**
**Nao.** A tabela existe (`packages/db/prisma/schema.prisma:590-620`) com todas as colunas de governanca, mas **nao ha um unico escritor nem leitor** em codigo de produto: as unicas referencias a `externalRating`/`external_ratings` fora do schema estao em documentacao, no validador de conexao Postgres (`packages/db/scripts/validate-real-postgres.ts:83`), em tipos de SEO (`packages/seo/src/indexability.ts:25-29`) e em testes de governanca. `prisma.externalRating.create/upsert` nao aparece em lugar nenhum.

**(f) Reviews existem?**
**Nao como produto.** `review_summary` existe como valor do enum `ContentBlockType` (`packages/db/prisma/schema.prisma:48`) e como bloco na ordem de exibicao (`apps/web/src/lib/movie-presenter.ts:29`), e ha um prompt (`prompts/review_summary.md`), mas o Entity Writer so gera dois tipos de bloco: `editorial_intro` e `cast_intro` (`services/entity-writer/src/types.ts:24`). Nao existe `Review` no JSON-LD de nenhuma rota. `packages/seo/src/value-blocks.ts:26` lista `own_review` como bloco de valor **teorico**.

**(g) Usuario pode avaliar?**
**Nao.** Nao existe modelo `User`, `Watchlist`, `Favorite` nem `UserRating` no `schema.prisma` (busca retorna zero). Os botoes "Avaliar" e "Marcar como assistido" sao `aria-disabled="true"` puramente decorativos (`apps/web/app/pt/page.tsx:336-342`).

---

### 12.1 Inventario item-a-item

| Item | Existe no banco? | E populado? | Por quem? | E exibido? Onde? | Status |
| --- | --- | --- | --- | --- | --- |
| `movies.screen_score` / `screen_score_scale` / `screen_score_display` | Sim (`schema.prisma:248-250`) | So no seed demo | `apps/admin/scripts/public-demo-seed.ts:261-263` | Hero + 3 tipos de card da home | **PLACEHOLDER** |
| `tv_shows.screen_score*` | Sim (`schema.prisma:286-288`) | So no seed demo | `public-demo-seed.ts:306-308, 321-323` | Idem | **PLACEHOLDER** |
| `movies.certification` / `tv_shows.certification` | Sim (`schema.prisma:244`, `:284`) | So no seed demo | `public-demo-seed-plan.ts:238`, `:343` | Hero (chip) | **PLACEHOLDER** |
| `rating_sources` (tabela) | Sim (`schema.prisma:176-186`) | Sim, 5 linhas | `packages/db/prisma/seed.ts:35-37` a partir de `packages/db/src/seed-data.ts:104-109` | Nunca lida no render | **PARCIAL** (contrato pronto, sem consumo) |
| `api_providers` (tabela) | Sim (`schema.prisma:188-200`) | Sim, 4 linhas (`tmdb`, `gemini`, `imdb236`, `streaming_availability`) | `seed-data.ts:116-121` | Usado por `api_cache`/`api_sync_logs` (TMDB) | **PARCIAL** |
| `source_licenses` | Sim (`schema.prisma:202-222`) | Sim, 5 linhas conservadoras | `seed-data.ts:127-140` — todas `license_status='unknown'`, todas as flags `false` | Nunca lida no render | **PARCIAL** (default seguro correto) |
| `external_ratings` | Sim (`schema.prisma:590-620`) | **Nao** (zero escritores) | Ninguem | Nunca | **NAO IMPLEMENTADO** (schema-only) |
| TMDB `vote_average` / `vote_count` | Sim (`schema.prisma:238-239`, `:279-280`) | **Sim, com dado real** | `services/ingestion/src/persistence/store.ts:161-162, 204-205` | **Nunca** | **REAL no banco / NAO EXIBIDO** |
| IMDb (nota) | Coluna `movies.imdb_id` e so identificador (`schema.prisma:231`) | Nao | — | Nunca | **NAO IMPLEMENTADO** |
| Rotten Tomatoes (Tomatometer/Popcornmeter) | So como chave em `rating_sources` | Nao | — | Nunca | **NAO IMPLEMENTADO** |
| Metacritic / Letterboxd / FilmAffinity | So como chave em `rating_sources` | Nao | — | Nunca | **NAO IMPLEMENTADO** |
| Nota de usuario | Nao existe modelo | — | — | Botao "☆ Avaliar" desabilitado | **NAO IMPLEMENTADO** |
| Reviews proprias | `ContentBlockType.review_summary` no enum | Nao (writer so faz `editorial_intro`/`cast_intro`) | — | Nunca | **NAO IMPLEMENTADO** |
| Critica vs audiencia (`critic_vs_audience_comparison`) | So string em `packages/seo/src/value-blocks.ts:25` | Nao | — | Nunca | **NAO IMPLEMENTADO** |
| Audience score | Nao existe conceito no codigo | — | — | — | **NAO IMPLEMENTADO** |
| `AggregateRating` no JSON-LD | — | — | — | **Nunca emitido** em nenhuma rota | **NAO IMPLEMENTADO** (correto por governanca) |
| `Review` no JSON-LD | — | — | — | Nunca emitido | **NAO IMPLEMENTADO** (correto) |

---

### 12.2 O achado critico: quem popula `screen_score`

Confirmei por varredura completa (`grep -rn "screenScore" --include=*.ts --include=*.tsx`, excluindo `node_modules`): **os UNICOS escritores de `screen_score`/`screen_score_scale`/`screen_score_display` no repositorio inteiro sao o seed demo do admin**:

- `apps/admin/scripts/public-demo-seed.ts:261-263` (create/update de filme)
- `apps/admin/scripts/public-demo-seed.ts:274-276`
- `apps/admin/scripts/public-demo-seed.ts:306-308` e `:321-323` (serie)

Os valores sao **literais fixos em codigo**, atribuidos a **entidades ficticias** (nao existem no TMDB): `screenScore: 4` para "O Farol Silencioso" (`apps/admin/scripts/public-demo-seed-plan.ts:239`), `3.5`, `4.5`, `4.5`, `4`, `3.5` (`public-demo-seed-plan.ts:268, 296, 344, 371, 401`). O seed forca `screenScoreScale: 5` e `screenScoreDisplay: true` — ou seja, **libera a exibicao sem qualquer revisao humana registrada**, porque nao existe fluxo de revisao para esse campo.

E igualmente confirmado que:

- A **ingestao TMDB real nunca escreve `screen_score`**. O upsert de filme em `services/ingestion/src/persistence/store.ts:153-172` grava `popularity`, `voteAverageTmdb`, `voteCountTmdb`, imagens e timestamps — **nenhum campo `screenScore*` nem `certification`**. O mesmo para serie (`store.ts:196-215`).
- O script de catalogo publico `services/ingestion/bin/ingest-public-catalog.ts` cria slug canonico pt-BR e traducao, mas **nao toca em `screenScore` nem `certification`** (busca por esses tokens no arquivo retorna zero).
- O **admin nao pode setar** a nota: a allowlist de acoes editoriais (`apps/admin/src/lib/editorial-action-policy.ts`, `editorial-bulk-policy.ts`) so cobre `review_status`/`index_status`; `screenScore` nao aparece.
- O seed base (`packages/db/prisma/seed.ts`) so semeia `languages`, `countries`, `rating_sources`, `api_providers` e `source_licenses` — nenhuma nota.

**Conclusao: a base real ingerida do TMDB fica com `screen_score = NULL` e `screen_score_display = false`** (default da migration, `packages/db/prisma/migrations/20260706120000_add_certification_screen_score/migration.sql:8`, `:14`).

#### O que o usuario ve exatamente nessa base real (sem seed demo)

| Superficie | Componente | Comportamento com `screen_score = NULL` | Arquivo:linha |
| --- | --- | --- | --- |
| Hero-carousel (`/pt/`) | `RatingStars` | `resolveHeroRating` retorna `null` -> o item "rating" **nao entra** em `metaItems` -> **nenhuma estrela e renderizada** (nao ha estrela vazia, nao ha "—", nao ha placeholder). A linha de metadados fica so com o ano / "N temporadas". | `home-hero-presenter.ts:142` (`if (!input.screenScoreDisplay) return null`) + `hero-carousel.tsx:56-61` |
| Card grande "Destaques" | `HomeV4BigCard` | `card.screenScore === null` -> o `<span class="home-v4-rating">` some. **Mas a linha `home-v4-rating-row` continua renderizando** e mostra apenas **"☆ Avaliar"** (estrela vazia + texto), sozinha. | `apps/web/app/pt/page.tsx:329-339` |
| Card compacto "Destaques" | `HomeV4CompactCard` | Nada e renderizado (bloco inteiro condicionado). | `apps/web/app/pt/page.tsx:369-374` |
| Card de poster "Filmes em destaque" | `HomeV4PosterCard` | Nada; a meta-row mostra so o ano (`card.meta ?? ""`). | `apps/web/app/pt/page.tsx:406-414` |
| Listagens `/pt/filmes/`, `/pt/series/`, `/pt/pessoas/` | `EntityCardLink` | **Nunca renderiza nota, nem quando ela existe.** O componente ignora `card.screenScore`. | `apps/web/app/_components/entity-card.tsx:42-70` |
| Detalhe de filme/serie/pessoa | — | Nenhuma nota em nenhum caso. | `movie-presenter.ts:99-109` |

Ou seja: **o degrade e silencioso e visualmente honesto** (nao ha "0 estrelas", nao ha nota fake, nao ha zero renderizado). O unico residuo visivel na base real e o texto morto **"☆ Avaliar"** flutuando sozinho nos 4 cards grandes da home — uma estrela vazia sem numero, que um usuario pode interpretar como "nota 0" ou como um botao clicavel que nao funciona.

Consequencia de produto: **o site em producao (base ingerida do TMDB, sem demo) nao exibe nenhuma nota em lugar nenhum.** O design v4 foi portado com "linha de rating" em quatro tipos de card, e essa linha esta permanentemente vazia. **DEBITO** · **NAO BLOQUEIA PRODUCAO** (nao viola invariante; e um vazio visual).

---

### 12.3 Screen Score: o que e, o que falta

`screen_score` e a **nota editorial propria do Screen**, escala 5, deliberadamente separada de `external_ratings`. Isso e a decisao correta de governanca: nao e `AggregateRating` de terceiro, nao passa pelas regras de `rating_source`, nao pode virar Tomatometer. Comentado explicitamente em `packages/db/prisma/schema.prisma:245-247` e reforcado em `apps/web/app/_components/rating-stars.tsx:8-13`.

O gate seguro funciona: `screen_score_display` nasce `false` (migration linha 8/14) e o teste `tests/governance/schema-safe-defaults.test.ts:88-89` trava isso.

Porem, como **artefato editorial**, `screen_score` esta cru:

| Lacuna | Detalhe | Severidade |
| --- | --- | --- |
| Sem proveniencia | A coluna nao tem `reviewed_by`, `review_status`, `scored_at`, `rationale` nem link para um `content_block`. Uma nota "editorial propria" sem autor e sem data e uma nota sem auditoria. | **DEBITO** · **NAO BLOQUEIA PRODUCAO** |
| Sem fluxo de revisao | Nao ha caminho no admin para atribuir/liberar a nota. O unico caminho e um script CLI que ja liga `display=true` no mesmo comando. Isso contradiz o espirito da invariante 12 ("nunca publica sozinho") aplicada ao conteudo editorial. | **DEBITO** |
| Sem CHECK no banco | A migration nao cria `CHECK (screen_score >= 0 AND screen_score <= screen_score_scale)` nem `CHECK (screen_score_scale = 5)`. `Decimal(65,30)` aceita qualquer coisa. A defesa e apenas no presenter (`resolveHeroRating`, `resolveCardScreenScore`). Se um consumidor futuro ler a coluna direto, nao ha protecao. | **RISCO** · **NAO BLOQUEIA PRODUCAO** |
| Sem JSON-LD | Quando (e se) a nota propria for publicada, ela deve virar `Review`/`reviewRating` do Screen — nunca `AggregateRating`. Hoje nao ha nada, o que e **correto** para o estado atual. | ok |
| Duas formatacoes divergentes | Hero: `formatScore` converte ponto em virgula -> "4,5" (`rating-stars.tsx:26-28`). Cards: `value.toFixed(1)` -> **"4.5"** com ponto (`entity-index-presenter.ts:208`). Na mesma pagina, a mesma nota aparece com dois separadores decimais. | **DEBITO** |
| Estrela dos cards e `aria-hidden` | `apps/web/app/pt/page.tsx:331, 370, 409` marcam o bloco `★ N` como `aria-hidden="true"`, sem `aria-label`. Leitores de tela nao recebem a nota **nem a autoria** ("Nota editorial do Screen"). Visualmente, um `★ 4.5` isolado ao lado de um poster e ambiguo: nada na UI diz que a nota e do Screen (so o hero diz, via `aria-label` de `rating-stars.tsx:38`). | **RISCO** editorial/a11y · **NAO BLOQUEIA PRODUCAO** |
| `EntityCard.screenScore` calculado e nunca usado nas listagens | `buildMovieCard`/`buildSeriesCard` resolvem o score (`entity-index-presenter.ts:260, 274`), mas `EntityCardLink` nao o renderiza. Trabalho morto / inconsistencia entre home e listagem. | **DEBITO** |
| Comentario CSS defasado | `apps/web/app/globals.css:1607-1610` ainda afirma que a estrela+numero sao "placeholder decorativo (ver `homeVisualScore`)". `homeVisualScore` **nao existe mais** no codigo (a funcao foi removida quando os cards passaram a usar `screen_score`). Documentacao interna mentindo sobre o proprio dado. | **DEBITO** |
| Hex hardcoded | `.home-v4-star { color: #f5c84b; }` (`globals.css:1625-1627`) repete o valor do token `--accent-star` (`globals.css:61`) em vez de usar `var(--accent-star)`, contrariando a regra de tokens da CLAUDE.md secao 8. O hero faz certo (`globals.css:977`). | **DEBITO** |

---

### 12.4 A camada de governanca de ratings externos: correta, testada e **sem nenhum consumidor**

Esta e a parte mais bem construida do dominio — e a mais inerte.

**Constantes canonicas** (`packages/config/src/invariants.ts:84-110`):
`RATING_SOURCES = ["imdb","rotten_tomatoes","metacritic","letterboxd","filmaffinity"]`;
`RATING_SCALES = { imdb: 10, rotten_tomatoes: 100, metacritic: 100, letterboxd: 5, filmaffinity: 10 }`.

**Validador puro** `validateRating` (`packages/schemas/src/ratings.ts:93-138`) aplica quatro regras:
(a) `ratingSource ∈ RATING_SOURCES` (`:99-104`);
(b) `ratingScale === RATING_SCALES[ratingSource]` (`:107-114`) — bloqueia reescalonamento;
(c) `providerApi !== ratingSource` **e** `providerApi ∉ RATING_SOURCES` (`:117-125`) — invariante 2 materializada duas vezes;
(d) anti cross-label: um label contendo `tomatometer`/`tomate`/`popcornmeter` forca `rotten_tomatoes`; `imdb` forca `imdb`; `metacritic`/`metascore` forca `metacritic` (`:69-79`, `:128-135`).
`assertRatingIntegrity` (`:147-152`) e a versao que lanca.

**Testes de governanca** (`tests/governance/ratings.test.ts:12-73`): os quatro casos exigidos por `.claude/rules/ratings.md` secao 9 (IMDb+Tomatometer falha; `provider_api === rating_source` falha; imdb escala 100 falha; caso valido passa). Complementados por `tests/governance/rating-scales-mirror.test.ts` (a seed espelha `RATING_SCALES`) e `tests/governance/seed-disjoint.test.ts` (conjuntos `rating_sources` x `api_providers` disjuntos).

**Invariante 2 materializada no schema**: `external_ratings.rating_source` -> FK para `rating_sources`, `external_ratings.provider_api` -> FK para `api_providers`, **tabelas distintas** (`packages/db/prisma/schema.prisma:611-613`). A seed reforca com `imdb236` como provider tecnico das notas cuja `rating_source` e `imdb` (`packages/db/src/seed-data.ts:119`).

**Guarda de ingestao**: `tests/governance/tmdb-provider-separation.test.ts:26, 60-80` varre `api-clients/tmdb/src` e `services/ingestion/src` (removendo comentarios) e falha se aparecer `external_ratings|externalRating|rating_source|ratingSource` no codigo. Isso impede que a ingestao TMDB trate `vote_average` como nota editorial.

**O problema:** `validateRating` e `assertRatingIntegrity` **nao tem um unico chamador em codigo de produto**. A busca por esses simbolos em todo o repo (fora de `node_modules`) retorna apenas a propria definicao e os testes. Nao ha caminho de escrita para `external_ratings`, entao nao ha fronteira onde o validador seja aplicado. A regra `.claude/rules/ratings.md` diz "nenhuma nota externa pode ser persistida ou exibida sem passar por `validateRating`" — hoje isso e verdade **vacuosamente** (nenhuma nota existe), nao por construcao.

**PROXIMO PASSO**: quando ratings externos forem ativados, o `assertRatingIntegrity` precisa ser chamado no upsert de `external_ratings` (nao no presenter), e a licenca (`source_licenses.display_allowed` + `score_allowed` + `license_status`) precisa ser checada na fronteira de exibicao. Nenhuma das duas fronteiras existe hoje.

---

### 12.5 Licencas (`source_licenses`) — default seguro, zero uso

`packages/db/src/seed-data.ts:127-140` cria uma linha por `rating_source` com `license_status: "unknown"`, `displayAllowed: false`, `logoAllowed: false`, `scoreAllowed: false`, `reviewQuoteAllowed: false`, `requiresAttribution: true`, `requiresLinkback: true`. Defaults do schema idem (`schema.prisma:206-212`). Isso e o comportamento correto (invariante 6, fail-closed).

Nenhum codigo **le** `source_licenses`. O tipo `DisplayedRating { licenseDisplayAllowed }` de `packages/seo/src/indexability.ts:25-29` existe e o gate `blocked` esta implementado, mas **todos os chamadores passam `displayedRatings: []`**:
- `apps/web/src/lib/movie-indexability.ts:59`
- `apps/web/src/lib/series-presenter.ts:291`
- `apps/web/src/lib/entity-index-presenter.ts:348`

Portanto, hoje, **nenhuma pagina pode ser marcada `blocked` por licenca de rating** — nao porque a licenca foi verificada, mas porque nao ha rating algum na pagina. **PARCIAL**, com a semantica correta se/quando os dados chegarem.

Nota importante: a licenca do proprio **TMDB** (dado de catalogo, posters e `vote_average`) **nao tem linha em `source_licenses`** — a seed so cria linhas para as 5 `RATING_SOURCES`. A atribuicao ao TMDB e feita no rodape (memoria de fase 9D), nao via `source_licenses`. **NAO FOI POSSIVEL CONFIRMAR** se essa e uma decisao deliberada ou uma lacuna: `SourceLicense.sourceKey` e um `String` livre (nao ha FK para `rating_sources` em `schema.prisma:204`), entao uma linha `source_key='tmdb'` seria estruturalmente possivel e nao existe.

---

### 12.6 TMDB `vote_average`: dado real morto no banco

- Ingerido: `services/ingestion/src/normalizers/movie.ts:46-47`, `tv.ts:52-53`.
- Persistido: `store.ts:161-162` (filme), `store.ts:204-205` (serie).
- Tipado explicitamente como dado tecnico, nao editorial: `services/ingestion/src/types.ts:9-10`.
- **Zero leitores em `apps/web`.**

Isso significa que existe, hoje, no Postgres de producao, uma nota de audiencia real (TMDB, escala 10) para cada filme/serie ingerido — e ela e corretamente ignorada. **REAL no banco, NAO EXIBIDO.**

**RISCO latente** (**BLOQUEIA PRODUCAO** *se* concretizado): a tentacao obvia para "resolver" a home sem estrelas e mapear `vote_average_tmdb / 2` para as 5 estrelas do `screen_score`. Isso seria **violacao dupla**: (i) converter escala entre fontes (invariante 1, `.claude/rules/ratings.md` secao 8, "Reescalar entre fontes"); (ii) apresentar nota de terceiro como nota propria do Screen (`rating-stars.tsx:38` diz literalmente "Nota editorial do Screen"). E ainda: TMDB e `provider_api`, nao `rating_source` (invariante 2) — `tmdb` nem sequer pertence a `RATING_SOURCES`, como o teste `tmdb-provider-separation.test.ts:66-68` trava.

Nao ha, atualmente, **nenhum guard automatizado** que impeca alguem de importar `voteAverageTmdb` dentro de `apps/web`. O teste `tmdb-provider-separation.test.ts` so varre `api-clients/tmdb/src` e `services/ingestion/src` (`:20-23`). O `scripts/audit/check-invariants.mjs` so verifica presenca de termos em documentos (`:50-62`), nao no codigo de render. **PROXIMO PASSO**: estender a varredura de tokens proibidos para `apps/web/src` e `apps/web/app`, adicionando `voteAverageTmdb|vote_average` a lista.

---

### 12.7 Onde a nota **nao** aparece (e deveria ser conferido)

- **JSON-LD**: nenhum `AggregateRating` em nenhuma rota. Confirmei rota a rota: `apps/web/app/pt/filmes/[slug]/page.tsx:119-126` (Movie sem rating, com comentario), `apps/web/app/pt/series/[slug]/page.tsx:106` (TVSeries sem rating), `apps/web/app/pt/pessoas/[slug]/page.tsx`, `apps/web/app/pt/noticias/[slug]/page.tsx`, `apps/web/app/pt/explorar/page.tsx`, `apps/web/app/dev/movie-page-preview/page.tsx:44-50`. **Conforme.** Note que a home (`/pt/`) exibe estrelas mas **nao emite JSON-LD algum** — nao ha risco de `AggregateRating` fabricado ali.
- **Sitemap / robots**: nao ha interacao com nota.
- **Admin**: nenhuma superficie de rating. O painel QA (`apps/admin/src/lib/content-qa.ts`) usa a palavra "score" para o seu proprio score de qualidade 0-100 — nao e nota de titulo. `apps/admin/src/lib/staging-seed-plan.ts:105` documenta explicitamente que o seed de staging "nao usa notas, nao cita plataformas nem fontes de rating".
- **Entity Writer**: `packages/schemas/src/entity-writer-output.ts:36, 108` declaram `ratings_explanation` como bloco possivel, mas `services/entity-writer/src/types.ts:24` restringe a producao a `editorial_intro | cast_intro`. O prompt `prompts/ratings_explanation_pt.md` existe e nao e usado. **NAO IMPLEMENTADO**, corretamente inerte.

---

### 12.8 Riscos consolidados

| # | Risco | Invariante afetada | Criticidade |
| --- | --- | --- | --- |
| R1 | Nenhum guard impede `apps/web` de importar `voteAverageTmdb`; a pressao de produto ("cade as estrelas?") aponta exatamente para essa conversao. | 1, 2 | **RISCO** · **NAO BLOQUEIA PRODUCAO** hoje (nao ocorre), mas seria **BLOQUEIA PRODUCAO** se ocorrer |
| R2 | `screen_score` so tem valor em entidades **ficticias** do seed demo. Se o demo seed for aplicado por engano em staging/producao com `NODE_ENV` mal configurado, o site publica filmes que nao existem, com notas inventadas e `screen_score_display=true`. O guard esta em `apps/admin/scripts/public-demo-seed-plan.ts:654-661` (aborta em producao via `getAdminRuntimeKind`) + confirmacao dupla por env (`:663`). O guard depende de `NODE_ENV`/`VERCEL_ENV`; em EasyPanel/Nixpacks **NAO FOI POSSIVEL CONFIRMAR** que `VERCEL_ENV` exista e que `NODE_ENV=production` esteja setado no shell onde o script rodaria. | 12 (nao inventar entidades) | **RISCO** · **BLOQUEIA PRODUCAO** se o guard falhar |
| R3 | Nota exibida nos cards da home sem nenhuma atribuicao visivel ("★ 4.5" solto) e com `aria-hidden`. Um leitor razoavel assume que e nota de IMDb/TMDB. Diverge do proprio hero, que atribui via `aria-label`. | espirito de 1/2 | **RISCO** editorial · **NAO BLOQUEIA PRODUCAO** |
| R4 | Sem `CHECK` no banco para faixa/escala de `screen_score`; a unica defesa e o presenter. | 6 (fail-closed) | **RISCO** · **NAO BLOQUEIA PRODUCAO** |
| R5 | Producao real = home com quatro tipos de card cujo slot de nota esta permanentemente vazio, e um "☆ Avaliar" morto. Percepcao de produto quebrado. | — | **DEBITO** · **NAO BLOQUEIA PRODUCAO** |
| R6 | `source_licenses` nao cobre `tmdb`, cuja imagem e metadado sao efetivamente exibidos. A governanca de licenca so modela as 5 fontes de rating. | 6 | **RISCO** · **NAO FOI POSSIVEL CONFIRMAR** se e decisao consciente |

### 12.9 Proximos passos recomendados (ordenados)

1. **PROXIMO PASSO** — Adicionar guard automatizado (extensao de `tests/governance/tmdb-provider-separation.test.ts` ou de `scripts/audit/check-render-purity.mjs`) que falhe se `voteAverageTmdb`/`vote_average` aparecer em `apps/web/**`. Barato, fecha R1 permanentemente.
2. **PROXIMO PASSO** — Decidir explicitamente o destino do `screen_score`: (a) e uma nota editorial de verdade, e entao precisa de coluna de autoria/revisao + superficie no admin + fluxo `needs_review -> human_reviewed` antes de `display=true`; ou (b) nao e, e entao a linha de rating deve ser **removida** dos cards da home ate existir a feature. Manter a linha vazia e o pior dos dois mundos.
3. **PROXIMO PASSO** — Remover o "☆ Avaliar" e "✓ Marcar como assistido" do render de producao (gate-los por `allowHomeVisualPlaceholders`, como ja e feito com noticias mock em `apps/web/src/lib/home-placeholder-governance.ts:44-50`), ou dar-lhes funcao. Affordance desabilitada permanente e ruido.
4. **PROXIMO PASSO** — Se a nota dos cards ficar, unificar formatacao (virgula decimal) e dar `aria-label` com atribuicao ("Nota editorial do Screen: 4,5 de 5"), reusando `RatingStars` em vez do glifo `★` cru.
5. **PROXIMO PASSO** — Corrigir o comentario defasado em `apps/web/app/globals.css:1607-1610` (cita `homeVisualScore`, funcao ja removida) e trocar o hex `#f5c84b` por `var(--accent-star)` em `.home-v4-star`.
6. **PROXIMO PASSO** — Adicionar `CHECK (screen_score IS NULL OR (screen_score > 0 AND screen_score <= screen_score_scale))` e `CHECK (screen_score_scale IS NULL OR screen_score_scale = 5)` em migration futura (tarefa aprovada para banco — nao fazer por inferencia).
7. Ao ativar `external_ratings`: chamar `assertRatingIntegrity` no upsert, ler `source_licenses` na fronteira de exibicao, e alimentar `displayedRatings` em `evaluateIndexability` (hoje sempre `[]` em tres presenters).

### 12.10 O que NAO foi possivel confirmar

- **NAO FOI POSSIVEL CONFIRMAR** o conteudo real do PostgreSQL de producao (EasyPanel). Nao executei consultas ao banco (proibido por escopo desta auditoria). A conclusao "base real fica sem estrelas" e derivada de leitura estatica: nenhum caminho de codigo, exceto `apps/admin/scripts/public-demo-seed.ts`, escreve `screen_score`. Se alguem tiver rodado UPDATEs manuais via psql, isso nao aparece no repositorio.
- **NAO FOI POSSIVEL CONFIRMAR** se `getAdminRuntimeKind` (usado no guard de producao do seed demo, `public-demo-seed-plan.ts:654-655`) classifica corretamente o ambiente EasyPanel/Nixpacks — nao li `apps/admin/src/lib/admin-access.ts` nesta secao e o script depende de `VERCEL_ENV`/`NODE_ENV`.
- **NAO FOI POSSIVEL CONFIRMAR** se a ausencia de linha `source_licenses` para `tmdb` e deliberada.


---

## Parte 13 — Streaming availability / onde assistir

### 13.0 Veredito em uma frase

Existe **tabela real**, existe **presenter honesto e testado**, e existe **zero ingestao**: nenhum
byte de disponibilidade real jamais entrou em `watch_availability`. O unico produtor de linhas e um
**seed demo de titulos ficticios**. Em paralelo, a home `/pt` renderiza — **sem gate de ambiente** —
um ticker que afirma "novo episodio hoje" + "Onde assistir NETFLIX/Max/Apple TV+/prime video" e
chips de plataforma nos tiles de serie, ambos **hardcoded**, e a home e **indexavel** por default.
Isso e o risco mais grave desta secao: **BLOQUEIA PRODUCAO**.

---

### 13.1 Inventario: o que existe, o que nao existe

| Item | Caminho | Status |
| --- | --- | --- |
| Tabela `watch_availability` (Prisma + SQL) | `packages/db/prisma/schema.prisma:626-652`, `packages/db/prisma/migrations/20260625120000_init/migration.sql:400-421` | **REAL** (schema aplicado, defaults seguros) |
| Tabela `platforms` | — | **NAO IMPLEMENTADO** |
| Tabela `providers` (de streaming) | — | **NAO IMPLEMENTADO** (existe `api_providers`, que e outra coisa) |
| Enum `OfferType` (so modalidades legais) | `packages/db/prisma/schema.prisma:109-116` | **REAL** |
| Leitura server-only | `apps/web/src/server/entity-watch.ts:36-65` | **REAL** (Prisma, read-only, BR fixo) |
| Presenter puro | `apps/web/src/lib/watch-presenter.ts:116-158` | **REAL** (licenca + anti-pirataria + carimbo) |
| Componente de UI | `apps/web/app/_components/watch-providers.tsx:26-52` | **REAL** (presentacional puro) |
| Testes do presenter | `tests/web/watch-presenter.test.ts:1-83` | **REAL** (cobre `display_allowed`, `torrent`/`iptv`, agrupamento, frescor) |
| Uso nas paginas de detalhe | `apps/web/app/pt/filmes/[slug]/page.tsx:269-274`, `apps/web/app/pt/series/[slug]/page.tsx:296-301` | **REAL** (secao omitida quando vazia) |
| Rota `/pt/.../onde-assistir/` | — | **NAO IMPLEMENTADO** (a doc `services/streaming/README.md:16-17` e `workers/streaming_worker.py:7` afirmam que existe) |
| Ingestao / worker de streaming em TS | — | **NAO IMPLEMENTADO** (`services/streaming/` contem **apenas** `README.md`, 30 linhas) |
| Worker Python de streaming | `workers/streaming_worker.py:35-43` | **PLACEHOLDER** (`logger.info("streaming_worker: Fase 0: nao implementado")`; sem HTTP, sem DB) |
| Client `streaming_availability` | `api-clients/streaming_availability/README.md` (arquivo unico) | **NAO IMPLEMENTADO** |
| Client `kaso` (fallback) | `api-clients/kaso/README.md` (arquivo unico) | **NAO IMPLEMENTADO** |
| Endpoint TMDB `/watch/providers` | ausente de `api-clients/tmdb/src/endpoints.ts:36-87` | **NAO IMPLEMENTADO** |
| Seed demo que escreve ofertas | `apps/admin/scripts/public-demo-seed.ts:225-247` | **PLACEHOLDER** |
| Ticker "Onde assistir <streaming>" | `apps/web/app/_components/episodes-ticker.tsx:53-91` | **PLACEHOLDER** + **RISCO** |
| Chips de plataforma nos tiles de serie | `apps/web/app/pt/page.tsx:133-144`, `apps/web/app/pt/page.tsx:454-456` | **PLACEHOLDER** + **RISCO** |
| CTA "Onde assistir" do hero | `apps/web/app/_components/hero-carousel.tsx:217-225` | **PARCIAL** (link para a ficha, nao para streaming) |

---

### 13.2 A tabela existe? Sim — e os nomes reais nao sao os da tarefa

O prompt pediu para conferir `WatchAvailability`, `Platform` e `Provider`. **Confirmado: so o
primeiro existe.**

```
model WatchAvailability { ... }   // packages/db/prisma/schema.prisma:626
```

Nao ha `model Platform`, nao ha `model Provider`. A lista completa de models em
`packages/db/prisma/schema.prisma` (linhas 144-804) contem `ApiProvider` (`:188`), que e o
**fornecedor tecnico** (`tmdb`, `gemini`, `imdb236`, `streaming_availability`) — nao uma plataforma
de streaming. `services/streaming/README.md:3-4` e `docs/API_SOURCES.md:184` prometem que o servico
"mantem `watch_availability`, `platforms` e `providers`": **duas dessas tres tabelas nao existem**.

Colunas reais (`schema.prisma:627-645` / `migration.sql:401-419`):

| Coluna | Tipo | Observacao de auditoria |
| --- | --- | --- |
| `entity_type` / `entity_id` | enum + BigInt | polimorfico, **sem FK** para `movies`/`tv_shows` |
| `country_code` | Text | **unica FK real** (`-> countries.code`, `migration.sql:714`) |
| `provider_key` | Text? | nullable; comentario admite "provider como texto ate a fase de streaming" (`schema.prisma:631`) |
| `provider_name` | Text | **texto livre** — nao ha catalogo de plataformas |
| `offer_type` | `OfferType` | so modalidades legais; CHECK `price` so em `rent`/`buy` (`migration.sql:761-763`) |
| `deep_link` | Text? | **nunca renderizado** (ver 13.5) |
| `fetched_at` | Timestamp? | base do carimbo "Atualizado em" |
| `stale_after` | Timestamp? | **nunca escrito, nunca lido** por codigo algum |
| `provider_api` | Text? | **sem FK** para `api_providers` (contraste: `ExternalRating.provider` tem FK, `schema.prisma:613`) |
| `display_allowed` | Boolean | `@default(false)` — travado por `tests/governance/schema-safe-defaults.test.ts:60-62` |

**DEBITO (NAO BLOQUEIA PRODUCAO, bloqueia a ingestao futura):** a tabela **nao tem `@@unique`**
(`schema.prisma:649-651` declara so dois `@@index`). Sem chave natural (`entity_type`, `entity_id`,
`country_code`, `provider_name`/`provider_key`, `offer_type`) e **impossivel fazer `upsert`
idempotente**; qualquer worker teria de fazer `deleteMany` + `create` (foi exatamente o que o seed
demo fez, `public-demo-seed.ts:229-246`). Isso quebra o requisito de `.claude/rules/ingestion.md`
("hash de payload -> sem mudanca, nao reescreve nem bumpa `updated_at`").

**DEBITO:** nao existe coluna `license_status` em `watch_availability`. Somente `display_allowed`.
A invariante 6 fala em `license_status` em `unknown`/`blocked` **ou** `display_allowed=false`; para
ofertas de streaming, so metade do gate e representavel no schema. Alem disso,
`SOURCE_LICENSE_SEED` (`packages/db/src/seed-data.ts:127-140`) cria linhas de `source_licenses`
**apenas para as 5 rating sources** — **nenhuma linha de licenca existe para plataformas ou para o
provedor `streaming_availability`**. Ou seja: hoje um `display_allowed=true` em `watch_availability`
nao esta ancorado em nenhum registro de licenca. E uma flag solta.

**DEBITO documental:** `THE_SCREEN.md:209` afirma que `WatchAvailability` tem `licenseStatus`.
**Falso** — a coluna nao existe (`schema.prisma:626-645`). O documento de status esta errado nesse
ponto.

---

### 13.3 Existe ingestao real? Nao. Existe API de streaming configurada? Nao.

Busca exaustiva por escritas na tabela:

```
apps/admin/scripts/public-demo-seed.ts:229   prisma.watchAvailability.deleteMany(...)
apps/admin/scripts/public-demo-seed.ts:234   prisma.watchAvailability.create(...)
apps/admin/scripts/public-demo-seed.ts:437   prisma.watchAvailability.deleteMany(...)   // cleanup
apps/web/src/server/entity-watch.ts:41       prisma.watchAvailability.findMany(...)     // leitura
```

Nao ha **nenhuma outra** referencia em TypeScript no monorepo. `services/` inteiro so cita
`watch` no `README.md` de `services/streaming`. `services/ingestion/src/**` nao toca a tabela.

- `services/streaming/` = 1 arquivo, 30 linhas de `README.md`. **NAO IMPLEMENTADO.**
- `api-clients/streaming_availability/` = 1 arquivo, `README.md`. **NAO IMPLEMENTADO.**
- `api-clients/kaso/` = 1 arquivo, `README.md`. **NAO IMPLEMENTADO.**
- `workers/streaming_worker.py:43` = `logger.info("streaming_worker: Fase 0: nao implementado")`.
  Sem cliente HTTP, sem banco, sem normalizacao — o proprio docstring admite (`:25`).
- Chave `SCREENA_STREAMING_PROVIDER_KEY` existe em `.env.example:51` e em
  `docs/CLOUDPANEL_DEPLOY.md:566` mas **nao e lida por nenhum arquivo de codigo** (as unicas
  ocorrencias sao `.env`, `.env.example`, docs e `THE_SCREEN.md:800`). Nenhum client a consome.
- `api_providers` traz `streaming_availability` como semente (`packages/db/src/seed-data.ts:120`),
  o que **da a impressao** de integracao existente. E so uma linha de tabela de referencia.

Consequencia: em qualquer banco populado pela ingestao real (`services/ingestion/bin/ingest-public-catalog.ts`,
TMDB), `watch_availability` tem **zero linhas**. A secao "Onde assistir" das paginas de detalhe
**nunca aparece** (`watch.providers.length > 0` em `filmes/[slug]/page.tsx:271`).

#### TMDB `/watch/providers` — verificacao pedida explicitamente

`api-clients/tmdb/src/endpoints.ts` expoe exatamente 5 chamadas (`:36-47`):
`getMovie`, `getTvShow`, `getTvSeason`, `getPerson`, `getUpcomingMovies`. O `append_to_response`
usado e `'external_ids,credits'` (`:20`). **Nao ha `/watch/providers`, nem `watch/providers` no
`append_to_response`, nem tipo correspondente em `api-clients/tmdb/src/types.ts`.**
`docs/API_SOURCES.md:68` e `:92` mencionam "watch providers" do TMDB como referencia tecnica, mas
isso **nao esta implementado**. **NAO IMPLEMENTADO** — e, portanto, a atribuicao obrigatoria ao
JustWatch (exigida pelos termos do endpoint TMDB) ainda nao e uma divida ativa, so uma pendencia
futura. Nao ha uma unica ocorrencia da string "JustWatch" em `docs/`, `packages/`, `apps/`,
`api-clients/` ou `services/` (as unicas ocorrencias no repo estao em `.claude/agents/*` e
`THE_SCREEN.md`).

---

### 13.4 O seed demo: a unica fonte de "dado" — e ele mente com data

`apps/admin/scripts/public-demo-seed.ts:234-245` escreve ofertas com:

```
displayAllowed: true,
providerApi: PUBLIC_DEMO_WATCH_PROVIDER_API,   // "public-demo-seed"
fetchedAt,                                     // new Date("2026-06-15")
```

- `PUBLIC_DEMO_WATCH_PROVIDER_API = "public-demo-seed"` (`public-demo-seed-plan.ts:52`) — **nao
  existe** em `api_providers`. Como `watch_availability.provider_api` nao tem FK, o insert passa.
- `WATCH_FETCHED_AT = "2026-06-15"` (`public-demo-seed-plan.ts:207`) e uma **data fixa hardcoded**.
  O presenter transforma isso em `"Atualizado em 15/06/2026"` (`watch-presenter.ts:151-156`).
  Ou seja: **o carimbo de frescor existe e funciona, mas o unico dado que ele carimba e sintetico.**
- As ofertas sao `Netflix/subscription`, `Prime Video/rent`, `Apple TV/buy`, `Max/subscription`,
  `Disney+/subscription` (`public-demo-seed-plan.ts:249-251, 278-279, 306-307, 353, 381-382, 411-412`).
- `displayAllowed: true` e escrito **direto**, sem consultar `source_licenses`. O default seguro do
  schema e contornado pelo seed.

**Mitigacao real:** os titulos do demo sao **ficticios** ("O Farol Silencioso", "Cidade de Vidro" —
`public-demo-seed-plan.ts:236-253`), com `tmdb_id` sentinela; e o seed **aborta em producao real**
(`public-demo-seed-plan.ts:629`, `:657-658`), exige `--apply` + env de confirmacao dupla
(`public-demo-seed.ts:11-13`) e tem `--cleanup` reversivel (`:437`). Portanto o dano do seed fica
contido em dev/staging. Classifico como **PLACEHOLDER / NAO BLOQUEIA PRODUCAO** — desde que ninguem
force `NODE_ENV` para burlar o guard.

Status honesto da feature de detalhe: **PLACEHOLDER**. O caminho `banco -> presenter -> UI` esta
correto e testado, mas **nunca foi exercitado com dado real**, so com 12 linhas sinteticas.

---

### 13.5 Os chips de plataforma na home e no ticker sao mock? Sim — mostro a origem

#### (a) Episodes Ticker — faixa amarela abaixo do hero

Fonte do dado, literal (`apps/web/app/_components/episodes-ticker.tsx:53-91`):

```ts
function episodesToday(): EpisodeTickerItem[] {
  return [
    { series: "Wednesday",       seasonEp: "T2 · E6", logo: "NETFLIX",     logoColor: "#E50914", href: SERIES_INDEX_PATH },
    { series: "The Bear",        seasonEp: "T3 · E4", logo: "Star+",       logoColor: "#0A4DB3", href: SERIES_INDEX_PATH },
    { series: "Severance",       seasonEp: "T2 · E5", logo: "Apple TV+",   logoColor: "#101010", href: SERIES_INDEX_PATH },
    { series: "The Last of Us",  seasonEp: "T2 · E3", logo: "Max",         logoColor: "#6D5AE0", href: SERIES_INDEX_PATH },
    { series: "The Boys",        seasonEp: "T4 · E7", logo: "prime video", logoColor: "#0A6C8E", href: SERIES_INDEX_PATH },
  ];
}
const EPISODES = episodesToday();   // episodes-ticker.tsx:93
```

O JSX renderiza texto afirmativo (`:130-135`):

```tsx
<strong>{current.series}</strong> · <span>{current.seasonEp}</span> · novo episódio hoje
```

e o CTA (`:157-165`):

```tsx
<a className="ep-ticker__cta" href={current.href}>
  <span>Onde assistir</span>
  <span style={{ color: current.logoColor }}>{current.logo}</span>
</a>
```

O componente e montado **incondicionalmente** em `apps/web/app/pt/page.tsx:648` — **fora** do gate
`allowPlaceholders` (`page.tsx:531`), que so protege "Em breve" (`:609-613`), publicidade (`:810`)
e noticias (`:826`). O gate existe e funciona (`apps/web/src/lib/home-placeholder-governance.ts:44-51`,
`nodeEnv !== "production" || flag === "1"`) — **o ticker simplesmente nao foi ligado nele.**

O proprio arquivo confessa a divida em comentario (`episodes-ticker.tsx:15-22`): *"MOCK VISUAL —
DIVIDA TECNICA ... nao ha `watch_availability` confirmada ... tensiona a invariante 6 e as regras de
streaming"*. Confissao no codigo nao e mitigacao no runtime.

Diferenca crucial em relacao ao seed demo: **as series citadas sao reais** (Wednesday, The Bear,
Severance, The Last of Us, The Boys) e **as marcas de streaming sao reais**, com **cores de marca**
(`#E50914` = vermelho Netflix). O `href` aponta para `SERIES_INDEX_PATH` (safe-link, evita 404),
mas isso nao desfaz a afirmacao textual.

#### (b) Chips de plataforma nos tiles de "Series em destaque"

Fonte do dado (`apps/web/app/pt/page.tsx:133-144`):

```ts
const HOME_VISUAL_PLATFORMS = ["Max","Netflix","Apple TV+","Star+","Prime Video","Disney+"] as const;
function homeVisualPlatform(index: number): string {
  return HOME_VISUAL_PLATFORMS[index % HOME_VISUAL_PLATFORMS.length] as string;
}
```

Aplicacao (`page.tsx:760-766`) — o indice **do slot visual** decide a plataforma:

```tsx
{seriesSlots.slice(0, 6).map((card, index) => (
  <HomeV4SeriesTile card={card} platform={homeVisualPlatform(index)} />
))}
```

e o chip e desenhado sobre o poster (`page.tsx:454-456`):

```tsx
<span className="home-v4-series-platform" aria-hidden="true">{platform}</span>
```

Aqui o `card` e uma **serie REAL do catalogo** (vinda de `getSeriesIndexData()`), e a plataforma e
escolhida por `index % 6`. **A serie real "X" ganha o chip "Netflix" porque calhou de estar no slot
1.** Isso e pior que o ticker: liga uma marca de streaming real a uma entidade real, sem nenhuma
`watch_availability`.

O `aria-hidden="true"` **nao remove o texto do HTML**. Googlebot e qualquer scraper leem "Netflix"
dentro do card da serie. `aria-hidden` esconde de leitor de tela — nao de crawler nem de humano
vidente. Nao e um gate.

Ambos os componentes rodam na home `/pt`, que **e indexavel** quando ha >= 2 secoes povoadas
(`apps/web/app/pt/page.tsx:103-109` -> `evaluatePortalIndexability` em
`apps/web/src/lib/portal-presenter.ts:62-75`, `MIN_PORTAL_SECTIONS = 2` em `:20`), e o `robots` sai
`index: true` (`page.tsx:119-121`).

#### (c) O teste de governanca que deveria pegar isso — e nao pega

`tests/web/public-navigation.test.ts:84-91` afirma, para a home:

```ts
const code = withoutBlockComments(source);   // source = apps/web/app/pt/page.tsx
expect(code).not.toMatch(/onde assistir/i);
```

O teste le **apenas `apps/web/app/pt/page.tsx`**. A string "Onde assistir" vive em
`apps/web/app/_components/episodes-ticker.tsx:158` e em
`apps/web/app/_components/hero-carousel.tsx:224` — **arquivos que o teste nunca abre**. O gate de
governanca passa verde enquanto a pagina renderizada afirma streaming. **DEBITO / RISCO:** o teste
da falsa seguranca.

---

### 13.6 O botao "Onde assistir" e real ou linka pra lugar nenhum?

Tres botoes distintos, tres respostas.

| Botao | Arquivo:linha | Destino | Veredito |
| --- | --- | --- | --- |
| CTA primario do hero-carousel | `apps/web/app/_components/hero-carousel.tsx:218-225` | `slide.href` | **PARCIAL/RISCO** — e o **mesmo href** do botao secundario "Ver ficha" (`:226-232`). Ambos vao para `detailPath(indexPath, slug)` (`apps/web/src/lib/home-hero-presenter.ts:237-244`), i.e. a pagina de detalhe. |
| CTA do Episodes Ticker | `apps/web/app/_components/episodes-ticker.tsx:157-165` | `SERIES_INDEX_PATH` | **PLACEHOLDER** — vai para a **listagem** de series, nao para a serie citada, muito menos para um streaming. |
| Secao `WatchProviders` (detalhe) | `apps/web/app/_components/watch-providers.tsx:33-46` | **nenhum link** | **REAL** (honesto): renderiza so `provider_name` + rotulos de modalidade. `deep_link` **nunca** e usado. |

Ou seja: o rotulo "Onde assistir" aparece **duas vezes em superficie indexavel** prometendo streaming
e, nas duas, leva a uma pagina interna. E na pagina de destino (a ficha), em banco real, a secao
"Onde assistir" **nem existe**, porque `watch.providers.length === 0`
(`apps/web/app/pt/filmes/[slug]/page.tsx:271`; `series/[slug]/page.tsx:298`). O usuario clica em
"Onde assistir" e nao encontra onde assistir. Promessa quebrada de ponta a ponta.

---

### 13.7 Existe carimbo "Atualizado em" baseado em `last_synced_at`?

Existe carimbo. **Nao e baseado em `last_synced_at`** — essa coluna nao existe na tabela.

- Codigo: `apps/web/src/lib/watch-presenter.ts:149-157` deriva `updatedAtLabel` do
  **`fetched_at` mais recente** entre as ofertas exibidas (`mostRecentIso`, `:98-106`), formatado por
  `formatWatchDate` (`:88-95`, puro, sem `Date`).
- Leitura: `apps/web/src/server/entity-watch.ts:49-54` seleciona `fetchedAt`.
- Comportamento honesto: sem `fetched_at`, `updatedAtLabel === null` e o paragrafo somem
  (`watch-providers.tsx:47-49`). Sem provedores, `updatedAtLabel` e forcado a `null`
  (`watch-presenter.ts:152`). **Nao alega frescor que nao tem.** Coberto por
  `tests/web/watch-presenter.test.ts:28-34`.

Divergencias:

- `.claude/rules/ingestion.md` exige que superficies de "onde assistir" carimbem **`last_synced_at`**;
  o schema tem `fetched_at` (`schema.prisma:640`). Semanticamente proximo, nominalmente divergente.
  **DEBITO (NAO BLOQUEIA PRODUCAO)** — alinhar doc ou schema.
- `stale_after` (`schema.prisma:641`) existe e **nunca e escrito nem lido**. A stale policy de
  `services/sync/src/stale-policy.ts` nao cobre `watch_availability`. **DEBITO.**
- Na pratica, o unico `fetched_at` jamais gravado e a constante `"2026-06-15"` do seed demo
  (`public-demo-seed-plan.ts:207`). Portanto o carimbo, hoje, **so pode exibir uma data falsa**.
  O mecanismo e **REAL**; o dado que ele carimba e **PLACEHOLDER**.

Nas superficies mock (ticker, chips) **nao ha carimbo nenhum** — nem falso nem verdadeiro. Elas
afirmam disponibilidade sem qualquer indicacao de data ou fonte.

---

### 13.8 Analise de risco: invariantes 6 e 8, SEO, juridico

#### Invariante 6 (dado sem licenca clara nao aparece em pagina indexavel)

**VIOLADA na home.** Os chips (`page.tsx:454-456`) e o wordmark do ticker
(`episodes-ticker.tsx:159-164`) sao "dados" de disponibilidade que:
1. nao vem de `watch_availability`;
2. nao tem `display_allowed`;
3. nao tem `license_status` (a coluna nem existe);
4. nao tem `source_licenses` correspondente (`seed-data.ts:127-140` so cobre rating sources);
5. estao numa pagina cujo `robots` sai `index: true` (`page.tsx:119-121`).

Nao e apenas "dado sem licenca clara": e **dado sem fonte**, inventado no cliente. A invariante 6
protege contra exibir dado licenciado de forma duvidosa; aqui se exibe dado **que nao existe**. E
uma violacao mais grave do que a que a invariante enderecava.

#### Invariante 8 (sem pirataria)

**Nao violada literalmente.** Nenhum torrent, IPTV, player, embed ou link de download aparece em
lugar algum: `deep_link` nunca e renderizado (`watch-providers.tsx:33-46`), `OfferType`
(`schema.prisma:109-116`) so admite modalidades legais, e o presenter descarta explicitamente
`torrent`/`iptv` (`watch-presenter.ts:128`, testado em `tests/web/watch-presenter.test.ts:44-50`).
Os CTAs mock apontam para rotas internas.

**Mas o espirito da invariante 8 e tensionado:** o valor que a invariante protege e "nunca direcionar
o usuario a um destino de consumo ilegitimo/enganoso". Um botao "Onde assistir NETFLIX" que nao leva
a Netflix nem a informacao verificada e desinformacao de disponibilidade — a mesma familia de dano
que a regra combate. Classifico como **RISCO adjacente a invariante 8**, nao como violacao dela.
A violacao **direta** e da invariante 6.

#### Risco juridico

| Vetor | Descricao | Severidade |
| --- | --- | --- |
| Uso de marca de terceiro | "NETFLIX", "Max", "Apple TV+", "prime video", "Star+", "Disney+" renderizados como wordmark colorido com a **cor de marca** (`#E50914`, `episodes-ticker.tsx:58`) associados a titulos reais, sem licenca, sem `logo_allowed`, sem relacao comercial | **Alta** |
| Afirmacao factual falsa | "The Last of Us · T2 · E3 · novo episodio hoje" (`episodes-ticker.tsx:130-135`) e uma afirmacao editorial verificavel e **falsa por construcao** (data fixa no bundle) | **Alta** |
| Associacao indevida | Serie real do catalogo recebe chip "Netflix" por `index % 6` (`page.tsx:764`). Pode afirmar que uma obra da Netflix esta na Disney+ e vice-versa | **Alta** |
| Publicidade enganosa (CDC) | Superficie publica em pt-BR direcionada ao Brasil, afirmando disponibilidade de servico pago inexistente | **Media-Alta** |
| TMDB / JustWatch | **Nao aplicavel hoje** — `/watch/providers` nao e consumido (`endpoints.ts:36-47`). Vira obrigacao no dia em que for | — |

#### Risco de SEO

| Vetor | Descricao |
| --- | --- |
| Desinformacao indexada | `/pt` sai com `index: true` (`page.tsx:119-121`) carregando "novo episodio hoje" e chips de plataforma. Conteudo factualmente errado, indexado, sobre entidades nomeadas |
| Conteudo estatico eterno | Como e hardcoded no bundle, a pagina afirmara "Wednesday T2 E6 novo episodio hoje" **todos os dias, indefinidamente**. Sinal classico de baixa qualidade / conteudo gerado sem manutencao |
| Schema.org | **Sem risco direto.** O JSON-LD de filme (`apps/web/app/pt/filmes/[slug]/page.tsx:119-126`) nao emite `offers`, `potentialAction` nem `AggregateRating`; a home nao emite schema de disponibilidade. Nenhuma disponibilidade falsa entra em structured data. Isso reduz — mas nao elimina — o risco: o texto visivel basta para dano de credibilidade e para acao de marca |
| Gate anti-thin | `where_to_watch_by_country` existe como tipo de bloco de valor (`packages/seo/src/value-blocks.ts:23`), mas **nenhuma pagina o computa**. `evaluateMovieIndexability` (`apps/web/src/lib/movie-indexability.ts:50-62`) passa `displayedRatings: []` e conta so `renderableBlockCount` de `content_blocks`. A secao "Onde assistir" **nao conta** para o gate. Conservador e correto — **nao ha aqui inflacao do gate anti-thin** |
| `page_indexability_decisions` | Nenhuma escrita em codigo algum (`grep pageIndexabilityDecision` -> 0 hits em `.ts`/`.tsx`). As colunas `hasWatchData` (`schema.prisma:664`) etc. nunca sao preenchidas. **DEBITO** transversal |

#### Isso **BLOQUEIA PRODUCAO**?

**SIM — BLOQUEIA PRODUCAO**, por dois itens especificos e apenas por eles:

1. `apps/web/app/_components/episodes-ticker.tsx` montado sem gate em `apps/web/app/pt/page.tsx:648`.
2. `homeVisualPlatform` / chip de plataforma em `apps/web/app/pt/page.tsx:133-144` + `:454-456` + `:764`.

Tudo o mais desta secao (tabela vazia, servico inexistente, worker stub, secao de detalhe omitida)
e **ausencia de feature**, nao mentira. Ausencia nao bloqueia. **Afirmacao falsa sobre marca de
terceiro em pagina indexavel bloqueia.**

Anexo: `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:489-490` ja classificou ambos como
"Alta / BLOQUEIA: SIM". Esta auditoria **confirma independentemente** essa avaliacao lendo o codigo.

---

### 13.9 O que falta para ficar correto

#### PROXIMO PASSO imediato (pre-producao, custo baixo, mata o bloqueio)

1. **PROXIMO PASSO** — Envolver `<EpisodesTicker />` (`apps/web/app/pt/page.tsx:648`) no gate
   existente: `{allowPlaceholders ? <EpisodesTicker /> : null}`. Uma linha. O gate ja existe e ja e
   usado tres vezes na mesma pagina (`:611`, `:810`, `:826`).
2. **PROXIMO PASSO** — Passar `platform={null}` (ou remover o chip) quando `!allowPlaceholders` em
   `HomeV4SeriesTile` (`page.tsx:760-766`, `:454-456`). Alternativa mais simples: deletar o chip ate
   haver `watch_availability`.
3. **PROXIMO PASSO** — Renomear o CTA primario do hero (`hero-carousel.tsx:224`) de "Onde assistir"
   para algo verdadeiro ("Ver detalhes"/"Abrir ficha"), ou fazer o botao apontar para a ancora
   `#watch-providers-title` **somente quando** o slide tiver oferta real. Hoje os dois botoes tem o
   mesmo `href` (`:221` e `:228`).
4. **PROXIMO PASSO** — Estender `tests/web/public-navigation.test.ts:84-91` para varrer tambem os
   componentes montados pela home (`apps/web/app/_components/episodes-ticker.tsx`,
   `hero-carousel.tsx`), fechando o buraco descrito em 13.5(c). Adicionar assertiva de que nenhum
   componente de home contenha os literais `NETFLIX|Disney\+|Prime Video|Max|Apple TV|Star\+`.

#### Para a feature existir de verdade (ordem sugerida)

5. **Decisao humana de licenca.** Escolher a fonte e registrar a decisao. Duas rotas:
   - **TMDB `/watch/providers`**: barato (a chave e o client ja existem,
     `api-clients/tmdb/src/http.ts` ja tem throttle/retry/breaker), cobertura por pais, **mas os
     dados sao fornecidos pelo JustWatch e o TMDB exige atribuicao explicita ao JustWatch** e
     proibe uso comercial dos dados de disponibilidade sem acordo com o JustWatch. Nao ha deep link
     de oferta granular no plano gratuito.
   - **Streaming Availability (RapidAPI)**: e o que `docs/API_SOURCES.md:180-201` designa como
     primario; ja tem chave prevista (`SCREENA_STREAMING_PROVIDER_KEY`) e linha em `api_providers`
     (`seed-data.ts:120`). Requer contratacao e leitura dos termos.

   **NAO FOI POSSIVEL CONFIRMAR** os termos de licenca vigentes de nenhuma das duas fontes: nenhuma
   analise de licenca de streaming existe no repositorio (nao ha `source_licenses` para plataformas,
   nao ha ADR, nao ha nota em `docs/`), e esta auditoria e offline por regra (sem acesso a rede).
   A decisao e **humana e obrigatoria** (CLAUDE.md secao 6).

6. **Schema** — antes de qualquer worker:
   - adicionar `@@unique([entityType, entityId, countryCode, providerKey, offerType])` (ou usar
     `providerName` normalizado) para permitir upsert idempotente;
   - adicionar `license_status LicenseStatus @default(unknown)` a `watch_availability` (paridade com
     `external_ratings`, `schema.prisma:606`);
   - adicionar FK `provider_api -> api_providers.key` (paridade com `ExternalRating.provider`,
     `schema.prisma:613`) — isso teria impedido o `"public-demo-seed"` orfao;
   - criar `platforms` (catalogo canonico de plataforma: nome, logo, `logo_allowed`, homepage) e
     ligar `watch_availability.provider_key -> platforms.key`, cumprindo o que
     `services/streaming/README.md:10-11` promete;
   - decidir entre `fetched_at` e `last_synced_at` (hoje o schema e a regra de ingestao divergem);
   - popular `stale_after` conforme `.claude/rules/ingestion.md` (onde assistir = **diario**).
   - **Requer tarefa aprovada de banco** (CLAUDE.md, lista NUNCA).

7. **`source_licenses`** — criar linhas para a fonte de disponibilidade escolhida, com
   `requires_attribution=true` e `attribution_text`/`terms_url` preenchidos. Hoje
   `SOURCE_LICENSE_SEED` (`seed-data.ts:127-140`) **nao tem nenhuma** linha de streaming.

8. **Worker offline** (`services/streaming/`, TS/Node + Prisma, seguindo o padrao de
   `services/ingestion`): cache bruto em `api_cache`, log obrigatorio em `api_sync_logs`,
   retry/backoff/jitter, rate limit por provider, circuit breaker, hash de payload. **Nunca no
   render** (invariante 3). Nao reimplementar em Python: `workers/streaming_worker.py` e scaffold
   legado.

9. **Atribuicao na UI** — `watch-providers.tsx` hoje nao renderiza atribuicao alguma. Se a fonte for
   TMDB/JustWatch, o componente precisa exibir credito e linkback conforme
   `requires_attribution`/`requires_linkback`, alem do carimbo ja existente.

10. **Deep links** — `deep_link` (`schema.prisma:634`) so deve ser renderizado apos validacao de que
    a fonte entrega URL oficial da plataforma. Enquanto isso, manter o comportamento atual
    (sem link) e a escolha correta.

11. **Gate anti-thin** — so entao `where_to_watch_by_country` (`packages/seo/src/value-blocks.ts:23`)
    pode passar a contar como bloco de valor em `evaluateMovieIndexability`
    (`apps/web/src/lib/movie-indexability.ts:50-62`). Nao antecipe.

---

### 13.10 O que NAO consegui confirmar

- **NAO FOI POSSIVEL CONFIRMAR** o conteudo real de `watch_availability` em qualquer banco
  (producao/EasyPanel/staging): a auditoria e estatica e nao ha acesso a `DATABASE_URL`. A afirmacao
  "a tabela esta vazia em banco real" e **inferida** do fato de que o unico `create` no monorepo esta
  no seed demo (`public-demo-seed.ts:234`), que aborta em producao (`public-demo-seed-plan.ts:657-658`).
- **NAO FOI POSSIVEL CONFIRMAR** os termos de licenca atuais de TMDB `/watch/providers`, JustWatch,
  Streaming Availability (RapidAPI) e KASO — sem acesso a rede, e o repositorio nao guarda copia dos
  termos nem decisao registrada.
- **NAO FOI POSSIVEL CONFIRMAR** se `tests/web/public-navigation.test.ts` passa hoje (nao executei
  a suite, conforme a restricao de somente leitura). A analise de 13.5(c) e sobre o **alcance** do
  teste (le so `apps/web/app/pt/page.tsx`, `:73`), nao sobre seu resultado.
- **NAO FOI POSSIVEL CONFIRMAR** se `NODE_ENV=production` esta efetivamente setado no deploy
  EasyPanel/Nixpacks. Se **nao** estiver, `allowHomeVisualPlaceholders`
  (`apps/web/src/lib/home-placeholder-governance.ts:50`) retorna `true` e **tambem** os placeholders
  de "Em breve", publicidade e noticias vazam — o que ampliaria o escopo do bloqueio para alem do
  ticker e dos chips.

---

### 13.11 Resumo de status

| Capacidade | Status |
| --- | --- |
| Tabela `watch_availability` | **REAL** |
| Tabelas `platforms` / `providers` | **NAO IMPLEMENTADO** |
| Ingestao de disponibilidade | **NAO IMPLEMENTADO** |
| Client de streaming (`streaming_availability` / `kaso`) | **NAO IMPLEMENTADO** (so README) |
| TMDB `/watch/providers` | **NAO IMPLEMENTADO** |
| Chave de API de streaming configurada e usada | **NAO IMPLEMENTADO** (env existe, ninguem le) |
| Secao "Onde assistir" (paginas de detalhe) | **PLACEHOLDER** (codigo real, dado so de seed demo) |
| Presenter + gate de licenca + anti-pirataria | **REAL** (puro, testado) |
| Carimbo "Atualizado em" | **REAL** como mecanismo (`fetched_at`), **PLACEHOLDER** como dado |
| Deep links / links para plataforma | **NAO IMPLEMENTADO** (correto por ora) |
| Chips de plataforma na home | **PLACEHOLDER** + **RISCO** + **BLOQUEIA PRODUCAO** |
| Episodes Ticker ("Onde assistir <streaming>") | **PLACEHOLDER** + **RISCO** + **BLOQUEIA PRODUCAO** |
| CTA "Onde assistir" do hero | **PARCIAL** (aponta para a ficha) + **DEBITO** |
| `page_indexability_decisions.has_watch_data` | **NAO IMPLEMENTADO** (coluna nunca escrita) |
| `stale_after` / stale policy de streaming | **NAO IMPLEMENTADO** |
| Schema.org com disponibilidade falsa | **NAO IMPLEMENTADO** — e a boa noticia da secao |


---

## Parte 14 — Funcionalidades tipo TV Time / Trakt

### 14.0 Veredito em uma frase

**NAO existe `model User`, `model Session` nem `model Account` no `schema.prisma`** — o repositorio
tem **27 models** (`packages/db/prisma/schema.prisma`, todos de catalogo/editorial: filmes, series,
temporadas, episodios, pessoas, ratings, noticias, cache, logs) e **nenhum** deles representa uma
pessoa que usa o site. Sem identidade de usuario, **toda** a familia de features de tracking social
(o que TV Time e Trakt sao) esta em **NAO IMPLEMENTADO** — nao "parcial", nao "roadmap iniciado":
zero. Nao ha tabela, nao ha endpoint de escrita, nao ha sessao, nao ha login. Os dois unicos vestigios
visiveis na UI — os botoes **"☆ Avaliar"** e **"✓ Marcar como assistido"** na home — sao
`<span aria-disabled="true">` sem `onClick`, sem estado e sem mutation
(`apps/web/app/pt/page.tsx:336-342`); pura casca visual.

---

### 14.1 O pre-requisito unico e inegociavel: identidade de usuario

Antes de qualquer linha de tabela desta secao, uma afirmacao que vale para **todas as 15 funcoes**
abaixo, sem excecao:

> Todas dependem de **um** pre-requisito comum que hoje **nao existe em lugar nenhum do repositorio**:
> **identidade de usuario**. E ela nao e uma tabela `users(id, email)` — e um subsistema inteiro:
> **autenticacao** (login/OAuth/sessao), **conformidade LGPD** (dado pessoal, consentimento, direito
> ao esquecimento, exportacao), **moderacao** (comentarios, reviews, reacoes sao conteudo gerado por
> usuario — UGC), **anti-spam / anti-abuso**, **e-mail transacional** (verificacao, notificacao,
> reset), rate-limiting por conta e um modelo de permissoes. Nada disso esta esbocado.

Evidencia direta no codigo:

| Sinal | Evidencia | Leitura |
| --- | --- | --- |
| Nenhum model de usuario | `grep '^model (User\|Session\|Account\|Watchlist\|Favorite\|Follow\|Comment\|Reaction\|Activity\|Profile)' packages/db/prisma/schema.prisma` -> **0** | Nao ha a quem atribuir um "assistido" |
| Nenhuma lib de auth | `package.json` / `apps/web/package.json` / `apps/admin/package.json` sem `next-auth`/`lucia`/`@auth`/`clerk`/`supabase` | Nao ha infraestrutura de sessao publica |
| Unica auth do monorepo e Basic Auth de **admin** | `apps/admin/middleware.ts:35-39` (Basic Auth stateless por ENV) | Protege o painel interno; **nao** e conta de usuario final |
| Botoes de acao sao casca | `apps/web/app/pt/page.tsx:336-342` — `<span aria-disabled="true">` sem `onClick`/estado/mutation (fato: sem model User/Watchlist/Favorite) | UI promete interacao que o backend nao suporta |
| Header documenta a ausencia | `apps/web/app/_components/site-header.tsx:26` documenta **login/watchlist inativos**; a "busca" e link para `/pt/explorar/`, nao campo autenticado | A propria navegacao admite que nao ha area logada |
| Seguir/visto/progresso/notificacao inexistem | fato de auditoria: "nenhum model de usuario no schema" para seguir serie, episodios vistos, progresso e notificacoes | A espinha dorsal do TV Time/Trakt esta ausente |

Corolario pratico: **nao adianta priorizar "marcar assistido" isoladamente**. A primeira dessas
features a ser construida paga o custo inteiro do subsistema de identidade; as 14 seguintes sao
incrementos baratos **sobre** essa fundacao. Por isso a Parte 26 coloca toda esta familia numa
**Fase 5 (P3, meses)**, atras da base indexavel.

---

### 14.2 Tabela comparativa — Screen vs TV Time / Trakt

Legenda de colunas: **UI mock?** = existe casca visual no front que finge a feature? · **Banco?** =
existe tabela/coluna que a suporte? · **Endpoint?** = existe rota de escrita (server action, route
handler, mutation)? · Prioridade P0–P3 assume que a **fundacao de identidade** ja foi decidida.

| Funcao | TV Time / Trakt | Screen hoje | Status | UI mock? | Banco? | Endpoint? | Prioridade | Obs. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Marcar **episodio** assistido | Core do TV Time; checkin por episodio, base de todo o resto | Nao existe. Nem ha rota de episodio publica (`/pt/series/{slug}/temporada-{n}/` ausente) | **NAO IMPLEMENTADO** | Nao | Nao (`Episode` existe so como catalogo, sem vinculo a usuario) | Nao | P3 | Precisa de identidade + da rota de episodio (Parte 9) antes de existir |
| Marcar **filme** assistido | Trakt: "watched"; TV Time: filmes | Botao **"✓ Marcar como assistido"** e `<span aria-disabled>` | **NAO IMPLEMENTADO** | **Sim** (`pt/page.tsx:340`) | Nao | Nao | P3 | Unica casca com aparencia de feature; enganosa se lida como funcional |
| **Watchlist** (quero ver) | Feature central de descoberta em ambos | Nao existe; `site-header.tsx:26` documenta watchlist **inativa** | **NAO IMPLEMENTADO** | Nao (link some quando deslogado, mas nao ha logado) | Nao | Nao | P3 | "Em breve" (`upcoming`) e catalogo editorial, nao watchlist pessoal |
| **Series acompanhadas** (following) | TV Time: "shows I'm watching" | Nao existe; sem `Follow`/`Subscription` | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | Depende de identidade + notificacao para ter valor |
| **Progresso por temporada** | Trakt: % assistido, "up next" | Nao existe. `Season`/`Episode` estao no banco mas sem estado por usuario | **NAO IMPLEMENTADO** | Nao | Parcial: catalogo de temporada/episodio existe (`store.ts`), **mas nada por usuario** | Nao | P3 | O calculo de progresso exige o join usuario×episodio que nao ha |
| **Calendario de episodios** | TV Time/Trakt: "o que estreia hoje/semana" personalizado | **EpisodesTicker mock**: array hardcoded ("novo episodio hoje" + streaming) | **PLACEHOLDER** (+ **RISCO**) | **Sim** (`episodes-ticker.tsx:53-91`) | Nao (nao ha coluna `air_date` recente consultada; sem `next_episode_to_air`) | Nao | P2/P3 | Um calendario **editorial** (nao personalizado) e P2 e nao exige login; o **personalizado** e P3. Hoje o ticker **afirma fatos falsos** sem gate: **BLOQUEIA PRODUCAO** |
| **Notificacoes** (novo episodio, etc.) | Push/e-mail por novo episodio | Nao existe; sem canal, sem model, sem e-mail | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | Exige e-mail transacional + preferencia por usuario |
| **Reacoes** (emoji/like) | TV Time: reacoes por episodio | Nao existe | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | UGC leve, mas ainda e UGC: precisa de moderacao/anti-spam |
| **Comentarios** | Discussao por episodio/filme (spoiler-tagged) | Nao existe | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | UGC pesado: moderacao, spoiler, LGPD, denuncia. Custo alto |
| **Reviews de usuarios** | Trakt/TV Time: nota + texto do usuario | Nao existe. `review_summary` no enum e **review editorial do Screen** (Entity Writer), nao do usuario | **NAO IMPLEMENTADO** | Nao | Nao (o `screen_score` e nota **editorial propria**, nao agregacao de usuarios) | Nao | P3 | Cuidado semantico: nunca fabricar `AggregateRating` a partir de reviews de usuario (invariante) |
| **Perfil publico** | Pagina do usuario com historico/badges | Nao existe; nao ha `Profile` nem slug de usuario | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | Cria superficie indexavel de UGC — exige politica de privacidade/noindex por default |
| **Estatisticas pessoais** | Trakt: horas assistidas, generos, streak | Nao existe (nao ha evento de "assistido" para agregar) | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | Derivada: so possivel depois de "marcar assistido" acumular dados |
| **Importacao de historico** | Trakt: import de outros trackers/CSV | Nao existe | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | So faz sentido apos watchlist/assistido existirem; ETL por conta |
| **Compartilhamento em stories** | TV Time: card de story p/ Instagram | Nao existe; sem `og:image`/preview social por pagina (`layout.tsx:20-25` so define `type=website`) | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | Falta ate a base (OG image dinamica) que serviria tambem a SEO |
| **Feed de atividade** | Timeline social (amigos, follows) | Nao existe; sem `Activity`, sem grafo social | **NAO IMPLEMENTADO** | Nao | Nao | Nao | P3 | Feature mais social (e mais cara em moderacao) de todas |

Resumo da coluna Status: **14 de 15 funcoes = NAO IMPLEMENTADO**; **1 (calendario) = PLACEHOLDER**,
e esse placeholder e justamente o que **vaza para producao** afirmando episodio/streaming falsos.

---

### 14.3 O unico vestigio "quente": o EpisodesTicker e um falso calendario — **DEBITO** e **RISCO**

A unica funcao desta familia com **pixel na tela** e o calendario, e ele e um **mock perigoso**, nao
uma feature:

- `apps/web/app/_components/episodes-ticker.tsx:53-91` — array literal com 5 series
  (Wednesday/Netflix, The Bear/Star+, Severance, The Last of Us, The Boys), cada uma com logo de
  marca e cor, afirmando **"novo episodio hoje"** e **"Onde assistir <streaming>"** (JSX em `:130-135`
  e `:157-165`).
- Renderizado **sem gate de ambiente** em `apps/web/app/pt/page.tsx:648`: o
  `allowHomeVisualPlaceholders()` (`home-placeholder-governance.ts:44-51`) cobre ads/news/coming-soon/
  newsletter, mas **nao** cobre o ticker (nem os chips de plataforma dos tiles de serie,
  `pt/page.tsx:133-144,454-456`).
- Consequencia: em producao a home afirma um **fato de disponibilidade e de agenda que ninguem
  sincronizou** — colide com a **invariante 6** (dado sem licenca/veracidade em pagina indexavel) e
  com a **invariante 8/regra de "onde assistir"**. E a home e **indexavel por default**
  (`portal-presenter.ts:62-75`, `MIN_PORTAL_SECTIONS=2`).
- Ate o teste de governanca erra o alvo: `tests/web/public-navigation.test.ts` faz assert de
  "onde assistir" **em `pt/page.tsx`**, mas a string real vive em `episodes-ticker.tsx:158` e
  `hero-carousel.tsx:224` — arquivos que o teste **nao le**.

Este item e **BLOQUEIA PRODUCAO** e ja consta na Fase 0 do roadmap (Parte 26): gatear ou remover o
ticker antes do dominio oficial. Note que "remover o mock" **nao** entrega a feature — apenas para de
mentir. O calendario real personalizado continua P3; um calendario **editorial nao-personalizado**
(baseado em `air_date` ingerido) e uma feature P2 legitima e **nao** precisa de login.

---

### 14.4 Por que "onde assistir mock" e "reviews de usuario" nunca podem colar sem identidade

Duas armadilhas semanticas especificas do Screen, que a governanca ja antecipa:

1. **`screen_score` nao e review de usuario.** O `screen_score`/`screen_score_display`
   (`schema.prisma:248-250,286-288`) e **nota editorial propria** do Screen, hoje escrita **so** pelo
   seed demo. Ele nunca deve ser apresentado como "nota dos usuarios" nem virar `AggregateRating`
   (invariante: nada de `AggregateRating` fingindo nota propria/de terceiro). Quando reviews de
   usuario existirem, serao uma **fonte separada**, com sua propria licenca de exibicao e moderacao.
2. **UGC e superficie de SEO negativa se malfeita.** Perfil publico, comentarios e feed criam
   milhares de URLs finas e nao-revisadas. Isso colide frontalmente com o **gate anti-thin**
   (invariante 5): tais paginas nasceriam `noindex` por default e exigiriam politica explicita para
   nunca poluir o indice. Ou seja, a familia social nao so **nao ajuda** o SEO — ela **ameaca** o
   ativo de SEO se lancada sem disciplina.

---

### 14.5 Escala honesta: o Screen nao e um TV Time/Trakt pequeno — e outra coisa

Nao ha paridade a fingir. TV Time e Trakt sao **redes sociais de consumo audiovisual** com anos de
UGC, apps nativos, grafo social e milhoes de checkins. O Screen, nesta familia, esta em **grau zero**:
sem usuario, sem sessao, sem um unico "assistido" gravavel. Comparar 1:1 aqui e comparar um catalogo
editorial com uma rede social — sao produtos diferentes.

**Onde o Screen tem, ainda assim, vantagem estrutural** (e vale registrar para nao subestimar a
arquitetura): a base entity-first + governanca + `content_blocks` versionados + pureza de render foi
desenhada para **SEO e qualidade de dado**, nao para engajamento social. Quando/se a camada social
chegar, ela se conecta a um grafo de entidades **ja canonico e indexavel** — cada "assistido"
aponta para uma entidade real com slug, schema e blocos de valor, e nao para um registro solto. Isso
e uma fundacao melhor para social do que a maioria dos trackers teve; so que **essa ordem importa**.

---

### 14.6 A tese de roadmap: social e a feature de MAIOR retencao e MENOR valor de SEO

Esta e a conclusao que ordena o roadmap (e por que a Parte 26 poe tudo isso na **Fase 5, P3**):

- **Maior retencao.** Tracking social e o que faz o usuario **voltar todo dia**: marcar o episodio,
  ver o progresso, receber a notificacao, comparar com amigos. TV Time/Trakt vivem disso. E,
  legitimamente, o motor de retencao mais forte que o Screen poderia ter.
- **Menor valor de SEO.** Quase tudo aqui e **conteudo por-usuario, privado ou nao-indexavel**:
  watchlist, progresso, estatisticas, feed. O que **e** publico (perfil, comentarios, reviews) e UGC
  que, sem curadoria, **piora** o indice (gate anti-thin) e adiciona risco (moderacao, LGPD, spam).
  Nenhuma dessas features traz trafego organico novo de buscador — elas **retem** quem ja veio, nao
  **trazem** quem nao veio.
- **O ativo do Screen hoje e o buscador, nao a base de usuarios** — porque **nao ha** base de
  usuarios. O trafego inicial vem de paginas de entidade indexaveis. Logo, construir social antes de
  ter paginas que rankeiam e otimizar retencao de um publico que ainda nao chegou.

**PROXIMO PASSO / ordem recomendada** (coerente com a Parte 26):

1. **P0 — parar de mentir:** gatear/remover o EpisodesTicker e os chips de plataforma (o unico
   pedaco desta familia visivel em producao). **BLOQUEIA PRODUCAO.**
2. **P1–P2 — construir o ativo de SEO primeiro:** rotas de temporada/episodio, densidade editorial
   (>= 2 blocos de valor), grafo de entidades, `screen_score`/ratings/onde-assistir **reais**. E aqui
   que entra, opcionalmente, um **calendario editorial nao-personalizado** (P2, sem login).
3. **P3 — so entao, social:** pagar **de uma vez** o custo de identidade (auth + LGPD + moderacao +
   e-mail + anti-spam) e, sobre ele, entregar marcar-assistido → watchlist → progresso → seguir →
   notificacao → estatisticas → importacao → reacoes/comentarios/reviews → perfil → feed, nessa ordem
   de dependencia.

Em uma linha: **o Screen deve priorizar SEO/entidade antes de social** — porque a retencao social so
tem quem reter depois que a base indexavel trouxer o publico, e porque a fundacao de identidade e cara
demais para ser paga antes de o produto de descoberta existir.


---

## Parte 15 — Funcionalidades tipo Letterboxd

### 15.0 Resposta direta (leia isto primeiro)

O Screen **nao tem uma unica funcionalidade social/pessoal do Letterboxd**. A razao e estrutural, nao de acabamento: **nao existe modelo de usuario no schema**. Uma varredura em `packages/db/prisma/schema.prisma` (27 models, `schema.prisma:144-804`) nao retorna `User`, `Account`, `Session`, `Watchlist`, `Favorite`, `UserRating`, `Diary`, `List`, `Follow`, `Like`, `Activity` nem nada equivalente — confirmado pelo digest (fatos **311** e **259**). Sem uma tabela de identidade, **nenhuma** feature centrada em usuario pode existir: diario, listas, reviews de usuario, notas de usuario, curtidas, watchlist, perfil, seguidores, feed social, rankings, top 4, favoritos e estatisticas anuais sao todos **NAO IMPLEMENTADO**.

O que existe hoje sao **duas affordances puramente decorativas** na home, que parecem Letterboxd mas nao fazem nada:

- `apps/web/app/pt/page.tsx:336-338` — `<span aria-disabled="true">☆ Avaliar</span>`
- `apps/web/app/pt/page.tsx:340-342` — `<span aria-disabled="true">✓ Marcar como assistido</span>`

Ambos sao `<span>` sem `onClick`, sem estado, sem mutation, sem endpoint (fato **11**). O proprio `apps/web/app/_components/site-header.tsx:26` documenta em comentario que login/watchlist estao **inativos** (fato **259**). Nao ha rota de autenticacao, nao ha sessao, nao ha `app/api/**` (fato **135**: `GET /` e ate `404`), nao ha cookie de login. O Screen e, arquiteturalmente, um **catalogo editorial de leitura**, nao uma rede social de cinefilia.

> Escala honesta: o Letterboxd tem dezenas de milhoes de membros, bilhoes de entradas de diario e uma cultura propria (o "top 4", os reviews-piada, o Letterboxd Year in Review). O Screen tem **zero usuarios** e **zero linhas** em qualquer tabela social — porque as tabelas nao existem. Nao ha paridade a fingir; ha uma categoria inteira de produto ausente.

---

### 15.1 Tabela comparativa item-a-item

| Funcao | Letterboxd | Screen hoje | Status | Pre-requisito | Prioridade | Obs. |
| --- | --- | --- | --- | --- | --- | --- |
| **Diario (log de "assistido em X data")** | Nucleo do produto; cada usuario registra data, re-watch, nota, review por sessao | Botao decorativo "✓ Marcar como assistido" (`pt/page.tsx:340-342`), sem backend | **NAO IMPLEMENTADO** | Model `User` + `DiaryEntry` + auth + FK para `movies`/`tv_shows` | Baixa | Depende de identidade; nenhuma tabela existe |
| **Listas de usuario** | Listas curadas, ranqueadas, publicas/privadas, com descricao e capa | Inexistente; rotulos de "lista" no footer (`site-footer.tsx:44-54`) sao `<a>` para o indice pai, sem rota real (fato **21**) | **NAO IMPLEMENTADO** | `User` + `UserList` + `UserListItem` (ordem) | Baixa | Nao confundir com listagens `/pt/filmes` (catalogo, nao curadoria) |
| **Reviews de usuario** | Milhoes de reviews com spoiler-tag, curtidas, comentarios | Inexistente; o unico texto editorial e o `content_blocks` gerado offline pelo Entity Writer (nao e do publico) | **NAO IMPLEMENTADO** | `User` + `UserReview` + moderacao + anti-spam | Baixa | Screen tem review **editorial** planejada (`review_summary`), nao review de usuario — ver 15.3 |
| **Notas de usuario (0.5–5 estrelas)** | Meia-estrela; media agregada por filme | `screen_score` e nota **editorial propria** (nao de usuario), populada so no seed demo (`public-demo-seed.ts:261-263`); botao "☆ Avaliar" morto | **NAO IMPLEMENTADO** | `User` + `UserRating` + agregacao | Baixa | `screen_score != nota de usuario`; ver Parte 12 |
| **Curtidas (likes)** | Curtir filme, review, lista | Inexistente | **NAO IMPLEMENTADO** | `User` + tabela de reacao polimorfica | Baixa | — |
| **Watchlist** | "Quero assistir"; principal loop de retencao | Botao/rotulo decorativo; `site-header.tsx:26` marca watchlist como inativa | **NAO IMPLEMENTADO** | `User` + `Watchlist` + FK entidade | Baixa-Media | Feature mais barata de portar (1 tabela n:n) e alto valor de retencao |
| **Perfil de usuario** | Pagina publica com stats, favoritos, atividade | Inexistente; nao ha rota `/u/{handle}` nem sessao | **NAO IMPLEMENTADO** | `User` + rota de perfil + privacidade | Baixa | Conflita com pureza de render se o perfil for dinamico por request |
| **Seguidores / seguir** | Grafo social assimetrico | Inexistente | **NAO IMPLEMENTADO** | `User` + `Follow` (self-relation) | Muito baixa | Rede social e o ultimo passo, nao o primeiro |
| **Atividade social (feed)** | Feed de quem voce segue: logs, reviews, listas | Inexistente | **NAO IMPLEMENTADO** | Todo o stack social + fan-out de feed | Muito baixa | Custo de engenharia desproporcional ao MVP |
| **Rankings / listas ranqueadas** | Listas ordenadas, "top filmes de 2025" | Inexistente; nao ha ordenacao por usuario | **NAO IMPLEMENTADO** | `UserList` com ordem + `User` | Muito baixa | — |
| **Top 4 (favoritos do perfil)** | Vitrine de 4 posters no topo do perfil | Inexistente | **NAO IMPLEMENTADO** | `User` + `Favorite` (limite 4, ordenado) | Muito baixa | Assinatura cultural do Letterboxd; puramente identitario |
| **Favoritos** | Marcar filmes como favoritos | Inexistente | **NAO IMPLEMENTADO** | `User` + `Favorite` | Muito baixa | — |
| **Estatisticas anuais (Year in Review)** | Retrospectiva anual gamificada por usuario | Inexistente; nao ha dado de usuario a agregar | **NAO IMPLEMENTADO** | Todo o historico de diario/notas por usuario | Muito baixa | So faz sentido apos anos de diario acumulado |

**Leitura da coluna Status:** 13/13 funcoes = **NAO IMPLEMENTADO**. Nenhuma esta em **PARCIAL** ou **PLACEHOLDER-com-backend** — porque o denominador comum (o model `User`) esta ausente, e todas dependem dele.

---

### 15.2 O achado estrutural: por que tudo cai na mesma barreira

O Letterboxd e, em essencia, **duas camadas**:

1. Um **catalogo de filmes** (que o Letterboxd popula majoritariamente via TMDB — a mesma fonte que o Screen usa; fatos **54-59**).
2. Uma **camada de identidade + grafo social + conteudo gerado por usuario** (diario, notas, reviews, listas, seguidores) construida **por cima** desse catalogo.

O Screen tem **a camada 1** (parcialmente: catalogo TMDB real ingerido offline, `services/ingestion`) e **nenhuma parte da camada 2**. A tabela 15.1 mostra que **todo** pre-requisito comeca com "Model `User`". Isso significa que nao ha uma feature Letterboxd que seja um "quick win" isolado: a primeira decisao e binaria e grande — **introduzir identidade de usuario no sistema** — e ela toca autenticacao, sessao, privacidade (LGPD, dado pessoal), moderacao de conteudo (reviews), e **colide diretamente com a arquitetura de pureza de render** do Screen.

**RISCO / tensao arquitetural.** As paginas publicas do Screen sao propositalmente **puras de IO** e cacheaveis (invariante 3; fatos **45**, **231**, `revalidate=3600` nas fichas, fato **175**). Conteudo de usuario e o oposto: dinamico, per-request, autenticado, nao-cacheavel, nao-indexavel. Portar Letterboxd exige um **segundo plano de render** (rotas autenticadas, provavelmente `force-dynamic` + `noindex`) **separado** das rotas SEO canonicas — nao dentro delas. Misturar os dois (ex.: injetar "sua nota" na pagina `/pt/filmes/{slug}/` indexavel) quebraria cache, indexabilidade e a invariante de pureza. **PROXIMO PASSO** correto: se um dia houver camada social, ela vive sob um prefixo proprio (ex.: `/conta`, `/u`), `noindex`, fora do caminho canonico — nunca embutida na ficha publica.

---

### 15.3 O que **nao** e feature Letterboxd (e o Screen ja tem por outro caminho)

Para nao inflar falsamente o gap, e importante separar o que se **parece** com Letterboxd mas serve a outro proposito editorial:

| Superficie no Screen | Parece Letterboxd? | O que realmente e | Status |
| --- | --- | --- | --- |
| `screen_score` (estrelas) | Parece "media de notas de usuario" | Nota **editorial propria** do Screen (nao agregado de publico), hoje so no seed demo (`public-demo-seed.ts:261-263`) | **PLACEHOLDER** (ver Parte 12) |
| `review_summary` (enum `ContentBlockType`) | Parece "review de usuario" | Review **editorial** gerada offline pelo Entity Writer (ainda nao produzida: writer so faz `editorial_intro`/`cast_intro`, fato **312**) | **NAO IMPLEMENTADO** (roadmap editorial) |
| Listagens `/pt/filmes`, `/pt/series` | Parece "lista de usuario" | **Catalogo** paginado do banco, nao curadoria pessoal (fatos **30**, **32**) | **REAL** (mas e outra coisa) |
| `content_blocks` versionados | — | Camada editorial verificavel (o diferencial do produto) | **REAL** (infra) / conteudo **PARCIAL** |

O ponto: o Screen aposta em **voz editorial curada e verificavel** (um autor/redator com governanca, `prompt_version`/`input_hash`/`review_status`, fatos **105**, **13**) — nao em **conteudo agregado de multidao**. Sao filosofias de produto opostas sobre a mesma base de catalogo.

---

### 15.4 A tese honesta: o que separa Screen de Letterboxd nao e dado — e comunidade e voz

Este e o insight central desta secao. O Letterboxd **nao** venceu por ter um catalogo melhor: ele usa **o mesmo TMDB** que o Screen consome hoje (fatos **54-68**). O catalogo e commodity. O que o Letterboxd construiu — e o que vale bilhoes — foi **identidade cultural**: um lugar onde a comunidade escreve, ranqueia, faz piada, exibe o "top 4" e volta todo dia para registrar o que assistiu. Isso e **grafo social + conteudo gerado por usuario + ritual**, nao engenharia de dados.

O Screen parte da **mesma commodity** (TMDB) e faz uma aposta **diferente e igualmente valida**: em vez de terceirizar a voz para a multidao, ele constroi uma **camada editorial propria, verificavel e governada** (`content_blocks` versionados, gate anti-thin, atribuicao de fonte, pureza de render). Onde o Letterboxd escala por **rede** (mais usuarios = mais conteudo = mais SEO de cauda-longa via reviews), o Screen escala por **curadoria** (mais blocos editoriais revisados = paginas mais ricas = melhor E-E-A-T sem depender de UGC).

**Vantagem estrutural real do Screen (longo prazo, SEO/qualidade):**
- **Controle editorial total** — sem UGC, sem spam, sem moderacao reativa, sem risco de conteudo toxico/pirata inserido por usuario. Cada palavra passa por governanca (invariantes 12, 13).
- **Indexabilidade limpa** — paginas indexaveis sao puras, cacheaveis e nascem com schema.org correto por tipo (fatos **178**, **221**). O Letterboxd carrega milhoes de paginas de perfil/review de baixo valor que ele mesmo precisa gerenciar com `noindex`/canonical.
- **E-E-A-T por autoria** — a "expertise/autoridade" vem de uma voz editorial identificavel e revisada, exatamente o sinal que o Google recompensa em conteudo de entretenimento, e que o UGC anonimo do Letterboxd **nao** oferece por pagina.

**Desvantagem estrutural real (a favor do Letterboxd):**
- **Retencao e frescor** — o loop diario de diario/watchlist traz o usuario de volta e gera conteudo novo de graca. O Screen precisa **produzir** cada bloco (custo editorial marginal por pagina), enquanto o Letterboxd **colhe** conteudo dos usuarios.
- **Cauda-longa de SEO** — cada review de usuario e uma pagina/passagem indexavel; o Screen so tem tantas paginas quanto entidades no catalogo.
- **Efeito de rede** — comunidade e um fosso que o Screen, por design, escolheu nao cavar.

**Conclusao pratica.** Se o Screen um dia quiser feature "tipo Letterboxd", ele **nao** precisa de mais dados (ja tem o mesmo TMDB) — precisa **construir comunidade e identidade do zero**: model `User`, autenticacao, watchlist (o primeiro loop de retencao), depois notas/diario, e por ultimo o grafo social. E uma **segunda empresa** colada na primeira, com um plano de render proprio (`noindex`, dinamico, autenticado) que **nao pode** contaminar a pureza das rotas SEO canonicas. **PROXIMO PASSO** minimo e realista, se priorizado: `User` + `Watchlist` sob prefixo `/conta` autenticado e `noindex` — a menor porta de entrada de retencao sem ameacar o nucleo entity-first. Tudo alem disso e roadmap de anos, nao de ciclo. **BLOQUEIA PRODUCAO?** Nao — a ausencia dessas features nao bloqueia o lancamento do Screen como catalogo editorial; ela apenas define que o Screen **nao e** um produto social, e nao deve fingir que e (os dois botoes decorativos da home sao, hoje, a unica promessa nao cumprida — **DEBITO** de UI a remover ou gatear enquanto nao houver backend).


---

## Parte 16 — Funcionalidades tipo IMDb

Escopo desta parte: comparar o Screen, funcao a funcao, com o **IMDb** — a referencia global de "pagina densa por entidade" (filme, serie, pessoa) que domina o SEO de entretenimento ha duas decadas. O IMDb tem centenas de milhoes de titulos e pessoas, dezenas de secoes por pagina e um exercito de contribuidores. O Screen tem, na base curada de bootstrap, ~10 filmes + ~10 series (`services/ingestion/bin/ingest-public-catalog.ts:59-60`) e **um unico editor humano**. A comparacao **nao e de paridade** — e de *arquitetura* e *direcao*. A tese e que o IMDb ganha por **volume de secoes crowdsourced**, e o Screen aposta em **poucas paginas densas, verificaveis e proprias**, travadas pelo gate anti-thin (invariante 5). Onde o IMDb copia/agrega, o Screen **produz** (Entity Writer). Isso e mais lento, mas estruturalmente mais defensavel para SEO de longo prazo (menos index bloat, mais E-E-A-T).

> Auditoria estatica de codigo. "Screen hoje" descreve o que o **codigo grava e renderiza**, nao o conteudo do PostgreSQL de producao (sem acesso a banco nesta auditoria). Toda macrofuncao cita `arquivo:linha` do digest.

---

### 16.1 A distincao que organiza tudo: TMDB-derivavel vs IMDb-proprietario

Antes da tabela mestre, a pergunta que decide a viabilidade de cada secao **nao** e tecnica, e **de licenca**. O Screen ja consome o TMDB com atribuicao no rodape (`apps/web/app/_components/site-footer.tsx:205-208`). Logo, tudo que o TMDB expoe e **legalmente acessivel** — falta so implementar. Ja o conteudo editorial proprietario do IMDb **nao pode ser copiado** em hipotese alguma; o Screen teria que **produzir o seu**.

| Classe de dado | Fonte legal para o Screen | O que o Screen pode fazer |
| --- | --- | --- |
| Metadados factuais (elenco, equipe, temporadas, episodios, runtime, orcamento, bilheteria, idioma, popularidade, videos, imagens, similares, classificacao etaria) | **TMDB (licenciado, ja em uso)** | Ingerir e exibir com atribuicao. So falta codigo. |
| Nota de audiencia agregada | **TMDB `vote_average`** (licenciado) **ou** IMDb/RT/Metacritic (licenca que o Screen **NAO tem**) | Pode exibir a nota do TMDB atribuida como `rating_source=tmdb`; **nao** pode exibir nota IMDb sem acordo. |
| Trivia, goofs (erros), quotes (frases), parents guide descritivo, criticas de usuario | **PROPRIETARIO do IMDb — copia proibida** | Tem que **escrever conteudo proprio** via Entity Writer (a tese do produto). |
| Metacritic / Rotten Tomatoes / Letterboxd / FilmAffinity | Licenca **de cada fonte** (o Screen **NAO tem** nenhuma) | So com acordo direto e atribuicao correta (invariantes 1, 2, 6). |

Corolario duro: **o IMDb nao e uma fonte de dados para o Screen** — nem seus numeros de nota, nem seu texto. O `movies.imdb_id` gravado (`packages/db/prisma/schema.prisma:231`, `services/ingestion/src/persistence/store.ts:36-52`) e apenas um **identificador de correspondencia**, nunca uma licenca para copiar a pagina do IMDb. Tudo que "parece IMDb" no Screen ou vem do **TMDB** ou tem que ser **autoral**.

---

### 16.2 Tabela mestre — macrofuncao a macrofuncao

Prioridade: **P0** = pre-requisito para o produto ser honesto/indexavel; **P1** = alto valor de SEO/UX, proximo ciclo; **P2** = valor real, depende de licenca ou pipeline novo; **P3** = nice-to-have / longo prazo.

| Macrofuncao | IMDb | Screen hoje | Status | Onde moraria no schema | Prio | Obs. |
| --- | --- | --- | --- | --- | --- | --- |
| **Pagina densa de filme** | ~20 secoes, deep-linkaveis | `/pt/filmes/[slug]` real, mas `select` minusculo (`movie-page.ts:81-87`): so titulo/ano/runtime/poster/backdrop; sem genero, sem crew, sem nota | **PARCIAL** | `movies` + `entity_translations` + `content_blocks` | P1 | Fatos 31, 45, 194-226. Estrutura certa, densidade pobre. |
| **Pagina densa de serie** | idem + temporadas/episodios navegaveis | `/pt/series/[slug]` real; temporadas/episodios **inline sem rota propria** | **PARCIAL** | `tv_shows` + `seasons` + `episodes` | P1 | Fatos 33, 238-264. |
| **Pagina densa de pessoa** | filmografia completa, bio, fotos | `/pt/pessoas/[slug]` real, mas **ingestao nunca cria slug de pessoa** -> nenhuma pagina existe na base real | **PARCIAL** (orfa) | `people` + `content_blocks` | P1 | Fatos 34, 265-297. Rota existe, dado nao chega. |
| **Nota IMDb (numero)** | nucleo do produto | Ausente; `imdb_id` e so identificador | **NAO IMPLEMENTADO** (e **impossivel sem licenca**) | `external_ratings` (`rating_source=imdb`) | P2 | Fatos 210, 310. Depende de acordo IMDb que o Screen **nao tem**. |
| **Nota de audiencia (agregada)** | IMDb rating | `vote_average_tmdb` ingerido, **nunca exibido** (correto: nao pode virar nota Screen nem IMDb) | **NAO IMPLEMENTADO** (viavel via TMDB) | `external_ratings` (`rating_source=tmdb`) | P2 | Fatos 121, 308, 309. Caminho legal existe (TMDB atribuido); so falta pipeline `external_ratings` (0 writers hoje). |
| **Screen Score (nota propria)** | — (IMDb nao tem nota editorial) | Colunas existem; populadas **so pelo seed demo**; ingestao nunca grava | **PLACEHOLDER** | `movies.screen_score` / `tv_shows.screen_score` | P2 | Fatos 6, 93, 119, 299. Estrelas do hero saem daqui — base real fica sem estrela. |
| **Popularidade** | grafico de popularidade | `movies.popularity`/`tv_shows.popularity` ingeridos, **nunca exibidos**; pessoa sem coluna | **PARCIAL** (dado existe, UI nao) | `movies.popularity`, `tv_shows.popularity` | P3 | Fatos 277, 216. TMDB-derivavel, so exibir. |
| **Trending / em alta** | pagina Moviemeter | Nenhum endpoint de discovery TMDB (popular/trending/changes) implementado | **NAO IMPLEMENTADO** | Precisa signal + tabela de trending (ausente) | P2 | Fato 60. TMDB expoe `/trending`; nao ha client nem modelo. |
| **Elenco completo** | lista integral + personagem | `cast_members` ingerido; render **cap 24 lidos / 12 exibidos**; nome vira texto morto sem slug de pessoa | **PARCIAL** | `cast_members` + `people` | P1 | Fatos 99, 205, 248, 273. Sem paginacao "elenco completo". |
| **Equipe completa (crew)** | full crew por departamento | `crew_members` **ingerido e gravado**, mas **nenhuma pagina de detalhe o consulta/exibe** | **NAO IMPLEMENTADO** (na UI) | `crew_members` | P1 | Fatos 203, 206, 249, 250, 274. Dado no banco, zero render. Vitoria barata. |
| **Episodios** | pagina por episodio (`TVEpisode`) | Populados pela ingestao; exibidos **inline** na serie; **sem rota** `/temporada-n/` nem `TVEpisode` | **PARCIAL** | `episodes` (existe, com FK composta) | **P0/P1** | Fatos 96, 234-239. IMDb indexa **cada** episodio — maior superficie de SEO que falta ao Screen. |
| **Temporadas** | pagina por temporada (`TVSeason`) | Lista inline; **sem rota** `/pt/series/[slug]/temporada-[n]/`; sem `TVSeason` no JSON-LD | **PARCIAL** | `seasons` (existe) | **P0/P1** | Fatos 96, 234, 238. `guia de temporadas` e um dos 15 blocos de valor. |
| **Videos / trailers** | aba Videos | Sem `model Trailer`; botao play **decorativo** `aria-hidden` | **NAO IMPLEMENTADO** | precisa `trailers` (planejada em `database/schema.md:36`) | P2 | Fatos 61, 207, 256. TMDB `/videos` e licenciado; falta modelo + client. `trailer incorporado` conta no gate. |
| **Fotos / galeria** | aba Photos | Sem `model Image`; **tres tiles vazios** na ficha | **NAO IMPLEMENTADO** | precisa `images`; `episodes.still_path` ja existe mas nunca renderiza | P2 | Fatos 61, 208, 257. TMDB `/images` licenciado. |
| **Trivia** | milhares de itens crowdsourced | Inexistente | **NAO IMPLEMENTADO** (e **copia proibida**) | `content_blocks` (novo `block_type` autoral) | P3 | Proprietario IMDb. Screen teria que **produzir** — caro, revisao humana. |
| **Goofs (erros)** | crowdsourced | Inexistente | **NAO IMPLEMENTADO** (copia proibida) | `content_blocks` autoral | P3 | Idem trivia. |
| **Quotes (frases)** | crowdsourced | Inexistente | **NAO IMPLEMENTADO** (copia proibida) | `content_blocks` autoral | P3 | `review_quote_allowed` (flag de licenca) existe no schema mas sem consumidor; citar critica de terceiro exige licenca. |
| **Parents guide** | guia descritivo por categoria | So `certification` (rotulo etario) via seed demo; **sem guia descritivo** | **PLACEHOLDER** (rotulo) / **NAO IMPLEMENTADO** (guia) | `movies.certification` (rotulo, TMDB) + `content_blocks` (guia autoral) | P3 | Fatos 120, 200, 316. Rotulo "16" e TMDB-derivavel; o texto explicativo e proprietario IMDb -> autoral. |
| **Criticas de usuario** | user reviews + votos | **Nao existe `model User`**; botoes "Avaliar"/"Marcar assistido" sao `aria-disabled` sem handler | **NAO IMPLEMENTADO** | precisa `User`/`Review` (ausentes) | P3 | Fatos 11, 259, 311. Sem camada de usuario, nao ha review de usuario nem nota de usuario. |
| **Review propria (critica)** | — | `block_type=review_summary` no enum + prompt existe, mas Entity Writer so gera `editorial_intro`/`cast_intro` | **NAO IMPLEMENTADO** | `content_blocks` (`review_summary`) | P2 | Fatos 212, 254, 312. `review propria` e bloco de valor; sem pipeline. |
| **Metacritic** | Metascore embutido | So chave em `RATING_SOURCES`; nenhuma nota | **NAO IMPLEMENTADO** (licenca ausente) | `external_ratings` (`rating_source=metacritic`) | P2 | Fato 310. Licenca Metacritic, nao IMDb. |
| **Technical specs** | runtime/aspecto/som/cor | So **runtime**; sem aspecto/som/cor | **PARCIAL** | colunas em `movies`/`tv_shows` | P3 | Fatos 199, 217-219. TMDB da parte (runtime, idioma). |
| **Box office (orcamento/bilheteria)** | budget/gross | **Sem colunas** budget/revenue | **NAO IMPLEMENTADO** | precisa `movies.budget`/`revenue` | P3 | Fato 217. TMDB expoe budget/revenue — so adicionar colunas. |
| **Idioma / pais / produtoras** | metadados | `original_language` ingerido, **nao exibido**; pais/produtoras ausentes | **NAO IMPLEMENTADO** / **PARCIAL** | `movies.original_language` (existe), demais ausentes | P3 | Fatos 218, 219. |
| **Links externos (IMDb/TMDB, sameAs)** | sameAs | `imdb_id`/`entity_external_ids` gravados; **nenhum link renderizado**; sem `sameAs` no JSON-LD | **NAO IMPLEMENTADO** | `entity_external_ids` (existe) | P3 | Fatos 220, 278. Vitoria barata de SEO (`sameAs`). |
| **Noticias** | IMDb News | Rotas `/pt/noticias` reais, mas **nenhum worker escreve** `articles` (RSSPRIME/MN26 inativos) | **NAO IMPLEMENTADO** (pipeline) | `articles` + `article_translations` (existem) | P2 | Fatos 18, 35, 90, 213, 324. `noticias relacionadas` e bloco de valor. |
| **Recomendacoes / similares** | "More like this" | Nenhuma relacao de similaridade no schema; `similar_titles_intro` sem pipeline | **NAO IMPLEMENTADO** | precisa relacao (ausente) + `content_blocks` | P2 | Fatos 214, 258. TMDB `/recommendations` licenciado; `obras parecidas` conta no gate. |

---

### 16.3 O que e "quase de graca" — dado que ja esta no banco e nao aparece

Tres macrofuncoes tipo-IMDb estao a **um render de distancia**, porque o dado ja e ingerido do TMDB (licenciado) e so falta exibir. Sao os melhores candidatos de P1 por custo/beneficio:

1. **Equipe (crew).** `crew_members` e gravado em replace-set transacional (`services/ingestion/src/persistence/store.ts:126-142`), mas nenhuma pagina de detalhe consulta a tabela (`movie-page.ts`/`series-page.ts` nunca leem crew; so `home-hero.ts:89` e `person-page.ts:127`). Uma secao "Direcao e roteiro" + "Ficha tecnica" e **puro trabalho de UI** sobre dado existente. (Fatos 203, 206, 249, 250, 274.)
2. **Popularidade.** `movies.popularity`/`tv_shows.popularity` ja ingeridos, nunca lidos por presenter. (Fato 277.)
3. **`sameAs` / links externos.** `entity_external_ids` (namespaces `tmdb_movie`/`tmdb_person`/`imdb`) gravado (`store.ts:36-52`), nunca renderizado nem emitido como `sameAs` no JSON-LD — um sinal de entidade que o Google adora e que sai de graca. (Fatos 220, 278.)

Nenhum desses conta como **bloco de valor proprio** para o gate anti-thin (sao dado cru de API), mas todos enriquecem a pagina e melhoram sinais factuais/Knowledge-Graph. **PROXIMO PASSO** claro, **NAO BLOQUEIA PRODUCAO**.

---

### 16.4 A tensao central: densidade do IMDb vs invariante 5

Aqui esta o cerne do comparativo. **O IMDb ganha SEO por volume de secoes por entidade.** Uma unica pagina de filme no IMDb e, na pratica, uma dezena de sub-paginas indexaveis (fullcredits, trivia, goofs, quotes, releaseinfo, parentalguide, technical, reviews, mediaindex...), cada uma capturando long-tail. Cada episodio e uma URL propria. Esse volume vem de **crowdsourcing** (contribuidores gratuitos) e de **conteudo proprietario acumulado**.

O Screen **recusa deliberadamente** essa estrategia de volume. A invariante 5 (gate anti-thin) exige **>= 2 blocos de valor proprios** alem do dado cru para uma pagina **indexar** (`packages/seo/src/value-blocks.ts`, `apps/web/src/lib/movie-indexability.ts:50-62`). Consequencia direta e verificada no codigo: **espelhar o TMDB (sinopse + elenco + poster) produz uma pagina que fica `noindex`**, porque dado cru nao conta. Hoje, como o Entity Writer nunca grava bloco `published`/`human_reviewed` (grava `ai_generated`/`needs_review`/`blocked`), **todo titulo ingerido do TMDB nasce `noindex`** — so os titulos do seed demo com blocos `published` indexam. (Fatos 31, 227, e Parte 8.)

Isso e uma **desvantagem de curto prazo** (poucas paginas indexaveis) que e, ao mesmo tempo, a **vantagem estrutural de longo prazo**:

- **IMDb sofre de index bloat e thin content** em milhoes de fichas rasas (titulos obscuros com so um poster e um ano). O peso da marca IMDb sustenta isso; um dominio novo como `thescreen.media` seria **penalizado** por replicar essa estrategia (Panda/Helpful Content). O gate anti-thin e, na pratica, uma **protecao** contra o erro que mataria um site novo.
- Cada pagina que o Screen **indexa** e, por construcao, rica, revisada e atribuivel — sinal de E-E-A-T que o mirror cru do IMDb nao tem.

**Como escalar densidade sem relaxar a invariante 5** — o roteiro honesto:

1. **Nao relaxar o gate; alimentar o gate.** Os 15 blocos de valor canonicos (`value-blocks.ts:21-36`) sao o caminho legitimo. Varios sao **TMDB-derivaveis ou Entity-Writer-assistidos sem copiar IMDb**: `guia de temporadas`, `elenco comentado`, `obras parecidas`, `contexto de franquia`, `onde assistir por pais`, `FAQ util`, `historico de atualizacao`. Cada um que se ativa e +1 bloco de valor real -> mais paginas cruzam o limiar **legitimamente**.
2. **Escalar o Entity Writer.** Hoje ele so produz `editorial_intro` + `cast_intro`, e so para `movie`/`tv` (`services/entity-writer/src/pipeline/run-generation.ts:66`; rejeita `person` em `payload-source.ts:24-26`). Ativar `faq`, `similar_titles_intro`, `season_guide`, `franchise_context` — todos ja no enum `ContentBlockType` — transforma "1 bloco" em "3-4 blocos" por entidade, **sem tocar no limiar**. E o multiplicador de densidade correto.
3. **Abrir as rotas de temporada e episodio.** E a maior superficie de SEO ausente (o IMDb indexa cada episodio; o Screen tem os **dados** de episodio no banco mas **nenhuma rota** — fatos 234-239). Um `guia de temporadas` (bloco de valor) + rota `TVSeason`/`TVEpisode` cria dezenas de URLs indexaveis por serie **respeitando o gate** (cada uma precisa dos seus >= 2 blocos). **P0/P1.**
4. **Substituir trivia/goofs/quotes por conteudo autoral, nao por copia.** Aqui o Screen **nunca** alcancara o volume crowdsourced do IMDb — nem deve tentar. A resposta e um punhado de blocos autorais de alto valor (FAQ, contexto de franquia, analise sem/com spoiler) que capturam a **mesma intencao de busca** ("por que X acontece em...", "qual a ordem para assistir...") com **conteudo proprio verificavel**, nao com um mirror de fatos de terceiros. E exatamente a tese do Entity Writer.
5. **Nunca deixar o dado cru fingir densidade.** O risco espelho e o oposto do IMDb: o Screen hoje **exibe estrelas e chips de streaming falsos** (Screen Score so no seed demo; `EpisodesTicker` mock; chips de plataforma sem `watch_availability`) — densidade **fabricada** que tensiona as invariantes 6 e 8 (fatos 6, 8, 9, 48, 49, 360, 361). Densidade honesta vem de blocos reais; densidade fabricada e pior que pagina fina, porque quebra a confianca que e o unico ativo do dominio novo. **BLOQUEIA PRODUCAO** ate sanear.

---

### 16.5 Veredito da Parte 16

**Ordem de magnitude:** o Screen esta **anos-luz** do IMDb em cobertura (dezenas de entidades vs centenas de milhoes; 2 tipos de bloco vs ~20 secoes crowdsourced; zero usuarios contribuindo vs milhoes). Fingir paridade seria desonesto.

**Onde o Screen tem razao estrutural:** a arquitetura **entity-first + governanca + `content_blocks` versionados + pureza de render** e uma aposta deliberada contra o modelo do IMDb — troca **volume raso** por **densidade verificavel**. Para um dominio **novo** sem a autoridade de marca do IMDb, essa e a estrategia de SEO **correta**: o Google recompensa poucas paginas ricas e originais e pune o mirror cru em escala. O gate anti-thin nao e um obstaculo a densidade — e o filtro que garante que a densidade seja **real**.

**O gargalo real nao e o gate — e o motor de conteudo.** A densidade tipo-IMDb, feita do jeito do Screen, depende inteiramente de o **Entity Writer escalar** (mais `block_type`, incluir `person`, produzir `published` de fato) e de as **rotas de temporada/episodio** existirem. Sem isso, o Screen fica com paginas honestas porem **magras e majoritariamente `noindex`** — o pior dos dois mundos: nem o volume do IMDb, nem a densidade que a arquitetura promete.

**Ordem recomendada** (detalhada na Parte 26): (P0) sanear a densidade fabricada — estrelas/ticker/chips falsos; (P1) exibir o crew/ficha tecnica ja no banco + `sameAs` + rotas de temporada/episodio; (P2) ativar mais blocos do Entity Writer (`faq`, `season_guide`, `similar_titles_intro`) e o pipeline `external_ratings` com nota **TMDB atribuida** (a unica nota de audiencia legalmente ao alcance sem acordo IMDb); (P3) trivia/goofs/quotes/parents-guide autorais e camada de usuario.


---

## Parte 17 — Funcionalidades tipo Rotten Tomatoes

### 17.0 Respostas diretas (leia isto primeiro)

**(a) O Screen tem, ou pode ter, um "Tomatometer"?**
**Nao — e nao pode, por lei do proprio projeto.** `Tomatometer` e `Popcornmeter` sao marcas registradas do Rotten Tomatoes. As invariantes 1 (`IMDb != Rotten Tomatoes`) e 2 (`provider_api != rating_source`), operacionalizadas em `.claude/rules/ratings.md` e travadas por `packages/schemas/src/ratings.ts:93-152`, proibem: (i) usar o rotulo `Tomatometer`/`Popcornmeter` para qualquer outra fonte; (ii) converter nota de uma fonte para a escala de outra ("IMDb 8.4/10 -> 84%"); (iii) fabricar um agregado proprio disfarcado de nota de terceiro. O validador `validateRating` rejeita explicitamente um `rating_label` contendo `tomatometer`/`tomate`/`popcornmeter` fora de `rating_source = "rotten_tomatoes"` (teste `(1)` em `tests/governance/ratings.test.ts`). Portanto, um "medidor" estilo RT esta **arquiteturalmente vetado** no Screen — nao e uma feature pendente, e uma feature **proibida**.

**(b) Entao o que o Screen PODE ter, legitimamente?**
Dois caminhos, ambos hoje inativos como produto:
1. **Agregacao propria de criticos licenciada** — persistir notas reais de IMDb/RT/Metacritic/Letterboxd/FilmAffinity em `external_ratings`, cada uma na sua escala canonica (imdb=10, rotten_tomatoes=100, metacritic=100, letterboxd=5, filmaffinity=10), com `rating_source` separado do `provider_api`, atribuicao e `license_status` permitido. A tabela existe (`packages/db/prisma/schema.prisma:590-620`) mas **nao tem um unico escritor nem leitor em codigo de producao** (digest #109, #210, #306).
2. **Nota editorial propria claramente rotulada (Screen Score)** — colunas `screen_score` / `screen_score_scale` / `screen_score_display` (`schema.prisma:248-250` filmes, `:286-288` series), que sao nota **autoral do Screen** (escala 5, estrelas), jamais apresentada como nota de terceiro. Existe no schema e no render (hero + cards da home), mas so e populada pelo **seed demo** (`apps/admin/scripts/public-demo-seed.ts:261-263`); a ingestao TMDB nunca escreve `screenScore` (digest #93, #299).

**(c) O "critics consensus" (aquela frase curta do RT) e replicavel de forma governada?**
**Sim — e e provavelmente o encaixe mais natural entre toda a superficie do RT e a arquitetura do Screen.** Ver secao 17.3. O consensus e uma frase editorial curta, derivavel de um payload controlado, sem copiar sinopse externa — exatamente o formato que o Entity Writer ja produz para `editorial_intro`. Falta: um `block_type` proprio (ex.: `critic_vs_audience_comparison` ou `ratings_explanation`), prompt versionado, e — o gargalo real — **dados de criticos licenciados no payload** para que a frase nao seja opiniao sem lastro.

**(d) Qual a diferenca de ordem de magnitude?**
Rotten Tomatoes agrega dezenas de milhares de criticos credenciados, milhoes de audience reviews verificadas, cobertura de praticamente todo lancamento teatral e de streaming, calendario de episodios e integracao de compra/aluguel por regiao. O Screen hoje tem **10 filmes + 10 series curados** ingeridos manualmente (`services/ingestion/bin/ingest-public-catalog.ts:59-60`), **zero notas de criticos**, **zero reviews**, **zero audience score** e **zero streaming real**. Nao ha paridade nem proximidade de paridade — e nem deveria fingir haver. O argumento do Screen nao e volume; e **governanca verificavel** (ver 17.5).

---

### 17.1 Tabela comparativa mestra

Legenda de status: **REAL** (funciona com dado real) · **PARCIAL** (codigo real, dado ausente/demo) · **PLACEHOLDER** (aparencia sem lastro) · **NAO IMPLEMENTADO** · **PROIBIDO** (vetado por invariante).

| Funcao (RT) | Como o RT faz | Screen hoje | Status | Barreira dominante | Prioridade | Obs. |
| --- | --- | --- | --- | --- | --- | --- |
| **Tomatometer** (% criticos fresh) | Agrega veredito binario de ~milhares de criticos credenciados | Inexistente; **vetado como rotulo/escala** | **PROIBIDO** | Invariante 1/2 (marca RT, cross-scale) | N/A | O Screen NUNCA tera "Tomatometer". Substituto legitimo = agregado proprio em `external_ratings` OU Screen Score autoral |
| **Audience Score** (Popcornmeter) | % de audiencia verificada que gostou | Inexistente | **NAO IMPLEMENTADO** / rotulo **PROIBIDO** | Sem `model User` -> sem audiencia propria; sem licenca p/ importar de terceiro | Baixa | Exige comunidade (17.4). Rotulo `Popcornmeter` proibido |
| **Critics Consensus** (frase curta) | Editor humano resume o consenso critico | Inexistente; **encaixe natural do Entity Writer** | **NAO IMPLEMENTADO** | Falta `block_type` + prompt + payload de criticos licenciado | **Alta** (ver 17.3) | Melhor candidato a valor proprio governado |
| **Reviews de criticos** (lista + link) | Trechos citados + link p/ veiculo | Inexistente | **NAO IMPLEMENTADO** | Licenca (`review_quote_allowed`) + fonte de criticos + atribuicao/linkback | Media | `source_licenses` seed = tudo `unknown`/false (#111) |
| **Reviews de audiencia** | Usuarios logados escrevem/avaliam | Inexistente | **NAO IMPLEMENTADO** | Sem `model User`/moderacao/anti-spam | Baixa | Botoes "Avaliar"/"Marcar" sao `aria-disabled` decorativos (#11, #311) |
| **Onde assistir** | Ofertas por regiao (stream/rent/buy) + deep link | Caminho banco->presenter->UI REAL, sem produtor real | **PARCIAL** / na home **PLACEHOLDER** | Sem worker `services/streaming` (so README); sem `platforms`/`providers`; sem `license_status` na tabela | Media-Alta | Ver Parte 13. Chips de plataforma na home sao mock (#361) |
| **Trailers** | Video embed oficial | Botao play decorativo `aria-hidden` | **NAO IMPLEMENTADO** | Sem `model Trailer`; TMDB `/videos` nao ingerido | Media | `schema.prisma` sem tabela; digest #207, #256 |
| **Episodios** | Ficha + calendario "novo hoje" | Populados no banco (ingestao TMDB), **sem rota** | **PARCIAL** | Sem rota `/temporada-{n}/episodio-{n}/`; ticker da home e mock | Media | Season/Episode reais (#236) mas so inline; EpisodesTicker hardcoded (#8, #360) |
| **Temporadas** | Ficha por temporada + guia | Lista inline na pagina da serie | **PARCIAL** | Sem rota `TVSeason` dedicada; sem JSON-LD `TVSeason` | Media | `series-page.ts:112-134` -> render inline (#238); nenhuma rota (#234) |
| **Noticias** | Redacao propria + agregacao | Rotas + gate de licenca REAIS, **sem worker** | **PARCIAL** / home **PLACEHOLDER** | `services/news-ingestion` so tem README; RSSPRIME/MN26 inativos | Media | Ver Parte 11. Bloco de noticias da home e mock gateado (#18, #336) |
| **Guias editoriais** ("what to watch") | Curadoria humana | Content_blocks versionados existem; so `editorial_intro`/`cast_intro` gerados | **PARCIAL** | Entity Writer cobre 2 tipos de bloco; demais sao contrato | Media | Vantagem estrutural (17.5); pipeline `run-generation.ts:66` |
| **Rankings editoriais** ("Top 100") | Listas curadas/algoritmicas | "Destaques" com rank = posicao de slot, nao metrica | **PLACEHOLDER** | Sem metrica de ranking; sem `screen_score` real; sem tabela de lista | Baixa | Rank #N e ordem de array (#10); "Top 250"/"Mais vistos" no footer sao links mortos (#21) |

---

### 17.2 O nucleo: por que o Screen NAO pode ter Tomatometer (e o que coloca no lugar)

Esta e a distincao mais importante da Parte 17, porque e onde a governanca do Screen **diverge deliberadamente** do modelo Rotten Tomatoes.

**O que o RT faz e o Screen proibe:**

| Pratica do RT | Por que o Screen nao replica | Onde a regra vive |
| --- | --- | --- |
| Chamar o agregado de criticos de "Tomatometer" | Marca registrada do RT; rotulo pertence so a `rotten_tomatoes` | `.claude/rules/ratings.md` secao 1; `validateRating` (cross-label) |
| Chamar o agregado de audiencia de "Popcornmeter" | Idem, marca do RT | `packages/schemas/src/ratings.ts:93-152` |
| Normalizar notas de fontes distintas numa unica % | Cada escala e propriedade da fonte; converter e mentir sobre equivalencia | Invariante 1; `RATING_SCALES` em `@screena/config` |
| Exibir "nota do site" agregando terceiros | `AggregateRating` fingindo nota propria e proibido | `.claude/rules/ratings.md` secao 7; regra de SEO secao 9 |
| Tratar o fornecedor tecnico (RapidAPI/TMDB) como fonte | `provider_api != rating_source` | Invariante 2; teste `(2)` de `ratings.test.ts` |

**Os dois substitutos legitimos:**

1. **Agregado proprio de criticos, licenciado e atribuido.** O Screen pode exibir "IMDb 8,4/10", "Rotten Tomatoes 92/100", "Metacritic 78/100" **lado a lado, cada um na sua escala, com logo/atribuicao da fonte real** — nunca fundidos, nunca convertidos. Isso e o que a tabela `external_ratings` foi desenhada para suportar (FKs distintas para `rating_sources` e `api_providers`, `schema.prisma:611-613`). Barreira: **nenhum writer existe** (`services/ratings` so tem README, #88) e o seed de `source_licenses` nasce todo `unknown`/flags `false` (#111) — ou seja, mesmo se houvesse dado, o gate de licenca (invariante 6) o bloquearia de pagina indexavel ate decisao humana de licenca.

2. **Screen Score — nota editorial propria, honestamente rotulada.** Uma nota **autoral do Screen** (escala 5, estrelas douradas), que nao se disfarca de nota de terceiro e por isso nao fere as invariantes 1/2. Ja tem coluna, presenter e UI (hero-carousel + cards da home), com gate de exibicao que exige `screen_score_display === true`, escala 5 e `0 < valor <= 5` (`home-hero-presenter.ts:141-149`, `entity-index-presenter.ts:201-209`). **DEBITO critico:** so o seed demo popula (#6, #46, #93, #119); a ingestao real do EasyPanel produz base **sem estrelas**, e o TMDB `vote_average` — que existe no banco — **nao** e usado como fallback (#121, #309), corretamente, pois seria nota de provider mascarada de nota propria.

**RISCO / BLOQUEIA PRODUCAO:** se o Screen Score virar produto, precisa de uma **metodologia editorial publicavel** (como a nota e formada) para nao ser "AggregateRating fingindo nota propria" na pratica reputacional — mesmo que tecnicamente seja `Review`/nota autoral e nao `AggregateRating` de terceiro. Sem metodologia, uma estrela dourada sem lastro e ruido de qualidade e risco de E-E-A-T.

---

### 17.3 Critics Consensus: o encaixe perfeito para o Entity Writer (e o que falta)

O "critics consensus" do RT e uma **frase curta** (1-2 sentencas) que resume o veredito critico de um titulo. Estruturalmente, e o conteudo mais alinhado com o que o Entity Writer do Screen ja sabe fazer:

**Por que encaixa:**
- E **texto editorial curto derivado de fatos**, nao dado cru reexibido — exatamente o perfil de `editorial_intro`/`cast_intro`, os dois unicos `block_type` que o Entity Writer gera hoje (`services/entity-writer/src/pipeline/run-generation.ts:66`, `types.ts:24`).
- Passa pelo mesmo pipeline governado: payload controlado do PostgreSQL -> Gemini **offline** -> `validateEntityWriterOutput` + `validateAgainstPayload` (anti-alucinacao) -> persistencia em `content_blocks` com `prompt_version`/`input_hash`/`output_hash`/`review_status`/`warnings_json` (invariante 13).
- **Nao copia sinopse externa** e nao inventa fatos: se o consensus afirmar "criticos elogiaram a direcao", "direcao" precisa estar no payload; nome citado fora do payload vira warning `fato fora do payload: <nome>` e bloqueia indexacao (`.claude/rules/entity-writer.md` secao 2).
- Conta como **bloco de valor** no gate anti-thin (>= 2 blocos, invariante 5) se `review_status` for `human_reviewed`/`published` — ajudando a pagina a indexar legitimamente.

**O que falta (barreiras concretas):**

| Falta | Detalhe | Referencia |
| --- | --- | --- |
| `block_type` proprio | `critic_vs_audience_comparison` so existe como string em `packages/seo/src/value-blocks.ts:25`; `ratings_explanation` esta no enum mas inativo | digest #313, `.claude/rules/entity-writer.md` secao 8 |
| Payload com criticos | O consensus precisa de **notas/veredictos reais no payload** para ter lastro; `external_ratings` esta vazia (#210, #306) | Sem isso, vira opiniao sem fonte |
| Prompt versionado | Nao ha prompt de consensus em `prompts/`; existe `review_summary.md` mas o writer nao o usa (#312) | `prompts/` |
| Licenca de citacao | Citar trecho de critico exige `review_quote_allowed=true` + atribuicao/linkback; seed atual bloqueia | #111, `.claude/rules/ratings.md` secao 6 |
| Revisao humana | Consensus e conteudo sensivel (afeta reputacao de obra/pessoa) -> exige `human_reviewed` antes de `index` | Invariante 12 |

**PROXIMO PASSO minimo viavel:** consensus **sem numeros**, so qualitativo, derivado de `content_blocks` proprios ja revisados — uma frase editorial que descreve a recepcao sem afirmar "92% dos criticos". Isso e gerar-vel hoje se um novo `block_type` + prompt forem criados, sem depender de licenca de rating. A versao **com** numeros de criticos depende inteiramente de ativar `external_ratings` com licenca (feature de outra fase).

---

### 17.4 Audience score e reviews de audiencia: bloqueados na raiz (sem `model User`)

O Popcornmeter e as audience reviews do RT dependem de **usuarios autenticados** que avaliam e escrevem. O Screen **nao tem nada disso**:

- **Nao existe `model User`, `Watchlist`, `Favorite` ou `UserRating`** em `packages/db/prisma/schema.prisma` (busca retorna zero — digest #259, #311). O `site-header.tsx:26` documenta explicitamente que login/watchlist estao inativos.
- Os botoes "☆ Avaliar" e "✓ Marcar como assistido" na home sao `<span aria-disabled="true">` **sem `onClick`, sem estado, sem mutation** (`apps/web/app/pt/page.tsx:336-342`, digest #11).
- Sem usuarios, nao ha audiencia propria; e importar "audience score" de terceiro esbarra em licenca + no veto de rotulo (`Popcornmeter`).

**Status: NAO IMPLEMENTADO, prioridade baixa.** Comunidade e uma fase inteira (autenticacao, moderacao, anti-spam, LGPD/privacidade, verificacao de "assistido") que o MVP conscientemente adia. **Obs.:** enquanto os botoes decorativos permanecerem no HTML, eles sao **DEBITO de honestidade de UI** — sugerem interatividade inexistente.

---

### 17.5 Onde a arquitetura do Screen e vantagem estrutural real (a longo prazo)

Ser ordens de magnitude menor que o Rotten Tomatoes **nao** e o fim da historia. A arquitetura do Screen tem quatro propriedades que, se o dado real chegar, se convertem em vantagem defensavel de SEO e qualidade — coisas que o RT, como agregador legado, **nao** tem por construcao:

| Propriedade do Screen | Por que e vantagem sobre um agregador tradicional |
| --- | --- |
| **Entity-first** | Cada pagina gira em torno de uma entidade canonica (filme/serie/pessoa) com slug, breadcrumb, schema e URL coerentes (invariante 11), nao em torno de uma fonte de API. Isso e exatamente o que buscadores e AI Overviews premiam: uma entidade, uma URL canonica, um schema correto (`Movie`/`TVSeries`/`Person`). |
| **Governanca verificavel** | 13 invariantes travadas por testes de governanca (`tests/governance/`) e por um guard de pureza de render (`scripts/audit/check-render-purity.mjs`). O diferencial nao e o dado (que qualquer um licencia do TMDB) — e a **camada editorial verificavel** por cima dele. |
| **content_blocks versionados** | Todo bloco editorial carrega `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`, `review_status`, `warnings_json` (invariante 13). E rastreabilidade de proveniencia de conteudo — cada vez mais relevante para E-E-A-T e para distinguir conteudo original de reexibicao de API. |
| **Pureza de render** | Paginas indexaveis leem **so PostgreSQL/cache** — zero API externa, zero Gemini no render (invariantes 3/4). Tempo de resposta nunca depende de terceiro; nenhuma falha de provider quebra pagina publica; a IA gera offline, e validada e revisada antes de publicar. |

**A leitura honesta:** hoje essas quatro propriedades protegem um catalogo minusculo e majoritariamente sem os blocos de valor que justificariam indexacao (o gate anti-thin corretamente mantem quase tudo em `noindex`). Elas sao **potencial**, nao entrega. Mas sao o tipo de fundacao que, com dado real de criticos licenciado + Entity Writer produzindo consensus/comparacoes governadas + Screen Score com metodologia, permite ao Screen competir **em qualidade e confiabilidade editorial** numa fatia (pt-BR, entity-first) — jamais em volume bruto de reviews com o Rotten Tomatoes.

---

### 17.6 Sintese de prioridades (o que destrava mais valor tipo-RT com menos risco)

1. **PROXIMO PASSO (alto valor, baixo risco de licenca):** criar `block_type` + prompt versionado para um **consensus editorial qualitativo** (sem numeros de terceiros), gerado pelo Entity Writer a partir de `content_blocks` proprios ja revisados. Nao depende de `external_ratings` nem de licenca de citacao. Conta no gate anti-thin.
2. **DEBITO a resolver antes de qualquer nota publica:** popular `screen_score` fora do seed demo, **com metodologia editorial publicavel**, e nunca a partir de `vote_average` do TMDB. Enquanto isso nao existir, a UI de estrelas e placeholder que vaza para producao (RISCO de qualidade).
3. **BLOQUEIA PRODUCAO (rotulo/escala):** manter o veto absoluto a `Tomatometer`/`Popcornmeter` e a qualquer cross-conversion de escala — inclusive em copy de marketing e JSON-LD. `AggregateRating` so quando houver nota de fonte real, licenciada e atribuida (nunca nota propria disfarcada).
4. **Media prioridade (depende de fase propria):** ativar `external_ratings` (agregado proprio de criticos) exige worker `services/ratings`, decisao **humana** de licenca por fonte (`source_licenses`) e atribuicao/linkback renderizados — hoje tudo ausente/`unknown`.
5. **Baixa prioridade:** audience score/reviews de audiencia — bloqueado na raiz pela ausencia de `model User`; e uma fase de comunidade inteira, conscientemente adiada.


---

## Parte 18 — Funcionalidades tipo TMDB

### 18.0 Veredito em uma frase

O Screen **nao e um concorrente do TMDB — e um consumidor dele**: hoje praticamente toda a
superficie de **dado factual** exibida nas paginas publicas (titulos, ano, duracao, sinopse,
posteres, backdrops, elenco, equipe, temporadas, episodios, IDs externos, "Em breve") nasce de
**cinco endpoints do TMDB** e e reexibida com uma camada de apresentacao propria. O ativo
defensavel do Screen **nao e o dado cru** (que e do TMDB e replicavel por qualquer um), e sim o
que ainda **quase nao existe**: `content_blocks` editoriais versionados, curadoria, governanca de
licenca/indexacao e SEO entity-first. Enquanto essa camada nao encher, o Screen e uma **skin de
catalogo do TMDB** — ordens de magnitude menor que a referencia e sem fosso proprio.

---

### 18.1 O escopo real do que o Screen consome do TMDB

O client TMDB (`api-clients/tmdb/src/endpoints.ts:36-47`) expoe **exatamente cinco** chamadas, e a
ingestao (`services/ingestion/**`) consome **todas** offline, nunca no render (invariante 3):

| Endpoint TMDB | Path | `append_to_response` | Consumido por | Status |
| --- | --- | --- | --- | --- |
| Detalhe de filme | `GET /movie/{id}` | `external_ids,credits` | `services/ingestion/src/import/import-movie.ts:23` | **REAL** |
| Detalhe de serie | `GET /tv/{id}` | `external_ids,credits` | `services/ingestion/src/import/import-tv.ts:26` | **REAL** |
| Temporada (+episodios) | `GET /tv/{id}/season/{n}` | — | `import-tv.ts:56` | **REAL** |
| Pessoa | `GET /person/{id}` | `external_ids` | `services/ingestion/bin/import.ts:67` (so CLI manual) | **PARCIAL** |
| Lista upcoming | `GET /movie/upcoming` | — (region BR) | `bin/ingest-public-catalog.ts:67-69` (so `--include-upcoming --apply`) | **PARCIAL** |

Tudo o que o TMDB oferece **alem disso** — search, discover, trending, popular, changes, keywords,
videos, images, watch/providers, recommendations, similar, reviews, collections — **nao tem sequer
uma linha de `client.request(...)`** (`endpoints.ts` cobre so 5 paths; digest fato 60-61). O Screen
consome uma **fatia estreita e estatica** do TMDB: dez filmes + dez series curados manualmente como
bootstrap (`bin/ingest-public-catalog.ts:59-60`), mais um cap de 20 filmes upcoming.

---

### 18.2 Comparativo recurso a recurso (TMDB vs Screen)

| Recurso TMDB | Screen consome hoje? | Persistido em qual model? | Exibido? | Status | **PROXIMO PASSO** |
| --- | --- | --- | --- | --- | --- |
| **Base de entidades** (filmes/series/pessoas) | Sim — `/movie/{id}`, `/tv/{id}`, `/person/{id}` | `Movie`, `TvShow`, `Person` (`schema.prisma`) | Sim (fichas + listagens) | **REAL** (pessoa **PARCIAL**: so via CLI manual) | Ligar `getPerson` ao backfill/sync; hoje `import.ts` roda so com `DEV_SEED_IDS.people=[287,6193]` |
| **Posteres / backdrops** | Sim — `poster_path`, `backdrop_path` crus | colunas em `Movie`/`TvShow` (`:240-241,:279`) | Sim — URL remota `image.tmdb.org` via `buildTmdbImageUrl` | **REAL** | Nenhum imediato; `next/image`/remotePatterns ausentes (fato 80) |
| **Traducoes** | So pt-BR, so `title`+`summary` (o `summary` = `overview` cru do TMDB) | `EntityTranslation` (`:479-489`) | Sim (texto, meta, JSON-LD description) | **PARCIAL** + **DEBITO** | Reescrever `overview` como texto proprio (invariante: nao copiar sinopse); en/es nascem draft/noindex |
| **Keywords / tags** | Nao (`append` nao pede `keywords`) | — | Nao | **NAO IMPLEMENTADO** | Baixa prioridade; util p/ clustering e SEO semantico futuro |
| **Colecoes / franquias** (`belongs_to_collection`) | Nao | — (sem model `Franchise`) | Nao | **NAO IMPLEMENTADO** | Model `Franchise` e ingestao de `collection`; habilita bloco de valor "contexto de franquia" |
| **Elenco / equipe** (`credits`) | Sim — via `append_to_response=credits` | `CastMember`, `CrewMember`, `Person` (replace-set) | Elenco **sim**; equipe/direcao **nao** (ingerida, nunca consultada no detalhe) | **REAL** (cast) / **NAO IMPLEMENTADO** (crew na UI) | Renderizar direcao/roteiro/showrunner nas fichas (dado ja no banco, `store.ts:126-142`) |
| **Temporadas / episodios** | Sim — `/tv/{id}/season/{n}` (episodios embutidos) | `Season`, `Episode` (FK composta) | Inline na pagina da serie; **sem rota** `temporada-{n}`/episodio | **PARCIAL** + **DEBITO** | Criar rota `/pt/series/[slug]/temporada-[n]/` + JSON-LD `TVSeason`/`TVEpisode` (fatos 234-235) |
| **Watch providers** (JustWatch via TMDB) | **Nao** — endpoint `/watch/providers` nunca chamado | `WatchAvailability` existe, mas so o seed demo escreve | So dado ficticio do seed demo | **PLACEHOLDER** / **BLOQUEIA PRODUCAO** | Ver Parte 13; ticker+chips mock **vazam p/ prod** (invariante 6/8) |
| **Midia — videos/trailers** | Nao (`append` nao pede `videos`) | — (sem model `Trailer`) | Botao play **decorativo** `aria-hidden` | **NAO IMPLEMENTADO** | Model `Trailer` + ingestao `/movie/{id}/videos`; habilita bloco "trailer incorporado" |
| **Midia — imagens/galeria** | Nao (`append` nao pede `images`) | — (sem model `Image`; `Episode.stillPath` orfao) | Tres tiles vazios na ficha | **NAO IMPLEMENTADO** / **PLACEHOLDER** | Model `Image` + `/movie/{id}/images`; hoje so poster/backdrop unicos |
| **Recomendacoes / similares** | Nao | — (sem relacao de similaridade) | Nao | **NAO IMPLEMENTADO** | Relacao + ingestao `/recommendations`; habilita "obras parecidas" no gate anti-thin |
| **Reviews** (do TMDB) | Nao | `ContentBlock.review_summary` no enum, sem pipeline | Nao (nenhum `Review` no JSON-LD) | **NAO IMPLEMENTADO** | Review **propria** do Screen (nunca republicar review de terceiro sem licenca) |
| **Discussoes** | Nao | — | Nao | **NAO IMPLEMENTADO** | Fora de escopo; exigiria camada de comunidade/usuario inexistente |
| **User lists** | Nao | — (**sem model `User`**) | Nao | **NAO IMPLEMENTADO** | Botoes "Avaliar"/"Marcar como assistido" sao `<span aria-disabled>` sem handler (fato 11, 311) |
| **Contribuicao da comunidade** | Nao | — | Nao | **NAO IMPLEMENTADO** | Nao previsto no MVP; o modelo do Screen e editorial-curado, nao crowdsourced |

Sinais adicionais do TMDB **ingeridos mas nunca exibidos** (dado morto no banco): `status`,
`original_language`, `imdb_id`/`entity_external_ids`, `vote_average_tmdb`/`vote_count`,
`birthday`/`deathday`/`place_of_birth`. Notavelmente, `vote_average_tmdb` e **deliberadamente
represado** (`schema.prisma:238` marca como dado tecnico; zero leitores em `apps/web`, fato 121) —
correto: a nota do TMDB **nunca** pode virar "nota do Screen" (a estrela exibida e `screen_score`,
que so o seed demo popula — Parte 12).

---

### 18.3 Estimativa: quanto da superficie de dados vem do TMDB

Considerando apenas o **dado factual real** que chega (ou poderia chegar) a uma pagina publica com
banco populado por `services/ingestion` (nao pelo seed demo ficticio):

| Origem do dado | Exemplos | Peso estimado na superficie factual |
| --- | --- | --- |
| **TMDB** | titulo, ano, duracao, sinopse, poster, backdrop, elenco, equipe, temporadas, episodios, upcoming, IDs externos | **~90-95%** |
| **Gemini offline** (derivado de payload TMDB) | `content_blocks` editoriais — hoje so `editorial_intro`/`cast_intro`, e so no seed demo | **~5-10%** (potencial; hoje quase nulo em base real) |
| **Curadoria/editorial humano proprio** | screen_score, certification, decisoes de indexacao | **~0%** em base real (so seed demo) |
| **Outras fontes** (ratings externos, streaming, noticias) | IMDb/RT/Metacritic, watch providers reais, RSS | **0%** (todos os `services/*` correspondentes contem so `README.md`) |

Conclusao honesta: **em uma instalacao de producao real, mais de 90% de tudo que o usuario ve
factualmente vem do TMDB.** A "camada editorial propria" — o diferencial declarado no `CLAUDE.md` —
existe como **arquitetura** (`content_blocks` versionados, Entity Writer, gates), mas ainda **nao
como conteudo**: o unico produtor de blocos em base real e o Entity Writer, restrito a
`editorial_intro`/`cast_intro` (`run-generation.ts:66`), e nenhum foi revisado/publicado fora do
seed demo.

---

### 18.4 **RISCO** — se o TMDB mudar os termos, o que sobra?

O TMDB exige, pelos seus termos de uso, atribuicao e **proibe** usos que o desdupliquem como fonte;
tambem pode revogar acesso, mudar cotas, ou restringir redistribuicao de dado/imagem. O Screen hoje
depende do TMDB para **~90%+ da superficie factual E para as imagens** (servidas ao vivo de
`image.tmdb.org` — nao ha copia local desde o commit `46aac93`, fato 153). Cenario de ruptura:

| Se o TMDB... | Impacto imediato no Screen | O que **sobra** |
| --- | --- | --- |
| revogar a chave / cortar acesso | ingestao para; catalogo congela no ultimo sync; sem novos titulos | o banco ja sincronizado (metadados crus) — mas sem direito claro de mante-lo exibido |
| bloquear `image.tmdb.org` p/ hotlink | **todas** as imagens da home/fichas quebram em tempo real (sem fallback local) | layout sem posteres; **degradacao visivel imediata** |
| endurecer redistribuicao de metadados | sinopse/ficha crua deixam de poder ser reexibidas | **so o que for genuinamente proprio**: `content_blocks` editoriais + curadoria + SEO |

O **unico ativo que sobrevive a uma ruptura de termos** e o que o Screen ainda quase nao produziu:
**texto editorial original, curadoria, estrutura entity-first e autoridade de SEO**. Dado cru do
TMDB nao e fosso — e commodity licenciada. **PROXIMO PASSO estrategico:** tratar o TMDB como
*bootstrap* (fonte de sementes/ids/imagens), nao como produto, e investir a curva de esforco em
`content_blocks` revisados por humano — a unica coisa que o TMDB nao pode revogar.

---

### 18.5 Onde a arquitetura do Screen e vantagem estrutural real (a longo prazo)

Nao ha paridade de escala — e nao deveria haver fingimento disso. Mas quatro escolhas arquiteturais
sao **vantagem defensavel de qualidade/SEO** que o TMDB (como agregador de dado cru) nao entrega:

- **Entity-first + pureza de render (invariante 3/4):** cada URL gira em torno de uma entidade
  canonica, servida so de PostgreSQL/cache, sem latencia de terceiro e sem quebra por falha de API.
  Isso e a base de uma boa experiencia e de Core Web Vitals estaveis — o TMDB.org e um app de
  catalogo, nao um alvo de SEO editorial pt-BR.
- **`content_blocks` versionados e revisaveis (invariante 13):** `prompt_version`, `input_hash`,
  `output_hash`, `review_status`, `warnings_json`. Conteudo editorial rastreavel e auditavel — a
  materia-prima de E-E-A-T que reexibicao de ficha crua nunca gera.
- **Gate anti-thin (invariante 5):** o Screen **se recusa a indexar** uma pagina que seja so dado
  cru do TMDB (`>= 2` blocos de valor proprios). Isso e o oposto de programmatic-SEO de baixa
  qualidade; e uma barreira auto-imposta contra index bloat.
- **Governanca de licenca/atribuicao (invariante 6):** defaults fail-closed, separacao
  `provider_api != rating_source`, e a atribuicao TMDB obrigatoria **ja presente** (ver 18.6).

A tese e valida: **quando** a camada editorial encher, o Screen tera algo que o dado do TMDB nao da
por si — paginas ricas, originais, indexaveis em pt-BR. Ate la, e potencial, nao realizacao.

---

### 18.6 Obrigacao de atribuicao TMDB — cumprida?

**Confirmado: sim.** O rodape publico atribui explicitamente ao TMDB, com a formula de
nao-endosso exigida pelos termos:

- `apps/web/app/_components/site-footer.tsx:205-208` — **REAL**:
  > "Este produto usa a API do TMDB, mas nao e endossado ou certificado pelo TMDB. Dados e imagens
  > de filmes e series fornecidos pelo TMDB."

Isso cobre o requisito basico de atribuicao textual (`SiteFooter` e global, montado no
`layout.tsx`). Lacunas relacionadas, porem, permanecem:

- **PARCIAL** — nao ha logo do TMDB nem link para `themoviedb.org` no footer (so texto). Os termos
  do TMDB pedem preferencialmente o **logo** com linkback; hoje e so paragrafo.
- **DEBITO** — a atribuicao esta no footer, mas o `summary`/sinopse (`overview` cru do TMDB
  reexibido como texto visivel, meta description e JSON-LD `description`, fatos 202/262) **ainda e
  copia literal** de terceiro, contrariando a propria regra do Entity Writer (secao 4 de
  `.claude/rules/entity-writer.md`: "nao copiar sinopses externas"). A atribuicao no rodape nao
  sana a obrigacao editorial de reescrever.

**PROXIMO PASSO:** adicionar logo + linkback do TMDB (elevar de texto para atribuicao completa) e
substituir o `overview` cru por `content_blocks` proprios reescritos e revisados.


---

## Parte 19 — Explorar, busca e descoberta

Esta secao audita **toda a superficie de descoberta** do Screen: o hub `/pt/explorar/`, as listagens de entidade, a ausencia de busca, e todos os afordances de descoberta (tendencias, populares, mais aguardados, rankings, generos, listas editoriais, paginacao, ordenacao e SEO programatico). Auditoria estatica, somente leitura, sobre a branch `feat/home-hero-carousel`.

Conclusao curta e desconfortavel: **a camada de descoberta do Screen praticamente nao existe como produto**. O que existe e (a) um hub de navegacao honesto com quatro cards, (b) tres listagens flat de catalogo com cap de 24 itens e zero paginacao, e (c) um conjunto de rotulos de descoberta **fabricados** (Top 250, Mais populares, Em alta, Mais buscadas, "novo episodio hoje", chips de plataforma, badges `#1..#10`) que hoje **vazam para producao** apontando todos para a mesma URL.

---

### 19.1 Inventario item-a-item

| Item auditado | Status | Onde vive / evidencia |
| --- | --- | --- |
| `/pt/explorar` (hub) | **PARCIAL** | `apps/web/app/pt/explorar/page.tsx:103` |
| Busca (campo, endpoint, full-text) | **NAO IMPLEMENTADO** | zero `route.ts` em `apps/web/app`; zero `searchParams` em `apps/web` |
| Busca full-text no Postgres (`tsvector`/`pg_trgm`) | **NAO IMPLEMENTADO** | zero ocorrencia em `packages/db/prisma/schema.prisma` e nas 3 migrations |
| Icone de lupa no header | **PLACEHOLDER** (link para `/pt/explorar/`) | `apps/web/app/_components/site-header.tsx:80-88` |
| Filtros (genero, ano, plataforma, tipo) | **NAO IMPLEMENTADO** | nenhuma pagina publica le `searchParams` |
| Model `Genre` / tabela `genres` | **NAO IMPLEMENTADO** | ausente do schema Prisma e das migrations |
| Rotas `/pt/genero/*` | **NAO IMPLEMENTADO** | `apps/web/app/pt/` = `explorar`, `filmes`, `noticias`, `pessoas`, `series` |
| Tendencias / trending | **NAO IMPLEMENTADO** | cliente TMDB nao expoe `/trending` (`api-clients/tmdb/src/endpoints.ts:37-46`) |
| Populares | **PLACEHOLDER** (rotulo de rodape sem query) | `apps/web/app/_components/site-footer.tsx:49,54` |
| Mais aguardados / "Em breve" | **REAL** (com fallback placeholder) | `apps/web/src/server/home-upcoming.ts:37`; mock em `apps/web/app/pt/page.tsx:153-160` |
| Lancamentos (now playing / estreias da semana) | **NAO IMPLEMENTADO** | so `/movie/upcoming` existe no client TMDB |
| Recomendacoes / obras parecidas | **NAO IMPLEMENTADO** | `similar_titles_intro` so aparece como *tipo de bloco* ordenavel (`apps/web/src/lib/movie-presenter.ts:23`), nunca gerado nem renderizado |
| Ranking (Top 10 / Top 250) | **PLACEHOLDER** — rank visual por posicao de slot | `apps/web/app/pt/page.tsx:313-346`, `:355-378` |
| Listas editoriais | **NAO IMPLEMENTADO** | nenhuma tabela `lists`/`collections`; `franchises` citado em docs, sem model |
| Paginacao | **NAO IMPLEMENTADO** (existe so o *texto* de corte) | `apps/web/app/_components/entity-index.tsx:103-107` |
| Ordenacao (usuario escolhe) | **NAO IMPLEMENTADO**; ordenacao fixa por ano desc | `apps/web/src/lib/entity-index-presenter.ts:238-243` |
| SEO programatico de descoberta (genero/ano/plataforma) | **NAO IMPLEMENTADO** | `apps/web/src/lib/sitemap-presenter.ts:114-121` lista 6 rotas estaticas; nenhuma facetada |
| Rotas `/pt/streaming/{plataforma}/melhores-filmes/` e `/pt/onde-assistir/{slug}/` | **NAO IMPLEMENTADO** (prometidas em doc) | `docs/SEO_PROGRAMMATIC.md:52-54` |
| Ticker "novo episodio hoje" | **PLACEHOLDER que vaza para producao** | `apps/web/app/_components/episodes-ticker.tsx:53-91`, montado sem gate em `apps/web/app/pt/page.tsx:648` |
| Chip de plataforma nos tiles de serie | **PLACEHOLDER que vaza para producao** | `apps/web/app/pt/page.tsx:133-144`, usado em `:764` |
| Colunas de descoberta do rodape | **PLACEHOLDER que vaza para producao** | `apps/web/app/_components/site-footer.tsx:40-56` |

---

### 19.2 `/pt/explorar` — o que faz de verdade

**PARCIAL.** A pagina e um **hub de navegacao**, nao uma superficie de descoberta. O proprio docblock e explicito e honesto:

> "esta pagina NAO e busca. Nao ha campo de busca, autosuggest, filtro, ranking ou 'populares' — nada e simulado." (`apps/web/app/pt/explorar/page.tsx:33-35`)

O que ela realmente renderiza:

1. **Breadcrumb** + hero institucional com `h1` "Explorar" (`:168-180`).
2. **Quatro cards de hub** (Filmes / Series / Pessoas / Noticias) que sao apenas links para os quatro indices existentes, com uma **contagem real** vinda do banco quando `> 0` (`:117-146`, `:182-197`). A contagem passa por `formatCollectionCount()` (`apps/web/src/lib/portal-presenter.ts:81-88`), que retorna `null` para `<= 0` — nao ha numero fabricado.
3. **Ate quatro secoes de cards** (8 filmes, 8 series, 8 pessoas, 3 noticias), cada uma renderizada **so quando ha itens reais** (`:199-277`). Caps em `EXPLORE_ENTITY_CARD_LIMIT = 8` e `EXPLORE_NEWS_CARD_LIMIT = 3` (`portal-presenter.ts:29,32`).
4. **JSON-LD**: `CollectionPage` + `BreadcrumbList` (`:157-163`, `:148-155`). Sem `ItemList` — diferente do `EntityIndex`, que emite `mainEntity: ItemList` (`apps/web/app/_components/entity-index.tsx:64-75`). Inconsistencia pequena, mas real.

Fonte de dados: os **mesmos getters** das listagens (`getMovieIndexData`, `getSeriesIndexData`, `getPersonIndexData`, `getNewsIndexData`), todos `cache()`-ados e server-only, lendo apenas Postgres via Prisma (`apps/web/src/server/entity-indexes.ts:94,138,184`). **Invariantes 3 e 4 respeitadas**: zero API externa, zero Gemini no render.

Indexabilidade: `evaluatePortalIndexability({ populatedSectionCount })` — indexa com `>= 2` secoes populadas (`portal-presenter.ts:20,62-75`). Com 0 ou 1 secao, `noindex`. Coerente com o sitemap (`sitemap-presenter.ts:270-279`).

Os cards de explorar **nao ordenam por relevancia**: eles herdam a ordenacao das listagens (ano desc, depois titulo asc — `entity-index-presenter.ts:238-243`). "Explorar" hoje significa "os 8 titulos mais recentes por ano de lancamento". Nao ha sinal de popularidade, curadoria ou editorial na selecao.

**RISCO — NAO BLOQUEIA PRODUCAO.** `export const dynamic = "force-dynamic"` (`:45`) faz o hub executar 4 grupos de queries a cada request, e `entity-indexes.ts` faz `findMany` **sem `take`** sobre `slug`, `movie`, `tvShow`, `person` e `entityTranslation` (`entity-indexes.ts:69-71,101-112,145-157,191-194`) — todo o catalogo e carregado em memoria para depois cortar em 8/24 no presenter. Com o catalogo curado atual (10 filmes + 10 series + upcoming, `services/ingestion/bin/ingest-public-catalog.ts:60-61`) e irrelevante. Com um catalogo TMDB de escala, e um `SELECT *` de tabela inteira por request de home, hub e sitemap.

**PROXIMO PASSO:** mover o cap e a ordenacao para o SQL (`take` + `orderBy` no Prisma), manter o presenter como validador; e trocar `force-dynamic` por `revalidate` (ISR) — a listagem nao muda a cada request.

---

### 19.3 Busca

**NAO IMPLEMENTADO.** E a lacuna mais grave desta secao, e a mais honestamente documentada.

- Nao existe rota de API: `find apps/web/app -name route.ts` retorna vazio.
- Nao existe pagina que leia `searchParams`: zero ocorrencias em `apps/web/app` e `apps/web/src`.
- Nao existe indice full-text: nenhum `tsvector`, `pg_trgm`, `to_tsvector` ou `@@index` textual em `packages/db/prisma/schema.prisma` nem nas migrations (`20260625120000_init`, `20260701120000_add_news_articles`, `20260706120000_add_certification_screen_score`).
- Nao existe `opensearch.xml` nem qualquer descritor de busca em `apps/web/public/` (so `brand/` e `media/`).
- `navigation.ts:8` registra a decisao: *"o icone de busca do design fica de fora (busca esta fora de escopo)"*.

O que existe e um **botao com aparencia de lupa** no header que navega para `/pt/explorar/` (`site-header.tsx:80-88`), com `aria-label="Explorar"`. A escolha e defensavel (nao finge campo de busca; nao ha `<input>`), mas do ponto de vista de UX **e uma lupa que nao busca**: o usuario clica esperando um campo e recebe um hub de 4 links. O comentario no codigo assume isso: *"Busca leva ao hub /pt/explorar/ (rota real); sem campo funcional."*

**DEBITO — BLOQUEIA PRODUCAO** (para um produto que se apresenta como "base global de entretenimento"). Um catalogo entity-first sem busca por titulo nao e navegavel: com 24 itens por indice e sem paginacao, o unico caminho ate a entidade #25 e o sitemap.

**PROXIMO PASSO:** busca server-side em Postgres, sem servico externo, respeitando invariante 3:
1. Coluna gerada `search_vector tsvector` em `movies`/`tv_shows`/`people` (ou tabela `search_documents` unificada com `entity_type` + `entity_id` + `language_code`), populada na ingestao/offline, com `GIN` index.
2. Rota `/pt/busca/` **`noindex`** (pagina de resultado interno nunca indexa — evita index bloat e conflito com o gate anti-thin da invariante 5), com `searchParams.q` sanitizado e `websearch_to_tsquery('portuguese', q)`.
3. Fallback `pg_trgm` (`similarity`) para erro de digitacao; cap de resultados, sem ordenacao por "popularidade" ate haver sinal governado.
4. Zero autosuggest com fetch por keystroke enquanto nao houver rate limit — ou implementar como route handler server-only ja coberto pelo `Disallow: /api/` do robots (`apps/web/app/robots.ts:24`).

---

### 19.4 Filtros e ordenacao

**NAO IMPLEMENTADO** (ambos).

- **Filtros**: nenhuma pagina publica aceita `searchParams`. Nao ha filtro por tipo, ano, genero, plataforma, idioma, certificacao ou nota.
- **Ordenacao**: fixa e **nao configuravel**. `buildIndexView()` ordena por `year` desc e desempata por `sortKey` asc (`entity-index-presenter.ts:238-243`); pessoas ordenam por nome asc (`:322-333`). O usuario nao pode mudar.

Consequencia editorial: **"os mais recentes" e a unica lente de descoberta do site**. Um classico de 1972 e estruturalmente inalcancavel na navegacao assim que 24 titulos mais novos existirem.

Ha um dado de ordenacao **real e ja ingerido** que ninguem usa: `Movie.popularity` / `TvShow.popularity` (`packages/db/prisma/schema.prisma:237,281`), com indice dedicado (`:259,300`), preenchido pela ingestao (`services/ingestion/src/normalizers/movie.ts:45`, `services/ingestion/src/persistence/store.ts:160`). Existe a materia-prima para um "Populares" honesto (atribuido: "popularidade TMDB") e ela esta parada.

**Atencao de governanca:** `popularity` e `vote_average_tmdb` sao **dado tecnico do provider**, nao `rating_source` editorial — o proprio schema anota isso (`schema.prisma:238`: *"dado tecnico TMDB; NUNCA nota editorial (inv. 1/2)"*). Usar `popularity` como **ordenacao** e legitimo; exibi-lo como **nota** violaria a invariante 2. Uma pagina "Populares" precisa de rotulo explicito da fonte, e provavelmente de `noindex` ate ter bloco editorial proprio.

**PROXIMO PASSO:** (a) ordenar listagens no SQL com `orderBy` parametrizavel por um conjunto **fechado** de chaves (`recentes`, `populares`, `alfabetico`); (b) toda variacao de ordenacao emite `canonical` para a URL limpa (`.claude/rules/seo.md` §6) e recebe `noindex` — nunca criar N URLs facetadas indexaveis a partir de um `?sort=`.

---

### 19.5 Generos

**NAO IMPLEMENTADO — sem tabela, sem rota, sem ingestao.**

- Nao existe `model Genre` no Prisma. Confirmado por varredura de `model ` em `packages/db/prisma/schema.prisma`: `Language, Country, RatingSource, ApiProvider, SourceLicense, Movie, TvShow, Season, Episode, Person, CastMember, CrewMember, EntityExternalId, Slug, Redirect, EntityTranslation, ContentBlock, EntityWriterJob, EntityWriterLog, ExternalRating, WatchAvailability, PageIndexabilityDecision, ApiCache, ApiSyncLog, Article, ArticleTranslation, EntityNewsLink, NewsCluster`. Nenhum genero.
- Nao existe `/pt/genero/*` nem `/pt/generos/`.
- A ingestao **explicitamente descarta** generos: `services/ingestion/README.md:12` — *"nao grava ... `genres` (sem tabela alvo no schema)"*; `docs/PHASE_2_TMDB_PLAN.md:199` registra a restricao **R2** ("sem tabelas para genres/collections(franchises)/galerias").
- `docs/PHASE_3A_ENTITY_WRITER_PLAN.md:568` documenta que o payload do Entity Writer **deliberadamente** exclui `genres`.
- `database/schema.md` tambem nao descreve `genres` (grep vazio).

Ou seja: o TMDB entrega generos em todo detalhe de filme/serie, e o Screen **joga fora**. Nao ha nem debito registrado como tabela pendente — ha uma decisao de escopo.

**DEBITO — NAO BLOQUEIA PRODUCAO, mas bloqueia SEO programatico.** Paginas de genero (`/pt/filmes/genero/{slug}/`) sao o principal vetor de descoberta long-tail de um catalogo de entretenimento. Sem `genres`, tres blocos de valor do gate anti-thin ficam inacessiveis (contexto de franquia, obras parecidas, comparacao) porque nao ha eixo de similaridade estruturado.

**PROXIMO PASSO:** tarefa **aprovada de banco** (a invariante do CLAUDE.md proibe schema fora de tarefa aprovada) criando `genres` + `entity_genres` (polimorfica, como `slugs`/`cast_members`), populada offline pela ingestao a partir do `genres[]` do detalhe TMDB. So depois discutir rota publica — e uma pagina de genero **so pode indexar** com >= 2 blocos de valor proprios (invariante 5): uma grade de posters filtrada e dado cru espelhado e **nao conta**.

---

### 19.6 Tendencias, populares, mais aguardados, lancamentos

| Superficie | Status | Detalhe |
| --- | --- | --- |
| Trending / "Em alta" | **NAO IMPLEMENTADO** | O client TMDB expoe apenas `getMovie`, `getTvShow`, `getTvSeason`, `getPerson`, `getUpcomingMovies` (`api-clients/tmdb/src/endpoints.ts:37-46`). Nao ha `/trending`, `/popular`, `/now_playing`, `/top_rated`, `/discover`. |
| Populares | **PLACEHOLDER** | O rotulo "Mais populares" existe em duas colunas do rodape (`site-footer.tsx:49,54`) e aponta para `/pt/series/` e `/pt/pessoas/` — o indice inteiro, sem qualquer filtro de popularidade. |
| Mais aguardados / "Em breve" | **REAL** | `getHomeUpcomingMovies()` le `Movie.releaseDate > hoje (UTC)` com slug canonico pt-BR, ordena por estreia asc, cap 6 (`apps/web/src/server/home-upcoming.ts:37-93`, `apps/web/src/lib/home-upcoming-presenter.ts:22`). Alimentado offline por `--include-upcoming` (`services/ingestion/bin/ingest-public-catalog.ts:234-262`), com cache + log (`api_cache`, `api_sync_logs`). Sem dado real, cai no mock **so em dev/preview** (`apps/web/app/pt/page.tsx:602-617`, gate `allowHomeVisualPlaceholders`). Item real **nao** exibe pilula de duracao de trailer — a honestidade aqui esta correta (`coming-soon-rail.tsx:13-17`). |
| Lancamentos (em cartaz) | **NAO IMPLEMENTADO** | Nao ha `/movie/now_playing`. "Em breve" cobre so estreia futura. |
| "Nascidos hoje" (pessoas) | **PLACEHOLDER** | `site-footer.tsx:54`; `Person` nem sequer tem `birthday` exposto nas listagens. |

O "Em breve" e **o unico bloco de descoberta genuinamente real do produto**, e vale registrar isso: ele estabelece o padrao correto (descoberta feita offline pelo worker, com `api_cache` + `api_sync_logs`, e o render lendo so Postgres). Todo o resto da descoberta deveria copiar esse padrao.

**PROXIMO PASSO (populares):** ordenar por `popularity` (ja ingerido) numa rota `noindex` ou numa secao da home, **rotulada** como "popularidade TMDB" (nunca como nota, nunca como `AggregateRating`). Nao criar endpoint `/trending` no client TMDB sem antes definir periodicidade (`.claude/rules/ingestion.md`: trending = 6–12h) e log de sync.

---

### 19.7 Ranking

**PLACEHOLDER — e vaza para producao.**

A home renderiza `#1..#10` sobre os cards de destaque:

- `HomeV4BigCard` recebe `rank={index + 1}` e imprime `<span className="home-v4-rank-badge">#{rank}</span>` (`apps/web/app/pt/page.tsx:313-322,674`).
- `HomeV4CompactCard` imprime `#{rank}` com `rank={index + 5}` (`:355-367,684`).
- A lista subjacente vem de `fillSlots(featuredCards, 10)` (`:549`), que **repete itens em ciclo** quando ha menos de 10 titulos (`:73-76`). Ou seja: com 6 filmes reais, o mesmo filme aparece como `#1` e como `#7`.

O comentario admite: *"O #N e posicao VISUAL do slot (nao ranking real)"* (`:653-655`). Mas **o usuario e o crawler nao leem comentarios**. Um `#1` sobre um poster e, para qualquer leitor, uma afirmacao de ranking. Diferente do bloco de Noticias mock e do bloco de Publicidade, o rank badge **nao esta atras de `allowHomeVisualPlaceholders()`** — ele renderiza em producao.

Nao ha `Top 250` nem `Top 50` reais: sao rotulos de rodape (`site-footer.tsx:44,49`) linkando ao indice pai.

**RISCO — BLOQUEIA PRODUCAO** (honestidade editorial; tensiona o espirito da invariante 5 e da secao "Lista NUNCA" sobre nao fingir dado). Um `#1` derivado de `index + 1` sobre uma lista ordenada por *ano de lancamento* e um numero inventado.

**PROXIMO PASSO:** remover o rank badge dos cards da home **ou** gatea-lo por `allowHomeVisualPlaceholders()` (como ja foi feito com Noticias/Publicidade/Newsletter), ate existir um criterio de ranking governado e atribuido.

---

### 19.8 Listas editoriais

**NAO IMPLEMENTADO.**

- Nao ha model `List`, `Collection`, `Curation` ou `Franchise` no Prisma (franquias sao citadas em `.claude/rules/*` e `docs/`, mas `docs/PHASE_2_TMDB_PLAN.md:199` confirma que **nao existe tabela**).
- Nao ha `content_block` do tipo lista. Os tipos validos (`similar_titles_intro`, `franchise_context`, `season_guide`) existem como enum e como ordem de exibicao (`apps/web/src/lib/movie-presenter.ts:17-31`), mas **nenhum e gerado** — o slice ativo do Entity Writer cobre so `editorial_intro` e `cast_intro` (`.claude/rules/entity-writer.md`, secao de estado atual).
- A UI de "listas" que aparece no design v4 foi conscientemente **nao renderizada** (`site-header.tsx:24-26`: *"`Entrar`/avatar/`Listas`/`Onde assistir` do v4 dependem de login/watchlist inativos e por isso NAO sao renderizados"*). Essa decisao esta correta e e o unico lugar do repo onde a governanca de feature inativa foi aplicada ao header.

**PROXIMO PASSO:** listas editoriais sao a resposta natural ao gate anti-thin (uma lista curada com introducao propria = 2 blocos de valor). Antes de generos e antes de busca, uma tabela `editorial_lists` + `editorial_list_items` com `review_status`/`published_at` daria paginas indexaveis honestas. Exige tarefa aprovada de banco.

---

### 19.9 Paginacao

**NAO IMPLEMENTADO.** Existe apenas o *aviso textual* de que ha corte:

```
Mostrando os primeiros {view.cards.length} de {view.totalCount}.
```
(`apps/web/app/_components/entity-index.tsx:103-107`, com `hasMore` calculado em `entity-index-presenter.ts:246`)

Nao ha `?page=`, nao ha `rel="next"/"prev"`, nao ha link "carregar mais", nao ha `/pt/filmes/pagina-2/`. O cap e `INDEX_ITEM_LIMIT = 24` (`entity-index-presenter.ts:19`). A mesma frase existe na listagem de noticias (`apps/web/app/pt/noticias/page.tsx:112`).

Consequencia concreta e verificavel: assim que o catalogo passar de 24 filmes com slug pt-BR, **o filme #25 nao tem nenhum caminho de navegacao interna a partir da home, do hub ou da listagem**. Ele existe no `sitemap.xml` (`sitemap-presenter.ts:294-303`) se cumprir o gate de blocos, mas e uma **pagina orfa** em termos de link interno. Para o Googlebot isso significa: descoberta so via sitemap, PageRank interno zero, crawl budget desperdicado.

E nao e hipotetico: `ingest-public-catalog.ts:60-61` ja ingere 10 filmes curados **mais ate 20 upcoming** (`UPCOMING_IMPORT_CAP = 20`, `:68`) = ate 30 filmes. O corte de 24 ja e alcancavel na configuracao atual da ingestao.

**DEBITO — BLOQUEIA PRODUCAO** (para qualquer catalogo > 24 itens por vertical).

**PROXIMO PASSO:** paginacao por segmento de path (`/pt/filmes/pagina-{n}/`, nunca query string), com `canonical` autorreferente por pagina, `noindex` a partir de uma pagina limite se as paginas profundas forem finas, e `take`/`skip` no SQL. Adicionar as paginas ao `sitemap-presenter.ts` **so** se passarem no mesmo gate das listagens.

---

### 19.10 SEO programatico de descoberta

**NAO IMPLEMENTADO.** O sitemap tem exatamente **6 rotas estaticas** e nenhuma facetada:

```
/pt/  /pt/filmes/  /pt/series/  /pt/pessoas/  /pt/noticias/  /pt/explorar/
```
(`apps/web/src/lib/sitemap-presenter.ts:114-121`)

Mais os detalhes de filme/serie/pessoa/noticia que passam individualmente no gate (`:294-324`). Zero paginas de genero, ano, plataforma, decada, pais ou "melhores de".

O documento `docs/SEO_PROGRAMMATIC.md:52-54` **promete** rotas que nao existem:

```
/pt/streaming/netflix/melhores-filmes/
/pt/streaming/prime-video/melhores-filmes/
/pt/onde-assistir/{slug}/
```

Nenhuma delas tem `page.tsx`. Sao roadmap apresentado como "Rotas MVP (pt-BR)". **DEBITO de documentacao** — o doc induz a leitura de que a superficie programatica existe.

#### 19.10.1 Tensao real com o gate anti-thin (invariante 5)

Este e o achado mais delicado desta secao. As listagens e portais **reutilizam o motor de indexabilidade canonico passando contagem de itens como se fossem blocos de valor**:

```ts
// apps/web/src/lib/entity-index-presenter.ts:340-352
return evaluateIndexability({
  language: "pt-BR",
  hasReliableStructuredData: true,
  valueBlocksCount: count,          // <- count = numero de CARDS na listagem
  displayedRatings: [],
  thinContentScore: count >= MIN_INDEX_ITEMS ? 0 : 1,
  reviewStatusOk: true,
});
```

E o mesmo padrao em `portal-presenter.ts:62-75`, onde `valueBlocksCount = populatedSectionCount` (numero de secoes com pelo menos 1 card).

`evaluateIndexability` exige `valueBlocksCount >= MIN_VALUE_BLOCKS` (= 2, `packages/seo/src/indexability.ts:79`). Logo:

- `/pt/filmes/` com **3 posters** (`MIN_INDEX_ITEMS = 3`, `entity-index-presenter.ts:25`) recebe `index`.
- `/pt/explorar/` com **2 grades de cards** recebe `index`.

Mas o CLAUDE.md e `.claude/rules/seo.md` definem bloco de valor como *"bloco de valor **proprio**, alem do dado cru vindo de API"* — e listam 15 tipos concretos (introducao editorial, FAQ, elenco comentado...). **Uma grade de posters do TMDB e exatamente "dado cru espelhado"**, que a regra diz que "nao conta".

Nao afirmo que isso viola a letra do gate (as listagens sao paginas de navegacao, nao paginas de entidade, e nenhum teste de governanca proibe isso — `tests/governance/indexability.test.ts` testa a funcao pura, nao os callers). Afirmo que a **semantica do parametro foi reaproveitada**: `valueBlocksCount` esta recebendo "quantidade de itens", nao "quantidade de blocos de valor proprios". Se amanha existirem 200 paginas de genero chamando o mesmo evaluator com `valueBlocksCount = numero de filmes do genero`, o gate anti-thin **aprova index bloat em massa** sem que nenhuma linha de codigo mude.

**RISCO — NAO BLOQUEIA PRODUCAO hoje** (6 rotas estaticas), **BLOQUEIA** no momento em que descoberta programatica for construida.

**PROXIMO PASSO:** separar os evaluators. Criar `evaluateListingIndexability(itemCount)` em `@screena/seo`, com nome e semantica proprios, em vez de sobrecarregar `valueBlocksCount`. Travar com teste de governanca que **grade de cards sozinha nunca produz `index` numa pagina facetada** (genero/ano/plataforma), exigindo pelo menos 1 bloco editorial proprio persistido em `content_blocks`.

---

### 19.11 Placeholders de descoberta que vazam para producao

O repositorio tem um gate correto e testado — `allowHomeVisualPlaceholders()` (`apps/web/src/lib/home-placeholder-governance.ts:44-51`): oculta placeholders quando `NODE_ENV === "production"` sem a flag `SCREEN_HOME_VISUAL_PLACEHOLDERS=1`. Ele protege Noticias mock, "Em breve" mock, Publicidade e Newsletter.

**Tres superficies de descoberta ficaram de fora do gate:**

| Superficie | Linha | O que afirma sem ter dado |
| --- | --- | --- |
| `<EpisodesTicker />` | `apps/web/app/pt/page.tsx:648` (montagem incondicional) | "Wednesday · T2 · E6 · **novo episodio hoje**" + CTA "**Onde assistir** NETFLIX" (`episodes-ticker.tsx:53-91,129-165`). Nao ha `watch_availability` nem `Episode` real por tras. |
| Chip de plataforma nos tiles de serie | `apps/web/app/pt/page.tsx:454`, alimentado por `homeVisualPlatform(index)` (`:133-144`), usado em `:764` | Estampa "Max", "Netflix", "Apple TV+", "Star+", "Prime Video", "Disney+" por **posicao do slot** (`index % 6`). |
| Rank badge `#N` | `apps/web/app/pt/page.tsx:321,365` | Ranking derivado de posicao de array. |

E o rodape, tambem sem gate (`site-footer.tsx:141-152`):

| Rotulo | href real |
| --- | --- |
| Top 250 · Em breve · Mais vistos · Mais premiados | todos -> `/pt/filmes/` |
| Top 50 · Mais populares · Em breve · Mais vistas | todos -> `/pt/series/` |
| Nascidos hoje · Mais populares · Em alta · Mais buscadas | todos -> `/pt/pessoas/` |

O docblock do rodape chama isso de "paginas FUTURAS: apontam para o indice pai existente — NUNCA rota quebrada" (`site-footer.tsx:19-22`). Nao ha link quebrado, verdade. Mas ha **12 ancoras com texto distinto apontando para 3 URLs**, prometendo 12 superficies de descoberta que nao existem. Para o usuario e uma armadilha; para o crawler e diluicao de sinal de anchor text.

**Invariantes tensionadas:**
- **6 (licenca)**: o ticker e os chips afirmam disponibilidade de streaming sem `watch_availability`, sem `display_allowed`, sem `license_status`. O proprio codigo admite: *"tensiona a invariante 6 e as regras de streaming"* (`episodes-ticker.tsx:15-22`).
- **Regras de "onde assistir"**: `.claude/rules/entity-writer.md` §3 proibe afirmar "esta na Netflix/Prime/Max" sem disponibilidade confirmada. A regra e escrita para o writer, mas o principio e do produto.

**RISCO — BLOQUEIA PRODUCAO.**

**PROXIMO PASSO (por ordem de custo):**
1. Envolver `<EpisodesTicker />` e o chip de plataforma em `allowHomeVisualPlaceholders()` — 2 linhas, resolve o vazamento hoje.
2. Substituir os 12 rotulos do rodape por 3 links honestos ("Ver todos os filmes") ou por `<span>` inerte, como ja foi feito com a coluna institucional (`site-footer.tsx:58-62`).
3. Remover ou gatear o rank badge.
4. Depois: implementar `/api/episodes/today` a partir de `watch_availability` + `Episode.airDate`, como o proprio comentario propoe (`episodes-ticker.tsx:20-21`).

---

### 19.12 Estado dos testes que protegem esta area

Existem guards de "descoberta fake" em `tests/web/public-navigation.test.ts`:

- `explorar /pt/explorar/ — hub sem busca fake` (`:118-126`): proibe `<input>`, `<form>`, `autosuggest`, `/mais populares|top rated|ranking|trending/i`, `/tomatometer|imdb|popcorn/i`, `/onde assistir/i`. **PASSA.**
- `home /pt/ — pagina real e segura > nao tem busca fake nem features inexistentes` (`:84-91`): mesma bateria. **FALHA.**

Executei `npx vitest run tests/web/public-navigation.test.ts`: **2 failed | 12 passed**.

1. `home ... nao tem busca fake`: falha em `expect(code).not.toMatch(/mais populares|top rated|ranking/i)`. Causa: `withoutBlockComments()` (`tests/web/public-navigation.test.ts:36-38`) so remove `/* */`, e `apps/web/app/pt/page.tsx:534` e um comentario de **linha**: `// ... No ritmo do Top 10 do v4, mas SEM ranking, SEM`. E **falso positivo** — o guard nao esta detectando ranking real, esta batendo no comentario que jura nao haver ranking. Ironicamente, o ranking visual **existe** (`:321`) e o guard nao o pega (`#{rank}` nao casa com `/ranking/i`).
2. `header ... logo local com alt='Screen'`: falha em `expect(source).toContain('src="/brand/screen-logo-black.svg"')`. Causa: o header passou a usar `src={overHero ? "/brand/screen-logo-white.svg" : "/brand/screen-logo-black.svg"}` (`site-header.tsx:60`) e o teste espera o literal.

Ambas as falhas sao **pre-existentes** (nao introduzidas por esta auditoria; nada foi alterado). Consequencia real: **o guard de "sem descoberta fake" da home esta vermelho ha commits**, o que significa que ninguem estaria vendo um novo placeholder de ranking/populares entrar na home — o sinal ja esta poluido.

**DEBITO — NAO BLOQUEIA PRODUCAO, mas invalida o guard.**

**PROXIMO PASSO:** (a) estender `withoutBlockComments` para remover tambem `//` de fim de linha; (b) trocar o assert do logo por uma checagem dos dois assets; (c) adicionar ao guard os padroes que ele **deveria** pegar e nao pega: `rank-badge`, `#{rank}`, `HOME_VISUAL_PLATFORMS`, `EpisodesTicker` fora de gate.

---

### 19.13 Detalhes menores, mas verificados

- **`screenScore` calculado e nunca exibido nas listagens.** `buildMovieCard`/`buildSeriesCard` resolvem `screenScore` via `resolveCardScreenScore` (`entity-index-presenter.ts:201-209,260,274`), mas `EntityCardLink` **nao renderiza** o campo (`apps/web/app/_components/entity-card.tsx:41-70`). So a home v4 usa. Codigo morto na listagem — nao e bug, e ruido.
- **`screen_score` so existe no seed demo.** `apps/admin/scripts/public-demo-seed.ts:261-263` grava `screenScore` + `screenScoreDisplay: true`. A ingestao TMDB real (`services/ingestion/src/persistence/store.ts`) **nao grava** `screenScore`. Portanto: catalogo real ingerido = **cards sem estrela**; catalogo demo = cards com estrela. Um leitor do site em producao veria uma home sem nenhuma nota — o que e correto pela governanca, mas visualmente diferente do design v4 aprovado.
- **Alias sem prefixo de idioma.** `/filmes/` e `/series/` existem apenas como `permanentRedirect` 308 para `/pt/...` (`apps/web/app/filmes/page.tsx:14-16`). Nao entram em sitemap nem em canonical. Correto (invariante 7, e `.claude/rules/seo.md` §8 — nao e redirect por idioma).
- **`robots.txt`** libera crawl geral e bloqueia `/api/`, `/dev/`, `/admin/` (`apps/web/app/robots.ts:20-30`). Uma futura rota `/pt/busca/` **nao** seria bloqueada por `Disallow` — precisara de `<meta robots noindex>`, como a propria regra manda (`.claude/rules/seo.md` §3).
- **`SITE_URL` hardcoded** em `apps/web/src/lib/site.ts:9` (`https://thescreen.media`). Fora do escopo desta secao, mas afeta descoberta: em um dominio temporario de staging, o `sitemap.xml` e os `canonical` apontariam para o dominio de producao.

---

### 19.14 Resumo executivo da Parte 19

**O que e REAL:** o hub `/pt/explorar/` (navegacao + contagens honestas + secoes condicionais), as tres listagens flat com gate de indexabilidade, o bloco "Em breve" (unico dado de descoberta ingerido de verdade), a decisao de **nao** renderizar `Listas`/`Entrar`/`Onde assistir` no header, e a pureza de render (zero API externa, zero Gemini — confirmada em todos os arquivos lidos e travada por `tests/governance/no-render-external-api.test.ts` e `web-render-layering.test.ts`).

**O que e PLACEHOLDER:** ranking `#N`, chips de plataforma, ticker de episodios, e as 12 ancoras de descoberta do rodape. **Tres dessas quatro superficies renderizam em producao.**

**O que e NAO IMPLEMENTADO:** busca (em qualquer forma), filtros, ordenacao, generos (nem tabela), trending, populares, lancamentos, recomendacoes, listas editoriais, paginacao, e todo o SEO programatico de descoberta.

**O que precisa virar produto, em ordem de dependencia:**
1. Remover/gatear os placeholders de descoberta (ticker, chips, rank, rodape) — **antes** de qualquer indexacao publica.
2. Consertar os 2 testes vermelhos e fortalecer o guard.
3. Paginacao real (bloqueia catalogo > 24 por vertical, ja alcancavel hoje).
4. `take`/`orderBy` no SQL + ISR nas listagens e no hub.
5. Busca full-text Postgres em rota `noindex`.
6. Tabela `genres` + `entity_genres` (tarefa aprovada de banco).
7. Separar `evaluateListingIndexability` de `evaluateIndexability` antes de construir qualquer pagina facetada.
8. So entao: paginas de genero/plataforma indexaveis, cada uma com >= 2 blocos de valor **proprios** (introducao editorial + FAQ, por exemplo), nunca com grade de posters contando como valor.

**NAO FOI POSSIVEL CONFIRMAR:** o comportamento em runtime das paginas contra um PostgreSQL populado (nao executei servidor nem banco, conforme as regras da auditoria). Todas as afirmacoes acima derivam de leitura estatica do codigo, do schema Prisma, das migrations e de uma unica execucao de `vitest` sobre `tests/web/public-navigation.test.ts`. Em particular, **nao verifiquei empiricamente** quantos filmes existem hoje no banco de producao do EasyPanel — a afirmacao de que o cap de 24 e alcancavel deriva de `MOVIE_IDS.length = 10` + `UPCOMING_IMPORT_CAP = 20` no script de ingestao, nao de uma contagem real.


---

## Parte 20 — SEO programatico e paginas evergreen

Esta secao audita a fundacao de SEO do Screen: motor puro de indexabilidade
(`@screena/seo`), gate anti-thin, slugs/canonical, metadata das rotas, JSON-LD,
sitemap, robots e as tabelas de decisao. O veredito curto: **a fundacao de SEO
programatico existe e e de qualidade acima da media** (funcoes puras, testadas,
render sem IO externo), mas ela esta **calibrada para NAO indexar quase nada
hoje** — porque a maioria dos titulos ingeridos do TMDB nao tem os >= 2 blocos de
valor exigidos — e carrega **um RISCO P0 de dominio hardcoded** que **BLOQUEIA
PRODUCAO** enquanto o site rodar num dominio temporario (EasyPanel).

---

### 20.1 Resposta direta as perguntas centrais

| Pergunta | Resposta |
| --- | --- |
| O Screen ja tem base para SEO programatico? | **REAL (fundacao).** Motor de indexabilidade puro e testado, gate anti-thin aplicado por rota, canonical autorreferente, JSON-LD por tipo, sitemap gerado do PostgreSQL com os mesmos gates das paginas, breadcrumbs em todas as telas. E uma base solida — o que falta e volume de conteudo e wiring de infra (env de dominio, persistencia de decisoes). |
| Quais paginas PODEM indexar HOJE? | Praticamente **so listagens/portais** quando ha volume minimo (home, `/pt/filmes/`, `/pt/series/`, `/pt/pessoas/`, `/pt/noticias/`, `/pt/explorar/`) e **detalhes que tenham >= 2 content_blocks revisados** (`human_reviewed`/`published`). Como so o seed demo e o Entity Writer geram blocos, **os titulos ingeridos do TMDB ficam `noindex`** (0 blocos). |
| Quais NAO devem indexar? | Todo detalhe de filme/serie/pessoa **sem >= 2 blocos revisados** (o caso da esmagadora maioria pos-ingestao TMDB); qualquer idioma != pt-BR/pt (nasce `draft`); noticias sem corpo suficiente ou `index_status != index`. |
| O que falta para escalar? | (1) **Tornar `SITE_URL` configuravel por env** (P0). (2) Gerar/revisar blocos editoriais em volume (o gargalo real e conteudo, nao codigo). (3) **Persistir/ler `page_indexability_decisions`** (hoje a decisao e recomputada por request, a tabela nunca e escrita). (4) Guard de ambiente no `robots.ts` para dominio nao-producao. (5) Sitemap-index segmentado por idioma quando en/es abrirem. (6) hreflang reciproco quando houver 2+ idiomas publicados. |

---

### 20.2 RISCO P0 — `SITE_URL` hardcoded (BLOQUEIA PRODUCAO)

**RISCO** + **BLOQUEIA PRODUCAO.**

`apps/web/src/lib/site.ts:9` fixa o dominio canonico em codigo:

```
export const SITE_URL = "https://thescreen.media";
```

Essa constante e a **unica** fonte da base de URL para TUDO que importa em SEO:

| Consumidor | Arquivo:linha | Efeito |
| --- | --- | --- |
| `metadataBase` global (OG/Twitter/canonical) | `apps/web/app/layout.tsx:21` | `new URL(SITE_URL)` |
| Canonical do filme | `apps/web/src/lib/site.ts:38-40` (`movieCanonicalUrl`) | `alternates.canonical` em `filmes/[slug]/page.tsx:68` |
| Canonical serie/pessoa/noticia | `series-page.ts:48`, `person-page.ts:45`, `news-pages.ts:56` | canonical autorreferente absoluto |
| Canonical de listagens | `entity-indexes.ts:134,180,213`; `news-pages.ts:106` | canonical das listas |
| `sitemap.xml` (URLs + link do sitemap no robots) | `sitemap-presenter.ts` via `canonicalPublicUrl` (`site.ts:73`); `robots.ts:28` | todo o sitemap aponta para thescreen.media |
| BreadcrumbList / ItemList JSON-LD | `filmes/[slug]/page.tsx:106-113`, `entity-index.tsx:52,71`, etc. | `item`/`url` absolutos |

A variavel de ambiente que **deveria** parametrizar isso, `THE_SCREEN_PUBLIC_SITE_URL`,
**existe apenas na documentacao e nunca e lida pelo codigo**:
`docs/CLOUDPANEL_DEPLOY.md:351,560,578` e `THE_SCREEN.md:781` a descrevem como "URL
canonica publica (usada em canonicals, sitemap, OG)", mas **nenhum** `process.env`
a consome (grep confirma: so aparece em docs). O teste `tests/web/site-urls.test.ts:40`
inclusive **trava** `SITE_URL === "https://thescreen.media"`, cristalizando o valor.

**Consequencia operacional (dominio temporario EasyPanel):** quando o site sobe
num host temporario (ex.: `screen.up.railway.app`/`*.easypanel.host`/IP), o HTML
servido continua declarando `rel="canonical"` e `og:url` para `https://thescreen.media`,
e o `sitemap.xml` lista URLs desse dominio de producao. Combinado com o
`robots.ts` que faz `allow: "/"` **sem guard de ambiente** (ver 20.8), o dominio
temporario fica **rastreavel e indexavel**, servindo conteudo que aponta canonical
para um dominio que ainda nao esta no ar — cenario classico de:

- indexacao do dominio temporario (conteudo duplicado / vazamento de staging);
- sinais de canonical cruzado e inconsistente para o Googlebot;
- risco de o dominio temporario "queimar" antes do lancamento real.

**PROXIMO PASSO (P0, ordem):**
1. Trocar `SITE_URL` por leitura de env server-side com fallback seguro, ex.
   `const SITE_URL = process.env.THE_SCREEN_PUBLIC_SITE_URL ?? "https://thescreen.media"`
   em `apps/web/src/lib/site.ts:9` (ajustar `tests/web/site-urls.test.ts:40` para
   validar formato, nao o literal fixo).
2. No `robots.ts`, adicionar guard: se o host efetivo != dominio canonico de
   producao (ou se uma env `SCREEN_ALLOW_INDEXING` nao estiver ligada), emitir
   `Disallow: /` + `X-Robots-Tag: noindex` para o ambiente inteiro (ver 20.8).
3. Enquanto (1) e (2) nao forem feitos, tratar qualquer deploy fora de
   `thescreen.media` como **nao indexavel por design** e nao submeter sitemap ao
   Search Console.

---

### 20.3 Motor de indexabilidade (`@screena/seo`) — REAL

O nucleo puro esta em `packages/seo/src/`:

| Arquivo | Papel | Status |
| --- | --- | --- |
| `indexability.ts` | `evaluateIndexability()` — precedencia blocked > draft > index > noindex | **REAL**, puro/determinista |
| `value-blocks.ts` | `VALUE_BLOCK_TYPES` (15 tipos) + `countValueBlocks()` (distinto, dedup) | **REAL** — mas ver 20.6 (nao e usado na pratica) |
| `language-index-guard.ts` | `assertIndexDecisionForLanguage()` — trava `index` para idioma != default sem revisao | **REAL** (guard de escrita), mas ver 20.9 (nao ha escritor) |
| `index.ts` | reexporta tudo via `@screena/seo` | **REAL** |

`evaluateIndexability` (`indexability.ts:98-166`) aplica exatamente a precedencia
documentada em `docs/SEO_PROGRAMMATIC.md` e `.claude/rules/seo.md`:

1. algum rating com `licenseDisplayAllowed=false` -> `blocked` (`:105-113`, invariante 6);
2. idioma fora de `{"pt-BR","pt"}` -> `draft` (`:116-123`, invariante 7);
3. structured data confiavel **e** `valueBlocksCount >= 2` **e** `thinContentScore <= 0.5` **e** `reviewStatusOk` -> `index` (`:131-139`, invariante 5);
4. senao -> `noindex` com motivo do requisito faltante (`:142-165`).

`THIN_THRESHOLD = 0.5` (`indexability.ts:21`) e `MIN_VALUE_BLOCKS = 2`
(`indexability.ts:79`). Cobertura de governanca em `tests/governance/indexability.test.ts`
(4 casos: 1 bloco -> noindex; 2 blocos completos -> index; rating bloqueado ->
blocked; `en` -> draft). Cobertura **correta porem minima** — nao exercita
`thinContentScore` acima do limiar isolado nem `reviewStatusOk=false` isolado
(**DEBITO** de teste, **NAO BLOQUEIA PRODUCAO**).

---

### 20.4 Gate anti-thin na PRATICA (o que indexa hoje)

Cada tipo de pagina tem um evaluator fino que **delega** ao motor puro, fixando o
contexto da fase atual (pt-BR, sem ratings/streaming exibidos):

| Rota | Evaluator | Regra pratica | Arquivo:linha |
| --- | --- | --- | --- |
| Filme detalhe | `evaluateMovieIndexability` | `index` sse `renderableBlockCount >= 2` | `movie-indexability.ts:50-62` |
| Serie detalhe | `evaluateSeriesIndexability` | idem | `series-presenter.ts:286` |
| Pessoa detalhe | `evaluatePersonIndexability` | idem | `person-presenter.ts:355` |
| Noticia artigo | `evaluateArticleIndexability` | corpo >= 200 chars **e** `index_status='index'` | `news-presenter.ts:398-417` |
| Listagem entidade | `evaluateEntityIndexIndexability` | >= N itens validos | `entity-index-presenter` (via `sitemap-presenter.ts:246-256`) |
| Listagem noticias | `evaluateNewsIndexIndexability` | `>= MIN_NEWS_INDEX_ITEMS (3)` publicaveis | `news-presenter.ts:30,380-392` |
| Home / Explorar | `evaluatePortalIndexability` | `>= 2` secoes populadas | `portal-presenter` (via `sitemap-presenter.ts:265-279`) |

**Ponto central para "o que indexa hoje":** o gate de detalhe conta
`renderableBlockCount`, e esse numero e **`blocks.length`** dos content_blocks ja
filtrados por `review_status` publicavel e deduplicados por `block_type`:
`movie-presenter.ts:234` (`renderableBlockCount: blocks.length`), com selecao em
`selectRenderableBlocks` (`movie-presenter.ts:201-214`) — apenas
`human_reviewed`/`published` (`movie-indexability.ts:19`), no maximo um por
`block_type`. O mesmo padrao em series/person presenters (`:348`, `:390`).

Logo, **para um filme/serie/pessoa indexar HOJE e preciso ter >= 2 content_blocks
distintos com `review_status` em `human_reviewed` ou `published`.** Combinando com
os fatos ja confirmados na auditoria:

- A ingestao TMDB **nao gera content_blocks** — ela popula catalogo (titulo,
  poster, elenco), nao a camada editorial. Titulos ingeridos entram com
  `renderableBlockCount = 0` -> `noindex`.
- O slice ativo do Entity Writer cobre `editorial_intro` + `cast_intro` em pt-BR,
  e todo bloco **nasce em `draft`/`ai_generated`** (nao publicavel) ate revisao
  humana. Sem revisao, **nao contam**.

**Conclusao:** **PARCIAL.** O gate funciona e esta corretamente restritivo — mas a
consequencia e que **a base real ingerida do TMDB e majoritariamente `noindex`**.
Isso e *governanca correta* (invariante 5), nao bug. As unicas paginas de detalhe
indexaveis hoje sao aquelas em que 2+ blocos foram gerados **e revisados** (ex.:
entidades do seed demo, se seus blocos estiverem `published`). O SEO programatico
em escala so "liga" quando a maquina de geracao + revisao de blocos rodar em
volume.

---

### 20.5 Slugs e canonical

**Slug (model `Slug`, `schema.prisma:438-455`):** **REAL**, multilingue por
construcao.

- Colunas: `entityType`, `entityId`, `languageCode`, `slug`, `isCanonical`
  (`:440-444`). Slug e **por idioma** (coluna `languageCode`), conforme
  `.claude/rules/i18n.md` §3.
- Unicidade: `@@unique([entityType, languageCode, slug])` (`:451`) — o mesmo texto
  de slug pode coexistir entre `entityType` diferentes (um filme e uma serie
  "duna"), resolvido pelo segmento de URL (`/pt/filmes/` vs `/pt/series/`).
- Canonico unico por entidade/idioma: comentario em `:450` afirma "unique parcial
  (1 canonico por entidade/idioma WHERE is_canonical) via SQL bruto". **NAO FOI
  POSSIVEL CONFIRMAR** que essa constraint parcial existe de fato na migration
  (nao inspecionei o `migration.sql`); se ausente, dois `is_canonical=true` para a
  mesma entidade seriam possiveis no nivel de banco (**DEBITO** a verificar,
  **NAO BLOQUEIA PRODUCAO** pois o codigo le com `findFirst`).
- Leitura no render: `movie-page.ts:69-72` resolve `entityId` pelo slug requisitado
  e `:89-97` busca o **slug canonico** (`isCanonical: true`) separadamente; o
  canonical usa **sempre o slug canonico**, nao o requisitado (`:148-154`).

**Canonical:** **REAL** e **autorreferente**, com uma unica ressalva de base (P0,
20.2).

- Detalhe: `alternates: { canonical: canonicalUrl }` onde
  `canonicalUrl = movieCanonicalUrl(canonicalSlug)` — absoluto, barra final,
  dominio canonico (`filmes/[slug]/page.tsx:68`, `movie-page.ts:154`,
  `site.ts:38-40`). Acesso por slug nao-canonico ainda emite canonical -> slug
  canonico (dedup correto).
- `canonicalPublicUrl` (`site.ts:67-74`) valida path, rejeita URL externa/`//host`,
  colapsa barras duplas, forca barra final. Robusto.
- Home usa `canonicalPublicUrl(HOME_PATH)` (`pt/page.tsx:122`).
- Base sempre `SITE_URL` -> herdada do P0.

---

### 20.6 `countValueBlocks` vs pratica — DEBITO conceitual

Existe uma **divergencia entre o canon documentado e o codigo de render** que vale
registrar:

- O pacote `@screena/seo` define `VALUE_BLOCK_TYPES` (os 15 blocos de valor
  canonicos) e `countValueBlocks()` que **so conta tipos reconhecidos**
  (`value-blocks.ts:21-74`).
- **Porem os presenters do app NAO usam `countValueBlocks`.** Eles alimentam
  `valueBlocksCount` com `blocks.length` (contagem de content_blocks revisados
  distintos por `block_type`), sem passar pela allowlist de 15 tipos de valor.
  Grep confirma: `countValueBlocks`/`VALUE_BLOCK_TYPES` **nao aparecem** em
  `apps/web/src/lib`.

Na pratica isso e **quase** inocuo porque os `block_type` validos ja sao um enum
controlado no schema/Entity Writer e sao majoritariamente "de valor". Mas o efeito
e que a definicao autoritativa de "bloco de valor" (a lista dos 15) **nao e o gate
executado**; o gate real e "2 content_blocks revisados de tipos distintos".
**DEBITO** (alinhar `packages/seo` como fonte executavel do que conta como valor,
ou documentar que o filtro real e o enum de `block_type`). **NAO BLOQUEIA
PRODUCAO.**

---

### 20.7 Metadata por rota (generateMetadata)

**REAL** e abrangente. Todas as 10 rotas publicas pt-BR tem `generateMetadata`:

| Rota | `generateMetadata`? | robots dinamico? | canonical? | Arquivo |
| --- | --- | --- | --- | --- |
| Home `/pt` | Sim (`:113`) | Sim (portal) | `canonicalPublicUrl(HOME_PATH)` | `pt/page.tsx` |
| `/pt/filmes` | Sim | Sim | Sim | `pt/filmes/page.tsx` |
| `/pt/filmes/[slug]` | Sim (`:42`) | Sim (`:65`) | Sim (`:68`) | `pt/filmes/[slug]/page.tsx` |
| `/pt/series` | Sim | Sim | Sim | `pt/series/page.tsx` |
| `/pt/series/[slug]` | Sim | Sim | Sim | `pt/series/[slug]/page.tsx` |
| `/pt/pessoas` | Sim | Sim | Sim | `pt/pessoas/page.tsx` |
| `/pt/pessoas/[slug]` | Sim | Sim | Sim | `pt/pessoas/[slug]/page.tsx` |
| `/pt/noticias` | Sim | Sim | Sim | `pt/noticias/page.tsx` |
| `/pt/noticias/[slug]` | Sim | Sim | Sim | `pt/noticias/[slug]/page.tsx` |
| `/pt/explorar` | Sim | Sim | Sim | `pt/explorar/page.tsx` |

Padrao consistente: cada `generateMetadata` chama a mesma camada server-only
memoizada (`getMoviePageData` etc.), le a decisao de indexabilidade e emite
`robots: { index: shouldIndex, follow }` + `alternates.canonical`
(ex.: `filmes/[slug]/page.tsx:57-74`). Titulo/descricao **nunca inventados**:
`description` so e setada quando `metaDescription` existe no banco
(`filmes/[slug]/page.tsx:71-73`). 404 emite `robots noindex` (`:50-54`).

**Rotas SEM `generateMetadata`:** as rotas legadas **sem prefixo de idioma**
(`apps/web/app/filmes/page.tsx`, `apps/web/app/series/page.tsx`) e a rota de
preview `apps/web/app/dev/movie-page-preview/page.tsx`. As `/filmes` e `/series`
raiz aparentam ser stubs/redirect (grep so achou `SITE_URL`/canonical nelas); a
`/dev/*` e bloqueada no robots. **NAO FOI POSSIVEL CONFIRMAR** o comportamento
exato das rotas raiz sem le-las, mas nao ha rota publica pt-BR de conteudo sem
metadata. **NAO BLOQUEIA PRODUCAO.**

---

### 20.8 JSON-LD por tipo

**REAL** e correto por tipo, com a proibicao de `AggregateRating` respeitada.

| Pagina | Schema principal | BreadcrumbList | Extra | Arquivo:linha |
| --- | --- | --- | --- | --- |
| Filme | `Movie` | Sim | — | `filmes/[slug]/page.tsx:102-126,287-294` |
| Serie | `TVSeries` | Sim | — | `series/[slug]/page.tsx:89-...` |
| Pessoa | `Person` | Sim | — | `pessoas/[slug]/page.tsx:94-99` |
| Noticia | `NewsArticle` | Sim | `image` so se hero local (`:104`) | `noticias/[slug]/page.tsx:84-104` |
| Listagem entidade | `CollectionPage` + `ItemList` | Sim | — | `_components/entity-index.tsx:50-69` |
| Listagem noticias | `ItemList` | Sim | — | `noticias/page.tsx:49-68` |
| Explorar | (breadcrumb + coleção) | Sim | — | `explorar/page.tsx:152` |

Pontos fortes:

- **Sem `AggregateRating` em lugar nenhum** — confirmado por comentario explicito
  no filme (`filmes/[slug]/page.tsx:117-118`: "SEM AggregateRating; jamais fingir
  nota propria"). Coerente com fato ja confirmado na auditoria e com invariante de
  ratings. O `screen_score` (nota editorial propria) **nao** e emitido como
  `AggregateRating` — correto.
- **Sem `FAQPage`** — nao ha bloco de FAQ ativo, entao nao se emite FAQ falso
  (correto por `docs/SEO_PROGRAMMATIC.md` §6: "FAQPage so se FAQ visivel").
- JSON-LD so inclui campos que existem no payload (`Movie.datePublished`/
  `description` condicionais, `filmes/[slug]/page.tsx:125-126`).
- Diferenciacao filme/serie por 5 sinais (label + badge + breadcrumb + schema +
  URL), travada por `tests/governance/vertical.test.ts` — invariante 11.

Lacunas:

- **Home nao emite `WebSite`/`Organization` JSON-LD** (grep de `ld+json` nao inclui
  `pt/page.tsx`). O layout tem apenas OG basico (`layout.tsx:20-27`), sem
  `Organization`, sem sitelinks searchbox. **DEBITO** de SEO (perde rich result de
  marca). **NAO BLOQUEIA PRODUCAO.**
- Nenhuma `og:image` propria (`layout.tsx:23-24` documenta a ausencia
  deliberada). Cartoes sociais ficam sem imagem. **DEBITO**, **NAO BLOQUEIA
  PRODUCAO.**

---

### 20.9 Sitemap

**PARCIAL** (funcional para pt-BR; nao segmentado ainda).

Rota ativa: `apps/web/app/sitemap.ts` — `export const dynamic = "force-dynamic"`
(`:20`), delega para `getSitemapEntries()` (`src/server/seo/sitemap-entries.ts`)
que le **so PostgreSQL** via Prisma e monta pelo presenter puro
`src/lib/sitemap-presenter.ts`.

Qualidades:

- **So lista `index`.** Cada candidato passa pelos **mesmos evaluators** das
  paginas (`sitemap-presenter.ts:294-324`): filme/serie/pessoa via
  `evaluate*Indexability({ renderableBlockCount })`, noticia via
  `newsDetailEntry` (`:201-221`, exige publicavel + `index_status='index'` + corpo
  suficiente), listagens/portais via `evaluateEntityIndexIndexability`/
  `evaluatePortalIndexability` (`:244-279`). Sitemap e meta robots **nao
  divergem** — invariante de coerencia respeitada.
- Dedup por URL (`:327-332`), `lastModified` so quando ha `updatedAt` confiavel
  (`:174`), prioridades conservadoras (`:114-121`).
- Fallback sem banco: `buildStaticSitemapEntries()` devolve so rotas estaticas com
  log explicito (`sitemap-entries.ts:248-253`) — nao derruba o sitemap num outage.

Limitacoes:

- **Nao e segmentado por idioma.** `LANGUAGE_CODE = "pt-BR"` fixo
  (`sitemap-entries.ts:31`); so ha `/sitemap.xml` unico, sem `sitemap-index.xml`
  nem `sitemap-pt.xml`/`-en`/`-es`. Correto para o MVP (so pt-BR publica), mas o
  desenho de "um sitemap por idioma + index" (`.claude/rules/seo.md` §5,
  `docs/SEO_PROGRAMMATIC.md` §7) ainda **NAO IMPLEMENTADO**. **NAO BLOQUEIA
  PRODUCAO** enquanto so pt-BR existir.
- Herda o **P0 de dominio** (todas as URLs saem de `SITE_URL`).
- Stub legado: `seo/sitemap.ts` (raiz) e um **PLACEHOLDER** — `buildSitemap()`
  retorna `[]` com `TODO(Fase 8)` (`seo/sitemap.ts:87-91`). **Nao esta wired** ao
  App Router (o Next usa `apps/web/app/sitemap.ts`); e documentacao/contrato
  antigo. Nao confundir com o sitemap real.

---

### 20.10 robots.txt — RISCO de ambiente

Rota ativa: `apps/web/app/robots.ts`. **REAL** mas **sem guard de ambiente**.

```
allow: "/",
disallow: ["/api/", "/dev/", "/admin/"],
sitemap: `${SITE_URL}/sitemap.xml`   // robots.ts:19-29
```

- Estrategia correta em principio: crawl liberado; controle fino de indexacao via
  `<meta robots>` por pagina (nao por `Disallow`, que esconderia mas manteria a URL
  no indice) — documentado em `robots.ts:8-17`.
- Bloqueia `/api/`, `/dev/` (preview interno) e `/admin/`. `/_next/` liberado
  (necessario para render). Bom.
- **Confirmado: NAO ha guard de ambiente.** O `robots()` e uma funcao pura que
  sempre retorna `allow: "/"`, independentemente de host/env. Nao le
  `NODE_ENV`, nem host, nem flag de "producao". **RISCO** — combinado com o P0 do
  `SITE_URL`, um deploy em dominio temporario fica **allow-all + indexavel**,
  servindo canonical/sitemap de producao.
- **PROXIMO PASSO:** guard por env — se o deploy nao for o dominio canonico de
  producao, retornar `disallow: "/"` (e idealmente header `X-Robots-Tag: noindex`
  no middleware). Emparelhar com o fix de `SITE_URL` (20.2).

---

### 20.11 `page_indexability_decisions` — tabela existe, runtime NAO usa

**NAO IMPLEMENTADO** como fluxo de runtime (a decisao e efemera).

- O model `PageIndexabilityDecision` existe no schema (`schema.prisma:654-680`,
  mapeado para `page_indexability_decisions`).
- **Porem o app nunca a escreve nem le.** Grep confirma que
  `page_indexability_decisions`/`PageIndexabilityDecision` so aparece em: schema,
  migration, docs, testes e no **stub** `seo/sitemap.ts` (que a cita como contrato
  mas nao executa). **Nenhum** `apps/web/src/server/**` faz `prisma.pageIndexabilityDecision.*`.
- Na pratica, a indexabilidade e **recomputada a cada request** dentro de
  `generateMetadata`/render (ex.: `movie-page.ts:144-146` chama
  `evaluateMovieIndexability` on-the-fly) e no `sitemap.ts` (recomputa para cada
  candidato). Isso e **funcionalmente correto** (decisao deterministica a partir do
  banco), mas significa que o desenho documentado — "decisao registrada em
  `page_indexability_decisions`, sitemap e meta lidos da mesma linha persistida"
  (`docs/SEO_PROGRAMMATIC.md` §4/§7) — **ainda nao existe**.
- Implicacoes: (a) nenhum historico/auditoria de decisao de indexacao;
  (b) `stale` (que so nasce de invalidacao registrada) **nunca e produzido** —
  `evaluateIndexability` so retorna `index|noindex|draft|blocked`
  (`indexability.ts:59`), e nao ha job que promova algo a `stale`; (c) "indexacao
  em massa exige revisao humana" nao tem trilha persistida. **DEBITO**, **NAO
  BLOQUEIA PRODUCAO** (a coerencia sitemap/meta e garantida por recomputo com os
  mesmos evaluators).

---

### 20.12 hreflang, i18n e trava de idioma

- **hreflang: NAO IMPLEMENTADO (corretamente).** Nenhuma rota emite
  `alternates.languages`/hreflang (grep so acha `hreflang` em `globals.css`/README,
  nao em rotas). Como so pt-BR publica, ausencia de cluster hreflang e o
  comportamento certo (`.claude/rules/i18n.md` §5: "so entra no cluster a versao
  published+index+revisada"). Quando en/es abrirem, faltara implementar o cluster
  reciproco + `x-default`. **NAO BLOQUEIA PRODUCAO.**
- **Trava de idioma:** `language-index-guard.ts` (`assertIndexDecisionForLanguage`)
  impede gravar `decision='index'` para idioma nao-default sem revisao. Existe e e
  testada (`tests/governance/index-language-guard.test.ts`), **mas** como nao ha
  escritor de `page_indexability_decisions` (20.11), essa trava **nao esta no
  caminho de execucao** hoje — e uma salvaguarda para quando o job de persistencia
  existir. **PARCIAL.**
- Sem redirect automatico de idioma: nao ha rota `/en`/`/es` publica; so `/pt/*`.
  Coerente com invariante 7 e i18n §6 (sem fallback silencioso). O `middleware.ts`
  aparece no grep de `canonical` — **NAO FOI POSSIVEL CONFIRMAR** seu conteudo
  nesta secao; recomenda-se verificar que ele nao faca redirect de idioma por
  Accept-Language em URL indexavel (regra seo §8).

---

### 20.13 Internal linking e breadcrumbs

**REAL.**

- **Breadcrumbs:** `BreadcrumbList` JSON-LD **e** `<nav class="breadcrumb">` visual
  em todas as telas de detalhe e listagem (ex.: filme `filmes/[slug]/page.tsx:102-141`;
  entity-index `entity-index.tsx:50-53`; noticias `noticias/[slug]/page.tsx:84-85`
  com 3 niveis). Cobre o requisito "BreadcrumbList em todas as paginas principais".
- **Internal linking:** listagens -> detalhes (cards); detalhes -> pessoas (CastStrip
  em `filmes/[slug]/page.tsx:263-266`); detalhes -> noticias relacionadas
  (`RelatedNewsSection`, `:277`); noticias -> entidades relacionadas (movie/tv/person
  via `buildNewsRelated`, `news-presenter.ts:328-339`); home/explorar -> secoes. Ha
  malha interna suficiente para descoberta de crawler. O que limita a malha nao e
  codigo, e volume de conteudo indexavel (a maioria dos detalhes esta `noindex`, o
  que reduz o PageRank interno util ate os blocos serem gerados/revisados).

---

### 20.14 Sintese — status por dimensao

| Dimensao | Status | Nota |
| --- | --- | --- |
| Motor de indexabilidade puro (`@screena/seo`) | **REAL** | testado, determinista |
| Gate anti-thin aplicado por rota | **REAL** | corretamente restritivo |
| Conteudo indexavel real (detalhes TMDB) | **PARCIAL** | ~0 hoje: ingestao nao gera blocos; blocos nascem draft |
| Slugs por idioma / unicidade | **REAL** | canonico-unico via SQL bruto **NAO CONFIRMADO** |
| Canonical autorreferente | **REAL** | mas base = `SITE_URL` hardcoded |
| `generateMetadata` por rota | **REAL** | 10/10 rotas pt-BR |
| JSON-LD por tipo (Movie/TVSeries/Person/NewsArticle/Breadcrumb/ItemList) | **REAL** | sem AggregateRating/FAQ falso |
| `WebSite`/`Organization` na home | **NAO IMPLEMENTADO** | **DEBITO** |
| Sitemap (so index, do PostgreSQL) | **PARCIAL** | funcional; nao segmentado por idioma; stub raiz e PLACEHOLDER |
| robots.txt | **REAL** sem guard de env | **RISCO** em dominio temporario |
| `page_indexability_decisions` runtime | **NAO IMPLEMENTADO** | decisao recomputada, sem persistencia; `stale` nunca gerado |
| `countValueBlocks` como gate real | **DEBITO** | app usa `blocks.length`, nao a allowlist de 15 |
| hreflang | **NAO IMPLEMENTADO** | correto no MVP mono-idioma |
| Breadcrumbs / internal linking | **REAL** | malha ok; limitada por volume noindex |
| `SITE_URL` configuravel por env | **NAO IMPLEMENTADO** | **RISCO** + **BLOQUEIA PRODUCAO** (P0) |

**PROXIMO PASSO consolidado (prioridade):**
1. **[BLOQUEIA PRODUCAO]** `SITE_URL` por env (`site.ts:9`) + guard de indexacao no
   `robots.ts` para dominio nao-canonico.
2. Rodar geracao + **revisao humana** de >= 2 blocos por entidade prioritaria para
   destravar indexacao real (o gargalo e conteudo).
3. Persistir e ler `page_indexability_decisions` (auditoria, `stale`, indexacao em
   massa com trilha).
4. Adicionar `Organization`/`WebSite` JSON-LD na home; og:image de marca.
5. Preparar sitemap-index segmentado + hreflang reciproco antes de abrir en/es.
6. Alinhar `packages/seo` (`countValueBlocks`) como gate executavel real, ou
   documentar que o gate e o enum de `block_type`.


---

## Parte 21 — Admin, CMS e operacao editorial

Esta secao audita `apps/admin/**` (painel interno `@screena/admin`) e
`services/entity-writer/**` (pipeline offline de geracao editorial). A pergunta
central e operacional: **um editor humano consegue tocar o produto pelo admin
hoje** — dar nota, publicar noticia, controlar indexacao, gerar bloco? A resposta
curta e: **PARCIAL para revisao de estado editorial; NAO IMPLEMENTADO como CMS de
autoria**. O admin e um *console de revisao/status somente-leitura por padrao*
sobre dados que nascem em outro lugar (seeds e ingestao), com uma unica e estreita
superficie de escrita gateada por flag. Nao existe tela para criar entidade,
escrever noticia, dar Screen Score ou gravar decisao de indexacao.

---

### 21.1 Existe admin? Sim — e real, mas de leitura

O app existe de verdade em `apps/admin` (Next.js App Router, `@screena/admin`),
com 11 rotas, camada `src/lib` pura testada, camada `src/server` server-only e
middleware de acesso. Todas as paginas sao `export const dynamic = "force-dynamic"`
(nunca tocam o banco no `next build`) e leem **apenas PostgreSQL local** — zero API
externa, coerente com as invariantes 3/4. Marcador global: **REAL** (como painel de
diagnostico/revisao), **NAO IMPLEMENTADO** (como CMS de autoria).

---

### 21.2 Seguranca de acesso — Basic Auth por ENV, fail-closed em producao **REAL**

A protecao vive em `apps/admin/middleware.ts` (adaptador fino para o Edge runtime)
sobre o modulo puro `apps/admin/src/lib/access-protection.ts` (554 linhas, sem
`next/*`, so globais Web). O matcher cobre **todas** as rotas exceto assets do Next
e favicon (`apps/admin/middleware.ts:59`).

| Propriedade | Estado | Evidencia |
| --- | --- | --- |
| HTTP Basic Auth por ENV | **REAL** | `evaluateAdminAccess` `access-protection.ts:369` |
| Fail-closed em production-like | **REAL** | `isAdminProtectionRequired` `access-protection.ts:211`; production-like exige protecao mesmo com flag ausente/`"false"` |
| Detecta ambiente por `NODE_ENV`/`VERCEL_ENV` | **REAL** | `getAdminRuntimeKind` `access-protection.ts:170` |
| Sem credenciais em prod -> nega (401) | **REAL** | reason `missing_credentials` `access-protection.ts:376` |
| Comparacao constant-time (nao vaza qual campo falhou) | **REAL** | `constantTimeEquals` `access-protection.ts:310` |
| Segredos so em ENV, nunca logados/redigidos | **REAL** | `redactAdminAccessConfigForDisplay` `access-protection.ts:531` |
| Sessao / cookie / login / JWT / OAuth / usuario persistido | **NAO IMPLEMENTADO** (por design) | comentario `middleware.ts:16-19`; nao ha model User/Session (confirmado) |

Variaveis de ambiente (nomes canonicos, `ADMIN_ACCESS_ENV_KEYS` `access-protection.ts:52`):

- `ADMIN_PROTECTION_ENABLED` — liga a protecao explicitamente **so** quando for
  exatamente `"true"` (`isExplicitAdminProtectionEnabled` `:199`). Qualquer outro
  valor nao liga a protecao explicita — mas em producao **nao abre** o admin.
- `ADMIN_BASIC_AUTH_USER` / `ADMIN_BASIC_AUTH_PASSWORD` — o par de credenciais.
- `NODE_ENV` / `VERCEL_ENV` — sinais de deteccao production-like.

**Avaliacao:** a protecao de acesso e a parte **mais madura e correta** do admin.
Ela e minima por design (portao Basic Auth stateless, sem autenticacao de usuario
real), mas o comportamento fail-closed por ambiente e solido e bem testado
(`tests/admin/access-protection.test.ts`, 22 KB). **NAO BLOQUEIA PRODUCAO** desde
que `ADMIN_BASIC_AUTH_USER`/`ADMIN_BASIC_AUTH_PASSWORD` estejam configuradas — se
faltarem em prod, o admin responde 401 (bloqueio seguro), nunca sobe aberto.
**RISCO** residual: Basic Auth unico compartilhado nao da rastreabilidade por
editor (quem mudou o status?); nenhum log de auditoria de acao editorial existe.

---

### 21.3 Read-only por padrao? Sim — com UMA superficie de escrita gateada

O admin e **read-only por padrao**. Existe exatamente **um** arquivo autorizado a
escrever no banco: `apps/admin/src/server/editorial-actions.ts` (`"use server"` na
linha 1). Tudo o mais e travado por uma bateria de testes de governanca em
`tests/admin/`:

- `no-server-writes.test.ts:31` — allowlist de `"use server"` = so `editorial-actions.ts`.
- `editorial-actions-guard.test.ts:33-49` — esse arquivo escreve **so** com `.update(`;
  proibido `.create(`, `.upsert(`, `.delete(`, `.createMany(`, `.updateMany(`,
  `.deleteMany(`, SQL bruto.
- `pages-no-write.test.ts`, `readonly-guard.test.ts`, `qa-no-write-regression.test.ts`,
  `content-qa-server-readonly.test.ts` — paginas/QA nunca viram canal de mutacao.

#### O que as Server Actions escrevem

| Server Action | Escreve | Campo | Guard |
| --- | --- | --- | --- |
| `updateArticleReviewStatus` `editorial-actions.ts:145` | `ArticleTranslation` | `reviewStatus` | flag + policy |
| `updateArticleIndexStatus` `editorial-actions.ts:151` | `ArticleTranslation` | `indexStatus` | flag + policy |
| `updateContentBlockReviewStatus` `editorial-actions.ts:157` | `ContentBlock` | `reviewStatus` | flag + policy |
| `runBulkArticleEditorialAction` `editorial-actions.ts:266` | `ArticleTranslation` x1..20 | `reviewStatus`\|`indexStatus` | loop `.update` (nunca `updateMany`) `:210` |
| `runBulkContentBlockEditorialAction` `editorial-actions.ts:276` | `ContentBlock` x1..20 | `reviewStatus` | loop `.update` `:244` |

Regras respeitadas (todas confirmadas no codigo):

- **Nunca carimba `publishedAt`** — o admin nao publica sozinho; so muda o estado
  de revisao/indexacao (`editorial-actions.ts:14-15`). Coerente com invariante 12.
- **So campo editorial** — titulo, slug, corpo/conteudo nunca sao tocados.
- **Um registro por `.update`** (mesmo em lote: loop item-a-item, teto 20).
- **Feedback sem vazamento** — redireciona com `?updated=<campo>`/`?error=<codigo>`;
  nunca payload cru nem stack trace (`redirectWithFeedback` `:75`).

#### A flag que liga a escrita

`ADMIN_EDITORIAL_ACTIONS_ENABLED` (`editorial-action-policy.ts:76`). **Dupla trava**:
(1) middleware exige Basic Auth em prod; (2) mesmo autenticado, a escrita so ocorre
se `ADMIN_EDITORIAL_ACTIONS_ENABLED === "true"` — validado no servidor
(`canRunEditorialAction`, `applyArticleAction` `:90`), nunca confiando no botao
desabilitado do cliente. Sem a flag, toda acao retorna `actions_disabled`.
Marcador: **REAL**, **PARCIAL** em escopo (so 3 campos de estado).

---

### 21.4 CONTRADICAO viva: teste untracked que quebra a escrita editorial **DEBITO** **RISCO**

O arquivo **novo e nao versionado** `tests/admin/no-write-endpoints.test.ts`
(untracked no `git status`) declara que o admin nao pode expor **nenhuma**
`"use server"` nem route handler de escrita, varrendo `apps/admin/app` **e**
`apps/admin/src` **sem allowlist** (`FORBIDDEN_PATTERNS` `no-write-endpoints.test.ts:20`;
`ADMIN_DIRS` `:13`). O padrao `/^\s*["']use server["'];?\s*$/m` casa exatamente com
`editorial-actions.ts:1`.

**Consequencia:** se rodado contra a arvore atual, esse teste **FALHA** — ele
contradiz diretamente o `no-server-writes.test.ts:31` (tracked), que **allowlista**
`editorial-actions.ts`. Ou seja, ha dois testes de governanca em conflito direto:

| Teste | Estado git | Veredito sobre `editorial-actions.ts` |
| --- | --- | --- |
| `tests/admin/no-server-writes.test.ts` | tracked | PERMITE (allowlist `:31`) |
| `tests/admin/no-write-endpoints.test.ts` | **untracked/novo** | **PROIBE** (sem allowlist) -> falharia |

Leitura provavel: o teste untracked sinaliza uma **intencao de reverter o admin
para 100% read-only** (remover as acoes editoriais 7A/7C), alinhada ao momento de
"trancar para producao" (mesmo working tree sujo do relatorio `THE_SCREEN.md`). Enquanto
os dois coexistirem, a suite de admin esta **internamente inconsistente**. **PROXIMO
PASSO:** decidir conscientemente (decisao humana) — ou (a) manter a escrita editorial
e **deletar** `no-write-endpoints.test.ts`, ou (b) reverter as Server Actions e
manter o teste. Hoje o repo afirma as duas coisas ao mesmo tempo.

---

### 21.5 Mapa de rotas do admin (uma linha por rota)

| Rota | Funcao | Status |
| --- | --- | --- |
| `/` `app/page.tsx` | Dashboard: contagens REAIS do PostgreSQL; links para filas | **REAL** read-only |
| `/articles` `app/articles/page.tsx` | Lista `article_translations` com filtros (links `<a>`, sem form) | **REAL** read-only |
| `/articles/[id]` `app/articles/[id]/page.tsx` | Detalhe + forms de escrita (`reviewStatus`/`indexStatus`) gateados pela flag | **PARCIAL** (escrita so com flag) |
| `/content-blocks` `app/content-blocks/page.tsx` | Lista `content_blocks` com filtros | **REAL** read-only |
| `/content-blocks/[id]` `app/content-blocks/[id]/page.tsx` | Detalhe + form de `reviewStatus` gateado pela flag | **PARCIAL** |
| `/health` `app/health/page.tsx` | Conectividade do banco + contagens; nunca imprime segredo | **REAL** read-only |
| `/qa` `app/qa/page.tsx` | QA editorial: score, severidade, criticos, visiveis-mas-noindex, blocks com problema, slugs dup | **REAL** read-only |
| `/review-queue` `app/review-queue/page.tsx` | Fila editorial com acoes inline gateadas pela flag | **PARCIAL** |
| `/security` `app/security/page.tsx` | Diagnostico da protecao de acesso (presenca de env, postura); nunca valor | **REAL** read-only |
| `/staging` `app/staging/page.tsx` | Checklist de prontidao de staging (ambiente, protecao, escrita, banco) | **REAL** read-only |
| `/workflow` `app/workflow/page.tsx` | Acoes editoriais em LOTE (1..20) gateadas pela flag | **PARCIAL** |

Nenhuma rota cria entidade, artigo, bloco ou nota. As rotas de "escrita" so mudam
`review_status`/`index_status` de registros **que ja existem**.

---

### 21.6 Existe CMS de verdade? **NAO IMPLEMENTADO**

Nao ha autoria pelo admin de coisa alguma:

- **Nenhuma tela cria** filme, serie, pessoa, artigo, content_block ou slug.
- **Nenhuma tela edita** titulo, corpo, sinopse, conteudo de bloco ou nota.
- O que o admin oferece e um **console de revisao de estado**: ver o que existe,
  filtrar, diagnosticar (QA) e — atras de flag — mudar `review_status`/`index_status`.

A autoria/ingestao de dados acontece **fora do admin**: em scripts de seed
(`apps/admin/scripts/public-demo-seed.ts`, `staging-seed.ts`) e na ingestao TMDB
(`services/ingestion`), alem do Entity Writer offline (CLI). O admin nunca cria o
dado; so revisa o estado dele. Isto e um **console editorial**, nao um CMS.

---

### 21.7 Entity Writer — pipeline offline REAL, sem orquestracao

`services/entity-writer` e uma implementacao **REAL e funcional** (offline, TS/Node
+ Prisma), com fakes em memoria e testes densos (`src/__tests__/*`, ~25 arquivos).

Fluxo (dirigido por ports injetaveis):

1. **Enqueue** — `enqueueOne`/`enqueueMissing` `runner/enqueue-jobs.ts`: monta
   payload controlado, calcula `payload_hash`, resolve `prompt_version`, decide via
   `planEnqueue` e cria job em `entity_writer_jobs`. NUNCA chama Gemini, NUNCA gera
   bloco, NUNCA publica (`enqueue-jobs.ts:8`). So `movie`/`tv`, so `pt-BR`
   (`ENQUEUE_SUPPORTED_ENTITY_TYPES`/`_LANGUAGES`).
2. **Run** — `processJobs`/`processOne` `runner/run-jobs.ts`: claim -> payload ->
   `runGeneration` (parse/validacao anti-alucinacao/decide-status) -> persiste
   `content_blocks` + `entity_writer_logs` -> finaliza job. Estados terminais de job:
   `completed`/`blocked`/`failed`. **NUNCA** produz `published`/`human_reviewed`
   (`run-jobs.ts:8`). Guarda de idioma pt-BR `:124`.
3. **Persistencia** — `content-block-store.ts` (adapter Prisma): estrategia
   archive+insert numa transacao — arquiva versoes de IA ativas do mesmo alvo
   (`updateMany` restrito a `sourceType:"ai"` + `reviewStatus in [ai_generated,
   needs_review]`, guarda defensiva `:47`) e insere a nova (`create` `:57`). Nunca
   apaga fisicamente; nunca grava `published`/`human_reviewed`.

Gemini: adapter real (`gemini/adapter.ts`, `createGeminiAdapterFromEnv`) **separado**
do render, com `FakeGeminiPort` para teste. Modo real exige `GEMINI_API_KEY`/
`GEMINI_MODEL` (`bin/run.ts:14`). `content-block-store.ts` e `bin/run.ts` sao
**EXCLUIDOS do typecheck** (comentarios `:1`).

**Lacuna operacional — PARCIAL:** o writer so roda por **CLI manual**
(`tsx services/entity-writer/bin/run.ts`). Nao ha scheduler, systemd, cron ou daemon
("NUNCA daemon/systemd/cron nesta fase", `bin/run.ts:6`). Nao ha gatilho pelo admin.
Ou seja, gerar blocos e uma operacao de terminal, nao um botao editorial.

---

### 21.8 content_blocks: gerados de verdade ou so contrato? **PARCIAL**

A capacidade de gerar existe e funciona (secao 21.7). Mas na pratica:

- **Todos os `content_blocks` que existem em qualquer banco populado sao
  hand-written pelos seeds**, com `sourceType: "human"`
  (`public-demo-seed.ts:210`, `staging-seed.ts:132`) — nao saem do Entity Writer.
- **Blocos com `sourceType:"ai"`** so nasceriam de um `bin/run.ts` real com
  `GEMINI_API_KEY`. NAO FOI POSSIVEL CONFIRMAR que qualquer execucao real de Gemini
  tenha rodado; nao ha artefato/seed de bloco `ai` no repo.
- **Titulos ingeridos do TMDB (EasyPanel) ficam sem content_blocks** — a ingestao
  nao enfileira nem roda o writer. Combinado com o fato ja confirmado de que a
  ingestao tambem nao escreve `screen_score`, um titulo real ingerido chega
  **sem nota e sem bloco de valor** -> reprova o gate anti-thin -> `noindex`.

Conclusao: o Entity Writer e **infraestrutura pronta esperando dados e um operador**,
nao um gerador em producao. **REAL** como pipeline; **PLACEHOLDER** como conteudo
efetivamente gerado por IA hoje.

---

### 21.9 Respostas diretas as tres perguntas operacionais

#### Como escrever Screen Score hoje?

**So editando um script de seed e rodando-o.** Os unicos escritores de
`screenScore`/`screenScoreScale`/`screenScoreDisplay` sao
`apps/admin/scripts/public-demo-seed.ts:261-323` (valores vindos hardcoded de
`public-demo-seed-plan.ts:239-401`) e `apps/admin/scripts/staging-seed.ts`. **Nao
existe UI** para dar nota; **a ingestao TMDB nunca escreve screen_score**; **as
Server Actions do admin nao tocam screen_score** (so `reviewStatus`/`indexStatus`).
Marcador: **NAO IMPLEMENTADO** como capacidade editavel. Consequencia direta: fora
dos ~6 titulos do seed demo, nada tem estrela — **RISCO** de produto (catalogo real
sem nota). Reproduz o achado do audit de status.

#### Como escrever/publicar uma noticia?

**Nao ha caminho de produto.** `article`/`articleTranslation.create` so aparece em
`apps/web/scripts/validate-*-real-postgres.ts` (harnesses de validacao/fixture),
nunca no admin nem em servico de produto. `services/news-ingestion` e **apenas um
README** (`services/news-ingestion/README.md`, sem codigo) — **NAO IMPLEMENTADO**. O
admin so consegue **mudar `reviewStatus`/`indexStatus` de um `article_translation`
que ja exista** (via `editorial-actions.ts`, atras da flag). Autorar o texto, criar
o artigo, montar o cluster ou carimbar `published_at` — nenhum desses e possivel por
qualquer superficie. Marcador: **NAO IMPLEMENTADO**.

#### Como controlar indexacao (ha UI que grava page_indexability_decisions)?

**Nao.** Uma busca em todo o repo por escrita em `page_indexability_decisions`
retorna **zero** ocorrencias (nenhum `create`/`update`/`upsert`). A indexabilidade e
**calculada em render** por `evaluateIndexability()` (`packages/seo`), nao persistida
por uma UI. O que o admin controla e a **coluna `index_status` de `ArticleTranslation`**
(`updateArticleIndexStatus` `editorial-actions.ts:151`), gateada pela flag — e **so
para artigos**. Para filme/serie/pessoa **nao ha nenhum write de index_status** no
admin (as Server Actions cobrem apenas `articleTranslation` e `contentBlock`).
Marcador: **PARCIAL** (artigos, via coluna) / **NAO IMPLEMENTADO** (grava de
decisao de indexabilidade propriamente dita; indexacao de entidades nao-artigo).

---

### 21.10 O que o teste untracked trava (resumo)

`tests/admin/no-write-endpoints.test.ts` (novo, untracked): varre
`apps/admin/app` + `apps/admin/src` e falha se encontrar (`:20`):

- qualquer linha `"use server"` (`'"use server" server action'`);
- `export (async) function POST|PUT|PATCH|DELETE` (route handler de escrita);
- `export const POST|PUT|PATCH|DELETE`.

Tem tambem uma guarda anti-vacuidade (`:112`): exige que exista `apps/admin/app` com
arquivos. Como **nao ha allowlist**, ele trava inclusive o `editorial-actions.ts`
legitimo — por isso hoje **quebraria** a suite (secao 21.4). E, na pratica, um
"admin deve ser 100% read-only" que conflita com o estado merged 7A/7C.

---

### 21.11 Veredito — o admin esta pronto para operacao editorial diaria?

**Nao.** Serve como **console de revisao/diagnostico**, nao como ferramenta de
operacao editorial completa. Prontidao por capacidade:

| Capacidade | Marcador | Nota |
| --- | --- | --- |
| Protecao de acesso (Basic Auth ENV, fail-closed) | **REAL** / **NAO BLOQUEIA PRODUCAO** | so falta configurar user/pass em prod |
| Leitura/diagnostico (dashboard, listas, QA, health, staging, security) | **REAL** | solido, read-only, sem segredo |
| Mudar `review_status` (artigo/bloco) | **PARCIAL** | so com `ADMIN_EDITORIAL_ACTIONS_ENABLED=true` |
| Mudar `index_status` (so artigo) | **PARCIAL** | entidades nao-artigo sem caminho |
| Acoes em lote (`/workflow`) | **PARCIAL** | loop `.update`, teto 20, atras da flag |
| Dar/editar Screen Score | **NAO IMPLEMENTADO** | so via seed script |
| Autorar/publicar noticia | **NAO IMPLEMENTADO** | news-ingestion = README; create so em fixtures |
| Gravar decisao de indexacao (`page_indexability_decisions`) | **NAO IMPLEMENTADO** | zero writes; calculado em render |
| Criar/editar entidade, bloco ou conteudo (CMS de autoria) | **NAO IMPLEMENTADO** | nenhuma tela de criacao/edicao |
| Gerar content_block por IA sob demanda | **PARCIAL** | pipeline REAL, mas so CLI manual; sem gatilho no admin nem scheduler |
| Rastreabilidade/auditoria de quem editou | **NAO IMPLEMENTADO** | Basic Auth unico, sem log de acao |
| Coerencia da suite de governanca do admin | **DEBITO** / **RISCO** | teste untracked contradiz o tracked (secao 21.4) |

**PROXIMO PASSO** operacional para operacao diaria real: (1) resolver o conflito dos
dois testes de escrita (decisao humana); (2) prover caminho editavel para
Screen Score fora do seed; (3) implementar autoria/publicacao de noticia (ou o
`news-ingestion`); (4) dar ao admin um gatilho para o Entity Writer + um scheduler
offline; (5) adicionar log de auditoria por acao editorial. Ate la, o admin
**nao bloqueia producao** (por ser read-only seguro), mas tambem **nao habilita**
operacao editorial diaria — o produto depende de scripts de terminal para quase tudo
que importa.


---

## Parte 22 — Governanca, invariantes e auditorias

Esta secao audita a **camada de governanca executavel** do Screen: os dois scripts de auditoria (`scripts/audit/*.mjs`), os 13 testes em `tests/governance/`, a constante canonica `packages/config/src/invariants.ts`, e o pipeline de CI (o **commitado** vs o do **working tree sujo**). O foco e responder, com honestidade: **quais invariantes tem trava automatica, quais nao tem, e o que a governanca deixa passar hoje**.

A conclusao de topo, antecipada: a governanca e **densa e bem construida para o dominio de dados/ratings/render-purity**, mas tem **dois buracos estruturais**: (a) **nenhuma trava contra streaming/rating falso na UI** — o `EpisodesTicker` mock com "Onde assistir NETFLIX" atravessa 100% da governanca sem ser pego (**DEBITO**, fere invariante 6/8); e (b) a **CI commitada nao roda `audit:render` nem `build`** — as melhorias de pipeline so existem no working tree nao commitado (**RISCO**).

---

### 22.1 Panorama: o que trava o que

| Camada | Arquivo | Invariantes que protege | Estado |
| --- | --- | --- | --- |
| Script audit invariantes | `scripts/audit/check-invariants.mjs` | 1 (parcial), presenca de frases nos docs | **REAL** |
| Script audit render | `scripts/audit/check-render-purity.mjs` | 3, 4 | **REAL** |
| Constante canonica | `packages/config/src/invariants.ts` | fonte de verdade das 13 | **REAL** |
| Teste meta-docs | `tests/governance/docs-invariants-present.test.ts` | todas as 13 (presenca textual) | **REAL** |
| Teste ratings | `tests/governance/ratings.test.ts` | 1, 2 | **REAL** |
| Teste escalas | `tests/governance/rating-scales-mirror.test.ts` | 1 | **REAL** |
| Teste provider TMDB | `tests/governance/tmdb-provider-separation.test.ts` | 1, 2 | **REAL** |
| Teste seed disjunto | `tests/governance/seed-disjoint.test.ts` | 2 | **REAL** |
| Teste render puro | `tests/governance/no-render-external-api.test.ts` | 3, 4 | **REAL** |
| Teste layering web | `tests/governance/web-render-layering.test.ts` | 3, 4 | **REAL** |
| Teste anti-thin | `tests/governance/indexability.test.ts` | 5, 6, 7 | **REAL** |
| Teste guard idioma | `tests/governance/index-language-guard.test.ts` | 7 | **REAL** |
| Teste defaults schema | `tests/governance/schema-safe-defaults.test.ts` | 5, 6, 7, 13 (parcial) | **REAL** |
| Teste vertical | `tests/governance/vertical.test.ts` | 9, 10, 11 | **REAL** |
| Teste entity writer | `tests/governance/entity-writer-output.test.ts` | 12 (parcial) | **PARCIAL** |
| Teste episode/season | `tests/governance/episode-no-season-number.test.ts` | integridade de schema (nao-invariante) | **REAL** |
| **Streaming/rating falso na UI** | **(nao existe)** | 6, 8 | **NAO IMPLEMENTADO** |

---

### 22.2 `scripts/audit/check-invariants.mjs` — `pnpm audit:invariants`

**O que protege.** Duas coisas, ambas fracas por design (`check-invariants.mjs:9-18`):

1. **Presenca de frases-chave** (`DOC_CHECKS`, `check-invariants.mjs:43-80`): verifica, case-insensitive, que trechos estaveis das invariantes aparecem em `CLAUDE.md` e nos 5 `.claude/rules/*.md`. Ex.: `CLAUDE.md` deve conter `IMDb`, `Rotten`, `provider_api`, `rating_source`, `noindex`, `render`, `pt-BR`, `pirataria`, `content_blocks`, `Entity Writer`, `AggregateRating` (`check-invariants.mjs:46-58`). Arquivo de regra **ausente** vira **aviso, nao violacao** (`check-invariants.mjs:226-228`) — nao quebra a CI.
2. **Varredura de padrao proibido** (`FORBIDDEN_PATTERNS`, `check-invariants.mjs:123-136`): so **UMA** regra real de codigo — `imdb` colado/adjacente a `tomatometer`/`popcornmeter`/`tomate` (ate 3 separadores, ambas as ordens, case-insensitive) em `apps`, `packages`, `services`, `api-clients`, `seo` (`check-invariants.mjs:86`). Protege a invariante 1 ("nota IMDb nunca vira Tomatometer").

**Como detecta.** Regex linha-a-linha; qualquer match em qualquer arquivo `.ts/.tsx/.js/.md/.json/.css/...` (`check-invariants.mjs:89-103`) gera `process.exit(1)`.

**O que NAO pega.** Praticamente tudo o que nao seja a substring literal `imdb...tomatometer`. Nao verifica: (a) escala errada, (b) `provider_api === rating_source` no codigo, (c) piracia (torrent/IPTV), (d) streaming falso, (e) qualquer logica — so **presenca textual** e **uma** adjacencia lexical. E um *smoke test* de que os docs de governanca nao foram esvaziados, nao um verificador semantico. A frase-chave `check` no `DOC_CHECKS` de `CLAUDE.md` inclui `'render'` e `'noindex'` como substrings simples — trivialmente satisfeitas.

---

### 22.3 `scripts/audit/check-render-purity.mjs` — `pnpm audit:render`

**O que protege.** Invariantes **3** (zero API externa no render) e **4** (zero Gemini no render). Varre `apps/web` recursivo (`check-render-purity.mjs:337-417`) e acusa:

1. **`fetch(` para host externo** conhecido (`tmdb`, `themoviedb`, `rapidapi`, `googleapis`, `gemini`, `generativelanguage`, `rottentomatoes`, `imdb`) na mesma linha — em **qualquer** arquivo de render (`check-render-purity.mjs:78-99`, `380-385`).
2. **Imports de client de API / `@screena/db` / `services/ingestion|sync` / client TMDB** dentro de arquivos de **pagina/layout** (`IMPORT_PATTERNS`, `check-render-purity.mjs:136-156`; aplicado so em `PAGE_FILE_NAMES`, `396-402`).
3. **Imports worker-only** (Entity Writer, SDK Gemini/Google GenAI) em **qualquer** arquivo de `apps/web` (`GLOBAL_IMPORT_PATTERNS`, `check-render-purity.mjs:164-175`, `389-393`).
4. **`@screena/db` / api-clients em client component** (`"use client"`, detectado como primeira instrucao nao-vazia, `check-render-purity.mjs:318-327`, `406-412`).

**A EXCECAO GOVERNADA do `image.tmdb.org`** (`check-render-purity.mjs:117-130`, `362-378`). O literal do CDN remoto de imagens TMDB (`image.tmdb.org`) e **proibido em todo `apps/web`** por `FORBIDDEN_LITERAL_PATTERNS` — **exceto** em **um unico arquivo**: `apps/web/src/lib/tmdb-image-url.ts` (constante `IMAGE_URL_HELPER_REL`, `check-render-purity.mjs:130`). A logica em `check-render-purity.mjs:364` (`isGovernedImageUrlHelper = rel(absFile) === IMAGE_URL_HELPER_REL`) desliga so a checagem de literal (`372-378`) para esse helper. **Confirmado**: o arquivo existe e contem exatamente 1 ocorrencia do literal (`apps/web/src/lib/tmdb-image-url.ts`). A racional (documentada `check-render-purity.mjs:14-19`): construir a **string** da URL publica de imagem a partir do `file_path` cru do PostgreSQL **nao e chamada de rede no render** — e concatenacao; o `<img src>` do browser e quem busca a imagem. O `fetch(` a host TMDB continua barrado **inclusive no helper** (`FETCH_PATTERNS` roda em todos os arquivos). Esta e a materializacao no codigo do pivo de arquitetura "imagens TMDB remotas" (commit `46aac93`).

**O que NAO pega.** (a) Chamada externa **quebrada em multiplas linhas** ou por variavel (`const h = 'imdb'; fetch(h)`) — regex e linha-unica. (b) Host externo **nao listado** em `EXTERNAL_HOSTS` (ex.: uma API de streaming nova). (c) Segredo/token TMDB vazando ao cliente (comentado como fora de escopo, `check-render-purity.mjs:112`, mas nao ha regra ativa que detecte `process.env.TMDB` em client component). (d) **Conteudo mock/fake** — o script so olha rede e imports, nunca semantica de UI.

---

### 22.4 Zero API externa no render: `no-render-external-api` + `web-render-layering`

Dois testes vitest cobrem as invariantes 3/4 **de dentro do `pnpm test`** (redundancia proposital com `audit:render`):

- **`no-render-external-api.test.ts`** — varre so `apps/web/app` (o caminho de render App Router, `no-render-external-api.test.ts:24`). Cinco regras: `fetch("http(s)://...")` absoluto (`:34`), import de `api-clients/` (`:37`), import de `@screena/db` (`:40`), import de `services/entity-writer` (`:43-44`) e import de SDK Gemini (`:47-48`). Se `apps/web/app` nao existir, passa trivialmente (`:83`). **Nao pega**: fetch relativo (`/api/...`) de proposito, e qualquer arquivo fora de `app/` (ex.: `src/`).
- **`web-render-layering.test.ts`** — o mais rigoroso. Espelha a logica do `check-render-purity.mjs` (`web-render-layering.test.ts:14-16`) com **fixtures inline** (prova a logica, `:140-189`) **e** varre a **arvore real** de `apps/web` inteira (`:191-240`). Regra-chave de layering: `@screena/db` so e permitido em `src/server/**` (server-only) ou em `apps/web/scripts/**` (dev scripts descartaveis, `:212-238`); proibido em pagina/layout e em client component. Distingue "restrito" (pagina OU client) de server puro (`:99-114`). **Nao pega**: fetch por host nao-listado, e — de novo — conteudo mock.

Cobertura combinada: **REAL e forte** para render-purity. Um regressor que reintroduza TMDB/Gemini no render e pego pelo `pnpm test` (que roda na CI commitada — ver 22.9).

---

### 22.5 `provider_api != rating_source` (invariante 2): `tmdb-provider-separation` + `seed-disjoint` + `ratings`

Tres angulos:

- **`ratings.test.ts:28-42`** (teste `(2)`): `validateRating` **falha** quando `providerApi === ratingSource` (`imdb`/`imdb`). Fronteira pura em `packages/schemas/src/ratings.ts`.
- **`seed-disjoint.test.ts`**: o conjunto `api_providers.key` (seed) e **disjunto** de `RATING_SOURCES` (`:15-19`); `imdb` **nunca** e provider tecnico — o provider das notas IMDb e `imdb236` (`:21-25`); intersecao vazia (`:32-37`). Trava a seed para que o banco nunca aceite o mesmo literal como fornecedor e fonte.
- **`tmdb-provider-separation.test.ts`**: TMDB e `provider_api` `kind=data`, **nunca** `rating_source` (`:63-71`); e o **codigo** de `api-clients/tmdb/src` + `services/ingestion/src` **nao referencia** `external_ratings`/`rating_source` (varredura com `stripComments`, `:73-88`). Confirma o fato ja auditado: a ingestao TMDB nunca toca ratings editoriais.

**O que NAO pega.** A separacao e travada na **seed** e na **fronteira de validacao**, nao no dado de runtime — se um worker de ratings (ainda inativo) gravasse `provider_api` errado sem passar por `validateRating`, nenhum teste pegaria. Como ratings externos estao **NAO IMPLEMENTADO** como produto, o risco e teorico hoje.

---

### 22.6 `IMDb != Rotten Tomatoes` (invariante 1): `ratings` + `rating-scales-mirror`

- **`ratings.test.ts`**: teste `(1)` — `ratingSource=imdb` + `ratingLabel="Tomatometer"` **falha por cross-label** (`:12-26`); teste `(3)` — `imdb` com escala `100` **falha** (deveria ser `10`, `:44-58`); teste `(4)` — caso valido de referencia passa (`:60-74`). Cobre cross-label, cross-scale e o caminho feliz.
- **`rating-scales-mirror.test.ts`**: a seed `rating_sources.scale` **espelha exatamente** `RATING_SCALES` de `@screena/config` (`imdb=10`, `rotten_tomatoes=100`, `metacritic=100`, `letterboxd=5`, `filmaffinity=10`, `:14-34`). Drift entre seed e constante canonica quebra o teste.
- Reforco lexical: `check-invariants.mjs` `FORBIDDEN_PATTERNS` (22.2) pega `imdb...tomatometer` em qualquer fonte.

Fonte de verdade unica: `RATING_SOURCES`/`RATING_SCALES` em `packages/config/src/invariants.ts:84-110`. **Cobertura REAL e triangulada** (validacao pura + seed + lexical).

---

### 22.7 Anti-thin (invariante 5) e licenca/idioma (6/7): `indexability` + `schema-safe-defaults`

- **`indexability.test.ts`** exercita `evaluateIndexability` de `@screena/seo`: 1 bloco de valor -> `noindex` (`:29-35`, inv 5); 2 blocos + structured data + review ok -> `index` (`:38-50`); qualquer rating `display_allowed=false` -> `blocked` (`:52-64`, inv 6); idioma `en` -> `draft` (`:66-72`, inv 7). Cobre a **precedencia** (blocked > draft > index > noindex) descrita em `.claude/rules/seo.md`.
- **`schema-safe-defaults.test.ts`** trava os **defaults seguros do schema Prisma** (le `packages/db/prisma/schema.prisma` como texto): `external_ratings.display_allowed=false` e `watch_availability.display_allowed=false` (`:56-62`, inv 6); `source_licenses` nasce `license_status=unknown`, `display_allowed=false`, `score_allowed=false` (`:64-69`); `entity_translations` nasce `draft`/`noindex` (`:71-75`, inv 7); `page_indexability_decisions` nasce `noindex` (`:77-79`, inv 5); `content_blocks` nasce `review_status=draft` (`:81-83`); `movies/tv_shows.screen_score_display=false` (`:85-90`); seed de idiomas: pt-BR publica/indexa, en/es nao (`:99-113`, inv 7).

O teste de `screen_score_display=false` (`schema-safe-defaults.test.ts:85-90`) e relevante para o fato ja auditado: a **nota editorial propria** nasce **oculta por default** — reforca que titulos ingeridos do TMDB (que nunca recebem `screen_score`) ficam sem estrelas, e agora se sabe que ate o gate de exibicao nasce fechado.

**O que NAO pega.** `countValueBlocks`/`thinContentScore` sao testados na fronteira pura, mas **nenhum teste** verifica que uma **pagina real** de `apps/web` respeita a decisao (ha `tests/web/movie-indexability.test.ts` fora de `tests/governance/`, nao auditado aqui). O gate e provado como **funcao**, nao como **render**.

---

### 22.8 Diferenciacao filme/serie (9/10/11): `vertical` + guard de idioma (7): `index-language-guard`

- **`vertical.test.ts`**: `resolveVertical('movie')` -> acento `red` + label/badge truthy (`:13-21`, inv 9); `series` -> `green` + truthy (`:23-31`, inv 10); **`assertNotColorOnly(v)`** garante que label e badge existem para todo tipo — a diferenciacao **nunca** e so cor (`:40-48`, inv 11); vertical neutra usa a marca publica **Screen**, nao Screena (`:50-57`). Cobre bem as 3 invariantes de vertical **na camada `@screena/ui`**. **Nao pega**: se uma **pagina real** omitir o badge/label no JSX, o teste unitario da funcao nao acusa (a regra dos "5 sinais simultaneos" de `.claude/rules/seo.md` — label+badge+breadcrumb+schema+URL — nao e verificada ponta-a-ponta).
- **`index-language-guard.test.ts`**: `assertIndexDecisionForLanguage`/`isIndexDecisionAllowedForLanguage` — `index` proibido quando `languageIndexDefault=false` sem aprovacao (en/es, `:14-18`); permitido para pt-BR (`:20-24`); permitido para nao-default **com aprovacao explicita de revisao** (`:26-33`); decisoes != index sempre permitidas (`:35-39`). Trava a invariante 7 no ponto de decisao.

---

### 22.9 CI: commitada vs working tree — o buraco de garantia

Comparacao **confirmada** via `git show HEAD:.github/workflows/ci.yml` e `git show HEAD:package.json` contra o working tree:

| Passo | CI **commitada** (HEAD) | CI **working tree** (sujo, nao commitado) |
| --- | --- | --- |
| Setup pnpm | sem versao pinada | `version: 9.15.4` |
| Install | `--no-frozen-lockfile` | `--frozen-lockfile` |
| `pnpm typecheck` | sim | sim |
| `pnpm lint` | sim | sim |
| `pnpm test` (vitest) | **sim** | sim |
| `audit:invariants` | sim (`node scripts/audit/check-invariants.mjs`) | sim |
| **`audit:render`** | **NAO** | sim (`pnpm audit:render`) |
| **`pnpm build`** | **NAO** (script `build` nao existe no `HEAD:package.json`) | sim (`corepack pnpm --filter @screena/web build`) |

Fatos duros: o `HEAD:package.json` tem apenas `lint`, `typecheck`, `test`, `audit:invariants`, `audit:render` nos scripts — **sem `build`**. A CI commitada nem invoca `audit:render` (so `check-invariants`). O working tree **adiciona** `"build"` e os dois passos de CI, mas **nada disso esta commitado** (git status confirma `.github/workflows/ci.yml` e `package.json` como `M` modificados, nao staged).

**Nuance honesta (nao inflar o risco).** A invariante 3/4 **nao fica totalmente desprotegida** na CI commitada: `pnpm test` — que **roda** no HEAD — executa `no-render-external-api.test.ts` e `web-render-layering.test.ts`, que varrem a arvore real de `apps/web` e travam render-purity. Ou seja, um regressor de API externa no render **e** pego pela CI commitada via vitest. O que a CI commitada **realmente** deixa de fora:

1. **`pnpm build`**: o app publico **nunca e compilado na CI**. Erro de build (type-error server-only, import quebrado, RSC invalido) que so aparece em `next build` **chega a producao sem ser detectado**. **BLOQUEIA PRODUCAO** (garantia de build).
2. **`audit:render`**: redundante com o teste de layering, mas cobre o literal `image.tmdb.org` de forma mais ampla; sua ausencia e **NAO BLOQUEIA PRODUCAO** isolada (o teste vitest cobre o essencial).
3. **`--no-frozen-lockfile`** na CI commitada: instala com lockfile mutavel — build nao-reproduzivel, **RISCO** de drift de dependencia entre CI e producao.

**PROXIMO PASSO.** Commitar a CI e o `package.json` do working tree (adicionar `build` + `audit:render` + `--frozen-lockfile` + pin do pnpm). Ate la, a garantia de "o app publico compila" **nao existe no pipeline versionado**.

---

### 22.10 O buraco central: nao existe audit "no fake streaming" nem "no fake ratings na UI" — **DEBITO**

Este e o achado mais grave da governanca. **Confirmado por varredura**: nao ha, em `scripts/audit/` nem em `tests/governance/`, qualquer regra que detecte **conteudo mock/placeholder de streaming ou rating renderizado sem lastro**. Uma busca por `torrent|iptv|pirat` em `scripts/audit` e `tests/governance` retorna **zero** ocorrencias de codigo de deteccao.

O caso concreto que **atravessa toda a governanca sem ser pego**: o `EpisodesTicker` (`apps/web/app/_components/episodes-ticker.tsx`) renderiza dados **MOCK hardcoded** — `series: "Wednesday"`/`logo: "NETFLIX"`, `series: "The Bear"`, com CTA **"Onde assistir"** (`episodes-ticker.tsx:56-63`, `:158`) — e o proprio arquivo se declara "MOCK VISUAL — DIVIDA TECNICA" (`:15-17`). Ele e chamado **UNGATED** em `apps/web/app/pt/page.tsx:648` (`<EpisodesTicker />`), **fora** de `allowHomeVisualPlaceholders`. Isso **vaza para producao** e fere as invariantes **6** (dado sem `watch_availability` licenciada exibido) e **8** (afirma disponibilidade de streaming sem lastro).

Por que **nenhuma** trava pega:

| Trava | Por que nao pega o ticker |
| --- | --- |
| `check-invariants.mjs` | so escaneia `imdb...tomatometer`; "Onde assistir NETFLIX" nao casa. |
| `check-render-purity.mjs` | so olha `fetch`/imports/`image.tmdb.org`; conteudo mock e invisivel. |
| `no-render-external-api` / `web-render-layering` | idem — render-purity de rede, nao semantica de UI. |
| `home-placeholder-governance.test.ts` | testa **so a funcao pura** `allowHomeVisualPlaceholders` (`tests/web/home-placeholder-governance.test.ts:14-58`); **nao** verifica se o `EpisodesTicker` esta de fato gated. |
| `public-navigation.test.ts` (ver 22.11) | verifica a **string** `onde assistir` no source de `apps/web/app/pt/page.tsx`, mas o texto vive em `episodes-ticker.tsx` (arquivo **separado**, nao lido pelo teste). O mock escapa por estar em outro arquivo. |

Ou seja: existe uma funcao de gating (`allowHomeVisualPlaceholders`) e ate um teste dela, mas **o ticker nao a usa**, e **nenhum teste** cobra que ele a use. A governanca de placeholder e **REAL como biblioteca** e **NAO APLICADA** no ponto que importa. **DEBITO** de invariante 6/8, **BLOQUEIA PRODUCAO**.

**PROXIMO PASSO.** (a) Gatear o `EpisodesTicker` por `allowHomeVisualPlaceholders` (como os demais placeholders da home v4); (b) adicionar um teste de governanca que **falhe** se qualquer componente renderizado na home afirmar streaming/plataforma (`NETFLIX`, `Onde assistir`, chip de provider) **sem** `watch_availability` real — hoje esse audit **nao existe**.

---

### 22.11 `public-navigation.test.ts`: existe, mas em `tests/web/` (nao `tests/governance/`)

A tarefa pedia para confirmar `tests/governance/public-navigation.test.ts`. **Ele NAO existe nesse caminho.** O arquivo real e **`tests/web/public-navigation.test.ts`** (confirmado por `find`). E um teste de navegacao publica da Fase 5D (`public-navigation.test.ts:1-10`): verifica que o header nao tem link morto (toda rota de `NAV_ITEMS` tem `page.tsx` real, `:51-56`), logo local com `alt="Screen"` (`:64-69`), e que home/explorar nao tem busca/form/ratings fake nem `onde assistir` (`:84-91`, `:118-126`).

**Sobre as "2 falhas conhecidas"** (afirmadas pela memoria do projeto, Fase 9C: "public-navigation.test.ts tem 2 falhas PRE-EXISTENTES, page.tsx/site-header intocados"): **NAO FOI POSSIVEL CONFIRMAR** o numero exato de falhas — a auditoria e somente-leitura e **nao executei `pnpm test`**. O que pude verificar do source: o teste de "nenhum link morto" (`:51-56`) itera `NAV_ITEMS` que inclui `/pt/pessoas/` (esperado por `:47`), enquanto os `href` literais efetivamente usados na home (`grep`) sao so `EXPLORE_PATH`, `MOVIES_INDEX_PATH`, `NEWS_INDEX_PATH`, `SERIES_INDEX_PATH` — o teste de `href=\{...\}` (`:93-103`) tolera esse subconjunto. As asserts de "sem onde assistir" na home (`:88`) leem `apps/web/app/pt/page.tsx` **sem block comments**; as ocorrencias de `IMDb/RT/TMDB` e `Onde assistir` que achei em `page.tsx` (`:52,310,386,622`) estao **dentro de docblocks/comentarios JSX** (removidos por `withoutBlockComments`), entao **nao** deveriam disparar. A causa provavel das falhas relatadas esta em outra assert (ex.: `site-header.tsx` esperando `src="/brand/screen-logo-black.svg"`, `:65-68`, ou `dynamic = "force-dynamic"` em `explorar`) — mas isso e **hipotese**, nao verificacao. Registro como **NAO FOI POSSIVEL CONFIRMAR** e recomendo rodar `pnpm test tests/web/public-navigation.test.ts` num ambiente de execucao.

Nota importante: este teste **quase** pegaria o mock do ticker (procura `onde assistir` na home), mas **falha em faze-lo** porque le so `page.tsx`, e o mock esta em `episodes-ticker.tsx` — reforcando o **DEBITO** da secao 22.10.

---

### 22.12 Cobertura das 13 invariantes por teste automatizado

Mapeamento final. "Meta" = coberta apenas por `docs-invariants-present.test.ts` (presenca textual no `CLAUDE.md`, `:25-115`), que trava **enfraquecimento do texto**, nao comportamento.

| # | Invariante | Teste comportamental | Status |
| --- | --- | --- | --- |
| 1 | IMDb != Rotten Tomatoes | `ratings` (1,3), `rating-scales-mirror`, `tmdb-provider-separation`, `check-invariants` | **REAL** |
| 2 | provider_api != rating_source | `ratings` (2), `seed-disjoint`, `tmdb-provider-separation` | **REAL** |
| 3 | Zero API externa no render | `no-render-external-api`, `web-render-layering`, `audit:render` | **REAL** |
| 4 | Zero Gemini no render | `no-render-external-api`, `web-render-layering`, `audit:render` | **REAL** |
| 5 | Pagina fina = noindex | `indexability` (1,2), `schema-safe-defaults` | **REAL** |
| 6 | Sem licenca clara nao indexa | `indexability` (3), `schema-safe-defaults` | **REAL** (fronteira pura; **NAO** na UI — ver 22.10) |
| 7 | pt-BR primeiro; en/es draft | `indexability` (4), `index-language-guard`, `schema-safe-defaults` | **REAL** |
| 8 | **Sem pirataria** | **(nenhum)** | **NAO IMPLEMENTADO** |
| 9 | Filme = acento vermelho | `vertical` (1) | **REAL** |
| 10 | Serie = acento verde | `vertical` (2) | **REAL** |
| 11 | Diferenciacao nunca so cor | `vertical` (4, assertNotColorOnly) | **REAL** (na `@screena/ui`; nao ponta-a-ponta na pagina) |
| 12 | Entity Writer so payload controlado | `entity-writer-output` (anti-alucinacao) | **PARCIAL** |
| 13 | content_blocks versionados | `schema-safe-defaults` (so default `draft`) | **PARCIAL** |

**Invariantes SEM teste automatizado comportamental:**

- **Invariante 8 (sem pirataria) — NENHUM teste.** Nao ha varredura de `torrent`/`IPTV`/`player ilegal`/`download`/`embed` em `scripts/audit` nem `tests/governance` (confirmado por grep, zero hits). Apenas o `check-invariants.mjs` exige a **palavra** `pirataria` existir no `CLAUDE.md` — presenca textual, nao trava de codigo. Combinado com o **DEBITO** de streaming falso (22.10), o eixo "sem pirataria / sem streaming ilegal" e o **menos protegido** da governanca. **RISCO.**

**Invariantes com cobertura PARCIAL:**

- **Invariante 12** — `entity-writer-output.test.ts` testa **so** a anti-alucinacao (`validateAgainstPayload`: nome fora do payload vira warning, `:53-137`) e a forma (`validateEntityWriterOutput`: `warnings[]` obrigatorio, `:139-157`). **Nao** testa "nao publica sozinho", "nao cria entidades", "nao chama API externa" — essas partes da invariante 12 nao tem trava (o writer e **PARCIAL** como produto).
- **Invariante 13** — apenas o **default** `content_blocks.review_status=draft` e travado (`schema-safe-defaults.test.ts:81-83`). **Nenhum** teste verifica que uma linha gravada carrega `prompt_version`, `input_hash`, `output_hash`, `model_provider`, `model_name`, `warnings_json` obrigatorios. Como nao ha pipeline de persistencia do writer ativo, a obrigatoriedade das colunas de versionamento e **contrato documental, nao trava executavel**. **DEBITO.**
- **Invariantes 9/10/11** — cobertas na camada `@screena/ui` (resolucao de vertical), **nao** na renderizacao real da pagina; a regra SEO dos "5 sinais simultaneos" (label+badge+breadcrumb+schema+URL) nao e verificada ponta-a-ponta.

---

### 22.13 Sintese e riscos

**O que a governanca faz bem (REAL).** Render-purity (3/4) e o eixo mais blindado — triangulado por script + 2 testes que varrem a arvore real, com a excecao do `image.tmdb.org` **corretamente governada** a um unico helper. Ratings/fontes (1/2) tem trava pura + seed + lexical. Defaults seguros do schema (5/6/7) sao travados por leitura do `schema.prisma`. A constante `packages/config/src/invariants.ts` e fonte de verdade unica e os testes espelham dela (`rating-scales-mirror`, `seed-disjoint`).

**Buracos estruturais (DEBITO/RISCO):**

1. **Streaming/rating falso na UI (inv 6/8) — sem qualquer trava.** O `EpisodesTicker` mock ("Onde assistir NETFLIX", Wednesday/The Bear) e renderizado **ungated** na home e **atravessa 100% da governanca**. **BLOQUEIA PRODUCAO.**
2. **Invariante 8 (pirataria) — zero teste.** So presenca textual da palavra no doc. **RISCO.**
3. **CI commitada nao compila o app (`build`) nem roda `audit:render`.** As melhorias vivem no working tree sujo, nao versionadas. Um build quebrado chega a producao sem gate de CI. **BLOQUEIA PRODUCAO** (garantia de build).
4. **Invariante 13 sem trava de colunas de versionamento**; invariante 12 so cobre anti-alucinacao. **DEBITO.**
5. **Cobertura de pagina real** e fraca em geral: quase toda trava e **unitaria/de biblioteca**; poucas verificam o **render** efetivo (a excecao sendo render-purity). Isto explica por que um mock de UI passa: a governanca protege **dados e funcoes puras**, nao **o que a pagina de fato mostra**.

**PROXIMO PASSO consolidado.** (a) Gatear o ticker + criar audit "no fake streaming/rating na UI"; (b) commitar a CI/`package.json` do working tree (build + audit:render + frozen-lockfile); (c) adicionar scan anti-pirataria em `scripts/audit`; (d) quando o Entity Writer virar pipeline ativo, travar as colunas obrigatorias da invariante 13 na fronteira de persistencia.


---

## Parte 23 — Performance, disco e infraestrutura de custo

Esta parte audita o **peso** e a **performance** do Screen **sem medir o servidor** (a
auditoria não tem acesso ao host de produção). Os números de disco abaixo foram
**reportados pelo operador** e estão marcados como **não verificados nesta auditoria** — a
análise explica *por que* cada número é o que é, lendo o repositório, e fecha com comandos
exatos para medir depois.

### 23.1 Mapa de disco reportado (não verificado nesta auditoria)

| Item | Tamanho reportado | Natureza | Verificação |
| --- | --- | --- | --- |
| `screen-app` (container app) | ~987 MB | Runtime Next + deps | não verificado nesta auditoria |
| `node_modules` | ~977 MB | Dependências pnpm do monorepo | não verificado nesta auditoria |
| `.next` | ~3.8 MB | Build output do Next | não verificado nesta auditoria |
| `apps/web/public` | ~144 KB | Assets estáticos versionados | não verificado nesta auditoria |
| Mídia TMDB local | ausente (0) | Imagens remotas via CDN | **confirmado por código** (§23.4) |
| `screen-db` data dir | ~71 MB | Cluster PostgreSQL (WAL, catálogos, etc.) | não verificado nesta auditoria |
| `pg_database_size` (banco lógico) | ~16 MB | Dados normalizados atuais | não verificado nesta auditoria |

Leitura geral: **o app pesa ~1 GB e ~99% disso é `node_modules`**, não código, não mídia,
não banco. O dado real (banco lógico ~16 MB) e o output de render (`.next` ~3.8 MB) são
minúsculos. Isso é o perfil esperado de um **monorepo pnpm em fase de fundação com pouco
catálogo ingerido** — o custo está nas ferramentas, não no conteúdo. **NÃO BLOQUEIA
PRODUÇÃO.**

### 23.2 Por que `node_modules` domina (~977 MB)

O peso vem da **arquitetura do monorepo + o que é arrastado para o runtime**, confirmado
lendo os `package.json`:

1. **Monorepo pnpm com workspaces múltiplos.** `package.json:1` declara
   `packageManager: pnpm@9.15.4` e o repo tem `apps/*`, `packages/*`, `api-clients/*`,
   `services/*` (CLAUDE.md §4). Cada workspace tem suas próprias deps; embora o pnpm faça
   *hardlink* para um store global (`.pnpm-store`, ignorado em `.gitignore:3`), o
   `node_modules` materializado ainda soma toda a árvore de todos os pacotes.

2. **devDependencies pesadas na raiz.** `package.json:21-29` traz `typescript`,
   `eslint` + `typescript-eslint`, `prettier`, `vitest`, `@types/node`. Isolados são grandes
   (o ecossistema ESLint/TS-ESLint e o Vitest/rollup puxam dezenas de MB). Num deploy de
   runtime, **nada disso deveria estar presente** — é dependência de build/lint/teste.

3. **Next 15 + React 19 no `apps/web`.** `apps/web/package.json:22-24` fixa `next@^15`,
   `react@^19`, `react-dom@^19`. O Next sozinho (com swc/webpack, o compilador e os binários
   de plataforma) é a maior deps única de um app; é o piso natural de ~centenas de MB.

4. **Prisma engines.** `@screena/db` (workspace, `apps/web/package.json:28`) depende do
   Prisma Client, que embute **query engines binários por plataforma** (dezenas de MB cada).
   Esses binários são runtime-necessários (o render lê Postgres via Prisma), mas costumam
   duplicar por arquitetura se o `binaryTargets` não for enxuto.

5. **`embedded-postgres` como devDependency do web.** `apps/web/package.json:35` traz
   `embedded-postgres@16.14.0-beta.17` — um **PostgreSQL embarcado inteiro** (binários do
   servidor) usado só para validação/dev local (os scripts `validate:*` e `seed:*` em
   `apps/web/package.json:13-19` rodam via `tsx`). **Não é dependência de produção.** Se o
   container de runtime foi construído com `devDependencies` instaladas, esse pacote sozinho
   já explica uma fatia relevante dos ~977 MB. **DEBITO** de imagem: instalar em runtime
   apenas `dependencies`.

6. **`tsx`** (`apps/web/package.json:36`) — runtime TypeScript para os scripts offline;
   também é dev-only.

**Conclusão desta subseção:** o inchaço não é acidental nem indica vazamento de mídia — é a
soma de (a) monorepo, (b) toolchain de build/lint/test, (c) Prisma engines, (d) um Postgres
embarcado de dev. **PROXIMO PASSO** de custo: `pnpm prune --prod` / `pnpm install --prod` na
imagem de runtime e/ou `output: "standalone"` no Next (§23.7) para cortar de ~1 GB para uma
fração. **NÃO BLOQUEIA PRODUÇÃO** — é otimização de imagem, não correção de bug.

### 23.3 Por que `.next` é pequeno (~3.8 MB) e `public` é minúsculo (~144 KB)

- **`.next` ~3.8 MB** é coerente com um app de **poucas rotas e pouco JS de cliente**. As
  rotas públicas são server components que leem Postgres (`apps/web/src/server/*.ts`); o
  único cliente pesado é o `hero-carousel.tsx` (interatividade). Sem catálogo grande, sem
  bibliotecas de UI pesadas e sem imagens processadas, o bundle estático é enxuto. O `.next`
  é **regenerável** e está em `.gitignore:7`.

- **`public` ~144 KB** foi confirmado listando o diretório: contém só
  `apps/web/public/brand/` (6 logos SVG + README) e `apps/web/public/media/demo/` (15 PNGs
  do **seed demo**). **Não há árvore de mídia TMDB local.** O `.gitignore:13-15` ignora
  explicitamente `apps/web/public/media/tmdb/` com o comentário *"Imagens reais baixadas do
  TMDB pela ingestao (arte de estudio, regeravel). NUNCA commitar"*. Ou seja: mesmo no
  fluxo legado de download, a mídia nunca entra no repo nem infla o `public` versionado.

### 23.4 Decisão de imagem remota — por que NÃO salvar mídia foi correto (**REAL**)

Confirmado por código em `apps/web/src/lib/tmdb-image-url.ts:1-53` e pela memória de
auditoria (pivô final, commit `46aac93`): **o servidor não salva imagem**. O banco guarda o
`file_path` **cru** do TMDB (ex.: `/abc123.jpg`) e o frontend monta a URL pública
`https://image.tmdb.org/t/p/{size}{file_path}` (`tmdb-image-url.ts:20,52`), renderizada por
`<img>` normal. Isso **não** é chamada de API no render — é concatenação de string sobre
dado já lido do Postgres (`tmdb-image-url.ts:10-12`), então as invariantes 3 e 4 seguem
intactas e **nenhum token TMDB vai ao cliente**.

Por que essa decisão é a certa em custo de infraestrutura:

| Dimensão | Salvar mídia local (rejeitado) | Remoto via CDN TMDB (adotado) |
| --- | --- | --- |
| **Disco** | Cresce sem teto com o catálogo (posters+backdrops+profiles por título) | ~0 — só o `file_path` de texto no banco |
| **Banda de ingestão** | Baixa cada asset uma vez (e re-baixa em invalidação) | Não baixa nada; o browser do usuário puxa do CDN |
| **Invalidação** | Arte de estúdio muda → asset local fica stale, precisa de re-sync | TMDB atualiza a arte; a URL cru continua válida |
| **CDN/latência** | Servir imagem do próprio VPS (custo de egress e CPU) | Servido pela CDN global do TMDB, otimizada para isso |
| **Volume/backup** | Exige volume persistente e backup de blobs | Sem volume de mídia; backup só do banco |

O guard `scripts/audit/check-render-purity.mjs` abre **exceção nomeada só** para
`tmdb-image-url.ts` conter o host do CDN (`tmdb-image-url.ts:3-6`), reforçando que é o
**ponto governado único**. O fluxo de download local vira **legado** (a memória registra
`--download-images` como opção legada da ingestão). **REAL** e correto. O trade-off aceito é
**dependência de disponibilidade do CDN TMDB** — se o TMDB cair, as imagens quebram (mas o
HTML/texto renderiza normalmente, porque `buildTmdbImageUrl` retorna `null` em entrada
inválida em vez de URL quebrada, `tmdb-image-url.ts:40-52`).

### 23.5 Performance de render — ISR vs force-dynamic e custo por página

Confirmado por `grep` de `export const revalidate|dynamic` em `apps/web/app`:

| Rota | Estratégia | Arquivo:linha | Efeito de custo |
| --- | --- | --- | --- |
| Home `/pt` | **`force-dynamic`** | `apps/web/app/pt/page.tsx:60` | **toda request** re-executa todas as queries |
| Detalhe filme `/pt/filmes/[slug]` | **`revalidate = 3600`** (ISR 1h) | `apps/web/app/pt/filmes/[slug]/page.tsx:33` | HTML cacheado, regen a cada 1h |
| Detalhe série `/pt/series/[slug]` | **`revalidate = 3600`** | `apps/web/app/pt/series/[slug]/page.tsx:19` | idem |
| Detalhe pessoa `/pt/pessoas/[slug]` | **`revalidate = 3600`** | `apps/web/app/pt/pessoas/[slug]/page.tsx:23` | idem |
| Índice filmes `/pt/filmes` | **`force-dynamic`** | `apps/web/app/pt/filmes/page.tsx:21` | por-request |
| Índice séries `/pt/series` | **`force-dynamic`** | `apps/web/app/pt/series/page.tsx:21` | por-request |
| Índice pessoas `/pt/pessoas` | **`force-dynamic`** | `apps/web/app/pt/pessoas/page.tsx:21` | por-request |
| Notícias índice/detalhe | **`force-dynamic`** | `apps/web/app/pt/noticias/page.tsx:19`, `[slug]/page.tsx:20` | por-request |
| Explorar | **`force-dynamic`** | `apps/web/app/pt/explorar/page.tsx:45` | por-request |
| Sitemap | **`force-dynamic`** | `apps/web/app/sitemap.ts:20` | por-request |

Padrão: **páginas de detalhe usam ISR (1h)** — ótimo para SEO e custo — enquanto **a home e
todas as listagens são `force-dynamic`**, ou seja, batem no Postgres a cada request. Como o
render é **puro de Postgres local** (sem rede externa — invariantes 3/4 confirmadas nos
cabeçalhos de `apps/web/src/server/*.ts`), o custo por request é de **latência de banco
local**, não de terceiros. Aceitável no volume atual, mas é **DEBITO** de escala: a home
poderia ser ISR (ex.: `revalidate = 300`) já que seus dados mudam offline. **NÃO BLOQUEIA
PRODUÇÃO** no tráfego de lançamento.

#### Contagem de queries Prisma por página

**Home (`/pt`, force-dynamic)** — a mais pesada. `getHomeData` (`page.tsx:78-84`) dispara em
`Promise.all` quatro loaders de índice + a home ainda chama `getHomeHeroSlides` e
`getHomeUpcomingMovies` (`page.tsx:14-16`). Somando as queries reais lidas no código:

| Loader | Queries Prisma | Fonte |
| --- | --- | --- |
| `getMovieIndexData` | 2 (slugs `IN` + movies `IN` + translations em paralelo → 3 no total, 2 rodadas) | `entity-indexes.ts:94-114` |
| `getSeriesIndexData` | ~3 (slugs, shows, translations) | `entity-indexes.ts:138-159` |
| `getPersonIndexData` | ~3 (slugs, people, translations) | `entity-indexes.ts:184+` |
| `getNewsIndexData` | n/d (news-pages.ts) — NAO FOI POSSIVEL CONFIRMAR contagem exata aqui | `news-pages.ts` |
| `getHomeHeroSlides` | slugs+entities+translations ×2 verticais, **+ N×2 por slide** (director+cast) até 5 slides | `home-hero.ts:225-249` |
| `getHomeUpcomingMovies` | n/d — NAO FOI POSSIVEL CONFIRMAR contagem exata | `home-upcoming.ts` |

Ordem de grandeza da home: **~20–30 queries por request**, das quais boa parte roda em
paralelo (`Promise.all`). É bastante para `force-dynamic`, mas está **memoizado por request**
com `cache()` do React (`entity-indexes.ts:94`, `home-hero.ts:225`, `movie-page.ts:65`),
então `generateMetadata` + render **não duplicam** as queries.

**Detalhe de filme (`/pt/filmes/[slug]`, ISR 1h)** — `getMoviePageData`
(`movie-page.ts:65-160`) resolve o slug (1 query) e depois um **único `Promise.all` de 7
ramos** (`movie-page.ts:77-121`): movie, slug canônico, tradução, content_blocks,
`getRelatedNewsForEntity`, `getCastForEntity`, `getWatchForEntity`. Cada um desses três
últimos é uma sub-query própria. Total ≈ **8–10 queries por render**, mas **só a cada 1h**
por causa do ISR. Barato.

#### Risco N+1

- **Loaders de índice: sem N+1.** Usam padrão `IN (ids)` batch: uma query pega os slugs,
  outra pega todas as entidades por `id: { in: ids }`, outra as traduções em lote
  (`entity-indexes.ts:66-114`, `translationTitlesByEntity` em `:79-92`). Correto.
- **Hero: N+1 controlado e limitado.** `getHomeHeroSlides` resolve director+cast **por
  slide dentro de um `map`** (`home-hero.ts:235-247`), o que é N+1 — mas **deliberadamente
  capado** a `HOME_HERO_SLIDE_LIMIT = 5` (`home-hero.ts:27,233`) e o próprio código comenta
  que resolve creditos "só dos candidatos que entram no carousel (evita N+1 no catálogo
  inteiro)" (`home-hero.ts:222-224`). Aceitável: no máximo ~10 queries extras. **NÃO
  BLOQUEIA PRODUÇÃO.**
- **Detalhe: sem N+1** — tudo em um `Promise.all` fixo.

#### `next/image` e LCP

Confirmado por `grep`: **`next/image` NÃO é usado** em nenhuma página — a única ocorrência é
o *matcher* do `middleware.ts:60` (`_next/image` na regex de exclusão), não um import. Há
**21 usos de `<img>` cru** espalhados por 15 arquivos (hero, cards, cast, footer, etc.). Ou
seja: **sem otimização de imagem do Next** (sem `srcset` automático, sem lazy nativo do
componente, sem `unoptimized` porque o componente não é usado). Implicações:

- **Vantagem:** zero custo de servidor com o otimizador de imagem do Next (que exigiria CPU
  e/ou um serviço), coerente com a decisão de servir tudo do CDN TMDB (§23.4).
- **RISCO de LCP:** o hero (`hero-carousel.tsx`) usa `<img>` de backdrop `w1280` (memória
  Fase 9C) sem `priority`/preload gerenciado nem `width/height` garantidos em todos os
  pontos → possível **LCP alto** e **CLS** se as dimensões não estiverem fixadas. É
  otimização de Core Web Vitals, **NÃO BLOQUEIA PRODUÇÃO**, mas é **PROXIMO PASSO** de
  performance percebida (usar `loading`/`fetchpriority`, `width`/`height` explícitos, ou
  migrar pontos-chave para um `<img>` com `srcset` de tamanhos TMDB).

### 23.6 Banco: por que ~71 MB de data dir para ~16 MB de dados lógicos

Reportado (não verificado nesta auditoria): `screen-db` data ~71 MB vs `pg_database_size`
~16 MB. A diferença é **normal** e não indica bloat de conteúdo: o data dir de um cluster
PostgreSQL inclui **WAL** (`pg_wal`, tipicamente ≥16 MB só de segmentos), catálogos do
sistema, `template0/template1`, estatísticas e overhead de páginas. Com apenas ~16 MB de
dados de aplicação, o cluster está **saudável e pequeno** — o slice ativo ingeriu pouco
catálogo (coerente com o estado de fundação). **NÃO BLOQUEIA PRODUÇÃO.** Vale medir as
maiores tabelas depois (§23.7) para confirmar que `api_cache` (JSON bruto do TMDB) não
cresce descontroladamente conforme a ingestão avança — esse é o candidato natural a inflar.

### 23.7 Comandos exatos para medir depois (no host, fora desta auditoria)

Disco por diretório (rodar na raiz do projeto e/ou dentro do container):

```bash
du -sh apps/web/.next apps/web/public node_modules 2>/dev/null
du -sh apps/web/public/media apps/web/public/brand
du -sh . 2>/dev/null | tail -1
```

Uso de disco do Docker (imagens, containers, volumes, build cache):

```bash
docker system df
docker system df -v            # detalhe por imagem/volume
docker image inspect screen-app --format '{{.Size}}'
```

Tamanho do banco lógico e das maiores tabelas (via psql no container `screen-db`):

```bash
psql -c "SELECT pg_size_pretty(pg_database_size(current_database()));"

psql -c "
SELECT relname AS tabela,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid))       AS dados,
       pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS indices_toast
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 20;"
```

Enxugar a imagem de runtime (cortar devDependencies como `embedded-postgres`, `tsx`,
`eslint`, `vitest`):

```bash
# opção A — podar após instalar
corepack pnpm prune --prod

# opção B — instalar já sem dev
corepack pnpm install --prod --filter @screena/web...

# opção C (recomendada p/ Next) — build standalone: gera .next/standalone
#   com só o necessário de node_modules p/ rodar. Adicionar em apps/web/next.config.ts:
#     const nextConfig = { output: "standalone", ... }
#   e servir com: node apps/web/.next/standalone/server.js
```

> Observação: `apps/web/next.config.ts:21-45` **não** define `output: "standalone"` hoje —
> por isso o deploy provavelmente carrega `node_modules` inteiro. Ativar standalone é o
> maior ganho isolado de tamanho de imagem (**PROXIMO PASSO**), mas exige validar o
> empacotamento dos workspaces `@screena/*` transpilados (`next.config.ts:30`).

### 23.8 Conclusão

| Achado | Marcador |
| --- | --- |
| `node_modules` ~977 MB domina o app — monorepo + toolchain de build/lint/test + Prisma engines + `embedded-postgres`/`tsx` dev-only arrastados p/ runtime | **DEBITO** de imagem |
| Mídia servida remota do CDN TMDB; servidor não guarda blobs; `public` só tem brand+demo | **REAL**, decisão correta |
| Home e todas as listagens são `force-dynamic` (~20–30 queries/req, memoizadas por request); detalhes usam ISR 1h | **PARCIAL** (home poderia ser ISR) |
| N+1 só no hero, capado a 5 slides; loaders de índice usam batch `IN` | **NÃO BLOQUEIA PRODUÇÃO** |
| `next/image` não usado; 21 `<img>` crus → sem otimização, risco de LCP/CLS no hero | **RISCO** de Core Web Vitals |
| Data dir ~71 MB p/ ~16 MB lógicos = WAL/catálogos normais | **NÃO BLOQUEIA PRODUÇÃO** |
| `output: "standalone"` ausente em `next.config.ts` → imagem carrega `node_modules` inteiro | **PROXIMO PASSO** |

Nenhum dos itens acima é bug de correção nem viola invariante de governança (o render segue
puro de Postgres, sem API externa e sem mídia local). São **otimizações de custo de imagem
e de Core Web Vitals**, todas seguras de adiar. **NÃO BLOQUEIA PRODUÇÃO** — o gargalo real do
projeto é domínio/conteúdo (estrelas ausentes em títulos TMDB, mocks que vazam, `SITE_URL`
hardcoded), não peso ou performance. **PROXIMO PASSO** recomendado: **não otimizar
performance antes de resolver o domínio**; quando otimizar, começar por `output: standalone`
+ `pnpm prune --prod` (imagem) e migrar a home para ISR + fixar dimensões de imagem no hero
(LCP/CLS).


---

## Parte 24 — Seguranca e segredos

Esta secao audita como o Screen trata segredos, chaves de API, superficie de exposicao ao cliente, protecao do admin e os guards automatizados que deveriam impedir vazamento. A conclusao curta: **o desenho de segredos e disciplinado e correto no papel e no codigo hoje existente** (nenhuma chave vaza para o bundle do cliente, nenhum `.env` real esta versionado, o admin tem Basic Auth fail-closed por ambiente), mas ha **buracos de cobertura de guard** (o auditor de pureza nao varre `scripts/`, `services/` nem `apps/admin`, e nao ha guard nenhum contra literal de segredo/token) e **um RISCO de dominio hardcoded** que rebaixa a governanca de SEO/segredo a "confie no dev". Nenhum vazamento de chave real foi encontrado.

---

### 24.1 Inventario de variaveis de ambiente e classificacao de sensibilidade

Fontes lidas: `.env.example` (via git, o arquivo esta permission-denied a leitura direta mas identico ao commit), `docs/CLOUDPANEL_DEPLOY.md:557-595`, `apps/admin/src/lib/access-protection.ts:52-58`.

| Variavel | Papel | Sensivel? | Quem le (confirmado) | Chega ao cliente? |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | Connection string PostgreSQL (usuario/senha embutidos) | **SIM (segredo)** | `packages/db/src/server.ts` (Prisma, server-only); scripts de validacao em `apps/web/scripts/*` e `apps/admin/scripts/*` | **NAO** |
| `THE_SCREEN_PUBLIC_SITE_URL` | URL canonica publica | Nao (publica por design) | **NINGUEM no codigo** — ver 24.6 (**DEBITO/RISCO**) | (seria a unica publica) |
| `TMDB_READ_ACCESS_TOKEN` (v4) | Bearer TMDB, preferido | **SIM (segredo)** | `api-clients/tmdb/src/config.ts` (offline); `services/ingestion/bin/ingest-public-catalog.ts` | **NAO** |
| `TMDB_API_KEY` (v3) | Chave TMDB fallback | **SIM (segredo)** | idem TMDB config offline | **NAO** |
| `GEMINI_API_KEY` | Chave Gemini | **SIM (segredo)** | `services/entity-writer/src/gemini/config.ts` (offline) | **NAO** |
| `GEMINI_MODEL` / `GEMINI_API_BASE_URL` / `GEMINI_MAX_RPS` / `GEMINI_MAX_RETRIES` / `GEMINI_BREAKER_*` | Tuning do worker Gemini | Nao (config) | entity-writer offline | **NAO** |
| `SCREENA_RATINGS_PROVIDER_KEY` | Chave do `provider_api` de ratings | **SIM (segredo)** | roadmap (`services/ratings` inativo) | **NAO** |
| `SCREENA_STREAMING_PROVIDER_KEY` | Chave do provedor de streaming | **SIM (segredo)** | roadmap (`services/streaming` inativo) | **NAO** |
| `SCREENA_REDIS_URL` | URL Redis (pode conter senha) | **SIM (segredo)** | roadmap/cache | **NAO** |
| `POSTGRES_PASSWORD` | Senha do Postgres dev (docker-compose) | **SIM (segredo)** | `docker-compose.dev.yml` (fallback dev) | **NAO** |
| `NODE_ENV` / `VERCEL_ENV` | Sinais de ambiente | Nao | admin access-protection, home placeholder governance | injetados no build (nao-segredo) |
| `ADMIN_PROTECTION_ENABLED` | Liga Basic Auth explicito | Nao (flag) | `apps/admin/middleware.ts:35` | **NAO** |
| `ADMIN_BASIC_AUTH_USER` | Usuario Basic Auth admin | **SIM (segredo)** | `apps/admin/middleware.ts:36` + `src/lib/access-protection.ts` | **NAO** |
| `ADMIN_BASIC_AUTH_PASSWORD` | Senha Basic Auth admin | **SIM (segredo)** | `apps/admin/middleware.ts:37` | **NAO** |
| `ADMIN_EDITORIAL_ACTIONS_ENABLED` | Flag de escrita editorial | Nao (flag) | `apps/admin/src/server/editorial-actions-status.ts:30` | **NAO** |
| `SCREEN_HOME_VISUAL_PLACEHOLDERS` | Flag de placeholders da home | Nao (flag) | `apps/web/src/lib/home-placeholder-governance.ts:47` | **NAO** |
| `STAGING_SEED_CONFIRM` / `PUBLIC_DEMO_CONFIRM` (via `*_CONFIRM_ENV`) | Guardas de confirmacao de seed | Nao | scripts de seed | **NAO** |

**Achado de higiene:** as tres `ADMIN_*` de auth **nao estao documentadas no `.env.example`** — ele lista TMDB/Gemini/ratings/streaming/Redis/DATABASE_URL, mas nao `ADMIN_BASIC_AUTH_USER/PASSWORD/PROTECTION_ENABLED`. Elas so aparecem em `access-protection.ts` e no deploy doc. **DEBITO** (documentacao), **NAO BLOQUEIA PRODUCAO**: o codigo faz fail-closed sem elas (nega acesso), entao esquecer de setar => admin 401, nao admin aberto.

---

### 24.2 Alguma chave vaza para o bundle do cliente? (Resposta: NAO)

Tres verificacoes independentes, todas negativas:

1. **`NEXT_PUBLIC_` em `apps/web`/`apps/admin`:** o unico match e um **comentario** em `apps/web/src/lib/home-placeholder-governance.ts:17` que explicitamente diz "NAO e `NEXT_PUBLIC_*`: nunca vaza para o bundle do cliente". **Nao existe nenhuma variavel `NEXT_PUBLIC_*` definida no projeto** — logo nenhuma env e forcada ao bundle pelo mecanismo publico do Next. **REAL** / seguro.
2. **`process.env` em client components (`"use client"`):** os client components de `apps/web` (`app/_components/hero-carousel.tsx`, `episodes-ticker.tsx`, `coming-soon-rail.tsx`, `site-footer.tsx`, `site-header.tsx`) **nao contem `process.env`**. Todo `process.env` de `apps/web` vive em modulos server (`src/lib/home-placeholder-governance.ts`, `src/server/movie-page.ts`) ou em `scripts/` (harness de validacao). **REAL**.
3. **Tokens TMDB/Gemini em `apps/web`:** grep por `TMDB_READ_ACCESS_TOKEN`/`TMDB_API_KEY`/`GEMINI_API_KEY` retorna **zero** ocorrencias em `apps/web`; elas so aparecem em `api-clients/tmdb/`, `services/*` e docs. Confere com o fato ja auditado (status doc `docs/SCREEN_STATUS_AFTER_EASYPANEL_AND_HOME_V4_1.md:138-140`).

**Classificacao:** exposicao de segredo ao cliente = **NAO IMPLEMENTADO como risco** (nao ha vazamento). **NAO BLOQUEIA PRODUCAO**.

---

### 24.3 `DATABASE_URL` e Prisma sao server-only?

Sim, por construcao e por guard.

- O Prisma Client vive em `packages/db/src/server.ts:12` (`import { PrismaClient } from '@prisma/client'`), cujo cabecalho afirma "SERVER-ONLY ... NUNCA pode ser importado pelo render publico (apps/web)". O barrel `packages/db/src/index.ts:13` exporta **apenas** `seed-data` (dados puros) — quem quiser o client precisa importar explicitamente `@screena/db/server`.
- `apps/web/src/server/movie-page.ts:19` importa `@screena/db/server` e o cabecalho (`:12-15`) documenta que o arquivo **nao** carrega `"use client"` e a delimitacao server e "por diretorio + ausencia de `use client`, nao por import".
- O guard `scripts/audit/check-render-purity.mjs` bloqueia `@screena/db` (`:143-144`) importado em **page/layout** e bloqueia `@screena/db` em **qualquer** arquivo com `"use client"` (`CLIENT_IMPORT_PATTERNS`, `:183-193`). Ou seja: `DATABASE_URL` so e alcancavel via Prisma em codigo server, e o Prisma nunca entra em client component sem o guard falhar.

`DATABASE_URL` chegar ao cliente exigiria (a) um client component importando `@screena/db/server` — barrado pelo guard; ou (b) `NEXT_PUBLIC_DATABASE_URL` — inexistente. **REAL** / seguro. **NAO BLOQUEIA PRODUCAO**.

---

### 24.4 O que o guard de pureza (`check-render-purity.mjs`) varre — e o GAP de cobertura

Confirmado lendo `scripts/audit/check-render-purity.mjs:54-57` e `:337-351`:

```
const WEB_DIR = path.join(ROOT, 'apps', 'web');   // :57
...
async function scanWeb() { ...collectFiles(WEB_DIR)... }   // :337-351
```

**O guard varre EXCLUSIVAMENTE `apps/web/` (recursivo).** Ele NAO varre `apps/admin/`, `scripts/`, `services/`, `api-clients/`, `packages/` nem `workers/`. O que ele detecta dentro de `apps/web` (`:378-412`):

| Regra | Escopo | O que pega |
| --- | --- | --- |
| `FETCH_PATTERNS` (`:95-99`) | todo arquivo de `apps/web` | `fetch(` para host externo (tmdb, themoviedb, rapidapi, googleapis, gemini, generativelanguage, rottentomatoes, imdb) |
| `FORBIDDEN_LITERAL_PATTERNS` (`:117-122`) | todo arquivo **exceto** o helper `apps/web/src/lib/tmdb-image-url.ts` (`:130`) | literal `image.tmdb.org` |
| `GLOBAL_IMPORT_PATTERNS` (`:164-175`) | todo arquivo de `apps/web` | import de Entity Writer / SDK Gemini |
| `IMPORT_PATTERNS` (`:136-156`) | apenas `page/layout/template/default` (`:201-214`) | import de api-clients / `@screena/db` / services / tmdb-client |
| `CLIENT_IMPORT_PATTERNS` (`:183-193`) | apenas arquivos com `"use client"` | import de `@screena/db` / api-clients |

**GAP #1 — o guard NAO tem nenhuma regra de segredo/token.** Ele protege contra **chamada de rede externa e import server-only no cliente**, mas **nao** procura por literais de chave (`TMDB_READ_ACCESS_TOKEN`, `Bearer `, `sk-`, `AIza...`) nem por `process.env.<segredo>` dentro de client component. A protecao contra vazamento de token e **indireta** (via ausencia de `NEXT_PUBLIC_` e via convencao), nao um guard positivo. **DEBITO**, **NAO BLOQUEIA PRODUCAO** hoje (porque de fato nao ha token no front), mas e uma regressao silenciosa esperando acontecer: um dev que escreva `const t = process.env.TMDB_API_KEY` num `"use client"` **passa** no `audit:render`.

**GAP #2 — `scripts/` fora de qualquer varredura.** Confirmado: `WEB_DIR` e o unico alvo. Os scripts em `apps/web/scripts/*` e `apps/admin/scripts/*` manipulam `process.env.DATABASE_URL` livremente (`apps/web/scripts/validate-*-real-postgres.ts:443,470,278...`; `apps/admin/scripts/staging-seed.ts:248`). Isso e **correto** (sao harness offline), mas significa que **nenhum guard automatizado protege `scripts/`** — se um script passasse a imprimir `DATABASE_URL` ou um token em log, nada quebraria o CI. Este e exatamente o GAP apontado no briefing e esta **CONFIRMADO**. **DEBITO**, **NAO BLOQUEIA PRODUCAO** (scripts sao offline e nao vao ao bundle), mas e ponto cego de auditoria.

**GAP #3 — `apps/admin` sem guard de pureza de render nem de segredo.** O admin le Postgres server-side (permitido, `apps/admin/next.config.ts:8-9`), mas nenhum `audit:render` roda sobre ele. A protecao do admin e outra (Basic Auth + guard de escrita, ver 24.7), nao pureza de render.

---

### 24.5 Risco de token TMDB em log de build do Nixpacks (build precisa de segredo?)

**O build NAO precisa de nenhum segredo de API.** Cadeia de fatos:

- `package.json:build` (working tree) = `corepack pnpm --filter @screena/web build` -> `next build`.
- O render publico e puro (invariante 3): `apps/web/next.config.ts:6-9` e o guard `check-render-purity` garantem que nenhuma pagina chama TMDB/Gemini. Logo `next build` **nao fala com TMDB** e nao tem por que receber `TMDB_READ_ACCESS_TOKEN` como build arg.
- As paginas sao `force-dynamic` (status doc `:468`), entao o build nem precisa de `DATABASE_URL` para pre-render.
- A unica env legitimamente necessaria em **runtime** e `DATABASE_URL` (leitura) + as `ADMIN_*` (admin) + `THE_SCREEN_PUBLIC_SITE_URL` (quando for wired). Nenhuma delas e **build-time**.

**Conclusao/classificacao:** injetar qualquer `*_API_KEY`/`*_PROVIDER_KEY`/`TMDB_*` como **build arg** do Nixpacks e desnecessario e seria um **RISCO** (segredo em cache de camada de build e em log de build). O correto e injetar segredos como **env de runtime** (EasyPanel/systemd `EnvironmentFile`, `docs/CLOUDPANEL_DEPLOY.md:416,445`), nunca como ARG. Como o token TMDB so e usado por worker offline (systemd separado), ele **nem deveria existir no ambiente de build do site**. Este e o "warning de segredo no Nixpacks" que o proprio status doc marca como acao recomendada (`:500`). Severidade: **RISCO** / **NAO BLOQUEIA PRODUCAO** *se* o operador injetar segredos como runtime env (comportamento default esperado); vira **BLOQUEIA PRODUCAO** apenas se alguem configurar TMDB/Gemini como build arg. **PROXIMO PASSO:** confirmar no painel EasyPanel que segredos sao "environment variables" de runtime e nao build args, e **nao** passar TMDB/Gemini ao servico web (so ao worker).

---

### 24.6 `SITE_URL` hardcoded — segredo de configuracao ausente (RISCO)

`apps/web/src/lib/site.ts:9` fixa `export const SITE_URL = "https://thescreen.media"`. A env `THE_SCREEN_PUBLIC_SITE_URL` existe no `.env.example` e e documentada no deploy doc (`docs/CLOUDPANEL_DEPLOY.md:560` "Usada em canonicals, sitemap, OG") **mas nao e lida por nenhum arquivo de codigo** — grep confirma que so aparece em docs e em `.env.example`, nunca em `apps/web`. `robots.ts`, `sitemap`, canonical e `metadataBase` (`layout.tsx:21`) todos derivam do literal.

Impacto de seguranca/governanca: qualquer deploy em dominio temporario/staging (ex.: `staging.thescreen.media` ou o host cru `:3000` do EasyPanel) **emite canonical/OG/sitemap apontando para producao** e o `robots.txt` aponta o sitemap para producao — um ambiente nao-canonico se torna indexavel afirmando ser o canonico. Nao e vazamento de credencial, mas e **configuracao sensivel travada em codigo** que o deploy doc **afirma** ser configuravel por env e nao e. **CONFIRMADO**. Classificacao: **RISCO** + **DEBITO**; para o dominio de producao real coincidir com o literal, hoje **NAO BLOQUEIA PRODUCAO**; para qualquer staging/preview e **BLOQUEIA PRODUCAO** do staging (indexacao cruzada). **PROXIMO PASSO / URGENTE:** wire `SITE_URL` para ler `THE_SCREEN_PUBLIC_SITE_URL` (fallback ao literal), fechando a divergencia codigo x doc.

---

### 24.7 Admin: Basic Auth stateless, fail-closed por ambiente, e guard de escrita

**Basic Auth (`apps/admin/src/lib/access-protection.ts` + `apps/admin/middleware.ts`):** implementacao solida e defensiva.

- **Stateless por ENV:** usuario/senha vem so de `ADMIN_BASIC_AUTH_USER/PASSWORD` (`:331-332`); sem cookie, sessao, JWT, banco ou API externa (`:6-11`). Middleware cobre todas as rotas exceto assets (`middleware.ts:59`).
- **Fail-closed por ambiente (Fase 6C):** `isAdminProtectionRequired` (`:211-213`) exige Basic Auth sempre que `isProductionLikeAdminEnvironment` (`NODE_ENV=production` ou `VERCEL_ENV=production|preview`, `:170-196`) — **mesmo com `ADMIN_PROTECTION_ENABLED` ausente ou `"false"`**. Producao nunca sobe aberta por esquecimento de flag. `NODE_ENV=test` e tratado como development (`:178`), nunca production-like.
- **Sem credencial em producao => 401 (nega), nunca libera** (`evaluateAdminAccess` passo 2, `:376-378`; `hasAdminCredentials` `:220-222`). Fail-closed genuino.
- **Higiene de segredo:** comparacao **constant-time** propria sobre bytes UTF-8 (`constantTimeEquals`, `:310-322`) — Edge runtime nao garante `crypto.timingSafeEqual`; calcula match de usuario **e** senha antes de combinar (`:335-337`) para nao vazar por tempo qual campo falhou. Nenhuma funcao loga credencial; a projecao de diagnostico `redactAdminAccessConfigForDisplay` (`:531-553`) so expoe booleans/labels — usuario/senha nunca atravessam para a pagina `/security`. **REAL** / bem-feito.

Ponto de atencao (nao-defeito): a resposta 401 usa `Cache-Control: no-store` (`:400-405`) — correto. O `matcher` deixa `_next/static`, `_next/image`, `favicon.ico` fora do gate (`middleware.ts:59`) — aceitavel (assets internos, sem dado editorial).

**Guard de escrita (`tests/admin/no-write-endpoints.test.ts`):** varre `apps/admin/app` + `apps/admin/src` (`:13-16`) e falha se encontrar `"use server"` (server action) ou `export function POST|PUT|PATCH|DELETE` / `export const POST|...` (route handler de escrita) (`:20-24`). Isto trava o admin em read-only no nivel de teste. **Nota:** este guard e coerente com o admin de fase read-only, mas a memoria do projeto indica que Fase 7 introduziu escrita editorial via server actions atras da flag `ADMIN_EDITORIAL_ACTIONS_ENABLED`; **NAO FOI POSSIVEL CONFIRMAR** nesta secao se este teste especifico ainda passa ou foi ajustado no working tree (ele aparece como `?? tests/admin/no-write-endpoints.test.ts` untracked no git status). Se coexistem `"use server"` (Fase 7) e este guard, ha tensao — recomenda-se verificar na Parte de admin/testes. Classificacao: **DEBITO** de verificacao cruzada.

---

### 24.8 Segredos versionados / docker / .gitignore

- **Nenhum `.env` real esta versionado.** `git ls-files` retorna **apenas** `.env.example`; `.env` (working tree, 1169 bytes) e ignorado por `.gitignore:22-24` (`.env` + `.env.*` com excecao `!.env.example`). **REAL** / seguro.
- **`.env.example` nao contem segredo real:** valores sao placeholders (`your_gemini_api_key_here`, campos TMDB vazios) e a senha Postgres e um placeholder local declarado (`screena_dev_password`). Aceitavel para dev.
- **`docker-compose.dev.yml`** usa `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-screena_dev_password}` — fallback **so de dev**, sobrescrevivel por env, comentado como tal. **NAO BLOQUEIA PRODUCAO** (compose e dev-only; producao usa `DATABASE_URL` em `.env.production` `0600`, `docs/CLOUDPANEL_DEPLOY.md:230,575`).
- Deploy doc reforca higiene: `.env.production` em `shared/`, `chmod 600`, fora do git, symlink por release (`:224-236`); porta 3000 nunca exposta, so Nginx local a alcanca (`:329`); pg_dump/backup de `shared/` (`:307-312`). Postura documental **REAL** e alinhada as invariantes ("API keys so em env vars").

---

### 24.9 CI nao exercita os guards de segredo/pureza (o guard existe mas nao roda no commit)

Fato ja confirmado e reconfirmado aqui: o **CI COMMITADO** (`git show HEAD:.github/workflows/ci.yml`) roda apenas `typecheck`, `lint`, `test` (linhas 28/31/34) e **nao** roda `audit:render` nem `build`; `HEAD:package.json` sequer tem script `build`. As melhorias (`audit:invariants` linha 39, `audit:render` linha 42, `build` linha 45) **so existem no working tree sujo**, ainda nao commitado.

Consequencia de seguranca: **na revisao de PR real (contra HEAD), o guard de pureza de render — a unica defesa automatizada contra import server-only/fetch externo no cliente — NAO executa.** A protecao contra vazar `@screena/db`/token para o bundle depende de rodar `pnpm audit:render` localmente, o que nao esta garantido. Classificacao: **RISCO** + **DEBITO**, **BLOQUEIA PRODUCAO** no sentido de gate de qualidade (um PR que introduza `@screena/db` num client component seria mergeado verde pelo CI atual). **PROXIMO PASSO / URGENTE:** commitar o `ci.yml` do working tree (que ja adiciona `audit:render`/`audit:invariants`/`build`) para que o guard efetivamente proteja `main`.

---

### 24.10 Resumo de achados classificados

| # | Achado | Arquivo/evidencia | Classificacao | Producao |
| --- | --- | --- | --- | --- |
| 1 | Nenhuma chave vaza ao bundle; sem `NEXT_PUBLIC_*`; sem token/`process.env` de segredo em client component | grep `apps/web` | **REAL** (seguro) | **NAO BLOQUEIA** |
| 2 | Prisma/`DATABASE_URL` server-only, protegido por guard de import | `packages/db/src/server.ts:12`; `check-render-purity.mjs:143,183-193` | **REAL** (seguro) | **NAO BLOQUEIA** |
| 3 | Admin Basic Auth fail-closed por ambiente + constant-time + sem log de credencial | `access-protection.ts:211-213,310-322,531-553` | **REAL** (bem-feito) | **NAO BLOQUEIA** |
| 4 | `.env` nao versionado; `.env.example` sem segredo real; deploy doc com higiene 0600 | `git ls-files`; `.gitignore:22-24` | **REAL** (seguro) | **NAO BLOQUEIA** |
| 5 | Build nao precisa de segredo de API; TMDB/Gemini so em worker offline | `next.config.ts:6-9`; force-dynamic | **REAL** | **NAO BLOQUEIA** |
| 6 | Guard de pureza varre SO `apps/web`; `scripts/`, `services/`, `apps/admin` fora | `check-render-purity.mjs:57,337` | **DEBITO** (ponto cego) | **NAO BLOQUEIA** |
| 7 | Guard de pureza NAO tem regra de segredo/token; `process.env.TMDB_API_KEY` em `"use client"` passaria | `check-render-purity.mjs` (sem FORBIDDEN secret pattern) | **DEBITO** / **RISCO** latente | **NAO BLOQUEIA** hoje |
| 8 | TMDB/Gemini como build arg do Nixpacks vazaria em log de build; desnecessario | 24.5; status doc `:500` | **RISCO** | **NAO BLOQUEIA** se runtime env; **BLOQUEIA** se build arg |
| 9 | `SITE_URL` hardcoded; `THE_SCREEN_PUBLIC_SITE_URL` documentada mas nunca lida | `site.ts:9`; deploy doc `:560` | **RISCO** + **DEBITO** | **NAO BLOQUEIA** prod canonica; **BLOQUEIA** staging |
| 10 | `ADMIN_*` de auth ausentes do `.env.example` | `.env.example` vs `access-protection.ts:52-58` | **DEBITO** (doc) | **NAO BLOQUEIA** (fail-closed) |
| 11 | CI commitado nao roda `audit:render`/`build`; guard so no working tree sujo | `git show HEAD:.github/workflows/ci.yml`; `HEAD:package.json` | **RISCO** + **DEBITO** | **BLOQUEIA** (gate de qualidade) |

**URGENTE (ordem de prioridade):**
1. **Commitar o `ci.yml` do working tree** para que `audit:render`/`audit:invariants`/`build` protejam `main` (achado 11) — sem isso, todos os outros guards sao teatro em PR.
2. **Wire `SITE_URL` -> `THE_SCREEN_PUBLIC_SITE_URL`** (achado 9) antes de qualquer deploy em host temporario/staging, para nao indexar dominio nao-canonico afirmando ser producao.
3. **Confirmar no EasyPanel que segredos sao env de runtime, nao build arg**, e nao passar TMDB/Gemini ao servico web (achado 8).
4. **Estender o guard de pureza** para (a) varrer `scripts/`/`services/`/`apps/admin` e (b) adicionar uma regra de segredo (proibir `process.env.<KEY_SECRETA>` em `"use client"` e literal de token em `apps/web`) — achados 6 e 7.

**NAO FOI POSSIVEL CONFIRMAR:** se `tests/admin/no-write-endpoints.test.ts` (untracked) ainda passa dado que Fase 7 introduziu `"use server"` sob flag; deferido a secao de admin/testes.


---

## Parte 25 — Comparativo mestre de features

Esta secao coloca o Screen lado a lado com as seis referencias do setor — **IMDb**, **Rotten Tomatoes**, **TMDB**, **TV Time/Trakt**, **Letterboxd** e **JustWatch** — feature a feature. O objetivo **nao** e sugerir paridade: o Screen e ordens de magnitude menor, tem **catalogo de dezenas de titulos** (backfill manual de 10 filmes + 10 series, `services/ingestion/bin/ingest-public-catalog.ts:59-60`), **nenhum modelo de usuario** e a maior parte das superficies de dado ainda em placeholder ou seed demo. O objetivo e **honestidade cirurgica**: mostrar exatamente o que existe hoje, contra o que essas plataformas entregam, e onde a arquitetura do Screen (entity-first + governanca de invariantes + `content_blocks` versionados + pureza de render) e uma **vantagem estrutural real** que essas referencias, por legado, nao tem.

Convencoes das tabelas:

- **Concorrentes** (`IMDb`, `Rotten Tomatoes`, `TMDB`, `TV Time/Trakt`, `Letterboxd`, `JustWatch`): `Sim` (feature madura), `Parcial` (existe mas limitada/secundaria), `Nao` (ausente), `N/A` (nao se aplica ao modelo do produto).
- **Status Screen**: marcadores canonicos deste relatorio — **REAL** (funciona com dado real), **PARCIAL** (codigo real, cobertura ou dado incompleto), **PLACEHOLDER** (UI/tabela existe, dado so em seed demo ou mock), **NAO IMPLEMENTADO** (ausente), com anotacoes **DEBITO**/**RISCO**/**BLOQUEIA PRODUCAO** onde couber.
- **Prioridade**: **P0** (bloqueia subir o dominio oficial), **P1** (produto minimo entity-first), **P2** (diferencial competitivo), **P3** (longo prazo).

---

### 25.1 Entidades & Conteudo

| Feature | IMDb | Rotten Tomatoes | TMDB | TV Time/Trakt | Letterboxd | JustWatch | Screen hoje | Status Screen | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pagina de filme | Sim | Sim | Sim | Sim | Sim | Sim | Rota `/pt/filmes/[slug]/` real, ISR 3600s, JSON-LD `Movie`+`BreadcrumbList` | **PARCIAL** | P1 | Ficha real, mas corpo editorial depende do Entity Writer; JSON-LD minimo sem `image`/`director`/`actor` (`filmes/[slug]/page.tsx:33,119-126`) |
| Pagina de serie | Sim | Sim | Sim | Sim | Nao | Sim | Rota `/pt/series/[slug]/` real, ISR 3600s, JSON-LD `TVSeries`+`BreadcrumbList` | **PARCIAL** | P1 | Diferenciacao filme/serie por label+badge+breadcrumb+schema+URL correta (invariante 11, `series/[slug]/page.tsx:100-139`) |
| Pagina de pessoa | Sim | Sim | Sim | Parcial | Sim | Parcial | Rota `/pt/pessoas/[slug]/` codificada, JSON-LD `Person` | **PARCIAL / DEBITO** | P1 | A ingestao **nunca cria slug de pessoa** (so `movie\|tv`); na base real nenhuma rota de pessoa resolve — so fecha no seed demo (`ingest-public-catalog.ts:173`, `person-page.ts:71`) |
| Temporadas | Sim | Parcial | Sim | Sim | N/A | Parcial | `Season` ingerido; lista inline na pagina da serie | **PARCIAL** | P2 | Sem rota `/temporada-{n}/` e sem JSON-LD `TVSeason` (`series-page.ts:112`, fato: nao existe subdir de `[slug]`) |
| Episodios | Sim | Parcial | Sim | Sim | N/A | Parcial | `Episode` ingerido (FK composta); lista inline sem paginacao | **PARCIAL** | P2 | Sem rota de episodio nem `TVEpisode`; `still_path` mapeado mas nunca renderizado (`series-presenter.ts:304`) |
| Elenco | Sim | Sim | Sim | Parcial | Sim | Parcial | `CastStrip` real nas fichas, cap 24/12 | **PARCIAL** | P1 | Nome vira **texto morto** sem slug de pessoa na base real (`cast-strip.tsx:48`) |
| Equipe (crew/direcao) | Sim | Parcial | Sim | Parcial | Sim | Nao | `crew_members` ingerido no banco | **NAO IMPLEMENTADO** | P2 | Crew so lido no hero (diretor) e na pessoa; **nenhuma secao de ficha tecnica** nas fichas (`movie-page.ts` nunca consulta crew) |
| Poster / backdrop | Sim | Sim | Sim | Sim | Sim | Sim | Imagens remotas `image.tmdb.org` via helper governado | **REAL** | P1 | Sem download local, sem `next/image`; unica excecao de pureza de render nomeada (`tmdb-image-url.ts:40`, `check-render-purity.mjs:130`) |
| Trailer | Sim | Sim | Sim | Parcial | Parcial | Parcial | Botao play decorativo `aria-hidden` | **NAO IMPLEMENTADO** | P2 | Sem model `Trailer` no schema; `has_trailer` e so campo de auditoria (`[slug]/page.tsx:200`) |
| Fotos / galeria | Sim | Sim | Sim | Parcial | Parcial | Nao | Tres tiles vazios na ficha | **NAO IMPLEMENTADO** | P3 | Sem model `Image`; TMDB `images` nem declarado nos endpoints (`endpoints.ts`) |

---

### 25.2 Notas & Reviews

| Feature | IMDb | Rotten Tomatoes | TMDB | TV Time/Trakt | Letterboxd | JustWatch | Screen hoje | Status Screen | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Nota propria (agregada) | Sim (IMDb rating) | Sim (Tomatometer/Popcornmeter) | Sim (vote average) | Sim (user rating) | Sim (media 5★) | Nao | `screen_score` (nota **editorial** propria, escala/exibicao) nas colunas | **PLACEHOLDER** | P1 | Populado **so pelo seed demo**; ingestao TMDB nunca escreve `screenScore`. Base real do EasyPanel fica sem estrelas (`public-demo-seed.ts:261`, `store.ts:153-172`) — **RISCO** de UI vazia |
| Ratings externos (IMDb/RT/Metacritic...) | Parcial (Metacritic) | Nao | Nao | Nao | Nao | Sim (agrega 3 fontes) | Tabela `external_ratings` + `validateRating` + `source_licenses` | **NAO IMPLEMENTADO** | P2 | Zero writer/reader de `external_ratings`; `validateRating` so chamado em teste. Governanca (IMDb≠RT, `provider_api`≠`rating_source`) **ja codificada e travada** (`ratings.ts:93`, `ratings.test.ts`) |
| Reviews de criticos | Parcial | Sim (core) | Nao | Nao | Nao | Nao | `block_type review_summary` no enum + `prompts/review_summary.md` | **NAO IMPLEMENTADO** | P3 | Entity Writer so produz `editorial_intro`\|`cast_intro`; nenhum `Review` no JSON-LD (`entity-writer/src/types.ts:24`) |
| Reviews de usuarios | Sim | Sim (audience) | Sim | Sim | Sim (core) | Nao | — | **NAO IMPLEMENTADO** | P3 | **Sem model `User`** no schema — decisao estrutural entity-first, nao lacuna acidental (`schema.prisma`, `pt/page.tsx:311`) |

---

### 25.3 Descoberta & SEO

| Feature | IMDb | Rotten Tomatoes | TMDB | TV Time/Trakt | Letterboxd | JustWatch | Screen hoje | Status Screen | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Streaming availability (dado) | Sim | Sim | Sim | Parcial | Sim | Sim (core) | Tabela `watch_availability` + leitor com gate de licenca | **PLACEHOLDER** | P2 | Unico produtor de linhas e o seed demo (`display_allowed=true`, `providerApi='public-demo-seed'`); `services/streaming/` so tem README (`entity-watch.ts:41`, `public-catalog...` nao escreve) |
| "Onde assistir" (UI + carimbo) | Sim | Sim | Sim | Parcial | Sim | Sim | `WatchProviders` + carimbo "Atualizado em" (`fetched_at`) | **PLACEHOLDER** | P2 | Caminho banco→presenter→UI real e testado, mas base ingerida deixa a secao vazia; `watch_availability` sem `license_status` nem `@@unique` (`schema.prisma:626`) |
| Calendario de episodios | Parcial | Nao | Parcial | Sim (core) | N/A | Parcial | `EpisodesTicker` na home | **PLACEHOLDER / BLOQUEIA PRODUCAO** | P2 | Array hardcoded afirma "novo episodio hoje" + "Onde assistir NETFLIX/Max"; **ungated**, viola invariantes 6 e 8 se subir (`episodes-ticker.tsx:53-91`, `pt/page.tsx:648`) |
| Noticias | Sim | Sim | Nao | Nao | Parcial | Parcial | Rotas `/pt/noticias/` + gate de licenca `NewsArticle` reais | **PLACEHOLDER** | P2 | Nenhum worker escreve `articles`; RSSPRIME/MN26 inativos (`services/news-ingestion/` so README); home usa manchetes mock gateadas (`news-pages.ts`, `pt/page.tsx:185`) |
| Recomendacoes / similares | Sim | Parcial | Sim | Sim | Parcial | Sim | — | **NAO IMPLEMENTADO** | P3 | Sem relacao de similaridade no schema; `similar_titles_intro` sem prompt/pipeline (fato 214) |
| Listas / colecoes | Sim | Parcial | Sim | Sim | Sim (core) | Parcial | — | **NAO IMPLEMENTADO** | P3 | Sem model de lista nem de franquia; `franchises` declarada em `database/schema.md` mas ausente do Prisma |
| Busca | Sim | Sim | Sim | Sim | Sim | Sim | Header aponta a `/pt/explorar/` (link, nao campo) | **NAO IMPLEMENTADO** | P2 | Sem endpoint/indice de busca; nenhum `discover/search` do TMDB implementado (`site-header.tsx:82`, `endpoints.ts`) |
| Explorar / navegacao | Sim | Sim | Sim (discover) | Parcial | Sim | Sim (filtros) | `/pt/explorar/` real, contagens reais, JSON-LD | **PARCIAL** | P1 | Hub de contagem sem filtros nem paginacao (`explorar/page.tsx:45`) |
| Trending | Sim | Parcial | Sim | Sim | Sim | Sim | "Rank #N" na home = posicao de slot | **NAO IMPLEMENTADO** | P2 | Sem discovery TMDB (popular/trending/changes); `fillSlots` chega a repetir itens (`pt/page.tsx:674`, fato 60) |
| Popularidade | Sim (STAR/MOVIEmeter) | Parcial | Sim | Sim | Sim | Sim | `popularity` ingerido em Movie/TvShow | **NAO IMPLEMENTADO** | P3 | Coluna existe mas nunca exibida nem usada para ordenar; `Person` nem tem a coluna (fato 277) |
| SEO programatico | Sim | Sim | Parcial | Nao | Sim | Sim | `generateMetadata` + `evaluateIndexability` + gate anti-thin por rota | **PARCIAL** | P1 | **Nucleo do diferencial.** Gate de ≥2 blocos de valor real; mas `force-dynamic` sem `generateStaticParams` e `SITE_URL` hardcoded (`indexability.ts`, `site.ts:9` — **RISCO** de dominio) |
| Schema.org (JSON-LD) | Sim | Sim | Parcial | Parcial | Sim | Sim | Tipo correto por rota (`Movie`/`TVSeries`/`Person`/`NewsArticle`/`CollectionPage`/`BreadcrumbList`) | **PARCIAL** | P1 | Sem `AggregateRating` falsa (correto, invariante); mas `Movie` minimo e home **sem JSON-LD** (`filmes/[slug]/page.tsx:117`, fato 24) |
| Sitemap | Sim | Sim | Sim | Parcial | Sim | Sim | `sitemap.xml` deriva de `content_blocks` com gate espelhado | **PARCIAL** | P1 | `page_indexability_decisions` nunca escrita; fallback sem banco lista rotas sem gate (`sitemap-entries.ts:78`, `sitemap-presenter.ts:145`) |

---

### 25.4 Usuario/Social & Operacao

| Feature | IMDb | Rotten Tomatoes | TMDB | TV Time/Trakt | Letterboxd | JustWatch | Screen hoje | Status Screen | Prioridade | Observacao |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Watchlist | Sim | Sim | Sim | Sim | Sim | Sim | Botao "Marcar" `aria-disabled` sem handler | **NAO IMPLEMENTADO** | P3 | Sem model `User`/`Watchlist`; affordance e `<span aria-disabled>` (`pt/page.tsx:336`) |
| Marcar como assistido | Parcial | Parcial | Parcial | Sim (core) | Sim (core/diary) | Parcial | Botao "Avaliar/Marcar" `aria-disabled` | **NAO IMPLEMENTADO** | P3 | Idem: sem usuario, sem estado, sem mutation (`pt/page.tsx:340`) |
| Perfil de usuario | Sim | Sim | Sim | Sim | Sim | Parcial | — | **NAO IMPLEMENTADO** | P3 | Ausencia **intencional**: Screen e base entity-first, nao rede social (`site-header.tsx:26` documenta login/watchlist inativos) |
| Importacao de historico | Nao | Nao | Nao | Sim (core) | Sim | Nao | — | **NAO IMPLEMENTADO** | P3 | Depende de usuario; fora de escopo do MVP |
| Social / atividade | Parcial | Parcial | Parcial | Sim (core) | Sim (core) | Nao | — | **NAO IMPLEMENTADO** | P3 | Sem feed, follow ou atividade — coerente com o modelo entity-first |
| Admin editorial | Sim (interno) | Sim | Sim (comunidade) | Parcial | Parcial | Sim | Admin read-only + escrita **gateada** (review/index status via Server Actions), Basic Auth fail-closed, painel QA | **PARCIAL** | P1 | Nao cria entidades nem artigos; publicacao passa por humano (invariante 12). Forte no que faz (`editorial-actions.ts:85`, `middleware.ts:35`) |
| Ingestao automatizada | Sim | Sim | Sim (API publica) | Sim | Sim | Sim | Client TMDB resiliente (retry/breaker/throttle), upsert idempotente, `api_cache`+`api_sync_logs` | **PARCIAL** | P1 | So 5 endpoints (sem discovery/watch-providers); backfill **manual**, nenhum job agendado em producao (`http.ts`, `bin/import.ts`, fato 139) |
| Cache | Sim | Sim | Sim | Sim | Sim | Sim | `api_cache` (TTL 24h + short-circuit por hash) na ingestao | **PARCIAL** | P2 | Render publico e `force-dynamic` sem ISR na home/listagens; sem prune de `api_cache`, sem Redis (`cache.ts:52`, `pt/page.tsx:60`, fato 156) |
| Monitoramento | Sim | Sim | Sim | Sim | Sim | Sim | `api_sync_logs` gravado; healthcheck no admin | **NAO IMPLEMENTADO** | P1 | `api_sync_logs` e **write-only** (sem leitor/dashboard); app publico sem healthcheck (`GET /` = 404); sem backup Postgres (fatos 116, 135, 143) — **BLOQUEIA PRODUCAO** |

---

### 25.5 Leitura da matriz — tres conclusoes

**1) Onde o Screen esta MUITO atras (e por que e esperado).** Em quase toda a coluna "Usuario/Social & Reviews" o Screen marca **NAO IMPLEMENTADO** — watchlist, marcar assistido, perfil, importacao de historico, atividade social, reviews e notas de usuario. Isso nao e um buraco a tapar as pressas: **nao existe model `User` no schema Prisma**, e a home documenta explicitamente que login/watchlist estao inativos. TV Time, Trakt e Letterboxd sao, na essencia, redes sociais de consumo audiovisual — o valor deles e o grafo de usuarios, o diario e o feed. O Screen deliberadamente **nao compete nessa dimensao** neste ciclo. Igualmente atras: catalogo (dezenas de titulos contra milhoes), trailers, fotos, generos, recomendacoes, franquias, busca de verdade e trending real — todos ausentes ou em placeholder porque a ingestao cobre so 5 endpoints TMDB, sem discovery. E honesto dizer que, como catalogo bruto, **JustWatch e TMDB entregam hoje o que o Screen ainda promete**. A base de dados factual do Screen e, e continuara sendo por um bom tempo, majoritariamente TMDB reembalado — o que so vira produto quando a camada editorial por cima existir de fato.

**2) Onde ja ha vantagem estrutural — e por que importa para SEO de longo prazo.** As referencias foram construidas em eras em que "colar dado de terceiro na pagina" era acao segura. O Screen nasce depois disso, sob uma constituicao de 13 invariantes que **os concorrentes nao conseguem retroativamente adotar sem reescrever tudo**. Quatro travas concretas, todas ja no codigo e testadas: (a) **pureza de render** — nenhuma pagina indexavel chama API externa ou Gemini; a unica excecao (montar URL de imagem TMDB) e um helper governado com auditor lexical dedicado (`check-render-purity.mjs`), o que garante latencia e disponibilidade independentes de terceiros. (b) **Gate anti-thin real** — uma pagina so recebe `index` com ≥2 blocos de valor proprios (`evaluateIndexability`), o que estruturalmente **impede index bloat** — o cancer de SEO de sites programaticos que despejam milhares de fichas finas. (c) **`content_blocks` versionados** (`prompt_version`, `input_hash`, `output_hash`, `review_status`) com validacao anti-alucinacao contra payload controlado: o texto editorial e rastreavel e revisavel, algo que nenhuma dessas plataformas oferece sobre seu conteudo gerado. (d) **Separacao `provider_api` ≠ `rating_source` e IMDb ≠ Rotten Tomatoes** travada em `validateRating` — quando ratings externos forem ativados, eles ja nascem com atribuicao e licenca corretas. Nada disso da paridade de features hoje; mas define um **piso de qualidade** que, no horizonte de SEO de 2–3 anos (E-E-A-T, conteudo util, penalizacao de agregadores rasos), e exatamente o terreno em que agregadores legados sao vulneraveis.

**3) A menor fatia que torna o Screen defensavel.** A estrategia vencedor nao e "competir com IMDb" — e ser **util e indexavel** num nicho estreito de pt-BR. A menor fatia defensavel exige, em ordem: **(P0)** remover/gatear os mocks que mentem hoje (ticker de episodios, chips de plataforma, notas do seed demo vazando para prod) e resolver `SITE_URL`/`robots` por ambiente — sem isso o dominio oficial sobe ferindo invariantes 6 e 8; **(P1)** fechar o **loop entity-first minimo** para filme e serie: ingestao que **cria slug e traducao pt-BR de verdade** (inclusive de pessoa, hoje quebrada), pelo menos **2 `content_blocks` reais e revisados** por ficha prioritaria (basta `editorial_intro` + `cast_intro`, que o Entity Writer ja produz), e a decisao consciente de nota propria (`screen_score` para o catalogo real, nao so seed). Com isso — poster real + ficha real + 2 blocos editoriais proprios + JSON-LD correto + sitemap gateado — cada pagina de filme/serie **passa legitimamente o gate anti-thin** e entra no indice como conteudo proprio, nao como espelho de TMDB. Essa e a diferenca entre "mais um agregador raso" e "uma pagina que o Google tem motivo para rankear": nao milhares de fichas, mas **algumas centenas honestas, editorialmente diferenciadas e tecnicamente limpas**. Ratings externos, streaming real, noticias e usuarios (P2/P3) vem depois — cada um so quando houver licenca, worker e revisao humana, exatamente como a governanca ja exige.


---

## Parte 26 — Roadmap recomendado

O roadmap abaixo e derivado das Partes 1–25. A ordem nao e negociavel em um ponto: **Fase 0 (saneamento) vem antes do dominio oficial**. Publicar `thescreen.media` com o estado atual expoe placeholders que ferem invariantes 6 e 8 (ticker e chips de streaming falsos) e cria risco de SEO com canonical cruzado. Cada fase lista o **criterio de saida** (o que precisa estar verdadeiro para avancar) e marca o que **BLOQUEIA PRODUCAO**.

### Fase 0 — Saneamento antes do dominio oficial (P0, dias)

Objetivo: tornar a home **honesta** e o deploy **seguro** sem construir nenhuma feature nova.

| Item | Acao | Evidencia | Bloqueia? |
|---|---|---|---|
| Ticker mock | Gatear `<EpisodesTicker />` por `allowHomeVisualPlaceholders()` **ou** remover | `apps/web/app/pt/page.tsx:648` (hoje ungated) | **BLOQUEIA PRODUCAO** |
| Chips de streaming mock | Gatear/remover `HOME_VISUAL_PLATFORMS` nos tiles de serie | `apps/web/app/pt/page.tsx:133`, `:748` | **BLOQUEIA PRODUCAO** |
| Canonical/SITE_URL | Ler de env (`THE_SCREEN_PUBLIC_SITE_URL`) com fallback; nunca hardcode | `apps/web/src/lib/site.ts:9` | **BLOQUEIA PRODUCAO** |
| Indexacao do dominio temporario | `robots.ts` deve emitir `noindex`/`Disallow: /` quando o host nao for o canonico | `apps/web/app/robots.ts` (hoje `allow: /`) | **BLOQUEIA PRODUCAO** |
| Politica de nota | Decidir: ou popular `screen_score` para o catalogo real, ou aceitar catalogo sem estrelas (hoje so o seed demo tem nota) | Parte 12 | **BLOQUEIA PRODUCAO** (decisao, nao codigo) |
| CI commitada | Portar para `main` o CI do working tree que roda `audit:render` + `build` | `git show HEAD:.github/workflows/ci.yml` | **BLOQUEIA PRODUCAO** |
| Deploy de branch | Fazer merge de `feat/home-hero-carousel` -> `main` antes de qualquer deploy de `main` | 28 commits a frente de `origin/main` | **BLOQUEIA PRODUCAO** |
| Backup Postgres | Configurar `pg_dump` agendado + restore testado | `scripts/backup/README.md` declara ausencia | **BLOQUEIA PRODUCAO** |
| Migrations no release | Adicionar passo `prisma migrate deploy` ao release | Nenhum passo hoje | **BLOQUEIA PRODUCAO** |
| Comentarios stale | Revisar comentarios que dizem "next/image" onde a imagem e remota crua | Parte 5/23 | NAO BLOQUEIA |

**Criterio de saida:** uma pessoa anonima abrindo a home nao encontra nenhuma afirmacao falsa (episodio novo, plataforma, anuncio, nota inventada), o build de `main` roda `audit:render`, e um domínio temporario nunca serve canonical de producao nem e indexavel.

### Fase 1 — Dominio oficial e SEO base (P0→P1, dias)

Cloudflare + `thescreen.media`; `www` -> apex (301); SSL; `robots`/`sitemap`/`canonical` finais; Google Search Console + envio do sitemap; analytics; verificacao de que **so paginas com >= 2 blocos de valor** entram no sitemap. **Nao fazer Cloudflare antes de fechar a Fase 0.**

**Criterio de saida:** GSC verde, sitemap so com URLs `index`, canonical autorreferente por env, sem paginas finas indexadas.

### Fase 2 — Produto entity-first minimo (P1, semanas)

O maior buraco de SEO hoje: **nao existem rotas de temporada nem de episodio**, e as paginas de detalhe nao tem blocos de valor suficientes para indexar. Prioridades:

1. Rotas `/pt/series/{slug}/temporada-{n}/` e episodio, com `TVSeason`/`TVEpisode` no JSON-LD; ingerir temporadas/episodios (o upsert de `Season` ja existe; falta orquestrar e ingerir episodios).
2. Detalhe de filme/serie/pessoa mais denso: elenco comentado, contexto de franquia, obras parecidas, FAQ — os proprios blocos que o gate anti-thin aceita.
3. Links internos entidade↔entidade (filme→pessoa→filme; serie→temporada→episodio) para formar o grafo.
4. Ativar o Entity Writer em producao para `editorial_intro`/`cast_intro` com revisao humana, atingindo o gate de 2 blocos.

**Criterio de saida:** uma fatia de filmes/series prioritarios com `index` legitimo (>= 2 blocos de valor revisados), temporadas/episodios navegaveis.

### Fase 3 — Ratings e reviews (P2, semanas)

Screen Score editorial governado (escala 5, `screen_score_display`), TMDB `vote_average` atribuido **como TMDB** com licenca/atribuicao (ou mantido oculto), ativacao licenciada de `external_ratings`, `review_summary` do Entity Writer. Nunca `AggregateRating` fingindo nota propria; nunca converter escalas.

### Fase 4 — Onde assistir (P2, semanas)

`watch_availability` real via TMDB `/watch/providers` (atribuicao JustWatch obrigatoria), por pais, com `license_status`/`display_allowed` e carimbo "Atualizado em" (`last_synced_at`). Só entao os chips e o "Onde assistir" deixam de ser mock. CTA correto e legal.

### Fase 5 — Tracking tipo TV Time/Trakt (P3, meses)

Pre-requisito unico e caro: **identidade de usuario** (nao existe `model User`). Implica auth, LGPD, moderacao, e-mail, anti-spam. Só depois: watchlist, marcar assistido, progresso, calendario, importacao. Alta retencao, **baixo valor de SEO** — por isso vem depois da base indexavel.

### Fase 6 — Editorial (P3, meses)

Pipeline de noticias real (`services/news-ingestion/` hoje so tem README). RSS Prime e MN26 sao **pipelines externos, nao o Screen** — integrar como fonte, com licenca e `EntityNewsLink`, schema `NewsArticle`, gate editorial. Nunca republicar sinopse/critica de terceiros sem licenca.

### Fase 7 — Escala e operacao (P3, continuo)

Jobs/cron reais (o `services/sync/bin/run.ts` existe mas nunca foi agendado); monitoramento/healthcheck; prune de `api_cache`; `output: 'standalone'` para reduzir a imagem; cache de pagina onde `force-dynamic` nao e necessario; admin editorial pleno.


---

## Parte 27 — O que NAO fazer agora

Estas sao proibicoes ativas para o proximo ciclo. Cada uma protege uma decisao ja tomada ou uma invariante.

- **NAO voltar a salvar midia TMDB local (JPG/WebP em `/media/tmdb`).** A decisao de imagem remota crua (`file_path` no banco, URL montada em `apps/web/src/lib/tmdb-image-url.ts`) foi correta: elimina custo de disco/banda/invalidacao e usa o CDN do TMDB. Reverter isso reintroduz o problema que fez `public` ter apenas ~144 KB. (Parte 5, Parte 23.)
- **NAO inventar nota.** Estrela so a partir de `screen_score` governado. Nao criar nota "automatica" para preencher card vazio. (Invariantes 1/13; Parte 12.)
- **NAO converter `vote_average_tmdb` em Screen Score** nem exibi-lo como nota editorial. Ele fica no banco como dado tecnico do provider. (Invariantes 1/2.)
- **NAO inventar disponibilidade de streaming.** Enquanto nao houver `watch_availability` real e licenciada, nenhum chip/ticker/CTA pode afirmar "esta na Netflix" ou "episodio novo hoje". (Invariantes 6/8; Partes 7 e 13.)
- **NAO indexar o dominio temporario** do EasyPanel. Ate `robots`/canonical virem de env, o host provisorio nao pode ser rastreavel nem servir canonical de producao. (Parte 20.)
- **NAO fazer um redesign grande agora.** O visual v4 esta fechado; a divida e de dados e honestidade, nao de layout. Mexer em CSS/estrutura da home fora do escopo de saneamento viola o contrato de `docs/frontend/page-map.md` e a Lista NUNCA do CLAUDE.md.
- **NAO relaxar o gate anti-thin** para forcar mais paginas ao indice. A resposta a "poucas paginas indexaveis" e produzir blocos de valor (Entity Writer), nao baixar o limiar. (Invariante 5.)
- **NAO mexer no RSS Prime** nem trata-lo como feed do Screen. E pipeline externo.
- **NAO misturar MN26 com o Screen.** E outro produto editorial; se entrar, entra como fonte licenciada, nunca como identidade.
- **NAO fazer Cloudflare/DNS/dominio oficial antes de fechar a Fase 0 (saneamento P0).**
- **NAO deployar `main` como esta:** `main` (`origin/main` = `ae576f4`) nao contem home v4, hero carousel, ingestao TMDB nem `screen_score`. Merge primeiro. (Parte 2.)
- **NAO publicar en/es.** Nascem `draft`/`noindex` ate revisao humana. (Invariante 7.)
- **NAO otimizar peso da imagem/`node_modules` agora.** ~987 MB nao bloqueia producao; e trabalho de Fase 7. (Parte 23.)


---

## Parte 28 — Conclusao executiva

**O Screen esta no caminho certo?** Arquiteturalmente, **sim**. A tese — uma base de entretenimento *entity-first* com uma camada editorial verificavel por cima do dado cru — e sólida, e a execucao da **fundacao** e acima da media: monorepo tipado, pureza de render imposta por auditoria, separacao rigorosa entre fornecedor tecnico e fonte editorial, gate anti-thin, Entity Writer com validacao anti-alucinacao. Poucos projetos neste estagio ja tem *governanca* travada por testes. Esse e o ativo real e defensavel.

**O que o Screen ja e hoje:** um **catalogo TMDB reembalado** — filmes, series e pessoas com listagem e pagina de detalhe, home v4 polida, imagens remotas do CDN do TMDB, hero-carousel real, SEO tecnico honesto no que existe. É um site que **parece** um produto de entretenimento.

**O que o Screen ainda NAO e:**
- Nao e um **agregador de reviews** (Rotten): nao tem tomatometer, nao pode ter, e nao tem critica propria ativa.
- Nao e um **tracker** (TV Time/Trakt/Letterboxd): nao ha model de usuario, logo nada de watchlist, marcar assistido, listas ou reviews de usuario.
- Nao e um **guia de onde assistir** (JustWatch): os chips e o "Onde assistir" sao mock, sem `watch_availability` real.
- Nao e um **banco de entidades denso** (IMDb/TMDB): faltam temporadas, episodios, e a maioria das paginas nao tem os 2 blocos de valor que o proprio gate exige para indexar.
- Nao tem a **camada editorial** funcionando: o Entity Writer gera so `editorial_intro`/`cast_intro`, e nao ha noticias reais.
- E — o mais visivel para o usuario — **nao mostra notas reais**: as estrelas so existem no seed demo.

**O que falta para parecer IMDb/Rotten/TMDB/TV Time?** Muito, e esta tudo mapeado nas Partes 14–18 e 25. Mas a resposta honesta e que o Screen **nao deve tentar parecer** nenhum deles agora. IMDb/TMDB ganham por volume; Rotten por licencas de critica; TV Time/Letterboxd por comunidade. O Screen nao tem escala, licencas nem usuarios. O que ele tem — e o unico caminho que respeita as invariantes — e **profundidade editorial governada e indexavel**: poucas entidades, mas com blocos de valor proprios, verificaveis e bem estruturados para SEO.

**Qual o proximo passo real, sem fantasia?** Em ordem, sem pular:

1. **Saneamento (Fase 0, dias).** Tornar a home honesta (gatear/remover ticker e chips falsos), desamarrar o canonical do dominio hardcoded, impedir indexacao do dominio temporario, decidir a politica de nota, e tornar o deploy seguro (merge para `main`, CI com `audit:render`+`build`, backup Postgres, migrations no release). **Nada disso constroi feature — só remove mentira e risco.** É o unico bloqueio real para colocar o dominio oficial no ar.

2. **Primeiro slice entity-first indexavel (Fase 2, semanas).** Rotas de temporada/episodio + Entity Writer em producao (com revisao humana) gerando os 2 blocos de valor por entidade prioritaria. É isto que transforma "catalogo TMDB reembalado" em "base editorial propria" — a promessa do projeto.

3. **Só entao** ratings/reviews (Fase 3), onde-assistir real (Fase 4) e, muito depois, tracking social (Fase 5), que e alta retencao mas baixo valor de SEO e o mais caro (exige identidade de usuario, LGPD, moderacao).

**Frase final.** O Screen construiu o esqueleto e o sistema imunologico antes dos musculos — o que é raro e correto. O risco não e tecnico; e de **honestidade e foco**: publicar cedo demais, com placeholders que fingem dado real, queimaria a credibilidade e feriria as proprias invariantes que o projeto tanto protege. Feche a Fase 0, ative o Entity Writer numa fatia pequena, e o Screen deixa de ser uma casca bonita do TMDB para virar o que se propos a ser.


---

## Anexo A — Sintese de riscos e debitos (critica de completude)

Sintese consolidada das Partes 2–24, com verificacao manual direta de cada item marcado **BLOQUEIA PRODUCAO**. A ordem e por gravidade.

### A.1 Contradicoes e pontos de atencao entre secoes

- **"Home v4 esta pronta" vs. realidade de dados.** O visual esta fechado e honesto no que e real (Parte 7), mas tres blocos afirmam dados inexistentes (ticker, chips de streaming, e — no seed — notas). Nao e contradicao de fato, e sim a distancia entre *layout pronto* e *dado pronto* — o eixo central deste relatorio.
- **`screen_score` "governado" vs. "so no seed".** As Partes 12 e 7 concordam: o gate de exibicao e correto e rigoroso, mas a unica fonte de escrita e o seed demo. O rigor da governanca **esconde** o vazio de dados: com catalogo real, o gate simplesmente retorna `null` e nao ha estrela — o usuario ve cards sem nota, nao um erro.
- **Ratings/streaming "modelados" vs. "ativos".** `external_ratings` e `watch_availability` tem schema, validadores e testes de governanca completos (Partes 4, 12, 13), mas **zero escritores e zero leitores** em produto. Contrato ≠ feature.

### A.2 Os riscos mais graves (ordenados)

| # | Risco | Evidencia | Classe |
|---|---|---|---|
| 1 | **Ticker/chips de streaming falsos em producao** — afirmam episodio novo e disponibilidade que nao existem | `apps/web/app/pt/page.tsx:648`, `:133`/`:748`; `episodes-ticker.tsx:53` | **RISCO** · **BLOQUEIA PRODUCAO** (invariantes 6/8) |
| 2 | **Canonical/robots presos ao dominio de producao** — dominio temporario serve canonical `thescreen.media` e e indexavel | `apps/web/src/lib/site.ts:9`; `apps/web/app/robots.ts` | **RISCO** · **BLOQUEIA PRODUCAO** (SEO) |
| 3 | **`main` nao deployavel** — 28 commits atras de HEAD; sem home v4, hero, ingestao nem `screen_score` | `origin/main`=`ae576f4`; schema de `main` tem 0 `screen_score` | **RISCO** · **BLOQUEIA PRODUCAO** |
| 4 | **Sem backup do PostgreSQL** — perda de disco = perda total de content_blocks/decisoes/nota editorial | `scripts/backup/README.md` declara ausencia | **RISCO** · **BLOQUEIA PRODUCAO** |
| 5 | **Migrations aplicadas a mao, sem passo de release** — janela de app novo x schema velho | nenhum `prisma migrate deploy` no release | **RISCO** · **BLOQUEIA PRODUCAO** |
| 6 | **CI de `main` nao roda `audit:render` nem `build`** — regressao de invariante 3/4 passa batido | `git show HEAD:.github/workflows/ci.yml`; sem script `build` no HEAD | **RISCO** · **BLOQUEIA PRODUCAO** |
| 7 | **Possivel segredo em build-arg do Nixpacks** — token gravado em camada/imagem e log; o build nao precisa de segredo | warning reportado pelo operador; build nao fala com TMDB | **RISCO** · **BLOQUEIA PRODUCAO** se confirmado |
| 8 | **`SCREEN_HOME_VISUAL_PLACEHOLDERS=1` reabilita todos os mocks em producao** — um caractere separa producao honesta de producao com AdSense/noticias/estreias falsas | `home-placeholder-governance.ts:50` | **RISCO** · **NAO BLOQUEIA** (mas nao documentado) |

### A.3 Os debitos tecnicos mais relevantes (por custo de nao resolver)

1. **Nota so no seed demo** — catalogo real fica sem estrela; decisao de politica pendente. (Parte 12.)
2. **Sem rotas de temporada/episodio** — buraco central de SEO entity-first; `Season` ate tem upsert, mas nao ha navegacao nem `TVSeason`/`TVEpisode`. (Partes 6, 9.)
3. **Sem model de usuario** — bloqueia toda a familia TV Time/Trakt/Letterboxd de uma vez; pre-requisito caro (auth, LGPD, moderacao). (Partes 14, 15.)
4. **Entity Writer inativo em producao** — sem ele, nenhuma pagina de detalhe atinge os 2 blocos de valor; o gate anti-thin deixa quase tudo `noindex`. (Partes 20, 21.)
5. **Pipeline de noticias inexistente** — `services/news-ingestion/` so tem README; bloco de noticias e placeholder. (Parte 11.)
6. **`external_ratings`/`watch_availability` sao contrato morto** — schema pronto, produto zero. (Partes 12, 13.)
7. **Nenhum job/cron em producao** — `services/sync/bin/run.ts` existe mas nunca foi agendado; ingestao e backfill sao manuais. (Parte 2.)
8. **Auditorias nao cobrem "dado falso na UI"** — nao ha teste que pegue ticker/chip/nota mock; a governanca protege *pureza de render* e *atribuicao*, nao *veracidade de placeholder*. Foi essa lacuna que deixou o ticker vazar. (Parte 22.)
9. **`api_cache` sem prune** — cresce indefinidamente; maior candidata a dominar o `database_size`. (Partes 2, 23.)
10. **`.env.example` desalinhado** — vars mortas (`SCREENA_REDIS_URL`, `THE_SCREEN_PUBLIC_SITE_URL`) e vars reais nao documentadas (`SCREEN_HOME_VISUAL_PLACEHOLDERS`, `ADMIN_*`). (Partes 2, 24.)

### A.4 Lacunas de cobertura desta auditoria

- Numeros de disco/banco sao **reportados pelo operador**, nao medidos (sem acesso ao servidor). Comandos de medicao estao na Parte 23.
- O **estado do banco de producao** (quantos titulos reais foram ingeridos, se ha `screen_score` gravado la) nao foi inspecionado — a auditoria e do codigo, nao da instancia rodando.
- O warning de **segredo no Nixpacks** nao foi observado diretamente; depende de confirmar a config do EasyPanel.
- A **verificacao adversarial automatica** (verificadores ceticos por afirmacao) foi interrompida por limite de sessao na primeira rodada; as afirmacoes **BLOQUEIA PRODUCAO** foram, em compensacao, **verificadas manualmente** contra o codigo pelo autor deste relatorio.

### A.5 Adendo de verificacao cruzada (achados confirmados pos-critica)

Uma passagem final de critica de completude rodou depois da montagem do relatorio e levantou pontos que foram **verificados manualmente contra o codigo** e confirmados. Ficam registrados aqui para nao reescrever as secoes de origem:

- **Contradicao interna resolvida — admin read-only vs. escrita gateada.** A Parte 24 hesitou ("NAO FOI POSSIVEL CONFIRMAR"). Resolucao definitiva: `apps/admin/src/server/editorial-actions.ts:1` **e** `"use server"` (superficie de escrita real da Fase 7A, gateada por `ADMIN_EDITORIAL_ACTIONS_ENABLED`, escreve so `.update` de `reviewStatus`/`indexStatus`). O teste **untracked** `tests/admin/no-write-endpoints.test.ts` proibe **qualquer** `"use server"` em `apps/admin/{app,src}` e **nao tem allowlist** (`expect(violations).toEqual([])`). Logo, **esse teste FALHARIA hoje** contra a arvore atual — e um teste novo, ainda nao commitado, que expressa uma intencao ("voltar o admin a read-only") em **conflito** com a feature de escrita ja existente. **DEBITO** de intencao nao reconciliada; nao e read-only puro como a Parte 24.7 sugeriu. (Confirmado: `no-write-endpoints.test.ts:24`, `editorial-actions.ts:1`.)
- **Sinopse do TMDB servida como conteudo proprio — RISCO de SEO nao flagrado antes.** O `overview` cru do TMDB e gravado como `entity_translations.summary` (`services/ingestion/bin/ingest-public-catalog.ts:187-188`, `summary: overview`) e renderizado como **texto visivel + `meta_description` + `description` do JSON-LD** (`apps/web/src/lib/movie-presenter.ts:176`). Isso e **conteudo duplicado de terceiro** apresentado como descricao propria — tensiona a regra "nao copia sinopse externa" (`.claude/rules/entity-writer.md §4`, em espirito) e enfraquece E-E-A-T/anti-thin. Nenhuma secao de sintese tratava isso. **DEBITO** · **RISCO** (SEO) · **NAO BLOQUEIA PRODUCAO** isoladamente, mas mina o argumento de valor proprio. **PROXIMO PASSO:** substituir a exibicao da sinopse crua por `editorial_intro`/`summary_without_spoilers` do Entity Writer (que ja e a tese do projeto).
- **Gate de licenca de ratings e codigo morto.** Todos os chamadores de `evaluateIndexability` passam `displayedRatings: []` hardcoded (`movie-indexability.ts:58`, `series-presenter.ts:291`, `entity-index-presenter.ts:348`). A maquinaria de `source_licenses`/`display_allowed` **nunca executa** num caminho real hoje. A governanca de licenca esta *escrita e testada em unidade*, mas *inerte em producao* — o TL;DR (item 5) deve ser lido com essa nuance: a governanca e o ativo mais maduro em **contrato**, nao em **execucao**.
- **`aria-hidden`/`aria-disabled` nao removem o mock do HTML.** Os chips de plataforma e o CTA "Onde assistir" marcados como `aria-*` continuam **presentes no HTML servido ao crawler** — esconde do leitor de tela, nao do Googlebot. Reforca o Risco #1 (mocks vazam) e adiciona um anti-padrao de acessibilidade. **NAO BLOQUEIA PRODUCAO** por si, mas nao conta como "gateado".
- **Fallback de sitemap sem gate.** Num outage de banco, `sitemap-presenter` cai para rotas estaticas; confirmar se esse fallback respeita o gate anti-thin ou pode listar rota fina. Ponto para verificacao dedicada. **NAO FOI POSSIVEL CONFIRMAR** em profundidade nesta passagem.
