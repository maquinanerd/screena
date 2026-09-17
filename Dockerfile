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

# NAO-ROOT DESDE O COMECO DO WORKSPACE — e por que isso vale 11 minutos.
#
# O desenho anterior copiava e construia tudo como root e terminava com
# `RUN chown -R node:node /app`: no build medido em producao, SO esse chown
# levou 661 s, e a camada resultante DUPLICA o conteudo inteiro de /app
# (workspace + node_modules + .next) — que e o que inflava o unpack da imagem
# (257 s). chown recursivo em camada nova nao "muda dono": reescreve tudo.
#
# Agora o `node` e dono de /app e /pnpm ANTES de qualquer arquivo existir
# (dois chown nao-recursivos em diretorios vazios: instantaneos), o COPY ja
# entrega os arquivos com o dono certo e install/generate/build rodam como
# `node` — tudo nasce com a posse certa e nenhuma camada de chown existe.
# /pnpm precisa da posse porque PNPM_HOME aponta para la (store do pnpm).
RUN mkdir -p /pnpm && chown node:node /app /pnpm
USER node

COPY --chown=node:node . .

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

# Container NAO-root: o `USER node` foi definido ANTES do COPY/install/build —
# tudo em /app ja pertence ao `node` (inclusive .next/cache, que o runtime
# escreve). Nenhum chown recursivo e necessario aqui.

# O /bin/sh DESTA IMAGEM ENTREGA O SIGTERM AO SERVICO — e este e o ULTIMO RUN.
#
# O EasyPanel roda o "Comando" de um servico (o do screen-cron e o agendador)
# como `/bin/sh -c "<comando>"` NO LUGAR do ENTRYPOINT — medido em 17/09/2026. O
# dash nao faz exec desse comando e fica como PID 1, e um PID 1 sem handler nao
# recebe SIGTERM: todo `docker stop` virava SIGKILL depois da carencia, e o
# desligamento gracioso do agendador nunca rodava. ENTRYPOINT nenhum alcanca
# esse caso, porque o painel o substitui; o que o alcanca e o proprio /bin/sh.
# Com um comando simples no PID 1, ele vira um init que repassa o sinal, colhe
# orfaos e espera a drenagem; em qualquer outro uso, e o dash. Medidas, regra e
# limites: scripts/container/pid1-shell.sh e docs/operations/sigterm-e-pid1.md.
#
# ULTIMO RUN porque todo RUN depois daqui passaria pelo shell novo. Root so para
# o arquivo ficar fora do alcance de escrita do usuario `node`.
USER root
RUN install -D -m 0755 -o root -g root scripts/container/pid1-shell.sh /usr/local/lib/cinerie/pid1-shell.sh \
  && ln -sf /usr/local/lib/cinerie/pid1-shell.sh /usr/bin/sh
USER node

EXPOSE 3000

# HEALTHCHECK (baseline R-27): o orquestrador passa a distinguir container no ar
# de container degradado. Usa `node` (a imagem slim nao tem curl/wget).
#
# ESTA IMAGEM RODA DOIS SERVICOS, e cada um serve saude numa porta:
#   - screen-app  (o CMD abaixo)          -> GET :3000/api/health/ (200 so com o PostgreSQL)
#   - screen-cron (comando do agendador)  -> GET :3005/healthz (liveness, nao toca banco)
#
# Ate 16/09/2026 a sondagem era um fetch FIXO na 3000. No screen-cron ninguem
# escuta ali: o container nunca ficava saudavel e o orquestrador o substituia em
# loop (129 containers numa hora), matando no meio todo lote longo do agendador.
#
# O script reconhece o servico pelo COMANDO do container (o PID 1), sem nenhuma
# configuracao no painel, e cai no alvo do site quando nao reconhece — o site
# nunca responde saudavel com o Next fora do ar. Decisao e motivos:
# scripts/healthcheck/lib/health-target.mjs.
#
# start-period cobre o `migrate deploy` do boot do site.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node /app/scripts/healthcheck/container-health.mjs

# Release: `prisma migrate deploy` roda ANTES do Next e, se falhar, o app NAO
# sobe (exit != 0 => o orquestrador nao promove o container). Nunca `migrate dev`,
# `migrate reset` nem `db push`: `db:migrate:deploy` e literalmente
# `prisma migrate deploy` (packages/db/package.json), o unico comando que so
# aplica migrations pendentes e jamais reescreve/derruba schema.
#
# `exec` no start: o `pnpm` vira PID 1 e recebe o SIGTERM do orquestrador. O
# Next, NAO: o pnpm repassa o sinal ao `sh -c` do script `start` de apps/web, e
# esse shell morre sem repassar — o mesmo encadeamento medido nos workers, ainda
# aberto aqui (ver docs/operations/sigterm-e-pid1.md).
#
# REPLICAS: o Prisma serializa migrate deploy com advisory lock do Postgres
# (`SELECT pg_advisory_lock(72707369)`), entao N replicas nao corrompem o
# _prisma_migrations — as perdedoras esperam. O risco real e TIMEOUT: numa
# migration longa, as replicas que esperam podem estourar o lock timeout, falhar
# e entrar em crashloop pelo `||` abaixo. Decisao aplicada: manter o migrate no
# start (o servico roda com 1 replica hoje) e, ao escalar, mover o migrate para
# um passo de release/initContainer unico — ver docs/runbooks/PRODUCTION_DEPLOY.md.
CMD ["sh", "-c", "pnpm --filter @screena/db db:migrate:deploy || { echo '=== FATAL: prisma migrate deploy falhou. O app NAO vai subir. ==='; echo '=== Causa mais comum: pgcrypto ausente ou fora do schema public.'; echo '=== Rode no banco: CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;'; echo '=== Runbook: docs/runbooks/PRODUCTION_DEPLOY.md'; exit 1; }; exec pnpm --filter @screena/web start"]
