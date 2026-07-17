# Screen — Relatório Técnico Pós-EasyPanel e Home v4.1

> **⚠️ Documento HISTÓRICO — marca anterior (Gate 1.5, 2026-07).**
> Este relatório é um SNAPSHOT de um estado passado do projeto e usa a marca
> e o domínio anteriores (**Screen** / **The Screen**, `thescreen.media`).
> O texto **não** foi reescrito para Cinerie de propósito: ele registra
> achados *sobre* a marca antiga e traz datas, branches e commits de então —
> trocar a marca no corpo falsificaria o registro e tornaria os achados
> incoerentes. A marca pública atual é **Cinerie** (`https://cinerie.com`);
> a fonte viva é [`CLAUDE.md`](../CLAUDE.md) e
> [`REBRANDING-CINERIE.md`](../REBRANDING-CINERIE.md).

> Documento de auditoria **read-only**. Estado do repositório na branch
> `feat/home-hero-carousel`, HEAD `e46cabb`. Nenhum código foi alterado para
> produzir este relatório. As afirmações são fundamentadas no código real, com
> referência `arquivo:linha`. Onde não há prova no código, o item é marcado como
> `NÃO IMPLEMENTADO` / `INFO`, nunca inventado.

**Legenda de marcações**

| Marca | Significado |
| --- | --- |
| `REAL` | Dado real lido do PostgreSQL (ou config real), exibido de forma honesta. |
| `REAL TMDB` | Dado real vindo do TMDB (catálogo/imagens), coletado offline. |
| `REAL LOCAL / SCREEN SCORE` | Nota editorial **própria** do Screen (`screen_score`), não de terceiro. |
| `PARCIAL` | Parte real, parte placeholder/pendente. |
| `PLACEHOLDER` | Conteúdo de exemplo/mock (não é produto). |
| `NÃO IMPLEMENTADO` | Existe contrato/tabela mas nenhum caminho ativo. |
| `DÉBITO` | Dívida técnica registrada (comportamento ok, mas precisa resolver). |
| `RISCO` | Pode ferir invariante/SEO/UX se for a produção sem tratamento. |
| `PRÓXIMO PASSO` | Ação recomendada. |

---

## 1. Sumário executivo

O Screen está numa **fundação sólida e honesta**: a Home `/pt` lê **somente
PostgreSQL** (invariantes 3/4 respeitadas — zero API externa e zero Gemini no
render), a ingestão TMDB roda 100% offline, as imagens são remotas
(`image.tmdb.org`) sem salvar arquivo no servidor, e o hero virou um carrossel
real com arte da obra. Os gates de governança (anti-thin, pureza de render,
imagem governada) estão implementados e travados por auditoria.

**A pergunta central — de onde vêm as notas/estrelas — tem resposta clara e
provada:**

> As estrelas exibidas são a **nota editorial PRÓPRIA do Screen** (`screen_score`,
> escala 5), sob o gate `screen_score_display`. **NÃO** são o `vote_average` do
> TMDB, **NÃO** são `external_ratings` (IMDb/RT/Metacritic), e **não existe
> nenhuma conversão** de `vote_average` → estrelas em lugar nenhum do código.
> **PORÉM**: hoje **só o seed demo** popula `screen_score`. O backfill TMDB
> **nunca** escreve esse campo (fica `NULL`, com `display=false` por default).
> Logo, na base **real** do EasyPanel (populada por backfill TMDB, sem seed
> demo), **as estrelas NÃO aparecem** — o hero e os cards mostram título/ano sem
> nota. O `vote_average` do TMDB é coletado e guardado no banco
> (`vote_average_tmdb`), mas **nunca é exibido**.

Ou seja: a **fonte de verdade da nota** é o Screen Score local governado; a
**cobertura funcional dessa nota em produção é hoje NULA** (falta um processo
editorial que preencha `screen_score`).

**O que está funcionando de verdade:** hero-carousel (arte + carrossel real),
catálogo real (10 filmes + 10 séries do TMDB), "Em breve" real (TMDB
`/movie/upcoming` offline), contagens reais de catálogo, imagens remotas.

**Os dois maiores riscos para produção/indexação:** (1) o **Episodes Ticker**
(faixa amarela) afirma "novo episódio hoje" + "Onde assistir `<streaming>`" com
dados 100% mock, **sem gate de ambiente** (vaza para produção) — tensiona as
invariantes 6 e 8; (2) os **chips de plataforma** (Max/Netflix/…) nos tiles de
Série, também sem gate, sugerem streaming inexistente. Ambos precisam ser
gateados/removidos antes de indexar.

---

## 2. Estado atual em produção temporária

| Item | Estado | Evidência |
| --- | --- | --- |
| Branch | `feat/home-hero-carousel`, HEAD `e46cabb` | `git branch --show-current` |
| App | Next.js 15.5.19 (App Router, React 19) | `apps/web/package.json:22-24` |
| Porta | **3000** (`next start` padrão) | `apps/web/package.json:9-11`; `docs/CLOUDPANEL_DEPLOY.md:82` |
| Banco | Postgres separado (`screen-db`), via `DATABASE_URL` + Prisma | `apps/web/src/server/*` usam `@screena/db/server` |
| Serviço `feed` (RSS Prime) | **NÃO TOCADO** — fora do monorepo do app | (nenhuma dependência de `feed` em `apps/web`) |
| Rota pública | abre em `/pt` (`force-dynamic`) | `apps/web/app/pt/page.tsx:60` |
| Render | lê só PostgreSQL; zero TMDB/Gemini no render | verificado (§3) |

**Últimos commits relevantes** (`git log --oneline`):

