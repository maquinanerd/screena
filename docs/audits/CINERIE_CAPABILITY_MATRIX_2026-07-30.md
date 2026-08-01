# Matriz de aderencia ao produto — Cinerie (2026-07-30)

> Etapa 18 da auditoria. Estados permitidos:
> `COMPLETO` · `FUNCIONAL, MAS INCOMPLETO` · `PARCIAL` · `SOMENTE ESTRUTURA` ·
> `SOMENTE DOCUMENTACAO` · `SOMENTE TESTE` · `SEED/MOCK` · `NAO IMPLANTADO` ·
> `NAO COMPROVADO` · `INEXISTENTE`
>
> Detalhamento: [`CINERIE_360_AUDIT_2026-07-30.md`](./CINERIE_360_AUDIT_2026-07-30.md).
> Todos os caminhos sao relativos a raiz do repositorio.

---

## A. Catalogo

| Capacidade | Estado | Evidencia | Risco | Proxima acao |
| --- | --- | --- | --- | --- |
| Catalogo TMDB em escala | **NAO IMPLANTADO** | ciclo em `scripts/catalog/catalog-cycle-with-alert.sh`; units systemd "nunca foram instaladas… deploy e container, sem systemd" (`docs/backend/catalog-operations.md:123`) | ALTO — catalogo congela | Dockerfile + servico `cinerie-catalog-worker` no EasyPanel |
| Volume real do catalogo | **NAO COMPROVADO** | nenhum banco consultado | ALTO — decisoes cegas | `pnpm catalog audit-database --json` (read-only) |
| Filmes | FUNCIONAL, MAS INCOMPLETO | `Movie:501`, `/pt/filmes/[slug]` | — | operar o ciclo |
| Series | FUNCIONAL, MAS INCOMPLETO | `TvShow:542` | — | idem |
| Temporadas | FUNCIONAL, MAS INCOMPLETO | `Season:584`, rota real | — | idem |
| Episodios | FUNCIONAL, MAS INCOMPLETO | `Episode:607`, rota real | — | idem |
| Pessoas | FUNCIONAL, MAS INCOMPLETO | `Person:633` | — | idem |
| Elenco / equipe | FUNCIONAL, MAS INCOMPLETO | `CastMember:681`, `CrewMember:702` | — | idem |
| Colecoes / franquias | SOMENTE ESTRUTURA | `Collection:1400` sem slug nem pagina | MEDIO — `entityKind: franchise` no CMS nao resolve | decidir se vira pagina |
| Personagens | INEXISTENTE | sem model; `entityKind: character` existe no CMS | MEDIO | remover do enum do CMS ou criar o model |
| Produtoras / emissoras / keywords | SOMENTE ESTRUTURA | `ProductionCompany:1431`, `Network:1475`, `Keyword:1505` | BAIXO | — |
| Imagens de catalogo | FUNCIONAL, MAS INCOMPLETO | `TmdbImage:1183`; host unico em `packages/public-contracts` | — | expor ao CMS |
| **Videos / trailers** | **SOMENTE ESTRUTURA** | `TmdbVideo:1211` sincronizado; zero render (`filmes/[slug]/page.tsx:28`) | MEDIO — bloco de valor perdido | renderizar embed |
| Busca | COMPLETO | `SearchDocument:1315`, `/pt/busca`, `catalog search-reindex` | — | reusar no endpoint interno |
| Fila / retry / dead-letter / idempotencia | COMPLETO | `CatalogJob:1273`, `idempotency.ts`, `catalog dead-letter` | — | — |
| Sentinela anti-falso-positivo | COMPLETO | `scripts/catalog/lib/queue-health.mjs` | — | — |

## B. Inteligencia externa

