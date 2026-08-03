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
import { s3Storage } from '@payloadcms/storage-s3'
import { buildConfig, type Plugin } from 'payload'
import sharp from 'sharp'

import { collections } from './collections.js'
import { requireCmsConfig } from './env.js'
import { editorialDraftsEndpoint } from './endpoints/editorial-drafts.js'
import { publicationOutboxEndpoints } from './endpoints/publication-outbox.js'
import { publicationMediaEndpoint } from './endpoints/publication-media.js'
import { contractEndpoints } from './endpoints/contracts.js'
import { editorialPublicationsEndpoint } from './endpoints/editorial-publications.js'
import { resolvePayloadUploadConfig } from './upload-storage-config.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Falha CEDO e com mensagem acionavel. Um Payload que sobe apontando para o
// banco publico causaria dano antes de qualquer teste perceber.
const { databaseUrl, secret } = requireCmsConfig()

/**
 * Storage de ORIGEM dos uploads (o arquivo que a redacao sobe pelo painel).
 *
 * NAO confundir com o storage PUBLICO (`EDITORIAL_MEDIA_*`), que guarda a copia
 * servida pelo `screen-app`. Sao papeis diferentes, com bucket, prefixo,
 * credencial e permissao separados — nenhum e fallback do outro.
 *
 * Configuracao invalida derruba o processo aqui, na subida, e nao no primeiro
 * upload da redacao. Em `production` o driver local exige confirmacao explicita
 * de volume persistente: o filesystem do container e efemero, e um default
 * "amigavel" faria a foto sumir no proximo deploy com o banco ainda apontando
 * para ela.
 */
const uploadStorage = resolvePayloadUploadConfig(process.env)
if (!uploadStorage.ok) {
  // So os NOMES das variaveis: nenhuma credencial atravessa para o log de boot.
  throw new Error(`storage de upload invalido: ${uploadStorage.errors.join('; ')}`)
}

/**
 * Plugin OFICIAL do Payload para storage S3-compatible.
 *
 * A assinatura das requisicoes fica com o `@aws-sdk/client-s3` que ele traz —
 * nao ha SigV4 escrito a mao neste caminho. Autenticacao de storage e o tipo de
 * codigo que nao se valida contra os proprios testes.
 *
 * Com driver `local` a lista fica vazia e o Payload usa o `staticDir` da
 * collection, como em desenvolvimento.
 */
const storagePlugins: Plugin[] =
  uploadStorage.config.driver === 's3'
    ? [
        s3Storage({
          collections: {
            media: {
              // Prefixo proprio do CMS: compartilhar bucket com o storage
              // publico e aceitavel, compartilhar PREFIXO nao — o worker
              // apagaria original achando que era derivada.
              prefix: uploadStorage.config.prefix,
            },
          },
          bucket: uploadStorage.config.bucket,
          config: {
            endpoint: uploadStorage.config.endpoint,
            region: uploadStorage.config.region,
            forcePathStyle: uploadStorage.config.forcePathStyle,
            credentials: {
              accessKeyId: uploadStorage.config.accessKeyId,
              secretAccessKey: uploadStorage.config.secretAccessKey,
            },
          },
        }),
      ]
    : []

export default buildConfig({
  serverURL: process.env.PAYLOAD_PUBLIC_SERVER_URL ?? 'http://localhost:3002',
  admin: {
    user: 'editorial-users',
    theme: 'light',
    dateFormat: 'dd/MM/yyyy HH:mm',
    importMap: { baseDir: path.resolve(dirname, '..') },
    components: {
      graphics: {
        Icon: '/src/admin/CinerieIcon',
        Logo: '/src/admin/CinerieLogo',
      },
      beforeDashboard: ['/src/admin/EditorialDashboard'],
    },
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
  endpoints: [
    editorialDraftsEndpoint,
    ...publicationOutboxEndpoints,
    publicationMediaEndpoint,
    ...contractEndpoints,
    editorialPublicationsEndpoint,
  ],
  plugins: storagePlugins,
  graphQL: {
    // O CMS nao expoe grafo publico: a superficie de entrada e o endpoint REST
    // interno, e a de saida e a outbox.
    disable: true,
  },
})