```
e46cabb polish(web): make home hero a real artwork carousel   <- Home v4.1 (hero real)
46aac93 fix(web): use remote tmdb images without local media   <- pivô imagem remota
0108e67 fix(web): serve runtime tmdb media via route handler   <- (revertido)
9f92de0 fix(web): serve tmdb media assets                      <- (revertido)
fbdd6e5 fix(tmdb): expose upcoming movies in read port
e4f6aa5 feat(web): add tmdb-backed upcoming movies
029c7f7 fix(web): gate home visual placeholders
f54b567 fix(web): use governed scores in home cards
```

**Git status:** 30 entradas sujas na working tree, **todas pré-existentes e não
relacionadas ao hero** (`.claude/*`, `docs/*`, `README.md`, `CLAUDE.md`,
`AGENTS.md`, `.env.example`, `.github/workflows/ci.yml`, `package.json`,
`packages/ui/src/vertical.ts`, `tests/governance/vertical.test.ts`,
`THE_SCREEN.md`, `tests/admin/no-write-endpoints.test.ts`, etc.). O trabalho do
hero já está **commitado** (`e46cabb`) — nada do hero está pendente. `DÉBITO`:
essas 30 mudanças sujas de sessões anteriores deveriam ser commitadas ou
descartadas em separado para higiene do repo.

**Como o app sobe no EasyPanel:** não há `Dockerfile`, `nixpacks.toml` nem
`Procfile` no repositório (só `docker-compose.dev.yml`, que é para o Postgres de
desenvolvimento local). Logo, o EasyPanel constrói via **Nixpacks
auto-detectado** (pnpm + Next). `INFO`: o `docs/CLOUDPANEL_DEPLOY.md` descreve
um caminho de deploy **diferente** (VPS/CloudPanel + PM2/systemd) — é o alvo
histórico/futuro, **não** o deploy EasyPanel atual; não confundir os dois.

**Serviços que NÃO devem ser tocados:** `feed` (RSS Prime), `screen-db`
(manualmente), config do EasyPanel, DNS/Cloudflare.

---

## 3. Arquitetura atual de dados

**Fluxo canônico (implementado e coerente com invariantes 3/4):**

```
TMDB API  ──(worker OFFLINE, com log)──►  api_cache (bruto)  ──►  tabelas finais (Postgres)
                                                                        │
apps/web (RSC, force-dynamic)  ◄── getters server-only (Prisma) ◄───────┘
   └── presenters PUROS ──► componentes (render lê SÓ Postgres)
```

- **Endpoints TMDB usados hoje** (`REAL TMDB`): exatamente 5 —
  `/movie/{id}`, `/tv/{id}`, `/tv/{id}/season/{n}`, `/person/{id}` e
  `/movie/upcoming`. **Não** há `popular`, `trending`, `discover`, `top_rated`,
  `now_playing`. Evidência: `api-clients/tmdb/src/endpoints.ts:53-85`.
- **Backfill de catálogo** (`services/ingestion/bin/ingest-public-catalog.ts`):
  lista **curada fixa de 10 filmes + 10 séries** (`MOVIE_IDS`/`TV_IDS`,
  `:59-60`), + até 20 upcoming opcionais (`--include-upcoming`,
  `UPCOMING_IMPORT_CAP=20`, `:67-69`). **Não** há paginação de catálogo em massa.
- **Upcoming** (`REAL TMDB`): usa `/movie/upcoming` (região BR) no `--apply`,
  roteado por `api_cache` + log em `api_sync_logs`
  (`ingest-public-catalog.ts:245-277`). No render, `home-upcoming.ts:56-67` lê
  só `Movie.releaseDate > hoje` do Postgres.
- **Render chama TMDB?** **NÃO** (`REAL`/`CONFIRMED`). Todos os getters
  (`home-hero.ts`, `home-upcoming.ts`, `entity-indexes.ts`) usam apenas
  `prisma.*`. O guard `scripts/audit/check-render-purity.mjs` bloqueia `fetch(`
  a hosts externos e imports de `@screena/db`/api-clients em páginas.
- **Token TMDB no frontend?** **NÃO** (`CONFIRMED`). Grep por
  `NEXT_PUBLIC_TMDB`/`TMDB_API_KEY`/`TMDB_READ_ACCESS_TOKEN` em `apps/web` = zero.
  O token vive só no worker (`ingest-public-catalog.ts:294-296`;
  `api-clients/tmdb/src/http.ts:219-231`).
- **Banco guarda `tmdbId`** (`Int @unique`) e `posterPath`/`backdropPath` como
  **`file_path` CRU do TMDB** (`schema.prisma:230,240-241` Movie;
  `:269,281-282` TvShow; `:358,366` Person).
- **Resiliência** (`CONFIRMED`): retry+backoff+jitter, circuit breaker por fonte,
  throttle, short-circuit por `payload_hash`, log obrigatório em `api_sync_logs`
  (`api-clients/tmdb/src/http.ts:139-202`; `import-movie.ts:20-38`).

`DÉBITO` (documentação): comentários em `apps/web/app/pt/page.tsx:53-54,271-276`
**e** em `apps/web/next.config.ts:17-19` ainda afirmam que "imagens vêm de
caminhos LOCAIS … CDN externa fica fora do render" — **contradiz** a arquitetura
remota atual. É dívida de comentário (o comportamento é remoto), mas engana
mantenedores futuros.

---

## 4. Arquitetura atual de imagens

**Decisão vigente (implementada e travada por guard):** imagem TMDB **REMOTA**,
servidor **não salva imagem**, banco guarda `file_path` cru, frontend monta a URL
e renderiza com `<img>` normal.

