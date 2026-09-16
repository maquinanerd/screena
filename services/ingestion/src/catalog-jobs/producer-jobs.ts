/**
 * producer-jobs.ts — Os jobs que ABREM o funil do catalogo. Puro.
 *
 *   `discover_ids` (diario, por tipo) — o que existe no TMDB e ainda nao temos;
 *   `sync_changes` (horario)          — o que mudou no TMDB e ja temos.
 *
 * Nenhum dos dois sincroniza titulo. Eles ENFILEIRAM os `sync_details` que
 * sincronizam — sao os produtores do trabalho novo.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM PRODUCAO EM 16/09/2026
 * ============================================================================
 * 58 `sync_changes` e 42 `discover_ids` pendentes desde 02/09 e 03/09, TODOS na
 * prioridade 100 — o default do schema, porque nenhum dos dois produtores
 * passava `priority`. O claim e uma fila GLOBAL
 * (`ORDER BY priority ASC, available_at ASC`): um job em 100 so roda quando nao
 * ha NADA abaixo dele. Por 14 dias houve — a cascata de `airing_series` criava
 * 107.266 `sync_media` de episodio por dia na prioridade 80, com o worker em
 * ~92 de 96 horas-worker. Sem produtor, nao nasceu titulo descoberto nem
 * titulo atualizado por mudanca no TMDB, e nenhum erro apareceu em lugar
 * nenhum: os jobs estavam la, `pending`, corretos.
 *
 * ============================================================================
 * POR QUE UM MODULO, E NAO DOIS OBJETOS LITERAIS
 * ============================================================================
 * Dois produtores montam estes MESMOS jobs: o agendador
 * (`services/sync/src/scheduler/runtime/runners.ts`) e o enfileirador do
 * proprio servico de catalogo (`bin/catalog-worker-service.ts`). A duplicacao e
 * inofensiva SO enquanto a chave de idempotencia for identica nos dois — e
 * nenhum dos dois arquivos e importavel por teste. A `priority` faltando era
 * uma AUSENCIA, e ausencia nao quebra teste. Mesmo defeito, e mesmo conserto,
 * de `services/sync/src/scheduler/trending-jobs.ts`, um degrau acima no funil.
 */

import type { ChangesKind } from '../discovery/changes-plan.js'
import { buildIdempotencyKey } from './idempotency.js'
import type { EnqueueCatalogJobInput } from './store-port.js'

/**
 * A prioridade dos produtores. MENOR = roda antes (`CatalogJob.priority`,
 * default 100).
 *
 * Na escala que ja existe (`COVERAGE_PRIORITY`, `TRENDING_JOB_PRIORITY`):
 *
 *     on_demand            10   ha um leitor bloqueado agora
 *     discover_ids (boot)  10   o funil ainda nem abriu
 *     trending / PRODUTOR  20   poucos jobs FIXOS por ciclo; atrasar e perder
 *     changes              50   (o DETALHE que o `/changes` gera)
 *     cascata de serie     65 a 80
 *     scheduled            80 a 96
 *     discovery           100 a 116 (o DETALHE que a descoberta gera)
 *
 * CUSTO — nao escala com o catalogo: no ritmo do agendador sao 3 `discover_ids`
 * (diario) e 4 `sync_changes` (6 h) por dia; a chave horaria poe o teto em 24.
 * Furar a fila atrasa o lote em ~7 jobs por dia, nao em milhares. E o trabalho
 * que eles GERAM nao fura nada: os detalhes nascem nas faixas de sempre
 * (`changes` 50, `discovery` 100+).
 *
 * PRAZO — produtor atrasado nao recupera o dia perdido, ele pergunta pelo dia
 * errado. `sync_changes` sem `from`/`to` pede as ULTIMAS 24 h a partir de
 * quando RODA (`resolveWindow`, `changes/run.ts`); `discover_ids` baixa o
 * export de ONTEM a partir de quando RODA (`discoverFromDailyExports`). Os 58
 * `sync_changes` represados, quando rodarem, vao pedir todos a mesma janela de
 * hoje — as mudancas de 02/09 a 15/09 nao voltam por eles.
 *
 * Fica ATRAS dos dois dez: com leitor bloqueado ou funil fechado, produzir mais
 * fila nao ajuda ninguem.
 */
export const PRODUCER_JOB_PRIORITY = 20

/** Os tipos que a descoberta diaria cobre. */
export type DailyDiscoveryKind = 'movie' | 'tv' | 'person'

/**
 * O `discover_ids` de UM tipo, num dia.
 *
 * A chave inclui o DIA: dentro do dia o job e o mesmo trabalho (reenfileirar e
 * noop), e no dia seguinte ha um export novo. Sem o dia, a segunda execucao
 * colidiria na mesma chave e o espelho congelaria no primeiro snapshot.
 */
export function buildDailyDiscoveryJob(input: {
  readonly kind: DailyDiscoveryKind
  /** Dia UTC `YYYY-MM-DD`. */
  readonly day: string
  readonly locale: string
  /**
   * Teto de ids. `null` e o export INTEIRO (1,23 M filmes, 228 k series,
   * 4,86 M pessoas) — com `enqueueDetails`, milhoes de `sync_details`. Quem
   * passa `null` passa de proposito (ver `config.ts` dos dois servicos).
   */
  readonly limit: number | null
  readonly runId?: string | null
}): EnqueueCatalogJobInput {
  return {
    jobType: 'discover_ids',
    entityType: input.kind,
    externalId: null,
    idempotencyKey: buildIdempotencyKey({
      jobType: 'discover_ids',
      entityType: input.kind,
      externalId: `daily-exports:${input.day}`,
    }),
    payload: {
      strategy: 'daily-exports',
      entityType: input.kind,
      locale: input.locale,
      country: null,
      limit: input.limit,
      maxPages: null,
      ids: null,
      // A descoberta so vale se cascatear: sem isto ela acharia ids e nao
      // sincronizaria nada.
      enqueueDetails: true,
    },
    priority: PRODUCER_JOB_PRIORITY,
    runId: input.runId ?? null,
  }
}

/**
 * O `sync_changes` de UM slot horario.
 *
 * `resume: true` faz o handler ler o checkpoint e continuar de onde parou; o
 * checkpoint so avanca APOS o commit, entao um ciclo interrompido e refeito, e
 * nunca pulado.
 */
export function buildIncrementalChangesJob(input: {
  /** Slot UTC `YYYY-MM-DDTHH`: dois ciclos no mesmo dia sao trabalhos diferentes. */
  readonly slot: string
  readonly kinds: readonly ChangesKind[]
  readonly runId?: string | null
}): EnqueueCatalogJobInput {
  return {
    jobType: 'sync_changes',
    entityType: null,
    externalId: null,
    idempotencyKey: buildIdempotencyKey({
      jobType: 'sync_changes',
      entityType: null,
      externalId: `incremental:${input.slot}`,
    }),
    payload: {
      kinds: [...input.kinds],
      from: null,
      to: null,
      maxPages: null,
      resume: true,
    },
    priority: PRODUCER_JOB_PRIORITY,
    runId: input.runId ?? null,
  }
}
