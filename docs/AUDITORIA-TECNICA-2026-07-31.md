# Auditoria técnica — estado real do projeto Cinerie

> **Natureza deste documento:** diagnóstico. Nenhuma linha de código de produto foi
> alterada nesta sessão. Todas as afirmações abaixo são acompanhadas da evidência
> que as sustenta, e o que **não** pôde ser verificado está declarado na seção 8.

- **Data:** 2026-07-31
- **Commit auditado:** `953696a` — `test(editorial): canário ponta a ponta dos vínculos até as superfícies públicas (#99)`
- **Branch:** `claude/project-technical-audit-5b8ddb`, idêntica a `origin/main` (verificado com `git log origin/main`)
- **Working tree:** limpa

---

## 1. Escopo e método

### O que foi feito

1. Inventário estático do monorepo (workspaces, rotas, migrations, contratos, CLIs, imagens de deploy).
2. **Execução real dos gates** do projeto: instalação de dependências, geração do Prisma Client, cinco typechecks, lint, suíte de testes, três auditorias de governança e o build do app público.
3. Confronto entre o que os documentos canônicos (`CLAUDE.md`, `.claude/rules/*`, `README.md`, `DIVERGENCIAS.md`) **afirmam** e o que o código **faz**.

### Limites deliberados

- **Nenhuma conexão com o banco de produção.** Não existe `.env` neste worktree (só `.env.example`), e o registro do projeto indica que o `.env` do checkout primário aponta para produção. Nada foi executado que pudesse tocá-lo.
- **Nenhuma chamada a API externa**, nenhum Gemini real, nenhuma publicação.
- Auditoria de **código e gates**, não de **dados**. Volume real de catálogo, matérias publicadas e usuários não é observável daqui.

---

## 2. Retrato quantitativo

| Métrica | Valor |
| --- | --- |
| Arquivos versionados | 1.458 |
| Arquivos TypeScript/TSX | 1.148 (213.447 linhas) |
| Documentação Markdown | 34.854 linhas |
| Commits no histórico | 159 |
| Workspaces pnpm | 27 (24 reais, 3 placeholders) |
| Modelos Prisma (banco público) | 80 |
| Enums Prisma | 51 |
| Migrations do banco público | 16 + `migration_lock.toml` |
| Migrations do CMS (Payload) | 9 |
| Arquivos de teste | 349 |
| Testes de governança | 31 arquivos em `tests/governance/` |
| Rotas `page.tsx` | 32 (28 sob `/pt`, 2 aliases de redirect, 2 de preview em `/dev`) |
| Rotas de API | 37 |
| Imagens Docker | 3 |
| Passos de CI | 61, em 3 jobs |

**Proporção que chama atenção:** 34.854 linhas de documentação para 213.447 de código — cerca de 1 linha de doc para cada 6 de código. É um projeto documentado acima da média, o que torna a **defasagem documental** da seção 7 mais relevante, não menos: há muita superfície onde a descrição pode divergir do fato.

---

## 3. Mapa real do monorepo

### 3.1 Apps (3)

| Workspace | Arquivos TS | Papel real observado |
| --- | --- | --- |
| `apps/web` | 64 | App público Next.js. 32 páginas (28 sob `/pt`), 37 rotas de API, middleware de locale + redirects persistidos. |
| `apps/cms` | 59 | **CMS editorial Payload.** 9 migrations próprias, 5 endpoints (drafts, publications, media, outbox, contracts), quota de autopublicação, `healthz`/`readyz`, E2E Playwright, Dockerfile próprio. |
| `apps/admin` | 24 | Painel interno. 11 telas; ações editoriais atrás da flag `ADMIN_EDITORIAL_ACTIONS_ENABLED`. |

### 3.2 Packages (9)

`config`, `schemas`, `seo` (28 arquivos — o maior), `ui`, `types`, `db`, `public-contracts`, `cinerie-score`, **`editorial-contracts`** (13 arquivos).

### 3.3 Services (8)