Confirmado com prova:

| Requisito | Estado | Evidência |
| --- | --- | --- |
| Não salva JPG local | `REAL` | `services/ingestion/src/public-catalog-image.ts:40-45` (default = `file_path` cru) |
| Não salva WebP local | `REAL` | idem (nada é baixado por padrão) |
| Não depende de `/media/tmdb` | `REAL` | dir gitignored e vazio; `.gitignore:15` |
| Não usa volume persistente | `REAL` | `middleware.ts` serve estático via `public/` |
| Não usa `next/image` optimizer | `REAL` | zero import de `next/image`; `next.config.ts` sem `images:` |
| Usa `<img>` normal | `REAL` | `entity-card.tsx:48`, `page.tsx:289/441/472/501` |
| Host só no helper governado | `REAL` | `tmdb-image-url.ts:20`; guard `check-render-purity.mjs:130,364` |

**Por que a abordagem local foi abandonada / por que não WebP local:** a decisão
(commit `46aac93`) foi não salvar imagem no servidor (sem disco/volume, sem
route handler de mídia — o route handler `0108e67` foi **revertido**),
eliminando estado de arquivo, sincronização e custo de storage. Como o servidor
não processa a imagem, **não há etapa de conversão para WebP** — o tamanho é
escolhido pelo segmento de `size` da URL do TMDB (`w500/w780/w1280`), sem
reescrever extensão.

**Trade-off SEO/performance (`INFO`/`RISCO` leve):** a imagem remota introduz
dependência de terceiro (`image.tmdb.org`) e uma origem externa a mais (DNS/TLS
por domínio), **sem cache próprio**. Positivo: zero storage, sempre atualizado,
CDN do TMDB é robusto. Mitigação futura: cache de borda (Cloudflare) por cima do
CDN do TMDB.

**Superfícies migradas:**
- **100% remoto (sem local-first):** Hero (`home-hero-presenter.ts:164-165`,
  `w1280→w780`) e "Em breve" (`home-upcoming-presenter.ts:105`, `w780→w500`).
- **Local-first `?? remoto`:** cards de filme/série, detalhe de filme/série,
  elenco e pessoas (`movie-presenter.ts:146` e espelhos): tentam asset local
  committado (`/media/`,`/uploads/`,`/brand/`) e caem para a URL remota do TMDB.
  Para dados **reais** de backfill (paths crus tipo `/abc.jpg`), o local-first é
  rejeitado e resolve **remoto** — então na base do EasyPanel as imagens são
  remotas.

`DÉBITO` residual (não afeta a base real, mas mantém caminho local vivo):
- 15 PNGs de demo committados em `apps/web/public/media/demo/` (bridge do seed
  demo).
- O presenter de **notícias** é **local-only** (`news-presenter.ts:191`), sem
  fallback remoto ao TMDB — diverge das demais superfícies (feature de notícias
  não é produto ativo).
- Logos de marca em `/brand/*.svg` são asset institucional legítimo (`INFO`,
  fora do escopo de imagem de conteúdo).

**Resíduo indevido de `/media/tmdb`, `SCREEN_MEDIA_ROOT`, route handler:**
**nenhum ativo** — todas as menções são comentários ou o token de exclusão
`_next/image` no matcher do middleware.

---

## 5. Estado do Hero / carrossel

`REAL` — funcional e fiel ao design v4.1.

| Pergunta | Resposta | Evidência |
| --- | --- | --- |
| Server ou Client Component? | **Client** (`"use client"`), recebe slides do server | `hero-carousel.tsx:1`; dados por `home-hero.ts` (server) |
| De onde vêm os slides? | `getHomeHeroSlides` (Prisma: filme/série + slug pt-BR + tradução + diretor + elenco) | `home-hero.ts:225-250` |
| Quantos slides? | máx. **5** (`HOME_HERO_SLIDE_LIMIT`) | `home-hero.ts:27,233` |
| Campos por slide | vertical, eyebrow, title, href, primaryMeta, rating, certification, director, cast, synopsis, **imageUrl** | `home-hero-presenter.ts:87-112` |
| Usa `backdropPath`? | **Sim**, `w1280` | `home-hero-presenter.ts:25,163-166` |
| Fallback `posterPath`? | **Sim**, `w780` | idem |
| Size TMDB | `w1280` (backdrop) → `w780` (poster) | idem |
| Troca automática? | **Sim**, autoplay `setTimeout` ~6s, reagendado a cada troca | `hero-carousel.tsx:41,95-101` |
| Setas? | **Sim** (`‹ ›`, `count>1`) | `hero-carousel.tsx:262-277` |
| Dots? | **Sim** (`role=tablist`) | `hero-carousel.tsx:279-292` |
| Pausa em hover/foco/interação? | **Sim** (`onMouseEnter/Leave/Focus/Blur` → `paused`) | `hero-carousel.tsx:148-151` |
| `prefers-reduced-motion`? | **Sim**, reativo via `matchMedia` + CSS | `hero-carousel.tsx:85-91`; `globals.css:1098-1102` |
| Quantos H1 no DOM? | **exatamente 1** (só o slide ativo usa `<h1>`; inativos usam `<p>`) | `hero-carousel.tsx:196-200` |

**Estado visual esperado:** imagem real visível (backdrop) + scrim em camadas
(preserva a arte) + título 46px + autoplay real. Sem fundo escuro genérico como
padrão — **desde que** o banco tenha `backdropPath`/`posterPath`.

