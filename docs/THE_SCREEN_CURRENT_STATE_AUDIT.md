# Screen - Auditoria do Estado Atual

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

Data da auditoria: 2026-07-01
Escopo: leitura de documentação, regras, estrutura do monorepo, apps, pacotes, serviços, clients, schema Prisma, scripts de auditoria, testes e configuração de CI.
Restrição aplicada: nenhum código-fonte foi alterado; este relatório é o único arquivo criado.

> Nota: este relatório registra o estado encontrado antes do commit de alinhamento de identidade/fase. Menções a Screena ou ao domínio legado aparecem como histórico de auditoria, não como orientação canônica atual.

## 1. Resumo executivo

- **FATO:** A solicitação atual define a marca pública como **Screen** e o domínio canônico público como `https://thescreen.media`.
- **FATO HISTÓRICO:** Antes do alinhamento, o repositório ainda tinha governança canônica herdada em `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/SPEC.md`, `docs/CLOUDPANEL_DEPLOY.md` e vários pacotes usando **Screena** e o domínio legado.
- **FATO:** O código público recente em `apps/web` já aponta para `https://thescreen.media` e usa majoritariamente a marca **Screen**.
- **FATO:** A documentação principal declara "Fase 0 - Fundação", mas há implementação real posterior: Prisma schema/migrations/seeds, client TMDB, ingestão TMDB, Entity Writer, rotas públicas Next.js, páginas de notícias e testes.
- **INFERÊNCIA:** O estado real técnico não é mais uma Fase 0 pura. É uma fundação avançada com partes de Fase 1, Fase 2 e Fase 3A já implementadas, mas ainda sem produto publicável completo.
- **FATO:** O princípio central do produto está consistente: base global de entretenimento **entity-first**, com filmes, séries, temporadas, episódios, pessoas, ratings externos, onde assistir, reviews/notícias e camada editorial própria.
- **FATO:** A invariant crítica "zero API externa no render / zero Gemini no render" está representada em docs, scripts, testes e na arquitetura atual do app público.
- **FATO:** O app público já possui rotas para listagens e detalhes de filmes, séries, pessoas e notícias em pt-BR, com render via PostgreSQL/local server data, sem client externo direto no caminho de página.
- **FATO:** Ratings, streaming, RSSPRIME/MN26 e área de usuário ainda não estão implementados como produto funcional.
- **RECOMENDAÇÃO TRATADA:** Antes de avançar produto, fazer uma rodada curta de alinhamento de identidade e documentação: Screen como marca pública, `thescreen.media` como domínio canônico, Screena como namespace técnico legado, env vars, deploy docs e status real de fase.

## 2. Identidade atual do projeto

- **FATO:** A identidade pedida para esta auditoria é **Screen**, domínio `thescreen.media`; **Screena/Screena Media** são legados; **The Nerd News** é legado mais antigo.
- **FATO:** No repositório, `apps/web/src/lib/site.ts` define `SITE_URL = "https://thescreen.media"`.
- **FATO:** `apps/web/app/layout.tsx` define metadata com título e `openGraph.siteName` como **Screen**.
- **FATO:** `apps/web/public/brand/README.md` e os SVGs em `apps/web/public/brand/` usam a marca **Screen** e `https://thescreen.media`.
- **FATO:** `apps/web/app/_components/site-header.tsx` usa logo local `screen-logo-black.svg`, `alt="Screen"` e comentários ainda citam `@screena/web` e "Screena Screens".
- **FATO HISTÓRICO:** `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/SPEC.md`, `docs/API_SOURCES.md`, `docs/SEO_PROGRAMMATIC.md`, `docs/RATING_ATTRIBUTION.md`, `docs/ENTITY_WRITER.md`, `docs/CLOUDPANEL_DEPLOY.md`, pacotes `@screena/*`, scripts e workers ainda usavam Screena como nome operacional.
- **FATO HISTÓRICO:** `.env.example` ainda declarava o domínio legado antes do alinhamento.
- **FATO:** A busca textual não encontrou uso explícito de "The Nerd News" no código/documentação auditados; houve apenas referência a `maquinanerd/screena` em handoff de design.
- **INFERÊNCIA HISTÓRICA:** No momento da auditoria, a migração de marca estava parcial: frontend público e validações recentes já usavam `thescreen.media`, mas governança, pacote, env, deploy e docs ainda mantinham identidade legado.
- **RECOMENDAÇÃO TRATADA:** Padronizar a marca pública como **Screen**; **The Screen** fica restrito a referência histórica, explicativa ou nome expandido não-principal.

