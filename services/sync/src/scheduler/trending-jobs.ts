/**
 * trending-jobs.ts — O job `sync_lists` que a fila `trending` enfileira. Puro.
 *
 * ============================================================================
 * POR QUE ISTO É UM MÓDULO, E NÃO UM OBJETO LITERAL DENTRO DO RUNNER
 * ============================================================================
 * Porque o defeito que ele conserta era uma AUSÊNCIA, e ausência não quebra
 * teste. Enquanto o payload morava inline em `runners.ts`, nenhum teste
 * conseguia sequer importar aquele arquivo (ele puxa `@screena/ingestion/runtime`,
 * que não tem alias no `vitest.config.ts`) — então a `priority` faltante nunca
 * teve como ficar vermelha em lugar nenhum.
 *
 * Aqui ela é o valor de retorno de uma função pura. Tirar a prioridade agora
 * exige editar ESTE arquivo, e este arquivo tem teste.
 */

/** As duas verticais que o TMDB expõe em lista de trending. */
export type TrendingEntityType = 'movie' | 'tv'

/** As duas janelas que o TMDB expõe. Não há terceira. */
export type TrendingWindow = 'day' | 'week'

/**
 * Prioridade do `sync_lists` do trending. MENOR = mais prioritário
 * (`CatalogJob.priority`, default 100).
 *
 * ISTO É UM CONSERTO, NÃO UM AJUSTE FINO. Sem `priority` explícita o job nascia
 * com o default 100 e ia para o FIM da fila de catálogo. Medido em produção em
 * 2026-08-26, no mesmo instante:
 *
 *     7.782  sync_details  retry_wait  priority 50
 *       270  sync_seasons  pending     priority 65
 *     7.411  sync_media    pending     priority 70
 *     -----
 *    15.463  jobs que TODOS passavam antes
 *
 * O resultado: `discovery_snapshots` em ZERO, enquanto `api_sync_logs`
 * registrava `scheduler/trending` com status `success` VINTE E CINCO vezes. O
 * log estava certo — `runTrending` ENFILEIRA, e enfileirar deu certo todas as
 * vezes. O que nunca acontecia era a captura, do outro lado da fila.
 *
 * ============================================================================
 * POR QUE 20, NO VOCABULÁRIO QUE JÁ EXISTE
 * ============================================================================
 * `COVERAGE_PRIORITY` (`services/ingestion/src/entity-coverage/entry.ts`) já
 * declara a escala e o argumento de cada faixa:
 *
 *     on_demand  10   há um leitor BLOQUEADO agora — "o único que fura a fila"
 *     changes    50   o dado publicado está ERRADO
 *     scheduled  80   o dado publicado está VELHO
 *     discovery 100   backfill; nada quebra se demorar uma hora
 *
 * 20 abre uma segunda exceção àquele "único", e ela precisa se justificar em
 * duas frentes. CUSTO: não escala. São 4 requisições por ciclo de 6 h, fixas —
 * furar a fila aqui atrasa o lote em quatro jobs, não em quatro mil. PRAZO: o
 * TTL do snapshot é 6 h, igual ao ciclo. Um trending que espera 15 mil jobs
 * drenarem não chega atrasado: chega VENCIDO, e `readTrendingSnapshot` o
 * descarta por `expires_at`. Trabalho feito com atraso aqui é trabalho jogado
 * fora, o que nenhuma das outras faixas sofre.
 *
 * E fica atrás dos DOIS dez que já existem — `on_demand` (leitor bloqueado) e
 * o `discover_ids` do bootstrap ("a descoberta abre o funil"). O segundo é o
 * que importa aqui: sem entidade promovida o snapshot não tem o que apontar
 * (o store descarta item de entidade inexistente), então passar na frente da
 * descoberta trocaria um trilho vazio por outro.
 */
export const TRENDING_JOB_PRIORITY = 20

/**
 * UMA página por lista.
 *
 * `sync_lists` faria até 5 por default, e as quatro seguintes só trariam cauda
 * que nenhum trilho exibe — 16 requisições por ciclo em vez de 4, para o mesmo
 * resultado na tela.
 */
export const TRENDING_JOB_MAX_PAGES = 1

/** O input de `store.enqueue` para uma combinação (entidade, janela). */
export function buildTrendingListJob(input: {
  readonly entityType: TrendingEntityType
  readonly window: TrendingWindow
  readonly locale: string
  readonly idempotencyKey: string
  readonly runId: string
}): Record<string, unknown> {
  return {
    jobType: 'sync_lists',
    entityType: input.entityType,
    externalId: null,
    idempotencyKey: input.idempotencyKey,
    payload: {
      listType: 'trending',
      entityType: input.entityType,
      locale: input.locale,
      country: null,
      window: input.window,
      maxPages: TRENDING_JOB_MAX_PAGES,
    },
    priority: TRENDING_JOB_PRIORITY,
    runId: input.runId,
  }
}

/**
 * As QUATRO combinações de um ciclo: movie|tv × day|week.
 *
 * As duas janelas entram porque são dois sinais que não colapsam: `day`
 * alimenta a prioridade da fila e o trilho "Em alta"; `week` alimenta
 * "Popular essa semana" e "Séries da semana".
 */
export const TRENDING_COMBOS: readonly {
  readonly entityType: TrendingEntityType
  readonly window: TrendingWindow
}[] = [
  { entityType: 'movie', window: 'day' },
  { entityType: 'movie', window: 'week' },
  { entityType: 'tv', window: 'day' },
  { entityType: 'tv', window: 'week' },
]
