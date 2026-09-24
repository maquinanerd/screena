/**
 * run.ts — Execucao do incremental TMDB `/changes` (Backend A §4).
 *
 * O planner (`discovery/changes-plan.ts`) ja existia e so montava a requisicao.
 * Aqui esta a EXECUCAO: pagina a lista de mudancas, enfileira o re-sync dos ids
 * alterados e avanca o checkpoint.
 *
 * INVARIANTE CENTRAL: o checkpoint SO avanca depois do COMMIT do lote. Enfileirar
 * os jobs da pagina e gravar o checkpoint acontecem na MESMA transacao
 * (`ChangesCheckpointPort.commit`). Se o processo morre no meio de uma pagina, o
 * checkpoint continua na pagina anterior e a retomada reprocessa aquela pagina —
 * seguro porque o enqueue e idempotente (idempotency_key deterministica).
 *
 * SO RE-SINCRONIZA O QUE JA E NOSSO (2026-09-24). `/changes` e a lista de TODO
 * id que mudou no TMDB — nao a lista do nosso catalogo. Ate esta data cada id
 * da pagina virava um `sync_details`, e o `sync_details` de um id que nao
 * existia CRIAVA o titulo: o incremental de manutencao era, na pratica, a maior
 * porta de ENTRADA do catalogo. Medido em producao em 24/09/2026: ~2.090 titulos
 * novos por dia, 96% com menos de 100 votos no TMDB, 2/3 de fora dos EUA e 5
 * populares em 7 dias. Agora a pagina passa pela porta `catalog` antes de virar
 * job: id que nao esta em `movies`/`tv_shows`/`people` (por `tmdb_id`) e
 * DESCARTADO e CONTADO. Titulo novo entra por quem foi feito para isso — a
 * descoberta diaria (`reason: 'discovery'`) e o pedido de leitor
 * (`reason: 'on_demand'`) —, nao por "alguem editou esse id no TMDB hoje".
 *
 * Pessoa segue a MESMA regra, e nao por simetria: `sync_details` de pessoa cai
 * em `importPerson` -> `upsertPerson`, que e um upsert por `tmdb_id` SEM porta de
 * admissao — cria a pessoa se ela nao existe. Sem o filtro, toda pessoa editada
 * no TMDB virava linha em `people`. As pessoas do catalogo continuam cobertas:
 * elas nascem como stub pelo elenco/equipe dos titulos, e o stub TEM `tmdb_id`.
 *
 * NADA SILENCIOSO: cada kind grava UMA linha em `api_sync_logs` por ciclo
 * (`/movie/changes`, `/tv/changes`, `/person/changes`) com
 *   items_processed = ids que vieram do TMDB,
 *   items_updated   = ids que ja estao no catalogo (pedidos para re-sync),
 *   items_created   = jobs `sync_details` criados de fato (apos idempotencia),
 * e os descartados por nao estarem no catalogo sao
 * `items_processed - items_updated` — tambem no relatorio do job
 * (`discardedNotInCatalog`) e no log estruturado.
 *
 * PURO de IO proprio: fetch, checkpoint, catalogo, sync log, relogio e metricas
 * sao injetados.
 */

import { CATALOG_METRIC_NAMES, type MetricsSink } from '../metrics/index.js'
import { buildCoverageJob } from '../entity-coverage/entry.js'
import type { EnqueueCatalogJobInput } from '../catalog-jobs/store-port.js'
import type { StructuredLogger } from '../catalog-jobs/handler.js'
import type { SyncLogPort, SyncStatus } from '../ports.js'
import {
  CHANGES_MAX_WINDOW_DAYS,
  formatChangesDate,
  type ChangesKind,
} from '../discovery/changes-plan.js'

/** Estado persistido do checkpoint de changes. */
export interface ChangesCheckpointState {
  readonly lastPage: number
  readonly totalPages: number | null
  readonly done: boolean
  /** Janela ja processada, ex.: "2026-07-10:2026-07-16". */
  readonly cursor: string | null
}

/** Commit ATOMICO: jobs do lote + avanco do checkpoint na mesma transacao. */
export interface ChangesCommitInput {
  readonly job: string
  readonly paramsHash: string
  readonly lastPage: number
  readonly totalPages: number | null
  readonly done: boolean
  readonly cursor: string
  readonly enqueue: readonly EnqueueCatalogJobInput[]
}

/** Porta do checkpoint de changes. */
export interface ChangesCheckpointPort {
  read(job: string, paramsHash: string): Promise<ChangesCheckpointState | null>
  /**
   * Grava os jobs E o checkpoint numa UNICA transacao. Retorna quantos jobs
   * foram criados de fato (enqueue repetido = noop idempotente).
   */
  commit(input: ChangesCommitInput): Promise<{ enqueued: number }>
}

