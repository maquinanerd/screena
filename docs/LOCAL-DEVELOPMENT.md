# Desenvolvimento local e CI local (Windows)

Este repositório não usa mais o GitHub Actions. Lint, typecheck, testes, build,
validadores com PostgreSQL efêmero, backup/restore e as provas das imagens Docker
rodam **na máquina de quem muda o código**. O GitHub fica só com o Git: branches,
commits, push, pull, pull requests e histórico.

```
sua máquina ── .\scripts\ci.ps1 ── lint/typecheck/test/build ── git commit ── git push ── GitHub (só armazena)
                     └── perfis Linux: container local no Docker Desktop (não é runner do GitHub)
```

O diagnóstico da migração e o mapa passo a passo do antigo workflow estão em
[`CI-MIGRATION-LOCAL.md`](./CI-MIGRATION-LOCAL.md).

## 1. Pré-requisitos

| Ferramenta | Para quê | Obrigatória? |
| --- | --- | --- |
| Git for Windows | repositório; traz `bash`, `dash` e `awk` usados na checagem dos `.sh` | sim |
| Node 22 (ver `.nvmrc`) | tudo | sim (o Node 24 funciona, mas difere de produção; o doctor avisa) |
| Corepack | fixa o pnpm 9.15.4 do `packageManager` | sim (vem com o Node) |
| Docker Desktop | perfis `completo`, `backup`, `docker` e a opção `-Container` | só para esses perfis |
| PowerShell 7 | os `.ps1` | não: também rodam no Windows PowerShell 5.1 |
| `psql`/`pg_dump`, `jq` | — | não: ficam dentro do container da CI |

Confira tudo de uma vez:

```powershell
.\scripts\doctor.ps1
```

Ele mostra `[OK]`, `[AVISO]`, `[ERRO]` e `[INFO]`, não instala nada e sai 1 se
houver `[ERRO]`.

## 2. Primeira instalação

```powershell
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @screena/db db:generate
.\scripts\doctor.ps1
```

Prefira um caminho **curto e sem acento** para o clone (ex.: `C:\dev\screena`).
No Windows, caminhos longos esbarram no limite de 260 caracteres do pnpm, e o
`embedded-postgres` com `--encoding=UTF8` morre em caminho acentuado — o que só
afeta quem roda validadores PostgreSQL fora do container.

## 3. Variáveis de ambiente (`.env`)

```powershell
Copy-Item .env.example .env
```

- `.env` e `.env.*` estão no `.gitignore`; só o `.env.example` é versionado, e
  ele tem só nomes e valores de exemplo, nunca segredo real.
- **A CI local não precisa de nenhum segredo.** O antigo workflow não usava
  nenhum `secrets.*`: todo banco era efêmero e toda credencial era descartável e
  literal (`token-de-prova-nao-e-credencial`).
- Por segurança, a CI local **remove do ambiente das etapas** toda variável cujo
  nome termina em `DATABASE_URL`, `_API_KEY` ou `_TOKEN`, ou contém `SECRET` ou
  `PASSWORD`, além de `NODE_ENV`, `MNSCR_*` e `EDITORIAL_AUTO_PUBLISH_*`. Um
  `.env` que aponte para produção não alcança nenhum passo. A lista de nomes
  removidos aparece no topo da execução (`-KeepEnv` desliga, para depuração).

## 4. Desenvolvimento

```powershell
docker compose -f docker-compose.dev.yml up -d postgres   # PostgreSQL de desenvolvimento
corepack pnpm --filter @screena/db db:migrate:deploy
corepack pnpm --filter @screena/db db:seed
corepack pnpm --filter @screena/web dev
docker compose -f docker-compose.dev.yml down             # parar
```

## 5. Comandos avulsos

Os scripts do `package.json` continuam sendo a implementação; a CI só os encadeia.

| O quê | Comando |
| --- | --- |
| Lint | `corepack pnpm run lint` |
| Typecheck (pacotes, serviços, testes, wiring) | `corepack pnpm run typecheck` |
| Typecheck dos apps | `corepack pnpm run typecheck:apps` |
| Testes | `corepack pnpm run test` |
| Estilo computado (Chromium) | `corepack pnpm run test:styles` |
| Auditorias | `corepack pnpm run audit:invariants` · `audit:render` · `api:coverage` |
| Build do site | `corepack pnpm run build` |
| Build do admin / do CMS | `corepack pnpm run build:admin` · `build:cms` |