## 3. Visão de produto encontrada

- **FATO:** A visão documentada é uma base global de entretenimento **entity-first**, não um portal de notícias first.
- **FATO:** O núcleo de valor é evergreen/programático: páginas de filmes, séries, temporadas, episódios e pessoas com dados estruturados, camada editorial própria, notícias relacionadas, ratings externos, disponibilidade legal e conteúdo revisável.
- **FATO:** A voz editorial pertence ao projeto; TMDB, RapidAPI, RSSPRIME, provedores de ratings, streaming e Gemini são fornecedores técnicos ou ferramentas offline, nunca voz editorial pública.
- **FATO:** O MVP publica primeiro em pt-BR; en/es nascem em draft/noindex até revisão humana.
- **FATO:** Páginas finas não indexam: o gate anti-thin exige pelo menos 2 blocos próprios de valor além de dado cru.
- **FATO:** A documentação prevê rotas como `/pt/filmes/{slug}/onde-assistir/`, `/pt/filmes/{slug}/elenco/`, `/pt/filmes/{slug}/avaliacoes/`, temporadas, episódios, streaming e busca, mas essas rotas ainda não existem no app.
- **INFERÊNCIA:** O repositório aponta para um produto de SEO programático e biblioteca editorial, com notícias como camada de atualização e reforço de entidades, não como produto editorial isolado.
- **RECOMENDAÇÃO:** Manter as próximas entregas centradas em entidades e só expandir notícias quando elas reforçarem páginas evergreen ou tiverem corpo/licença/editorial próprios.

## 4. Arquitetura real encontrada

- **FATO:** Monorepo pnpm com workspaces `apps/*`, `packages/*`, `api-clients/*` e `services/*`.
- **FATO:** Stack configurada: Next.js App Router, TypeScript strict, React 19, Next 15, Tailwind, Prisma/PostgreSQL, Vitest, ESLint, Node 22.
- **FATO:** `apps/web` é o app público. Ele renderiza páginas via Server Components e módulos `apps/web/src/server/**` que acessam Prisma por `@screena/db/server`.
- **FATO:** `apps/admin` existe apenas como stub documental/package, sem app Next implementado.
- **FATO:** `packages/db` contém schema Prisma real, migrations e seed, mas `packages/db/README.md` e docs antigas ainda falam como se não houvesse banco real.
- **FATO:** `api-clients/tmdb` é um client TypeScript real com config, endpoints, transporte, retry/backoff/rate limit/circuit breaker e testes.
- **FATO:** `services/ingestion` e `services/sync` implementam ingestão TMDB por ID/lista curada, cache, persistência e política de stale em TypeScript/Node.
- **FATO:** `services/entity-writer` implementa pipeline TypeScript para geração offline, fake Gemini em testes, adapter real Gemini REST, validação, hash, jobs e persistência de `content_blocks`.
- **FATO:** `services/ratings`, `services/streaming`, `services/news-ingestion` e API clients não TMDB são contratos/READMEs, sem implementação funcional comparável à TMDB.
- **FATO:** `workers/*.py` são scaffolds Python; a própria README de workers documenta que TMDB migrou para TS/Node na Fase 2.
- **FATO:** CI existe em `.github/workflows/ci.yml` com install, typecheck, lint, test e auditoria de invariantes.
- **INFERÊNCIA:** A arquitetura real é híbrida: core web/db/ingestion/entity-writer em TypeScript/Node, workers Python preservados como roadmap ou shim futuro.
- **RECOMENDAÇÃO:** Atualizar docs para declarar explicitamente essa arquitetura híbrida, para evitar agentes tentando implementar TMDB novamente em Python.

## 5. Estrutura do repositório e papel dos diretórios principais

