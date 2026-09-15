/**
 * service-heartbeat.ts — O SINAL DE VIDA de um processo, com a impressao digital
 * do codigo que ele carregou.
 *
 * ============================================================================
 * O QUE ESTE MODULO GRAVA, E O QUE ELE NUNCA GRAVA
 * ============================================================================
 * Uma linha por instancia em `service_heartbeats` (`hostname:pid`), atualizada a
 * cada `intervalMs`:
 *
 *   - quando o processo subiu e quando deu sinal pela ultima vez;
 *   - o digest do codigo no disco (`source-fingerprint.ts`) — a resposta a
 *     "este container roda qual commit?" que nao depende de rotulo;
 *   - memoria e CPU medidas pelo proprio processo (nao pelo container);
 *   - para cada variavel de credencial que o servico usa: NOME, se esta
 *     preenchida e o FORMATO. Nunca o valor, nunca o tamanho, nunca um pedaco.
 *
 * ============================================================================
 * NUNCA DERRUBA O SERVICO
 * ============================================================================
 * Banco fora do ar, disco ilegivel, tabela ausente (migration ainda nao
 * aplicada): tudo vira log `warn` e o servico segue. Um sinal de vida que mata o
 * processo que ele devia observar e pior que nenhum. O timer e `unref`: ele nao
 * segura o processo vivo no desligamento.
 *
 * O primeiro sinal sai IMEDIATAMENTE, sem digest (`digest_error = em_calculo`),
 * e o segundo sai quando o digest termina. Assim "o servico subiu" aparece em
 * segundos, e "qual codigo ele roda" aparece em seguida — nenhum dos dois espera
 * pelo outro.
 */

import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'

import {
  computeFingerprintFromDisk,
  findRepoRoot,
  SOURCE_FINGERPRINT_METHOD,
  type SourceFingerprint,
} from './source-fingerprint.js'

/** Intervalo entre sinais. O painel considera "sem sinal" apos 3 intervalos. */
export const HEARTBEAT_INTERVAL_MS = 60_000

/** Quantos intervalos sem sinal fazem o painel dizer "sem sinal". */
export const HEARTBEAT_SILENCE_INTERVALS = 3

/** O formato de uma credencial, como o painel pode mostrar. */
export type CredentialFormat =
  | 'ausente'
  | 'vazia'
  | 'url'
  | 'jwt'
  | 'hex'
  | 'alfanumerica'
  | 'outra'

/**
 * Classifica o FORMATO de um valor de credencial. PURA.
 *
 * Devolve so um rotulo de um conjunto FECHADO: por construcao nao ha como um
 * pedaco do valor sair daqui. O tamanho tambem nao sai — tamanho de segredo e
 * informacao sobre o segredo.
 */
export function classifyCredentialFormat(value: string | undefined): CredentialFormat {
  if (value === undefined) return 'ausente'
  const trimmed = value.trim()
  if (trimmed === '') return 'vazia'
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) return 'url'
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return 'jwt'
  if (/^[0-9a-fA-F]+$/.test(trimmed)) return 'hex'
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return 'alfanumerica'
  return 'outra'
}

/** Presenca de UMA credencial: nome, preenchida?, formato. */
export interface CredentialPresence {
  readonly name: string
  readonly present: boolean
  readonly format: CredentialFormat
}

/** Nome de variavel de ambiente valido (so o que um nome pode ser). */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/

/** Presenca das credenciais nomeadas. Nome fora do padrao e recusado (lanca). */
export function describeCredentials(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): readonly CredentialPresence[] {
  return names.map((name) => {
    if (!ENV_NAME.test(name)) throw new Error(`nome de variavel invalido: ${name}`)
    const format = classifyCredentialFormat(env[name])
    return { name, present: format !== 'ausente' && format !== 'vazia', format }
  })
}

/** A unica capacidade de banco que o sinal de vida usa. `PrismaClient` a satisfaz. */
export interface HeartbeatSqlPort {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>
}

