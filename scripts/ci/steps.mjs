/**
 * steps.mjs — FONTE UNICA dos passos da CI local.
 *
 * Esta lista substitui o antigo `.github/workflows/ci.yml` (guardado como
 * referencia em `docs/ci-legacy/github-actions-ci.yml`). A ORDEM e a do
 * workflow; cada passo diz em qual perfil entra. Quem executa e
 * `scripts/ci/pipeline.mjs`; os wrappers `.ps1`, os scripts do package.json e
 * os hooks de git so escolhem o perfil.
 *
 * Tres jobs, como no workflow:
 *   - `build`          -> typecheck, lint, testes, auditorias, builds e os
 *                         validadores com PostgreSQL 16 efemero;
 *   - `backup-restore` -> backup + restore real contra um PostgreSQL 16;
 *   - `docker-image`   -> imagens reais, healthcheck e SIGTERM.
 *
 * Camadas do job `build`:
 *   - `rapido`  roda no Windows, sem Docker: o minimo do CLAUDE.md
 *               (typecheck, lint, test, auditorias, build) + typecheck dos apps;
 *   - `padrao`  acrescenta o resto que roda no Windows (scripts .sh, CMS puro,
 *               prontidao, estilo computado, build do admin);
 *   - `linux`   so no perfil `completo`: integracao com PostgreSQL 16
 *               efemero, CMS real, Playwright do painel, canarios. Precisa de
 *               Linux (no Windows roda num container local, ver pipeline.mjs).
 *
 * Ao adicionar um passo aqui, ele passa a valer em todo lugar que chama a CI.
 */

/** `corepack pnpm run <script>` — o mesmo pnpm que o package.json fixa. */
const run = (script) => ({ pnpm: ['run', script] })

/** `corepack pnpm --filter <pacote> run <script>`. */
const filter = (pkg, script) => ({ pnpm: ['--filter', pkg, 'run', script] })

/**
 * DATABASE_URL de mentira para o `prisma generate`: ele exige a variavel, mas
 * nunca conecta. Igual ao workflow.
 */
const DUMMY_DATABASE_URL = 'postgresql://screen:screen@localhost:5432/screen'

/**
 * DATABASE_URL INALCANCAVEL para o build do admin, de proposito: nenhuma pagina
 * do admin pode precisar do banco para compilar, e se alguma tentar, ela falha
 * aqui em vez de tocar um banco de verdade.
 */
const UNREACHABLE_DATABASE_URL = 'postgresql://build:build@127.0.0.1:1/screena_build'

/**
 * Scripts `.sh` versionados e o interpretador que roda cada um em producao.
 * Estes scripts so executam em producao (cron e systemd timer): um erro de
 * sintaxe nao aparece em teste nenhum, aparece no host com o job sem rodar.
 * Ao adicionar um `.sh`, adicione aqui — o passo reprova se a contagem divergir.
 */
export const SHELL_SCRIPTS = {
  bash: [
    'scripts/backup/backup.sh',
    'scripts/backup/restore-test.sh',
    'scripts/backup/backup-with-alert.sh',
    'scripts/backup/verify-backup-restore.sh',
    'scripts/catalog/catalog-cycle-with-alert.sh',
    'scripts/backup/restore-test-selftest.sh',
    // O job docker-image da CI local (roda no executor Linux).
    'scripts/ci/linux/docker-image.sh',
  ],
  // O /bin/sh das imagens de servico e o install delas: quem interpreta e o dash.
  dash: ['scripts/container/pid1-shell.sh', 'scripts/container/pnpm-install.sh'],
  awk: ['scripts/backup/lib/dump-manifest.awk'],
}

/**
 * @typedef {object} Step
 * @property {string} id         identificador curto (usado em --only/--from/--skip)
 * @property {string} title      texto da linha numerada
 * @property {'build'|'backup-restore'|'docker-image'} job
 * @property {'rapido'|'padrao'|'linux'} [layer]  so no job build
 * @property {string[]} [pnpm]   argumentos de `corepack pnpm`
 * @property {string[]} [bash]   argumentos de `bash` (so dentro do container Linux)
 * @property {string} [special]  passo implementado no proprio pipeline.mjs
 * @property {Record<string,string>} [env]
 * @property {boolean} [setup]  preparo (install, prisma): no container, que nasce
 *   vazio, roda SEMPRE, mesmo com --from/--only/--skip
 */