| Workspace | Arquivos TS | CLIs em `bin/` |
| --- | --- | --- |
| `services/user-platform` | **220** (o maior do repo) | — |
| `services/ingestion` | 187 | 8 |
| `services/entity-writer` | 57 | 5 |
| `services/news-ingestion` | 48 | 4 |
| `services/ratings` | 38 | 2 |
| `services/streaming` | 34 | 3 |
| `services/legal` | 8 | 1 |
| `services/sync` | 4 | 1 |

### 3.4 API clients (7)

Reais: `tmdb` (14), `rapidapi-core` (11), `film_show_ratings` (6), `streaming_availability` (6).
Placeholders (só `README.md`, sem `package.json`): `imdb`, `kaso`, `rotten_tomatoes` — coerente com o que `CLAUDE.md` declara.

### 3.5 Legado confirmado como legado

- `workers/*.py` — 6 arquivos, **379 linhas no total**. São esqueletos, como a governança afirma. Nenhum contém `NotImplementedError`/`TODO`; são simplesmente pequenos.
- `database/` — `migrations/` e `seeds/` vazios (só `.gitkeep`/`README`). A fonte executável é `packages/db/prisma`, como documentado.

---

## 4. Evidência executável: os gates

Todos executados nesta sessão, neste worktree, após `pnpm install --frozen-lockfile` (exit 0) e `db:generate` (Prisma Client v6.19.3).

| Gate | Resultado | Evidência |
| --- | --- | --- |
| `pnpm typecheck` (raiz) | ✅ exit 0 | sem diagnósticos |
| `pnpm typecheck:web` | ✅ exit 0 | sem diagnósticos |
| `pnpm typecheck:admin` | ✅ exit 0 | sem diagnósticos |
| `pnpm typecheck:cms` | ✅ exit 0 | sem diagnósticos |
| `pnpm typecheck:catalog-runtime` | ✅ exit 0 | sem diagnósticos |
| `pnpm lint` | ✅ exit 0 | zero problemas |
| `pnpm test` | ✅ exit 0 | **341 arquivos, 4.404 testes, 0 falhas**, 55,9 s |
| `pnpm audit:invariants` | ✅ PASSOU | 7 ok, 0 violações; 1.129 arquivos varridos |
| `pnpm audit:render` | ✅ PASSOU | 2 ok, 0 violações; 198 arquivos de `apps/web`, 750 repo-wide |
| `pnpm api:coverage` | ✅ PASSOU | 7 providers, 71 endpoints, 34 grupos de campo |
| `pnpm build` | ✅ exit 0 | build do `@screena/web` completo |

### Sinais de higiene (positivos, e vale registrar)

- **Zero testes pulados.** Nenhum `.skip`/`.todo` na base. Os 4.404 testes que passam são 4.404 testes que rodam.
- **Zero dívida marcada.** Os 41 hits de `TODO` em `src/` são a palavra portuguesa *"TODOS/TODO"* em comentários, não marcadores de pendência. A única exceção é auto-referente e correta: `packages/cinerie-score` documenta que devolver `blocked_by_decision` **"é o estado correto, não um TODO"**.
- **Segredos limpos.** Só `.env.example` versionado; `.gitignore` cobre `.env`/`.env.*`; nenhuma chave literal encontrada em `apps`/`packages`/`services`/`api-clients`.

---

## 5. Estado funcional por domínio

Três categorias, por nível de evidência.

### 5.1 Funcional ponta a ponta — com canário em CI

- **Catálogo TMDB → PostgreSQL → páginas públicas.** `services/ingestion` (187 arquivos, 8 CLIs), validadores `validate:tmdb-platform`, `validate:catalog-platform-complete`, `validate:catalog-integrity`. Rotas de filme, série, temporada, episódio e pessoa buildam.
- **Caminho editorial manual: CMS → outbox → worker → banco público → `/pt/noticias`.** Sustentado por quatro passos de CI dedicados, incluindo *"Canário da publicação manual até a página pública"* e *"Canário dos vínculos editoriais até as superfícies públicas"* — este último é exatamente o commit auditado (`953696a`).
- **Plataforma de usuário.** 15 rotas de auth/conta (10 em `/api/auth/**` + 5 em `/api/account/**`), 19 rotas `/api/me/**`, 13 telas em `/pt`, e três validadores próprios em CI (`validate:user-product`, `validate:identity-privacy`, `validate:library`).

