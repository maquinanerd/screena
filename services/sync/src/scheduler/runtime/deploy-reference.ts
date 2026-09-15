/**
 * runtime/deploy-reference.ts — O `main` do GitHub, lido pelo AGENDADOR.
 * COBERTO pelo typecheck da raiz (`pnpm typecheck`).
 *
 * ============================================================================
 * A PERGUNTA: "O DEPLOY SUBIU?"
 * ============================================================================
 * Cada servico grava em `service_heartbeats` a impressao digital do codigo que
 * esta no disco dele (`@screena/db/source-fingerprint`). Esta fila grava em
 * `deploy_main_commits` a MESMA impressao calculada sobre a arvore de cada commit
 * recente do `main`. O painel cruza as duas: digest igual = mesmo codigo. A
 * distancia ate a cabeca do `main` sai da API de comparacao do GitHub.
 *
 * ============================================================================
 * POR QUE NO AGENDADOR, E NAO NO PAINEL
 * ============================================================================
 * O GitHub e API EXTERNA. A regra do projeto e que API externa e consumida por
 * worker offline, com registro em `api_sync_logs`, e a tela so le PostgreSQL.
 * O painel nao abre conexao com o GitHub; ele le o que esta fila gravou, com a
 * hora da leitura.
 *
 * ============================================================================
 * CUSTO E LIMITE
 * ============================================================================
 * Repositorio publico: sem token, o limite do GitHub e 60 requisicoes por hora
 * por IP. Um ciclo sem commit novo custa UMA requisicao (a lista). Commit novo
 * custa mais uma (a arvore), e cada servico cujo commit ainda nao foi comparado
 * com a cabeca custa mais uma. Os tetos por ciclo (`MAX_TREES_PER_CYCLE`,
 * `MAX_COMPARES_PER_CYCLE`) mantem o pior caso em 16. `CINERIE_GITHUB_TOKEN`, se
 * existir, so aumenta o limite; ele nunca e necessario.
 *
 * Resiliencia, como pede `.claude/rules/ingestion.md`: timeout por requisicao,
 * retry com backoff exponencial e jitter em 5xx e rede, parada do ciclo em
 * 429/limite esgotado (sem insistir), disjuntor em memoria que abre apos falhas
 * seguidas, e "cache" pelo proprio banco — commit que ja tem digest nunca e
 * buscado de novo.
 */

import {
  fingerprintFromGitTree,
  SOURCE_FINGERPRINT_METHOD,
  type GitTreeEntry,
  type SourceFingerprint,
} from '@screena/db/source-fingerprint'
import type { PrismaClient } from '@screena/db/server'

/** Fornecedor tecnico em `api_providers`. */
export const GITHUB_PROVIDER_API = 'github'

/** O repositorio. Publico; o dono pode apontar outro por `CINERIE_GITHUB_REPOSITORY`. */
export const DEFAULT_GITHUB_REPOSITORY = 'maquinanerd/screena'

/** Quantos commits do `main` cada leitura traz. */
export const MAIN_COMMITS_WINDOW = 30

/** Arvores novas por ciclo. O resto fica para o ciclo seguinte. */
export const MAX_TREES_PER_CYCLE = 10

/** Comparacoes com a cabeca por ciclo. */
export const MAX_COMPARES_PER_CYCLE = 5

/** Janela em que um sinal de vida conta como servico "vivo" para comparar. */
export const LIVE_HEARTBEAT_WINDOW_MS = 24 * 60 * 60 * 1000

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SHA = /^[0-9a-f]{40}$/

/** Erro do cliente do GitHub. `code` e curto e seguro para `api_sync_logs`. */
export class GithubRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly stopsCycle: boolean,
  ) {
    super(message)
    this.name = 'GithubRequestError'
  }
}

/** Resposta ja decodificada. */
export interface GithubResponse {
  readonly status: number
  readonly body: unknown
}

