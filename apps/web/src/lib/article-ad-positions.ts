/**
 * article-ad-positions.ts — ONDE os slots OpaPreço entram no corpo da matéria.
 * PURO (sem rede, DB, env ou IO).
 *
 * A matéria tem no máximo QUATRO slots (OPAPRECO-SLOT-MAP.md; o `article-mid`
 * do canônico foi removido na implementação):
 *
 *   article-top        antes do 1º parágrafo, abaixo do título/linha fina
 *   article-inline-01  depois do 3º parágrafo (do 2º, quando o corpo tem só 3)
 *   article-inline-02  no fim do corpo, só com >= 3 parágrafos depois do inline-01
 *   article-bottom     depois da matéria, antes de "Leia também"
 *
 * Os dois de cima e de baixo não dependem do corpo. Os dois do MEIO dependem,
 * e este módulo decide só esses dois — devolvendo o ÍNDICE DE CORTE na lista de
 * blocos (o slot entra ANTES do bloco desse índice). `null` = o slot não entra.
 *
 * Só conta como parágrafo o que é TEXTO de leitura (parágrafo e citação).
 * Cortar numa contagem que inclui imagem, divisor ou ficha poria o anúncio
 * entre uma imagem e a legenda dela, ou colado num divisor.
 */

/** Parágrafos depois dos quais o `article-inline-01` entra (spec §6: 2º ou 3º). */
const INLINE_01_AFTER = 3;

/** Mínimo de parágrafos entre o `article-inline-01` e o `article-inline-02` (spec §6). */
const MIN_TEXT_BETWEEN_INLINES = 3;

export interface ArticleAdCuts {
  /** Índice de corte do `article-inline-01`, ou `null`. */
  readonly inline01: number | null;
  /** Índice de corte do `article-inline-02`, ou `null`. Sempre o fim do corpo. */
  readonly inline02: number | null;
}

/**
 * Recebe, para cada bloco do corpo na ordem, se ele é parágrafo de leitura.
 */
export function planArticleAdCuts(isText: readonly boolean[]): ArticleAdCuts {
  const textCount = isText.filter(Boolean).length;
  // Corpo curto (até 2 parágrafos): só topo e rodapé. Um inline no fim de dois
  // parágrafos ficaria colado no slot de topo de um lado e no de baixo do outro.
  if (textCount < 3) return { inline01: null, inline02: null };

  const after = textCount >= INLINE_01_AFTER + 1 ? INLINE_01_AFTER : 2;
  let seen = 0;
  let inline01 = isText.length;
  for (let index = 0; index < isText.length; index += 1) {
    if (isText[index] === true) seen += 1;
    if (seen === after) {
      inline01 = index + 1;
      break;
    }
  }

  const textAfter = isText.slice(inline01).filter(Boolean).length;
  const inline02 = textAfter >= MIN_TEXT_BETWEEN_INLINES ? isText.length : null;
  return { inline01, inline02 };
}
