# @screena/db

Camada de **dados** da Cinerie. O nome `@screena/db` e namespace tecnico
legado interno; a marca publica atual e **Cinerie**.

> **Estado atual:** este pacote tem schema Prisma, migrations, seeds e acesso
> server-only ao PostgreSQL. Ele nao e mais um placeholder de Fase 0.

Este pacote guarda:

- o **schema Prisma** em `packages/db/prisma/schema.prisma`, modelando as tabelas
  canonicas (`movies`, `tv_shows`, `seasons`, `episodes`, `people`,
  `external_ratings`, `watch_availability`, `content_blocks`,
  `page_indexability_decisions`, `source_licenses`, `api_sync_logs`, etc.);
- migrations reais em `packages/db/prisma/migrations`;
- seeds em `packages/db/prisma/seed.ts` e dados tipados em `src/seed-data.ts`;
- o **client de banco server-only** em `src/server.ts`.

## Contrato

- **Pipelines offline escrevem, web le.** TMDB e Entity Writer rodam hoje em
  TypeScript/Node + Prisma; workers Python permanecem como roadmap/shim futuro.
  O app `@screena/web` apenas **le** dados ja persistidos em contexto server-side.
- **Zero API externa no render.** Paginas publicas indexaveis leem **somente**
  PostgreSQL/cache local — nunca TMDB, RapidAPI, Gemini ou qualquer rede externa
  durante o render.
- **Zero Gemini no render.** A IA so gera `content_blocks` offline; eles sao
  salvos, validados e versionados antes de aparecer.
- **Client so server-side.** O client de banco e usado **exclusivamente** em
  contexto server-side: rotas/admin e geracao ISR/revalidate. **Nunca** e
  importado por codigo que vai para o bundle do cliente (frontend).
- **Segredos so em env vars.** `DATABASE_URL` e demais credenciais vivem apenas
  em variaveis de ambiente, nunca no frontend.

## Fluxo de dados (resumo)

```
pipelines offline (TS/Node ou workers) ─▶ PostgreSQL ─▶ @screena/web (server-side/ISR)
        │                                      ▲
        └── Gemini (so offline) ──content_blocks validados──┘
```

## Estrutura atual

```
packages/db/
  prisma/
    schema.prisma      # tabelas canonicas reais
    migrations/        # migrations Prisma
    seed.ts            # seed de referencia
  src/
    index.ts           # exports publicos seguros
    server.ts          # PrismaClient server-only
    seed-data.ts       # seeds tipados
```

## Uso

```bash
pnpm --filter @screena/db db:validate
pnpm --filter @screena/db db:generate
pnpm --filter @screena/db db:migrate:deploy
pnpm --filter @screena/db db:seed
```