- **FATO:** `apps/web`: app público Next.js, rotas App Router, CSS global, header, presenters puros, camada server de leitura PostgreSQL e scripts de validação real com Postgres embutido.
- **FATO:** `apps/admin`: stub de painel interno para operação editorial/dados; sem frontend funcional.
- **FATO:** `packages/config`: invariantes, fontes de ratings, tokens, providers e helpers de env.
- **FATO:** `packages/schemas`: validações puras, incluindo ratings e output do Entity Writer.
- **FATO:** `packages/seo`: indexabilidade, contagem de value blocks e guard de idioma.
- **FATO:** `packages/ui`: tokens e resolução de vertical visual, ainda com naming Screena.
- **FATO:** `packages/types`: tipos compartilhados; inclui `franchise`, embora o Prisma `EntityType` atual não tenha `franchise`.
- **FATO:** `packages/db`: Prisma schema, migrations, seeds, server-only Prisma client e seed data.
- **FATO:** `api-clients/tmdb`: client real. `api-clients/imdb`, `rotten_tomatoes`, `film_show_ratings`, `streaming_availability` e `kaso`: contratos/README.
- **FATO:** `services/ingestion`: import TMDB para movie/tv/person/seasons/episodes, cache e logs.
- **FATO:** `services/sync`: política de stale e documentação de sync.
- **FATO:** `services/entity-writer`: geração offline de blocos editoriais, validação, GeminiPort, fake/real adapter, jobs e persistência.
- **FATO:** `services/ratings`, `services/streaming`, `services/news-ingestion`: desenho de serviços futuros.
- **FATO:** `workers`: scaffolds Python e documentação de workers offline.
- **FATO:** `docs`: especificação, planos de fase, SEO, ratings, Entity Writer, fontes de API e deploy.
- **FATO:** `.claude/rules`, `.claude/skills`, `.claude/agents`: governança operacional e checklists especializados.
- **FATO:** `tests`: testes de governança, presenters web, indexabilidade, ratings e contratos.
- **FATO:** `seo`: stubs/root helpers para robots/sitemap/templates, ainda não integrados ao App Router.
- **INFERÊNCIA:** A base está boa para trabalho incremental, mas há dívida documental forte: muitos READMEs descrevem Fase 0 enquanto o código já avançou.

## 6. Estado do SEO programático

- **FATO:** Rotas públicas existentes em `apps/web/app/pt`: `/pt/filmes/`, `/pt/filmes/[slug]/`, `/pt/series/`, `/pt/series/[slug]/`, `/pt/pessoas/`, `/pt/pessoas/[slug]/`, `/pt/noticias/`, `/pt/noticias/[slug]/`.
- **FATO:** O header aponta também para `/pt/` e `/pt/explorar/`, mas não há `apps/web/app/pt/page.tsx` nem `apps/web/app/pt/explorar/page.tsx`.
- **FATO:** As páginas de detalhe geram metadata, canonical, breadcrumbs e JSON-LD (`Movie`, `TVSeries`, `Person`, `NewsArticle`/`Article` e `BreadcrumbList`, conforme a rota).
- **FATO:** O domínio canônico usado pelo app atual é `https://thescreen.media`.
- **FATO:** O gate anti-thin existe nos presenters/indexability: entidades com menos de 2 blocos renderizáveis ficam `noindex`; índices/listagens usam critérios mínimos próprios.
- **FATO:** Os blocos renderizáveis aceitam `reviewStatus` `human_reviewed` ou `published`; `ai_generated`, `needs_review` e similares não aparecem como conteúdo público final.
- **FATO:** O app recusa imagens externas/TMDB cruas em presenters e aceita apenas paths locais seguros como `/media`, `/uploads` e `/brand`.
- **FATO:** Não há `apps/web/app/robots.ts`, `apps/web/app/sitemap.ts` ou rotas equivalentes. Há apenas stubs em `seo/robots.ts` e `seo/sitemap.ts`.
- **FATO:** `seo/sitemap.ts` retorna lista vazia e contém TODO de fase futura.
- **FATO:** `next.config.ts` usa `trailingSlash: true`, coerente com as rotas e canonical atuais.
- **FATO:** Não há `AggregateRating` público implementado nas páginas auditadas, o que é conservador enquanto licenças/ratings não estão prontos.
- **INFERÊNCIA:** A base de SEO por entidade está em bom formato para o MVP, mas ainda não é um sistema programático completo porque faltam sitemap real, robots real, home/explorar, busca, subrotas e pipeline de indexabilidade persistida.
- **RECOMENDAÇÃO:** Priorizar sitemap/robots reais e correção de links quebráveis do header antes de aumentar volume de páginas.

