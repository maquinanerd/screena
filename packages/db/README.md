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
    async-child-process.ts  # processo filho que NAO congela o laco de eventos
```

## Validadores com PostgreSQL embarcado: filho sempre assincrono

Todo script ou harness que sobe `embedded-postgres` roda `prisma migrate deploy`,
`db seed`, `next build` e CLIs por `runChild`/`spawnChild` de
`@screena/db/async-child-process` — nunca por `execFileSync`, `spawnSync` ou
`execSync`.

O motivo e um travamento sem erro: o `embedded-postgres` le o log do Postgres
(stderr do processo filho) pelo laco de eventos. Uma chamada sincrona congela o
laco, o pipe enche (~64 KB) e o backend que for logar trava dentro do `write()`.
Em 16/09/2026 um validador ficou 6 h parado numa migration assim.

- `runChild` tem a semantica de erro do `execFileSync`: codigo diferente de 0
  rejeita com `Command failed: <comando>`.
- `spawnChild` tem a do `spawnSync`: nunca rejeita e devolve status, sinal e saida.
- O CMS usa a copia `apps/cms/src/__tests__/async-child-process.ts` (ADR 0015).

Travado por `tests/governance/embedded-postgres-child-process.test.ts`; o
experimento do pipe cheio, com controle negativo, esta em
`tests/unit/async-child-process.test.ts`.

## Uso

```bash
pnpm --filter @screena/db db:validate
pnpm --filter @screena/db db:generate
pnpm --filter @screena/db db:migrate:deploy
pnpm --filter @screena/db db:seed
```
