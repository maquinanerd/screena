FROM node:22-bookworm-slim

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

EXPOSE 3000

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