**A ponte editorial é sólida no ponto onde eu esperava fragilidade.** Os dois lados do contrato compartilham o mesmo pacote: `services/news-ingestion/src/editorial-event-mapper.ts` importa `parsePublicationEventV1` de `@screena/editorial-contracts`, o mesmo pacote que `apps/cms` usa para emitir. Produtor e consumidor não podem derivar em silêncio.

### 5.2 Contrato pronto, produto não ativado

| Domínio | Situação verificada |
| --- | --- |
| **Ratings externos** | Validadores e schema completos; `services/ratings` com CLI `ratings`. Sem produto público ativo — coerente com `.claude/rules/ratings.md`. |
| **Streaming / onde assistir** | 3 CLIs operáveis, documentados em `docs/runbooks/streaming-sync.md` via `node --import tsx`. Painel público gateado por licença. |
| **Cinerie Score** | `packages/cinerie-score` **não contém fórmula** e devolve `blocked_by_decision`, aguardando decisão humana em `docs/product/cinerie-score-decision.md`. Estado correto e honesto. |
| **Entity Writer** | Roda offline com adapter Gemini separado. Cobre **2 dos 12** `block_type` do schema: `editorial_intro` e `cast_intro` (`BLOCK_FIELDS` em `pipeline/run-generation.ts`). Bate exatamente com o que `.claude/rules/entity-writer.md` declara. |
| **Prompts** | 8 arquivos em `prompts/`; apenas `entity_intro_pt.md` está ligado ao pipeline. Os outros 7 são contrato/roadmap. |

### 5.3 Deploy

Três imagens, todas com usuário não-root e `HEALTHCHECK`:

| Imagem | Porta | Comportamento no boot |
| --- | --- | --- |
| `Dockerfile` (web) | 3000 | Roda `prisma migrate deploy`; **aborta o boot se a migration falhar**, com diagnóstico de `pgcrypto` e ponteiro para o runbook. |
| `Dockerfile.cms` | 3002 | Lê secrets de `/run/secrets/*` como fallback; roda migration do Payload; aborta se falhar. |
| `Dockerfile.publication-worker` | 3003 | Sobe o worker de projeção. |

O padrão *fail-fast com mensagem acionável* nos dois primeiros é maduro — o container não sobe mentindo que está saudável.

---

## 6. Governança: o que está travado por teste

`tests/governance/` tem 31 arquivos travando as invariantes. `audit:render` confirma pureza de render em 198 arquivos de `apps/web` e restringe o host de imagem TMDB a um único arquivo autorizado (`packages/public-contracts/src/media-url.ts`) em 750 arquivos de produção.

Destaque: `editorial-worker-boundary.test.ts` trava a assimetria da ponte editorial — o worker fala Prisma com o banco público e HTTP com o Payload, e **não pode** abrir conexão com o banco do CMS.

---

## 7. Divergências entre documentação e código

Esta é a principal descoberta da auditoria. **O código está mais avançado do que a governança que o descreve.** Todos os itens abaixo foram verificados nos dois lados.

### D1 — `CLAUDE.md` não mapeia dois workspaces reais e ativos `[ALTO]`

O mapa do monorepo (§5) é declarado autoritativo, mas **não tem linha para `apps/cms` nem para `packages/editorial-contracts`**. `grep -c 'apps/cms' CLAUDE.md` → **0**. `grep -c 'editorial-contracts' CLAUDE.md` → **0**.

O que está fora do mapa:

- **`apps/cms`** — 59 arquivos TS, 9 migrations próprias, 5 endpoints, Dockerfile próprio, ~10 passos de CI. É o CMS editorial aprovado. Aparece só obliquamente ("a outbox do CMS", "API do Payload") na linha de `news-ingestion` e no ADR 0015.
- **`packages/editorial-contracts`** — 13 arquivos; é o contrato compartilhado pelos dois lados da ponte editorial.

A seção **Aliases** de `CLAUDE.md` também omite `@screena/editorial-contracts`, que **existe** em `tsconfig.base.json:23` e `vitest.config.ts:47`. A própria `CLAUDE.md` manda esses dois arquivos baterem entre si — batem; quem não bate é a documentação.

### D2 — `CLAUDE.md` se contradiz internamente `[ALTO]`