/** O estado que vai para uma linha. */
export interface HeartbeatState {
  readonly serviceKey: string
  readonly instanceId: string
  readonly startedAt: Date
  readonly lastSeenAt: Date
  readonly fingerprint: SourceFingerprint | null
  readonly digestError: string | null
  readonly buildId: string | null
  readonly nodeVersion: string
  readonly rssBytes: number | null
  readonly heapUsedBytes: number | null
  readonly cpuPercent: number | null
  readonly credentials: readonly CredentialPresence[]
}

/** O UPSERT da linha. `timestamp` sem fuso guardando UTC, como o resto do schema. */
export const HEARTBEAT_UPSERT_SQL = `
  INSERT INTO service_heartbeats
    (service_key, instance_id, started_at, last_seen_at, digest_method, source_digest,
     source_file_count, source_bucket_digests, digest_error, build_id, node_version,
     rss_bytes, heap_used_bytes, cpu_percent, credentials)
  VALUES ($1, $2, $3::timestamptz AT TIME ZONE 'UTC', $4::timestamptz AT TIME ZONE 'UTC', $5, $6,
          $7, $8::jsonb, $9, $10, $11, $12::bigint, $13::bigint, $14, $15::jsonb)
  ON CONFLICT (service_key, instance_id) DO UPDATE SET
    last_seen_at          = EXCLUDED.last_seen_at,
    digest_method         = EXCLUDED.digest_method,
    source_digest         = EXCLUDED.source_digest,
    source_file_count     = EXCLUDED.source_file_count,
    source_bucket_digests = EXCLUDED.source_bucket_digests,
    digest_error          = EXCLUDED.digest_error,
    build_id              = EXCLUDED.build_id,
    node_version          = EXCLUDED.node_version,
    rss_bytes             = EXCLUDED.rss_bytes,
    heap_used_bytes       = EXCLUDED.heap_used_bytes,
    cpu_percent           = EXCLUDED.cpu_percent,
    credentials           = EXCLUDED.credentials`

/** Os parametros do UPSERT, na ordem. PURA — e o que o teste confere. */
export function buildHeartbeatValues(state: HeartbeatState): readonly unknown[] {
  return [
    state.serviceKey,
    state.instanceId,
    state.startedAt.toISOString(),
    state.lastSeenAt.toISOString(),
    SOURCE_FINGERPRINT_METHOD,
    state.fingerprint?.digest ?? null,
    state.fingerprint?.fileCount ?? null,
    state.fingerprint === null ? null : JSON.stringify(state.fingerprint.buckets),
    state.digestError,
    state.buildId,
    state.nodeVersion,
    state.rssBytes,
    state.heapUsedBytes,
    state.cpuPercent,
    JSON.stringify(state.credentials),
  ]
}

/** Rotulo seguro de um erro: classe e codigo de sistema. Nunca a mensagem crua. */
export function safeErrorLabel(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)
      ? `${error.name}:${code}`
      : error.name
  }
  return 'erro_desconhecido'
}

/** `.next/BUILD_ID` (ou outro arquivo de build), validado. `null` quando nao ha. */
export function readBuildId(repoRoot: string | null, buildIdFile: string | null): string | null {
  if (repoRoot === null || buildIdFile === null) return null
  const file = path.join(repoRoot, buildIdFile)
  if (!existsSync(file)) return null
  try {
    const value = readFileSync(file, 'utf8').trim()
    return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null
  } catch {
    return null
  }
}

/** Opcoes do sinal de vida. */
export interface StartServiceHeartbeatOptions {
  readonly db: HeartbeatSqlPort
  /** `screen-app`, `screen-cron`, `screen-catalog-worker`, ... */
  readonly serviceKey: string
  /** Raiz do repositorio. Omitido = procura `pnpm-workspace.yaml` a partir do cwd. */
  readonly repoRoot?: string | null
  readonly intervalMs?: number
  /** Nomes das variaveis de credencial que ESTE servico usa. So o nome sai daqui. */
  readonly credentialEnvNames?: readonly string[]
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Arquivo de identificador de build relativo a raiz (ex.: `apps/web/.next/BUILD_ID`). */
  readonly buildIdFile?: string | null
  readonly now?: () => Date
  readonly log?: (level: 'info' | 'warn', event: string, fields: Record<string, unknown>) => void
  /** Injetavel para teste. Default: `computeFingerprintFromDisk`. */
  readonly fingerprint?: (repoRoot: string) => Promise<SourceFingerprint>
}