## 7. Estado dos dados e integrações

- **FATO:** PostgreSQL/Prisma existe de fato. O schema usa `DATABASE_URL`, 13 enums e tabelas para idiomas, países, rating sources, API providers, licenças, filmes, séries, temporadas, episódios, pessoas, créditos, slugs, redirects, translations, content blocks, jobs/logs, ratings externos, watch availability, indexability, api cache/logs e notícias.
- **FATO:** Migrations reais existem em `packages/db/prisma/migrations`, incluindo schema inicial e migração de artigos/notícias.
- **FATO:** Seeds existem para idiomas, países, fontes de rating, provedores e licenças com defaults seguros.
- **FATO:** TMDB está implementado como client e serviço de ingestão TypeScript/Node. Ele persiste metadados, IDs externos, créditos, temporadas/episódios e logs/cache.
- **FATO:** TMDB é tratado como provider técnico; `voteAverageTmdb` é marcado como dado técnico e não rating editorial.
- **FATO:** IMDb, Rotten Tomatoes, Metacritic, Letterboxd e FilmAffinity estão modelados como fontes de rating em config/docs/schema, mas não há client/worker funcional de ratings no mesmo nível do TMDB.
- **FATO:** Streaming Availability e Kaso existem como contratos/README; `watch_availability` existe no schema, mas o serviço funcional não foi implementado.
- **FATO:** RSSPRIME/MN26 aparecem na documentação de notícias, mas `services/news-ingestion` é README/contrato; não há ingestão real de feeds auditada.
- **FATO:** Gemini está implementado no Entity Writer offline, com adapter real e fake para testes, nunca dentro de `apps/web`.
- **FATO HISTÓRICO:** Antes do alinhamento, `.env.example` usava `SCREENA_TMDB_API_KEY`, mas `api-clients/tmdb` esperava `TMDB_READ_ACCESS_TOKEN` ou `TMDB_API_KEY`.
- **FATO HISTÓRICO:** `.env.example` usava domínio legado, enquanto `apps/web/src/lib/site.ts` já hardcodeava `https://thescreen.media`.
- **INFERÊNCIA:** O pipeline de dados real hoje cobre principalmente TMDB + Entity Writer; ratings, streaming e news ingestion estão desenhados, não operacionais.
- **RECOMENDAÇÃO:** Antes de implementar novas integrações, harmonizar nomes de env vars e documentar a fonte de verdade para domínio/canonical.

## 8. Estado editorial e notícias

- **FATO:** O schema tem `Article`, `ArticleTranslation` e `EntityNewsLink`, com defaults seguros: `licenseStatus=unknown`, `displayAllowed=false`, `reviewStatus=draft`, `indexStatus=noindex`.
- **FATO:** O app público tem listagem `/pt/noticias/` e detalhe `/pt/noticias/[slug]/`.
- **FATO:** Presenters de notícias filtram publicação por licença, display, review status e corpo suficiente; imagens externas/TMDB cruas são recusadas.
- **FATO:** A página de notícia pode renderizar artigo publicável com `indexStatus=noindex`, usando metadata noindex quando a decisão editorial não é `index`.
- **FATO:** Notícias relacionadas a entidades são lidas via `entity_news_links` e aparecem em páginas de filme/série/pessoa quando publicáveis e indexáveis.
- **FATO:** O código atual não demonstra ingestão real RSSPRIME/MN26; a ingestão de notícias é apenas especificada em README/worker stub.
- **FATO:** A camada editorial própria existe como contrato e como `content_blocks`; o Entity Writer só gera `editorial_intro` e `cast_intro` na Fase 3A.
- **FATO:** Prompts para `where_to_watch_text`, `ratings_explanation`, FAQ e outros blocos existem, mas a implementação atual da Fase 3A não gera esses tipos.
- **INFERÊNCIA:** Notícias já têm superfície pública e schema, mas ainda dependem de dados inseridos por seed/script/manual, não de um pipeline operacional RSSPRIME/MN26.
- **RECOMENDAÇÃO:** Tratar notícias como segunda prioridade após consistência de entidade: primeiro garantir artigo próprio, licença, corpo suficiente e links de entidade; depois automatizar ingestão.

