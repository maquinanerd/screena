# @screena/db

Camada de **dados** da Screena.

> **Fase 0 (agora):** este pacote e apenas um esqueleto. Ele exporta um
> placeholder (`DB_PLACEHOLDER`) e reserva a pasta `prisma/`. **Nao** ha schema
> real, migrations nem client nesta fase.

Na **Fase 1**, este pacote passara a guardar:

- o **schema Prisma** em `packages/db/prisma/schema.prisma`, modelando as tabelas
  canonicas (`movies`, `tv_shows`, `seasons`, `episodes`, `people`,
  `external_ratings`, `watch_availability`, `content_blocks`,
  `page_indexability_decisions`, `source_licenses`, `api_sync_logs`, etc.);
- o **client de banco** (PrismaClient) e helpers de acesso tipados.

## Contrato

- **Workers escrevem, web le.** Os workers offline (Python) populam e atualizam
  o PostgreSQL; o app `@screena/web` apenas **le** dados ja persistidos.
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
workers (Python, offline)  ──escrevem──▶  PostgreSQL  ──leem (server-side/ISR)──▶  @screena/web
        │                                     ▲
        └── Gemini (so offline) ──content_blocks validados──┘
```

## Estrutura prevista (Fase 1)

```
packages/db/
  prisma/
    schema.prisma      # tabelas canonicas (a definir na Fase 1)
    migrations/        # geradas pelo Prisma
  src/
    index.ts           # exporta o client e helpers de acesso
```

## Uso (Fase 0)

```ts
import { DB_PLACEHOLDER } from "@screena/db";
// DB_PLACEHOLDER === true  // marcador de fundacao; sem client ainda.
```
