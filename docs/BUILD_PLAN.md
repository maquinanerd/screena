# Plano de construção — Screen (BUILD_PLAN)

> **Plano de construção por fases.** Da fundação do monorepo (Fase 0) até a monetização
> (Fase 12). Cada fase tem **entregáveis** concretos e **critérios de aceite** verificáveis.
> Nada avança para a fase seguinte sem que os critérios de aceite da fase atual estejam
> cumpridos.

Este documento é a fonte da verdade do **roadmap de engenharia**. As regras de produto e as
invariantes inegociáveis vivem em [`CLAUDE.md`](../CLAUDE.md) e em
[`.claude/rules/`](../.claude/rules); a especificação de produto vive em
[`docs/SPEC.md`](./SPEC.md). Em caso de conflito, as invariantes do `CLAUDE.md` prevalecem
sobre qualquer atalho deste plano.

> **Identidade e estado real.** A marca pública principal é **Screen** em
> `https://thescreen.media`; **The Screen** pode aparecer apenas como referência
> histórica, explicativa ou nome expandido não-principal.
> **Screena** permanece como namespace técnico/legado interno (`@screena/*`,
> tokens `--screena-*`). O repositório já passou da Fase 0 pura: Fase 1, Fase 2
> e Fase 3A estão parcialmente implementadas. Ratings, streaming, RSSPRIME/MN26,
> admin editorial completo e usuários/community ainda não estão funcionais.

## Princípios que valem para todas as fases

- **Zero API externa no render** e **zero Gemini no render** — toda página pública indexável
  lê apenas PostgreSQL/cache local. Sync externo e geração de conteúdo são pipelines
  separados do render.
- **Gate anti-thin** — nenhuma página entra no índice sem ao menos **2 blocos de valor
  próprios** além do dado cru de API (ver [`docs/SEO_PROGRAMMATIC.md`](./SEO_PROGRAMMATIC.md)).
- **Atribuição correta de ratings** — IMDb ≠ Rotten Tomatoes; `provider_api` ≠
  `rating_source`; nada de `AggregateRating` fingindo nota própria.
- **pt-BR primeiro** — `en`/`es` nascem em draft/`noindex` até revisão humana.
- **Licença antes de exibir** — dado com `license_status` `unknown`/`blocked` ou
  `display_allowed=false` nunca aparece em página indexável.
- **Sem pirataria** — nada de torrent, IPTV, player ilegal, link de download ou embed pirata.
- **Diferenciação filme/série nunca depende só da cor** — sempre label + badge + breadcrumb
  + schema + URL.

---

## Visão geral das fases

| Fase | Tema                          | Foco                                                              | Status            |
| ---- | ----------------------------- | ----------------------------------------------------------------- | ----------------- |
| 0    | Fundação                      | Repo, docs, `CLAUDE.md`, `.claude/`, CI, branches                 | **Concluída** ✅  |
| 1    | Banco                         | Schema PostgreSQL, migrations, `content_blocks`, jobs, admin min. | **Parcial**       |
| 2    | TMDB                          | Client, cache, retry, rate limit, sync logs, import               | **Parcial**       |
| 3    | Entity Writer                 | Worker, client Gemini, prompts versionados, validação, testes     | **Parcial**       |
| 4    | Páginas de filmes             | Template, schema `Movie`, gate anti-thin, visual vermelho         | Planejada         |
| 5    | Séries                        | `TVSeries`/`TVSeason`/`TVEpisode`, visual verde                   | Planejada         |
| 6    | Ratings                       | `external_ratings`, `source_licenses`, IMDb/Rotten sem mistura    | Planejada         |
| 7    | Onde assistir                 | Streaming Availability, fallback KASO                             | Planejada         |
| 8    | SEO programático              | Sitemap, robots, indexability engine, rollout 50→100→300          | Planejada         |
| 9    | RSSPRIME                      | Ingestão de feeds RSS                                              | Planejada         |
| 10   | MN26 News                     | Camada de notícias / clusters                                     | Planejada         |
| 11   | Multilíngue                   | `en`/`es` saindo de draft, hreflang                              | Planejada         |
| 12   | Monetização                   | Camada comercial (afiliados, ads, sem ferir invariantes)          | Planejada         |