**Riscos:**
- `RISCO` — **hero depende de re-ingestão para ter arte.** `backdropPath`/
  `posterPath` são nullable; sem eles, `resolveHeroImage` retorna `null` e o
  slide cai no **wash de gradiente** (texto sobre gradiente, sem foto).
  Evidência: `home-hero-presenter.ts:159-167`; `schema.prisma:240-241,281-282`.
- `RISCO` — **estrelas dependem de `screenScore` + `screenScoreDisplay`** (default
  `false`); ver §6. Sem esse gate liberado, o hero **nunca** mostra estrelas.
- `RISCO`/`DÉBITO` — **os dois botões ("Onde assistir" e "Ver ficha") apontam
  para o MESMO href** (a ficha). O rótulo "Onde assistir" promete streaming sem
  `watch_availability` real. Evidência: `hero-carousel.tsx:217-233`.
- `CONFIRMED` — **fallback institucional** quando não há slides reais:
  `<section sc-hero--institutional>` com copy própria, sem poster de terceiro
  (`page.tsx:626-642`).

---

## 6. Estado das notas, estrelas e ratings  ⚠️ (parte crítica)

**Resposta objetiva:** as estrelas/notas exibidas são **`REAL LOCAL / SCREEN
SCORE`** — a nota editorial PRÓPRIA do Screen (`screen_score`, escala 5), com
gate `screen_score_display`. **NÃO** é TMDB, **NÃO** é `external_ratings`,
**NÃO** há conversão de `vote_average`.

**Verificado adversarialmente (2 skeptics independentes) — ambos CONFIRMADOS.**

### Respostas explícitas (cada uma provada)

| # | Pergunta | Resposta | Marca | Evidência |
| --- | --- | --- | --- | --- |
| a | As estrelas puxam do TMDB? | **NÃO** | `CONFIRMED` | grep `vote_average` em render = 0; `hero-carousel.tsx:59` |
| b | Campo exato que alimenta as estrelas | `movies.screen_score` / `tv_shows.screen_score` (+`_scale`, +`_display`) | `REAL LOCAL / SCREEN SCORE` | `schema.prisma:248-250,286-288`; `home-hero.ts:123-125` |
| c | Conversão `vote_average` → estrelas? | **Não existe** | `NÃO IMPLEMENTADO` | `rating-stars.tsx:32` (`value` já é screen_score) |
| d | Conversão `vote_average` → Screen Score? | **Não existe** | `NÃO IMPLEMENTADO` | `store.ts:161-162` grava só `voteAverageTmdb`, sem derivar |
| e | Score fake/demo ainda na Home? | **Sim, condicional** — só o seed demo popula | `PLACEHOLDER` | `public-demo-seed.ts:261-263,306-308` (4; 3,5; 4,5) |
| f | Score governado local existe? | **Sim** (`screen_score`), gate duplo | `REAL` | `home-hero-presenter.ts:141-149`; `entity-index-presenter.ts:201-209` |
| g | Fonte de verdade hoje | Screen Score local; funcional em prod real = **NULA** | `REAL`/`RISCO` | `schema.prisma:250` `@default(false)` |

### O ponto crítico (impacto na base real do EasyPanel)

`RISCO` — **numa base populada por backfill TMDB (sem seed demo), as estrelas NÃO
aparecem.** Prova (verificada adversarialmente):

1. O normalizer TMDB só grava `voteAverageTmdb`/`voteCountTmdb`, **nunca**
   `screenScore` (`services/ingestion/src/normalizers/movie.ts:37-50`).
2. O store (`upsertMovie`/`upsertTvShow`) monta o objeto `data` **sem**
   `screenScore`/`screenScoreDisplay` — no `create` prevalece o default do
   schema, no `update` esses campos não são tocados (`store.ts:153-171,194-213`).
3. O `finalize()` do backfill só atualiza `posterPath`/`backdropPath` (+slug/
   tradução) (`ingest-public-catalog.ts:199-209`).
4. Schema: `screen_score` é `Decimal?` (→ `NULL`) e `screen_score_display` é
   `Boolean @default(false)` (`schema.prisma:248-250,286-288`).
5. O gate de render corta antes de olhar o valor:
   `if (!input.screenScoreDisplay) return null` (`home-hero-presenter.ts:142`).
6. **Único** ponto que escreve `screen_score` (hardcoded, `display=true`): o seed
   demo (`apps/admin/scripts/public-demo-seed.ts:261-263,306-308`;
   `public-demo-seed-plan.ts:239,268,296,344,371,401`).

Como o backfill **aborta em produção** (`isProd`) e o seed demo não roda por essa
via, o **resultado esperado no EasyPanel é: home sem estrelas** até existir um
processo editorial que preencha `screen_score`.

### Estado das outras fontes de rating

- **TMDB `vote_average`/`vote_count`** — `REAL TMDB` no armazenamento, mas
  **invisível**: coletado e persistido em `vote_average_tmdb`/`vote_count_tmdb`
  (`store.ts:161-162,204-205`), marcado no schema como "dado técnico; NUNCA nota
  editorial" (`schema.prisma:238-239`). Nenhum presenter o exibe.
- **`external_ratings` (IMDb/RT/Metacritic)** — `NÃO IMPLEMENTADO`: a tabela
  existe com toda a governança (`rating_source`, `provider_api` separado,
  `display_allowed @default(false)`) em `schema.prisma:590-620`, mas **nunca é
  escrita nem lida**. O validador puro `validateRating`
  (`packages/schemas/src/ratings.ts`) existe mas não está plugado a exibição.
- **Páginas de detalhe (filme/série)** — `NÃO IMPLEMENTADO`: `movie-presenter.ts`
  e `series-presenter.ts` **não** exibem nota nenhuma (nem screen_score, nem
  vote, nem external). As estrelas existem **só** na home (`hero-carousel` +
  cards).