## 6. CI local

O comando principal:

```powershell
.\scripts\ci.ps1
```

Equivalentes: `corepack pnpm run ci` (no pnpm, `ci` precisa do `run`).

| Perfil | Comando | O que roda | Onde |
| --- | --- | --- | --- |
| `rapido` | `.\scripts\ci.ps1 rapido` ou `corepack pnpm run prepush` | install, Prisma, typecheck (pacotes + apps), lint, test, auditorias, cobertura de API, build do site | Windows |
| `padrao` (default) | `.\scripts\ci.ps1` ou `corepack pnpm run ci` | `rapido` + sintaxe dos `.sh`, testes do CMS, prontidão de implantação, estilo computado, build do admin | Windows |
| `completo` | `.\scripts\ci.ps1 completo` ou `corepack pnpm run ci:full` | o job `build` inteiro do antigo workflow: + integração do CMS, canários, E2E do painel, todos os validadores com PostgreSQL 16 efêmero | container Linux |
| `backup` | `.\scripts\ci.ps1 backup` ou `corepack pnpm run ci:backup` | backup + restore real e o controle negativo | container Linux + PostgreSQL 16 |
| `docker` | `.\scripts\ci.ps1 docker` ou `corepack pnpm run ci:docker` | imagens reais (web, admin, CMS, worker), healthcheck, não-root, SIGTERM | container Linux + Docker |
| `tudo` | `.\scripts\ci.ps1 tudo` ou `corepack pnpm run ci:all` | os três jobs do antigo workflow | container Linux |

Opções úteis:

```powershell
.\scripts\ci.ps1 padrao -List                  # mostra os passos e seus ids
.\scripts\ci.ps1 -Only lint,test -SkipInstall  # so alguns passos
.\scripts\ci.ps1 completo -From seo-runtime    # retoma a partir de um passo
.\scripts\ci.ps1 padrao -Skip styles           # pula um passo
.\scripts\ci.ps1 rapido -Container             # o perfil no Linux com Node 22 (equivalencia exata)
```

Saída: um cabeçalho, cada passo numerado (`[3/19] Gerar Prisma Client`) com o
comando, `OK (tempo)` ou `FALHOU`, e um resumo. **Para no primeiro erro** e sai
com código 1; sucesso sai 0.

### Por que um container nos perfis Linux

O job `build` completo do antigo workflow não roda no Windows por motivos de
ambiente, não de código: `validate:omdb-shutdown` precisa de SIGTERM (POSIX), o
`embedded-postgres` UTF8 morre em caminho acentuado, a integração do CMS esbarra
no limite de 260 caracteres e em antivírus, e as provas Docker dependem de
`dash`, `/proc` e scripts em LF. O container (`scripts/ci/linux/runner.Dockerfile`)
recria o `ubuntu-latest` que o GitHub usava — Node 22, pnpm 9.15.4, cliente
PostgreSQL 16, Docker CLI, dependências do Chromium — e recebe um **snapshot LF
do working tree** (inclui alterações não commitadas e arquivos novos não
ignorados). Nada ali fala com o GitHub. Caches entre execuções: volumes
`cinerie-ci-pnpm-store` e `cinerie-ci-playwright`; a imagem é reaproveitada pelo
cache do Docker.

### Tempo e cache

- O CI normal não apaga nada: reaproveita `node_modules`, o cache do Next, o
  Chromium baixado e as camadas Docker. `pnpm install --frozen-lockfile` com tudo
  em dia leva segundos e continua no pipeline porque prova que o lockfile bate
  com os `package.json`.
- A primeira execução de um perfil Linux constrói a imagem do executor (alguns
  minutos, quase só download); as seguintes levam segundos nesse passo — ela só
  é reconstruída quando `runner.Dockerfile` ou a versão do Playwright mudam.
- O perfil `docker` é o mais lento no Windows: no Docker Desktop, desempacotar
  cada imagem (~1,2 GB em arquivos pequenos) e o `chown -R` dos Dockerfiles
  passam pelo disco virtual da VM e levam muitos minutos cada — no runner do
  GitHub eram segundos. Rode-o antes de deploy, não a cada mudança. O cache de
  build do Docker cresce (36 GB medidos em 2026-10-20); `docker builder prune`
  o libera quando você quiser.