| Capacidade | Estado | Evidencia | Risco | Proxima acao |
| --- | --- | --- | --- | --- |
| Ratings — arquitetura e governanca | COMPLETO | `packages/schemas/src/ratings.ts`, `tests/governance/ratings.test.ts`, `ExternalRating:891` | — | — |
| **IMDb** | **SOMENTE ESTRUTURA** | client real `api-clients/film_show_ratings` via **`imdb236` (RapidAPI, terceiro)**; `api-clients/imdb` e so `README.md`; zero consumidor | ALTO — licenca de terceiro nao resolvida | decisao HUMANA de licenca antes de qualquer sync |
| **Rotten Tomatoes** | **INEXISTENTE** | `api-clients/rotten_tomatoes` = so `README.md` | ALTO se prometido | decidir fonte oficial vs abandonar |
| Metacritic / Letterboxd / FilmAffinity | SOMENTE ESTRUTURA | so escalas em `@screena/config` | BAIXO | — |
| Trakt / TV Time / AdoroCinema | INEXISTENTE | — | BAIXO | — |
| **Streaming / onde assistir** | **SOMENTE ESTRUTURA** | `services/streaming` real, sem agendamento; UI gateada pronta | MEDIO | agendar sync + promocao humana |
| **Cinerie Score** | **SOMENTE ESTRUTURA** | `packages/cinerie-score`, `CinerieScoreCalculation:475`, gate de procedencia em `apps/web/src/server/editorial-score.ts:67` | MEDIO — sem insumo | depende de ratings |
| Licencas / atribuicao | COMPLETO | `services/legal`, `SourceLicense:311`, `DataUsageDecision:381` | — | decisao humana por fonte |

## C. Produto do usuario

| Capacidade | Estado | Evidencia | Risco | Proxima acao |
| --- | --- | --- | --- | --- |
| Cadastro / login / sessao / e-mail | COMPLETO | `/api/auth/**` (10 rotas), Brevo REST, `AuthThrottle:2057` | — | — |
| Perfil / privacidade / exportacao / encerramento | COMPLETO | `/api/account/**`, `ConsentRecord:2366`, `DataRequest:2382` | — | — |
| Watchlist / assistido / tracker | COMPLETO | `UserWatchState:2095`, `/pt/tracker` | — | — |
| Progresso de episodios | COMPLETO | `EpisodeProgress:2118` | — | — |
| Historico | COMPLETO | `ViewingEvent:2139`, `/pt/historico` | — | — |
| Avaliacoes de usuario | COMPLETO | `UserRating:2211` | — | — |
| Listas | COMPLETO | `UserList:2167`, 6 rotas | — | — |
| Importacao (Cinerie / Letterboxd CSV) | COMPLETO | `ImportJob:2404`, `/pt/importar` | — | — |
| **Reviews de usuario** | **SOMENTE ESTRUTURA** | `UserReview:2231` + moderacao; sem API, sem UI | BAIXO | expor quando houver decisao |
| **Recomendacoes** | **SOMENTE ESTRUTURA** | `RecommendationSnapshot:2314`; UI declara a ausencia honestamente | BAIXO | expor dominio ja pronto |
| Notificacoes | INEXISTENTE | — | BAIXO | — |

## D. Editorial

| Capacidade | Estado | Evidencia | Risco | Proxima acao |
| --- | --- | --- | --- | --- |
| Payload — redacao manual | COMPLETO | 8 collections, 12 estados, E2E Playwright no CI | — | — |
| Payload — autoria / midia / SEO / fontes / claims / QA | COMPLETO | `collections.ts` | — | — |
| Outbox + lease + CAS atomico | COMPLETO | `2f10aa5`, migration `outbox_lease_and_scopes` | — | — |
| Autopublicacao governada (quotas 5D, fuso IANA, kill switch) | COMPLETO | ADR 0017, `docs/operations/editorial-auto-publication-quota.md` | — | esperar MNScr |
| Contratos versionados | COMPLETO | `packages/editorial-contracts` (5 contratos) | — | — |
| Intake MNScr (`draft_ingest`) | COMPLETO | `POST /internal/editorial-drafts` | — | MNScr conectar |
| Intake autopublicacao (`editorial_auto_publish`) | COMPLETO | `POST /internal/editorial-publications` | — | idem |
| **Worker de projecao** | **NAO IMPLANTADO** | `Dockerfile.publication-worker` pronto; `easypanel-deployment-checkpoint.md:1` = "Nada foi implantado" | ALTO | criar servico |
| **Projecao de vinculos de entidade** | **INEXISTENTE** | evento carrega `entities` (`publication-event-v1:202`, emitido em `publication.ts:308`); zero leitor; unico escritor de `entity_news_links` e `qa-editorial-seed.ts:227` | **CRITICO** | implementar no worker |
| **Render de `bodyBlocks`** | **INEXISTENTE** | `grep bodyBlocks apps/web` → vazio | **CRITICO** | renderizar 10 tipos de bloco |
| Noticias publicas (lista + materia) | FUNCIONAL, MAS INCOMPLETO | `/pt/noticias`, `/pt/noticias/[slug]` | — | ver os dois itens acima |
| **Card de entidade na materia** | **SOMENTE ESTRUTURA** | presenter pronto (`news-presenter.ts:194`), leitor pronto (`news-pages.ts:266`), dado nunca escrito | CRITICO | idem |
| Noticias relacionadas na ficha | SOMENTE ESTRUTURA | `related-news.ts:47` depende de `entity_news_links` | CRITICO | idem |
| Destaques editoriais da home | SOMENTE ESTRUTURA | `home-editorial.ts:89` idem | CRITICO | idem |
| Correcao / retratacao | COMPLETO | `correctedAt` + `correctionNote` com CHECK | — | — |
| **Categorias** | **PARCIAL** | `articles.category` = `String?` livre (`schema.prisma:1569`, "v2: FK ArticleCategory"); `section` = `text` no CMS | MEDIO | taxonomia real |
| **Tags** | **INEXISTENTE** | nenhum model, nenhuma coluna; `internalTags` e `text[]` interno e nao projetado | MEDIO | taxonomia real |
| Autor publico | PARCIAL | collection `authors` real no CMS; publico usa `author_name` texto ("v2: FK Author") | MEDIO | projetar autor |
| Rota de categoria / tag | INEXISTENTE | — | MEDIO | criar apos taxonomia |

