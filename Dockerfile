# Imagem base PINADA por DIGEST (imutavel), nao por tag flutuante (baseline:
# auditoria apontou `latest`/tag movel). O digest abaixo e do `node:22-bookworm-slim`
# resolvido no Docker Hub. Sobrescrevivel no deploy sem editar o Dockerfile:
#   docker build --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:<novo> ...
# Para atualizar o default, resolva o digest atual (ver docs/runbooks/PRODUCTION_DEPLOY.md).
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
FROM ${NODE_IMAGE}

WORKDIR /app

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY . .

# NODE_ENV so e definido depois do build: com NODE_ENV=production o pnpm pula as
# devDependencies, e tanto o `next build` (tailwindcss, typescript) quanto o
# `migrate deploy` (CLI prisma) dependem delas.
RUN PNPM_CONFIG_PROD=false pnpm install --frozen-lockfile

# `apps/web/src/server/*` importa @screena/db/server -> @prisma/client. O client
# so existe apos `prisma generate`; o postinstall do @prisma/client roda dentro do
# store do pnpm e nao alcanca packages/db/prisma/schema.prisma.
RUN pnpm --filter @screena/db db:generate

# NENHUMA env publica no build — de proposito.
#
# Antes havia aqui `ARG/ENV THE_SCREEN_PUBLIC_SITE_URL=https://cinerie.com` e
# `THE_SCREEN_PUBLIC_INDEXING_ENABLED=1`, porque /robots.txt era rota Static e o
# valor era assado no `next build`. Isso criava DOIS furos:
#
#  1. `ENV` do Dockerfile persiste no RUNTIME da imagem (nao e build-only). Como
#     o codigo le o nome legado como fallback, um container que NAO setasse nada
#     resolvia indexacao LIGADA e origem = cinerie.com. Fail-OPEN: um staging que
#     esquecesse de configurar as envs se anunciava como producao e indexavel.
#  2. O robots.txt assado ignorava a env de runtime: desligar a indexacao exigia
#     rebuild. Um kill switch que precisa de rebuild nao e um kill switch.
#
# `app/robots.ts` agora e `force-dynamic` e todas as paginas publicas sao `ƒ`
# (dinamicas), entao o build NAO le nenhuma env publica — verificado: `next build`
# passa sem env alguma, e as duas rotas Static restantes (/filmes, /series) sao so
# redirects 308 para /pt/... com constantes de rota.
#
# As envs publicas passam a ser 100% de RUNTIME (EasyPanel):
#   CINERIE_PUBLIC_SITE_URL=https://cinerie.com
#   CINERIE_PUBLIC_INDEXING_ENABLED=true|false
RUN pnpm --filter @screena/web build

ENV NODE_ENV=production

# Versao RASTREAVEL da imagem (baseline R-27/observabilidade). Injetada no build
# e lida em runtime por GET /api/health. Sem args, resolve "unknown" (nunca
# inventa um SHA). Nao sao envs publicas de site/indexacao — sao metadados seguros.
#   docker build --build-arg CINERIE_BUILD_SHA=$(git rev-parse HEAD) \
#                --build-arg CINERIE_BUILD_VERSION=v1.2.3 \
#                --build-arg CINERIE_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) ...
ARG CINERIE_BUILD_SHA=unknown
ARG CINERIE_BUILD_VERSION=unknown
ARG CINERIE_BUILD_TIME=unknown
ENV CINERIE_BUILD_SHA=${CINERIE_BUILD_SHA} \
    CINERIE_BUILD_VERSION=${CINERIE_BUILD_VERSION} \
    CINERIE_BUILD_TIME=${CINERIE_BUILD_TIME}

# Container NAO-root: a imagem base ja traz o usuario `node` (uid 1000). O app
# so precisa LER node_modules/build e ESCREVER o cache de revalidacao do Next
# (.next/cache); dar a posse de /app ao `node` cobre ambos. `migrate deploy` so
# faz rede. Reversivel: remover o chown + USER volta a rodar como root.
RUN chown -R node:node /app
USER node

EXPOSE 3000

# HEALTHCHECK (baseline R-27): o orquestrador passa a distinguir container no ar
# de container degradado. Usa `node` (a imagem slim nao tem curl/wget) e o fetch
# global do Node 22 contra GET /api/health, que so responde 200 quando o
# PostgreSQL responde. start-period cobre o `migrate deploy` do boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"

# Release: `prisma migrate deploy` roda ANTES do Next e, se falhar, o app NAO
# sobe (exit != 0 => o orquestrador nao promove o container). Nunca `migrate dev`,
# `migrate reset` nem `db push`: `db:migrate:deploy` e literalmente
# `prisma migrate deploy` (packages/db/package.json), o unico comando que so
# aplica migrations pendentes e jamais reescreve/derruba schema.
#
# `exec` no start: o Next vira PID 1 e recebe SIGTERM direto do orquestrador, em
# vez de ficar orfao sob o shell (shutdown limpo).
#
# REPLICAS: o Prisma serializa migrate deploy com advisory lock do Postgres
# (`SELECT pg_advisory_lock(72707369)`), entao N replicas nao corrompem o
# _prisma_migrations — as perdedoras esperam. O risco real e TIMEOUT: numa
# migration longa, as replicas que esperam podem estourar o lock timeout, falhar
# e entrar em crashloop pelo `||` abaixo. Decisao aplicada: manter o migrate no
# start (o servico roda com 1 replica hoje) e, ao escalar, mover o migrate para
# um passo de release/initContainer unico — ver docs/runbooks/PRODUCTION_DEPLOY.md.
CMD ["sh", "-c", "pnpm --filter @screena/db db:migrate:deploy || { echo '=== FATAL: prisma migrate deploy falhou. O app NAO vai subir. ==='; echo '=== Causa mais comum: pgcrypto ausente ou fora do schema public.'; echo '=== Rode no banco: CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;'; echo '=== Runbook: docs/runbooks/PRODUCTION_DEPLOY.md'; exit 1; }; exec pnpm --filter @screena/web start"]
