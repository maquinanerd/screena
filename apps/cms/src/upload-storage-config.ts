/**
 * upload-storage-config.ts — Onde o Payload GUARDA o upload da redacao. PURO.
 *
 * ATENCAO A DISTINCAO. Este arquivo trata do storage de ORIGEM (o arquivo que a
 * redacao subiu pelo painel). O storage PUBLICO — a copia que o `screen-app`
 * serve — e outro, mora em `services/news-ingestion/src/media/storage-config.ts`
 * e usa o prefixo `EDITORIAL_MEDIA_*`.
 *
 * Sao dois papeis distintos e as variaveis NAO se misturam: nenhum dos dois
 * serve de fallback do outro. Podem um dia compartilhar infraestrutura, mas
 * bucket, prefixo, credencial e permissao continuam separados — o CMS precisa
 * escrever no seu; o worker so precisa ler de la e escrever no publico.
 *
 * A regra que da o tom: em `production`, disco local NAO e aceito por descuido.
 * O container do EasyPanel tem filesystem efemero; um default "amigavel" faria a
 * redacao subir a foto, ve-la no painel e perde-la no proximo deploy — com o
 * documento no banco ainda apontando para um arquivo que nao existe mais.
 */

export const PAYLOAD_UPLOAD_DRIVERS = ['local', 's3'] as const
export type PayloadUploadDriver = (typeof PAYLOAD_UPLOAD_DRIVERS)[number]

export interface PayloadLocalUploadConfig {
  readonly driver: 'local'
  /** Raiz ABSOLUTA dos uploads. */
  readonly root: string
  /**
   * O operador declarou que esta raiz esta num volume PERSISTENTE?
   *
   * Em `production` isso e obrigatorio. A flag nao prova nada sozinha — ela
   * registra uma DECISAO consciente. A prova de que o EasyPanel montou o volume
   * e do runbook, na implantacao.
   */
  readonly persistenceConfirmed: boolean
}

export interface PayloadS3UploadConfig {
  readonly driver: 's3'
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly forcePathStyle: boolean
  /** Prefixo do CMS dentro do bucket. Separado do prefixo do storage publico. */
  readonly prefix: string
}

export type PayloadUploadConfig = PayloadLocalUploadConfig | PayloadS3UploadConfig

export type PayloadUploadConfigResult =
  | { readonly ok: true; readonly config: PayloadUploadConfig }
  | { readonly ok: false; readonly errors: readonly string[] }

/**
 * Diretorios que nao sobrevivem a um restart de container.
 *
 * Nao e uma lista exaustiva — nao da para reconhecer todo filesystem efemero de
 * fora. E uma rede para os casos OBVIOS, porque apontar uploads de producao para
 * `/tmp` e um erro silencioso que so aparece semanas depois, quando alguem nota
 * que as fotos antigas sumiram.
 */
const EPHEMERAL_PREFIXES = [
  '/tmp/',
  '/var/tmp/',
  '/dev/shm/',
  '/run/',
  '/app/.next/',
  '/app/node_modules/',
]

function trimmed(value: string | undefined): string {
  return (value ?? '').trim()
}

