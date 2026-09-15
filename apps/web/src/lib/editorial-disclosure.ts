/**
 * editorial-disclosure.ts — os avisos de transparencia editorial, num lugar so. PURO.
 *
 * A nota de IA sai no fim de toda materia marcada `aiAssisted`
 * (`app/pt/noticias/[slug]/page.tsx`) e e CITADA, palavra por palavra, na Politica
 * editorial (`app/pt/politica-editorial/page.tsx`). Escrita em dois lugares, a
 * citacao deixaria de ser a nota no primeiro dia em que uma das duas mudasse.
 */

/** A nota do fim da materia produzida com apoio de ferramentas de IA. */
export const AI_ASSISTED_ARTICLE_NOTE =
  "Conteúdo produzido pela equipe editorial da Cinerie, com apoio de ferramentas de inteligência artificial.";
