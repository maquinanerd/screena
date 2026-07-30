/**
 * storage-config.ts — Resolucao do driver de storage editorial. PURO.
 *
 * Regra que da o tom do arquivo inteiro: em `production`, configuracao
 * incompleta FALHA. Nao ha fallback silencioso para filesystem.
 *
 * O motivo e concreto: no EasyPanel o disco do container e efemero. Um fallback
 * "amigavel" para filesystem faria a redacao publicar normalmente, ver a imagem
 * no ar, e perde-la no proximo deploy — com o banco ainda apontando para um
 * arquivo que nao existe mais. Falhar na subida e barulhento; perder imagem em
 * producao e silencioso e irreversivel.
 */

export const MEDIA_STORAGE_DRIVERS = ['local', 's3'] as const
export type MediaStorageDriver = (typeof MEDIA_STORAGE_DRIVERS)[number]

export interface LocalStorageConfig {
  readonly driver: 'local'
  /** Raiz no disco onde os arquivos sao gravados. */
  readonly root: string
  /** Prefixo publico servido pelo screen-app (ex.: `/media`). */
  readonly publicBasePath: string
}

export interface S3StorageConfig {
  readonly driver: 's3'
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly forcePathStyle: boolean
  readonly publicBasePath: string
}

export type MediaStorageConfig = LocalStorageConfig | S3StorageConfig

export type StorageConfigResult =
  | { readonly ok: true; readonly config: MediaStorageConfig }
  | { readonly ok: false; readonly errors: readonly string[] }

const DEFAULT_PUBLIC_BASE_PATH = '/media'

function trimmed(value: string | undefined): string {
  return (value ?? '').trim()
}

/**
 * Resolve o storage a partir do ambiente.
 *
 * Como em todo o resto do worker, NENHUMA mensagem de erro carrega valor — so o
 * nome da variavel. Uma secret key errada nao pode aparecer no journal.
 */
export function resolveMediaStorageConfig(
  env: Record<string, string | undefined>,
): StorageConfigResult {
  const errors: string[] = []
  const isProduction = trimmed(env.NODE_ENV) === 'production'
  const declared = trimmed(env.EDITORIAL_MEDIA_STORAGE_DRIVER).toLowerCase()

  const publicBasePath = trimmed(env.EDITORIAL_MEDIA_PUBLIC_BASE_PATH) || DEFAULT_PUBLIC_BASE_PATH
  if (!publicBasePath.startsWith('/')) {
    errors.push('EDITORIAL_MEDIA_PUBLIC_BASE_PATH deve ser um caminho absoluto de site')
  }

  if (declared === '') {
    // Em desenvolvimento, `local` e um default util. Em producao, adivinhar o
    // driver e exatamente como se perde midia sem perceber.
    if (isProduction) {
      return { ok: false, errors: ['EDITORIAL_MEDIA_STORAGE_DRIVER ausente em production'] }
    }
    const root = trimmed(env.EDITORIAL_MEDIA_LOCAL_ROOT)
    if (root === '') return { ok: false, errors: ['EDITORIAL_MEDIA_LOCAL_ROOT ausente'] }
    if (errors.length > 0) return { ok: false, errors }
    return { ok: true, config: { driver: 'local', root, publicBasePath } }
  }

  if (!(MEDIA_STORAGE_DRIVERS as readonly string[]).includes(declared)) {
    return { ok: false, errors: ['EDITORIAL_MEDIA_STORAGE_DRIVER desconhecido'] }
  }

  if (declared === 'local') {
    // Disco efemero em producao = midia publicada hoje e sumida no proximo
    // deploy, com o banco ainda apontando para ela.
    if (isProduction) {
      errors.push('driver local nao e aceito em production (disco efemero perde midia)')
    }
    const root = trimmed(env.EDITORIAL_MEDIA_LOCAL_ROOT)
    if (root === '') errors.push('EDITORIAL_MEDIA_LOCAL_ROOT ausente')
    if (errors.length > 0) return { ok: false, errors }
    return { ok: true, config: { driver: 'local', root, publicBasePath } }
  }

  const endpoint = trimmed(env.EDITORIAL_MEDIA_S3_ENDPOINT)
  const region = trimmed(env.EDITORIAL_MEDIA_S3_REGION) || 'auto'
  const bucket = trimmed(env.EDITORIAL_MEDIA_S3_BUCKET)
  const accessKeyId = trimmed(env.EDITORIAL_MEDIA_S3_ACCESS_KEY_ID)
  const secretAccessKey = trimmed(env.EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY)

  if (endpoint === '') errors.push('EDITORIAL_MEDIA_S3_ENDPOINT ausente')
  else if (!/^https?:\/\//i.test(endpoint)) errors.push('EDITORIAL_MEDIA_S3_ENDPOINT invalido')
  if (bucket === '') errors.push('EDITORIAL_MEDIA_S3_BUCKET ausente')
  if (accessKeyId === '') errors.push('EDITORIAL_MEDIA_S3_ACCESS_KEY_ID ausente')
  if (secretAccessKey === '') errors.push('EDITORIAL_MEDIA_S3_SECRET_ACCESS_KEY ausente')

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    config: {
      driver: 's3',
      endpoint: endpoint.replace(/\/+$/, ''),
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      // Cloudflare R2 e a maioria dos compativeis usam path-style. Default
      // `true` porque virtual-host exige DNS por bucket, que so a AWS entrega.
      forcePathStyle: trimmed(env.EDITORIAL_MEDIA_S3_FORCE_PATH_STYLE).toLowerCase() !== 'false',
      publicBasePath,
    },
  }
}