- **§1** afirma: *"Ainda **não** estão funcionais como produto: (...) usuários/community públicos"*.
- **§5**, na mesma página, afirma: `user-platform` — *"runtime de auth **WIRED** nas rotas `/api/auth/**`"*.

O código dá razão à §5: 220 arquivos TS, 15 rotas de auth/conta, 19 rotas `/api/me/**`, 13 telas públicas (`/pt/conta`, `/pt/listas`, `/pt/tracker`, `/pt/historico`, `/pt/importar`, `/pt/minha-lista`, …) e 3 validadores em CI.

A §1 também lista *"ingestão de notícias ponta a ponta"* e *"redação editorial"* como não funcionais — enquanto o CI tem canários ponta a ponta para exatamente isso, sendo um deles o commit auditado.

### D3 — `README.md` é o documento mais defasado `[ALTO]`

A seção *"Ainda NÃO funcionais como produto completo"* contém três afirmações contrariadas pelo código:

| Afirmação do README | Realidade verificada |
| --- | --- |
| *"toda a camada de usuário (community, reviews, favoritos, listas, watchlist) — a camada de usuário é ausência **intencional** (Cinerie é entity-first, não rede social)"* | Implementada: `services/user-platform` (220 arquivos), listas, watchlist, tracker, histórico, importação. Isto não é uma lacuna de implementação — é a **justificativa arquitetural invertida**: o doc defende como decisão de produto algo que o produto já fez. |
| *"trilíngue global (`/pt` `/es` `/en`)"* e *"`/es` e `/en` têm rota"* | **Falso.** `apps/web/app/` contém apenas `pt`. Zero rotas `/en` ou `/es`. O próprio `middleware.ts` confirma: *"Enquanto en/es não tiverem conteúdo real publicado, o fallback da raiz é `/pt/`"*. `PUBLISHED_LOCALES = ["pt-BR", "pt"]`. |
| *"`screen_score` (nota própria)"* | Renomeado para **Cinerie Score** (`packages/cinerie-score`) no Gate 1.5. |

### D4 — `DIVERGENCIAS.md` D-003 descreve um produto que já existe `[MÉDIO]`

Afirma: *"listas, conta e browse dedicado de streaming ainda não existem"* e que a navegação omite esses itens *"para não apresentar affordance morta"*. Os três existem hoje: `/pt/listas`, `/pt/conta`, `/pt/onde-assistir`. A justificativa de honestidade de UI virou, ela própria, desatualizada.

### D5 — Por que os gates não pegaram nada disso `[MÉDIO]`

`audit:invariants` passou verde com **7 ok, 0 violações** enquanto todas as divergências acima existiam. Motivo, lido no output: ele valida *"todas as N frases-chave presentes"* em `CLAUDE.md` e `.claude/rules/*`.

**O gate verifica presença de texto, não veracidade dele — e não cobre `README.md` nem `DIVERGENCIAS.md`.** É uma trava anti-remoção (impede alguém apagar uma invariante), não uma trava anti-defasagem. A distinção importa: o verde de `audit:invariants` não é evidência de que a documentação descreve o sistema.

---

## 8. Riscos e lacunas

### R1 — Os resultados desta auditoria foram obtidos sob Node 24 `[ALTO]`

Todo comando emitiu:

```
WARN Unsupported engine: wanted: {"node":">=22 <23"} (current: {"node":"v24.14.0"})
```

O `engines` do projeto e o CI usam **Node 22**. O registro do projeto documenta que Node 24 já produziu **verde falso** numa suíte de integração (falha na fase de coleta passando despercebida). Portanto: os 4.404 testes verdes desta sessão são um sinal forte, **mas não substituem o CI em Node 22**. Nenhuma conclusão deste documento deve ser usada para dispensar o CI.

### R2 — Nenhuma página é prerenderizada `[MÉDIO]`

O build marca **todas** as páginas públicas como `ƒ` (server-rendered on demand). Verificado:

- `generateStaticParams`: **0 ocorrências** em todo `apps/web`
- `export const dynamic`: **64** ocorrências
- `export const revalidate`: **5** (todas `3600`, nas rotas de entidade)