### O que falta para ratings completos

`PRÓXIMO PASSO` (nenhum destes é produto hoje):
- Processo editorial real que **preencha `screen_score`** (fora do seed demo) —
  o admin editorial (Fase 7) escreve `review_status`/`index_status`, mas não há
  caminho provado de atribuição da nota própria.
- Exibir (com licença/gate) o `vote_average` do TMDB **como TMDB**, atribuído e
  na escala correta — **nunca** como Screen Score.
- Ativar coleta de IMDb/RT/Metacritic → `external_ratings` (exige licença +
  decisão humana; hoje inativo por design).
- Comparação crítica vs. audiência, nota de usuários, reviews próprias — roadmap.

---

## 7. Estado dos blocos da Home

> Header e Footer são renderizados pelo `layout.tsx`, não pela `page.tsx`.

| Bloco | Componente | Fonte | Estado | Observação principal |
| --- | --- | --- | --- | --- |
| **Header** | `site-header.tsx` (layout) | `NAV_ITEMS` (constantes) | `PARCIAL` | Busca é **link** para `/pt/explorar/`, não input funcional; logos `/brand/*.svg`. |
| **Hero** | `hero-carousel.tsx` | `getHomeHeroSlides` (Postgres) | `REAL` | Arte remota TMDB + carrossel real; estrelas dependem de `screen_score` (§6). |
| **Ticker amarelo** | `episodes-ticker.tsx` | **mock hardcoded** | `PLACEHOLDER`/`RISCO` | **Sem gate de ambiente** — vaza p/ produção; afirma "novo episódio hoje" + "Onde assistir `<streaming>`". |
| **Destaques** (4+6) | `HomeV4BigCard`/`CompactCard` | `getMovie/SeriesIndexData` | `REAL` | `#N` é posição visual (não ranking); `fillSlots` repete itens reais; "Avaliar"/"Marcar" **desabilitados**. |
| **Filmes em destaque** | `HomeV4PosterCard` | `getMovieIndexData` | `REAL` | Pôster remoto TMDB; nota = `screen_score` governado. |
| **Séries em destaque** | `HomeV4SeriesTile` | `getSeriesIndexData` | `PARCIAL` | Tile real, mas **chip de plataforma é mock** (não `watch_availability`), sem gate. |
| **Estatísticas** | inline `page.tsx` | `totalCount` real | `REAL` | Contagens reais (filmes/séries/pessoas), nunca watchlist. |
| **Em breve** | `coming-soon-rail.tsx` | `getHomeUpcomingMovies` | `PARCIAL` | Real quando há upcoming; fallback mock **gateado** (oculto em prod). |
| **Publicidade** | inline `page.tsx` | estático | `PLACEHOLDER` | "Google AdSense 728×90" **gateado** (oculto em prod). |
| **Notícias** | `HomeV4NewsFeature`/`Mini` | `getNewsIndexData` | `PARCIAL` | Real quando há artigo; manchetes mock **gateadas** (Oppenheimer/Duna…). |
| **Footer** | `site-footer.tsx` (layout) | constantes | `PARCIAL` | Labels de filtro apontam ao índice pai; newsletter **gateada**; atribuição TMDB presente. |

Detalhes e evidências por bloco em §8. **Indexabilidade** (`INFO`): a home é
`index` só com ≥2 seções reais (`countPopulatedSections` sobre
`movieCards`/`seriesCards`/`newsCards`, `MIN_PORTAL_SECTIONS=2`); placeholders
**não** inflam o gate (`page.tsx:103-124`; `portal-presenter.ts:20`).

---

## 8. Placeholders, mocks e dados reais

### 8.1 REAL (não é placeholder)

- **Hero, cards, estatísticas, "Em breve" real** — só PostgreSQL
  (`home-hero.ts`, `entity-indexes.ts`, `home-upcoming.ts`).
- **Nota `screen_score`** — nota editorial própria governada (mesmo gate no hero
  e nos cards); nunca rating externo/AggregateRating
  (`entity-index-presenter.ts:201-205`).
- **Páginas de detalhe** — honestas: "Avaliações"/"Onde assistir" **não** são
  renderizadas sem dado real; `WatchProviders` só com `providers.length>0`; botão
  de play é decorativo `aria-hidden` (`filmes/[slug]/page.tsx:143-148,200-204,271-275`).

### 8.2 PLACEHOLDER **gateado** por ambiente (oculto em produção) — [Aceitável por enquanto]

Gate: `allowHomeVisualPlaceholders()` = `!production || flag==='1'`
(`home-placeholder-governance.ts:44-51`).

- **Notícias mock** (`HOME_FEATURED_NEWS`/`HOME_GRID_NEWS`, `page.tsx:185-218`).
- **"Em breve" fallback** (`HOME_COMING_SOON_ITEMS`, com duração de trailer fake,
  `page.tsx:153-160`).
- **Publicidade** ("Google AdSense", `page.tsx:810-818`).
- **Newsletter do rodapé** (pseudo-form → "Newsletter em breve" em prod,
  `site-footer.tsx:180-202`).

### 8.3 PLACEHOLDER que **VAZA para produção** (sem gate) — [Crítico antes de indexação SEO / domínio oficial]