## 9. Estado de design e branding

- **FATO:** `apps/web/public/brand` contém assets SVG da marca Screen.
- **FATO:** O header usa logo local, layout neutro e links para Filmes, Séries, Notícias e Explorar.
- **FATO:** `apps/web/app/globals.css` implementa uma linguagem visual "White Cinematic Editorial", com fundo claro, layout editorial, cards e estados por vertical.
- **FATO:** Os tokens exigidos continuam documentados: `--screena-movie-red` `#FF3B30` para filmes e `--screena-series-green` `#7AA66D` para séries.
- **FATO:** A diferenciação filme/série não depende só da cor: há labels, URLs, breadcrumbs e schemas distintos.
- **FATO:** Há muitos nomes CSS/classe/comentários com `screena-*`, mesmo no frontend já rebrandado para Screen.
- **FATO:** A documentação de design/handoff ainda usa "Screena Screens" e referência a `maquinanerd/screena`.
- **INFERÊNCIA:** O rebrand visual está parcial e superficialmente aplicado no app público; design tokens e naming interno ainda são legados.
- **RECOMENDAÇÃO:** Separar "marca pública" de "namespace técnico" em uma decisão explícita. É aceitável manter `@screena/*` internamente se docs explicarem, mas o texto público, metadata, assets e canonical precisam ser uniformes.

## 10. Estado dos recursos de usuário

- **FATO:** Não há modelos Prisma de usuário, conta, perfil, sessão, watchlist, favoritos, listas, "já vi", "quero ver", rating próprio ou reviews de usuário.
- **FATO:** `docs/SPEC.md` menciona reviews como parte do domínio amplo, mas o schema atual não implementa reviews próprios.
- **FATO:** Não há rotas públicas ou privadas para login, perfil, listas, avaliações, comentários, curtidas ou compartilhamento social funcional.
- **FATO:** Não há AggregateRating próprio da plataforma.
- **FATO:** O admin é apenas stub; não há painel editorial funcional para revisar/publicar conteúdo.
- **INFERÊNCIA:** A fase atual é totalmente editorial/dados/SEO, sem camada community/user.
- **RECOMENDAÇÃO:** Não iniciar recursos de usuário antes de estabilizar identidade, dados, SEO técnico, admin editorial mínimo e licenças de ratings/streaming.

## 11. Inconsistências e riscos críticos

- **FATO HISTÓRICO:** Marca/domínio no momento da auditoria: pedido atual = Screen/thescreen.media; app público = Screen/thescreen.media; docs canônicas ainda apontavam para identidade/domínio legados.
- **FATO:** Status de fase: docs principais dizem Fase 0 sem DB/app real; repo tem DB, migrations, rotas, ingestion e Entity Writer.
- **FATO HISTÓRICO:** Env vars estavam divergentes antes do alinhamento; client TMDB real exige `TMDB_READ_ACCESS_TOKEN` ou `TMDB_API_KEY`.
- **FATO HISTÓRICO:** Deploy: `docs/CLOUDPANEL_DEPLOY.md` ainda configurava domínio/env/paths/services legados antes deste alinhamento.
- **FATO:** Links do header para `/pt/` e `/pt/explorar/` não têm páginas correspondentes.
- **FATO:** Sitemap/robots do App Router não existem; os stubs de `seo/` não publicam sitemap real.
- **FATO:** `packages/types` inclui `franchise`, mas Prisma `EntityType` não inclui `franchise`.
- **FATO:** `services/entity-writer/README.md` ainda mistura descrição antiga de Python worker/all block types com implementação real TypeScript/Fase 3A.
- **FATO:** A contagem anti-thin nas páginas de entidade usa blocos renderizáveis, não necessariamente o conjunto completo de `VALUE_BLOCK_TYPES` semântico em `packages/seo/value-blocks.ts`.
- **FATO:** Série renderiza `overview` de temporadas/episódios a partir de dados persistidos; se esses textos vierem do TMDB, há risco de exibição de texto bruto/licença sem gate específico por campo.
- **FATO:** O package DB comenta que server client é para workers/CLIs, mas `apps/web/src/server/**` usa Prisma para leitura de render server-only. Isso está alinhado com "PostgreSQL/cache local", mas conflita com alguns comentários antigos.
- **FATO:** A árvore de trabalho já estava suja antes desta auditoria, com várias alterações em `apps/web` e `apps/web/public/`; este relatório não tenta revertê-las.
- **INFERÊNCIA:** O maior risco não é uma falha isolada de código, mas divergência de fonte da verdade: agentes futuros podem seguir docs de Fase 0/Screena e sobrescrever a direção Screen.
- **RECOMENDAÇÃO:** Fazer um commit apenas de alinhamento documental e config de identidade antes de qualquer feature.

