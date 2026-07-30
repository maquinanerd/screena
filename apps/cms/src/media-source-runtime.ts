/**
 * media-source-runtime.ts — Fabrica do `PayloadMediaSource` do processo.
 *
 * Separado de `media-source.ts` porque este arquivo IMPORTA o SDK da AWS, e o
 * modulo de contrato precisa continuar carregavel (e testavel) sem ele. Aqui
 * mora a unica ligacao entre a porta e o mundo.
 *
 * O cliente e criado UMA vez por processo: cada `S3Client` mantem pool de
 * conexoes e cadeia de credenciais propria, e instanciar um por requisicao
 * transformaria cada leitura de imagem num handshake novo.
 */

import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'

import {
  createLocalMediaSource,
  createS3MediaSource,
  type PayloadMediaSource,
  type S3CommandFactory,
} from './media-source.js'
import {
  resolvePayloadUploadConfig,
  type PayloadUploadConfig,
} from './upload-storage-config.js'

const commands: S3CommandFactory = {
  getObject: (input) => new GetObjectCommand(input),
  headObject: (input) => new HeadObjectCommand(input),
}

let cached: { config: PayloadUploadConfig; source: PayloadMediaSource } | null = null

export function createMediaSource(config: PayloadUploadConfig): PayloadMediaSource {
  if (config.driver === 'local') return createLocalMediaSource(config.root)

  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
  return createS3MediaSource(config, client, commands)
}

/**
 * Fonte de midia do processo, criada sob demanda.
 *
 * Devolve `null` quando a configuracao e invalida — e o endpoint responde
 * indisponivel em vez de estourar. Configuracao errada nunca vira 500 com stack.
 */
export function getMediaSource(
  env: Record<string, string | undefined> = process.env,
): PayloadMediaSource | null {
  const resolved = resolvePayloadUploadConfig(env)
  if (!resolved.ok) return null
  if (cached !== null && cached.config.driver === resolved.config.driver) return cached.source
  const source = createMediaSource(resolved.config)
  cached = { config: resolved.config, source }
  return source
}

/** So para teste: descarta o cliente memoizado entre cenarios. */
export function resetMediaSourceCache(): void {
  cached = null
}
