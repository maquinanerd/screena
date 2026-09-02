/**
 * provider-identity.ts — a IDENTIDADE do fornecedor de disponibilidade.
 *
 * ============================================================================
 * POR QUE ISTO SOBREVIVEU AO EXPURGO DO RAPIDAPI
 * ============================================================================
 * O client HTTP da Streaming Availability (RapidAPI) foi REMOVIDO em 2026-09-02:
 * o fornecedor esta descontinuado por decisao do dono, e um caminho executavel
 * aposentado que continua compilando e uma cota que ainda pode ser gasta.
 *
 * O que NAO pode ser removido junto e a **identidade**: `streaming_availability`
 * e uma chave viva em `api_providers`, com **linhas reais em
 * `watch_availability` apontando para ela por FK**. Apagar a constante nao
 * apagaria o dado — apenas espalharia o literal `'streaming_availability'` pelo
 * codigo, que e exatamente o oposto de ter uma fonte unica.
 *
 * A atribuicao tambem fica, e pelo mesmo motivo: enquanto existir UMA linha
 * exibivel dessa origem, os termos exigem o credito. Remover o texto junto do
 * client transformaria uma oferta licenciada em uma oferta sem credito —
 * violando a licenca ao "limpar" codigo.
 *
 * ============================================================================
 * O QUE NAO ESTA AQUI, E POR QUE
 * ============================================================================
 * Host, base URL, TTL de cache, granularidade e idioma de saida do upstream
 * morreram com o client. Eles descrevem COMO se falava com a API; ninguem mais
 * fala. Mante-los seria manter a promessa de que a chamada pode voltar sozinha.
 *
 * Fonte historica: `api-clients/streaming_availability/src/provider.ts`.
 */

/** Chave em `api_providers` (kind = streaming). Existe no seed e nas FKs. */
export const STREAMING_AVAILABILITY_PROVIDER_API = 'streaming_availability'

/** Pais default da revisao e da promocao de ofertas. */
export const STREAMING_AVAILABILITY_DEFAULT_COUNTRY = 'BR'

/**
 * Texto de atribuicao exigido pelos termos, usado quando a licenca libera.
 *
 * Ele descreve a FONTE (Movie of the Night), nao o transporte (RapidAPI) — e e
 * por isso que ele nao morre com o client: a invariante 2 separa as duas coisas,
 * e quem precisa de credito e a fonte.
 */
export const STREAMING_AVAILABILITY_ATTRIBUTION_TEXT =
  'Disponibilidade de streaming fornecida por Streaming Availability API by Movie of the Night'

/** Link de atribuicao exigido pelos termos. */
export const STREAMING_AVAILABILITY_ATTRIBUTION_URL = 'https://www.movieofthenight.com/about/api'

/** Tipos de entidade que carregam disponibilidade. */
export const STREAMING_AVAILABILITY_KINDS = ['movie', 'tv'] as const

/** Tipo derivado de um `kind` suportado. */
export type StreamingAvailabilityKind = (typeof STREAMING_AVAILABILITY_KINDS)[number]

/** `value` e um `kind` suportado? */
export function isStreamingKind(value: string): value is StreamingAvailabilityKind {
  return (STREAMING_AVAILABILITY_KINDS as readonly string[]).includes(value)
}