## 7. Hooks de git (opcional)

```powershell
corepack pnpm run hooks:install     # git config core.hooksPath .githooks
corepack pnpm run hooks:uninstall
```

- `pre-commit`: eslint só nos arquivos staged (segundos).
- `pre-push`: o perfil `rapido` (minutos) — a mesma lógica de
  `corepack pnpm run prepush`. Um push que só apaga branch remota é liberado.
- Pular uma vez: `git commit --no-verify` / `git push --no-verify`, ou
  `CINERIE_SKIP_HOOKS=1`.
- `core.hooksPath` vale para **todos os worktrees** do repositório. Num worktree
  sem `node_modules` o pre-push reprova de propósito.

## 8. Deploy

O GitHub Actions **nunca** fez deploy deste projeto, então não houve etapa para
migrar. O deploy é o do EasyPanel e continua igual:

1. CI local verde (`.\scripts\ci.ps1`; antes de um deploy, de preferência `tudo`).
2. Pull request e merge em `main`.
3. No EasyPanel, **Implantar** em cada serviço afetado (`screen-app`,
   `screen-cron`, `cinerie-cms`, `cinerie-publication-worker`). Os serviços estão
   com auto-deploy desligado: merge em `main` sozinho não implanta nada. O
   EasyPanel constrói a imagem a partir do GitHub com o `Dockerfile` do serviço.
4. As migrations de produção rodam no release (`prisma migrate deploy`), nunca a
   partir desta máquina. Ver [`EASYPANEL_DEPLOY.md`](./EASYPANEL_DEPLOY.md) e
   [`operations/admin-deploy.md`](./operations/admin-deploy.md).

Não há `deploy.ps1` de propósito: o deploy depende de decisão humana no painel, e
o perfil `docker` já prova localmente as mesmas imagens que o painel constrói.

## 9. Limpeza

```powershell
.\scripts\clean.ps1 -DryRun          # lista o que sairia
.\scripts\clean.ps1                  # .next, tsbuildinfo, saidas do Playwright, coverage, capturas de QA
.\scripts\clean.ps1 -NodeModules     # + todos os node_modules
.\scripts\clean.ps1 -Docker          # + imagem do executor, tags *:ci e volumes de cache
```

## 10. Troubleshooting

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| `ci.ps1 cannot be loaded because running scripts is disabled` | política de execução do PowerShell | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (uma vez) |
| `AVISO: o projeto declara Node >=22 <23` | Node 24 instalado | instale o Node 22 (fnm ou nvm-windows) ou use `-Container` |
| `O daemon do Docker nao responde` | Docker Desktop fechado | abra o Docker Desktop e rode `.\scripts\doctor.ps1` |
| `bash nao encontrado` no passo `shell` | Git for Windows ausente; o `bash.exe` do WSL não serve | instale o Git for Windows |
| `ha 9 script(s) .sh versionado(s), mas este gate cobre 8` | `.sh` novo no repositório | acrescente-o a `SHELL_SCRIPTS` em `scripts/ci/steps.mjs` |
| `Prisma Client ainda nao foi gerado` ao rodar um comando avulso | falta `db:generate` | `corepack pnpm --filter @screena/db db:generate` (a CI faz sozinha) |
| `pnpm install` que não termina | disco lento por arquivo (antivírus) ou caminho longo | clone num caminho curto em `C:` |
| `Cannot find module` de arquivo interno de uma dependência | store do pnpm corrompida | `.\scripts\clean.ps1 -NodeModules` e reinstale |
| validador PostgreSQL falha no Windows com `invalid byte sequence for encoding "UTF8"` | caminho acentuado | rode o perfil `completo` (container), que é onde esses validadores vivem |
| perfil Linux lento na primeira vez | construção da imagem do executor e download do Chromium | as próximas usam cache |
| `Hook timed out in 60000ms` ou `[vitest-worker]: Timeout calling "fetch"` no passo `test` | máquina saturada por outros processos (medido: só acontece com ≥ 6 núcleos de carga extra; isolados, esses arquivos levam menos de 1,5 s) | feche o que estiver pesando e retome com `-From test`, ou rode com `-Container` |
| sobrou container `cinerie-ci-*` depois de uma execução interrompida | o pipeline morreu antes de limpar (máquina dormiu, terminal fechado) | nada: a próxima execução em container remove os restos de execuções cujo processo não existe mais |
