# Migração da CI do GitHub Actions para a máquina local

> Estado: **migrada em 2026-10-14.** O GitHub deixou de executar CI/CD: não há
> arquivo em `.github/workflows/`. A CI roda na máquina de quem muda o código,
> por `.\scripts\ci.ps1` (Windows) ou `node scripts/ci/pipeline.mjs` (qualquer
> sistema). Uso diário: [`LOCAL-DEVELOPMENT.md`](./LOCAL-DEVELOPMENT.md).
> O workflow antigo está guardado, inerte, em
> [`ci-legacy/github-actions-ci.yml`](./ci-legacy/github-actions-ci.yml).

## 1. Diagnóstico (o que o GitHub Actions fazia)

### Arquivos e workflows

| Item | Estado antes | Estado agora |
| --- | --- | --- |
| `.github/workflows/ci.yml` (`CI`) | único workflow de `main`, 1.055 linhas | movido para `docs/ci-legacy/github-actions-ci.yml` (fora de `.github/workflows/`, o GitHub não o lê) |
| `lab-next-sigterm.yml`, `lab-sinais.yml` | registrados no GitHub como `active`, mas só existiam nas branches `lab/next-sigterm` e `lab/sinais-pid1`, **já apagadas** | inertes: não há branch com esses arquivos |
| `.github/BRANCH_PROTECTION.md` | pedia os checks do Actions como obrigatórios | reescrito: a regra não deve exigir checks do Actions |

### Gatilhos, segredos e chamadas externas

- Gatilhos: `push` em `main` e todo `pull_request`. **Não havia** `schedule`/`cron`
  nem `workflow_dispatch` — portanto não há tarefa agendada a migrar e não foi
  criado `docs/WINDOWS-TASK-SCHEDULER.md`. As tarefas agendadas do produto rodam
  em produção, no serviço `screen-cron` (`services/sync`), não no GitHub.
- `permissions: contents: read`.
- **Nenhum `secrets.*`.** Todo banco era efêmero e toda credencial era descartável
  e literal (`postgresql://screen:screen@...`, `token-de-prova-nao-e-credencial`,
  `senha-de-prova-nao-e-credencial`...). Nada a copiar para `.env`.
- Variáveis do GitHub usadas: `GITHUB_SHA`, `GITHUB_RUN_NUMBER`, `GITHUB_ENV`
  (só no job `docker-image`) — substituídas por `CINERIE_CI_SHA` e
  `CINERIE_CI_RUN_ID`, preenchidas pelo pipeline.
- Actions de terceiros: `actions/checkout@v4`, `pnpm/action-setup@v4`,
  `actions/setup-node@v4` (Node 22, cache pnpm). Nenhuma action de deploy.
- Chamadas externas: só downloads (registry npm, Docker Hub, Chromium do
  Playwright, apt). Nenhum fornecedor do produto (TMDB, OMDb, Gemini...).
- **Deploy: nenhum.** O deploy é o do EasyPanel (botão Implantar; auto-deploy
  desligado) e não passava pelo Actions. Não há Coolify neste projeto.
- **Migrations de produção: nenhuma.** Rodam no release do EasyPanel.

### Jobs

| Job (contexto do check) | Serviços | O que provava |
| --- | --- | --- |
| `build` — "Typecheck, lint, test, auditorias e build publico" | embedded-postgres (PG16 efêmero dentro dos validadores), Chromium | ~55 passos: typecheck, lint, test, auditorias, builds, integração do CMS, canários, E2E e validadores com PostgreSQL |
| `backup-restore` — "Backup + restore real (fidelidade de dados, PostgreSQL 16)" | `postgres:16-alpine` + cliente 16 | backup + restore com comparação de conteúdo e o controle negativo |
| `docker-image` — "Imagem Docker real (digest, nao-root, healthcheck)" | Docker, `postgres:16-alpine` | as quatro imagens, healthcheck, não-root, migrations, SIGTERM chegando a quem drena |

## 2. Arquitetura local

```
scripts/ci/steps.mjs        FONTE ÚNICA: passos, jobs, serviços e perfis
scripts/ci/pipeline.mjs     executor: numera, cronometra, para no 1º erro, sai 0/1
scripts/ci/lib/proc.mjs     processos no Windows/Linux; tira segredos do ambiente
scripts/ci/lib/snapshot.mjs working tree -> .tar em LF (índice temporário + git archive)
scripts/ci/linux/runner.Dockerfile  o "ubuntu-latest" local: Node 22, pnpm, PG16 client, Docker CLI, deps do Chromium
scripts/ci/linux/docker-image.sh    o job docker-image, portado do YAML
scripts/ci/doctor.mjs · clean.mjs · hooks.mjs
scripts/ci.ps1 · doctor.ps1 · clean.ps1   wrappers PowerShell (5.1 e 7)
.githooks/pre-commit · pre-push          hooks opcionais (core.hooksPath)
```