## E. Midia

| Capacidade | Estado | Evidencia | Risco | Proxima acao |
| --- | --- | --- | --- | --- |
| Midia editorial: credito / fonte / licenca / permissoes fail-closed | COMPLETO | collection `media` (`collections.ts:409-475`) | — | — |
| Endpoint interno de bytes + autorizacao por finalidade | COMPLETO | `publication-media.ts`, `media-authorization.ts` | — | — |
| Storage port (local + S3/R2) | COMPLETO | `media/storage-config.ts`, `s3-storage.ts` (SDK oficial) | — | provisionar bucket |
| Deduplicacao por hash | COMPLETO | chave `editorial/<xx>/<hash>.<ext>` | — | — |
| Validacao por sniff de bytes | COMPLETO | `media-validation.ts` (JPEG/PNG/WebP/AVIF) | — | — |
| **Conversao WebP** | **INEXISTENTE** | `upload` da collection `media` sem `imageSizes`/`formatOptions`; `sharp` registrado mas nao configurado | MEDIO — LCP/banda | configurar pipeline |
| **Derivados / focal crop** | **INEXISTENTE** | `focalPoint` existe sem consumidor | MEDIO | idem |
| Exclusao segura do original | INEXISTENTE (n/a) | nao ha conversao | BAIXO | so apos conversao + verificacao |
| **Importacao de imagem por URL (fonte)** | **INEXISTENTE** | intake so aceita upload | ALTO para MNScr | implementar com guarda anti-SSRF |
| **Imagens do catalogo expostas ao CMS** | **INEXISTENTE** | — | ALTO | parte da ponte |
| R2/S3 provisionado | NAO COMPROVADO | — | MEDIO | criar bucket |

## F. Ponte catalogo ↔ editorial

| Capacidade | Estado | Evidencia | Risco | Proxima acao |
| --- | --- | --- | --- | --- |
| **API interna de busca de entidades** | **INEXISTENTE** | nenhuma das 40 rotas de API a implementa | ALTO | criar `GET /api/internal/entities/search` sobre `SearchDocument` |
| **Endpoint de resolucao de entidade** | **INEXISTENTE** | — | ALTO | criar |
| **Seletor de entidade no Payload** | **INEXISTENTE** | `entityId: { type: 'text' }` (`collections.ts:606`) | ALTO — erro silencioso | componente `admin.components.Field` |
| Validacao de `entityId` | INEXISTENTE | aceita qualquer string | ALTO | validar no intake e no seletor |
| Autenticacao CMS → Screen-App | INEXISTENTE | service accounts existem no sentido oposto | MEDIO | token de servico |
| **Cinerie Context Service** (`cinerie-editorial-context-v1`) | **SOMENTE ESTRUTURA** | contrato tipado, zero produtores; o arquivo declara: *"o servico que o serve NAO faz parte desta fase"* (`cinerie-editorial-context-v1.ts:4-6`) | MEDIO | depois da ponte basica |