/** @type {Step[]} */
export const STEPS = [
  // ---------------------------------------------------------------- job build
  { id: 'install', setup: true, job: 'build', layer: 'rapido', title: 'Instalar dependencias (lockfile congelado)', pnpm: ['install', '--frozen-lockfile'] },
  { id: 'shell', job: 'build', layer: 'padrao', title: 'Sintaxe dos scripts .sh/.awk operacionais', special: 'shell-syntax' },
  { id: 'prisma', setup: true, job: 'build', layer: 'rapido', title: 'Gerar Prisma Client', ...filter('@screena/db', 'db:generate'), env: { DATABASE_URL: DUMMY_DATABASE_URL } },
  // `pnpm typecheck` ja encadeia `typecheck:catalog-runtime` (persistence/, bin/, composition).
  { id: 'typecheck', job: 'build', layer: 'rapido', title: 'Typecheck (pacotes, servicos, testes e wiring operacional)', ...run('typecheck') },
  { id: 'typecheck-web', job: 'build', layer: 'rapido', title: 'Typecheck do app publico (web)', ...run('typecheck:web') },
  { id: 'typecheck-admin', job: 'build', layer: 'rapido', title: 'Typecheck do admin', ...run('typecheck:admin') },
  { id: 'typecheck-cms', job: 'build', layer: 'rapido', title: 'Typecheck do CMS editorial (Payload)', ...run('typecheck:cms') },
  { id: 'test-cms', job: 'build', layer: 'padrao', title: 'Testes do CMS editorial (nucleo puro, sem banco)', ...run('test:cms') },
  { id: 'cms-integration', job: 'build', layer: 'linux', title: 'Integracao do CMS editorial (Payload + PostgreSQL 16 efemero)', ...run('test:cms:integration') },
  { id: 'projection-integration', job: 'build', layer: 'linux', title: 'Integracao da projecao editorial (dois PostgreSQL 16 efemeros)', ...run('test:publication-projection:integration') },
  { id: 'media-integration', job: 'build', layer: 'linux', title: 'Integracao da midia editorial (storage local + dois PG16)', ...run('test:editorial-media-projection:integration') },
  { id: 'manual-editorial', job: 'build', layer: 'linux', title: 'Caminho editorial humano (CMS manual sem MNScr)', ...run('test:manual-editorial:integration') },
  // No Linux as bibliotecas de sistema do Chromium ja vem na imagem do executor
  // (scripts/ci/linux/runner.Dockerfile); aqui so se baixa o navegador.
  { id: 'browsers', job: 'build', layer: 'padrao', title: 'Instalar Chromium do Playwright', pnpm: ['exec', 'playwright', 'install', 'chromium'] },
  { id: 'cms-e2e', job: 'build', layer: 'linux', title: 'E2E do painel editorial manual (Playwright)', ...run('test:manual-editorial:e2e') },
  { id: 'canary-manual', job: 'build', layer: 'linux', title: 'Canario da publicacao manual ate a pagina publica', ...run('test:manual-publication-projection:integration') },
  { id: 'canary-links', job: 'build', layer: 'linux', title: 'Canario dos vinculos editoriais ate as superficies publicas', ...filter('@screena/web', 'canary:editorial-entity-links') },
  { id: 'canary-auto-verification', job: 'build', layer: 'linux', title: 'Canario da auto-verificacao de vinculo por confianca (automacao)', ...filter('@screena/web', 'canary:entity-link-auto-verification') },
  { id: 'entity-resolve', job: 'build', layer: 'linux', title: 'Rota interna de resolucao de entidade (Next real + PostgreSQL 16 efemero)', ...filter('@screena/web', 'validate:entity-resolve') },
  { id: 'readiness-cms', job: 'build', layer: 'padrao', title: 'Prontidao de implantacao do CMS', ...run('test:cms:deployment-readiness') },
  { id: 'readiness-worker', job: 'build', layer: 'padrao', title: 'Prontidao de implantacao do worker de projecao', ...run('test:publication-worker:deployment-readiness') },
  { id: 'lint', job: 'build', layer: 'rapido', title: 'Lint', ...run('lint') },
  { id: 'test', job: 'build', layer: 'rapido', title: 'Testes (vitest)', ...run('test') },
  { id: 'styles', job: 'build', layer: 'padrao', title: 'Testes de estilo computado (Chromium real)', ...run('test:styles') },
  { id: 'audit-invariants', job: 'build', layer: 'rapido', title: 'Auditoria de invariantes', ...run('audit:invariants') },
  { id: 'audit-render', job: 'build', layer: 'rapido', title: 'Auditoria de render publico', ...run('audit:render') },
  { id: 'api-coverage', job: 'build', layer: 'rapido', title: 'Cobertura de API (drift do registry vs codigo)', ...run('api:coverage') },
  { id: 'build', job: 'build', layer: 'rapido', title: 'Build do app publico (web)', ...run('build') },
  { id: 'build-admin', job: 'build', layer: 'padrao', title: 'Build do painel interno (admin)', ...run('build:admin'), env: { DATABASE_URL: UNREACHABLE_DATABASE_URL } },
  { id: 'ops-panel', job: 'build', layer: 'linux', title: 'Painel operacional (Next real do admin, PostgreSQL 16 efemero)', ...filter('@screena/admin', 'validate:ops-panel') },
  { id: 'validate-all', job: 'build', layer: 'linux', title: 'Validadores descartaveis do web (PostgreSQL efemero)', ...filter('@screena/web', 'validate:all') },
  { id: 'route-cache', job: 'build', layer: 'linux', title: 'Cache de rota + orcamento de linhas (Next real, PostgreSQL 16 efemero)', ...filter('@screena/web', 'validate:route-cache') },
  { id: 'db-real', job: 'build', layer: 'linux', title: 'Migration - cenario A (do zero)', ...filter('@screena/db', 'db:validate:real') },
  { id: 'db-upgrade', job: 'build', layer: 'linux', title: 'Migration - cenario B (upgrade sobre estado anterior)', ...filter('@screena/db', 'db:validate:upgrade') },
  { id: 'db-pgcrypto', job: 'build', layer: 'linux', title: 'Migration - pgcrypto sob search_path hostil', ...filter('@screena/db', 'db:validate:pgcrypto') },
  { id: 'streaming-stores', job: 'build', layer: 'linux', title: 'Stores de streaming - integracao', ...filter('@screena/streaming', 'validate:stores') },
  { id: 'seo-runtime', job: 'build', layer: 'linux', title: 'SEO runtime - fonte unica', ...filter('@screena/web', 'validate:seo-runtime') },
  { id: 'season-episode', job: 'build', layer: 'linux', title: 'Rotas temporada/episodio', ...filter('@screena/web', 'validate:season-episode-routes') },
  { id: 'tmdb-platform', job: 'build', layer: 'linux', title: 'Plataforma TMDB (catalogo, midia, discovery)', ...filter('@screena/ingestion', 'validate:tmdb-platform') },
  { id: 'catalog-platform', job: 'build', layer: 'linux', title: 'Plataforma de catalogo - jobs + busca', ...filter('@screena/ingestion', 'validate:catalog-platform-complete') },
  { id: 'indexability-producer', job: 'build', layer: 'linux', title: 'Produtor de page_indexability_decisions', ...filter('@screena/ingestion', 'validate:indexability-producer') },
  { id: 'text-recovery', job: 'build', layer: 'linux', title: 'Recuperacao de texto e teto do censo', ...filter('@screena/ingestion', 'validate:text-recovery') },
  { id: 'synopsis-render', job: 'build', layer: 'linux', title: 'Sinopse recuperada aparece no HTML da ficha', ...filter('@screena/web', 'validate:synopsis-render') },
  { id: 'catalog-integrity', job: 'build', layer: 'linux', title: 'Integridade do catalogo - backfill, midia, unicidade', ...filter('@screena/ingestion', 'validate:catalog-integrity') },
  { id: 'external-platform', job: 'build', layer: 'linux', title: 'Plataforma externa e inteligencia', ...run('validate:external-intelligence-platform') },
  { id: 'external-product', job: 'build', layer: 'linux', title: 'Ratings, streaming, licencas e Cinerie Score', ...run('validate:external-intelligence-product') },
  { id: 'source-authorization', job: 'build', layer: 'linux', title: 'Autorizacao de fontes e atribuicao', ...run('validate:source-authorization-and-attribution') },
  { id: 'omdb-order', job: 'build', layer: 'linux', title: 'Ordem e particao dos candidatos OMDb', ...filter('@screena/ratings', 'validate:omdb-order') },
  // So roda inteiro em POSIX: no Windows nao ha SIGTERM.
  { id: 'omdb-shutdown', job: 'build', layer: 'linux', title: 'Parada cooperativa da CLI OMDb no SIGTERM', ...filter('@screena/ratings', 'validate:omdb-shutdown') },
  { id: 'omdb-unexpected-error', job: 'build', layer: 'linux', title: 'Cota do lote OMDb abortado por erro inesperado', ...filter('@screena/ratings', 'validate:omdb-unexpected-error') },
  { id: 'editorial-platform', job: 'build', layer: 'linux', title: 'Cadeia editorial - news e publication', ...run('validate:editorial-platform') },
  { id: 'user-persistence', job: 'build', layer: 'linux', title: 'Backend C - migration C7A/C7A.1 (recomendacoes e tracking)', ...filter('@screena/db', 'db:validate:user-persistence') },
  { id: 'user-product', job: 'build', layer: 'linux', title: 'Backend C - adapters C7B1 (identidade, credencial, sessao, token, throttle)', ...filter('@screena/user-platform', 'validate:user-product') },
  { id: 'identity-privacy', job: 'build', layer: 'linux', title: 'Backend C - identidade e privacidade C7D (perfil, consentimento, LGPD)', ...filter('@screena/user-platform', 'validate:identity-privacy') },
  { id: 'library', job: 'build', layer: 'linux', title: 'Backend C - biblioteca, tracker e importacao C8', ...filter('@screena/user-platform', 'validate:library') },

  // ------------------------------------------------------- job backup-restore
  // Rodam no container Linux, com o PostgreSQL 16 do job como servico `pg`
  // (ver JOBS abaixo). O cliente pg_dump/pg_restore/psql 16 vem da imagem.
  { id: 'backup-install', setup: true, job: 'backup-restore', title: 'Instalar dependencias (lockfile congelado)', pnpm: ['install', '--frozen-lockfile'] },
  { id: 'backup-prisma', setup: true, job: 'backup-restore', title: 'Gerar Prisma Client', ...filter('@screena/db', 'db:generate') },
  { id: 'backup-migrate', job: 'backup-restore', title: 'Aplicar migrations na origem', ...filter('@screena/db', 'db:migrate:deploy') },
  { id: 'backup-seed', job: 'backup-restore', title: 'Seed na origem', ...filter('@screena/db', 'db:seed') },
  { id: 'backup-verify', job: 'backup-restore', title: 'Verificar backup + restore com fidelidade de dados', bash: ['scripts/backup/verify-backup-restore.sh'] },
  { id: 'backup-selftest', job: 'backup-restore', title: 'Controle negativo - restore-test.sh precisa REPROVAR com divergencia', bash: ['scripts/backup/restore-test-selftest.sh'] },

  // --------------------------------------------------------- job docker-image
  // Um passo so: o script tem as mesmas secoes do workflow e compartilha os
  // containers entre elas. Roda no container Linux com o socket do Docker.
  { id: 'docker-image', job: 'docker-image', title: 'Imagens Docker reais (digest, nao-root, healthcheck, SIGTERM)', bash: ['scripts/ci/linux/docker-image.sh'] },
]

