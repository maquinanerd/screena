/**
 * sources.ts — Reconhecedor ESTRITO de `Ratings[].Source` da OMDb. Modulo PURO.
 *
 * ESTE E O PONTO CENTRAL DO DESENHO. O array `Ratings[]` da OMDb carrega TRES
 * fontes editoriais distintas num unico payload. Elas NAO podem virar uma nota
 * so creditada como "OMDb": `omdb` e o fornecedor TECNICO (`provider_api`), e
 * nunca a fonte de nota nenhuma (invariante 2).
 *
 * Cada linha abaixo vira sua PROPRIA linha em `external_ratings`, com sua fonte,
 * sua escala, sua natureza (`score_type`) e seu proprio texto de credito.
 *
 * RECONHECIMENTO INEQUIVOCO: um `Source` fora desta tabela NAO vira nota. Ele e
 * recusado como `unrecognized-source` com o valor BRUTO no detalhe, para que o
 * reconhecedor possa ser estendido depois com evidencia. Nunca chutamos.
 */

import type { RatingScoreType, RatingSource } from '@screena/config'

/** Uma fonte da OMDb reconhecida, ja mapeada para o vocabulario canonico. */
export interface RecognizedOmdbSource {
  /** Fonte editorial canonica (`RATING_SOURCES`). */
  readonly ratingSource: RatingSource
  /**
   * `external_ratings.metric`. Nao e um rotulo livre: junto com
   * `(entity_type, entity_id, rating_source)` ele forma o UNIQUE da tabela.
   *
   * Usamos deliberadamente o MESMO vocabulario do adapter anterior
   * (`audience` / `critics`), e isso tem uma consequencia querida: as linhas ja
   * existentes daquela ingestao sao REESCRITAS no lugar, com licenca e credito,
   * em vez de ganharem linhas paralelas. Ver o relatorio da PR (T5).
   */
  readonly metric: 'audience' | 'critics'
  /**
   * Natureza editorial esperada. Nao e usada para CLASSIFICAR (quem classifica
   * e `classifyRatingScoreType`, sobre label+metric) — serve de assercao: se as
   * duas discordarem, ha bug no vocabulario acima, e o mapper recusa em vez de
   * gravar critica no lugar de publico.
   */
  readonly expectedScoreType: RatingScoreType
}

/**
 * A tabela canonica. As chaves sao os literais EXATOS que a OMDb publica em
 * `Ratings[].Source` (comparacao case-insensitive apos trim).
 *
 * Por que cada `metric`:
 *  - IMDb publica a media de votos de USUARIOS -> `audience`.
 *  - O valor que a OMDb rotula "Rotten Tomatoes" e o **Tomatometer**, a
 *    porcentagem de CRITICOS que aprovaram -> `critics`. (O Popcornmeter, que e
 *    o publico, nao vem neste payload.)
 *  - O valor "Metacritic" e o **Metascore**, media ponderada de CRITICOS ->
 *    `critics`. Confirma-se no proprio payload: o campo de topo `Metascore`
 *    repete exatamente este numero (ver a verificacao cruzada em `mapping.ts`).
 */
const OMDB_SOURCE_TABLE: readonly (readonly [string, RecognizedOmdbSource])[] = [
  [
    'internet movie database',
    { ratingSource: 'imdb', metric: 'audience', expectedScoreType: 'audience' },
  ],
  [
    'rotten tomatoes',
    { ratingSource: 'rotten_tomatoes', metric: 'critics', expectedScoreType: 'critics' },
  ],
  ['metacritic', { ratingSource: 'metacritic', metric: 'critics', expectedScoreType: 'critics' }],
]

const BY_NORMALIZED: ReadonlyMap<string, RecognizedOmdbSource> = new Map(OMDB_SOURCE_TABLE)

/** Normaliza o literal da OMDb para busca: trim, minusculas, espacos colapsados. */
export function normalizeOmdbSourceName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Reconhece um `Ratings[].Source`. `null` quando a fonte nao esta na tabela —
 * o chamador DEVE recusar a nota e logar o valor bruto (nunca inferir).
 */
export function recognizeOmdbSource(raw: unknown): RecognizedOmdbSource | null {
  if (typeof raw !== 'string') return null
  return BY_NORMALIZED.get(normalizeOmdbSourceName(raw)) ?? null
}

/** Os literais reconhecidos, para diagnostico e documentacao. */
export const RECOGNIZED_OMDB_SOURCE_NAMES: readonly string[] = OMDB_SOURCE_TABLE.map(
  ([name]) => name,
)
