/**
 * brake.ts — FREIO de mudanca em massa da promocao de midia. PURO.
 *
 * ============================================================================
 * IRMAO DE `packages/seo/src/catalog-mass-change.ts` (#221)
 * ============================================================================
 * Mesma forma, mesmo contrato, mesmo exit code (5). O que muda e a UNIDADE: la
 * o freio conta paginas que entram/saem do sitemap; aqui conta LINHAS que
 * passam de invisiveis a publicas. Reaproveitar aquele modulo exigiria torcer o
 * vocabulario dele (`entersIndex`/`leavesIndex`) para significar outra coisa —
 * e um freio cujo relatorio mente sobre o que contou nao e reutilizacao.
 *
 * ============================================================================
 * POR QUE A PROMOCAO DE MIDIA PRECISA DE FREIO
 * ============================================================================
 * `tmdb_videos` NAO TEM TRIGGER. Diferente de `watch_availability`, aqui um
 * `UPDATE` mal escopado nao encontra nenhuma barreira no banco. E o modo de
 * selecao desta ferramenta e por CRITERIO, nao por `--ids` explicito: com dezenas
 * de milhares de linhas, exigir ids seria inutilizavel, entao a rede de seguranca
 * tem de estar no volume.
 *
 * A secao 6 do CLAUDE.md exige revisao HUMANA para publicacao. Uma execucao que
 * torna publicas mil linhas de dado de terceiro E publicacao, mesmo que cada
 * linha isolada passe em todos os guardrails.
 *
 * ============================================================================
 * O DENOMINADOR E A TABELA INTEIRA, NAO A SELECAO
 * ============================================================================
 * Esta e a decisao que faz o freio funcionar, e ela e facil de errar. Se
 * `evaluated` fosse "as linhas que a consulta trouxe", a razao seria sempre
 * 100% (toda candidata muda) e o teto proporcional viraria ruido constante.
 *
 * `evaluated` e o total de linhas do ALVO no banco — todas as de `tmdb_videos`,
 * ou todas as de pessoa/profile em `tmdb_images`. Assim a razao responde a
 * pergunta certa: *que fracao do acervo esta indo ao ar nesta execucao?*
 *
 * Consequencia ASSUMIDA: a promocao do ACERVO e 100% dele, estoura os dois tetos
 * e exige `--confirm-mass-change`. Isso nao e o freio atrapalhando;
 * e o freio funcionando. Acender o acervo inteiro de uma vez e exatamente o ato
 * que precisa de assinatura humana. Depois dela, o regime normal (o punhado de
 * videos que a ingestao traz por dia) passa livre.
 */

import type { PromotionTarget } from './types.js'

/** Tetos do freio. Disparam em OU: passar de QUALQUER um dos dois trava. */
export interface MassChangeThresholds {
  /** Numero absoluto de linhas mutadas tolerado por execucao. */
  readonly maxChanges: number
  /** Fracao das linhas do alvo (0..1). */
  readonly maxChangeRatio: number
}

/**
 * Tetos default. Os MESMOS numeros do #221 (500 / 5%), de proposito: dois
 * freios do mesmo repositorio com tetos diferentes viram duas politicas, e
 * ninguem lembra qual vale onde.
 */
export const DEFAULT_MASS_CHANGE_THRESHOLDS: MassChangeThresholds = {
  maxChanges: 500,
  maxChangeRatio: 0.05,
}

/** Censo de uma execucao. */
export interface PromotionCensus {
  readonly target: PromotionTarget
  /** Linhas do alvo no banco. Denominador do teto proporcional. */
  readonly totalInTarget: number
  /** Linhas inspecionadas nesta execucao (apos os filtros de escopo). */
  readonly inspected: number
  /** Linhas que MUDARIAM de estado. Numerador dos dois tetos. */
  readonly changing: number
  /** Recusas por motivo, ordem de primeira aparicao. */
  readonly byReason: ReadonlyArray<{ readonly reason: string; readonly count: number }>
  /** Elegiveis por tipo de video (ou tipo de imagem). O "o que" do censo. */
  readonly byType: ReadonlyArray<{ readonly type: string; readonly count: number }>
  /** Elegiveis por entidade (`movie`/`tv`/`person`). */
  readonly byEntityType: ReadonlyArray<{ readonly entityType: string; readonly count: number }>
  /**
   * Elegiveis oficiais vs nao-oficiais (so faz sentido em `video`).
   *
   * Sempre reportado, mesmo quando `--only-official` esta desligado — sobretudo
   * quando esta desligado. O dono decidiu nao filtrar por `official`; o censo
   * existe para que essa decisao seja VISTA a cada execucao, nunca herdada em
   * silencio por quem rodar o comando daqui a seis meses.
   */
  readonly official: { readonly yes: number; readonly no: number; readonly unknown: number }
}

