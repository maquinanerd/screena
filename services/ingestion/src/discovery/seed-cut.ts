/**
 * seed-cut.ts — QUANTOS TITULOS A SEMENTE PEGA. Modulo PURO.
 *
 * ============================================================================
 * A PERGUNTA, E POR QUE ELA NAO TEM RESPOSTA DIRETA NO EXPORT
 * ============================================================================
 * "A semente pega o que passa no corte, nao um numero escolhido." Concordado — e
 * ai aparece o problema pratico: o corte editorial e **poster + titulo +
 * sinopse** (`checkEligibility`), e o Daily ID Export NAO carrega nenhum dos
 * tres. Ele traz `id`, `original_title`, `popularity`, `adult`, `video`.
 *
 * Ou seja: descobrir quem passa no corte exige UMA requisicao de detalhe POR
 * CANDIDATO. Avaliar o universo inteiro (1.234.581 filmes + 229.524 series no
 * export de 2026-08-20) custaria ~1,46 milhao de requisicoes — que e, ela
 * propria, a semente mais cara possivel.
 *
 * ============================================================================
 * ENTAO O CORTE E APLICADO EM ORDEM DE POPULARIDADE, E A CONTA E MEDIDA
 * ============================================================================
 * A avaliacao desce o ranking de popularidade e aplica o corte a cada titulo. O
 * numero que sai NAO e escolhido: e quantos passaram. O que se escolhe e ate
 * ONDE descer — e essa escolha tem base medida.
 *
 * A medicao esta em `../on-demand/eligibility.ts` (2026-08-14, amostra
 * estratificada sobre o export real, consultando o TMDB em pt-BR):
 *
 *   faixa de rank    passa no corte
 *   1–1.000               88%
 *   1.000–10.000          76%
 *   10.000–50.000         32%
 *   50.000–200.000        16%
 *   200.000+               8%
 *
 * O rendimento DESABA entre 10k e 50k: de 76% para 32%. Acima de 10k paga-se ~1,3
 * requisicao por pagina aproveitada; logo abaixo, ~3,1. E o joelho da curva, e e
 * o unico ponto da distribuicao que se justifica sozinho.
 *
 * ============================================================================
 * O QUE ESTE MODULO NAO FAZ
 * ============================================================================
 * Nao escolhe o teto: ele CALCULA, para o teto que o operador passar, quantos
 * titulos devem passar e quanto custa. E nao chama rede.
 */

/** Uma faixa do ranking com a taxa MEDIDA de aprovacao no corte. */
export interface EligibilityBand {
  /** Rank inicial (1-based, inclusivo). */
  readonly from: number
  /** Rank final (inclusivo). `Infinity` na ultima faixa. */
  readonly to: number
  /** Fracao que passa no corte (poster + titulo + sinopse pt-BR). */
  readonly passRate: number
}

/**
 * As faixas medidas em 2026-08-14. Fonte da medicao: o cabecalho de
 * `on-demand/eligibility.ts`. Nao invente faixa nova sem medir de novo.
 */
export const MEASURED_ELIGIBILITY_BANDS: readonly EligibilityBand[] = [
  { from: 1, to: 1_000, passRate: 0.88 },
  { from: 1_001, to: 10_000, passRate: 0.76 },
  { from: 10_001, to: 50_000, passRate: 0.32 },
  { from: 50_001, to: 200_000, passRate: 0.16 },
  { from: 200_001, to: Number.POSITIVE_INFINITY, passRate: 0.08 },
]

/**
 * O JOELHO da curva: o rank a partir do qual o rendimento do corte desaba.
 *
 * 10.000. Nao e um numero redondo escolhido por gosto — e a fronteira medida
 * entre 76% e 32% de aproveitamento. Descer abaixo dele mais que TRIPLICA o
 * custo por pagina publicada.
 */
export const ELIGIBILITY_KNEE_RANK = 10_000

/** Quantos titulos de uma faixa caem dentro de um teto de avaliacao. */
function bandOverlap(band: EligibilityBand, evaluated: number): number {
  if (evaluated < band.from) return 0
  const upper = Math.min(evaluated, band.to)
  return Math.max(0, upper - band.from + 1)
}

/** O resultado do corte para um vertical. */
export interface SeedCutProjection {
  /** Quantos titulos serao AVALIADOS (o teto de descida no ranking). */
  readonly evaluated: number
  /** Quantos devem PASSAR no corte, pela medicao. Arredondado para baixo. */
  readonly expectedEligible: number
  /** Requisicoes de detalhe: uma por titulo avaliado. */
  readonly requests: number
  /** Requisicoes por pagina aproveitada. Quanto menor, melhor o negocio. */
  readonly requestsPerEligible: number
  /** A contribuicao de cada faixa, para o relatorio nao ser uma caixa-preta. */
  readonly byBand: readonly {
    readonly from: number
    readonly to: number
    readonly evaluated: number
    readonly passRate: number
    readonly eligible: number
  }[]
}

/**
 * Projeta o corte para um teto de avaliacao.
 *
 * `evaluated <= 0` devolve zeros — nunca `NaN` disfarcado de plano. Divisao por
 * zero em `requestsPerEligible` devolve `Infinity` explicito: "avaliar isso nao
 * rende pagina nenhuma" e uma resposta, e ela precisa aparecer.
 */
export function projectSeedCut(
  evaluated: number,
  bands: readonly EligibilityBand[] = MEASURED_ELIGIBILITY_BANDS,
): SeedCutProjection {
  const total = Math.max(0, Math.trunc(evaluated))
  const byBand = bands
    .map((band) => {
      const inBand = bandOverlap(band, total)
      return {
        from: band.from,
        to: band.to,
        evaluated: inBand,
        passRate: band.passRate,
        eligible: Math.floor(inBand * band.passRate),
      }
    })
    .filter((entry) => entry.evaluated > 0)

  const expectedEligible = byBand.reduce((sum, entry) => sum + entry.eligible, 0)
  return {
    evaluated: total,
    expectedEligible,
    requests: total,
    requestsPerEligible: expectedEligible === 0 ? Number.POSITIVE_INFINITY : total / expectedEligible,
    byBand,
  }
}

/**
 * Quantos titulos precisam ser AVALIADOS para colher `target` elegiveis.
 *
 * Caminha faixa a faixa em vez de dividir pela taxa media: a taxa nao e uniforme,
 * e uma media ponderada erraria justamente na regiao onde o rendimento desaba —
 * que e onde a resposta importa.
 *
 * Devolve `null` quando o alvo e inalcancavel dentro de `maxEvaluated`. `null`, e
 * nao um numero grande: "nao da" e uma resposta diferente de "da, com muito
 * esforco", e colapsa-las esconderia um plano impossivel.
 */
export function evaluationNeededFor(
  target: number,
  maxEvaluated = 1_000_000,
  bands: readonly EligibilityBand[] = MEASURED_ELIGIBILITY_BANDS,
): number | null {
  if (target <= 0) return 0
  let eligible = 0
  let evaluated = 0
  for (const band of bands) {
    const bandSize = band.to === Number.POSITIVE_INFINITY ? maxEvaluated - evaluated : band.to - band.from + 1
    if (bandSize <= 0) continue
    const faltam = target - eligible
    const precisaNaFaixa = Math.ceil(faltam / band.passRate)
    if (precisaNaFaixa <= bandSize) return Math.min(maxEvaluated, evaluated + precisaNaFaixa)
    eligible += Math.floor(bandSize * band.passRate)
    evaluated += bandSize
    if (evaluated >= maxEvaluated) return null
  }
  return null
}
