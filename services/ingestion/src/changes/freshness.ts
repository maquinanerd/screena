/**
 * freshness.ts — Sentinela do `/changes` incremental. Modulo PURO.
 *
 * O PROBLEMA QUE ISTO RESOLVE: um `/changes` que falha em silencio congela o
 * catalogo inteiro sem que nenhum erro apareca. As paginas continuam
 * respondendo, os testes continuam verdes, e o catalogo simplesmente para no
 * tempo. E o modo de falha mais caro de detectar, porque parece sucesso.
 *
 * Tres sinais, que juntos tornam o congelamento visivel:
 *  1. `lastSuccessAt` — quando o `/changes` daquele tipo terminou bem pela
 *     ultima vez. Nao "quando rodou": quando TERMINOU BEM.
 *  2. ALARME por atraso — passou do intervalo esperado (mais uma folga), e
 *     `stale`. Sem checkpoint algum, e `never_ran`, que NAO e o mesmo que
 *     "rodou e nao mudou nada".
 *  3. Delta ZERO num dia e SUSPEITO, nao sucesso. O TMDB muda milhares de
 *     entidades por dia; zero significa quase sempre que a janela nao foi
 *     consultada, nao que o mundo parou.
 */

/** Tipos que o `/changes` cobre (o TMDB nao expoe changes para os demais). */
export const FRESHNESS_KINDS = ['movie', 'tv', 'person'] as const

/** Um tipo coberto por `/changes`. */
export type FreshnessKind = (typeof FRESHNESS_KINDS)[number]

/** Estado de frescor de um tipo. */
export type FreshnessState =
  /** Dentro do intervalo esperado e com delta plausivel. */
  | 'fresh'
  /** Rodou bem, mas o delta foi ZERO — suspeito, nao sucesso. */
  | 'suspicious_zero_delta'
  /** Passou do intervalo esperado + folga. O catalogo esta congelando. */
  | 'stale'
  /** Nunca houve execucao bem-sucedida registrada. */
  | 'never_ran'

/** Checkpoint da ultima execucao BEM-SUCEDIDA de um tipo. */
export interface FreshnessCheckpoint {
  readonly kind: FreshnessKind
  /** `null` quando nunca terminou bem. */
  readonly lastSuccessAt: Date | null
  /** Entidades que vieram no ultimo delta bem-sucedido. */
  readonly lastDeltaCount: number
}

/** Politica de frescor. */
export interface FreshnessPolicy {
  /** Intervalo esperado entre execucoes (o `/changes` roda diariamente). */
  readonly expectedIntervalMs: number
  /**
   * Folga antes de alarmar. Sem folga, um atraso de minutos por fila cheia
   * viraria alarme — e alarme que toca a toa deixa de ser lido.
   */
  readonly graceMs: number
  /** Delta abaixo disto num ciclo bem-sucedido e considerado suspeito. */
  readonly minPlausibleDelta: number
}

/** Um dia, em ms. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Politica default: diario, com 6 h de folga, e delta minimo 1.
 *
 * `minPlausibleDelta: 1` e deliberadamente conservador: qualquer valor maior
 * seria um palpite sobre o volume do TMDB. Zero e o unico numero sobre o qual
 * da para afirmar algo com seguranca — o TMDB nunca tem um dia sem mudanca.
 */
export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  expectedIntervalMs: DAY_MS,
  graceMs: 6 * 60 * 60 * 1000,
  minPlausibleDelta: 1,
}

/** Avaliacao de um tipo. */
export interface FreshnessAssessment {
  readonly kind: FreshnessKind
  readonly state: FreshnessState
  /** Ha quanto tempo terminou bem; `null` quando nunca terminou. */
  readonly ageMs: number | null
  readonly lastDeltaCount: number
  /** Mensagem legivel. NUNCA vazia quando o estado nao e `fresh`. */
  readonly detail: string
}

/** Veredito do conjunto. */
export interface FreshnessVerdict {
  readonly assessments: readonly FreshnessAssessment[]
  /** true quando algum tipo esta `stale` ou `never_ran`: alarme de verdade. */
  readonly alarm: boolean
  /** true quando algum tipo teve delta zero: investigar, sem alarmar. */
  readonly suspicious: boolean
}

/** Avalia UM tipo. Puro: o "agora" e injetado. */
export function assessFreshness(
  checkpoint: FreshnessCheckpoint,
  now: Date,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): FreshnessAssessment {
  const { kind, lastSuccessAt, lastDeltaCount } = checkpoint

  if (lastSuccessAt === null) {
    return {
      kind,
      state: 'never_ran',
      ageMs: null,
      lastDeltaCount,
      // Distinguir isto de "rodou e nao mudou nada" e o ponto inteiro.
      detail: `${kind}: nenhuma execucao bem-sucedida registrada — isto NAO e "sem mudancas"`,
    }
  }

  const ageMs = now.getTime() - lastSuccessAt.getTime()
  const deadlineMs = policy.expectedIntervalMs + policy.graceMs

  if (ageMs > deadlineMs) {
    const hours = Math.floor(ageMs / (60 * 60 * 1000))
    return {
      kind,
      state: 'stale',
      ageMs,
      lastDeltaCount,
      detail:
        `${kind}: ultimo sucesso ha ${hours} h, acima do limite de ` +
        `${Math.floor(deadlineMs / (60 * 60 * 1000))} h — o catalogo esta congelando`,
    }
  }

  if (lastDeltaCount < policy.minPlausibleDelta) {
    return {
      kind,
      state: 'suspicious_zero_delta',
      ageMs,
      lastDeltaCount,
      detail:
        `${kind}: ultimo ciclo trouxe ${lastDeltaCount} entidade(s) — ` +
        'delta zero num dia e suspeito, nao sucesso',
    }
  }

  return {
    kind,
    state: 'fresh',
    ageMs,
    lastDeltaCount,
    detail: `${kind}: ${lastDeltaCount} entidade(s) no ultimo delta`,
  }
}

/**
 * Avalia todos os tipos cobertos.
 *
 * Um tipo SEM checkpoint na entrada nao e omitido do resultado: ele entra como
 * `never_ran`. Omitir seria exatamente o descarte silencioso que este modulo
 * existe para impedir — um tipo que nunca rodou sumiria do relatorio e pareceria
 * saudavel por ausencia.
 */
export function assessAllFreshness(
  checkpoints: readonly FreshnessCheckpoint[],
  now: Date,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
  kinds: readonly FreshnessKind[] = FRESHNESS_KINDS,
): FreshnessVerdict {
  const byKind = new Map(checkpoints.map((c) => [c.kind, c]))
  const assessments = kinds.map((kind) =>
    assessFreshness(
      byKind.get(kind) ?? { kind, lastSuccessAt: null, lastDeltaCount: 0 },
      now,
      policy,
    ),
  )
  return {
    assessments,
    alarm: assessments.some((a) => a.state === 'stale' || a.state === 'never_ran'),
    suspicious: assessments.some((a) => a.state === 'suspicious_zero_delta'),
  }
}

/** Renderiza o veredito. Imprime SEMPRE, inclusive quando tudo esta fresco. */
export function renderFreshnessVerdict(verdict: FreshnessVerdict): string {
  const lines = ['FRESCOR DO /changes']
  for (const assessment of verdict.assessments) {
    const marker = assessment.state === 'fresh' ? ' ' : '!'
    lines.push(`  ${marker} [${assessment.state}] ${assessment.detail}`)
  }
  if (verdict.alarm) lines.push('  ALARME: ha tipo congelado ou que nunca rodou.')
  return lines.join('\n')
}