- Os `.ps1`, os scripts do `package.json` (`ci`, `ci:full`, `ci:backup`,
  `ci:docker`, `ci:all`, `prepush`, `doctor`, `clean`, `hooks:*`) e os hooks só
  escolhem o perfil. A lógica mora em `steps.mjs` + `pipeline.mjs`.
- Lint/typecheck/test/build **não** foram reimplementados: cada passo chama o
  script que já existia no `package.json`.
- Perfis Linux (`completo`, `backup`, `docker`, ou `-Container`): no Windows, o
  job roda num container local criado a partir de `runner.Dockerfile`. Não é
  self-hosted runner: nada se registra no GitHub e nada fala com ele.
- O executor fixa `LANG=C.UTF-8`/`LC_ALL=C.UTF-8`, como o `ubuntu-latest`. A
  imagem `node:22-bookworm` vem sem locale, e aí o `initdb` do embedded-postgres
  cria o cluster em SQL_ASCII: em 2026-10-20 o `validate:entity-resolve`
  reprovou por isso (`invalid byte sequence for encoding "UTF8"`) enquanto no
  GitHub passava. "Um Linux qualquer" não é o runner — a diferença tem de estar
  escrita no Dockerfile.
- O container recebe um **snapshot LF** do working tree. Motivo: com
  `core.autocrlf=true` o disco do Windows está em CRLF, e um `docker build` dali
  copiaria `scripts/container/pid1-shell.sh` (o `/bin/sh` das imagens) com `\r` —
  imagem diferente da que o EasyPanel constrói a partir do GitHub.
- Segurança: o `.env` do checkout principal aponta para produção. O pipeline tira
  do ambiente das etapas toda variável de banco/credencial (lista em
  `scripts/ci/lib/proc.mjs`) e põe `CI=true`, como no runner.

## 3. Equivalência passo a passo

### `actions/*` e preparo

| No workflow | Localmente |
| --- | --- |
| `actions/checkout@v4` | desnecessário: o repositório já está clonado; nos perfis Linux, o snapshot LF |
| `pnpm/action-setup@v4` (9.15.4) | `corepack` + `packageManager` (`doctor` confere) |
| `actions/setup-node@v4` (22, cache pnpm) | Node 22 instalado (`.nvmrc`; `doctor` avisa se for outro); no container, `node:22-bookworm`; cache = store do pnpm local / volume `cinerie-ci-pnpm-store` |
| `pnpm install --frozen-lockfile` | passo `install` (igual) |
| `playwright install --with-deps chromium` | passo `browsers` (`playwright install chromium`); no Linux as dependências de sistema já vêm na imagem do executor; cache em volume |
| `apt-get install postgresql-client-16` | já na imagem do executor |

### Job `build`

Perfis: **r** = `rapido`, **p** = `padrao`, **c** = `completo` (container Linux).

| Passo do workflow | id local | Perfis |
| --- | --- | --- |
| Validate operational shell scripts | `shell` (`bash -n`, `dash -n`, `awk -f` pelo Git for Windows; lista em `SHELL_SCRIPTS`) | p, c |
| Generate Prisma Client | `prisma` | r, p, c |
| Typecheck + Typecheck do wiring operacional | `typecheck` (o `pnpm typecheck` já encadeia `typecheck:catalog-runtime`) | r, p, c |
| Typecheck do web / admin / CMS | `typecheck-web`, `typecheck-admin`, `typecheck-cms` | r, p, c |
| Testes do CMS (núcleo puro) | `test-cms` | p, c |
| Integração do CMS / projeção / mídia / caminho humano | `cms-integration`, `projection-integration`, `media-integration`, `manual-editorial` | c |
| E2E do painel editorial | `cms-e2e` | c |
| Canários (manual, vínculos, auto-verificação) e rota de resolução | `canary-manual`, `canary-links`, `canary-auto-verification`, `entity-resolve` | c |
| Prontidão do CMS / do worker | `readiness-cms`, `readiness-worker` | p, c |
| Lint / Test | `lint`, `test` | r, p, c |
| Estilo computado | `styles` | p, c |
| Auditorias e cobertura de API | `audit-invariants`, `audit-render`, `api-coverage` | r, p, c |
| Build do web / do admin | `build`, `build-admin` | r (só web), p, c |
| Painel operacional, validate:all, cache de rota | `ops-panel`, `validate-all`, `route-cache` | c |
| Migrations A/B/pgcrypto, stores, SEO runtime, temporada/episódio | `db-real`, `db-upgrade`, `db-pgcrypto`, `streaming-stores`, `seo-runtime`, `season-episode` | c |
| Plataforma TMDB, catálogo, produtor de indexabilidade, texto, sinopse, integridade | `tmdb-platform`, `catalog-platform`, `indexability-producer`, `text-recovery`, `synopsis-render`, `catalog-integrity` | c |
| Plataforma externa, produto, autorização de fontes | `external-platform`, `external-product`, `source-authorization` | c |
| OMDb (ordem, SIGTERM, erro inesperado) | `omdb-order`, `omdb-shutdown`, `omdb-unexpected-error` | c |
| Editorial, Backend C (C7A, C7B1, C7D, C8) | `editorial-platform`, `user-persistence`, `user-product`, `identity-privacy`, `library` | c |

