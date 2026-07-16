/**
 * fold.ts — Normalizacao de texto para busca (PURO, acento-insensivel).
 *
 * "Dobra" (fold) um texto: decompoe (NFD), remove marcas de acento, passa a
 * minusculo e colapsa espacos. E a MESMA transformacao aplicada ao
 * `normalized_text` gravado na projecao E ao termo de busca — assim os dois
 * lados casam de forma deterministica, sem depender de o `unaccent` do Postgres
 * coincidir byte a byte com o JS. (O wrapper IMMUTABLE `immutable_unaccent`
 * existe no banco para o indice funcional e o refino de ranking titulo-vs-alias,
 * nao para o casamento de base.)
 */

// Marcas combinantes Unicode (acentos) removidas apos a decomposicao NFD.
const COMBINING_MARKS = /[̀-ͯ]/g

/** Dobra um texto: sem acento, minusculo, espacos colapsados. */
export function foldText(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
