# TRIAGEM DE BRANCHES — 2026-07-31

Análise somente-leitura sobre refs atualizadas (`git fetch origin --prune` executado no início).
Base de comparação: `origin/main` = `953696a` (test(editorial): canário ponta a ponta… #99).

## 1. Resumo executivo

1. **Quase nada de trabalho real está fora da `main`.** Das 75 branches analisadas (39 remotas + 36 locais-only), **apenas 1 tem código real não integrado**: `feat/cms-editorial-ui` (PR #94 OPEN, 7 arquivos em `apps/cms`, +892/−2, merge limpo).
2. **`feat/final-frontend-cinerie` JÁ ESTÁ NA MAIN.** Foi mergeada como PR #88 em 2026-07-28 (squash `c3bb632`). A árvore do tip `bae6c75` é **bit a bit idêntica** à árvore do commit de squash que está na história da `main` (`git rev-parse bae6c75^{tree}` == `git rev-parse c3bb632^{tree}`). Re-mergear não resolve nada e seria regressão.
3. O critério do diff três-pontos precisou de um complemento: para branch **squash-mergeada**, `git diff origin/main...branch` também **super-reporta** (o merge-base é antigo), então o teste decisivo usado foi **árvore do tip == árvore do commit de squash na main**. 39 das 41 PRs mergeadas com branch viva passaram nesse teste exato; as 2 restantes (#49, #99) foram provadas integradas por comparação de blobs.
4. O trabalho realmente em risco era **não-commitado**: a migration `20260715150000_editorial_operations_platform` (existia num único lugar do mundo) e mais 369 arquivos foram **copiados para `E:\backup-worktrees-2026-07-31\`** (370 arquivos, 268 MB, MD5 da migration conferido).
5. **Nenhuma worktree órfã** — as 36 registradas apontam para pastas existentes.
6. O sujo da `completion-08` (11 arquivos) é **ruído de fim de linha (LF→CRLF)** — `git diff` de conteúdo vazio. Sem risco de sobreposição com as telas de auth da #88.
7. ~30 branches são podáveis com prova forte; a lista com comandos está na seção 7.
8. Se produção ainda mostra "casca em branco", o problema é **deploy**, não branch — a `main` de hoje tem o frontend completo (54 ocorrências de `<img` em `apps/web/**/*.tsx`). Estado de produção: NÃO VERIFICADO nesta sessão (acesso HTTP negado).

## 2. Backup (Parte 0)

**Destino:** `E:\backup-worktrees-2026-07-31\` — **370 arquivos, 268 MB**, estrutura de diretórios preservada, `node_modules/.next/dist/build` excluídos. Nada foi commitado, movido ou apagado.

| Pasta de backup | Worktree de origem | Branch | Existe no origin? | Arquivos copiados |
| --- | --- | --- | --- | --- |
| `Screnaa-main-checkout` | `E:\Área de Trabalho 2\Screnaa` | `feat/data-governance-hardening` | **NÃO** | 350 (4 modificados: `packages/db/prisma/schema.prisma`, `prisma/seed.ts`, `scripts/validate-real-postgres.ts`, `src/seed-data.ts`; ~346 não rastreados: skills `.agents/`/`.claude/`/`.codex/`, 1 zip de design) |
| `completion-08` | `E:\screena-wt\completion-08` | `feat/completion-08-lists-tracker-import` | sim | 11 (todas EOL-only — diff de conteúdo vazio) |
| `editorial-operations-platform` | `E:\screena-wt\editorial-operations-platform` | `feat/editorial-operations-platform` | **NÃO** | 3, incluindo **`packages/db/prisma/migrations/20260715150000_editorial_operations_platform/migration.sql`** (7.977 bytes, MD5 `676e502f…` idêntico ao original) |
| `final-frontend` | `E:\screena-wt\final-frontend` | `feat/final-frontend-cinerie` | sim | 1 (`.claude/launch.json`, trivial) |
| `frosty-mcnulty-30a2f7` | `.claude/worktrees/frosty-mcnulty-30a2f7` | `claude/cinerie-catalog-architecture-400821` | **NÃO** | 4 (docs de auditoria `docs/audits/CINERIE_*_2026-07-30.md`) |
| `project-technical-audit-5b8ddb` | `.claude/worktrees/project-technical-audit-5b8ddb` | `claude/project-technical-audit-5b8ddb` | **NÃO** | 1 (`docs/AUDITORIA-TECNICA-2026-07-31.md`) |

### Comandos que VOCÊ deve rodar para preservar em git (não executados)

**Crítico — a migration órfã** (`feat/editorial-operations-platform` não tem nenhum commit próprio; o valor da branch é só esse trio não commitado):

```bash
cd /e/screena-wt/editorial-operations-platform && git add packages/db/prisma/migrations/20260715150000_editorial_operations_platform/migration.sql packages/db/prisma/schema.prisma packages/db/src/seed-data.ts && git commit -m "wip(db): editorial operations platform — migration + schema + seed (resgate)" && git push -u origin feat/editorial-operations-platform
```

**Checkout principal** (WIP de banco protegido; adicionar só os 4 modificados — nunca `git add -A`, nunca versionar `.claude/`):

```bash
cd "/e/Área de Trabalho 2/Screnaa" && git add packages/db/prisma/schema.prisma packages/db/prisma/seed.ts packages/db/scripts/validate-real-postgres.ts packages/db/src/seed-data.ts && git commit -m "wip(db): data governance hardening — snapshot de resgate" && git push -u origin feat/data-governance-hardening
```

**Docs de auditoria (frosty-mcnulty):**

```bash
cd "/e/Área de Trabalho 2/Screnaa/.claude/worktrees/frosty-mcnulty-30a2f7" && git add docs/audits/ && git commit -m "docs(audit): snapshots de auditoria 2026-07-30" && git push -u origin claude/cinerie-catalog-architecture-400821
```

**Auditoria técnica de 31/07:**

```bash
cd "/e/Área de Trabalho 2/Screnaa/.claude/worktrees/project-technical-audit-5b8ddb" && git add docs/AUDITORIA-TECNICA-2026-07-31.md && git commit -m "docs(audit): auditoria tecnica 2026-07-31" && git push -u origin claude/project-technical-audit-5b8ddb
```

Não gerei comando para `completion-08` (diff de conteúdo vazio — só EOL) nem para `final-frontend` (`.claude/launch.json` é config local de ferramenta).

## 3. Inventário

### Worktrees (36 — nenhuma órfã; todas as pastas existem)

| Worktree | Branch | Suja? |
| --- | --- | --- |
| `E:\Área de Trabalho 2\Screnaa` (principal) | `feat/data-governance-hardening` (local-only) | **350 itens** |
| `E:\screena-manual-editorial` | `claude/cinerie-manual-editorial-readiness` | limpa |
| `E:\screena-wt\api-coverage-registry` | `feat/api-coverage-registry` | limpa |
| `E:\screena-wt\backend-catalog-platform` | `feat/backend-catalog-platform` | limpa |
| `E:\screena-wt\baseline-00` | `chore/baseline-00-technical-baseline` | limpa |
| `E:\screena-wt\cinerie-full-audit` | `audit/cinerie-full-diagnostic-2026-07-23` | limpa |
| `E:\screena-wt\completion-01…04, 07, 10` (7 worktrees) | branches `completion-*` | limpas |
| `E:\screena-wt\completion-08` | `feat/completion-08-lists-tracker-import` | 11 (EOL-only) |
| `E:\screena-wt\data-governance` | `feat/data-governance-hardening-v2` | limpa |
| `E:\screena-wt\editorial-operations-platform` | `feat/editorial-operations-platform` (local-only) | **3 (migration!)** |
| `E:\screena-wt\external-data-intelligence-platform` | `feat/external-data-intelligence-platform` | limpa |
| `E:\screena-wt\external-intelligence` | `feat/external-intelligence-product` | limpa |
| `E:\screena-wt\final-frontend` | `feat/final-frontend-cinerie` | 1 (launch.json) |
| `E:\screena-wt\gate-1.5-cinerie`, `prod-hotfix`, `season-episode-routes`, `seo`, `seo-runtime-v2`, `tmdb-complete-catalog`, `user-product-platform` | respectivas | limpas |
| `E:\Área de Trabalho 2\screen-audit-reset`, `screen-home-fidelity-fix`, `screen-home-pixel-parity`, `screen-ux-polish` | respectivas | limpas |
| `.claude/worktrees/*` (10 worktrees de sessão) | respectivas | frosty-mcnulty: 4 docs; project-technical-audit: 1 doc; demais limpas |

### Branches

- **39 remotas** (além de `origin/main`) e **36 locais sem contraparte no origin** (marcadas `SÓ LOCAL` na tabela da seção 4).
- `gh` disponível e autenticado (`maquinanerd`). **99 PRs** no histórico: 92 MERGED, 4 CLOSED sem merge (#60, #64, #79 — e #79 tem v2 mergeada; #60/#64 superadas), **3 OPEN: #76 (docs de auditoria), #77 (docs de baseline), #94 (`feat/cms-editorial-ui` — código real)**.

## 4. Triagem por conteúdo real (Parte 2)

**Método.** O diff três-pontos foi coletado para todas as branches, mas ele **também super-reporta em branch squash-mergeada** (o merge-base fica antigo, então o diff mostra o conteúdo da branch mesmo já integrado — ex.: `feat/user-product-platform` exibe 211 arquivos e está 100% na main). O critério decisivo foi:

- `git rev-parse <tip>^{tree}` == `git rev-parse <squash-commit>^{tree}` e squash ancestral de `origin/main` → **JÁ NA MAIN** (integração 1:1 provada).
- Diff três-pontos vazio → JÁ NA MAIN (tip é ancestral).
- Casos restantes: comparação blob a blob contra `origin/main`.

Tabela completa (ordenada por arquivos no três-pontos; colunas de path = contagem de arquivos):

| Branch | Cherry | Arq. | +lin | −lin | web | db | cms | docs | Merge limpo? | Último commit | Veredito |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| feat/user-product-platform | 45 | 211 | 37751 | 33 | 11 | 7 | 0 | 9 | conflito | 2026-07-22 | **JÁ NA MAIN** (#75, tree==squash) |
| claude/frosty-mcnulty-30a2f7 | 31 | 156 | 25149 | 27 | 0 | 7 | 0 | 5 | conflito | 2026-07-21 | **JÁ NA MAIN** (superada) SÓ LOCAL¹ |
| feat/final-frontend-cinerie | 27 | 95 | 16226 | 1710 | 74 | 1 | 0 | 1 | conflito | 2026-07-28 | **JÁ NA MAIN** (#88, tree==squash) |
| feat/completion-08-lists-tracker-import | 10 | 92 | 13055 | 16 | 38 | 0 | 0 | 3 | conflito | 2026-07-27 | **JÁ NA MAIN** (#86) |
| feat/rapidapi-ratings-streaming-offline | 2 | 81 | 8042 | 12 | 1 | 0 | 0 | 5 | conflito | 2026-07-10 | **JÁ NA MAIN** (#50) SÓ LOCAL |
| feat/public-frontend-final-polish | 3 | 79 | 5454 | 1901 | 64 | 0 | 0 | 5 | conflito | 2026-07-14 | **ABANDONADA** (PR #60 CLOSED sem merge; estratégia substituída por #61/#62/#88) SÓ LOCAL |
| feat/external-intelligence-product | 13 | 79 | 9204 | 47 | 4 | 0 | 0 | 13 | conflito | 2026-07-17 | **JÁ NA MAIN** (#74) |
| backup/rebrand-screen-docs-original | 2 | 78 | 865 | 409 | 2 | 0 | 0 | 47 | conflito | 2026-07-01 | **SNAPSHOT pré-rebase** (#20 mergeada rebased) SÓ LOCAL |
| feat/completion-07-identity-privacy | 7 | 69 | 7811 | 66 | 0 | 0 | 0 | 2 | conflito | 2026-07-24 | **JÁ NA MAIN** (#85) |
| feat/web-canonical-cinematic-port | 11 | 63 | 10363 | 2459 | 44 | 0 | 0 | 4 | conflito | 2026-07-14 | **JÁ NA MAIN** (#61; depois revertida por `f242708` e refeita por #88) |
| feat/completion-10-editorial-news | 5 | 57 | 8058 | 2449 | 3 | 0 | 0 | 2 | conflito | 2026-07-27 | **JÁ NA MAIN** (#87) |
| feat/seo-runtime-source-of-truth-v2 | 12 | 45 | 3280 | 485 | 0 | 0 | 0 | 1 | conflito | 2026-07-15 | **JÁ NA MAIN** (#66) |
| backup/pre-rebase-completion-02 | 4 | 33 | 1486 | 397 | 0 | 0 | 0 | 7 | conflito | 2026-07-23 | **JÁ NA MAIN** (árvore == #79, cujo conteúdo == v2 #80 mergeada) SÓ LOCAL |
| fix/completion-02-operations-proof (origin) | 4 | 33 | 1486 | 397 | 0 | 0 | 0 | 7 | conflito | 2026-07-23 | **JÁ NA MAIN** (#79 CLOSED; `git diff` contra v2 mergeada = vazio) |
| feat/tmdb-complete-catalog-coverage | 12 | 31 | 3876 | 37 | 3 | 0 | 0 | 5 | conflito | 2026-07-15 | **JÁ NA MAIN** (#69) |
| feat/data-governance-hardening-v2 | 10 | 26 | 2247 | 276 | 7 | 0 | 0 | 1 | conflito | 2026-07-15 | **JÁ NA MAIN** (#65) |
| claude/home-header-hero-fixes-76c7f0 | 2 | 24 | 2683 | 87 | 16 | 0 | 0 | 2 | conflito | 2026-07-28 | **JÁ NA MAIN** (#89) |
| fix/home-editorial-highlights-ticker-carousel | 3 | 24 | 4294 | 374 | 16 | 0 | 0 | 3 | limpo | 2026-07-28 | **JÁ NA MAIN** (#91) |
| feat/seo-runtime-source-of-truth | 1 | 23 | 1663 | 185 | 11 | 0 | 0 | 1 | conflito | 2026-07-15 | **ABANDONADA** (PR #64 CLOSED; v2 mergeada #66) |
| feat/completion-03-1-catalog-operations | 5 | 22 | 2904 | 4 | 0 | 0 | 0 | 2 | conflito | 2026-07-23 | **JÁ NA MAIN** (#82) |
| feat/completion-03-catalog-bootstrap | 6 | 20 | 1795 | 52 | 0 | 0 | 0 | 3 | conflito | 2026-07-23 | **JÁ NA MAIN** (#81) |
| feat/completion-04-licensed-intelligence | 1 | 20 | 1747 | 5 | 13 | 0 | 0 | 3 | conflito | 2026-07-23 | **JÁ NA MAIN** (#84) |
| fix/completion-01-engineering-gates | 1 | 20 | 349 | 390 | 4 | 0 | 0 | 4 | conflito | 2026-07-23 | **JÁ NA MAIN** (#78) |
| feat/external-data-intelligence-platform | 2 | 17 | 476 | 5 | 0 | 0 | 0 | 3 | conflito | 2026-07-15 | **JÁ NA MAIN** (#70) |
| feat/entity-detail-listing-density | 1 | 16 | 799 | 110 | 12 | 0 | 0 | 0 | conflito | 2026-07-13 | **JÁ NA MAIN** (#56) SÓ LOCAL |
| chore/baseline-00-technical-baseline | 1 | 16 | 2213 | 0 | 0 | 0 | 0 | 16 | **limpo** | 2026-07-23 | **SÓ DOCS** (PR #77 OPEN) |
| feat/public-season-episode-routes | 7 | 16 | 1897 | 24 | 12 | 0 | 0 | 1 | conflito | 2026-07-15 | **JÁ NA MAIN** (#67) |
| feat/streaming-watch-availability-promotion | 2 | 15 | 2092 | 0 | 0 | 0 | 0 | 1 | conflito | 2026-07-14 | **JÁ NA MAIN** (#59) SÓ LOCAL |
| feat/seo-entity-first-baseline | 2 | 14 | 409 | 15 | 8 | 0 | 0 | 0 | conflito | 2026-07-13 | **JÁ NA MAIN** (#55) SÓ LOCAL |
| fix/completion-02-operations-proof-v2 | 3 | 14 | 1137 | 7 | 5 | 0 | 0 | 3 | conflito | 2026-07-23 | **JÁ NA MAIN** (#80) |
| fix/completion-03-2-catalog-integrity | 3 | 14 | 1202 | 30 | 0 | 0 | 0 | 2 | conflito | 2026-07-23 | **JÁ NA MAIN** (#83) |
| fix/canonical-slug-redirect | 1 | 13 | 301 | 73 | 4 | 0 | 0 | 0 | conflito | 2026-07-09 | **JÁ NA MAIN** (#49; núcleo blob-idêntico na main — `canonical-redirect.ts`, `public-catalog-slug.ts` + testes; squash `769c6b3` ancestral da main; divergências = evolução posterior da main) SÓ LOCAL |
| feat/api-coverage-registry | 1 | 12 | 2045 | 0 | 0 | 0 | 0 | 6 | conflito | 2026-07-15 | **JÁ NA MAIN** (#68) |
| feat/data-governance-hardening | 7 | 11 | 236 | 35 | 9 | 0 | 0 | 2 | conflito | 2026-07-14 | **JÁ NA MAIN** (tip `508fa72` == tip de `chore/align-post-reset-validation-contracts`, #63 mergeada) SÓ LOCAL — **valor está no WIP não commitado, ver Parte 0** |
| chore/align-post-reset-validation-contracts | 7 | 11 | 236 | 35 | 9 | 0 | 0 | 2 | conflito | 2026-07-14 | **JÁ NA MAIN** (#63) |
| fix/claude-design-home-pixel-parity | 3 | 9 | 1853 | 195 | 9 | 0 | 0 | 0 | conflito | 2026-07-03 | **OBSOLETA** (sem PR; altera `home-v4-*.tsx` que não existem mais na main — frontend refeito por #88) |
| fix/cinerie-automation-draft-body | 1 | 7 | 1474 | 34 | 0 | 0 | 7 | 0 | limpo | 2026-07-31 | **JÁ NA MAIN** (#98) SÓ LOCAL |
| **feat/cms-editorial-ui** | 7 | **7** | **892** | **2** | 0 | 0 | 7 | 0 | **limpo** | 2026-07-30 | **TRABALHO REAL** (PR #94 OPEN) |
| fix/claude-design-home-fidelity | 1 | 7 | 1359 | 195 | 7 | 0 | 0 | 0 | conflito | 2026-07-03 | **OBSOLETA** (sem PR; mesma razão da pixel-parity) |
| claude/cinerie-readiness-bug-65e8d0 | 1 | 5 | 272 | 5 | 0 | 0 | 0 | 1 | limpo | 2026-07-30 | **JÁ NA MAIN** (#97) SÓ LOCAL |
| backup/fase-5c-screen-ux-polish-before-rebase | 1 | 4 | 417 | 116 | 4 | 0 | 0 | 0 | conflito | 2026-07-02 | **SNAPSHOT pré-rebase** (#21 mergeada rebased) SÓ LOCAL |
| pr99-work | 2 | 3 | 848 | 1 | 2 | 0 | 0 | 0 | limpo | 2026-07-31 | **JÁ NA MAIN** (`git diff --quiet origin/main pr99-work` → árvore idêntica) SÓ LOCAL |
| test/harden-honest-ui-guards | 1 | 3 | 34 | 2 | 1 | 0 | 0 | 0 | conflito | 2026-07-13 | **JÁ NA MAIN** (#54) SÓ LOCAL |
| fix/film-show-ratings-real-payload | 1 | 2 | 359 | 23 | 0 | 0 | 0 | 0 | conflito | 2026-07-10 | **JÁ NA MAIN** (#51) SÓ LOCAL |
| audit/cinerie-full-diagnostic-2026-07-23 | 1 | 2 | 1245 | 0 | 0 | 0 | 0 | 1 | limpo | 2026-07-23 | **SÓ DOCS** (PR #76 OPEN) |
| test/cinerie-editorial-entity-link-canary | 1 | 2 | 687 | 1 | 2 | 0 | 0 | 0 | conflito | 2026-07-31 | **JÁ NA MAIN** (#99; tip local é anterior ao merge — a main tem versão evoluída, +174 linhas no canário) SÓ LOCAL |
| docs/project-status-2026-07-02 | 1 | 1 | 148 | 0 | 0 | 0 | 0 | 1 | limpo | 2026-07-02 | **SÓ DOCS** (status antigo, nunca PR) SÓ LOCAL |
| claude/home-fold-report-consistency | 1 | 1 | 199 | 48 | 0 | 0 | 0 | 1 | limpo | 2026-07-28 | **JÁ NA MAIN** (#90) |
| 27 branches com diff três-pontos **vazio**² | 0 | 0 | 0 | 0 | — | — | — | — | limpo | várias | **JÁ NA MAIN** (tip ancestral/idêntico) |

¹ `claude/frosty-mcnulty-30a2f7`: linhagem antiga do Backend C. Prova de superação: 124/156 arquivos com blob idêntico ao da `origin/main`; os 2 commits que não estão em `feat/user-product-platform` (`8ab7a7a`, `455dce0` — conflitos não-abortivos C7B1.1) têm o conteúdo presente na main em **versão evoluída** (`services/user-platform/src/persistence/prisma/identity-conflict.ts` existe na main com comentário refinado; `error-mapping.ts` foi removido na main como na branch; padrão `ON CONFLICT` presente).

² Diff vazio: `chore/audit-and-reset-public-design`, `claude/cinerie-editorial-connections-e16b6b`, `claude/cinerie-manual-editorial-readiness`, `claude/cms-expose-service-accounts`, `feat/backend-catalog-platform`, `feat/gate-1.5-cinerie-rebranding`, `fix/cinerie-production-hotfix`, `fix/cms-easypanel-runtime-secrets` (remotas); `claude/audit-documents-research-64107d`, `claude/cinerie-catalog-architecture-400821`, `claude/cinerie-easypanel-readiness`, `claude/cinerie-editorial-media-projection`, `claude/cinerie-editorial-v2-ff67ef`, `claude/cinerie-editorial-workflow-f4c3f6`, `claude/cinerie-manual-editorial-readiness-3a55a1`, `claude/cinerie-manual-editorial-readiness-a8fc11`, `claude/cinerie-mnscr-auto-publication-seo`, `claude/cinerie-payload-foundation`, `claude/cinerie-plano-definitivo-dba625`, `claude/cinerie-publication-projection`, `claude/consolidate-audit-docs-42baff`, `claude/final-frontend-cinerie-5faaf0`, `claude/home-primeira-dobra-relatorio-531524`, `claude/pr-99-canary-editorial-3911d0`, `claude/project-technical-audit-5b8ddb`, `claude/screena-branch-analysis-0e7ba9` (atual), `feat/editorial-operations-platform` (locais).

### Síntese da triagem

- **Trabalho real fora da main (código):** só `feat/cms-editorial-ui` (PR #94).
- **Só docs abertas:** PR #76 (2 arquivos), PR #77 (16 arquivos), `docs/project-status-2026-07-02` (local, 1 arquivo).
- **Conflitam com a main hoje** (merge-tree exit ≠ 0): todas as squash-mergeadas antigas — irrelevante, pois já integradas; das vivas, **#94 aplica limpo**.
- **Worktrees órfãs:** nenhuma.
- **Poda:** seção 7.

## 5. Dossiê — `feat/final-frontend-cinerie` (Parte 3)

**Resposta direta: a branch JÁ FOI MERGEADA.** PR #88 "feat(frontend): conclusao total do frontend canonico Cinerie (telas 01-18)", merged em 2026-07-28T11:34Z, squash `c3bb632`. Prova de integração 1:1: `git rev-parse bae6c75^{tree}` == `git rev-parse c3bb632^{tree}` e `c3bb632` é ancestral de `origin/main`.

**1. Commits** (`git log origin/main..origin/feat/final-frontend-cinerie` — 27 commits, todos de Pablo Eduardo, 27–28/07): fundação visual do design canônico (`d36b3ea`); telas públicas home/listagens/detalhes (`2629f0b`); editorial/busca/explorar + guards (`4e064cc`); fidelidade das telas 02/06 (`531059a`), 04 (`fa05464`), 03/07 (`8a90b60`); artigo 05 (`7194cd4`); pessoa 09 (`545ce4b`); onde assistir 10 (`daa2a3d` + estado honesto `e576408`); explorar 11 (`f933eec`); mais aguardados 12 (`eb5c8d3`); configurações 13 (`18f9572`); dados/importação 14 (`a3228c5`); listas 15 (`a9cfd71`); entrar/cadastrar 16 (`ba54017`); anúncios 17/18 (`2e8f807`); responsive série mobile (`19d03ec`); QA visual (`9f378af`, `4f4567d`); a11y WCAG 2.2 AA (`cc9e77b`); correções funcionais de listas (`1cb42e3`); lint/guards (`be1ef6c`); limpeza CSS (`a385ed5`); docs D-101..D-113 (`5a3bc07`, `aa2b750`); correção adversarial M1/M2 (`bae6c75`).

**2. Diff** (três-pontos vs merge-base `812417a` = #87; número é o que a branch entregou À ÉPOCA, não o que falta hoje — hoje falta **zero**): 95 arquivos, +16.226/−1.710. Por diretório: `apps/web` 74 arquivos (+15.485/−1.554); `packages/ui` **0**; `packages/seo` **0**.

**3. Camada visual de verdade? Sim — e ela está na main.** `origin/main` hoje: 54 ocorrências `<img` em `apps/web/**/*.tsx` e `next/image` em 1 arquivo; a branch tinha 53. A linha do tempo do "reset": `df0a89c` (port canônico, #61, 14/07) e `f242708` ("reset public visual layer to blank shell", 14/07) **estão ambos na história da main** — o diagnóstico de 23/07 caiu exatamente na janela entre o reset (#62) e o merge da #88 (28/07). Depois vieram ainda #89 (primeira dobra) e #91 (destaques/ticker) por cima.

**4. Relação com `feat/web-canonical-cinematic-port`:** trabalhos em sequência, não aninhados. O port (#61, 63 arquivos) foi mergeado e **revertido** por `f242708`; a `final-frontend` **não contém** os commits do port (`git merge-base --is-ancestor` → NÃO) e refez a camada do zero a partir do merge-base `812417a` (#87). 27 arquivos de path em comum entre os dois diffs. Nenhum dos dois tem pendência: ambos integrados historicamente, o resultado vigente é o da #88+#89+#91.

**5. Aplica limpo hoje? NÃO** — `git merge-tree --write-tree origin/main origin/feat/final-frontend-cinerie` exit 1, 17 arquivos em conflito (`home-hero-carousel.tsx`, `home-like.tsx`, `home-ticker.tsx`, `site-header/footer.tsx`, `globals.css`, `pt/page.tsx`, `pt/filmes|series/page.tsx`, `pt/noticias/[slug]/page.tsx`, `src/server/home-ticker.ts`, `news-pages.ts`, `packages/db/src/server.ts`, `pnpm-lock.yaml`, 3 testes). Natureza: a main **evoluiu por cima** do conteúdo da branch (#89/#91/#95). Re-mergear seria regressão — não fazer.

**6. Branding stale no que ela adiciona:** 2 ocorrências, ambas comentário/caminho, nenhuma identidade ativa: `apps/web/app/pt/entrar/auth-shell.tsx:11` (`"THE SCREEN" — rebranding Gate 1.5 aplica a identidade vigente` — referência histórica explicando o rebranding; presente na main hoje na mesma linha) e `apps/web/app/globals.css:4` (caminho `docs/design-handoff/Screena-Design-System-Final-Handoff/` — namespace técnico legado, permitido). Nada de Telona/Telarium/`thescreen.media` em linha adicionada.

**7. Páginas de auth:** sim — a branch tocou `pt/criar-conta` (page + signup-form), `pt/entrar` (page + auth-shell + login-form), `pt/recuperar-senha`, `pt/redefinir-senha`, `pt/verificar-email`. **Risco de sobreposição com `completion-08`: nulo** — os 11 arquivos "modificados" naquela worktree têm `git diff` de conteúdo **vazio** (apenas aviso LF→CRLF; artefato de fim de linha do checkout Windows).

**8. Gates:** os checks da PR #88 concluíram SUCCESS ("Typecheck, lint, test, auditorias e build publico", "Backup + restore real (PostgreSQL 16)", "Imagem Docker real"). Build da branch isolada hoje: NÃO VERIFICADO (desnecessário — árvore idêntica já buildada e mergeada).

**Veredito (5 linhas):** Mergear essa branch **não resolve nada, porque já foi mergeada** — o conteúdo do tip `bae6c75` está integrado 1:1 na main via squash `c3bb632` (PR #88, 28/07). O problema da casca em branco de 23/07 **já está resolvido no repositório**: a main atual contém as 18 telas, 54 tags de imagem em `apps/web` e os refinamentos de #89/#91. Se produção ainda exibe casca em branco, a causa é **deploy defasado**, não branch pendente (estado de produção: NÃO VERIFICADO nesta sessão). Tentar re-mergear geraria 17 conflitos e regressão. A branch e a worktree `final-frontend` podem ser podadas.

## 6. Ordem de merge (Parte 4)

Não existe fila de merges de produto: o frontend, o backend C, o editorial e o CMS já estão na main. Sobrou 1 PR de código + 2 de docs + resgates da Parte 0.

| # | Branch | O que entrega | Tamanho | Conflita com | Depende de | Risco | Ordem |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | (resgate Parte 0) `feat/editorial-operations-platform` + WIP do checkout principal | migration/schema/seed de operações editoriais; WIP de data governance | 3 + 4 arquivos | — (só commit/push, sem merge) | decisão humana (regra: schema/migration só em tarefa aprovada) | alto se perder; baixo se preservar | **antes de tudo (preservação, não merge)** |
| 1 | `feat/cms-editorial-ui` (PR #94) | redesign do admin editorial do CMS Payload | 7 arquivos, +892/−2, só `apps/cms` | nada (merge-tree limpo) | — | baixo | **1º** — gates: `pnpm typecheck && pnpm lint && pnpm test` + suíte E2E do CMS no CI (o guard do harness CMS tem flake conhecido; correlacionar posição do passo antes de culpar o diff) |
| 2 | `chore/baseline-00-technical-baseline` (PR #77) | 16 docs de baseline | +2213, só docs | nada (limpo) | decisão humana: ainda reflete a realidade? (escrito em 23/07, pré-#88) | nulo p/ código; médio p/ veracidade | 2º ou fechar |
| 3 | `audit/cinerie-full-diagnostic-2026-07-23` (PR #76) | 2 docs de diagnóstico datado | +1245, só docs | nada (limpo) | idem — o diagnóstico descreve a casca em branco que já foi resolvida; mergear só como registro histórico datado | nulo/médio | 3º ou fechar |

- **Onda 1 (site com cara de produto):** vazia — **já entregue na main** (#88, #89, #91, #95–#99). A ação de Onda 1 é operacional: **conferir o deploy de produção contra `main@953696a`** (fora do escopo desta sessão).
- **Onda 2:** PR #94; depois decisão sobre #77/#76 (mergear como registro ou fechar); resgates da Parte 0 viram PRs próprios quando houver tarefa aprovada (migration = mexer em banco).
- **Poda:** seção 7.

## 7. Lista de poda (comandos NÃO executados)

Antes de podar: rodar os comandos de preservação da Parte 0 (seção 2). A poda de worktree é com você — esta sessão não roda `git worktree remove/prune`.

**Remotas já integradas 1:1 (apagar no origin):**

```bash
git push origin --delete chore/align-post-reset-validation-contracts chore/audit-and-reset-public-design claude/cinerie-editorial-connections-e16b6b claude/cinerie-manual-editorial-readiness claude/cms-expose-service-accounts claude/home-fold-report-consistency claude/home-header-hero-fixes-76c7f0 feat/api-coverage-registry feat/backend-catalog-platform feat/completion-03-1-catalog-operations feat/completion-03-catalog-bootstrap feat/completion-04-licensed-intelligence feat/completion-07-identity-privacy feat/completion-08-lists-tracker-import feat/completion-10-editorial-news feat/data-governance-hardening-v2 feat/external-data-intelligence-platform feat/external-intelligence-product feat/final-frontend-cinerie feat/gate-1.5-cinerie-rebranding feat/public-season-episode-routes feat/seo-runtime-source-of-truth-v2 feat/tmdb-complete-catalog-coverage feat/user-product-platform feat/web-canonical-cinematic-port fix/cinerie-production-hotfix fix/cms-easypanel-runtime-secrets fix/completion-01-engineering-gates fix/completion-02-operations-proof fix/completion-02-operations-proof-v2 fix/completion-03-2-catalog-integrity fix/home-editorial-highlights-ticker-carousel
```

**Remotas abandonadas/obsoletas (PR fechada sem merge ou base destruída):**

```bash
git push origin --delete feat/seo-runtime-source-of-truth fix/claude-design-home-fidelity fix/claude-design-home-pixel-parity
```

**Locais já integradas / árvore idêntica à main:**

```bash
git branch -D backup/pre-rebase-completion-02 claude/audit-documents-research-64107d claude/cinerie-easypanel-readiness claude/cinerie-editorial-media-projection claude/cinerie-editorial-v2-ff67ef claude/cinerie-editorial-workflow-f4c3f6 claude/cinerie-manual-editorial-readiness-3a55a1 claude/cinerie-manual-editorial-readiness-a8fc11 claude/cinerie-mnscr-auto-publication-seo claude/cinerie-payload-foundation claude/cinerie-plano-definitivo-dba625 claude/cinerie-publication-projection claude/cinerie-readiness-bug-65e8d0 claude/consolidate-audit-docs-42baff claude/final-frontend-cinerie-5faaf0 claude/frosty-mcnulty-30a2f7 claude/home-primeira-dobra-relatorio-531524 claude/pr-99-canary-editorial-3911d0 feat/entity-detail-listing-density feat/rapidapi-ratings-streaming-offline feat/seo-entity-first-baseline feat/streaming-watch-availability-promotion fix/canonical-slug-redirect fix/cinerie-automation-draft-body fix/film-show-ratings-real-payload pr99-work test/cinerie-editorial-entity-link-canary test/harden-honest-ui-guards
```

(Várias exigem `git worktree remove` antes do `branch -D` porque estão checked out — o git recusa e avisa; resolva worktree a worktree.)

**Locais que NÃO entram na poda até o resgate da Parte 0:** `feat/data-governance-hardening`, `feat/editorial-operations-platform`, `claude/cinerie-catalog-architecture-400821`, `claude/project-technical-audit-5b8ddb`, `claude/screena-branch-analysis-0e7ba9` (esta análise). Backups nominais (`backup/fase-5c-…`, `backup/rebrand-screen-docs-original`, `fix/completion-02-…` local, `docs/project-status-2026-07-02`) e a worktree `pr99-work`: podáveis com prova apresentada, mas por serem snapshots nomeados de propósito, a decisão final é sua.

**Worktrees candidatas a remoção** (branch integrada + working tree limpa): todas as de `E:\screena-wt\` exceto `editorial-operations-platform` (resgate pendente); as 4 de `E:\Área de Trabalho 2\screen-*`; `E:\screena-manual-editorial`; e as `.claude/worktrees/*` já limpas.

## 8. NÃO VERIFICADOS

- **Estado de produção** (`https://cinerie.com`): o acesso HTTP foi negado nesta sessão. A afirmação "casca em branco resolvida" vale para o **repositório** (`origin/main`), não para o deploy.
- **Build/gates da branch `final-frontend` isolada hoje**: não rodado (justificado — árvore idêntica ao squash já validado nos checks da PR #88).
- **Conteúdo semântico dos 350 arquivos não rastreados do checkout principal**: copiados integralmente, mas não auditados um a um (maioria é skill de ferramenta em `.agents/`/`.claude/`/`.codex/` + 1 zip de design de ~260 MB do total).
- **Equivalência funcional dos 32 arquivos em que `frosty-mcnulty` difere da main**: provada por amostragem dirigida (identity-conflict, error-mapping, ON CONFLICT) e por 124/156 blobs idênticos — não por diff exaustivo dos 32.
- **PRs #76/#77 (docs)**: não avaliei a veracidade do conteúdo contra o estado atual — ambas antecedem a #88 e podem descrever problemas já resolvidos; decisão editorial humana.
- **`gh pr list` limitado a 100**: cobre as PRs #1–#99 (todas); nada ficou de fora.