## 12. O que já está pronto de forma verificável

- **FATO:** Monorepo pnpm, aliases TS/Vitest e CI básico existem.
- **FATO:** Scripts `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit:invariants` e `pnpm audit:render` estão definidos.
- **FATO:** CI executa typecheck, lint, test e auditoria de invariantes.
- **FATO:** Prisma schema, migrations e seeds existem.
- **FATO:** Defaults seguros de banco existem para licenças, indexabilidade, display, review status e idioma.
- **FATO:** Client TMDB real existe com testes.
- **FATO:** Ingestão TMDB real existe para movie/tv/person/seasons/episodes, com cache/logs/persistência.
- **FATO:** Entity Writer real existe como pipeline offline TypeScript, com validação anti-alucinação, hashes, jobs/logs e adapter Gemini separado do render.
- **FATO:** App público renderiza entidades e notícias a partir de PostgreSQL/server data.
- **FATO:** Presenters puros têm cobertura de testes para não inventar dados, filtrar imagens externas e aplicar gate anti-thin.
- **FATO:** Testes de governança verificam invariantes de docs, ratings, idioma, schema defaults, render purity, provider separation e layering.
- **FATO:** Brand assets locais Screen existem.
- **INFERÊNCIA:** A base é forte para continuar incrementalmente, desde que a próxima rodada seja de consolidação e não expansão desordenada.

## 13. O que está parcialmente implementado

- **FATO:** Rebrand para `thescreen.media` está parcialmente implementado no app público e scripts de validação, mas não em docs, env, deploy, pacote e naming interno.
- **FATO:** SEO programático tem rotas, metadata e JSON-LD de páginas principais, mas falta sitemap/robots real, home, explorar, busca, subrotas e escala programática.
- **FATO:** Notícias têm schema e rotas, mas não ingestão RSSPRIME/MN26 operacional.
- **FATO:** Ratings têm schema, config, testes e regras, mas não coleta/exibição pública real.
- **FATO:** Streaming tem schema e contrato, mas não coleta/exibição pública real nem rota `/onde-assistir/`.
- **FATO:** Entity Writer gera apenas blocos Fase 3A (`editorial_intro`, `cast_intro`); prompts de outros blocos existem sem runtime correspondente.
- **FATO:** Admin é planejado, mas não implementado.
- **FATO HISTÓRICO:** Deploy CloudPanel estava documentado para identidade/domínio legados e com trechos obsoletos sobre Fase 0.
- **INFERÊNCIA:** O produto está em estado de "vertical slice técnica", não em beta publicável.

## 14. O que ainda não existe

- **FATO:** Não existe home `/pt/`.
- **FATO:** Não existe `/pt/explorar/`.
- **FATO:** Não existe busca.
- **FATO:** Não existem páginas de temporada/episódio isoladas.
- **FATO:** Não existem subrotas de filme/série para onde assistir, elenco, avaliações ou reviews.
- **FATO:** Não existe sitemap público real no App Router.
- **FATO:** Não existe robots público real no App Router.
- **FATO:** Não existe admin editorial funcional.
- **FATO:** Não existe autenticação, usuário, perfil, watchlist, favoritos, listas, rating próprio ou review de usuário.
- **FATO:** Não existe worker funcional de ratings.
- **FATO:** Não existe worker funcional de streaming.
- **FATO:** Não existe worker funcional de ingestão RSSPRIME/MN26.
- **FATO:** Não existe decisão de licença operacional para exibir ratings/streaming em escala.
- **FATO:** Não existe pipeline de imagens remoto->local completo auditado.
- **FATO:** Não existe i18n público `en`/`es` revisado.
- **FATO:** Não há evidência de banco de produção, staging real ou deploy ativo.
- **INFERÊNCIA:** O caminho para publicação passa por infraestrutura editorial/dados antes de features sociais.

