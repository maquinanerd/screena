/**
 * types.ts — Tipos do worker de ratings OMDb. Modulo PURO.
 *
 * `RatingDraft`, `ExternalRatingRow` e `RatingsEntityType` sao PROVEDOR-NEUTROS
 * (descrevem uma linha de `external_ratings`, nao um payload da RapidAPI) e
 * moram em `film-show-ratings/types.ts` por razao historica — aquele foi o
 * primeiro adapter. Reexportamos aqui para que o codigo OMDb nao dependa do
 * nome do outro provedor; mover os tipos de lugar e refactor a parte.
 */

export type {
  ExternalRatingRow,
  RatingDraft,
  RatingsEntityType,
} from '../film-show-ratings/types.js'

/**
 * Motivos de recusa do adapter OMDb.
 *
 * Sob payload desconhecido, RECUSAR e o caminho correto: nenhuma nota entra em
 * `external_ratings` por inferencia. Todo motivo daqui vira uma linha no
 * relatorio — nada falha em silencio.
 */
export type OmdbRejectionReason =
  /** O payload nao e objeto / nao tem a forma minima esperada. */
  | 'payload-shape-unrecognized'
  /**
   * `Response: "False"` — a OMDb sinalizou ERRO com HTTP 200 e um campo
   * `Error`. Nunca e sucesso, nunca e "0 notas".
   *
   * Este motivo e o fato sobre o TITULO (id inexistente, id malformado). O fato
   * sobre o DIA tem motivo PROPRIO (`omdb-quota-exhausted`) — ver
   * `error-response.ts` para por que colapsa-los custou cota em silencio.
   */
  | 'omdb-error-response'
  /**
   * A OMDb recusou por TETO DE REQUISICOES ("Request limit reached!"), com HTTP
   * 200 como todo erro dela.
   *
   * Distinto de `omdb-error-response` e de `quota-denied`, e os tres pedem acoes
   * diferentes: aquele e "este titulo nao existe"; `quota-denied` e "NOSSO
   * contador disse que nao havia saldo, entao nem perguntamos"; este e "o
   * FORNECEDOR disse que acabou" — a unica evidencia externa de cota que a OMDb
   * nos da, porque ela nao publica cabecalho de cota nenhum.
   *
   * Quando os dois divergem (nosso contador achava que havia saldo e o
   * fornecedor recusou), este motivo e o unico sinal de que `quota_cost` esta
   * subcontando o consumo real.
   */
  | 'omdb-quota-exhausted'
  /**
   * A OMDb recusou por CREDENCIAL ("Invalid API key!"). Fato sobre a chave, nao
   * sobre o titulo nem sobre o dia. Interrompe o lote pelo mesmo motivo que a
   * cota: o proximo id encontraria a mesma parede.
   */
  | 'omdb-auth-rejected'
  /** O payload nao trouxe `imdbID` valido (`tt<digitos>`). */
  | 'no-entity-id'
  /** `Ratings` ausente ou nao e array. */
  | 'no-rating-descriptors'
  /** Um elemento de `Ratings[]` nao e objeto. */
  | 'descriptor-not-object'
  /** `Source` fora da tabela canonica. O detalhe carrega o valor BRUTO. */
  | 'unrecognized-source'
  /** `Value` ausente/`N/A`/vazio/formato inesperado. */
  | 'invalid-value'
  /** A escala lida do literal diverge da escala canonica da fonte. */
  | 'scale-mismatch'
  /** A natureza classificada diverge da esperada para aquela fonte. */
  | 'score-type-mismatch'
  /** `validateRating` (@screena/schemas) recusou. */
  | 'rating-validation-failed'
  /** A mesma fonte apareceu duas vezes no array. */
  | 'duplicate-source'
  /**
   * Os campos redundantes de topo (`imdbRating`, `Metascore`) divergem do que o
   * array declara. NAO derruba a nota do array (o array e a fonte unica), mas e
   * anomalia registrada — nunca escolha silenciosa.
   */
  | 'redundant-field-divergence'
  /** Nenhuma entidade local para o IMDb id consultado. */
  | 'entity-not-found'
  /** Falha de rede/HTTP ao buscar UM id (nunca vaza a chave). */
  | 'item-fetch-failed'
  /**
   * Lote interrompido cedo (falhas consecutivas ou circuito aberto) para NAO
   * queimar cota em loop; os ids restantes ficam sem consulta.
   */
  | 'batch-aborted'
  /**
   * A COTA DIARIA da OMDb barrou este id.
   *
   * NAO e um fato sobre o TITULO — e um fato sobre o DIA. Colapsar os dois
   * gravaria "sem nota" num titulo que TEM nota, e ele nunca mais seria
   * consultado: a pagina nasceria muda e permaneceria muda. Por isso o id barrado
   * nao vira linha nenhuma em `external_ratings`: ele CONTINUA stale e volta a
   * ser candidato no proximo ciclo, sozinho.
   */
  | 'quota-denied'

/** Uma recusa, com detalhe legivel (sem segredo, sem payload cru). */
export interface OmdbRejection {
  readonly reason: OmdbRejectionReason
  readonly detail: string
}
