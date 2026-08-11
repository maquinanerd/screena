/**
 * config.ts — Configuracao PURA do servico de catalogo.
 *
 * Le um `Record<string, string|undefined>` (nunca `process.env` direto) para
 * poder ser testada. FAIL-LOUD: valor presente porem invalido e ERRO, nunca
 * fallback silencioso para o default — um `CATALOG_WORKER_CONCURRENCY=quatro`
 * que virasse `4` esconderia um erro de deploy para sempre.
 *
 * NENHUM valor de segredo e guardado aqui: a config carrega apenas a PRESENCA
 * das credenciais (booleano). A connection string e o token seguem sendo lidos
 * pelos seus proprios modulos, e nunca sao ecoados.
 */

/** Config resolvida do servico. */
export interface CatalogWorkerServiceConfig {
  readonly healthPort: number
  readonly concurrency: number
  readonly jobTimeoutMs: number
  readonly pollIntervalMs: number
  /** Intervalo entre descobertas por Daily ID Export. */
  readonly discoveryIntervalMs: number
  /** Intervalo entre ciclos de `/changes` incremental. */
  readonly changesIntervalMs: number
  /** Teto de ids por tipo em cada descoberta. `null` = sem teto. */
  readonly discoveryLimit: number | null
  /** Tipos descobertos a cada ciclo. */
  readonly discoveryKinds: readonly ('movie' | 'tv' | 'person')[]
  readonly locale: string
  readonly isProduction: boolean
  readonly productionWriteAuthorized: boolean
  readonly hasDatabaseUrl: boolean
  readonly hasTmdbCredential: boolean
  readonly workerId: string
}

/** Erro de configuracao. Mensagem nunca cita valor de segredo. */
export class CatalogWorkerConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CatalogWorkerConfigError'
  }
}

type Env = Readonly<Record<string, string | undefined>>

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) {
    throw new CatalogWorkerConfigError(`${name} deve ser um inteiro (recebido: nao-inteiro).`)
  }
  if (parsed < min || parsed > max) {
    throw new CatalogWorkerConfigError(`${name} fora da faixa permitida [${min}, ${max}].`)
  }
  return parsed
}

/** `true`/`false` explicitos. Qualquer outra coisa e erro (nunca "quase true"). */
function readBool(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new CatalogWorkerConfigError(`${name} aceita apenas "true" ou "false".`)
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0
}

const VALID_KINDS = new Set(['movie', 'tv', 'person'])

function readKinds(env: Env): readonly ('movie' | 'tv' | 'person')[] {
  const raw = env.CATALOG_WORKER_DISCOVERY_KINDS
  if (!present(raw)) return ['movie', 'tv', 'person']
  const parts = raw!
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length === 0) {
    throw new CatalogWorkerConfigError('CATALOG_WORKER_DISCOVERY_KINDS vazio apos o parse.')
  }
  for (const part of parts) {
    if (!VALID_KINDS.has(part)) {
      throw new CatalogWorkerConfigError(
        `CATALOG_WORKER_DISCOVERY_KINDS: "${part}" invalido (use movie, tv ou person).`,
      )
    }
  }
  return [...new Set(parts)] as readonly ('movie' | 'tv' | 'person')[]
}

/**
 * Resolve a config do servico.
 *
 * `discoveryLimit` merece atencao: `0` significa SEM TETO (o universo inteiro
 * daquele tipo), e nao "nenhum id". Um teto de 0 que enfileirasse nada seria um
 * servico que sobe saudavel e nunca trabalha — a falha silenciosa mais cara que
 * existe num worker.
 */
export function resolveCatalogWorkerServiceConfig(env: Env): CatalogWorkerServiceConfig {
  const discoveryLimitRaw = readInt(env, 'CATALOG_WORKER_DISCOVERY_LIMIT', 2000, 0, 10_000_000)

  return {
    healthPort: readInt(env, 'CATALOG_WORKER_HEALTH_PORT', 3004, 1, 65_535),
    concurrency: readInt(env, 'CATALOG_WORKER_CONCURRENCY', 4, 1, 32),
    jobTimeoutMs: readInt(env, 'CATALOG_WORKER_JOB_TIMEOUT_MS', 120_000, 5_000, 900_000),
    pollIntervalMs: readInt(env, 'CATALOG_WORKER_POLL_INTERVAL_MS', 1_000, 100, 60_000),
    // 24h: os Daily ID Exports sao publicados uma vez por dia (~08:00 UTC).
    // Descobrir com mais frequencia baixaria o MESMO arquivo de novo.
    discoveryIntervalMs: readInt(
      env,
      'CATALOG_WORKER_DISCOVERY_INTERVAL_MS',
      24 * 60 * 60 * 1000,
      60_000,
      7 * 24 * 60 * 60 * 1000,
    ),
    // 6h: a janela default do `/changes` do TMDB e ~24h e o maximo e 14 dias;
    // rodar a cada 6h mantem folga de sobra contra um ciclo perdido.
    changesIntervalMs: readInt(
      env,
      'CATALOG_WORKER_CHANGES_INTERVAL_MS',
      6 * 60 * 60 * 1000,
      60_000,
      14 * 24 * 60 * 60 * 1000,
    ),
    discoveryLimit: discoveryLimitRaw === 0 ? null : discoveryLimitRaw,
    discoveryKinds: readKinds(env),
    locale: present(env.CATALOG_WORKER_LOCALE) ? env.CATALOG_WORKER_LOCALE!.trim() : 'pt-BR',
    isProduction: env.NODE_ENV === 'production',
    productionWriteAuthorized: readBool(
      env,
      'CINERIE_CATALOG_WORKER_PRODUCTION_CONFIRMED',
      false,
    ),
    hasDatabaseUrl: present(env.DATABASE_URL),
    // O client TMDB aceita o token v4 (preferencial) ou a api key v3.
    hasTmdbCredential: present(env.TMDB_READ_ACCESS_TOKEN) || present(env.TMDB_API_KEY),
    workerId: present(env.CATALOG_WORKER_ID) ? env.CATALOG_WORKER_ID!.trim() : 'cinerie-catalog-worker-1',
  }
}
