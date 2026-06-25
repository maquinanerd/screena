// @screena/db
// Placeholder da Fase 0 (fundacao).
//
// Na FASE 1 este pacote passara a exportar:
//  - o schema Prisma (packages/db/prisma/schema.prisma) com as tabelas canonicas;
//  - o client de banco (PrismaClient) usado SOMENTE server-side/admin/ISR.
//
// Contrato de uso (ver README.md):
//  - workers (Python/offline) ESCREVEM no PostgreSQL;
//  - o app web LE do PostgreSQL/cache local;
//  - NENHUM client de DB ou API externa no render publico indexavel.
//
// Nesta fase nao ha schema real, migrations nem client: apenas o marcador abaixo.
export const DB_PLACEHOLDER = true;