As 5 rotas de entidade não usam `cookies()`/`headers()`, então o ISR de 1 h é viável em runtime. Mas o `ISR/revalidate` que `CLAUDE.md` §4 declara como característica da stack se realiza hoje em **5 de 32** páginas, e nenhuma tem shell estático. Para a meta de *"app publicável em escala"*, cada slug novo custa um render completo a frio.

### R3 — O middleware faz um subrequest HTTP por requisição `[MÉDIO]`

`apps/web/middleware.ts` chama `fetch('/api/seo/redirect')` em toda requisição não excluída pelo matcher, para resolver redirects persistidos — porque o middleware roda no Edge e não acessa Postgres. O código é *fail-closed* (erro ⇒ segue sem redirect), o que é correto, e o próprio comentário registra a otimização pendente via Node middleware. Fica como custo por request conhecido, não como defeito oculto.

### R4 — 25 dos 61 passos de CI não foram exercidos localmente `[INFORMATIVO]`

Não é uma falha: é o limite honesto desta auditoria. Ver seção 9.

---

## 9. O que NÃO foi verificado

Declarado explicitamente para que ninguém leia o verde da seção 4 como cobertura total.

1. **Os 25 passos de CI com PostgreSQL 16 efêmero** — todos os validadores de migration, stores, projeção editorial, mídia editorial, integração do CMS e plataforma de usuário. Nenhum rodou aqui.
2. **Os outros 2 jobs de CI** — `backup-restore` (fidelidade real de dados) e `docker-image` (build da imagem, não-root, healthcheck).
3. **O E2E Playwright** do painel editorial manual.
4. **Os 8 arquivos de teste** que existem no repo (349) mas não são coletados por `vitest run` (341) — rodam sob configs separadas (`vitest.integration.config.ts` do CMS e do `news-ingestion`).
5. **O banco de produção e o volume real de dados** — deliberadamente intocado. Quantos títulos, matérias e usuários existem de fato é uma pergunta que esta auditoria **não** responde.
6. **Comportamento em runtime de produção** — deploy, agendamento de workers, branch protection no GitHub.

---

## 10. Síntese

**O código está saudável e à frente da sua própria documentação.**

A engenharia se sustenta sozinha: 4.404 testes sem nenhum pulado, cinco typechecks limpos, lint limpo, três auditorias de governança verdes, build funcionando, zero segredos versionados, contratos compartilhados nas fronteiras certas e imagens Docker que falham rápido e explicam o porquê. A ponte editorial — o ponto mais novo e mais arriscado da arquitetura — é justamente a que tem canário ponta a ponta em CI e travas de fronteira testadas.

O passivo real não é técnico, é **descritivo**. Os documentos que governam o projeto descrevem um sistema anterior ao que existe hoje: `CLAUDE.md` não mapeia o CMS editorial nem o pacote de contratos que o sustenta, e se contradiz sobre a camada de usuário; o `README.md` defende como "ausência intencional" uma feature já construída e anuncia um trilíngue que não tem rota. Como `CLAUDE.md` é carregado em toda sessão de agente e declara vencer conflitos, essa defasagem não é cosmética — **é a instrução que agentes futuros vão seguir**, e ela hoje descreve mal o próprio repositório.

O risco mais concreto para trabalho futuro é o **R1**: o ambiente local roda Node 24 contra um `engines` de Node 22, e há precedente registrado de verde falso nessa combinação. O CI em Node 22 continua sendo a única autoridade sobre "passa ou não passa".

---

### Anexo — Comandos executados

```bash
pnpm install --frozen-lockfile          # exit 0
pnpm --filter @screena/db db:generate   # Prisma Client v6.19.3
pnpm typecheck                          # exit 0
pnpm typecheck:web                      # exit 0
pnpm typecheck:admin                    # exit 0
pnpm typecheck:cms                      # exit 0
pnpm typecheck:catalog-runtime          # exit 0
pnpm lint                               # exit 0
pnpm test                               # 341 arquivos / 4.404 testes / 0 falhas
pnpm audit:invariants                   # 7 ok, 0 violações
pnpm audit:render                       # 2 ok, 0 violações
pnpm api:coverage                       # 7 ok, 0 violações
pnpm build                              # exit 0
```