/**
 * Como cada job roda fora do Windows. `services` espelha o `services:` do
 * workflow: o pipeline sobe o container, espera ficar pronto e o remove no fim.
 */
export const JOBS = {
  build: { user: 'node', services: [], dockerSocket: false, env: {} },
  'backup-restore': {
    user: 'node',
    dockerSocket: false,
    services: [
      {
        alias: 'pg',
        image: 'postgres:16-alpine',
        env: { POSTGRES_USER: 'screen', POSTGRES_PASSWORD: 'screen', POSTGRES_DB: 'screen' },
        // Pronto pelo TCP: o servidor temporario do init so escuta o socket.
        ready: ['pg_isready', '-h', '127.0.0.1', '-U', 'screen', '-d', 'screen'],
      },
    ],
    env: {
      DATABASE_URL: 'postgresql://screen:screen@pg:5432/screen',
      // Base administrativa isolada para criar/dropar as bases efemeras de restore.
      RESTORE_TEST_ADMIN_URL: 'postgresql://screen:screen@pg:5432/postgres',
    },
  },
  // root: o socket do Docker Desktop nao e acessivel a usuario comum no container.
  'docker-image': { user: 'root', services: [], dockerSocket: true, env: {} },
}

/** Perfis: quais jobs e, no job build, quais camadas. */
export const PROFILES = {
  'pre-commit': { description: 'eslint nos arquivos staged (rapido, para o hook pre-commit)', special: 'pre-commit' },
  rapido: { description: 'typecheck, lint, test, auditorias e build do web (hook pre-push)', jobs: { build: ['rapido'] } },
  padrao: { description: 'rapido + scripts .sh, CMS puro, prontidao, estilo computado e build do admin', jobs: { build: ['rapido', 'padrao'] } },
  completo: { description: 'o job build inteiro do antigo workflow, inclusive PostgreSQL 16 efemero (Linux)', jobs: { build: ['rapido', 'padrao', 'linux'] }, linux: true },
  backup: { description: 'backup + restore real contra PostgreSQL 16 (container Linux)', jobs: { 'backup-restore': null }, linux: true },
  docker: { description: 'imagens Docker reais: healthcheck, nao-root, SIGTERM (container Linux)', jobs: { 'docker-image': null }, linux: true },
  tudo: { description: 'completo + backup + docker: os tres jobs do antigo workflow', jobs: { build: ['rapido', 'padrao', 'linux'], 'backup-restore': null, 'docker-image': null }, linux: true },
}

/** Passos de um job num perfil, na ordem da lista. */
export function stepsFor(profileName, job) {
  const profile = PROFILES[profileName]
  if (!profile?.jobs || !(job in profile.jobs)) return []
  const layers = profile.jobs[job]
  return STEPS.filter((s) => s.job === job && (layers === null || layers.includes(s.layer)))
}