---

## Fase 0 — Fundação **[STATUS: concluída nesta entrega]**

Estabelece o esqueleto do monorepo, a governança e o tooling. Esta fase foi
superada tecnicamente por implementações parciais posteriores; mantenha esta
seção como histórico, não como descrição do estado atual.

### Entregáveis

- Monorepo **pnpm** com workspaces (`apps/*`, `packages/*`), `pnpm-workspace.yaml`,
  `package.json` raiz, `.nvmrc` (Node 22).
- Pacotes compartilhados em esqueleto: `@screena/config`, `@screena/schemas`,
  `@screena/seo`, `@screena/ui`, `@screena/types`, `@screena/db` — cada um com
  `package.json` (`"main": "./src/index.ts"`, `"type": "module"`), `tsconfig.json`
  (`extends ../../tsconfig.base.json`), `README.md` e `src/index.ts`.
- Apps em esqueleto: `@screena/web`, `@screena/admin`.
- Configuração TypeScript strict (`tsconfig.base.json`), ESLint, Prettier.
- Aliases consistentes entre `tsconfig.base.json` e `vitest.config.ts`.
- Governança: `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, `.claude/agents/`.
- Documentação canônica em `docs/` (SPEC, este BUILD_PLAN, API_SOURCES, SEO, ratings,
  Entity Writer, deploy) e `README.md` raiz.
- CI mínimo (lint, typecheck, testes de invariantes), estratégia de branches definida.
- Tabelas canônicas documentadas em `database/schema.md` (apenas referência, **sem schema
  real**).

### Critérios de aceite

- `pnpm install` resolve o workspace sem erros.
- `pnpm typecheck` passa em todo o repositório (TypeScript strict).
- `pnpm lint` passa.
- `pnpm test` roda os testes de invariantes/utilitários puros e passa.
- Os aliases `@screena/*` resolvem identicamente em `tsconfig.base.json` e
  `vitest.config.ts`.
- As 13 invariantes estão documentadas em `CLAUDE.md` e refletidas em `.claude/rules/`.
- Nenhum pacote faz rede/DB/IO externo; utilitários são puros e testáveis.
- CI verde no pipeline mínimo.

---

## Fase 1 — Banco

Materializa o modelo de dados canônico em PostgreSQL e dá ao editorial um painel mínimo.

### Entregáveis

- Schema PostgreSQL real via **Prisma** (`schema.prisma`) cobrindo as tabelas canônicas
  (entidades, elenco/equipe, mídia, ratings/licenças, onde assistir, notícias, editorial,
  Entity Writer, infra/cache/logs, i18n/slugs, indexabilidade).
- **Migrations versionadas** em `database/migrations/` e **seeds** iniciais em
  `database/seeds/` (`countries`, `languages`, `rating_sources` com escalas, `api_providers`).
- Tabela `content_blocks` com todas as colunas canônicas (`prompt_version`, `input_hash`,
  `output_hash`, `model_provider`, `model_name`, `review_status`, `warnings_json`, …).
- Tabelas `entity_writer_jobs` e `entity_writer_logs` com os status canônicos.
- Pacote `@screena/db` com client Prisma e tipos derivados.
- **Admin mínimo** (`@screena/admin`): listar/ver entidades, `content_blocks` e jobs
  (somente leitura + transições de `review_status` controladas).
- Política de índices aplicada (`entity_type`, `tmdb_id`, `imdb_id`, `slug`, `language`,
  `country`, `updated_at`).

### Critérios de aceite

- `prisma migrate` aplica e reverte limpo em um banco vazio; `prisma generate` produz o client.
- Seeds populam `rating_sources` com as escalas corretas (imdb=10, rotten_tomatoes=100,
  metacritic=100, letterboxd=5, filmaffinity=10).
- `content_blocks` rejeita inserção sem `prompt_version`/`input_hash`/`review_status`.
- `entity_writer_jobs` só aceita os status canônicos.
- Admin mínimo lista entidades e blocos e respeita as transições de `review_status`
  permitidas (não publica conteúdo `blocked`/`needs_review`).
- Constraints garantem `provider_api` ≠ `rating_source` na modelagem.

---

## Fase 2 — TMDB

Pipeline de importação a partir do TMDB, totalmente **offline em relação ao render**.

### Entregáveis

- Client TMDB em `api-clients/tmdb/` com: autenticação por env var, **cache** local
  (`api_cache`), **retry** com backoff, **rate limit** e respeito a `ETag`/`Cache-Control`.
- Pipeline de **import** de filmes, séries e pessoas para as tabelas canônicas, mapeando
  IDs em `entity_external_ids`.
- **Sync logs** — toda chamada/sync registra em `api_sync_logs` (sucesso, falha, contagem).
- Serviço de sincronização em `services/sync/` (orquestração, agendamento via systemd timer
  documentado).

### Critérios de aceite

- Nenhuma chamada TMDB ocorre no caminho de render (verificado pelo `pnpm audit:render` de pureza).
- Import idempotente: reimportar a mesma entidade não duplica registros (upsert por ID
  externo).
- `api_sync_logs` registra cada execução; falhas são logadas e não derrubam o pipeline.
- Rate limit e retry comprovados por teste (mock de rede; sem rede real nos testes).
- API keys lidas **apenas** de env vars, nunca em código/frontend.

---

## Fase 3 — Entity Writer

O agente editorial offline que gera `content_blocks` a partir de payload controlado.

### Entregáveis

- Worker Python 3.12 em `workers/` que consome `entity_writer_jobs`
  (`queued`→`claimed`→`running`→`completed`/`failed`/`blocked`).
- Client **Gemini** (offline) com leitura de chave por env var; nunca chamado no render.
- **Prompts versionados** (`prompt_version`) em `prompts/`, por tipo de bloco.
- Saída em **JSON estruturado**, validada contra o payload de entrada
  (**testes anti-alucinação**): não inventa fatos, não cria entidades, não copia sinopse
  externa.
- Gravação em `content_blocks` com `input_hash`/`output_hash`, `model_provider`/
  `model_name`, `review_status` inicial (`ai_generated`/`needs_review`).
- **Logs de token** e execução em `entity_writer_logs`.

### Critérios de aceite

- O worker só escreve com base em **payload controlado do PostgreSQL**; sem chamadas a APIs
  externas de dados durante a geração.
- Teste anti-alucinação: bloco que afirma fato ausente do payload é marcado/`blocked` e não
  é promovido.
- Todo bloco gerado tem `prompt_version`, `input_hash`, `output_hash`, `model_provider`,
  `model_name` e `review_status` preenchidos.
- Nenhum bloco é publicado automaticamente — publicação exige `human_reviewed`/`published`.
- Logs de token e custo registrados por job.

---

## Fase 4 — Páginas de filmes

Primeiro tipo de página pública, com gate anti-thin e identidade visual de filme.

### Entregáveis

- Template de página de filme (`/pt/filmes/{slug}/`) em `@screena/web`, RSC + ISR.
- Schema.org **`Movie`** + `BreadcrumbList` (e `FAQPage`/`Review`/`AggregateRating` apenas
  quando aplicável e permitido).
- **Gate anti-thin** ligado: sem ≥2 blocos de valor próprios, a página recebe `noindex`.
- Identidade visual de filme: **acento vermelho** (`--screena-movie-red`) + label + badge +
  breadcrumb + URL (nunca só cor).
- Subrotas iniciais: `/elenco/`, `/avaliacoes/` (estrutura), lendo apenas do PostgreSQL.

### Critérios de aceite

- A página renderiza **sem nenhuma chamada externa** (pureza de render verificada).
- Página com <2 blocos de valor é servida como `noindex` (decisão registrada em
  `page_indexability_decisions`).
- JSON-LD `Movie` valida e não declara `AggregateRating` próprio sem permissão/atribuição.
- A diferenciação “filme” aparece em label, badge, breadcrumb, schema e URL — não só na cor.

---

## Fase 5 — Séries

Hierarquia série → temporada → episódio, com identidade visual de série.

### Entregáveis

- Templates `/pt/series/{slug}/`, `/pt/series/{slug}/temporada-{number}/` e contexto de
  episódio.
- Schema.org **`TVSeries`**, **`TVSeason`**, **`TVEpisode`** + `BreadcrumbList`.
- Identidade visual de série: **acento verde** (`--screena-series-green`) + label + badge +
  breadcrumb + URL.
- Bloco **guia de temporadas** e contexto de episódio como blocos de valor.

### Critérios de aceite

- Render puro (zero API externa), igual à Fase 4.
- Gate anti-thin aplicado a séries, temporadas e (quando indexáveis) episódios.
- JSON-LD `TVSeries`/`TVSeason`/`TVEpisode` válido e coerente com a hierarquia/URL.
- Cor verde nunca é o único diferenciador; label/badge/breadcrumb/schema/URL presentes.

---

## Fase 6 — Ratings

Exibição de notas externas com fonte, escala e licença corretas, sem mistura.

### Entregáveis

- Camada de leitura de `external_ratings` com `rating_source`, `rating_label`, `metric`,
  `rating_value`, `rating_scale`, `rating_count`, `attribution_text`/`attribution_url`.
- Integração com `source_licenses` (`display_allowed`, `logo_allowed`, `score_allowed`,
  `review_quote_allowed`, `requires_attribution`, `requires_linkback`).
- Componentes de UI distintos por fonte (IMDb e Rotten Tomatoes nunca compartilham ícone,
  escala ou linguagem).
- Bloco de valor **explicação de ratings** e **comparação crítica vs. audiência**.

### Critérios de aceite

- IMDb ≠ Rotten Tomatoes em UI, escala e linguagem; nota IMDb nunca vira Tomatometer.
- Tomatometer/Popcornmeter só aparecem atribuídos ao Rotten Tomatoes.
- Rating com `license_status` `unknown`/`blocked` ou `display_allowed=false` **não** é
  exibido em página indexável.
- `provider_api` (fornecedor técnico) nunca é apresentado como `rating_source` (fonte
  editorial); atribuição e linkback respeitam `source_licenses`.
- Nenhum `AggregateRating` finge nota própria do Screen.

---

## Fase 7 — Onde assistir

Disponibilidade por país, com fonte primária e fallback.

### Entregáveis

- Integração **Streaming Availability** em `api-clients/streaming_availability/` para
  popular `watch_availability` (por entidade, país, modalidade).
- **Fallback KASO** (`api-clients/kaso/`) quando a fonte primária não cobre.
- Página/subrota `/onde-assistir/` (`/pt/filmes/{slug}/onde-assistir/`,
  `/pt/series/{slug}/onde-assistir/`, `/pt/onde-assistir/{slug}/`) lendo apenas do banco.
- Bloco de valor **onde assistir por país**.

### Critérios de aceite

- Disponibilidade renderiza **só do PostgreSQL** (sync prévio, zero API no render).
- Fallback KASO ativa apenas quando a fonte primária falha/não cobre, com log em
  `api_sync_logs`.
- **Sem pirataria**: nenhum link de torrent/IPTV/download/embed ilegal; apenas plataformas
  legítimas.
- Licença/disponibilidade real respeitada por país; oferta sem licença clara não aparece.

---

## Fase 8 — SEO programático

Motor de indexabilidade, sitemaps e rollout controlado.

### Entregáveis

- `sitemap.xml` programático e `robots.txt`, gerados a partir de
  `page_indexability_decisions`.
- **Indexability engine** que decide `index`/`noindex`/`draft`/`stale`/`blocked` aplicando o
  gate anti-thin (≥2 blocos de valor) e as regras de licença.
- Estratégia de **rollout** de indexação por lotes: **50 → 100 → 300** páginas, com métricas.
- hreflang preparado (mesmo que `en`/`es` ainda em draft).

### Critérios de aceite

- Sitemap lista **apenas** páginas com decisão `index`; `noindex`/`draft`/`blocked` ficam de
  fora.
- Toda decisão de indexabilidade é registrada e auditável em `page_indexability_decisions`.
- Páginas finas (sem ≥2 blocos de valor) ou sem licença clara não entram no índice.
- O rollout segue os lotes 50→100→300 com checkpoints de validação entre eles.

---

## Fase 9 — RSSPRIME

Ingestão de feeds RSS como matéria-prima de notícias.

### Entregáveis

- Serviço de ingestão RSS em `services/news-ingestion/` (RSSPRIME): coleta, normalização e
  deduplicação de itens de feed.
- Persistência de itens crus com log em `api_sync_logs`.
- Mapeamento inicial item de feed → candidatos a `articles`/`entity_news_links`.

### Critérios de aceite

- Ingestão idempotente e deduplicada (não recria itens já vistos).
- Todo ciclo de ingestão gera log; falhas isoladas não derrubam o serviço.
- Nenhum conteúdo de terceiros é publicado automaticamente como editorial próprio.
- Render continua puro: notícias só aparecem após processamento e gravação no banco.

---

## Fase 10 — MN26 News

Camada de notícias editoriais e clusters vinculados a entidades.

### Entregáveis

- Pipeline MN26: clusterização (`news_clusters`), vínculo `entity_news_links` e
  `articles`/`article_translations`.
- Páginas de notícia (`/pt/noticias/{slug}/`) com schema **`NewsArticle`** +
  `BreadcrumbList`.
- Bloco de valor **notícias relacionadas** nas páginas de entidade.

### Critérios de aceite

- Notícia indexável carrega valor editorial próprio (gate anti-thin), não cópia crua de
  feed.
- `NewsArticle` válido; clusters e vínculos com entidades consistentes.
- pt-BR primeiro; traduções nascem em draft/`noindex`.
- Render puro (zero API externa).

---

## Fase 11 — Multilíngue

`en`/`es` saem de draft após revisão humana.

### Entregáveis

- `entity_translations`/`article_translations`/`content_blocks` por `language_code`.
- Rotas `en` (`/en/movies/{slug}/`, `/en/tv/{slug}/`, `/en/people/{slug}/`,
  `/en/news/{slug}/`) e `es`.
- **hreflang** completo e canônicos coerentes entre idiomas.
- Fluxo de revisão humana para promover traduções de draft → publicado.

### Critérios de aceite

- `en`/`es` permanecem em draft/`noindex` até **revisão humana** explícita.
- hreflang correto e recíproco entre idiomas; canônicos sem conflito.
- Nenhuma tradução automática vai a `published`/`index` sem revisão.
- Gate anti-thin e regras de licença aplicados por idioma.

---

## Fase 12 — Monetização

Camada comercial sem ferir invariantes nem a confiança editorial.

### Entregáveis

- Integrações de monetização (afiliados de “onde assistir”, ads) isoladas da camada
  editorial.
- Divulgação clara (disclosure) onde houver link afiliado.
- Telemetria de monetização separada do render de conteúdo.

### Critérios de aceite

- Monetização **não** introduz API externa no render nem altera a atribuição de ratings.
- Links afiliados respeitam licença/legalidade (sem pirataria) e trazem disclosure.
- Conteúdo editorial e comercial permanecem distinguíveis para o usuário.
- Nenhuma invariante do `CLAUDE.md` é violada pela camada comercial.

---

## Log de decisões

Decisões arquiteturais tomadas e seu racional. Mudanças aqui exigem atualização do
`CLAUDE.md` quando afetarem invariantes.

| Decisão                         | Escolha                                   | Racional / alternativa                                                                 |
| ------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| ORM                             | **Prisma** (recomendado)                  | DX e migrations versionadas; **Drizzle** documentado como alternativa.                 |
| Estilo                          | **Tailwind CSS** (recomendado)            | Tokens técnicos `--screena-*`; consistência entre filme/série sem depender só de cor.  |
| Runtime Node                    | **Node 22 LTS**                           | LTS atual; fixado em `.nvmrc`.                                                          |
| Monorepo                        | **pnpm** (workspaces `apps/*`, `packages/*`) | Instalação rápida e isolamento de dependências por pacote.                          |
| Banco                           | **PostgreSQL**                            | Render lê apenas do PostgreSQL/cache local; zero API externa no render.                |
| Workers                         | **Python 3.12**                           | Entity Writer e jobs de sync; orquestração via systemd timers.                         |
| IA                              | **Gemini — só offline**                   | Geração de `content_blocks` offline; nunca no render.                                  |
| Deploy                          | **VPS + CloudPanel** (Next via Node/PM2/systemd) | Workers via systemd timers; ver `docs/CLOUDPANEL_DEPLOY.md`.                     |

---

## Estratégia de branches

- **`main`** — produção. Protegida; só recebe merge via PR aprovado e validado em staging.
- **`staging`** — pré-produção. Espelha o que vai para `main`; ambiente de validação.
- **`develop`** — integração contínua das features em andamento.
- **`feature/*`** — novas funcionalidades (ex.: `feature/movie-page`).
- **`fix/*`** — correções de bug (ex.: `fix/rating-attribution`).
- **`chore/*`** — manutenção, dependências, tooling.
- **`infra/*`** — infraestrutura, CI/CD, deploy.

Regras: nada vai direto para `main`; toda mudança passa por PR. Branches efêmeras (`feature/`,
`fix/`, `chore/`, `infra/`) saem de `develop` e voltam para `develop`; a promoção segue
`develop` → `staging` → `main`.

---

## Milestones

- **M0 — Fundação pronta** (Fase 0): monorepo, governança, CI e docs canônicos. ✅
- **M1 — Dados em pé** (Fases 1–2): schema PostgreSQL + import TMDB com sync logs.
- **M2 — Editorial offline** (Fase 3): Entity Writer gerando `content_blocks` validados.
- **M3 — Páginas de obra** (Fases 4–5): filmes e séries com gate anti-thin e identidade
  visual.
- **M4 — Confiança de dados** (Fases 6–7): ratings atribuídos + onde assistir legal.
- **M5 — Escala de indexação** (Fase 8): SEO programático com rollout 50→100→300.
- **M6 — Notícias** (Fases 9–10): RSSPRIME + MN26 News.
- **M7 — Global** (Fase 11): `en`/`es` publicados após revisão humana.
- **M8 — Receita** (Fase 12): monetização sem ferir invariantes.

---

## Workflow de desenvolvimento

Fluxo padrão de uma mudança, de issue a produção:

1. **Issue** — descreve o trabalho, a fase e os critérios de aceite afetados.
2. **Branch** — cria-se a branch a partir de `develop` (`feature/*`, `fix/*`, `chore/*`,
   `infra/*`).
3. **Codex implementa** — a implementação é feita na branch, respeitando as invariantes.
4. **Testes** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm audit:invariants` e
   `pnpm audit:render` (invariantes e pureza de render) passam localmente/CI.
5. **Claude Code revisa** — revisão contra `CLAUDE.md`/`.claude/rules` (invariantes,
   atribuição, gate anti-thin, ausência de API/Gemini no render).
6. **PR** — aberto contra `develop` (ou `staging` na promoção), com checklist de critérios de
   aceite.
7. **Staging** — merge promove para `staging`; deploy de validação.
8. **Validação** — QA funcional + checagem de invariantes em ambiente real de staging.
9. **`main`** — após validação, promove-se para `main`.
10. **Produção** — deploy em VPS + CloudPanel (ver `docs/CLOUDPANEL_DEPLOY.md`).

> Regra de ouro: **nenhuma fase é dada como concluída** sem que seus critérios de aceite
> estejam verificados, e **nenhuma página é indexada** sem cumprir o gate anti-thin e as
> regras de licença.