/**
 * Porta do CATALOGO: quais destes ids JA existem na tabela do kind
 * (`movies`/`tv_shows`/`people`, por `tmdb_id`).
 *
 * UMA consulta em lote por pagina (`tmdb_id IN (...)`, ate 100 ids, indice
 * unico). Se ela falhar, a excecao sobe ANTES do commit — o checkpoint nao
 * avanca e a retomada reprocessa a pagina, igual a uma falha de commit.
 */
export interface ChangesCatalogPort {
  existingTmdbIds(kind: ChangesKind, tmdbIds: readonly number[]): Promise<ReadonlySet<number>>
}

/** Uma pagina de `/changes` (subconjunto defensivo). */
export interface ChangesPage {
  readonly results?: ReadonlyArray<{ id?: number | null; adult?: boolean | null }>
  readonly page?: number | null
  readonly total_pages?: number | null
}

/** Dependencias do executor. */
export interface ChangesRunDeps {
  fetchChanges(
    kind: ChangesKind,
    params: { start_date: string; end_date: string; page: number },
  ): Promise<ChangesPage>
  readonly checkpoint: ChangesCheckpointPort
  /** Filtro de entrada: so vira job o id que ja esta no catalogo. */
  readonly catalog: ChangesCatalogPort
  /** `api_sync_logs`: uma linha por kind por ciclo (todo sync externo gera log). */
  readonly syncLog: SyncLogPort
  readonly metrics: MetricsSink
  readonly log?: StructuredLogger
  readonly now?: () => Date
  /**
   * Aborta o ciclo (timeout do job ou shutdown).
   *
   * Sem isto, o worker vencia a corrida do timeout e marcava o job para retry,
   * mas ESTE loop continuava rodando: o job era reivindicado de novo (~1s de
   * backoff) e os dois passavam a paginar em paralelo, ambos gravando
   * checkpoint. Como `commit` sobrescreve `lastPage` sem guarda de
   * monotonicidade, o zumbi regredia o checkpoint (e reabria uma janela ja
   * `done`), multiplicando cota do provider a cada timeout.
   */
  readonly signal?: AbortSignal
}

/** Opcoes de um ciclo de changes. */
export interface ChangesRunOptions {
  readonly kinds?: readonly ChangesKind[]
  /** Inicio da janela (default: end - 1 dia). */
  readonly from?: Date
  /** Fim da janela (default: agora). */
  readonly to?: Date
  /** Teto de paginas por kind (piloto/CI). */
  readonly maxPages?: number
  /** Retoma do checkpoint (default true). false => recomeca a janela. */
  readonly resume?: boolean
  readonly runId?: string
  /** Idioma propagado ao payload dos jobs de re-sync (default pt-BR). */
  readonly locale?: string
}

/** Relatorio por kind. */
export interface ChangesKindReport {
  readonly kind: ChangesKind
  readonly pages: number
  /** Ids que vieram do TMDB (validos, sem adulto, deduplicados por pagina). */
  readonly changedIds: number
  /** Desses, quantos ja estavam no catalogo (pedidos para re-sync). */
  readonly inCatalog: number
  /** Descartados por NAO estarem no catalogo (`changedIds - inCatalog`). */
  readonly discardedNotInCatalog: number
  /** Jobs `sync_details` criados de fato (enqueue repetido = noop). */
  readonly enqueued: number
  readonly done: boolean
  readonly skipped: boolean
}

/** Relatorio do ciclo. */
export interface ChangesRunReport {
  readonly window: { readonly from: string; readonly to: string }
  readonly kinds: readonly ChangesKindReport[]
  readonly totalEnqueued: number
  readonly totalDiscardedNotInCatalog: number
}

const DEFAULT_KINDS: readonly ChangesKind[] = ['movie', 'tv', 'person']
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Teto duro de paginas por kind num ciclo (safety valve).
 *
 * Existe para o caso do provider omitir/zerar `total_pages`: sem ele o laco nao
 * teria saida alcancavel. 500 paginas x 100 itens = 50k mudancas por kind numa
 * janela — folgado para 24h, e finito.
 */
const HARD_PAGE_CEILING = 500

/** Lanca `AbortError` quando o ciclo foi abortado (timeout do job/shutdown). */
function throwIfChangesAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const error = new Error('ciclo de changes abortado')
    error.name = 'AbortError'
    throw error
  }
}

/** Endpoint do TMDB de um kind — e o `endpoint` da linha em `api_sync_logs`. */
export function changesEndpoint(kind: ChangesKind): string {
  return `/${kind}/changes`
}

/**
 * Status da linha de `api_sync_logs` de um kind que terminou sem excecao.
 *
 * `empty` quando o TMDB nao listou id nenhum; `partial` quando o ciclo parou
 * antes do fim da janela (teto de paginas) — o checkpoint retoma dali; senao
 * `success`. Descartar id fora do catalogo NAO e falha nem parcialidade: e a
 * regra funcionando.
 */
