/**
 * payload.config.ts — Configuracao do CMS editorial da Cinerie.
 *
 * ISOLAMENTO (ADR 0015): banco proprio via `PAYLOAD_DATABASE_URL`, migrations
 * proprias em `src/migrations`, nenhuma importacao de Prisma ou `@screena/db`,
 * e nenhuma leitura por parte do render publico. O `screen-app` nunca consulta
 * este servico; a comunicacao acontece por `publication-event-v1` na outbox.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig } from 'payload'
import sharp from 'sharp'

import { collections } from './collections.js'
import { requireCmsConfig } from './env.js'
import { editorialDraftsEndpoint } from './endpoints/editorial-drafts.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Falha CEDO e com mensagem acionavel. Um Payload que sobe apontando para o
// banco publico causaria dano antes de qualquer teste perceber.
const { databaseUrl, secret } = requireCmsConfig()

export default buildConfig({
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL ?? 'http://localhost:3002',
  admin: {
    user: 'editorial-users',
    importMap: { baseDir: path.resolve(dirname, '..') },
  },
  collections,
  editor: lexicalEditor(),
  secret,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: { connectionString: databaseUrl },
    // Migrations versionadas no repositorio, nunca `push` implicito: o schema do
    // CMS e revisavel como qualquer outra mudanca de banco.
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  sharp,
  endpoints: [editorialDraftsEndpoint],
  graphQL: {
    // O CMS nao expoe grafo publico: a superficie de entrada e o endpoint REST
    // interno, e a de saida e a outbox.
    disable: true,
  },
})
