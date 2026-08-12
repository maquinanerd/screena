/**
 * freshness.ts — Janela de RE-CONSULTA da OMDb. Modulo PURO.
 *
 * Notas mudam devagar, e o plano gratuito sao 1.000 requisicoes por DIA. Sem
 * uma janela, todo ciclo do worker reconsultaria as mesmas entidades e queimaria
 * a cota confirmando numeros que nao mudaram.
 *
 * A janela NAO e um numero novo: ela sai de `RATING_STALE_POLICY`
 * (@screena/config), a mesma politica versionada que ja governa
 * `external_ratings.stale_after` e a exibicao. Inventar um valor proprio aqui
 * criaria dois relogios que podem divergir.
 *
 * O CRITERIO E O MINIMO, nao a media nem o maximo: uma requisicao da OMDb traz
 * as tres fontes de uma vez, entao ela precisa acontecer assim que a fonte MAIS
 * IMPACIENTE pedir refresh. Usar o maximo (Metacritic, 336h) deixaria IMDb e
 * Rotten Tomatoes desatualizados por duas semanas de graca.
 */

import { RATING_STALE_POLICY, type RatingSource } from '@screena/config'

const HOUR_MS = 60 * 60 * 1000

/**
 * As fontes editoriais que a OMDb entrega. Espelha `sources.ts` — as duas
 * listas nao podem divergir, e o teste trava isso.
 */
export const OMDB_RATING_SOURCES: readonly RatingSource[] = [
  'imdb',
  'rotten_tomatoes',
  'metacritic',
]

/**
 * Menor `refreshAfterHours` entre as fontes que a OMDb entrega.
 *
 * Hoje: 168h (7 dias), de IMDb e Rotten Tomatoes. Deriva da politica — mudar a
 * politica muda isto automaticamente, sem edicao aqui.
 *
 * Uma fonte SEM politica declarada nao contribui (nao inventamos janela para
 * ela). Se NENHUMA das fontes tivesse politica, devolvemos `null` e o chamador
 * nao filtra por frescor — nunca chuta um numero.
 */
export function omdbRefreshWindowHours(): number | null {
  // `: number` explicito no map. Sem ele, `RATING_STALE_POLICY` (um `as const`)
  // devolve o tipo LITERAL das janelas (`168 | 336`), e o predicado do filter
  // deixa de ser atribuivel — o compilador reclama de um detalhe que nao e o
  // ponto. O valor continua vindo inteiramente da politica.
  const declared: readonly (number | null)[] = OMDB_RATING_SOURCES.map(
    (source): number | null =>
      Object.prototype.hasOwnProperty.call(RATING_STALE_POLICY, source)
        ? RATING_STALE_POLICY[source as keyof typeof RATING_STALE_POLICY].refreshAfterHours
        : null,
  )
  const known = declared.filter((hours): hours is number => hours !== null)

  if (known.length === 0) return null
  return Math.min(...known)
}

/**
 * O instante a partir do qual uma coleta e considerada RECENTE demais para
 * justificar nova requisicao. Uma entidade cuja nota OMDb foi coletada DEPOIS
 * deste corte e pulada.
 *
 * `null` quando nao ha politica: sem janela declarada, nao filtramos.
 */
export function omdbRefreshCutoff(now: Date): Date | null {
  const hours = omdbRefreshWindowHours()
  if (hours === null) return null
  return new Date(now.getTime() - hours * HOUR_MS)
}
