/**
 * seed-filter.ts — O que a SEMENTE nao copia (PURO).
 *
 * ESCOPO, e ele e a coisa mais importante deste arquivo: isto filtra a
 * SEMENTE, nunca o SITE. Uma serie excluida aqui continua alcancavel pela
 * cobertura sob demanda — se um leitor buscar "Malhacao", ele acha. A semente
 * decide o que copiamos ANTES de alguem pedir; o sob demanda decide o que
 * fazemos QUANDO pedem. Sao perguntas diferentes e nao podem compartilhar
 * filtro. `tests/governance/seed-filter-scope.test.ts` reprova se este modulo
 * for importado pelo caminho sob demanda.
 *
 * POR QUE ELE EXISTE — o numero, nao a intuicao. Medido em 2026-08-14 com
 * `catalog plan-bootstrap --strategy popular --entity movie,tv --limit 200`:
 * **200 series produziram 199.233 episodios**, ~996 por serie. E as mais
 * pesadas nao sao a cauda obscura — sao o TOPO da lista `popular`:
 *
 *   Tagesschau (telejornal alemao)            75 temporadas   21.352 episodios
 *   Barátok közt (novela hungara)             23 temporadas   10.456 episodios
 *   Jeopardy! (game show)                     43 temporadas    9.394 episodios
 *   Goede Tijden, Slechte Tijden (novela)     37 temporadas    7.490 episodios
 *   Malhação (novela)                         27 temporadas    6.198 episodios
 *
 * Essas cinco sozinhas custam 54.890 episodios — mais que centenas de series
 * que o site realmente tem leitor para mostrar. Um site brasileiro de cinema
 * nao tem publico para telejornal alemao, e paga por ele em horas de escrita.
 *
 * O CUSTO E DE ESCRITA, NAO DE REDE: o modelo de custo mede ~120 episodios
 * persistidos por segundo, e a duracao estimada e dominada pelo termo de
 * episodio, nao pelo de rede.
 */

/**
 * Generos de TV de EMISSAO DIARIA, excluidos da semente.
 *
 * Os ids vem de `GET /genre/tv/list` da propria TMDB, conferidos em 2026-08-14
 * — nao presumidos e nao copiados de documentacao secundaria:
 *
 *   10763  News     telejornal: episodio novo todo dia, para sempre
 *   10764  Reality  temporada longa, episodio diario
 *   10766  Soap     novela: centenas de capitulos por temporada
 *   10767  Talk     talk show: episodio diario
 *
 * O que estes quatro tem em comum nao e "ser ruim" — e a CARDINALIDADE. Uma
 * serie de drama tem 10 episodios por temporada; um telejornal tem 365. O
 * filtro e sobre volume de episodio, e por isso e um filtro de SEMENTE (o que
 * copiamos em massa), nao um juizo editorial sobre o titulo.
 */
export const DAILY_EMISSION_TV_GENRES: readonly number[] = [10763, 10764, 10766, 10767]

/** Nome legivel de cada genero excluido, para o log e o relatorio. */
export const DAILY_EMISSION_GENRE_NAMES: Readonly<Record<number, string>> = Object.freeze({
  10763: 'News',
  10764: 'Reality',
  10766: 'Soap',
  10767: 'Talk',
})

/** Fatos de uma serie candidata a semente. */
export interface SeedSeriesCandidate {
  readonly tmdbId: number
  readonly genreIds: readonly number[]
  readonly episodes: number
}

/** Por que a serie ficou fora da semente. */
export type SeedExclusionReason =
  /** Tem pelo menos um genero de emissao diaria. */
  | 'daily_emission_genre'
  /** Passou no filtro de genero e ainda assim tem episodios demais. */
  | 'episode_ceiling'

/** Veredito da semente para uma serie. Nunca um `false` mudo. */
export type SeedVerdict =
  | { readonly included: true }
  | {
      readonly included: false
      readonly reason: SeedExclusionReason
      /** Generos que dispararam a exclusao (vazio quando foi o teto). */
      readonly matchedGenres: readonly number[]
      readonly detail: string
    }

/**
 * Teto de episodios por serie na semente. `null` = sem teto.
 *
 * NAO tem default ligado: o teto so entra com medicao que o justifique. O
 * filtro de genero e a primeira linha; se a medicao mostrar serie absurda
 * passando MESMO depois dele, este teto e o corte complementar — e ai o numero
 * sai do dado, nao de precaucao.
 */
export type EpisodeCeiling = number | null

/**
 * A serie entra na semente?
 *
 * Ordem: genero primeiro (e o criterio barato e categorico), teto depois. Um
 * telejornal com poucos episodios continua sendo telejornal.
 */
export function evaluateSeedSeries(
  candidate: SeedSeriesCandidate,
  episodeCeiling: EpisodeCeiling = null,
): SeedVerdict {
  const matched = candidate.genreIds.filter((id) => DAILY_EMISSION_TV_GENRES.includes(id))
  if (matched.length > 0) {
    const nomes = matched.map((id) => DAILY_EMISSION_GENRE_NAMES[id] ?? String(id)).join(', ')
    return {
      included: false,
      reason: 'daily_emission_genre',
      matchedGenres: matched,
      detail: `tv#${candidate.tmdbId} fora da semente: genero de emissao diaria (${nomes})`,
    }
  }

  if (episodeCeiling !== null && candidate.episodes > episodeCeiling) {
    return {
      included: false,
      reason: 'episode_ceiling',
      matchedGenres: [],
      detail:
        `tv#${candidate.tmdbId} fora da semente: ${candidate.episodes} episodios ` +
        `acima do teto de ${episodeCeiling}`,
    }
  }

  return { included: true }
}

/** Resumo de um lote, para o relatorio do operador. */
export interface SeedFilterSummary {
  readonly considered: number
  readonly included: number
  readonly excludedByGenre: number
  readonly excludedByCeiling: number
  /** Episodios que a exclusao evitou — o numero que justifica o filtro. */
  readonly episodesAvoided: number
  /** Episodios que continuam entrando. */
  readonly episodesIncluded: number
}

/** Aplica o filtro a um lote e resume. Nenhum descarte e anonimo: cada um tem motivo. */
export function summarizeSeedFilter(
  candidates: readonly SeedSeriesCandidate[],
  episodeCeiling: EpisodeCeiling = null,
  onExcluded?: (candidate: SeedSeriesCandidate, verdict: SeedVerdict) => void,
): SeedFilterSummary {
  let included = 0
  let excludedByGenre = 0
  let excludedByCeiling = 0
  let episodesAvoided = 0
  let episodesIncluded = 0

  for (const candidate of candidates) {
    const verdict = evaluateSeedSeries(candidate, episodeCeiling)
    if (verdict.included) {
      included += 1
      episodesIncluded += candidate.episodes
      continue
    }
    onExcluded?.(candidate, verdict)
    episodesAvoided += candidate.episodes
    if (verdict.reason === 'daily_emission_genre') excludedByGenre += 1
    else excludedByCeiling += 1
  }

  return {
    considered: candidates.length,
    included,
    excludedByGenre,
    excludedByCeiling,
    episodesAvoided,
    episodesIncluded,
  }
}