/** O que a sincronizacao precisa do GitHub. */
export interface GithubPort {
  get(pathAndQuery: string): Promise<GithubResponse>
  /** Requisicoes EMITIDAS (inclusive retentativas): o `quota_cost` real. */
  requestCount(): number
}

/** Opcoes do cliente. Tudo injetavel para teste. */
export interface GithubClientOptions {
  readonly token?: string | null
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
  readonly maxAttempts?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
  readonly failuresToOpen?: number
}

/** Cliente minimo do GitHub, GET-only. */
export function createGithubClient(options: GithubClientOptions = {}): GithubPort {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const random = options.random ?? Math.random
  const failuresToOpen = options.failuresToOpen ?? 3
  const token = options.token?.trim() ?? ''

  let requests = 0
  let consecutiveFailures = 0

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'cinerie-screen-cron',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token !== '') headers.Authorization = `Bearer ${token}`

  return {
    requestCount: () => requests,
    async get(pathAndQuery: string): Promise<GithubResponse> {
      if (consecutiveFailures >= failuresToOpen) {
        throw new GithubRequestError(
          'github_circuit_open',
          `disjuntor aberto apos ${String(consecutiveFailures)} falhas seguidas`,
          true,
        )
      }
      let lastError: GithubRequestError | null = null
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        requests += 1
        let response: Response
        try {
          response = await fetchImpl(`https://api.github.com${pathAndQuery}`, {
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          })
        } catch {
          // Mensagem de rede NAO sobe: ela poderia repetir cabecalho de pedido.
          lastError = new GithubRequestError('github_network', 'falha de rede ou timeout', false)
          if (attempt < maxAttempts) {
            await sleep(backoffMs(attempt, random))
            continue
          }
          break
        }

        const remaining = Number(response.headers.get('x-ratelimit-remaining') ?? 'NaN')
        if (response.status === 429 || (response.status === 403 && remaining === 0)) {
          consecutiveFailures += 1
          throw new GithubRequestError(
            'github_rate_limited',
            `limite do GitHub esgotado (HTTP ${String(response.status)})`,
            true,
          )
        }
        if (response.status >= 500) {
          lastError = new GithubRequestError(
            `github_http_${String(response.status)}`,
            `GitHub respondeu ${String(response.status)}`,
            false,
          )
          if (attempt < maxAttempts) {
            await sleep(backoffMs(attempt, random))
            continue
          }
          break
        }
        if (!response.ok) {
          consecutiveFailures += 1
          throw new GithubRequestError(
            `github_http_${String(response.status)}`,
            `GitHub respondeu ${String(response.status)}`,
            false,
          )
        }
        let body: unknown
        try {
          body = await response.json()
        } catch {
          consecutiveFailures += 1
          throw new GithubRequestError('github_invalid_json', 'corpo nao e JSON', false)
        }
        consecutiveFailures = 0
        return { status: response.status, body }
      }
      consecutiveFailures += 1
      throw lastError ?? new GithubRequestError('github_unknown', 'falha desconhecida', false)
    },
  }
}

/** Backoff exponencial com jitter: 500 ms, 1 s, 2 s... +/- 50%. */
export function backoffMs(attempt: number, random: () => number): number {
  const base = 500 * 2 ** Math.max(0, attempt - 1)
  return Math.round(base * (0.5 + random()))
}

