/**
 * meta-description.ts — a `<meta name="description">` de qualquer pagina publica.
 *
 * POR QUE ISTO EXISTE (medido em producao, 2026-08-24):
 *
 *   /pt/filmes/a-origem/                 description = 504 caracteres
 *   /pt/series/red-dwarf/                description = 500 caracteres
 *   /pt/filmes/piratas-do-caribe.../     description = 407 caracteres
 *   /pt/pessoas/leonardo-dicaprio/       description AUSENTE
 *
 * Duas falhas, nao uma. Onde a `meta_description` propria nao existe, os
 * presenters caiam para o `summary` INTEIRO e o despejavam na tag; onde nem o
 * fallback existia, a tag sumia. O buscador corta por volta de 155 a 160
 * caracteres, entao 504 nao e "descricao longa": e uma frase cortada no meio de
 * uma palavra, escolhida pelo buscador em vez de por nos.
 *
 * A regra: no maximo `META_DESCRIPTION_MAX` caracteres, e NUNCA cortando uma
 * palavra ao meio.
 *
 * O que esta funcao NAO faz, de proposito: ela nao inventa texto. Entrada vazia
 * devolve `null`, e cabe a pagina omitir a tag. Fabricar descricao a partir de
 * nada seria conteudo gerado sem origem — exatamente o que a governanca proibe.
 *
 * PURO: sem rede, banco, IO, Date ou Math.random.
 */

/** Teto de caracteres. Acima disto o buscador corta por conta propria. */
export const META_DESCRIPTION_MAX = 160

/**
 * Piso para aceitar um corte em fim de frase. Abaixo disto, cortar na frase
 * jogaria fora informacao demais e vale mais truncar na palavra.
 */
export const META_DESCRIPTION_MIN = 120

/** Reticencia (U+2026) — um caractere, nao tres pontos. */
const ELLIPSIS = '…'

/** Colapsa qualquer corrida de espaco/quebra em um espaco unico, e apara. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Ultimo fim de frase dentro da janela [`META_DESCRIPTION_MIN`, `limit`].
 * Devolve o indice APOS o pontuador, ou `-1` quando nao ha um utilizavel.
 */
function lastSentenceEnd(text: string, limit: number): number {
  let found = -1
  for (let i = META_DESCRIPTION_MIN; i < limit && i < text.length; i += 1) {
    const ch = text.charAt(i)
    if (ch !== '.' && ch !== '!' && ch !== '?') continue
    // So conta se o proximo caractere for espaco ou o fim — evita cortar em
    // "S.H.I.E.L.D." ou num numero decimal.
    const next = text.charAt(i + 1)
    if (next === '' || next === ' ') found = i + 1
  }
  return found
}

/**
 * Constroi a descricao a partir do texto de origem (`meta_description` propria
 * ou, na falta dela, o `summary` da entidade).
 *
 * Ordem de preferencia do corte:
 *  1. cabe inteiro no teto  -> devolve como esta;
 *  2. ha fim de frase na janela -> corta na frase, sem reticencia (o texto
 *     termina completo, entao reticencia mentiria dizendo que falta algo);
 *  3. caso contrario -> corta na ultima palavra inteira e acrescenta reticencia.
 *
 * O resultado NUNCA passa de `META_DESCRIPTION_MAX`, contando a reticencia.
 */
export function buildMetaDescription(source: string | null | undefined): string | null {
  if (typeof source !== 'string') return null

  const text = normalizeWhitespace(source)
  if (text.length === 0) return null
  if (text.length <= META_DESCRIPTION_MAX) return text

  const sentence = lastSentenceEnd(text, META_DESCRIPTION_MAX)
  if (sentence > 0) return text.slice(0, sentence).trim()

  // Reservamos um caractere para a reticencia.
  const room = META_DESCRIPTION_MAX - ELLIPSIS.length
  const head = text.slice(0, room + 1)
  const lastSpace = head.lastIndexOf(' ')

  // Palavra unica maior que a janela inteira: nao ha fronteira para respeitar,
  // entao corta no limite. Caso patologico, mas o contrato do teto vale sempre.
  if (lastSpace <= 0) return text.slice(0, room) + ELLIPSIS

  const cut = head.slice(0, lastSpace)
  // Tira pontuacao pendurada para nao produzir ",…" ou " ,…".
  return cut.replace(/[\s,;:.!?–—-]+$/u, '') + ELLIPSIS
}
