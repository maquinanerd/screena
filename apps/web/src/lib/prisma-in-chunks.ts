/**
 * prisma-in-chunks.ts — fatiamento de listas de ids para clausulas `IN (...)`.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE: A HOME CAIU QUANDO O CATALOGO PASSOU DE 32.767
 * ============================================================================
 * O protocolo de rede do PostgreSQL carrega os parametros de uma consulta
 * preparada num campo de contagem de 16 bits: o teto e 32.767 bind variables
 * POR CONSULTA. Uma clausula `IN (...)` gasta UM parametro por id.
 *
 * Enquanto o catalogo tinha 129 filmes, `entityId: { in: ids }` com "todos os
 * ids" era so desperdicio. Em 27/08/2026 o catalogo cruzou o teto e o
 * desperdicio virou queda: a home devolveu 500 com
 *
 *   prisma.entityTranslation.findMany() — too many bind variables:
 *   max 32767, received 32769   (P2035)
 *
 * 32.769 = 32.767 ids + os 2 escalares do mesmo `where` (`entityType` e
 * `languageCode`). Nao ha nada de errado com o dado nem com o indice: a
 * consulta simplesmente nao cabe no protocolo, e o erro so podia aparecer
 * depois que o catalogo crescesse — nenhum ambiente de teste tem 32 mil
 * titulos.
 *
 * O teto de 5.000 ids por lote e deliberadamente folgado em relacao aos 32.767:
 * a consulta pode ganhar outros escalares no `where` sem voltar a raspar o
 * limite, e o custo de sete idas ao banco em vez de uma e irrelevante perto de
 * uma pagina que nao renderiza.
 *
 * ATENCAO A ORDEM. O resultado de `findManyInChunks` e a CONCATENACAO dos
 * lotes; `orderBy` vale DENTRO de cada lote, nunca entre eles. So use com
 * consultas cujo consumidor reordena (os presenters de home/listagem fazem
 * isso) ou cuja ordem nao importa (mapas indexados por id). Consulta que
 * dependa de `orderBy` + `take` globais precisa de outra solucao — paginacao
 * de verdade, nao fatiamento.
 */

/**
 * Teto de ids por consulta. Ver o cabecalho: o limite REAL do PostgreSQL e
 * 32.767 parametros por consulta, contando os escalares do mesmo `where`.
 */
export const PRISMA_IN_CHUNK_SIZE = 5_000

/** Fatia `values` em blocos de no maximo `size` elementos, preservando a ordem. */
export function chunkForInClause<T>(
  values: readonly T[],
  size: number = PRISMA_IN_CHUNK_SIZE,
): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunkForInClause: size deve ser inteiro positivo, recebido ${size}`)
  }
  const out: T[][] = []
  for (let start = 0; start < values.length; start += size) {
    out.push(values.slice(start, start + size))
  }
  return out
}

/**
 * Executa `run` uma vez por lote de ids e concatena as linhas.
 *
 * Os lotes vao em SEQUENCIA, nao em `Promise.all`: um catalogo grande viraria
 * uma rajada de consultas simultaneas por requisicao numa pagina
 * `force-dynamic`, e o pool de conexoes e o recurso mais escasso justamente no
 * momento em que a home volta ao ar.
 *
 * Lista vazia nao vai ao banco; lista que cabe num lote so faz UMA consulta —
 * o caminho de quem chama nao muda enquanto o catalogo for pequeno.
 */
export async function findManyInChunks<Id, Row>(
  ids: readonly Id[],
  run: (chunk: Id[]) => Promise<Row[]>,
  size: number = PRISMA_IN_CHUNK_SIZE,
): Promise<Row[]> {
  const chunks = chunkForInClause(ids, size)
  if (chunks.length === 0) return []
  const first = chunks[0] as Id[]
  if (chunks.length === 1) return run(first)

  const rows: Row[] = []
  for (const chunk of chunks) {
    rows.push(...(await run(chunk)))
  }
  return rows
}
