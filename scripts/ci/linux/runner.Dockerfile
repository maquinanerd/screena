# Executor LOCAL da CI (perfis completo, backup, docker e --container).
#
# Faz no Docker Desktop o papel que o `ubuntu-latest` fazia no GitHub Actions:
# Linux, Node 22, pnpm 9.15.4, bash/dash/awk, git, jq, curl, cliente
# PostgreSQL 16, Docker CLI + buildx e as bibliotecas de sistema do Chromium do
# Playwright. NAO e runner do GitHub: nada aqui se registra nem fala com o GitHub.
#
# Construida por scripts/ci/pipeline.mjs (`docker build`, com cache de camada:
# segundos depois da primeira vez). O codigo NAO entra na imagem: cada execucao
# recebe um snapshot LF do working tree em /snapshot.tar.
#
# Caches entre execucoes (volumes nomeados, criados com o dono certo a partir
# daqui): cinerie-ci-pnpm-store -> /cache/pnpm-store e
# cinerie-ci-playwright -> /cache/ms-playwright.

FROM docker:29-cli AS dockercli

FROM node:22-bookworm

# Versao do Playwright do lockfile (o pipeline le e passa): as dependencias de
# sistema do Chromium casam com o navegador que `playwright install` baixa.
ARG PLAYWRIGHT_VERSION

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg jq; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-16; \
    npx -y "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium; \
    rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=dockercli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=dockercli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

# LANG/LC_ALL em C.UTF-8 como no `ubuntu-latest` do GitHub. Sem isto o locale e
# POSIX e o `initdb` do embedded-postgres cria o cluster em SQL_ASCII: o
# validador `validate:entity-resolve` reprovou com `invalid byte sequence for
# encoding "UTF8": 0xc2 0x20` (medido em 2026-10-20) — no runner ele passava.
ENV CI=true \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_BROWSERS_PATH=/cache/ms-playwright \
    npm_config_store_dir=/cache/pnpm-store

RUN set -eux; \
    corepack enable; \
    corepack prepare pnpm@9.15.4 --activate; \
    mkdir -p /cache/pnpm-store /cache/ms-playwright /work; \
    chown -R node:node /cache /work /opt/corepack; \
    pg_dump --version; docker --version; pnpm --version