- `RISCO` **Episodes Ticker** (`episodes-ticker.tsx:53-91`): renderizado
  **incondicionalmente** em `page.tsx:648`. Mock de episódios (Wednesday, The
  Bear, Severance, The Last of Us, The Boys) que **afirma** "novo episódio hoje"
  + CTA "Onde assistir" + wordmark de streaming, **sem `watch_availability`
  real**. Tensiona invariante 6 (dado sem licença) e invariante 8/regras de
  streaming. O próprio código reconhece a dívida (`episodes-ticker.tsx:15-22`).
  O `href` é safe-link (`SERIES_INDEX_PATH`), mas o **texto** continua falso.
- `RISCO` **Chips de plataforma** dos tiles de Série (`homeVisualPlatform`,
  `page.tsx:133-144,759-766`): sempre presentes quando há séries reais, **sem
  gate**. `aria-hidden` reduz a exposição semântica, mas visualmente associa um
  streaming (Max/Netflix/…) a um título real sem disponibilidade.

### 8.4 INFO — aceitável, honesto

- `#N` dos cards é posição de slot (não ranking real); "Avaliar"/"Marcar" são
  affordances **desabilitadas** (`aria-disabled`, sem handler) (`page.tsx:336-342`).
- `fillSlots` repete itens **reais** em ciclo para encher 4+6 / 6 slots quando o
  catálogo é pequeno — não inventa item novo, mas **duplica** cards
  (`page.tsx:73-76`).

`OPEN` (verificar no deploy): confirmar que `NODE_ENV=production` **e**
`SCREEN_HOME_VISUAL_PLACEHOLDERS` **não** está `=1` no EasyPanel — senão todos os
placeholders gateados vazariam.

---

## 9. SEO técnico

| Item | Estado | Evidência |
| --- | --- | --- |
| Domínio canônico | **hardcoded** `https://thescreen.media` (não é env) | `site.ts:9`; `layout.tsx:21` (`metadataBase`) |
| Canonical autorreferente | `REAL` (via `canonicalPublicUrl`) | `page.tsx:122`; `site.ts:67-74` |
| `robots.txt` | `REAL` (dinâmico): allow `/`, disallow `/api /dev /admin`; sitemap → thescreen.media | `apps/web/app/robots.ts` |
| `sitemap.xml` | `REAL` (dinâmico, de `page_indexability_decisions`; fallback rotas estáticas) | `apps/web/app/sitemap.ts` |
| Metadata/title/description | `REAL` por rota (`generateMetadata`) | `page.tsx:113-124` |
| Robots por página (index/noindex) | `REAL` (gate anti-thin `evaluatePortalIndexability`) | `page.tsx:113-124` |
| Open Graph | `PARCIAL`: siteName/locale/type; **sem `og:image`** (deliberado — sem asset raster) | `layout.tsx:25` |
| Twitter card | `PARCIAL`: `summary` (sem imagem) | `layout.tsx:26` |
| Schema.org JSON-LD | `REAL` nas fichas: Movie/TVSeries/Person/NewsArticle/BreadcrumbList/CollectionPage | 9 arquivos (`filmes/[slug]`, `series/[slug]`, `pessoas/[slug]`, `noticias/[slug]`, `explorar`…) |
| H1 na home | **1** (hero ativo) | `hero-carousel.tsx:196-200` |
| `alt` de imagens | `REAL` (backdrop do hero é decorativo `alt=""` `aria-hidden`; cards têm alt) | `hero-carousel.tsx:171-185` |
| URLs localizadas | `REAL` (`/pt/…`, `trailingSlash:true`) | `next.config.ts:25`; `site.ts` |
| `hreflang` | `NÃO IMPLEMENTADO` (correto no MVP: só pt-BR publicado) | — |

**Riscos e respostas:**

- `RISCO` **Domínio temporário vs. canônico.** `SITE_URL` é **fixo** em
  `thescreen.media` — **não** há env (`SCREENA_PUBLIC_SITE_URL`/
  `THE_SCREEN_PUBLIC_SITE_URL`) lido pelo código (o `docs/CLOUDPANEL_DEPLOY.md:351`
  menciona `THE_SCREEN_PUBLIC_SITE_URL`, mas o código **não** o consome — é
  **drift doc↔código**). Consequência: no domínio temporário
  `…nult1k.easypanel.host`, **todo** canonical/OG/sitemap aponta para
  `thescreen.media` (que ainda não resolve). Isso **evita** que o domínio
  temporário vire canônico (bom), mas o canonical autorreferente aponta para um
  domínio que hoje daria 404.
- `RISCO` **O domínio temporário deve ser indexado?** **Não.** Com catálogo real
  (10 filmes + 10 séries), a home tem ≥2 seções reais → `evaluatePortalIndexability`
  decide `index` → o meta robots emite `index,follow` **no domínio temporário**.
  Se o Googlebot alcançar `…easypanel.host`, verá `index` + canonical para
  `thescreen.media`. **Recomendação (P0):** bloquear indexação do domínio
  temporário (Basic Auth, ou `X-Robots-Tag: noindex` no proxy, ou variável que
  force `noindex`) até o domínio oficial estar no ar.
- **Está pronto para indexar (no domínio oficial)?** Tecnicamente a base de SEO
  está boa (canonical, sitemap dinâmico, schema, 1 H1, gate anti-thin). **Mas
  não indexar** antes de: (1) resolver o Episodes Ticker + chips de plataforma
  (§8.3, ferem streaming/invariantes); (2) decidir a exibição de nota
  (`screen_score` vazio → home sem estrelas). Ambos são de conteúdo/honestidade,
  não de SEO estrutural.
- **Quais rotas ao sitemap?** As decididas `index` em `page_indexability_decisions`
  (hoje, na prática, só pt-BR com dado real). `noindex`/`draft`/`blocked` nunca
  entram.

---

## 10. Infraestrutura e deploy