/** Um commit do `main`, como a lista do GitHub o descreve. */
export interface MainCommit {
  readonly sha: string
  readonly treeSha: string
  readonly committedAt: Date
  readonly title: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Decodifica `GET /repos/:repo/commits`. Lanca em forma inesperada. */
export function parseCommitList(body: unknown): readonly MainCommit[] {
  if (!Array.isArray(body)) {
    throw new GithubRequestError('github_invalid_payload', 'lista de commits nao e array', false)
  }
  return body.map((item, index) => {
    const commit = isRecord(item) ? item.commit : undefined
    const sha = isRecord(item) ? item.sha : undefined
    const tree = isRecord(commit) ? commit.tree : undefined
    const treeSha = isRecord(tree) ? tree.sha : undefined
    const committer = isRecord(commit) ? commit.committer : undefined
    const date = isRecord(committer) ? committer.date : undefined
    const message = isRecord(commit) ? commit.message : undefined
    if (typeof sha !== 'string' || !SHA.test(sha) || typeof treeSha !== 'string' || !SHA.test(treeSha)) {
      throw new GithubRequestError('github_invalid_payload', `commit ${String(index)} sem sha valido`, false)
    }
    const committedAt = new Date(typeof date === 'string' ? date : '')
    if (!Number.isFinite(committedAt.getTime())) {
      throw new GithubRequestError('github_invalid_payload', `commit ${sha.slice(0, 7)} sem data`, false)
    }
    const title = (typeof message === 'string' ? message : '').split('\n')[0]?.trim() ?? ''
    return { sha, treeSha, committedAt, title: title.slice(0, 200) }
  })
}

/** Decodifica `GET /repos/:repo/git/trees/:sha?recursive=1`. */
export function parseTree(body: unknown): { readonly entries: readonly GitTreeEntry[]; readonly truncated: boolean } {
  if (!isRecord(body) || !Array.isArray(body.tree)) {
    throw new GithubRequestError('github_invalid_payload', 'arvore sem lista', false)
  }
  const entries: GitTreeEntry[] = []
  for (const item of body.tree) {
    if (!isRecord(item)) continue
    const { path, mode, type, sha } = item
    if (typeof path !== 'string' || typeof mode !== 'string' || typeof type !== 'string' || typeof sha !== 'string') {
      continue
    }
    entries.push({ path, mode, type, sha })
  }
  return { entries, truncated: body.truncated === true }
}

/** Decodifica `GET /repos/:repo/compare/:base...:head`. */
export function parseCompare(body: unknown): { readonly aheadBy: number } {
  if (!isRecord(body) || typeof body.ahead_by !== 'number' || body.ahead_by < 0) {
    throw new GithubRequestError('github_invalid_payload', 'comparacao sem ahead_by', false)
  }
  return { aheadBy: Math.trunc(body.ahead_by) }
}

/** O que a sincronizacao le e grava no banco. */
export interface DeployReferenceStore {
  /** Grava a lista na ordem (0 = cabeca) e tira a posicao de quem saiu da janela. */
  recordMainWindow(commits: readonly MainCommit[], readAt: Date): Promise<void>
  /** Shas da lista que ainda nao tem digest nem arvore truncada registrada. */
  commitsWithoutDigest(shas: readonly string[]): Promise<ReadonlySet<string>>
  saveDigest(sha: string, fingerprint: SourceFingerprint | null, truncated: boolean): Promise<void>
  /** Digests de servicos com sinal de vida desde `since`. */
  liveServiceDigests(since: Date): Promise<readonly string[]>
  /** Para cada digest, o commit MAIS NOVO que o tem. */
  newestCommitsForDigests(
    digests: readonly string[],
  ): Promise<ReadonlyArray<{ readonly sha: string; readonly behindHeadSha: string | null }>>
  saveBehind(sha: string, behindBy: number, headSha: string): Promise<void>
}

/** O relatorio de um ciclo. */
export interface DeployReferenceReport {
  readonly head: string | null
  readonly commitsListed: number
  readonly treesPlanned: number
  readonly treesRead: number
  readonly comparesPlanned: number
  readonly comparesRead: number
  readonly errors: ReadonlyArray<{ readonly code: string; readonly detail: string }>
}

/** Dependencias do ciclo. */
export interface DeployReferenceDeps {
  readonly github: GithubPort
  readonly store: DeployReferenceStore
  readonly repository: string
  readonly now: () => Date
  readonly maxTrees?: number
  readonly maxCompares?: number
}

function errorEntry(error: unknown): { code: string; detail: string } {
  if (error instanceof GithubRequestError) return { code: error.code, detail: error.message }
  return { code: 'deploy_reference_store_failed', detail: error instanceof Error ? error.name : 'erro' }
}

/**
 * UM ciclo: lista o `main`, calcula a impressao dos commits novos e compara com a
 * cabeca os commits que algum servico vivo esta rodando.
 */
export async function syncDeployReference(deps: DeployReferenceDeps): Promise<DeployReferenceReport> {
  if (!REPOSITORY.test(deps.repository)) {
    return {
      head: null,
      commitsListed: 0,
      treesPlanned: 0,
      treesRead: 0,
      comparesPlanned: 0,
      comparesRead: 0,
      errors: [{ code: 'github_invalid_repository', detail: 'repositorio fora do formato dono/nome' }],
    }
  }
  const errors: Array<{ code: string; detail: string }> = []
  const now = deps.now()

  let commits: readonly MainCommit[]
  try {
    const response = await deps.github.get(
      `/repos/${deps.repository}/commits?sha=main&per_page=${String(MAIN_COMMITS_WINDOW)}`,
    )
    commits = parseCommitList(response.body)
  } catch (error) {
    return {
      head: null,
      commitsListed: 0,
      treesPlanned: 0,
      treesRead: 0,
      comparesPlanned: 0,
      comparesRead: 0,
      errors: [errorEntry(error)],
    }
  }
  const head = commits[0]?.sha ?? null
  await deps.store.recordMainWindow(commits, now)

  const pending = await deps.store.commitsWithoutDigest(commits.map((c) => c.sha))
  const needTree = commits.filter((c) => pending.has(c.sha)).slice(0, deps.maxTrees ?? MAX_TREES_PER_CYCLE)
  let treesRead = 0
  let stopped = false
  for (const commit of needTree) {
    try {
      const response = await deps.github.get(
        `/repos/${deps.repository}/git/trees/${commit.treeSha}?recursive=1`,
      )
      const tree = parseTree(response.body)
      // Arvore TRUNCADA nao tem todos os arquivos: um digest dela seria de uma
      // arvore que nao existe. Registra-se o fato, e o digest fica ausente.
      await deps.store.saveDigest(
        commit.sha,
        tree.truncated ? null : fingerprintFromGitTree(tree.entries),
        tree.truncated,
      )
      treesRead += 1
    } catch (error) {
      errors.push(errorEntry(error))
      if (error instanceof GithubRequestError && error.stopsCycle) {
        stopped = true
        break
      }
    }
  }

  let comparesPlanned = 0
  let comparesRead = 0
  if (!stopped && head !== null) {
    const live = await deps.store.liveServiceDigests(new Date(now.getTime() - LIVE_HEARTBEAT_WINDOW_MS))
    const running = await deps.store.newestCommitsForDigests(live)
    const toCompare = running.filter((c) => c.behindHeadSha !== head).slice(0, deps.maxCompares ?? MAX_COMPARES_PER_CYCLE)
    comparesPlanned = toCompare.length
    for (const commit of toCompare) {
      if (commit.sha === head) {
        await deps.store.saveBehind(commit.sha, 0, head)
        comparesRead += 1
        continue
      }
      try {
        const response = await deps.github.get(`/repos/${deps.repository}/compare/${commit.sha}...${head}`)
        await deps.store.saveBehind(commit.sha, parseCompare(response.body).aheadBy, head)
        comparesRead += 1
      } catch (error) {
        errors.push(errorEntry(error))
        if (error instanceof GithubRequestError && error.stopsCycle) break
      }
    }
  }

  return {
    head,
    commitsListed: commits.length,
    treesPlanned: needTree.length,
    treesRead,
    comparesPlanned,
    comparesRead,
    errors,
  }
}

/** A capacidade de banco que o store usa. */
export type DeployReferenceDb = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

/** O store sobre PostgreSQL. */
export function createPrismaDeployReferenceStore(db: DeployReferenceDb): DeployReferenceStore {
  return {
    async recordMainWindow(commits, readAt) {
      const readAtIso = readAt.toISOString()
      for (const [position, commit] of commits.entries()) {
        await db.$executeRawUnsafe(
          `INSERT INTO deploy_main_commits
             (commit_sha, committed_at, title, main_position, digest_method, positions_read_at)
           VALUES ($1, $2::timestamptz AT TIME ZONE 'UTC', $3, $4, $5, $6::timestamptz AT TIME ZONE 'UTC')
           ON CONFLICT (commit_sha) DO UPDATE SET
             main_position = EXCLUDED.main_position,
             positions_read_at = EXCLUDED.positions_read_at`,
          commit.sha,
          commit.committedAt.toISOString(),
          commit.title,
          position,
          SOURCE_FINGERPRINT_METHOD,
          readAtIso,
        )
      }
      // Quem saiu da janela perde a posicao: "posicao 3" de uma leitura antiga
      // afirmaria uma distancia que ja nao e verdade.
      await db.$executeRawUnsafe(
        `UPDATE deploy_main_commits
            SET main_position = NULL, positions_read_at = $1::timestamptz AT TIME ZONE 'UTC'
          WHERE main_position IS NOT NULL
            AND NOT (commit_sha = ANY($2::text[]))`,
        readAtIso,
        commits.map((c) => c.sha),
      )
    },
    async commitsWithoutDigest(shas) {
      if (shas.length === 0) return new Set()
      const rows = await db.$queryRawUnsafe<Array<{ commit_sha: string }>>(
        `SELECT commit_sha FROM deploy_main_commits
          WHERE commit_sha = ANY($1::text[])
            AND source_digest IS NULL
            AND tree_truncated = false`,
        [...shas],
      )
      return new Set(rows.map((r) => r.commit_sha))
    },
    async saveDigest(sha, fingerprint, truncated) {
      await db.$executeRawUnsafe(
        `UPDATE deploy_main_commits
            SET source_digest = $1, source_file_count = $2, source_bucket_digests = $3::jsonb,
                tree_truncated = $4, digest_method = $5
          WHERE commit_sha = $6`,
        fingerprint?.digest ?? null,
        fingerprint?.fileCount ?? null,
        fingerprint === null ? null : JSON.stringify(fingerprint.buckets),
        truncated,
        SOURCE_FINGERPRINT_METHOD,
        sha,
      )
    },
    async liveServiceDigests(since) {
      const rows = await db.$queryRawUnsafe<Array<{ source_digest: string }>>(
        `SELECT DISTINCT source_digest FROM service_heartbeats
          WHERE source_digest IS NOT NULL
            AND digest_method = $1
            AND last_seen_at >= $2::timestamptz AT TIME ZONE 'UTC'`,
        SOURCE_FINGERPRINT_METHOD,
        since.toISOString(),
      )
      return rows.map((r) => r.source_digest)
    },
    async newestCommitsForDigests(digests) {
      if (digests.length === 0) return []
      const rows = await db.$queryRawUnsafe<Array<{ commit_sha: string; behind_head_sha: string | null }>>(
        `SELECT DISTINCT ON (source_digest) commit_sha, behind_head_sha
           FROM deploy_main_commits
          WHERE source_digest = ANY($1::text[])
          ORDER BY source_digest, main_position ASC NULLS LAST, committed_at DESC`,
        [...digests],
      )
      return rows.map((r) => ({ sha: r.commit_sha, behindHeadSha: r.behind_head_sha }))
    },
    async saveBehind(sha, behindBy, headSha) {
      await db.$executeRawUnsafe(
        `UPDATE deploy_main_commits SET behind_head_by = $1, behind_head_sha = $2 WHERE commit_sha = $3`,
        behindBy,
        headSha,
        sha,
      )
    },
  }
}
