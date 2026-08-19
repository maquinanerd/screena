/**
 * coverage.ts — O VEREDITO DE COBERTURA de um ciclo de reprocessamento.
 * Modulo PURO (sem Prisma, sem rede, sem relogio).
 *
 * ============ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA MATAR ============
 *
 * O relatorio da amostra decidia a frase "corpus INTEIRO" assim:
 *
 *     rows.length < total ? '(de N — suba --limit ...)' : '(corpus INTEIRO)'
 *
 * com `total` vindo de `source.count(kind)` — a MESMA fonte que produziu
 * `rows`. Um leitor apontado para um deposito que ja nao recebe escrita
 * (`tmdb_raw` depois de `TMDB_RAW_STORE_DRIVER=r2`) via 100 linhas, contava 100
 * linhas, e concluia que 100 era tudo. Em producao, com 129 filmes e 110 series
 * no catalogo, o comando afirmou cobertura total estando cego para 39
 * entidades — e reportou `falhas 0`.
 *
 * Um leitor NAO PODE declarar cobertura sobre um universo que ele mesmo define.
 * O denominador tem que vir de FORA do deposito: o catalogo real
 * (`movies`/`tv_shows`), que e o conjunto de entidades que o produto promete
 * cobrir.
 *
 * ============ POR QUE UMA UNIAO DISCRIMINADA, E NAO UM BOOLEANO ============
 *
 * `complete: true` e um construtor SEM os campos de lacuna, e `complete: false`
 * e um construtor que os EXIGE. Nao existe estado onde alguem afirme completude
 * carregando um `notScanned` positivo: o compilador recusa. Um booleano solto
 * permitiria exatamente o bug antigo — afirmar o veredito e ignorar a medida.
 *
 * As duas lacunas sao MEDIDAS SEPARADAS porque tem causas e curas diferentes:
 *  - `notScanned`      o `--limit` cortou antes do fim do catalogo (cura: subir
 *                      o limite; o dado provavelmente esta la);
 *  - `missingFromDepot` o id existe no catalogo e o bruto NAO existe no
 *                      deposito (cura: rodar o raw sync; subir o limite nao
 *                      resolve).
 * Somar as duas num numero so faria "rode com --limit maior" ser a recomendacao
 * para um caso em que ela e falsa.
 */

/** Medidas cruas de um ciclo, todas obrigatorias. */
export interface CorpusCoverageInput {
  /**
   * Entidades daquele tipo no CATALOGO (`movies`/`tv_shows`). O denominador
   * autoritativo — nunca a contagem do deposito.
   */
  readonly catalogTotal: number
  /** Ids efetivamente considerados nesta execucao (depois do `--limit`). */
  readonly scanned: number
  /** Dos escaneados, quantos NAO tinham bruto arquivado no deposito. */
  readonly missingFromDepot: number
}

/** Por que a cobertura nao foi total. Cada motivo tem cura propria. */
export type CorpusCoverageGap = 'limit-truncated' | 'depot-gap' | 'both'

/**
 * Veredito. So o construtor `complete: true` autoriza a frase "corpus INTEIRO",
 * e ele nao carrega lacuna nenhuma.
 */
export type CorpusCoverageVerdict =
  | { readonly complete: true; readonly catalogTotal: number; readonly scanned: number }
  | {
      readonly complete: false
      readonly gap: CorpusCoverageGap
      readonly catalogTotal: number
      readonly scanned: number
      /** Entidades do catalogo que o `--limit` deixou de fora. */
      readonly notScanned: number
      /** Entidades escaneadas cujo bruto nao existe no deposito. */
      readonly missingFromDepot: number
    }

/** Erro de medida incoerente — preferimos parar a publicar um veredito torto. */
export class CorpusCoverageInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CorpusCoverageInputError'
  }
}

/**
 * Deriva o veredito.
 *
 * FAIL-CLOSED em duas frentes:
 *  - medida negativa, nao-inteira ou incoerente (`missingFromDepot > scanned`,
 *    `scanned > catalogTotal`) LANCA, em vez de virar um veredito plausivel;
 *  - catalogo VAZIO nao e cobertura total. "Cobri tudo" sobre zero entidade e a
 *    mesma afirmacao vazia que o defeito original produzia, so que pelo outro
 *    lado — e nesta cadeia um catalogo zerado significa banco errado, nao
 *    trabalho concluido.
 */
export function describeCorpusCoverage(input: CorpusCoverageInput): CorpusCoverageVerdict {
  const { catalogTotal, scanned, missingFromDepot } = input
  for (const [name, value] of [
    ['catalogTotal', catalogTotal],
    ['scanned', scanned],
    ['missingFromDepot', missingFromDepot],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new CorpusCoverageInputError(
        `${name} deve ser inteiro >= 0; recebido ${JSON.stringify(value)}`,
      )
    }
  }
  if (missingFromDepot > scanned) {
    throw new CorpusCoverageInputError(
      `missingFromDepot (${missingFromDepot}) nao pode exceder scanned (${scanned}): ` +
        'so se mede ausencia entre o que foi consultado.',
    )
  }
  if (scanned > catalogTotal) {
    throw new CorpusCoverageInputError(
      `scanned (${scanned}) excede catalogTotal (${catalogTotal}): o denominador do catalogo ` +
        'esta menor que o proprio conjunto escaneado — provavel fonte errada para o total.',
    )
  }

  const notScanned = catalogTotal - scanned
  if (catalogTotal === 0) {
    return {
      complete: false,
      gap: 'limit-truncated',
      catalogTotal,
      scanned,
      notScanned: 0,
      missingFromDepot,
    }
  }
  if (notScanned === 0 && missingFromDepot === 0) {
    return { complete: true, catalogTotal, scanned }
  }
  const gap: CorpusCoverageGap =
    notScanned > 0 && missingFromDepot > 0 ? 'both' : notScanned > 0 ? 'limit-truncated' : 'depot-gap'
  return { complete: false, gap, catalogTotal, scanned, notScanned, missingFromDepot }
}

/**
 * Uma linha para o operador. A frase "corpus INTEIRO" so pode ser produzida a
 * partir do construtor `complete: true` — nao ha caminho neste corpo que a
 * emita para um veredito com lacuna.
 */
export function renderCorpusCoverage(verdict: CorpusCoverageVerdict): string {
  if (verdict.complete) {
    return `cobertura      ${verdict.scanned}/${verdict.catalogTotal} do catalogo  (corpus INTEIRO)`
  }
  const causes: string[] = []
  if (verdict.notScanned > 0) {
    causes.push(`${verdict.notScanned} nao escaneada(s) — suba --limit`)
  }
  if (verdict.missingFromDepot > 0) {
    causes.push(
      `${verdict.missingFromDepot} SEM bruto no deposito — rode o raw sync (subir --limit NAO resolve)`,
    )
  }
  if (verdict.catalogTotal === 0) {
    causes.push('catalogo VAZIO para este tipo — fonte do denominador provavelmente errada')
  }
  return (
    `cobertura      ${verdict.scanned}/${verdict.catalogTotal} do catalogo  ` +
    `(INCOMPLETA: ${causes.join(' · ')})`
  )
}

/**
 * Divergencia entre deposito e catalogo e motivo ACIONAVEL, nao rodape: quando
 * o veredito nao e completo, o comando precisa sinalizar isso no proprio codigo
 * de saida, para que um agendador nao leia "0 falhas" como "nada a fazer".
 * `true` = o ciclo deve terminar em estado de atencao.
 */
export function coverageDemandsAttention(verdict: CorpusCoverageVerdict): boolean {
  return !verdict.complete
}