export function changesLogStatus(changedIds: number, done: boolean): SyncStatus {
  if (changedIds === 0 && done) return 'empty'
  return done ? 'success' : 'partial'
}

/** Nome canonico do job de checkpoint (espelha `job='changes:movie'` do schema). */
export function changesJobName(kind: ChangesKind): string {
  return `changes:${kind}`
}

/** Hash estavel dos params da janela (identidade do checkpoint). */
export function changesParamsHash(from: string, to: string): string {
  return `${from}:${to}`
}

/**
 * Extrai os ids alterados de uma pagina. Descarta id invalido e, por seguranca
 * (fail-closed), qualquer item marcado `adult: true`.
 */
export function extractChangedIds(page: ChangesPage): number[] {
  const results = Array.isArray(page.results) ? page.results : []
  const ids: number[] = []
  for (const item of results) {
    if (item === null || typeof item !== 'object') continue
    if (item.adult === true) continue // nunca enfileira conteudo adulto
    const id = item.id
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) continue
    ids.push(id)
  }
  return [...new Set(ids)]
}

/** Deriva a janela [from, to], respeitando o maximo de 14 dias do TMDB. */
export function resolveWindow(options: ChangesRunOptions, now: Date): { from: Date; to: Date } {
  const to = options.to ?? now
  const from = options.from ?? new Date(to.getTime() - DAY_MS)
  const maxMs = CHANGES_MAX_WINDOW_DAYS * DAY_MS
  // Janela maior que o teto do TMDB e truncada pelo inicio (nunca lanca).
  const clampedFrom = to.getTime() - from.getTime() > maxMs ? new Date(to.getTime() - maxMs) : from
  return { from: clampedFrom, to }
}

/**
 * Executa o incremental de changes para os kinds pedidos.
 *
 * Por pagina: busca -> extrai ids -> monta os jobs de re-sync -> COMMIT ATOMICO
 * (jobs + checkpoint). O checkpoint nunca avanca sem o lote ter sido gravado.
 */