`.\scripts\ci.ps1 completo -List` imprime a lista exata, na ordem do workflow.

### Job `backup-restore` (perfil `backup`)

| Passo do workflow | Localmente |
| --- | --- |
| `services: postgres:16-alpine` | o pipeline sobe `postgres:16-alpine` numa rede própria, com alias `pg`, e espera `pg_isready` pelo TCP |
| install, db:generate, migrate:deploy, seed | `backup-install`, `backup-prisma`, `backup-migrate`, `backup-seed` (no container, `DATABASE_URL=...@pg:5432/screen`) |
| `verify-backup-restore.sh` | `backup-verify` |
| `restore-test-selftest.sh` (controle negativo) | `backup-selftest` |

### Job `docker-image` (perfil `docker`)

Um passo (`docker-image`) que roda `scripts/ci/linux/docker-image.sh` no
executor, com o socket do Docker. O script tem as mesmas seções do YAML:
PostgreSQL 16; build com digest e build args; healthcheck; HTTP/versão/não-root/
migrations/gravabilidade; agendador na mesma imagem com dois controles
negativos; build do worker de projeção; SIGTERM no agendador, catalog-worker e
worker de projeção com controles negativos; build do admin e do CMS; SIGTERM no
Next dos três apps com requisição em curso e controle negativo.

Diferenças deliberadas, todas fora das asserções:

- nomes de container com prefixo da execução (`cinerie-ci-<id>-web`), com o nome
  curto como alias de rede — na máquina do dono pode existir um container `pg`;
- sem portas publicadas no host: o executor está na rede do job e fala com
  `web:3000`, `admin:3006`, `cms:3002` (uma porta 3000 ocupada pelo `next dev`
  não derruba a prova);
- os logs dos containers saem só em falha; o pipeline remove todo container e a
  rede com o rótulo da execução no fim, passe ou falhe.

## 4. Diferenças conhecidas em relação ao GitHub

| Diferença | Efeito | Como lidar |
| --- | --- | --- |
| Node do host (24 nesta máquina) ≠ 22 | `rapido`/`padrao` nativos rodam em outro Node | `doctor` e o pipeline avisam; `-Container` roda no Node 22 |
| Windows compartilhado com outros processos | sob carga, testes estouravam tempo: os timeouts padrão do Vitest (5 s/10 s) reprovavam guardas que varrem a árvore, e `projection-loop-resilience.test.ts` contava a subida a frio do worker dentro da janela dos ciclos | consertado na origem em 2026-10-14 (timeouts padrão de 30 s/60 s em `vitest.config.ts`; subida do worker numa janela própria). Sem nova tentativa em lugar nenhum. Com a máquina saturada (≥ 6 núcleos de carga extra) ainda pode sobrar um hook de varredura acima de 60 s ou `Timeout calling "fetch"` do próprio Vitest: feche o que estiver pesando ou rode com `-Container` |
| O check deixou de ser obrigatório no GitHub | o GitHub não impede merge de PR que não rodou a CI | hook pre-push, regra no `CLAUDE.md` e o resultado da CI na descrição do PR |
| Validadores PostgreSQL no Windows | caminho acentuado, 260 caracteres, SIGTERM | ficam no perfil `completo` (container) |

## 5. O que precisa ser feito no GitHub (pelo dono)

A proteção da `main` exige os três checks do Actions (`strict: true`,
`enforce_admins: true`, lido em 2026-10-13). Sem o workflow, eles nunca mais
serão reportados e **nenhum PR consegue ser mergeado**, inclusive o desta
migração. Em **Settings → Branches → `main`**:

1. desmarcar **Require status checks to pass before merging** (ou remover os três
   contextos), mantendo **Require a pull request before merging**;
2. opcional, para garantir zero execução em qualquer branch: **Settings → Actions
   → General → Disable actions**, ou desativar os três workflows registrados
   (`gh workflow disable CI`, `lab-next-sigterm`, `Lab sinais PID 1`).

Depois disso, `git push` e pull requests não disparam nada no GitHub Actions.