function isAbsolutePosixOrWindows(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

function looksEphemeral(root: string): boolean {
  const normalized = root.replace(/\\/g, '/').toLowerCase()
  const withSlash = normalized.endsWith('/') ? normalized : `${normalized}/`
  return EPHEMERAL_PREFIXES.some((prefix) => withSlash.startsWith(prefix))
}

/**
 * Resolve o storage de upload do Payload a partir do ambiente.
 *
 * Nenhuma mensagem de erro carrega VALOR — so o nome da variavel. Uma secret
 * key errada nao pode virar linha de log num painel de deploy.
 */
export function resolvePayloadUploadConfig(
  env: Record<string, string | undefined>,
): PayloadUploadConfigResult {
  const errors: string[] = []
  const isProduction = trimmed(env.NODE_ENV) === 'production'
  const declared = trimmed(env.PAYLOAD_UPLOAD_STORAGE_DRIVER).toLowerCase()

  if (declared !== '' && !(PAYLOAD_UPLOAD_DRIVERS as readonly string[]).includes(declared)) {
    return { ok: false, errors: ['PAYLOAD_UPLOAD_STORAGE_DRIVER desconhecido'] }
  }

  // Em producao NAO ha default. Adivinhar o driver e como se perde midia sem
  // ninguem perceber; em desenvolvimento, `local` e uma conveniencia legitima.
  if (declared === '' && isProduction) {
    return { ok: false, errors: ['PAYLOAD_UPLOAD_STORAGE_DRIVER ausente em production'] }
  }

  if (declared === 's3') {
    const endpoint = trimmed(env.PAYLOAD_UPLOAD_S3_ENDPOINT)
    const bucket = trimmed(env.PAYLOAD_UPLOAD_S3_BUCKET)
    const accessKeyId = trimmed(env.PAYLOAD_UPLOAD_S3_ACCESS_KEY_ID)
    const secretAccessKey = trimmed(env.PAYLOAD_UPLOAD_S3_SECRET_ACCESS_KEY)

    if (endpoint === '') errors.push('PAYLOAD_UPLOAD_S3_ENDPOINT ausente')
    else if (!/^https?:\/\//i.test(endpoint)) errors.push('PAYLOAD_UPLOAD_S3_ENDPOINT invalido')
    if (bucket === '') errors.push('PAYLOAD_UPLOAD_S3_BUCKET ausente')
    if (accessKeyId === '') errors.push('PAYLOAD_UPLOAD_S3_ACCESS_KEY_ID ausente')
    if (secretAccessKey === '') errors.push('PAYLOAD_UPLOAD_S3_SECRET_ACCESS_KEY ausente')
    if (errors.length > 0) return { ok: false, errors }

    return {
      ok: true,
      config: {
        driver: 's3',
        endpoint: endpoint.replace(/\/+$/, ''),
        region: trimmed(env.PAYLOAD_UPLOAD_S3_REGION) || 'auto',
        bucket,
        accessKeyId,
        secretAccessKey,
        // Path-style e o default: virtual-host exige DNS por bucket, que so a
        // AWS entrega. R2 e MinIO usam path-style.
        forcePathStyle: trimmed(env.PAYLOAD_UPLOAD_S3_FORCE_PATH_STYLE).toLowerCase() !== 'false',
        // Prefixo proprio do CMS. Compartilhar bucket com o storage publico e
        // aceitavel; compartilhar PREFIXO nao — o worker apagaria original
        // achando que era derivada.
        prefix: trimmed(env.PAYLOAD_UPLOAD_S3_PREFIX) || 'cms-uploads',
      },
    }
  }

  const root = trimmed(env.PAYLOAD_UPLOAD_LOCAL_ROOT)
  const persistenceConfirmed =
    trimmed(env.PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED).toLowerCase() === 'true'

  if (root === '') {
    errors.push('PAYLOAD_UPLOAD_LOCAL_ROOT ausente')
  } else if (!isAbsolutePosixOrWindows(root)) {
    // Caminho relativo resolve contra o CWD DO PROCESSO — foi exatamente assim
    // que a FASE 2D perdeu arquivos entre a Local API e o servidor.
    errors.push('PAYLOAD_UPLOAD_LOCAL_ROOT deve ser caminho ABSOLUTO')
  }

  if (isProduction) {
    if (!persistenceConfirmed) {
      errors.push(
        'driver local em production exige PAYLOAD_UPLOAD_LOCAL_PERSISTENT_CONFIRMED=true',
      )
    }
    if (root !== '' && looksEphemeral(root)) {
      errors.push('PAYLOAD_UPLOAD_LOCAL_ROOT aponta para diretorio efemero conhecido')
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, config: { driver: 'local', root, persistenceConfirmed } }
}

/**
 * Resumo SEGURO para health/readiness e log.
 *
 * Nunca inclui caminho completo, bucket, endpoint ou credencial: um readiness e
 * lido por quem estiver com o painel aberto, e as vezes por quem nao deveria
 * conhecer a topologia da infraestrutura.
 */
export function describeUploadConfig(config: PayloadUploadConfig): {
  readonly driver: PayloadUploadDriver
  readonly persistent: boolean
} {
  return {
    driver: config.driver,
    persistent: config.driver === 's3' ? true : config.persistenceConfirmed,
  }
}