## 15. Recomendações prioritárias

1. **RECOMENDAÇÃO:** Criar um commit de alinhamento de identidade: Screen como marca pública, domínio `thescreen.media`, canonical, env example, deploy docs, README e docs principais.
2. **RECOMENDAÇÃO:** Atualizar `CLAUDE.md`/`AGENTS.md`/docs de fase para refletir o estado real: Fase 1/2/3A parcialmente implementadas, com exceção TS/Node para TMDB e Entity Writer.
3. **RECOMENDAÇÃO HISTÓRICA, TRATADA NO ALINHAMENTO:** Corrigir env vars de TMDB em `.env.example` e docs para `TMDB_READ_ACCESS_TOKEN`/`TMDB_API_KEY`, mantendo chaves server-only.
4. **RECOMENDAÇÃO:** Implementar ou remover temporariamente links do header para rotas inexistentes (`/pt/`, `/pt/explorar/`).
5. **RECOMENDAÇÃO:** Implementar `robots.ts` e `sitemap.ts` reais no App Router, com domínio `thescreen.media`, noindex para staging/drafts e only-index para páginas aprovadas.
6. **RECOMENDAÇÃO:** Revisar exibição de `overview` de temporadas/episódios para garantir licença/display ou migrar para blocos editoriais revisados.
7. **RECOMENDAÇÃO:** Atualizar README de `packages/db`, `database/schema.md`, `services/entity-writer/README.md`, `scripts/import/README.md` e `docs/CLOUDPANEL_DEPLOY.md` para não induzirem agentes a uma Fase 0 inexistente.
8. **RECOMENDAÇÃO:** Antes de ratings/streaming, decidir licenças e attribution/display gates com revisão humana explícita.
9. **RECOMENDAÇÃO:** Criar admin editorial mínimo apenas após estabilizar schema e gates: revisar `content_blocks`, artigos, indexability e logs.
10. **RECOMENDAÇÃO:** Tratar recursos de usuário como fase posterior, depois de SEO/dados/editorial estarem sólidos.

## 16. Plano recomendado de próximos commits

1. **Commit 1 - Auditoria e alinhamento de verdade**
   - Manter este relatório.
   - Atualizar docs principais para declarar estado real e rebrand, sem mudar comportamento.
   - Resultado esperado: agentes passam a seguir a mesma fonte da verdade.

2. **Commit 2 - Identidade pública e env**
   - Padronizar Screen como marca pública principal.
   - Atualizar `.env.example`, docs de deploy e constantes públicas.
   - Resultado esperado: canonical/domínio/env sem contradição.

3. **Commit 3 - Navegação pública mínima**
   - Criar `/pt/` ou ajustar header.
   - Criar `/pt/explorar/` ou remover link até existir.
   - Resultado esperado: header sem links para 404.

4. **Commit 4 - SEO técnico base**
   - Implementar `apps/web/app/robots.ts`.
   - Implementar `apps/web/app/sitemap.ts` com páginas indexáveis reais.
   - Adicionar testes/gates para canonical `thescreen.media`.
   - Resultado esperado: indexação programática mínima auditável.

5. **Commit 5 - Auditoria de conteúdo bruto/licença**
   - Revisar `overview` de seasons/episodes e qualquer dado externo exibido.
   - Gatear por licença/display ou mover para `content_blocks`.
   - Resultado esperado: menos risco de exibir texto externo sem permissão clara.

6. **Commit 6 - Admin editorial mínimo**
   - Implementar somente revisão de `content_blocks`, artigos e decisões de indexabilidade.
   - Sem publicação automática.
   - Resultado esperado: fluxo humano para conteúdo revisável.

7. **Commit 7 - Próxima integração**
   - Escolher uma integração por vez: ratings ou streaming.
   - Começar por contrato/licença/testes, depois worker offline.
   - Resultado esperado: avanço sem quebrar invariantes de licença, atribuição e render puro.