- **Build:** `corepack pnpm --filter @screena/web build` (raiz) → `next build`
  (`package.json:13`; `apps/web/package.json:9`).
- **Start:** `next start`, porta **3000** (`apps/web/package.json:11`).
- **Runtime:** Node **22 LTS** (engine `>=22 <23`), pnpm 9.15.4 via Corepack
  (`package.json:8-10`). `INFO`: o ambiente local usa Node 24 (warning de engine
  é benigno).
- **Build EasyPanel:** Nixpacks auto-detectado (não há `Dockerfile`/`nixpacks.toml`
  no repo).
- **Banco:** Postgres `screen-db`, `DATABASE_URL` (Prisma); migrations via
  `prisma migrate deploy`; o Prisma CLI **não** lê o `.env` da raiz (exportar
  `DATABASE_URL` inline).
- **Build sem banco:** `page.tsx`/`sitemap.ts` são `force-dynamic` — o build roda
  sem `DATABASE_URL`; nada é pré-renderizado.
- **CI:** `.github/workflows/ci.yml` roda os gates (typecheck, lint, test,
  `audit:invariants`, `audit:render`, build). `DÉBITO`: o arquivo está sujo/
  modificado na working tree (não commitado).
- **Variáveis de ambiente relevantes** (inferidas do código; `.env.example` não
  lido nesta sessão por restrição de permissão):
  - `DATABASE_URL` (obrigatória, Prisma).
  - `TMDB_READ_ACCESS_TOKEN` (v4) / `TMDB_API_KEY` (v3) — **só no worker** de
    ingestão; nunca no frontend.
  - `SCREEN_HOME_VISUAL_PLACEHOLDERS` (`=1` força placeholders visíveis — **não**
    setar em produção).
  - `NODE_ENV=production` (fecha os gates de placeholder).
  - **Não existe** env de domínio canônico wired no código (`SITE_URL` é fixo).

---

## 11. Riscos e débitos técnicos

| Risco/Débito | Impacto | Urgência | Ação recomendada | Bloqueia domínio oficial? |
| --- | --- | --- | --- | --- |
| **Episodes Ticker** mock (streaming/episódio) sem gate | Fere invariantes 6/8 em produção pública | **Alta** | Gatear por `allowHomeVisualPlaceholders`, ou trocar por `watch_availability` real, ou remover | **SIM** |
| **Chips de plataforma** (Séries) mock sem gate | Sugere streaming inexistente | **Alta** | Gatear/remover; trocar por `watch_availability` governada | **SIM** |
| **`screen_score` vazio em prod** → home sem estrelas | Home real sem nota; nota só via seed demo | **Alta** | Definir processo editorial de atribuição do Screen Score (ou exibir vote TMDB atribuído) | Não (mas afeta percepção de "pronto") |
| **Domínio temporário indexável** | Googlebot pode indexar `…easypanel.host` com canonical p/ domínio que não resolve | **Alta** | `noindex`/Basic Auth no domínio temporário até go-live | **SIM** (higiene de índice) |
| **Hero sem arte sem re-ingestão** | Slides caem no wash (sem foto) | Média | Rodar backfill com `posterPath`/`backdropPath` populados | Não |
| **Dependência de `image.tmdb.org`** sem cache próprio | Latência/disponibilidade de terceiro | Média | Cache de borda (Cloudflare) na frente do CDN TMDB | Não |
| **Comentários stale** ("imagens locais") em `page.tsx`/`next.config.ts` | Engana mantenedores | Baixa | Atualizar comentários para refletir imagem remota | Não |
| **Notícias local-only** (sem fallback remoto TMDB) | Divergência de arquitetura de imagem | Baixa | Alinhar `news-presenter` quando notícias virarem produto | Não |
| **15 PNGs demo em `public/media/demo`** | Caminho local vivo (bridge demo) | Baixa | Remover junto do seed demo quando não for mais preciso | Não |
| **Botões "Onde assistir"/"Ver ficha" iguais** | UX: promessa de streaming | Média | Diferenciar CTA ou renomear até haver `watch_availability` | Recomendado |
| **30 arquivos sujos pré-existentes** | Higiene de repo/PR | Baixa | Commit/descartar em separado | Não |
| **Warnings de segredo no Nixpacks** (mencionado pelo usuário) | Vazamento potencial de env em log de build | Média | Revisar como o EasyPanel injeta segredos (env runtime, não build arg) | Recomendado |
| **`fillSlots` duplica cards** com catálogo pequeno | Ilusão de volume | Baixa | Abandonar ciclo quando catálogo crescer | Não |

---

## 12. Próximas fases recomendadas

### P0 — antes do domínio oficial
- **Bloquear indexação do domínio temporário** (`noindex`/Basic Auth) até go-live.
- **Resolver Episodes Ticker + chips de plataforma** (gatear/remover/real).
- **Validar visual do hero** com re-ingestão (arte real, não wash).
- **Confirmar `NODE_ENV=production`** e `SCREEN_HOME_VISUAL_PLACEHOLDERS` não `=1`.
- **Decidir a política de nota** na home (Screen Score editorial vs. ocultar
  estrela até haver dado) — hoje a home real fica sem estrelas.
- **Confirmar imagens remotas** funcionando (sem `/media/tmdb`).

### P1 — após domínio oficial
- Cloudflare + `thescreen.media` + redirect `www` → apex; SSL Full/Full strict.
- QA público; sitemap final; Google Search Console; Analytics.
- (Se necessário) tornar `SITE_URL` configurável por env para staging.

### P2 — produto/UX
- **Atribuição real de `screen_score`** (processo editorial) — desbloqueia
  estrelas na home real.
