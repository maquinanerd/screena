/**
 * safe-deep-link.ts — a barreira anti-pirataria de um link de oferta.
 *
 * ============================================================================
 * POR QUE ISTO SOBREVIVEU AO EXPURGO DO WORKER
 * ============================================================================
 * Vinha de `streaming-availability/mapping.ts`, removido em 2026-09-02 junto com
 * o client RapidAPI. Mas `isSafeDeepLink` nunca foi sobre AQUELE fornecedor: ele
 * e chamado por `promotion/guardrails.ts`, o caminho VIVO que decide se uma
 * oferta ja gravada pode acender na tela.
 *
 * Apaga-lo junto com o worker teria removido a barreira exatamente no momento em
 * que a promocao em lote passou a existir — ou seja, no momento de maior volume
 * de decisao. A invariante 8 nao depende de qual fornecedor trouxe o byte.
 *
 * ============================================================================
 * E UMA BARREIRA, NAO UMA PROVA
 * ============================================================================
 * A garantia real de legalidade vem da FONTE (que so lista servico licenciado)
 * somada a invariante 8 e a decisao humana de licenca. Isto aqui e a ultima
 * peneira barata: um link recusado nunca vira `deep_link`, e a oferta e mantida
 * com `deepLink: null` quando o resto dela e valido — recusar o link nunca
 * apaga a oferta.
 */

/**
 * Marcadores obvios de pirataria numa URL.
 *
 * O esquema (`http(s)`) e checado a parte; isto olha o CONTEUDO: arquivo
 * `.torrent` e infohash de magnet.
 */
const PIRACY_URL_PATTERN = /\.torrent(?:$|[?#])|xt=urn:btih:/i

/** Um deep link seguro e `http(s)` E nao carrega marcador de pirataria. */
export function isSafeDeepLink(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  return !PIRACY_URL_PATTERN.test(trimmed)
}
