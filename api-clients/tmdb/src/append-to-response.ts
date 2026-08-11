/**
 * append-to-response.ts — Constantes canonicas de `append_to_response` do TMDB,
 * por tipo de entidade, mais o particionador que respeita o teto de sub-requests.
 *
 * FONTE DE VERDADE: derivado da documentacao oficial do TMDB
 * (developer.themoviedb.org), verificando a existencia de cada endpoint de
 * sub-recurso em `/reference/*` — NUNCA de memoria. O guia oficial de
 * `append_to_response` declara textualmente que **apenas** os metodos de detalhe
 * de "movie, TV show, TV season, TV episode and person" suportam o parametro;
 * por isso collection/network/company/keyword NAO tem constante de append aqui.
 *
 * Modulo WORKER-ONLY e PURO: so define dados e funcoes puras (sem rede/IO).
 */

/** Tipos de entidade TMDB cujo metodo de detalhe suporta `append_to_response`. */
export type TmdbAppendableType = 'movie' | 'tv' | 'tv_season' | 'tv_episode' | 'person'

/**
 * Teto de sub-requests por chamada com `append_to_response`. O guia oficial NAO
 * declara esse numero, mas o TMDB aplica um limite de 20 sub-requests: acima
 * disso os extras sao ignorados. Por isso particionamos em blocos de ate 20.
 */
export const TMDB_APPEND_LIMIT = 20

/**
 * `append_to_response` maximo para `GET /movie/{id}`. Somente sub-recursos de
 * catalogo: `account_states` (exige sessao de usuario) e `lists` (curadoria de
 * usuario, paginada) ficam de fora por nao serem metadado da entidade.
 */
export const MOVIE_APPEND = [
  'credits',
  'external_ids',
  'images',
  'videos',
  'keywords',
  'recommendations',
  'similar',
  'reviews',
  'release_dates',
  'translations',
  'alternative_titles',
  'watch/providers',
  'changes',
] as const

/** `append_to_response` maximo para `GET /tv/{id}` (serie). */
export const TV_APPEND = [
  'credits',
  'aggregate_credits',
  'external_ids',
  'images',
  'videos',
  'keywords',
  'recommendations',
  'similar',
  'reviews',
  'content_ratings',
  'translations',
  'alternative_titles',
  'watch/providers',
  'episode_groups',
  'screened_theatrically',
  'changes',
] as const

/** `append_to_response` maximo para `GET /tv/{id}/season/{n}`. */
export const TV_SEASON_APPEND = [
  'credits',
  'aggregate_credits',
  'external_ids',
  'images',
  'videos',
  'translations',
  'watch/providers',
] as const

/** `append_to_response` maximo para `GET /tv/{id}/season/{n}/episode/{e}`. */
export const TV_EPISODE_APPEND = [
  'credits',
  'external_ids',
  'images',
  'videos',
  'translations',
] as const

/**
 * `append_to_response` maximo para `GET /person/{id}`.
 *
 * `movie_credits` e `tv_credits` SAIRAM: `combined_credits` ja e a uniao dos
 * dois, e cada credito carrega `media_type` (`movie`/`tv`) para separa-los. Pedir
 * os tres arquivava o mesmo credito DUAS vezes em `tmdb_raw`, em 4,86 M pessoas.
 * Removido apos confirmar (grep repo-wide, snake_case e camelCase) que nenhum
 * normalizador/consumidor le os dois campos separados.
 */
export const PERSON_APPEND = [
  'external_ids',
  'combined_credits',
  'images',
  'tagged_images',
  'translations',
  'changes',
] as const

/** Mapa de `append_to_response` por tipo suportado (unica fonte para os endpoints). */
export const TMDB_APPEND_BY_TYPE: Record<TmdbAppendableType, readonly string[]> = {
  movie: MOVIE_APPEND,
  tv: TV_APPEND,
  tv_season: TV_SEASON_APPEND,
  tv_episode: TV_EPISODE_APPEND,
  person: PERSON_APPEND,
}

/**
 * Particiona os valores de `append_to_response` em blocos que respeitam o teto
 * de sub-requests (`limit`, default {@link TMDB_APPEND_LIMIT}). Cada bloco vira
 * uma string separada por virgula, pronta para o parametro `append_to_response`.
 *
 * - Remove vazios e duplicados (preserva a primeira ocorrencia, na ordem dada).
 * - `limit` invalido (<= 0 ou nao-inteiro) cai no default.
 * - Entrada vazia devolve `[]` (nenhum append).
 *
 * Puro: sem rede nem estado. Quando ha mais de um bloco, o chamador faz uma
 * requisicao por bloco e mescla os sub-recursos na resposta base.
 */
export function partitionAppend(
  values: readonly string[],
  limit: number = TMDB_APPEND_LIMIT,
): string[] {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : TMDB_APPEND_LIMIT

  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    if (value === '' || seen.has(value)) continue
    seen.add(value)
    unique.push(value)
  }

  const chunks: string[] = []
  for (let i = 0; i < unique.length; i += cap) {
    chunks.push(unique.slice(i, i + cap).join(','))
  }
  return chunks
}

/**
 * Blocos de `append_to_response` prontos para um tipo suportado, ja
 * particionados pelo teto de sub-requests.
 */
export function appendChunksForType(
  type: TmdbAppendableType,
  limit: number = TMDB_APPEND_LIMIT,
): string[] {
  return partitionAppend(TMDB_APPEND_BY_TYPE[type], limit)
}
