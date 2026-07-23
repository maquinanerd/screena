# CINERIE — DIAGNÓSTICO FORENSE 360º

**Data:** 2026-07-23
**Commit auditado:** `73c58e908986e77e49d02226c5bb1b9b4a5fca53` (= `origin/main`)
**Branch de auditoria:** `audit/cinerie-full-diagnostic-2026-07-23`
**Worktree isolada:** `E:/screena-wt/cinerie-full-audit`
**Domínio público:** https://cinerie.com

---

# VEREDITO EXECUTIVO

1. **O Cinerie está no ar.** `https://cinerie.com/pt/` responde HTTP 200 com HTML real, servindo dados reais de catálogo vindos do PostgreSQL. Verificado nesta auditoria.
2. **Está tecnicamente saudável no núcleo.** Todos os 28 passos do CI passaram no commit exato em produção (run `29971468863`); localmente reproduzi typecheck, typecheck de runtime, lint, 3.375 testes, auditoria de invariantes, pureza de render, cobertura de API e build — todos verdes.
3. **NÃO é utilizável como portal para o público.** A home renderiza **960 caracteres de texto visível, zero imagens**, em listas `<ul>` sem camada visual. É o "blank shell" do reset de design (commit `f242708`), não o frontend cinematográfico.
4. **O site inteiro está NOINDEX em produção.** `robots.txt` serve `User-Agent: * / Disallow: /` e toda página emite `<meta name="robots" content="noindex, nofollow">`. Verificado por HTTP. Para um produto cuja tese é SEO entity-first, isso é bloqueio total de aquisição.
5. **NÃO é utilizável como produto com conta.** Não existe endpoint HTTP de cadastro, login, logout ou sessão — só 4 rotas (recuperação de senha e verificação de e-mail). **Um usuário não consegue criar conta.** Sem conta, nada do Backend C é alcançável.
6. **O que existe de Backend C é domínio puro.** Adapters Prisma existem **somente** para identidade, credencial, sessão, token e throttle. Avaliações, reviews, listas, tracking, recomendações e privacidade/LGPD não têm persistência, nem HTTP, nem UI.
7. **A autenticação que existe funciona e é bem construída.** Os 4 endpoints foram exercitados em produção: 405 em GET, 400 em corpo malformado, 400 em chave desconhecida, 202 anti-enumeração, 401 em token inválido, cabeçalhos `no-store`/`no-referrer`/`nosniff` corretos.
8. **Riscos operacionais concretos:** nenhum backup comprovado, nenhum agendador de nada, zero alerta, container como root, imagem `latest` sem rastreabilidade de commit, rota `/dev/` pública com cache de 1 ano.
9. **Bloqueadores concretos para MVP:** (a) cadastro/login inexistentes; (b) camada visual inexistente; (c) indexação desligada; (d) LGPD inoperante; (e) backup não comprovado; (f) 22.432 páginas de pessoa contra 129 filmes (risco de index bloat).
10. **Prontidão para MVP: 28/100.** Como portal público somente-leitura: ~45%. Como produto com conta: ~10%. **Confiança: MEDIUM-HIGH** para tudo que foi executado; **LOW** para o que depende de acesso a produção que não tive.

> **Resumo em uma frase:** o Cinerie tem uma fundação de engenharia de qualidade acima da média — governança real, testes reais, CI real, migrations reais — servindo um site que hoje é uma casca de texto invisível para o Google e um produto de usuário no qual ninguém consegue se cadastrar.

---

## 1. Identificação da auditoria

| Item | Valor |
| --- | --- |
| Executor | Claude Opus 4.8 (Claude Code) |
| Data | 2026-07-23 |
| Commit auditado | `73c58e908986e77e49d02226c5bb1b9b4a5fca53` |
| `origin/main` no momento | `73c58e908986e77e49d02226c5bb1b9b4a5fca53` (idêntico) |
| Branch criada | `audit/cinerie-full-diagnostic-2026-07-23` |
| Worktree | `E:/screena-wt/cinerie-full-audit` (criada limpa, `git status` vazio) |
| Produção alterada? | **Não.** Somente GET/POST não destrutivos autorizados. |
| Segredos exibidos? | **Não.** |
| Merge realizado? | **Não.** |

---

## 2. Escopo

Auditados: proveniência git, arquitetura do monorepo, gates de build/CI/teste, banco e migrations, Backend A/B/C, runtime de autenticação + Brevo, frontend público, SEO/indexação, segurança, LGPD, Docker/EasyPanel, backup/DR, observabilidade, performance e documentação — com verificação HTTP read-only em produção.

**Não implementado, não corrigido, não refatorado, C7B3 não iniciado, produção não alterada.** Conforme instruído.

---

## 3. Evidências disponíveis

### 3.1 Executadas nesta auditoria (evidência de primeira mão)

| # | Comando / prova | Resultado |
| --- | --- | --- |
| 1 | `git fetch origin --prune` + `git rev-parse origin/main` | `73c58e9…` |
| 2 | `git worktree add -b audit/… 73c58e9` + `git status --short` | worktree limpa |
| 3 | `gh pr view 75` | MERGED 2026-07-23T01:18:39Z, 211 arquivos, +37.751/−33, mergeCommit = `73c58e9` |
| 4 | `gh run list --commit 73c58e9` | run `29971468863` — **success**, 4m45s |
| 5 | `gh run view 29971468863 --json jobs` | **28/28 passos OK** (lista completa na §9) |
| 6 | `pnpm install --frozen-lockfile` | exit 0 (1m39s) |
| 7 | `pnpm --filter @screena/db db:generate` | exit 0 — Prisma Client 6.19.3 |
| 8 | `pnpm typecheck` | exit 0 |
| 9 | `pnpm typecheck:catalog-runtime` | exit 0 |
| 10 | `pnpm lint` | exit 0 |
| 11 | `pnpm test` | **282 arquivos / 3.375 testes, todos passando**, 51,86s |
| 12 | `pnpm audit:invariants` | PASSOU — 7 ok, 0 violações, 798 arquivos varridos |
| 13 | `pnpm audit:render` | PASSOU — 2 ok, 0 violações, 91 arquivos de `apps/web` |
| 14 | `pnpm api:coverage` | PASSOU — 7 providers, 71 endpoints, 34 grupos de campo |
| 15 | `pnpm build` | exit 0 — tabela de 27 rotas (§15) |
| 16 | `GET https://cinerie.com/robots.txt` | 200 — **`User-Agent: * / Disallow: /`** |
| 17 | `GET https://cinerie.com/` | 307 → `/pt/` |
| 18 | `GET https://cinerie.com/pt/` | 200, 18.493 bytes HTML, **960 chars de texto visível, 0 imagens**, `noindex, nofollow` |
| 19 | `GET https://cinerie.com/sitemap.xml` + 6 shards | 200 — **23.288 URLs** (129 filmes / 110 séries / 22.432 pessoas / 53 temporadas / 559 episódios / 5 estáticas) |
| 20 | `GET https://cinerie.com/dev/movie-page-preview/` | **200 público**, `cache-control: s-maxage=31536000` |
| 21 | 10 sondagens nos 4 endpoints `/api/auth/**` | 405/400/400/400/202/202/400/401/405/405 (§13) |
| 21b | `GET` nas 7 rotas públicas restantes | todas **200**, todas com **0 imagens** (§15.1) |
| 22 | `GET /api/seo/redirect/?path=…` | 200 sem autenticação |
| 23 | Varredura de encoding das 12 migrations | 12/12 UTF-8 válido |
| 24 | Varreduras de segurança (segredos, `NEXT_PUBLIC_`, SQL raw, XSS, eval) | §17 |
| 25 | `git branch -r --no-merged` + `git cherry` por branch | §7 |

### 3.2 Fornecidas pelo operador (**EVIDÊNCIA FORNECIDA — não reverificada aqui**)

- Deploy da PR #75 concluído no EasyPanel; build Next.js concluído.
- `prisma migrate status` → `Database schema is up to date`; 12 migrations encontradas.
- `DATABASE_URL` apontando para `rss_prime_screen-db:5432/screena`.
- Variáveis Brevo presentes; `CINERIE_IP_HASH_SALT` corrigido para 64 caracteres; runtime retornou `CONFIG_OK`.
- Smoke transacional Brevo aceito; e-mail recebido no Gmail; Message-ID `<202607230247.29640774806@smtp-relay.mailin.fr>`.

**Status desses itens: PASS — EVIDÊNCIA OPERACIONAL FORNECIDA.** Não repeti o smoke nem acessei o banco.

---

## 4. Limitações (leia antes de confiar em qualquer PASS)

**L1 — A frota multiagente falhou.** O workflow de 20 agentes (16 dimensões + 4 sínteses) abortou integralmente com *"You've hit your session limit"*. **0 de 20 agentes retornaram resultado.** Toda a auditoria abaixo foi executada diretamente por mim. Consequência honesta: as dimensões **Backend A (catálogo/ingestão)**, **Backend B (ratings/streaming/licenças)**, **UX/acessibilidade detalhada** e **drift documental exaustivo** receberam **cobertura parcial por amostragem**, não a varredura exaustiva que o escopo pedia. Estão marcadas como `PARTIAL — COBERTURA REDUZIDA` e **não devem ser lidas como aprovadas**.

**L2 — Sem acesso ao banco de produção.** Nenhum `SELECT` foi executado. Toda contagem de tabela, verificação de constraint em produção, órfãos, duplicatas e integridade referencial é **UNKNOWN**. As contagens de entidade da §11 derivam do **sitemap público**, não do banco.

**L3 — Sem acesso ao EasyPanel/container.** Não li variáveis de ambiente reais, logs do container, `docker inspect`, uso de recursos nem a política de restart. Toda a §21 sobre o container em execução é inferência a partir do `Dockerfile` versionado.

