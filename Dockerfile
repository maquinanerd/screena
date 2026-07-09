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

RUN pnpm --filter @screena/web build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-lc", "pnpm --filter @screena/db db:migrate:deploy && pnpm --filter @screena/web start"]