/** O controle do sinal de vida. */
export interface ServiceHeartbeatHandle {
  readonly instanceId: string
  /** Grava um sinal agora. Nunca lanca. */
  beat(): Promise<void>
  /** A impressao pronta (espera o calculo terminar). */
  fingerprintReady(): Promise<void>
  stop(): void
}

const SERVICE_KEY = /^[a-z0-9-]+$/

/**
 * Liga o sinal de vida. Nunca lanca depois de validar as opcoes.
 */
export function startServiceHeartbeat(options: StartServiceHeartbeatOptions): ServiceHeartbeatHandle {
  if (!SERVICE_KEY.test(options.serviceKey)) {
    throw new Error(`serviceKey invalido: ${options.serviceKey}`)
  }
  const env = options.env ?? process.env
  const now = options.now ?? (() => new Date())
  const intervalMs = Math.max(5_000, Math.trunc(options.intervalMs ?? HEARTBEAT_INTERVAL_MS))
  const log = options.log ?? (() => undefined)
  const repoRoot =
    options.repoRoot === undefined ? findRepoRoot(process.cwd()) : options.repoRoot
  const instanceId = `${hostname()}:${String(process.pid)}`
  const startedAt = new Date(now().getTime() - Math.round(process.uptime() * 1000))
  const credentials = describeCredentials(options.credentialEnvNames ?? [], env)
  const buildId = readBuildId(repoRoot, options.buildIdFile ?? null)

  let fingerprint: SourceFingerprint | null = null
  let digestError: string | null =
    repoRoot === null ? 'raiz_do_repositorio_nao_encontrada' : 'em_calculo'
  let stopped = false

  let lastCpu = process.cpuUsage()
  let lastWall = Date.now()
  const sampleCpu = (): number | null => {
    const delta = process.cpuUsage(lastCpu)
    const wallMs = Date.now() - lastWall
    lastCpu = process.cpuUsage()
    lastWall = Date.now()
    if (wallMs <= 0) return null
    return Math.round(((delta.user + delta.system) / 1000 / wallMs) * 1000) / 10
  }

  const beat = async (): Promise<void> => {
    if (stopped) return
    const memory = process.memoryUsage()
    const state: HeartbeatState = {
      serviceKey: options.serviceKey,
      instanceId,
      startedAt,
      lastSeenAt: now(),
      fingerprint,
      digestError,
      buildId,
      nodeVersion: process.version,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      cpuPercent: sampleCpu(),
      credentials,
    }
    try {
      await options.db.$executeRawUnsafe(HEARTBEAT_UPSERT_SQL, ...buildHeartbeatValues(state))
    } catch (error) {
      log('warn', 'service_heartbeat_write_failed', {
        service: options.serviceKey,
        error: safeErrorLabel(error),
      })
    }
  }

  void beat()

  const compute = options.fingerprint ?? computeFingerprintFromDisk
  const ready: Promise<void> =
    repoRoot === null
      ? Promise.resolve()
      : compute(repoRoot)
          .then(async (result) => {
            fingerprint = result
            digestError = null
            log('info', 'service_heartbeat_fingerprint', {
              service: options.serviceKey,
              digest: result.digest.slice(0, 12),
              files: result.fileCount,
            })
            await beat()
          })
          .catch(async (error: unknown) => {
            digestError = `falha_no_calculo:${safeErrorLabel(error)}`
            await beat()
          })

  const timer = setInterval(() => {
    void beat()
  }, intervalMs)
  timer.unref?.()

  return {
    instanceId,
    beat,
    fingerprintReady: () => ready,
    stop: () => {
      stopped = true
      clearInterval(timer)
    },
  }
}