- Exibir `vote_average` do TMDB **como TMDB** (atribuído, licenciado).
- `watch_availability` / "Onde assistir" real → alimenta ticker/chips honestos.
- Detalhe de filme/série enriquecido; pessoas/elenco; reviews; listas; watchlist;
  ações de usuário reais (hoje desabilitadas).

### P3 — editorial
- RSS Prime / MN26 → notícias reais; relacionamento notícia ↔ entidade; gate
  editorial (Entity Writer/`content_blocks`).

### P4 — performance/infra
- Jobs de ingestão agendados (cron/systemd) — hoje é re-ingest **manual**.
- Cache de borda para imagens TMDB; monitoramento/logs/error tracking; rate
  limits TMDB; fallback de imagem.

---

## 13. Checklist antes do domínio oficial

- [ ] Domínio temporário **não indexável** (`noindex`/Basic Auth).
- [ ] Episodes Ticker gateado/removido/real (sem afirmar streaming/episódio).
- [ ] Chips de plataforma de Série gateados/removidos/real.
- [ ] Política de nota decidida (Screen Score real **ou** ocultar estrela).
- [ ] Hero com arte real (re-ingestão com `poster/backdrop`).
- [ ] `NODE_ENV=production` e sem `SCREEN_HOME_VISUAL_PLACEHOLDERS=1`.
- [ ] Sem mídia local TMDB (`/media/tmdb` vazio); imagens remotas OK.
- [ ] Gates verdes: `typecheck`, `audit:render`, `audit:invariants`, `build`.
- [ ] Comentários stale de "imagens locais" atualizados (opcional, higiene).

## 14. Checklist depois do domínio oficial

- [ ] DNS `thescreen.media` + `www` → apex; SSL Full (strict).
- [ ] Cloudflare proxy + cache; regra de cache para `image.tmdb.org` (opcional).
- [ ] Canonical/sitemap/OG resolvendo em `https://thescreen.media`.
- [ ] Google Search Console + envio do `sitemap.xml`; inspeção de URL.
- [ ] Analytics; monitoramento de uptime/erros.
- [ ] Job de ingestão agendado (cron/systemd) substituindo o re-ingest manual.
- [ ] Revisar `X-Robots-Tag`/canonical do domínio temporário (desligar índice).

---

## 15. Comandos úteis

**Gates locais (repo):**
```bash
corepack pnpm --filter @screena/web typecheck
corepack pnpm audit:render
corepack pnpm audit:invariants
corepack pnpm --filter @screena/web build
```
> `pnpm` só via `corepack pnpm …` neste ambiente (Git Bash não tem `pnpm` no PATH).

**Ingestão/backfill (no container EasyPanel `screen-app`, `/app`):**
```bash
corepack pnpm dlx tsx services/ingestion/bin/ingest-public-catalog.ts --include-upcoming --apply
# grava posterPath/backdropPath como file_path CRU do TMDB (sem --download-images)
```

**Verificar que não há mídia local TMDB:**
```bash
find apps/web/public/media/tmdb -type f 2>/dev/null | head -10 || echo "OK: sem mídia local TMDB"
# hoje: apps/web/public/media contém só media/demo/*.png (15 PNGs de demo), nunca media/tmdb
```

**Verificar URLs remotas no HTML servido (dentro do container):**
```bash
curl -s http://localhost:3000/pt/ | grep -o "https://image.tmdb.org/t/p/[^\"']*" | head -20
```

**Verificar rotas:**
```bash
curl -I http://localhost:3000/pt/
curl -I http://localhost:3000/robots.txt
curl -I http://localhost:3000/sitemap.xml
```

**Git (higiene):**
```bash
git status --short          # 30 sujos pré-existentes; commit do hero (e46cabb) já feito
git log --oneline -8
```

---

## 16. Decisões arquiteturais que NÃO devem ser revertidas

1. **Render puro** (invariantes 3/4): páginas indexáveis leem **só**
   PostgreSQL/cache local. Zero TMDB/Gemini/rede no render. (Travado por
   `check-render-purity.mjs`.)
2. **Imagem TMDB remota** (`image.tmdb.org` via `buildTmdbImageUrl`), **sem
   salvar arquivo** no servidor, banco guarda `file_path` cru. **Não** voltar
   para `/media/tmdb`, JPG/WebP local, volume persistente ou route handler de
   mídia (o route handler já foi revertido em `0108e67`).
3. **Nota = Screen Score próprio** (`screen_score`, escala 5, gate
   `screen_score_display`). **Nunca** apresentar TMDB `vote_average` ou
   `external_ratings` como se fossem nota própria; **nunca** converter escalas
   entre fontes; **nunca** `AggregateRating` fabricado.
4. **`provider_api` ≠ `rating_source`** e **IMDb ≠ Rotten Tomatoes** — separação
   preservada no schema (`vote_average_tmdb` é dado técnico, não editorial).
5. **Gate anti-thin** (≥2 blocos/seções de valor próprio) decide indexação;
   placeholders **não** inflam o gate.
6. **Token TMDB só no worker** (env do servidor), **nunca** no frontend/bundle.
7. **Um único H1** por página (hero ativo).
8. **Canonical/domínio** = marca **Screen**, domínio `thescreen.media`; `Screena`
   é namespace técnico legado; `screena.media` não é domínio público ativo.

---

*Relatório gerado por auditoria multi-agente read-only (8 dimensões + 3
verificações adversariais) + verificação direta de deploy/SEO. Nenhum código foi
alterado. Todas as afirmações têm referência `arquivo:linha` no corpo do
documento.*