## G. SEO e medicao

| Capacidade | Estado | Evidencia | Risco | Proxima acao |
| --- | --- | --- | --- | --- |
| Indexabilidade (fonte unica) | COMPLETO | `packages/seo`, `evaluateIndexability`, `tests/governance/indexability.test.ts` | — | — |
| Canonical / robots / redirects | COMPLETO | `app/robots.ts`, `slugs`/`redirects` | — | — |
| Sitemap paginado + sitemap index | COMPLETO | `/sitemap.xml`, `/sitemaps/[shard]` | — | — |
| **News sitemap (Google News)** | COMPLETO | `/news-sitemap.xml`, janela 48 h, teto 1.000 | — | submeter no GSC |
| JSON-LD por tipo + BreadcrumbList | COMPLETO | 6 tipos + breadcrumb | — | — |
| hreflang | COMPLETO (vazio, corretamente) | so pt-BR em `PUBLISHED_LOCALES` | — | — |
| Open Graph / Twitter | COMPLETO | `socialTitle`/`socialDescription` | — | — |
| **Links internos / entidades** | **PARCIAL/quebrado** | `approvedInternalLinks` nao renderizado; `entity_news_links` vazio | ALTO | fechar item D |
| **Discover** | INEXISTENTE | — | BAIXO | depende de imagem + E-E-A-T |
| **Score SEO editorial / preview SERP** | INEXISTENTE | — | BAIXO | — |
| **Google Search Console** | **INEXISTENTE** | grep retorna zero | MEDIO | verificar propriedade + submeter sitemaps |
| **GA4** | **INEXISTENTE** | so o *consentimento* `analytics` existe (`ConsentKind:1845`) | MEDIO | instalar respeitando consentimento |

## H. Frontend e infraestrutura

| Capacidade | Estado | Evidencia | Risco | Proxima acao |
| --- | --- | --- | --- | --- |
| 18 telas canonicas | COMPLETO | 32 `page.tsx`; QA visual com PG real | — | — |
| Honestidade de UI (sem fake) | COMPLETO | recomendacao, trailer e provedores declaram ausencia | — | — |
| Diferenciacao filme/serie (5 sinais) | COMPLETO | `tests/governance/vertical.test.ts` | — | — |
| Rotas `/dev/*` | NAO COMPROVADO | `app/dev/ad-preview`, `app/dev/movie-page-preview` | BAIXO | confirmar noindex + fora do sitemap |
| `screen-app` implantado | NAO COMPROVADO | `Dockerfile` | — | — |
| `cinerie-cms` implantado | NAO COMPROVADO | `Dockerfile.cms`; PR #93 sugere deploy real | — | — |
| **`cinerie-publication-worker`** | **NAO IMPLANTADO** | `easypanel-deployment-checkpoint.md:1` | ALTO | criar servico |
| **`cinerie-catalog-worker`** | **INEXISTENTE** | nenhum Dockerfile | ALTO | criar |
| Health / readiness | COMPLETO | `/api/health`, `/healthz`, `/readyz` (CMS e worker) | — | — |
| Backups | PARCIAL | `scripts/backup/*.sh` com `bash -n` no CI | MEDIO | **restore real nunca executado** |
| Segredos runtime (nao build-arg) | COMPLETO | `docs/operations/cms-easypanel-runtime-secrets.md` | — | — |
| Redis | INEXISTENTE (nao necessario) | nenhuma dependencia | — | — |
| CI | COMPLETO | `.github/workflows/ci.yml`, ~30 passos, 5 typechecks, PG16 efemero, Playwright | — | — |

---

## Contagem por estado

| Estado | Capacidades |
| --- | --- |
| `COMPLETO` | 45 |
| `FUNCIONAL, MAS INCOMPLETO` | 9 |
| `PARCIAL` | 5 |
| `SOMENTE ESTRUTURA` | 14 |
| `NAO IMPLANTADO` | 3 |
| `NAO COMPROVADO` | 6 |
| `INEXISTENTE` | 18 |

**Leitura:** o repositorio esta muito mais perto do fim do que o numero de `INEXISTENTE`
sugere. A maioria dos `INEXISTENTE` sao **conectores pequenos entre pecas prontas**
(projetar um campo que ja existe no evento, renderizar uma coluna que ja existe no banco,
criar um Dockerfile para um script que ja existe), nao subsistemas por construir.