export async function runChangesSync(
  deps: ChangesRunDeps,
  options: ChangesRunOptions = {},
): Promise<ChangesRunReport> {
  const now = deps.now ?? (() => new Date())
  const kinds = options.kinds ?? DEFAULT_KINDS
  const resume = options.resume ?? true
  const runId = options.runId ?? 'catalog-changes'
  const locale = options.locale ?? 'pt-BR'
  const { from, to } = resolveWindow(options, now())
  const startDate = formatChangesDate(from)
  const endDate = formatChangesDate(to)
  const paramsHash = changesParamsHash(startDate, endDate)
  const cursor = paramsHash

  const reports: ChangesKindReport[] = []
  let totalEnqueued = 0
  let totalDiscardedNotInCatalog = 0

  for (const kind of kinds) {
    const job = changesJobName(kind)
    const state = resume ? await deps.checkpoint.read(job, paramsHash) : null

    // Janela ja concluida: repetir e noop (idempotencia de janela). Nenhuma
    // chamada ao TMDB acontece, entao tambem nao ha linha de sync log.
    if (state?.done === true) {
      reports.push({
        kind,
        pages: 0,
        changedIds: 0,
        inCatalog: 0,
        discardedNotInCatalog: 0,
        enqueued: 0,
        done: true,
        skipped: true,
      })
      deps.log?.log('info', 'catalog_changes_window_already_done', { runId, kind, window: cursor })
      continue
    }

    const startedMs = now().getTime()
    let page = (state?.lastPage ?? 0) + 1
    let totalPages = state?.totalPages ?? null
    let pages = 0
    let requests = 0
    let changedIds = 0
    let inCatalog = 0
    let enqueued = 0
    let done = false

    /** A linha do ciclo em `api_sync_logs` — escrita no fim OU na falha. */
    const writeSyncLog = (status: SyncStatus, errorCode: string | null) =>
      deps.syncLog.write({
        endpoint: changesEndpoint(kind),
        status,
        errorCode,
        itemsProcessed: changedIds,
        itemsUpdated: inCatalog,
        itemsCreated: enqueued,
        durationMs: now().getTime() - startedMs,
        quotaCost: requests,
      })

    try {
      for (;;) {
        throwIfChangesAborted(deps.signal)
        if (options.maxPages !== undefined && pages >= options.maxPages) break
        if (totalPages !== null && page > totalPages) {
          done = true
          break
        }
        // Teto duro: sem `maxPages` e sem `total_pages` confiavel do provider, as
        // unicas saidas do laco eram `page > totalPages` e `isLastPage` — ambas
        // inalcancaveis quando `total_pages` vem ausente/0. Um unico ciclo
        // paginaria para sempre, gastando cota ate o timeout do job.
        if (pages >= HARD_PAGE_CEILING) {
          deps.log?.log('warn', 'catalog_changes_page_ceiling', { runId, kind, pages })
          break
        }

        const response = await deps.fetchChanges(kind, {
          start_date: startDate,
          end_date: endDate,
          page,
        })
        requests += 1
        deps.metrics.increment(CATALOG_METRIC_NAMES.tmdbRequestsTotal, 1, {
          endpoint: `changes:${kind}`,
        })
        const reportedTotal =
          typeof response.total_pages === 'number' && response.total_pages > 0
            ? response.total_pages
            : null
        totalPages = reportedTotal ?? totalPages

        const ids = extractChangedIds(response)
        changedIds += ids.length

        // Pagina vazia sem `total_pages` confiavel = fim da lista. Sem esta saida,
        // o laco continuaria pedindo paginas vazias ate o teto.
        if (ids.length === 0 && totalPages === null) {
          done = true
          pages += 1
          break
        }

        // PORTA DO CATALOGO: so re-sincroniza o que ja existe. Ver o cabecalho —
        // sem isto cada id editado no TMDB virava titulo novo. A consulta vem
        // ANTES do commit: se ela falhar, nada e gravado e o checkpoint fica.
        const known =
          ids.length === 0 ? new Set<number>() : await deps.catalog.existingTmdbIds(kind, ids)
        const eligible = ids.filter((id) => known.has(id))
        inCatalog += eligible.length

        // PORTA UNICA de cobertura (T0): o incremental NAO monta o job a mao. Foi
        // exatamente aqui que os dois caminhos divergiram uma vez — o payload
        // saiu sem `entityType`/`tmdbId`, a validacao do handler reprovou, e todo
        // `sync_details` vindo de `/changes` virou dead-letter em silencio. Com o
        // builder compartilhado, esse campo nao tem como faltar so de um lado.
        //
        // `scope: cursor` (a janela) e o que distingue duas mudancas do MESMO id:
        // em janelas diferentes e trabalho novo; na MESMA janela e noop
        // idempotente.
        const enqueueInputs: EnqueueCatalogJobInput[] = eligible.map((id) =>
          buildCoverageJob({
            kind,
            tmdbId: id,
            locale,
            reason: 'changes',
            scope: cursor,
            runId,
          }),
        )

        const isLastPage = totalPages !== null && page >= totalPages
        // COMMIT ATOMICO: jobs + checkpoint. Se falhar, o checkpoint NAO avanca.
        const committed = await deps.checkpoint.commit({
          job,
          paramsHash,
          lastPage: page,
          totalPages,
          done: isLastPage,
          cursor,
          enqueue: enqueueInputs,
        })
        enqueued += committed.enqueued
        pages += 1
        done = isLastPage
        deps.log?.log('debug', 'catalog_changes_page_committed', {
          runId,
          kind,
          page,
          ids: ids.length,
          inCatalog: eligible.length,
          discardedNotInCatalog: ids.length - eligible.length,
          enqueued: committed.enqueued,
        })

        if (isLastPage) break
        page += 1
      }
    } catch (error) {
      // A falha tambem e um ciclo e tambem gera log — com o que ja tinha sido
      // contado antes dela. O erro sobe intacto: quem decide retry e o worker.
      // Se ate o log falhar (banco fora), o erro ORIGINAL continua sendo o que
      // sobe: trocar a causa pela falha do log apagaria o diagnostico.
      const aborted = error instanceof Error && error.name === 'AbortError'
      await writeSyncLog(aborted ? 'aborted' : 'failed', errorCodeOf(error)).catch(() => undefined)
      throw error
    }

    const discardedNotInCatalog = changedIds - inCatalog
    await writeSyncLog(changesLogStatus(changedIds, done), null)
    deps.log?.log('info', 'catalog_changes_kind_done', {
      runId,
      kind,
      window: cursor,
      changedIds,
      inCatalog,
      discardedNotInCatalog,
      enqueued,
      done,
    })

    totalEnqueued += enqueued
    totalDiscardedNotInCatalog += discardedNotInCatalog
    reports.push({
      kind,
      pages,
      changedIds,
      inCatalog,
      discardedNotInCatalog,
      enqueued,
      done,
      skipped: false,
    })
    deps.metrics.increment(CATALOG_METRIC_NAMES.entitiesSyncedTotal, enqueued, {
      kind,
      source: 'changes',
    })
  }

  return {
    window: { from: startDate, to: endDate },
    kinds: reports,
    totalEnqueued,
    totalDiscardedNotInCatalog,
  }
}

/** Codigo curto do erro para `api_sync_logs.error_code` (sem mensagem, sem PII). */
function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code !== '') return code
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return `http_${status}`
  }
  return error instanceof Error ? error.name : 'UnknownError'
}
