/**
 * Blocos de valor proprios (sinal de qualidade / ranqueamento).
 *
 * O CANON da Screena define 15 tipos de "bloco de valor" — conteudo proprio
 * que diferencia uma pagina de um simples espelho de dado cru de API.
 *
 * Desde a politica 2026-07 (invariante 5 — indexacao total), a contagem de
 * blocos de valor NAO gate mais a indexacao: toda entidade sincronizada indexa.
 * Blocos de valor viraram alavanca de qualidade/ranqueamento (E-E-A-T, citacao
 * em AI Overview) e sinal de "riqueza" da pagina (hasUniqueValue) — nao pre-
 * requisito de `index`.
 *
 * Este modulo e puro: nao acessa rede, banco, sistema de arquivos, Date ou
 * Math.random. Apenas declara a lista canonica e conta blocos validos.
 */

/**
 * Os 15 tipos de bloco de valor aceitos pelo gate anti-thin, na ordem do CANON.
 *
 * Cada string identifica um tipo de bloco proprio. Blocos gerados por IA so
 * contam como valor quando vierem de payload controlado, passarem na validacao
 * anti-alucinacao, estiverem salvos em content_blocks e com review_status
 * permitido — a contagem aqui assume que o chamador ja filtrou esses casos.
 */
export const VALUE_BLOCK_TYPES = [
  "editorial_intro",
  "where_to_watch_by_country",
  "external_ratings_attributed",
  "critic_vs_audience_comparison",
  "own_review",
  "related_news",
  "useful_faq",
  "embedded_trailer",
  "commented_cast",
  "franchise_context",
  "chronological_order",
  "season_guide",
  "similar_titles",
  "update_history",
  "spoiler_split_analysis",
] as const;

/**
 * Uniao dos tipos de bloco de valor reconhecidos pelo gate anti-thin.
 */
export type ValueBlockType = (typeof VALUE_BLOCK_TYPES)[number];

/**
 * Conjunto de busca rapida (O(1)) para validar se uma string e um bloco de valor
 * reconhecido. Mantido fora da funcao para nao recriar a cada chamada.
 */
const VALUE_BLOCK_TYPE_SET: ReadonlySet<string> = new Set(VALUE_BLOCK_TYPES);

/**
 * Verifica se uma string corresponde a um tipo de bloco de valor canonico.
 */
export function isValueBlockType(value: string): value is ValueBlockType {
  return VALUE_BLOCK_TYPE_SET.has(value);
}

/**
 * Conta quantos blocos de valor validos e DISTINTOS existem na entrada.
 *
 * - Ignora qualquer string que nao seja um tipo de bloco de valor canonico.
 * - Conta cada tipo no maximo uma vez (duplicatas nao inflam a pontuacao).
 *
 * Funcao pura e determinista. O resultado e um sinal de qualidade/ranqueamento
 * (hasUniqueValue) — NAO decide mais indexacao (invariante 5, politica 2026-07:
 * indexacao total).
 */
export function countValueBlocks(blocks: string[]): number {
  const seen = new Set<ValueBlockType>();
  for (const block of blocks) {
    if (isValueBlockType(block)) {
      seen.add(block);
    }
  }
  return seen.size;
}