/** Qual teto estourou. */
export type MassChangeTrigger = 'absolute' | 'ratio'

/** Veredito do freio. */
export interface MassChangeVerdict {
  readonly totalInTarget: number
  readonly changing: number
  /** changing / totalInTarget (0 quando o alvo esta vazio). */
  readonly changeRatio: number
  readonly limits: MassChangeThresholds
  /**
   * ARITMETICA pura: passou de algum teto? Independe do opt-in — e o que permite
   * ao `--confirm-mass-change` REGISTRAR que houve mudanca em massa, em vez de
   * apagar o fato.
   */
  readonly exceeded: boolean
  readonly exceededBy: readonly MassChangeTrigger[]
  /** O operador passou `--confirm-mass-change`? */
  readonly confirmed: boolean
  /** `exceeded && !confirmed`. Quando `true`, NADA pode ser gravado. */
  readonly blocked: boolean
  readonly explanation: string
}

/** Aplica defaults e saneia tetos vindos da CLI. */
export function resolveMassChangeThresholds(
  partial?: Partial<MassChangeThresholds>,
): MassChangeThresholds {
  const maxChanges = partial?.maxChanges
  const maxChangeRatio = partial?.maxChangeRatio
  return {
    maxChanges:
      typeof maxChanges === 'number' && Number.isFinite(maxChanges)
        ? Math.max(0, Math.floor(maxChanges))
        : DEFAULT_MASS_CHANGE_THRESHOLDS.maxChanges,
    maxChangeRatio:
      typeof maxChangeRatio === 'number' && Number.isFinite(maxChangeRatio)
        ? Math.min(1, Math.max(0, maxChangeRatio))
        : DEFAULT_MASS_CHANGE_THRESHOLDS.maxChangeRatio,
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

/**
 * Decide se a execucao pode gravar.
 *
 * Comparacao ESTRITA (`>`): um teto de 500 tolera exatamente 500 e trava no 501.
 * Teto e o ultimo valor aceito, nao o primeiro recusado.
 */
export function evaluateMassChangeBrake(input: {
  readonly census: PromotionCensus
  readonly thresholds?: Partial<MassChangeThresholds>
  readonly confirmed: boolean
}): MassChangeVerdict {
  const limits = resolveMassChangeThresholds(input.thresholds)
  const { totalInTarget, changing } = input.census
  const changeRatio = totalInTarget === 0 ? 0 : changing / totalInTarget

  const exceededBy: MassChangeTrigger[] = []
  if (changing > limits.maxChanges) exceededBy.push('absolute')
  if (changeRatio > limits.maxChangeRatio) exceededBy.push('ratio')
  const exceeded = exceededBy.length > 0
  const blocked = exceeded && !input.confirmed

  const scale = `${changing} linha(s) de ${totalInTarget} no alvo (${pct(changeRatio)})`
  const caps = `tetos: ${limits.maxChanges} absoluto · ${pct(limits.maxChangeRatio)} proporcional`
  const burst = exceededBy.join(' e ')

  let explanation: string
  if (!exceeded) {
    explanation = `volume normal: ${scale}; ${caps}.`
  } else if (input.confirmed) {
    explanation =
      `MUDANCA EM MASSA CONFIRMADA por --confirm-mass-change: ${scale}; ${caps}` +
      ` (estourou: ${burst}).`
  } else {
    explanation =
      `MUDANCA EM MASSA RECUSADA: ${scale}; ${caps} (estourou: ${burst}).` +
      ` Nada foi gravado. CLAUDE.md secao 6 exige revisao HUMANA para publicacao:` +
      ` revise o censo acima e, se a mudanca for intencional, repita com --confirm-mass-change.`
  }

  return {
    totalInTarget,
    changing,
    changeRatio,
    limits,
    exceeded,
    exceededBy: Object.freeze(exceededBy),
    confirmed: input.confirmed,
    blocked,
    explanation,
  }
}
