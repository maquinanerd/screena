# 00 — Estado do repositório e reprodução

> Documento de **baseline verificável**. Toda afirmação aqui foi produzida por execução real de
> comando ou leitura de arquivo neste repositório, e traz a evidência correspondente.
> Nada aqui é estimativa.

---

## 1. Ponto exato do baseline

| Item | Valor |
| --- | --- |
| Repositório | `https://github.com/maquinanerd/screena.git` (remote `origin`) |
| Ref auditada | `origin/main` |
| **SHA** | `73c58e908986e77e49d02226c5bb1b9b4a5fca53` |
| Commit | `feat(user): add user platform, authentication and transactional email runtime (#75)` |
| Branch desta etapa | `chore/baseline-00-technical-baseline` (criada a partir de `origin/main`) |
| Data da auditoria | 2026-07-23 |
| Árvore de trabalho | **limpa** (`git status --porcelain` vazio antes e depois da coleta) |

Comando de verificação:

```bash
git -C <checkout> fetch origin && git -C <checkout> rev-parse origin/main
```

### 1.1 Aviso crítico: o `main` local estava obsoleto

No checkout primário (`E:/Área de Trabalho 2/Screnaa`) o branch `main` local apontava para
`631004fda71d610276f5e6b034994ceea3e76d17` (PR #58). O `origin/main` real estava **47 commits à
frente**:

```
git rev-list --left-right --count main...origin/main
0	47
```

Quem auditar o `main` local audita um sistema que não existe mais: perde PRs #59 a #75, o
rebranding Screen → Cinerie (#72), o hotfix de produção (#73) e toda a plataforma de usuário (#75).
**Faça `git fetch` antes de qualquer leitura de baseline.**

### 1.2 Divergências não mergeadas no momento da auditoria

| Ref | Relação com `origin/main` | Situação |
| --- | --- | --- |
| `feat/data-governance-hardening` (checkout primário) | 7 commits à frente, 40 atrás | Contém **WIP não-commitado** da Fase 2 (4 arquivos modificados + 1 migration não rastreada). Não faz parte deste baseline. |
| PR #76 `audit/cinerie-full-diagnostic-2026-07-23` | aberto (draft) | Única PR aberta no momento da auditoria. |
| 20 worktrees git ativos | — | Ver `git worktree list`. Vários apontam para branches já mergeadas. |

O baseline foi levantado num **worktree isolado** (`E:/screena-wt/baseline-00`) criado a partir de
`origin/main`, justamente para não tocar o WIP protegido do checkout primário.

---

## 2. Versões de runtime

| Componente | Exigido pelo repo | Usado nesta auditoria | Fonte |
| --- | --- | --- | --- |
| Node | `>=22 <23` | **v24.14.0** ⚠️ | `package.json:10` (`engines.node`) |
| pnpm | `>=9.15.4 <10` | 9.15.4 ✅ | `package.json:11` |
| Node (CI) | 22 | 22 | `.github/workflows/ci.yml:26` |
| Node (imagem Docker) | `node:22-bookworm-slim` | — | `Dockerfile:1` |
| TypeScript | `^5.6.0` (resolvido 5.9.3) | 5.9.3 | `package.json:37` |
| Next.js | — (resolvido 15.5.19) | 15.5.19 | saída de `pnpm build` |
| Prisma | `^6.1.0` (resolvido 6.19.3) | 6.19.3 | saída de `prisma generate` |
| Vitest | `^2.1.0` (resolvido 2.1.9) | 2.1.9 | `package.json:38` |
| PostgreSQL | 16 | 16 (efêmero, `embedded-postgres@16.14.0-beta.17`) | `packages/db/package.json:31` |

> ⚠️ **Divergência de runtime (risco P1, ver `08-riscos.md` R-08).** Toda execução local desta
> auditoria emitiu `WARN Unsupported engine: wanted {"node":">=22 <23"} (current: v24.14.0)`.
> Tudo passou mesmo assim, mas o baseline **não prova** o comportamento sob Node 22 nesta máquina —
> quem reproduzir deve usar Node 22 para igualar CI e produção.

---

## 3. Banco de dados esperado

| Item | Valor | Fonte |
| --- | --- | --- |
| Motor | PostgreSQL 16 | `docker-compose.dev.yml:3` (`postgres:16-alpine`) |
| Variável de conexão | `DATABASE_URL` | `.env.example:13` |
| Base de desenvolvimento | `screena` (usuário `screena`) | `docker-compose.dev.yml:7-8` |
| Extensão obrigatória | `pgcrypto` **no schema `public`** | `Dockerfile:69` (mensagem fatal), validado por `db:validate:pgcrypto` |
| Migrations | 12, aplicadas por `prisma migrate deploy` | `packages/db/prisma/migrations/` |
| Aplicação das migrations | **no boot do contêiner** | `Dockerfile:69` |

O nome de banco/usuário permanece `screena` (namespace técnico legado) mesmo após o rebranding
para Cinerie — ver `12-divergencias-doc-codigo.md`.

---

## 4. Reprodução do ambiente — sequência exata

Executada integralmente nesta auditoria, em ambiente limpo (worktree novo, sem `node_modules`):

```bash
git clone https://github.com/maquinanerd/screena.git
cd screena
git checkout 73c58e908986e77e49d02226c5bb1b9b4a5fca53
corepack enable && corepack prepare pnpm@9.15.4 --activate
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @screena/db db:generate
```

Nenhum passo exige banco de dados, credencial ou rede além do registry npm.
Os validadores de PostgreSQL sobem um Postgres 16 **efêmero** por conta própria
(`embedded-postgres`), sem Docker e sem banco global.

### 4.1 Bateria completa de validação

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm typecheck:catalog-runtime
corepack pnpm test
corepack pnpm audit:invariants
corepack pnpm audit:render
corepack pnpm api:coverage
corepack pnpm build
corepack pnpm --filter @screena/web validate:all
corepack pnpm --filter @screena/db db:validate:real
corepack pnpm --filter @screena/db db:validate:upgrade
corepack pnpm --filter @screena/db db:validate:user-persistence
corepack pnpm --filter @screena/db db:validate:pgcrypto
corepack pnpm --filter @screena/streaming validate:stores
corepack pnpm --filter @screena/web validate:seo-runtime
corepack pnpm --filter @screena/web validate:season-episode-routes
corepack pnpm --filter @screena/ingestion validate:tmdb-platform
corepack pnpm --filter @screena/ingestion validate:catalog-platform-complete
corepack pnpm validate:external-intelligence-platform
corepack pnpm validate:external-intelligence-product
corepack pnpm validate:source-authorization-and-attribution
corepack pnpm --filter @screena/user-platform validate:user-product
```

Resultados reais de cada comando: ver [`11-validacao-execucoes.md`](11-validacao-execucoes.md).

---

## 5. O que este baseline NÃO prova

Registrado explicitamente para que ninguém leia mais do que foi medido:

1. **Não há contagem de catálogo de produção.** Nenhum banco populado foi acessado. O seed do
   repositório insere **zero** filmes/séries/pessoas — ver [`10-catalogo-contagens.md`](10-catalogo-contagens.md).
2. **Nenhuma API externa foi chamada.** TMDB, RapidAPI, Brevo e Gemini não foram exercitados com
   credencial real; o que está provado é o *contrato* e o *isolamento* deles, não a integração viva.
3. **Não há teste E2E de navegador.** Não existe Playwright/Cypress no repositório
   (ver [`11-validacao-execucoes.md`](11-validacao-execucoes.md) §4). O smoke test executado é
   HTTP real contra o build de produção, não automação de UI.
4. **Não foi validado sob Node 22** nesta máquina (ver §2).
5. **Rollback de banco não foi exercitado contra dump real** — ver [`13-rollback.md`](13-rollback.md).