**L4 — Os 14 validadores de PostgreSQL efêmero não rodaram localmente.** Docker daemon indisponível (`npipe … dockerDesktopLinuxEngine` não encontrado) e sem `psql`/`initdb` no PATH. **Porém**: o CI os executou no commit exato e todos passaram (evidência #5). Isso é evidência forte — mas de CI, não desta máquina.

**L5 — Node local divergente.** Gates locais rodaram em **Node v24.14.0**; `engines` exige `>=22 <23` e produção usa Node 22. Todos passaram mesmo assim, mas há divergência de runtime entre esta verificação e produção.

**L6 — Sem Lighthouse, sem navegador automatizado, sem teste de carga.** Acessibilidade, CLS, LCP e capacidade são **UNKNOWN**; só há análise estática e inspeção do HTML servido.

**L7 — `pnpm audit` de rede não executado.** Vulnerabilidades de dependência: **UNKNOWN**.

**L8 — Nenhum teste E2E existe no repositório.** Nenhuma afirmação de "funciona ponta a ponta" nesta auditoria vem de teste automatizado; as que existem vêm de sondagem HTTP manual em produção, explicitada caso a caso.

---

## 5. Estado da produção

| Verificação | Resultado | Evidência |
| --- | --- | --- |
| Site no ar | **SIM** | `GET /pt/` → 200 |
| Frente | Cloudflare (`server: cloudflare`, `cf-ray: …-GRU`) | headers |
| Raiz redireciona | 307 → `/pt/` | `GET /` |
| Trailing slash | 308 para forma canônica | `GET /pt` → 308 `/pt/` |
| 404 real | **SIM** (não é soft-404) | `GET /pt/rota-inexistente/` → 404 |
| Dados reais renderizados | **SIM** — "A Odisseia", "Interestelar", "Homem-Aranha: Um Novo Dia" | texto extraído de `/pt/` |
| Camada visual | **AUSENTE** — 960 chars, 0 `<img>`, listas simples | HTML de `/pt/` |
| Indexável | **NÃO** — `Disallow: /` + `noindex, nofollow` | `robots.txt`, meta de `/pt/` |
| Sitemap servido | SIM — 6 shards, 23.288 URLs, `lastmod` 2026-07-10 | `sitemap.xml` |
| Endpoints de auth | **FUNCIONAIS** | 10 sondagens, §13 |
| Rota `/dev/` | **PÚBLICA**, cache 1 ano | `GET /dev/movie-page-preview/` → 200 |
| CSP / HSTS / X-Frame-Options | **AUSENTES** nas respostas HTML | headers observados |

### 5.1 Achado central: o site está integralmente noindex

`apps/web/app/robots.ts:41-48` é **fail-closed**: se `isOfficialIndexableEnvironment(env)` for falso, emite `Disallow: /` e não anuncia sitemap. Produção serve exatamente esse ramo.

```
# (bloco injetado pelo Cloudflare — Content-Signal + bloqueio de bots de IA)
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /
...
# (bloco do app Cinerie — o que a aplicação realmente emite)
User-Agent: *
Disallow: /
```

E toda página emite `<meta name="robots" content="noindex, nofollow">`.

**Conclusão:** `CINERIE_PUBLIC_INDEXING_ENABLED` e/ou `CINERIE_PUBLIC_SITE_URL` **não estão no estado oficial** no EasyPanel. O fail-closed funcionou como projetado — o comportamento é *correto*; o **estado** é que bloqueia o negócio.

**Risco adicional:** o `robots.txt` final tem **dois grupos `User-agent: *`** (um do Cloudflare com `Allow: /`, um do app com `Disallow: /`). A resolução entre eles é ambígua entre crawlers. Mesmo ao ligar a indexação, essa duplicidade precisa ser resolvida — o `Allow: /` do Cloudflare não respeita os `Disallow: /api/`, `/dev/`, `/admin/` do app.

---

## 6. Estado do repositório

| Métrica | Valor |
| --- | --- |
| Workspaces | `apps/*` (2), `packages/*` (8), `services/*` (8), `api-clients/*` (7) = **25** |
| Arquivos de teste | **282** |
| Testes | **3.375** (todos passando) |
| Migrations | **12** (3.660 linhas de SQL) |
| Modelos Prisma | **75** |
| Enums Prisma | **42** |
| `schema.prisma` | 2.328 linhas |
| Rotas Next (build) | **27** |
| Arquivos varridos por `audit:invariants` | 798 |
| Arquivos de `apps/web` varridos por `audit:render` | 91 |
| Componentes `use client` | **4** |
| Node / pnpm / Prisma | 22 (`engines`) / 9.15.4 / 6.19.3 |

---

## 7. Proveniência e git

- `origin/main` = `73c58e9` = **exatamente** o commit esperado em produção. **PASS (HIGH).**
- PR #75 mergeada em 2026-07-23T01:18:39Z; `mergeCommit.oid` = `73c58e9`. 211 arquivos, +37.751/−33.
- **Zero PRs abertas.**
- **13 branches remotas não mergeadas.** Distinguindo artefato de squash-merge de trabalho realmente encalhado (`git cherry origin/main <branch>`):

| Branch | Commits fora da main |
| --- | --- |
| `origin/feat/api-coverage-registry` | **0** — conteúdo já na main (squash). Pode ser podada. |
| `origin/feat/user-product-platform` | 45 (histórico da PR #75, já squashada) |
| `origin/feat/external-intelligence-product` | 13 |
| `origin/feat/seo-runtime-source-of-truth-v2` | 12 |
| `origin/feat/tmdb-complete-catalog-coverage` | 12 |
| `origin/feat/web-canonical-cinematic-port` | **11 — contém o frontend cinematográfico revertido** |
| `origin/feat/data-governance-hardening-v2` | 10 |
| `origin/chore/align-post-reset-validation-contracts` | 7 |
| `origin/feat/public-season-episode-routes` | 7 |
| `origin/fix/claude-design-home-pixel-parity` | 3 |
| `origin/feat/external-data-intelligence-platform` | 2 |
| `origin/feat/seo-runtime-source-of-truth` | 1 |
| `origin/fix/claude-design-home-fidelity` | 1 |

> **Nota metodológica:** um número alto aqui **não** significa trabalho perdido — com squash-merge o histórico da branch fica "não mergeado" mesmo com o conteúdo na main. O caso que merece atenção real é `feat/web-canonical-cinematic-port` (§16).

- `git status --short` na worktree de auditoria: **vazio**.
- **Não toquei** `feat/data-governance-hardening` (WIP protegido) nem `E:/screena-wt/user-product-platform`.

---

## 8. Arquitetura real (`PARTIAL — COBERTURA REDUZIDA`)

```
┌──────────────── RODA NO CONTAINER DE PRODUÇÃO ────────────────┐
│  @screena/web (Next 15, Node 22)                               │
│    ├─ 21 páginas/rotas públicas  ── leem SÓ PostgreSQL         │
│    ├─ 4 rotas /api/auth/**  ── delegam p/ @screena/user-platform│
│    ├─ /api/seo/redirect  ── SEM AUTENTICAÇÃO, consulta o banco │
│    ├─ middleware  ── subrequest HTTP interno por request       │
│    └─ transpila: @screena/{seo,ui,types,db,user-platform}      │
│  CMD: prisma migrate deploy → next start                       │
└────────────────────────────────────────────────────────────────┘

┌──────── EXISTE NO REPO, NÃO ESTÁ NO CONTAINER ────────┐
│  apps/admin (11 páginas)      ── Dockerfile não builda │
│  services/ingestion, sync, ratings, streaming,         │
│           legal, entity-writer, news-ingestion         │
│  api-clients/ (7)                                      │
│  workers/*.py (6 arquivos)                             │
│  scripts/backup/*.sh                                   │
└────────────────────────────────────────────────────────┘
```

**Fato verificado (Dockerfile:47):** `RUN pnpm --filter @screena/web build` — **somente** `@screena/web` é buildado. Portanto:

- `apps/admin` → **NOT_DEPLOYED** (HIGH). O painel administrativo não existe em produção.
- Todos os `services/*` → offline-only. **Nada os executa automaticamente** (§20).

**Achado — nenhum agendador existe.** Busca por `cron|systemd|.timer|schedule` em `.github/` e `scripts/`: **zero ocorrências**. Nenhum sync, nenhum backup, nenhum job roda sozinho. Consistente com `lastmod` do sitemap parado em **2026-07-10** (13 dias antes desta auditoria).

---

## 9. Build, CI e testes

### 9.1 Gates executados por mim (local)

| Gate | Exit | Detalhe |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | 1m39s |
| `db:generate` | 0 | Prisma 6.19.3 |
| `typecheck` | 0 | — |
| `typecheck:catalog-runtime` | 0 | — |
| `lint` | 0 | — |
| `test` | 0 | **282 arquivos / 3.375 testes**, 51,86s, 0 falhas, 0 skips |
| `audit:invariants` | 0 | 7 ok / 0 violações |
| `audit:render` | 0 | 2 ok / 0 violações |
| `api:coverage` | 0 | 7 ok / 0 violações |
| `build` | 0 | 27 rotas |

### 9.2 CI no commit exato — run `29971468863`, **28/28 OK**

Checkout · pnpm · **Node 22** · install · **validate backup shell scripts** · db:generate · typecheck · typecheck runtime · lint · test · invariants · render · api coverage · build · validadores descartáveis · migration Cenário A (do zero) · migration Cenário B (upgrade) · stores de streaming · SEO runtime · rotas temporada/episódio · plataforma TMDB · catálogo Backend A · inteligência externa · Backend B · autorização de fontes · Backend C migration C7A/C7A.1 · Backend C adapters C7B1.

**Isto é excelente.** É raro um projeto deste porte ter 14 validadores contra PostgreSQL 16 real no CI, incluindo migration do zero **e** upgrade. **PASS (HIGH).**

### 9.3 Lacuna confirmada: `apps/**` não é typechecked nem testado

`tsconfig.json` (raiz) — `include`: `packages/**`, `api-clients/**`, `services/**`, `tests/**`. **`apps/**` está ausente.**

O próprio código admite, em `apps/web/app/api/auth/password-reset/request/route.ts:7`:
> *"`apps/web` nao e coberto pelo vitest, entao qualquer logica escrita aqui nasceria sem teste."*

**Consequência:** `apps/web` e `apps/admin` só são verificados por `next build`. `apps/admin` **não é buildado nem no CI nem no Dockerfile** — ou seja, **nada verifica `apps/admin`**, apesar de ter 33 arquivos de teste em `tests/admin`.

O projeto mitigou isso conscientemente (rotas de auth são delegadores de 3 linhas). É uma boa mitigação, mas continua sendo lacuna estrutural. **PARTIAL (HIGH), P2.**

---

## 10. Banco e migrations

- **75 modelos**, **42 enums**, 2.328 linhas de schema, **12 migrations**.
- **Ordenação de timestamps:** monotônica, sem duplicatas nem intercalação. **PASS (HIGH).**
- **Encoding:** as 12 migrations são **UTF-8 válido** (verificado por round-trip `Buffer`). Os caracteres não-ASCII são acentuação portuguesa **em comentários**. **Não há risco WIN1252 aqui** — registro isto explicitamente para evitar falso positivo contra a convenção histórica do repositório. **PASS (HIGH).**
- **Aditividade:** nenhum `DROP TABLE`, `DROP COLUMN` ou `TRUNCATE`. Existem 3 `DROP INDEX`, todos **substituições deliberadas de índice** documentadas no próprio SQL (`source_licenses_default_unique`, `user_recommendation_snapshots_current_unique`, `user_viewing_events_user_id_idempotency_key_key`). **PASS (HIGH).**
- **Extensões:** `pgcrypto` (2 migrations), `unaccent`, `pg_trgm`. Criadas com `IF NOT EXISTS`. O `Dockerfile` traz runbook explícito para falha de `pgcrypto` no CMD.
- **Validação real:** CI aplica do zero **e** como upgrade em PostgreSQL 16 efêmero, mais 2 validadores dedicados de Backend C com coberturas disjuntas (migration vs adapters). **PASS (HIGH).**

**Domínios de tabela (75 modelos):** catálogo (Movie, TvShow, Season, Episode, Person, Entity, Cast/CrewMember, Collection, Network, Keyword, ProductionCompany…), TMDB raw (TmdbRaw, TmdbImage, TmdbVideo, TmdbSyncCheckpoint, TmdbImageConfig), editorial (ContentBlock, EntityWriterJob/Log, Article, ArticleTranslation, EntityNewsLink), governança (SourceLicense, DataUsageDecision, PageIndexabilityDecision, ApiCache, ApiSyncLog), externo (ExternalRating, WatchAvailability, WatchProvider, CinerieScoreCalculation), jobs/busca (CatalogJob, SearchDocument, DiscoverySnapshot), **usuário** (User, UserProfile, PasswordCredential, Account, UserSession, VerificationToken, AuthThrottle, AuthAuditLog, UserWatchState, EpisodeProgress, ViewingEvent, UserList, UserListItem, UserRating, UserReview, ReviewReport, UserBlock, UserStatsSnapshot, RecommendationSnapshot, RecommendationFeedback, **ConsentRecord**, **DataRequest**, ImportJob).

> Observação importante: **as tabelas de usuário existem; o produto de usuário não.** Schema ≠ produto (§12).

**UNKNOWN (L2):** contagens reais, órfãos, duplicatas por `email_normalized`, tokens expirados não consumidos, integridade referencial em produção — nada disso foi verificado, pois não houve acesso ao banco.

**Retenção:** existe `privacy/retention.ts` **puro** (produz plano), mas **nenhum executor**. Não há job de limpeza de tokens, sessões, throttle ou eventos de tracking. **NOT_IMPLEMENTED (HIGH), P2.**

---

## 11. Backend A — catálogo (`PARTIAL — COBERTURA REDUZIDA`)

**O que está comprovado:**
- O pipeline existe e **tem dados reais em produção**: 23.288 URLs no sitemap.
- `audit:render` PASSOU: 91 arquivos de `apps/web`, zero chamada externa no render. **Invariante 3 respeitada.**
- `api:coverage` PASSOU: 7 providers, 71 endpoints catalogados, 6+32 métodos TMDB conferidos contra o registro.
- Validadores TMDB e de catálogo (jobs + busca) verdes no CI contra PostgreSQL real.
- Busca usa `pg_trgm`/`unaccent` com SQL **parametrizado** (`apps/web/src/server/search-page.ts:171` — `$queryRawUnsafe(SEARCH_SQL, term, …)`, constante estática + bind params). **Não é injetável.**

**Distribuição real do catálogo (do sitemap de produção):**

| Shard | URLs |
| --- | --- |
| Pessoas | **22.432** |
| Episódios | 559 |
| Filmes | **129** |
| Séries | 110 |
| Temporadas | 53 |
| Estáticas | 5 |
| **Total** | **23.288** |

**Achado P1 — desequilíbrio severo de catálogo.** 96,3% das URLs são páginas de pessoa, contra 129 filmes. Pessoas foram promovidas em massa a partir de créditos; o catálogo de obras é minúsculo. Ao ligar a indexação, isso publica ~22 mil páginas provavelmente rasas contra ~240 páginas de obra — perfil clássico de *index bloat* e risco de avaliação de qualidade negativa do site inteiro. **Precisa de decisão editorial antes de indexar.**

**Achado P1 — nada é agendado.** Sem cron/systemd/GH-Action. `lastmod` do sitemap = 2026-07-10, **13 dias parado**. Todo sync é manual.

**Não auditado em profundidade (L1):** exclusão de conteúdo adulto em 2 camadas, cobertura de `api_sync_logs` por caminho, circuit breaker, rate limit por provider, retry com jitter, checkpoints, jobs travados. Os validadores de CI cobrem parte disso, mas **não confirmei linha a linha**. **UNKNOWN.**

---

## 12. Backend B — ratings, streaming, licenças, Cinerie Score (`PARTIAL — COBERTURA REDUZIDA`)

**Comprovado:**
- `validate:external-intelligence-product` e `validate:source-authorization-and-attribution` verdes no CI contra PostgreSQL real.
- Testes de governança de ratings passam (dentro dos 3.375).
- Modelos existem: `ExternalRating`, `SourceLicense`, `DataUsageDecision`, `WatchAvailability`, `WatchProvider`, `CinerieScoreCalculation`.
- `_components/watch-availability-panel.tsx` existe.

**Comprovado por observação de produção:** a home renderiza **zero** nota externa, **zero** provedor de streaming e **zero** menção a Cinerie Score. A atribuição visível é apenas a do TMDB (*"Este produto usa a API do TMDB, mas não é endossado ou certificado pelo TMDB"*) — correta e presente.

**Veredito:** Backend B está **NOT_EXPOSED** como produto — contratos, validadores e schema existem; a superfície pública não mostra nada. **Cinerie Score: BLOCKED_BY_DECISION** (não há decisão humana de licença registrada que eu possa comprovar; não tentei desbloquear).

**Não auditado em profundidade (L1):** enforcement do gate `display_allowed` no ponto de render, se ele é chokepoint único ou disperso, matriz de licenças por fonte, `provider_payload_hash`/`fetched_at`, carimbo "Atualizado em". **UNKNOWN.**

---

## 13. Backend C — usuários e autenticação

### 13.1 O que realmente existe

**Handlers HTTP — exatamente 4** (`services/user-platform/src/http/handlers.ts:64-69`):
```ts
export interface AuthHttpHandlers {
  readonly requestPasswordReset
  readonly confirmPasswordReset
  readonly requestEmailVerification
  readonly confirmEmailVerification
}
```

**Adapters Prisma — exatamente 5** (`persistence/prisma/index.ts`): `IdentityStore`, `PasswordCredentialStore`, `SessionStore`, `AuthTokenStore`, `AuthThrottleStore`.

**Ports declarados sem adapter Prisma:** `RecommendationSnapshotStore`, `RecommendationFeedbackStore` (`persistence/ports.ts:203,225`).

**Portanto — achado estrutural P0 de produto:**

| Unidade | Domínio puro | Persistência | HTTP | UI | Veredito |
| --- | --- | --- | --- | --- | --- |
| C5A avaliações | ✅ + testes | ❌ | ❌ | ❌ | NOT_IMPLEMENTED como produto |
| C5B reviews/moderação | ✅ + testes | ❌ | ❌ | ❌ | NOT_IMPLEMENTED como produto |
| C6A recomendações | ✅ + testes | ❌ | ❌ | ❌ | NOT_IMPLEMENTED como produto |
| C6B snapshots/feedback | ✅ + testes | ports sem adapter | ❌ | ❌ | NOT_IMPLEMENTED como produto |
| listas / tracking / stats | ✅ + testes | ❌ | ❌ | ❌ | NOT_IMPLEMENTED como produto |
| C7A/C7B0/C7B1/C7B1.1 | ✅ | ✅ (5 stores) | — | — | PASS (fundação) |
| C7C auth e-mail | ✅ | ✅ | ✅ (4 rotas) | 2 páginas | **PASS — funcionando** |
| **cadastro / login / sessão** | ✅ domínio | ✅ stores | **❌ NENHUM** | **❌ NENHUM** | **FAIL — usuário não cria conta** |
| **C7B3 LGPD** | ✅ puro | **❌** | **❌** | **❌** | **NOT_IMPLEMENTED** |

`composition.ts:152-160` monta os 5 stores dentro de uma transação, mas **apenas para os 4 fluxos de e-mail**. O comentário do barrel confirma: *"Montar identidade + credencial na mesma transacao de cadastro e C7C"* — a composição de cadastro é descrita, não exposta.

### 13.2 Autenticação verificada em produção (10 sondagens executadas)

| # | Requisição | Esperado | **Obtido** | Corpo/headers |
| --- | --- | --- | --- | --- |
| 1 | `GET /api/auth/password-reset/request/` | 405 | **405** | sem headers de segurança |
| 2 | `POST` content-type `text/plain` | 400 | **400** | `invalid_request` |
| 3 | `POST` JSON malformado | 400 | **400** | `invalid_request` |
| 4 | `POST` chave desconhecida (`evil`) | 400 | **400** | `"campo(s) nao permitido(s) no corpo"` |
| 5 | `POST` e-mail inexistente | 202 | **202** (287ms) | `{"ok":true,"status":"accepted",…}` |
| 6 | `POST` e-mail malformado | — | **202** (262ms) | idêntico ao #5 — anti-enumeração |
| 7 | `POST confirm` token curto | 400 | **400** | `"campo \"token\" muito curto"` |
| 8 | `POST confirm` token 64-hex inválido | 401 | **401** (496ms) | `"token invalido ou expirado"` |
| 9 | `POST confirm` senha fraca | 400 | **400** | `"senha muito curta: minimo de 10 caracteres."` |
| 10 | `GET/PUT` verificação de e-mail | 405 | **405** | — |

Headers em todas as respostas do handler: `cache-control: no-store`, `referrer-policy: no-referrer`, `x-content-type-options: nosniff`, `content-type: application/json`. **PASS (HIGH).**

**Nenhum vazamento observado:** nenhuma resposta contém stack, mensagem de driver, nome de tabela ou detalhe interno. Os `fields` descrevem **formato**, nunca valor.

> ### ⚠️ Ressalva decisiva — o fluxo NUNCA foi provado ponta a ponta
>
> As 10 sondagens provam o comportamento **de borda** dos endpoints: validação, anti-enumeração, rejeição de token, headers. **Elas não provam o fluxo completo.**
>
> O ciclo real — *conta existe → e-mail chega → link é clicado → token é consumido → senha muda → usuário entra com a nova senha* — **é impossível de executar hoje**, porque **não existe cadastro nem login**. Não há como criar a conta que receberia o e-mail, e não haveria como usar a senha trocada.
>
> O smoke da Brevo fornecido pelo operador prova **entrega de e-mail pelo fornecedor**, não o fluxo de recuperação de um usuário real.
>
> **Portanto:** os 4 endpoints estão `PASS` como *componentes*; o fluxo de recuperação de senha está `UNKNOWN` como *funcionalidade de produto*. Todo caminho de token consumido com sucesso (o ramo 2xx do `confirm`) permanece **não exercitado em produção**.

### 13.3 Achados sobre o runtime de auth

**A1 — `trailingSlash: true` faz todo POST sem barra final retornar 308.** `POST /api/auth/password-reset/request` (sem barra) → **308**, não 202. Só `…/request/` funciona direto. Clientes que não seguem redirect, ou que rebaixam POST→GET, falham silenciosamente. **PARTIAL, P2** — documentar a barra final como canônica.

**A2 — Sem outbox, sem retry.** `auth-runtime/dispatch.ts` documenta explicitamente: o token é comitado **antes** do envio, envio ocorre fora de transação, falha de envio **não** altera a resposta pública e **não há compensação**. Janela real: token válido gravado + e-mail nunca entregue. Mitigação existente: o usuário pede de novo. **PARTIAL (HIGH), P2** — assumido conscientemente e documentado.

**A3 — 405 sem headers de segurança.** As respostas 405 vêm do Next (só `POST` é exportado), antes do handler; portanto não carregam `no-store`/`nosniff`. `methodNotAllowedResponse()` do app é efetivamente inalcançável por GET. **P3.**

**A4 — IP e throttle.** `handlers.ts:73-80` lê o IP e **converte em hash imediatamente** (`clientIpHash` é o único formato que as camadas seguintes conhecem) — excelente para privacidade. **Não verifiquei** se há allowlist de proxy confiável para `X-Forwarded-For`; sem ela, um cabeçalho forjado pelo cliente desloca o balde de throttle. **UNKNOWN → tratar como risco P1 até prova em contrário.**

**A5 — Confirmação sem throttle dedicado.** Não localizei throttle nos endpoints `confirm`. Com token de 64 hex o espaço de busca é inviável de forçar, mas a ausência permite volume de requisições contra o banco. **PARTIAL, P2.**

**A6 — Log seguro por construção.** `apps/web/src/server/auth/runtime.ts:33-44,84-100` — o evento de log é **tipo fechado**, e o objeto de erro **deliberadamente não atravessa**, com comentário explicando que `P1013` do Prisma carregaria a `DATABASE_URL` com senha dentro de `error.message`. **PASS (HIGH).** É defesa de qualidade acima da média.

---

## 14. Matriz de capacidades

Legenda: ✅ existe · ⚠️ parcial · ❌ ausente · ? não verificável sem produção

| Capacidade | Domínio | Schema | Persist. | HTTP | UI | Testes | CI | Prod | E2E | **Estado real** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Cadastro** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | **Usuário NÃO consegue criar conta** |
| **Login** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | **Sem endpoint, sem tela** |
| Logout / logout-all | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Inalcançável |
| Rotação/sessão atual | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Inalcançável |
| Alterar senha (autenticado) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Inalcançável |
| **Recuperar senha** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **✅ verificado** | ⚠️ manual | **FUNCIONA** (2 endpoints, 202/401 confirmados) |
| **Verificar e-mail** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | **✅ verificado** | ⚠️ manual | **FUNCIONA** |
| Perfil / configurações / privacidade | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Domínio puro |
| Listas de sistema e customizadas | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Domínio puro |
| Favoritos / quero assistir / assistindo / assistido / pausado / abandonado / reassistindo / sem interesse | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Domínio puro (8 estados) |
| Avaliações de usuário | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Domínio puro |
| Reviews / spoilers / denúncias / moderação | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Domínio puro |
| Diário / histórico / progresso de episódios | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Domínio puro |
| Recomendações + feedback | ✅ | ✅ | ⚠️ ports | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Ports sem adapter |
| Importar Letterboxd / Trakt | ⚠️ | ✅ `ImportJob` | ❌ | ❌ | ❌ | ⚠️ | ✅ | ? | ❌ | Praticamente inexistente |
| **Exportar dados (LGPD)** | ✅ puro | ✅ `DataRequest` | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | **Pedido NÃO pode ser atendido** |
| **Excluir conta (LGPD)** | ✅ puro | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | **Pedido NÃO pode ser atendido** |
| Consentimentos | ✅ | ✅ `ConsentRecord` | ❌ | ❌ | ❌ | ✅ | ✅ | ? | ❌ | Domínio puro |
| Notificações | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ? | ❌ | Inexistente |
| **Busca** | ✅ | ✅ trgm | ✅ | ✅ página | ⚠️ shell | ✅ | ✅ | **✅ rota 200** | ⚠️ | Funciona, sem design |
| **Catálogo de filmes** | ✅ | ✅ | ✅ | ✅ | ⚠️ shell | ✅ | ✅ | **✅ 129 URLs** | ⚠️ | Funciona, sem design |
| **Catálogo de séries** | ✅ | ✅ | ✅ | ✅ | ⚠️ shell | ✅ | ✅ | **✅ 110 URLs** | ⚠️ | Funciona, sem design |
| **Pessoas** | ✅ | ✅ | ✅ | ✅ | ⚠️ shell | ✅ | ✅ | **✅ 22.432 URLs** | ⚠️ | Volume desequilibrado |
| **Temporadas / episódios** | ✅ | ✅ | ✅ | ✅ | ⚠️ shell | ✅ | ✅ | **✅ 53 / 559** | ⚠️ | Funciona, sem design |
| **Notícias** | ✅ | ✅ | ✅ | ✅ | ⚠️ shell | ✅ | ✅ | ⚠️ vazio na home | ⚠️ | Rota existe, sem conteúdo visível |
| Onde assistir | ✅ | ✅ | ✅ | ⚠️ componente | ❌ | ✅ | ✅ | ❌ não renderiza | ❌ | NOT_EXPOSED |
| Ratings externos | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ não renderiza | ❌ | NOT_EXPOSED |
| Cinerie Score | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | **BLOCKED_BY_DECISION** |
| **Administração** | ✅ | ✅ | ✅ | 11 páginas | ✅ | ✅ 33 arq. | ⚠️ | **❌ NOT_DEPLOYED** | ❌ | Não existe em produção |
| Workflow editorial | ✅ | ✅ | ✅ | via admin | ✅ | ✅ | ⚠️ | **❌ NOT_DEPLOYED** | ❌ | Inalcançável |

**Contagem:** de 48 capacidades avaliadas, **9 funcionam de fato em produção** (7 de catálogo/busca + 2 fluxos de e-mail de auth), **~30 são domínio puro sem produto**, **~6 são NOT_EXPOSED/NOT_DEPLOYED**, **1 inexistente**, **1 bloqueada por decisão**.

---

## 15. Frontend público e UX (`PARTIAL — COBERTURA REDUZIDA`)

**Tabela de rotas do `next build` (27 rotas):** 4 estáticas (`/_not-found`, `/dev/movie-page-preview`, `/filmes`, `/series`), 23 dinâmicas (`ƒ`).

**Achado decisivo — a camada visual não existe.** `apps/web/app/pt/page.tsx:18-22` declara: *"Home pública pt-BR **reduzida ao conteúdo textual real** já persistido. A rota não cria destaques, rankings, anúncios ou affordances sem contrato."* O JSX (linhas 150-244) é `<section><h2>…</h2><ul><li><a>…</a></li></ul></section>` puro.

Confirmado no HTML servido em produção: **18.493 bytes, 960 caracteres de texto visível, 0 tags `<img>`.**

Isto é o estado do commit `f242708` *"chore(web): reset public visual layer to blank shell"*, que **reverteu** `df0a89c` *"feat(web): port canonical cinematic frontend exactly (#61)"*. O frontend cinematográfico está em `origin/feat/web-canonical-cinematic-port` (11 commits fora da main) — **não está em produção nem na main**.

**O que está correto no frontend:**
- Exatamente **1 `<h1>`** por página. ✅
- Canonical absoluto e autorreferente: `https://cinerie.com/pt/`. ✅
- JSON-LD presente (Organization + WebSite na home; Movie/TVSeries/Person/NewsArticle/BreadcrumbList nas demais). ✅
- Link "Pular para o conteúdo" (skip link) presente. ✅
- Navegação semântica e atribuição TMDB. ✅
- Apenas **4** componentes `use client` — arquitetura server-first sólida. ✅

**O que falta:**
- Zero imagens/pôsteres. Zero design system aplicado. Zero estados de loading/erro visuais.
- **Zero UI de produto autenticado**: não há página de cadastro, login, perfil, listas, avaliações, reviews, histórico, recomendações ou configurações. Só existem `/pt/redefinir-senha` (1,04 kB de JS) e `/pt/verificar-email` (752 B).
- **Não avaliado (L6):** contraste, foco, operabilidade por teclado, responsividade real, CLS/LCP. **UNKNOWN.**

### 15.1 Todas as rotas públicas medidas (verificado por HTTP)

| Rota | Status | Texto visível | `<img>` | `<form>` | Observação |
| --- | --- | ---: | ---: | ---: | --- |
| `/pt/` | 200 | 960 | **0** | 0 | destaques + filmes + em breve; sem séries, sem notícias |
| `/pt/filmes/` | 200 | 1.164 | **0** | 0 | listagem textual |
| `/pt/series/` | 200 | 1.173 | **0** | 0 | listagem textual |
| `/pt/pessoas/` | 200 | 1.204 | **0** | 0 | listagem textual |
| `/pt/noticias/` | 200 | **372** | **0** | 0 | **só cabeçalho — nenhuma notícia publicada** |
| `/pt/explorar/` | 200 | 510 | **0** | 0 | índice de áreas |
| `/pt/busca/` | 200 | 284 | **0** | 1 (1 input) | **formulário de busca funcional** |
| `/pt/redefinir-senha/` | 200 | 308 | **0** | 1 (1 input) | **formulário real**, com dica "ao menos 10 caracteres" |

**Zero imagens em 100% das rotas públicas.** Confirma que a camada visual não existe — não é um problema de uma página só.

**Ponto positivo verificado:** `/pt/redefinir-senha/` e `/pt/busca/` **têm formulários reais e funcionais**, não são placeholders.

**Achado P2 — rota de desenvolvimento pública:** `GET https://cinerie.com/dev/movie-page-preview/` → **200**, `cache-control: s-maxage=31536000` (1 ano). É estática (`○`), logo está no bundle de produção. Hoje é inofensiva porque o site inteiro é noindex e o `robots.txt` oficial bloquearia `/dev/` — mas é superfície pública não intencional com cache de um ano.

---

## 16. SEO e indexação

**A maquinaria de SEO é boa; o estado atual é bloqueio total.**

| Item | Estado | Evidência |
| --- | --- | --- |
| `robots.txt` fail-closed | **PASS** — desenho correto | `robots.ts:41-48` |
| Indexação em produção | **FAIL** — `Disallow: /` + `noindex, nofollow` | HTTP |
| `robots.ts` é `force-dynamic` | PASS (kill switch sem rebuild) | `robots.ts:36` |
| Fallback de env legado | `THE_SCREEN_PUBLIC_*` aceito como fallback | `site.ts:104,133` |
| Sitemap index + 6 shards | PASS — 200, 23.288 URLs | HTTP |
| `lastmod` | **PARTIAL** — 2026-07-10 (13 dias) | HTTP |
| Canonical autorreferente | PASS | HTML |
| 1 `<h1>` por página | PASS | HTML |
| JSON-LD por tipo | PASS | HTML + código |
| `AggregateRating` fabricado | **PASS — não emitido** | nenhuma nota externa renderizada |
| 404 real (não soft-404) | PASS | HTTP 404 |
| `hreflang` | NOT_APPLICABLE — só `pt-BR`/`pt` em `PUBLISHED_LOCALES` | `site.ts` |
| Vazamento de marca legada | **PASS** no HTML público — só "Cinerie" | texto extraído |
| Índice-bloat | **FAIL/P1** — 22.432 pessoas vs 129 filmes | shards |
| `robots.txt` com 2 grupos `User-agent: *` | **PARTIAL/P1** — conflito Cloudflare × app | HTTP |
| Sitemap servido enquanto tudo é noindex | PARTIAL — inconsistente, mas não anunciado no robots | HTTP |

**Nota de justiça:** o incidente de 2026-07-16 citado em `site.ts:183` mostra que essa área já foi endurecida deliberadamente. O comportamento fail-closed é **um acerto de engenharia**. O problema é de **configuração de ambiente**, não de código.

---

## 17. Segurança

**Aprovado (verificado):**

| Verificação | Resultado |
| --- | --- |
| `.env` versionado | Só `.env.example`. **PASS** |
| `NEXT_PUBLIC_*` com segredo | **Nenhum uso** — e há 2 testes que travam isso (`boundary.test.ts:223`, `config.test.ts:209`). **PASS (HIGH)** |
| SQL injection | `$queryRawUnsafe` usado com **SQL constante + bind params** (`search-page.ts:171`). **PASS** |
| XSS | `dangerouslySetInnerHTML` **só** para JSON-LD via `serializeJsonLd = escapeJsonForHtml(JSON.stringify(v))`. **PASS** |
| `eval` / `new Function` | **Nenhuma ocorrência.** PASS |
| Vazamento de erro | Objeto de erro deliberadamente não atravessa o log (`runtime.ts:84-100`). **PASS (HIGH)** |
| Validação de entrada | Estrita — rejeita chave desconhecida. **PASS** (verificado em produção) |
| Anti-enumeração | 202 idêntico para e-mail inexistente e malformado. **PASS** (verificado) |
| Hash de IP | IP vira hash na borda, não trafega cru. **PASS** |
| Pureza de render | `audit:render` 0 violações em 91 arquivos. **PASS** |

**Reprovado / risco:**

| # | Achado | Prioridade | Evidência |
| --- | --- | --- | --- |
| S1 | **Nenhum header de segurança** nas páginas HTML: sem CSP, HSTS, X-Frame-Options, Permissions-Policy | **P1** | `next.config.ts` sem `headers()`; headers observados em produção |
| S2 | **Container roda como root** — nenhuma diretiva `USER` | **P2** | `Dockerfile` (verificado integralmente) |
| S3 | **Imagem single-stage** com repositório completo + devDependencies + `git` em runtime | **P2** | `Dockerfile:10,25` (`COPY . .`, `PNPM_CONFIG_PROD=false`) |
| S4 | **`/api/seo/redirect` sem autenticação**, consulta o banco a cada chamada | **P2** | `GET …/api/seo/redirect/?path=…` → 200 |
| S5 | **Rota `/dev/` pública** com cache de 1 ano | **P2** | HTTP 200 |
| S6 | **`X-Forwarded-For` sem allowlist comprovada** de proxy confiável → possível bypass de throttle | **P1** (não confirmado) | não verificado (L1) |
| S7 | **Sem CSRF/cookie/sessão** — ainda não aplicável (não há login), mas será obrigatório | P2 | ausência de sessão |
| S8 | `pnpm audit` de rede não executado | UNKNOWN | L7 |

---

## 18. LGPD e privacidade

**Domínio puro exemplar; operação inexistente.**

`services/user-platform/src/privacy/` contém `consent.ts`, `deletion.ts`, `export.ts`, `policy.ts`, `preferences.ts`, `retention.ts` + 6 arquivos de teste. O cabeçalho de `export.ts` é explícito:

> *"PURO: sem rede, sem DB, sem fs, sem relogio. **NAO gera arquivo real (ZIP/JSON)** — produz PLANO e MANIFESTO deterministicos."*

| Requisito | Domínio | Persist. | Endpoint | Executor | UI | Veredito |
| --- | --- | --- | --- | --- | --- | --- |
| Consentimento / revogação | ✅ | ❌ | ❌ | ❌ | ❌ | NOT_IMPLEMENTED |
| Perfil privado por padrão | ✅ | ❌ | ❌ | ❌ | ❌ | NOT_IMPLEMENTED |
| **Exportação de dados** | ✅ plano | ❌ | ❌ | ❌ | ❌ | **Pedido NÃO pode ser atendido** |
| **Exclusão de conta** | ✅ plano | ❌ | ❌ | ❌ | ❌ | **Pedido NÃO pode ser atendido** |
| Retenção / anonimização | ✅ plano | ❌ | ❌ | ❌ | ❌ | NOT_IMPLEMENTED |
| Canal do titular / política | ❌ | — | ❌ | — | ❌ | Inexistente |

**Riscos técnicos (não é parecer jurídico — exige revisão humana):**
- **PII compartilhada com a Brevo** (endereços de e-mail, terceiro processador) **sem** política de privacidade publicada nem consentimento registrado operacionalmente.
- **PII em backups sem propagação de exclusão** — mesmo que a exclusão fosse implementada, não há mecanismo de propagação para dumps.
- **Sem retenção automática** de tokens, sessões, throttle e eventos de tracking.

**Mitigação de fato hoje:** como não existe cadastro, o volume de titulares reais deve ser ~zero. **Isto é uma janela para implementar antes de haver usuários, não uma dispensa.** No instante em que o cadastro existir, esta seção vira P0.

---

## 19. Operação — Docker e EasyPanel

`Dockerfile` (lido integralmente). O arquivo é **excepcionalmente bem comentado** — documenta os próprios trade-offs, inclusive os ruins.

| Item | Estado | Detalhe |
| --- | --- | --- |
| Base | `node:22-bookworm-slim` | alinhado com `engines` |
| Estágios | **1 (single-stage)** | P2 — runtime carrega toolchain de build |
| Conteúdo | repositório inteiro + devDependencies + `git` | `COPY . .`, `PNPM_CONFIG_PROD=false` |
| Usuário | **root** (sem `USER`) | P2 |
| `HEALTHCHECK` | **ausente** | P2 |
| Env no build | **nenhuma** — deliberado e correto | comentário explica o furo fail-open anterior |
| Migration gate | `migrate deploy \|\| exit 1` antes do `start` | **PASS** — app não sobe com migration falha |
| Réplicas | risco de crashloop por lock timeout | **auto-documentado** no Dockerfile |
| Rollback de migration | impossível (aditivas, sem down) | P2 aceito |
| Tag da imagem | `latest` | **P1 — impossível saber qual commit está rodando** |
| SHA do commit na imagem | **não existe** LABEL/ENV/ARG | P1 |
| `EXPOSE` | 3000, atrás de Cloudflare | ok |

**Achado P1 — rastreabilidade de proveniência.** Com tag `latest` e nenhum SHA embutido, **não é possível provar, a partir do container, qual commit está em execução**. A correspondência com `73c58e9` é inferida da narrativa de deploy, não verificada. Um `LABEL org.opencontainers.image.revision` resolveria.

---

## 20. Backup, restore e DR

Os scripts são **bons**: `backup.sh` (2.533 B) gera dump, calcula **SHA-256**, `chmod 600`, e faz cópia off-site opcional via `rclone` quando `BACKUP_OFFSITE_RCLONE_REMOTE` está definido; `restore-test.sh` (5.721 B) **exige** o checksum e o valida antes de restaurar. O CI valida a sintaxe (`bash -n`) dos dois.

**Mas — graduação honesta:**

| Grau | Estado | Evidência |
| --- | --- | --- |
| Script implementado | **PASS** | `scripts/backup/*.sh` |
| Sintaxe validada no CI | **PASS** | passo "Validate backup shell scripts" |
| **Rotina agendada** | **FAIL** | busca por `cron|systemd|.timer|schedule` → **zero ocorrências** |
| **Backup produzido** | **UNKNOWN** | sem acesso ao host |
| **Checksum validado na prática** | **UNKNOWN** | sem acesso |
| **Cópia off-site** | **UNKNOWN** — opcional e provavelmente não configurada | variável de ambiente ausente por padrão |
| **Restore test verde** | **UNKNOWN — NÃO FOI POSSÍVEL VALIDAR** | sem acesso |
| RPO / RTO | **não definidos em lugar nenhum** | busca no repo |

**Veredito P0:** existe a *capacidade* de backup, não existe o *backup*. Nada agenda a execução, e não há prova de que qualquer dump exista. Para um banco com catálogo real (23 mil entidades) isso é risco de perda total de dados.

---

## 21. Observabilidade

| Camada | Existe? | Evidência |
| --- | --- | --- |
| Log estruturado (auth) | **SIM** — JSON com `scope: "auth-email"`, `correlationId`, tipo fechado | `runtime.ts:33-44` |
| `api_sync_logs` | SIM (tabela + governança) | schema |
| Correlation ID | SIM, no fluxo de auth | `handlers.ts:74` |
| **Endpoint de health em `apps/web`** | **NÃO** | tabela de rotas — `apps/admin/app/health/page.tsx` é uma **página do admin**, que **não está implantado** |
| Métricas | **NÃO** | nenhuma emissão |
| Dashboard | **NÃO** | — |
| **Alertas** | **NÃO — zero** | nenhuma integração Sentry/OTel/webhook |

**Passariam despercebidos hoje:** app fora do ar · pico de 5xx · falha de migration no boot · banco indisponível · Brevo indisponível · job travado · sync desatualizado (**já ocorrendo — 13 dias**) · backup ausente (**já ocorrendo**) · disco cheio · certificado expirando.

---

## 22. Performance

| Achado | Prioridade | Evidência |
| --- | --- | --- |
| **Todas as 23 páginas públicas são `ƒ` (force-dynamic)** — nenhum ISR, todo request bate no Postgres | P2 | tabela do build; `export const dynamic = 'force-dynamic'` |
| **Middleware faz subrequest HTTP interno por request** → `/api/seo/redirect` → consulta ao banco. Amplificação ~2× em toda navegação | **P1** | `middleware.ts:32-58` (auto-documentado como follow-up) |
| Busca usa `pg_trgm` + `unaccent`, SQL parametrizado, `cache()` do React | PASS | `search-page.ts` |
| Sitemap paginado em shards | PASS | 6 shards |
| Bundle enxuto — 102 kB compartilhado, só 4 componentes cliente | PASS | build |
| `cache-control: private, no-cache, no-store` nas páginas HTML → **zero cache de CDN** | P2 | headers de produção |
| Latência observada | 230-500 ms por request | 20+ sondagens |
| Capacidade sob carga | **UNKNOWN** | L6 |

**Estimativa fundamentada (não medida):** o primeiro gargalo sob carga será a conexão com o Postgres, pela combinação *force-dynamic + subrequest de middleware + `no-store`* — cada visualização de página custa no mínimo 2 requisições HTTP e 2+ consultas, sem nenhuma camada de cache.

---

## 23. Documentação e drift (`PARTIAL — COBERTURA REDUZIDA`)

Amostragem apenas (L1). Um drift-audit exaustivo de `docs/**` **não foi realizado**.

**Preciso e verificado:**
- `Dockerfile` — comentários batem exatamente com o comportamento observado (fail-open corrigido, kill switch dinâmico, migration gate).
- `.github/workflows/ci.yml` — os comentários sobre coberturas disjuntas dos dois validadores de Backend C são corretos e valiosos.
- `apps/web/app/robots.ts` — comportamento documentado = comportamento observado em produção.
- `auth-runtime/dispatch.ts` — declara as próprias limitações (sem outbox, sem compensação) com honestidade.

**Drift confirmado:**

| Documento | Afirmação | Realidade | Sev. |
| --- | --- | --- | --- |
| `CLAUDE.md` §1 | *"Dominio canonico publico: `https://thescreen.media`"* | O domínio real é `https://cinerie.com`; o código usa `CINERIE_PUBLIC_SITE_URL` | **P2** |
| `CLAUDE.md` §1 | Marca pública "Screen" | A marca pública é **Cinerie** (rebranding da PR #72) | **P2** |
| `.claude/rules/seo.md` §0 | *"O dominio canonico publico e `https://thescreen.media`"* | idem | P2 |
| `.claude/rules/i18n.md` §10 | *"Cumpre o gate anti-thin (>= 2 blocos de valor)"* | O gate anti-thin foi **removido** (política 2026-07, invariante 5) — o próprio `CLAUDE.md` diz isso | **P2** (contradição interna) |
| `.claude/rules/seo.md` §5 | *"O sitemap **não promove** pagina fina: se o gate anti-thin … falhar"* | idem — gate removido | P2 |

> O `CLAUDE.md` é autoritativo por definição, e continua descrevendo o domínio público antigo. Como ele é carregado em toda sessão de agente, esse drift **propaga erro para todo trabalho futuro**. É o drift mais caro do repositório apesar da severidade nominal baixa.

---

## 24. Diagnóstico do produto visível

| # | Pergunta | Resposta | Evidência |
| --- | --- | --- | --- |
| 1 | Usuário novo consegue criar conta? | **NÃO** | nenhum endpoint/UI de cadastro |
| 2 | Consegue fazer login? | **NÃO** | nenhum endpoint/UI |
| 3 | Consegue verificar e-mail? | **PARCIAL** | endpoints funcionam (verificado), mas não há conta para verificar |
| 4 | Consegue recuperar senha? | **PARCIAL** | fluxo funciona (202/401 verificados), mas não há conta |
| 5 | Consegue manter sessão? | **NÃO** | nenhum cookie/endpoint de sessão |
| 6 | Consegue sair? | **NÃO** | — |
| 7 | Consegue avaliar um filme? | **NÃO** | domínio puro |
| 8 | Consegue escrever review? | **NÃO** | domínio puro |
| 9 | Consegue criar lista? | **NÃO** | domínio puro |
| 10 | Consegue marcar como assistido? | **NÃO** | domínio puro |
| 11 | Consegue acompanhar episódios? | **NÃO** | domínio puro |
| 12 | Consegue receber recomendações? | **NÃO** | domínio puro, ports sem adapter |
| 13 | Consegue editar perfil? | **NÃO** | — |
| 14 | Consegue importar Letterboxd? | **NÃO** | só `ImportJob` no schema |
| 15 | Consegue exportar dados? | **NÃO** | domínio puro, sem executor |
| 16 | Consegue excluir conta? | **NÃO** | domínio puro, sem executor |
| 17 | Moderador consegue moderar? | **NÃO** | domínio puro + admin não implantado |
| 18 | Editor consegue publicar? | **NÃO** | admin não implantado |
| 19 | Administrador consegue operar? | **NÃO** | `apps/admin` fora do Dockerfile |
| 20 | Portal público entrega catálogo e notícias com design final? | **PARCIAL** — catálogo real (23.288 URLs) servido, **sem design**, notícias vazias na home, tudo noindex | HTTP |

**Placar: 0 SIM · 3 PARCIAL · 17 NÃO.**

---

## 25. Scoring

**Fórmula:** `overall = Σ(nota × peso) / 100`, pesos somando 100. Cada nota deriva dos achados verificados acima, penalizada pela prioridade dos defeitos abertos.

| # | Categoria | Nota | Peso | Evidência-chave | Conf. | Falta para 100 |
| --- | --- | ---: | ---: | --- | --- | --- |
| 1 | Integridade do repositório | 95 | 3 | main = commit de prod; worktree limpa; sem phantom commit | HIGH | podar 13 branches obsoletas |
| 2 | CI e testes | 88 | 7 | 28/28 no CI; 3.375 testes | HIGH | `apps/**` sem typecheck/vitest; zero E2E |
| 3 | Banco e migrations | 90 | 7 | 75 modelos; 12 migrations UTF-8, aditivas; do-zero + upgrade no CI | HIGH | sem retenção; prod não inspecionado |
| 4 | Catálogo (Backend A) | 70 | 7 | 23.288 URLs reais; render puro | MEDIUM | nada agendado; 13 dias parado; desequilíbrio 22k×129 |
| 5 | Dados externos (Backend B) | 45 | 5 | validadores verdes; nada renderizado | LOW | não exposto; Score bloqueado |
| 6 | Autenticação | 72 | 8 | 10 sondagens corretas em produção | HIGH | sem cadastro/login/sessão; sem outbox |
| 7 | Produto de usuário (Backend C) | 25 | 9 | só 5 adapters; 4 handlers | HIGH | persistência, HTTP e UI de ~30 capacidades |
| 8 | Frontend público | 45 | 8 | 27 rotas servindo dado real | HIGH | 0 imagens; 960 chars; sem design |
| 9 | UX autenticada | 3 | 7 | 2 páginas de auth, nada mais | HIGH | produto autenticado inteiro |
| 10 | SEO | 60 | 7 | canonical/JSON-LD/sitemap corretos | HIGH | site noindex; index bloat; robots duplicado |
| 11 | Segurança | 68 | 8 | sem segredos/injeção/XSS; auth sólida | MEDIUM | sem CSP/HSTS; root; `/dev` público; XFF |
| 12 | LGPD | 20 | 5 | domínio puro sem executor | HIGH | persistência + endpoints + runner + política |
| 13 | Operação / deploy | 55 | 6 | migration gate; envs fail-closed | MEDIUM | root; single-stage; `latest`; sem healthcheck |
| 14 | Backup / DR | 30 | 5 | scripts bons, nada agendado | HIGH | agendar + provar + off-site + restore verde |
| 15 | Observabilidade | 25 | 3 | logs de auth estruturados | HIGH | métricas, health, **alertas** |
| 16 | Performance | 55 | 3 | bundle enxuto; busca indexada | MEDIUM | force-dynamic + subrequest; sem cache |
| 17 | Documentação | 70 | 2 | comentários de código exemplares | LOW | `CLAUDE.md` com domínio/marca antigos |

**Soma ponderada = 5.352 → OVERALL = 53,5 → `54/100`.**

### Prontidão para MVP (calculada à parte)

MVP mede **apenas o que um usuário real consegue fazer hoje**:

- **Como portal público somente-leitura:** catálogo servido ✅ (+40) · design ❌ (−25) · indexação ❌ (−20) · notícias vazias ❌ (−5) · sem alerta/backup ❌ (−5) → **~45/100**
- **Como produto com conta:** cadastro ❌ · login ❌ · sessão ❌ · qualquer UI de produto ❌ · LGPD ❌ → **~10/100** (crédito apenas pela fundação de auth pronta)

**MVP READINESS = (45 + 10) / 2 = 28/100. Confiança: MEDIUM.**

---

## 26. Risk register

| ID | Área | Risco | Evidência | Impacto | Prob. | Pri. | Mitigação | Dono |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | Dados | **Nenhum backup comprovado.** Scripts existem, nada os agenda, nenhuma prova de dump | busca por cron/systemd → 0 | Perda total do catálogo | Alta | **P0** | Agendar + executar + validar restore + off-site | Ops |
| R02 | Produto | **Cadastro/login inexistentes.** Nenhum endpoint, nenhuma UI | `handlers.ts:64-69` (4 handlers) | Produto de usuário inalcançável | Certa | **P0** | Implementar C7D: signup/login/sessão + UI | Backend |
| R03 | SEO/Negócio | **Site inteiro noindex** em produção | `robots.txt` + meta em `/pt/` | Zero aquisição orgânica | Certa | **P0**\* | Configurar envs no EasyPanel (após R04) | Ops |
| R04 | Produto | **Camada visual inexistente** — 960 chars, 0 imagens | HTML de `/pt/` | Site inapresentável ao público | Certa | **P1** | Reintegrar `feat/web-canonical-cinematic-port` | Frontend |
| R05 | SEO | **22.432 pessoas × 129 filmes** — index bloat ao ligar indexação | shards do sitemap | Penalidade de qualidade sitewide | Alta | **P1** | Decisão editorial de escopo antes de indexar | Editorial+SEO |
| R06 | Jurídico | **LGPD inoperante** — export/exclusão são domínio puro | `privacy/export.ts:4` | Pedido de titular não atendível | Média\*\* | **P1** | C7B3: persistência + endpoints + runner | Backend+Jurídico |
| R07 | Segurança | **Zero headers de segurança** (CSP, HSTS, X-Frame-Options) | `next.config.ts` + headers de prod | XSS/clickjacking/downgrade | Média | **P1** | `headers()` no `next.config.ts` | Frontend |
| R08 | Operação | **Zero alertas.** Nada avisa queda, 5xx, backup ausente | busca no repo | Incidente silencioso prolongado | Alta | **P1** | Uptime + erro + alerta de backup | Ops |
| R09 | Operação | **Nada é agendado** — sync manual; sitemap 13 dias parado | `lastmod` 2026-07-10 | Catálogo apodrece | Certa | **P1** | Agendador (systemd timer / GH Action cron) | Ops |
| R10 | Segurança | **`X-Forwarded-For` sem allowlist comprovada** → bypass de throttle *(HIPÓTESE — não confirmado)* | não verificado (L1) | Força bruta/spam de e-mail | Média | **P1** | Confirmar e, se procede, fixar proxy confiável | Backend |
| R11 | Operação | **Imagem `latest` sem SHA** — impossível provar o commit em execução | `Dockerfile` sem LABEL | Deploy não auditável | Certa | **P1** | `LABEL org.opencontainers.image.revision` | Ops |
| R12 | Operação | **Sem `HEALTHCHECK`**, container **root**, imagem single-stage com devDeps e `git` | `Dockerfile` | Superfície de ataque; restart não gerenciado | Média | **P2** | Multi-stage + `USER node` + HEALTHCHECK | Ops |
| R13 | Segurança | **`/dev/movie-page-preview` público**, cache de 1 ano | HTTP 200 | Superfície pública não intencional | Baixa | **P2** | Excluir do build de produção | Frontend |
| R14 | Segurança | **`/api/seo/redirect` sem autenticação**, consulta o banco | HTTP 200 | Amplificação/DoS barata | Baixa | **P2** | Rate limit ou tornar interno | Backend |
| R15 | Performance | **Subrequest de middleware por request** + tudo force-dynamic + `no-store` | `middleware.ts:32-58` | Custo 2× e gargalo no Postgres | Média | **P2** | Node middleware (Next 15.5) lendo direto | Backend |
| R16 | Qualidade | **`apps/**` sem typecheck e sem vitest**; `apps/admin` não é buildado por ninguém | `tsconfig.json` include | Regressão só aparece em produção | Média | **P2** | Incluir apps no CI | Plataforma |
| R17 | Produto | **`apps/admin` NOT_DEPLOYED** — 11 páginas, 33 testes, fora do Dockerfile | `Dockerfile:47` | Sem operação editorial | Certa | **P2** | Decidir: implantar protegido ou arquivar | Produto |
| R18 | Governança | **`CLAUDE.md` cita `thescreen.media` e marca "Screen"** | `CLAUDE.md` §1 | Propaga erro a todo agente futuro | Certa | **P2** | Atualizar para Cinerie/cinerie.com | Governança |
| R19 | Governança | Regras citam gate anti-thin já removido | `i18n.md` §10, `seo.md` §5 | Contradição interna | Certa | **P2** | Alinhar à política 2026-07 | Governança |
| R20 | Auth | **Sem outbox/retry** — token comitado, e-mail pode nunca sair | `dispatch.ts` (auto-documentado) | Usuário sem e-mail, sem retry | Média | **P2** | Tabela de outbox + worker | Backend |
| R21 | Produto | **Cinerie Score sem decisão humana** | sem registro de decisão | Publicação indevida de nota própria | Baixa | **BLOCKED_BY_DECISION** | Decisão humana registrada | Humano |
| R22 | Auth | Endpoints `confirm` sem throttle dedicado | ausência no código | Volume contra o banco | Baixa | P2 | Throttle no confirm | Backend |
| R23 | SEO | `robots.txt` com 2 grupos `User-agent: *` (Cloudflare × app) | HTTP | `Disallow: /api/,/dev/` pode ser ignorado | Média | P2 | Alinhar política do Cloudflare | Ops+SEO |
| R24 | Jurídico | **PII na Brevo sem política publicada**; PII em backups sem propagação de exclusão | ausência de página de política | Exposição regulatória | Média\*\* | P2 | Publicar política + revisão jurídica | Jurídico |

\* R03 é **P0 se o lançamento público é esperado agora**; é comportamento correto se a intenção é manter o site fechado. **Requer decisão humana.**
\*\* Probabilidade baixa hoje **porque não há usuários reais** (não há cadastro). Sobe para Alta no instante em que R02 for resolvido.

**Contagem: 3 riscos P0 · 8 riscos P1 · 12 riscos P2 · 1 bloqueado por decisão.**

---

## 27. Plano de conclusão (15 itens)

### Antes de abrir ao público (P0 + P1)

| # | Item | Objetivo | Alvos | Depende | Teste de aceite | Tam. | Par.? | Bloqueio humano |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Backup real, agendado e provado** | Eliminar risco de perda de dados | `scripts/backup/*`, systemd timer/GH Action, `rclone` | — | Um dump com `.sha256` existe off-site e `restore-test.sh` sai 0 contra o dump mais recente | M | ✅ | credencial R2/S3 |
| 2 | **Cadastro + login + sessão (C7D)** | Tornar o produto de usuário alcançável | `services/user-platform/{http,auth-runtime}`, `apps/web/app/api/auth/**` | — | `POST /api/auth/signup/` cria usuário; `POST /login/` devolve cookie de sessão; `GET /session/` identifica; `POST /logout/` revoga — provados por teste de integração com PostgreSQL efêmero no CI | **XL** | ⚠️ | — |
| 3 | **UI de conta** | Dar interface ao item 2 | `apps/web/app/pt/{entrar,cadastrar,conta}` | 2 | Um humano cria conta, faz login, sai e volta pelo navegador | L | ❌ | design |
| 4 | **Restaurar a camada visual** | Site apresentável | `feat/web-canonical-cinematic-port` (11 commits) → main | — | `/pt/` renderiza pôsteres; texto visível > 3.000 chars; `next build` verde | **XL** | ✅ | aprovação de design |
| 5 | **Headers de segurança** | Fechar CSP/HSTS/X-Frame/Permissions | `apps/web/next.config.ts` | — | `curl -I https://cinerie.com/pt/` mostra os 4 headers; CSP sem `unsafe-inline` fora do JSON-LD | S | ✅ | — |
| 6 | **Escopo de catálogo antes de indexar** | Evitar index bloat (22.432×129) | política de indexabilidade, sitemap | — | Sitemap reflete a política decidida; razão pessoa:obra justificada por escrito | M | ✅ | **decisão editorial** |
| 7 | **Ligar a indexação com consciência** | Aquisição orgânica | envs do EasyPanel + política do Cloudflare | 4, 5, 6 | `robots.txt` com um único grupo `*` = `Allow: /` + `Disallow: /api/,/dev/,/admin/`; `/pt/` sem `noindex`; sitemap anunciado | S | ❌ | **decisão de lançamento** |
| 8 | **Agendador de sync** | Catálogo deixa de apodrecer | systemd timer / GH Action cron | 1 | `lastmod` do sitemap < 48h em duas verificações consecutivas | M | ✅ | — |
| 9 | **Alertas mínimos** | Parar de descobrir incidente por acaso | uptime externo + `/api/health` + alerta de backup | 1 | Derrubar o serviço em janela controlada dispara alerta em < 5 min | M | ✅ | canal de alerta |
| 10 | **Confirmar/corrigir confiança em `X-Forwarded-For`** | Fechar bypass de throttle | `services/user-platform/src/http/request.ts` | — | Teste provando que XFF forjado **não** desloca o balde quando não vem do proxy confiável | S | ✅ | — |

### Primeiros 7 dias após abertura

| # | Item | Objetivo | Alvos | Teste de aceite | Tam. | Par.? |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | **LGPD operacional (C7B3)** | Atender pedido de titular | `privacy/**` + persistência + endpoints + runner + política publicada | Pedido de exportação gera arquivo baixável e expira; exclusão anonimiza após carência | **XL** | ⚠️ (bloqueio jurídico) |
| 12 | **Endurecer imagem e proveniência** | Reduzir superfície e auditar deploy | `Dockerfile` multi-stage, `USER node`, `HEALTHCHECK`, `LABEL …revision` | Imagem sem devDeps/`git`; `docker inspect` revela o SHA; app sobe igual | M | ✅ |
| 13 | **Fechar superfícies indevidas** | `/dev` e `/api/seo/redirect` | build de produção, rate limit | `/dev/movie-page-preview/` → 404 em produção; redirect com limite por IP | S | ✅ |

### Pós-MVP

| # | Item | Objetivo | Alvos | Teste de aceite | Tam. | Par.? |
| --- | --- | --- | --- | --- | --- | --- |
| 14 | **Ativar o produto de usuário** | Converter ~30 capacidades de domínio puro em produto | adapters Prisma + HTTP + UI para avaliações, reviews, listas, tracking, recomendações | Usuário avalia, cria lista, marca assistido e recebe recomendação pelo navegador | **XL** | ⚠️ |
| 15 | **Fechar dívidas de plataforma** | Qualidade e performance | `apps/**` no typecheck/CI; decidir sobre `apps/admin`; middleware sem subrequest; ISR; `CLAUDE.md`/regras atualizados | CI cobre apps; p95 de `/pt/` < 300 ms; docs sem marca/domínio legados | L | ✅ |

---

## 28. Comandos executados (resumo)

**~45 comandos.** Git: `fetch --prune`, `status --short`, `branch --show-current`, `rev-parse HEAD/origin/main`, `log --oneline -30`, `branch -r --no-merged`, `cherry` (×13), `worktree add/list`, `ls-files`. GitHub: `gh run list --commit`, `gh run view --json jobs`, `gh pr view 75`, `gh pr list`. Build/teste: `pnpm install --frozen-lockfile`, `db:generate`, `typecheck`, `typecheck:catalog-runtime`, `lint`, `test`, `audit:invariants`, `audit:render`, `api:coverage`, `build`. Produção (read-only): 20+ `fetch` para robots, `/`, `/pt/`, sitemap + 6 shards, `/dev/…`, 404, `/api/seo/redirect`, e 10 sondagens de auth. Análise: varreduras de encoding, statements destrutivos, segredos, `NEXT_PUBLIC_`, SQL raw, XSS, `eval`, headers, agendadores.

## 29. Evidências NÃO verificadas

`prisma migrate status` em produção · qualquer conteúdo do banco de produção · variáveis de ambiente reais do EasyPanel · logs do container · smoke da Brevo (fornecido, não repetido) · existência de qualquer backup · cópia off-site · restore test · Lighthouse/acessibilidade automatizada · teste de carga · `pnpm audit` de rede · proteção de branch no GitHub · **auditoria profunda de Backend A, Backend B, UX e drift documental (L1 — a frota multiagente falhou).**

## 30. Revisão adversarial deste relatório

Segunda leitura, tentando derrubar cada `PASS`. Correções aplicadas ao próprio relatório:

| Confusão caçada | Encontrada? | Correção aplicada |
| --- | --- | --- |
| **202 tratado como e-mail entregue** | **SIM** | Minhas sondagens 202 usaram e-mail **inexistente** — nenhum e-mail é enviado nesse caminho. Adicionada a ressalva do §13.2: o fluxo de recuperação **nunca foi provado ponta a ponta** e o ramo de sucesso do `confirm` está não exercitado. |
| **Rota presente tratada como UX pronta** | **SIM** | §15.1 acrescentada com medição HTTP de todas as 8 rotas: 0 imagens em 100% delas; `/pt/noticias/` com 372 chars = vazia. |
| **Domínio puro tratado como produto** | Não (era a tese central) | Mantido: matriz §14 separa domínio/persistência/HTTP/UI em colunas distintas. |
| **Código tratado como deploy** | Não | `apps/admin` marcado NOT_DEPLOYED com evidência do `Dockerfile:47`. |
| **Teste unitário tratado como E2E** | Não | L8 declara: **zero testes E2E no repositório**. Nenhuma afirmação de ponta a ponta vem de teste. |
| **Migration presente tratada como aplicada** | Não | `migrate status` de produção marcado EVIDÊNCIA FORNECIDA, não verificada. |
| **Script de backup tratado como backup** | Não | §20 gradua em 6 níveis; só o primeiro é PASS. |
| **Build verde tratado como segurança** | Não | §17 tem achados próprios (headers ausentes, root, `/dev` público). |
| **Documentação tratada como execução** | Parcial | §19 é inferência do `Dockerfile`; explicitado em L3 que o container real não foi inspecionado. |
| **Ausência de grep tratada como PASS** | Parcial | Mantido só onde o padrão é sintático e determinístico (`eval`, `new Function`, `$executeRawUnsafe`). Onde a ausência não prova nada (XFF, throttle no confirm), usei **UNKNOWN/hipótese**, não PASS. |
| **Branch "não mergeada" tratada como trabalho perdido** | **SIM** | §7 recalculada com `git cherry`: `feat/api-coverage-registry` tem **0** commits fora da main (artefato de squash). Evitado falso alarme. |
| **Não-ASCII em migration tratado como risco WIN1252** | **SIM** | Verificado round-trip UTF-8 nas 12 migrations: **todas válidas**, acentuação apenas em comentários. **Falso positivo descartado explicitamente** (§10). |
| **Inferência apresentada como fato** | **SIM** | "22.432 páginas de pessoa são rasas" era inferência — o conteúdo dessas páginas **não foi inspecionado**. Reclassificado abaixo como hipótese. |

**Correção adicional (hipóteses explicitadas):**
- **R05** — a *quantidade* (22.432 × 129) é fato medido; a *qualidade rasa* dessas páginas é **HIPÓTESE não verificada** (não abri nenhuma página de pessoa em produção). O risco de index bloat decorre do desequilíbrio, que é fato.
- **R10** — bypass de `X-Forwarded-For` é **HIPÓTESE**; não localizei allowlist de proxy, mas **não confirmei sua ausência** (L1). Não deve ser tratado como defeito confirmado.
- **R03** — a indexação desligada é **fato medido**; que isso seja *indesejado* é suposição sobre a intenção do operador. Requer decisão humana.

---

## 31. Apêndice — arquivos mais relevantes

`Dockerfile` · `.github/workflows/ci.yml` · `tsconfig.json` · `apps/web/next.config.ts` · `apps/web/middleware.ts` · `apps/web/app/robots.ts` · `apps/web/src/lib/site.ts` · `apps/web/app/pt/page.tsx` · `apps/web/src/server/auth/runtime.ts` · `apps/web/src/server/search-page.ts` · `services/user-platform/src/http/handlers.ts` · `services/user-platform/src/auth-runtime/{composition,dispatch,config}.ts` · `services/user-platform/src/persistence/{ports.ts,prisma/index.ts}` · `services/user-platform/src/privacy/{export,deletion,retention}.ts` · `packages/db/prisma/schema.prisma` · `packages/db/prisma/migrations/**` (12) · `packages/seo/src/json-ld.ts` · `scripts/backup/{backup,restore-test}.sh` · `scripts/audit/{check-invariants,check-render-purity,check-api-coverage}.mjs`

---

*Auditoria read-only. Produção não foi alterada. Nenhum segredo exibido. Nenhum merge realizado. Nenhuma correção aplicada. C7B3 não iniciado.*
