/**
 * config.ts — Resolucao PURA do driver de armazenamento do bruto TMDB.
 *
 * Espelha `resolveMediaStorageConfig`
 * (`services/news-ingestion/src/media/storage-config.ts`), inclusive na regra
 * mais importante: NENHUMA mensagem de erro carrega VALOR de variavel, so o
 * NOME. Um resolvedor que ecoa o valor da chave secreta ao reclamar dela e um
 * vazamento.
 *
 * `postgres` e o driver de DEV/TESTE — mantido porque e o que existe hoje e o
 * que os validadores usam. Em PRODUCAO ele e RECUSADO: o disco do Postgres do
 * EasyPanel e emprestado, e `tmdb_raw.payload` cresceria nele para sempre.
 * A mesma forma de recusa que o driver `local` da midia editorial ja aplica.
 */

/** Drivers de armazenamento do payload bruto. */
export const RAW_STORE_DRIVERS = ['postgres', 'r2'] as const

/** Um driver valido. */
export type RawStoreDriver = (typeof RAW_STORE_DRIVERS)[number]

/** Configuracao do driver `postgres` (dev/teste). */
export interface PostgresRawStoreConfig {
  readonly driver: 'postgres'
  readonly baseLanguage: string
}

/** Configuracao do driver `r2` (producao). */
export interface R2RawStoreConfig {
  readonly driver: 'r2'
  readonly baseLanguage: string
  readonly endpoint: string
  readonly region: string
  readonly bucket: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly forcePathStyle: boolean
}

/** Configuracao resolvida. */
export type RawStoreConfig = PostgresRawStoreConfig | R2RawStoreConfig

/** Resultado da resolucao: ok com config, ou a lista de nomes que faltam. */
export type RawStoreConfigResult =
  | { readonly ok: true; readonly config: RawStoreConfig }
  | { readonly ok: false; readonly errors: readonly string[] }

/** Nomes das variaveis lidas. Unica fonte para documentacao e diagnostico. */
export const RAW_STORE_ENV_NAMES = {
  driver: 'TMDB_RAW_STORE_DRIVER',
  baseLanguage: 'TMDB_RAW_BASE_LANGUAGE',
  endpoint: 'TMDB_RAW_R2_ENDPOINT',
  region: 'TMDB_RAW_R2_REGION',
  bucket: 'TMDB_RAW_R2_BUCKET',
  accessKeyId: 'TMDB_RAW_R2_ACCESS_KEY_ID',
  secretAccessKey: 'TMDB_RAW_R2_SECRET_ACCESS_KEY',
  forcePathStyle: 'TMDB_RAW_R2_FORCE_PATH_STYLE',
} as const

/** Lingua base default do arquivo bruto (a mesma de `bin/sync-tmdb-raw.ts`). */
export const DEFAULT_RAW_BASE_LANGUAGE = 'pt-BR'

function readValue(env: Record<string, string | undefined>, name: string): string | null {
  const raw = env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

function readBoolean(
  env: Record<string, string | undefined>,
  name: string,
  fallback: boolean,
): boolean {
  const raw = readValue(env, name)
  if (raw === null) return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

/** True quando o ambiente e producao (mesma leitura dos gates existentes). */
function isProduction(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production'
}

/** Resolve a configuracao do store a partir do ambiente. Nao le disco nem rede. */
export function resolveRawStoreConfig(
  env: Record<string, string | undefined>,
): RawStoreConfigResult {
  const production = isProduction(env)
  const baseLanguage = readValue(env, RAW_STORE_ENV_NAMES.baseLanguage) ?? DEFAULT_RAW_BASE_LANGUAGE
  const rawDriver = readValue(env, RAW_STORE_ENV_NAMES.driver)

  if (rawDriver === null) {
    // Em producao NAO ha default: escolher armazenamento por omissao e como o
    // dado do TMDB acabaria no disco emprestado sem ninguem decidir.
    if (production) {
      return { ok: false, errors: [`${RAW_STORE_ENV_NAMES.driver} e obrigatorio em producao`] }
    }
    return { ok: true, config: { driver: 'postgres', baseLanguage } }
  }

  if (!(RAW_STORE_DRIVERS as readonly string[]).includes(rawDriver)) {
    return {
      ok: false,
      errors: [
        `${RAW_STORE_ENV_NAMES.driver} invalido; use um de: ${RAW_STORE_DRIVERS.join(', ')}`,
      ],
    }
  }
  const driver = rawDriver as RawStoreDriver

  if (driver === 'postgres') {
    if (production) {
      return {
        ok: false,
        errors: [
          `${RAW_STORE_ENV_NAMES.driver}=postgres e recusado em producao: ` +
            'o payload bruto cresceria no disco do banco. Use r2.',
        ],
      }
    }
    return { ok: true, config: { driver: 'postgres', baseLanguage } }
  }

  const errors: string[] = []
  const endpoint = readValue(env, RAW_STORE_ENV_NAMES.endpoint)
  const bucket = readValue(env, RAW_STORE_ENV_NAMES.bucket)
  const accessKeyId = readValue(env, RAW_STORE_ENV_NAMES.accessKeyId)
  const secretAccessKey = readValue(env, RAW_STORE_ENV_NAMES.secretAccessKey)

  if (endpoint === null) errors.push(`${RAW_STORE_ENV_NAMES.endpoint} e obrigatorio para driver r2`)
  if (bucket === null) errors.push(`${RAW_STORE_ENV_NAMES.bucket} e obrigatorio para driver r2`)
  if (accessKeyId === null) {
    errors.push(`${RAW_STORE_ENV_NAMES.accessKeyId} e obrigatorio para driver r2`)
  }
  if (secretAccessKey === null) {
    errors.push(`${RAW_STORE_ENV_NAMES.secretAccessKey} e obrigatorio para driver r2`)
  }
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    config: {
      driver: 'r2',
      baseLanguage,
      endpoint: endpoint as string,
      // R2 ignora a regiao, mas o SDK a exige; `auto` e o valor canonico.
      region: readValue(env, RAW_STORE_ENV_NAMES.region) ?? 'auto',
      bucket: bucket as string,
      accessKeyId: accessKeyId as string,
      secretAccessKey: secretAccessKey as string,
      // Virtual-host exigiria DNS por bucket; path-style e o default seguro.
      forcePathStyle: readBoolean(env, RAW_STORE_ENV_NAMES.forcePathStyle, true),
    },
  }
}
