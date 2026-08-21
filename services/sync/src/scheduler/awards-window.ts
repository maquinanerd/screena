/**
 * awards-window.ts — As JANELAS DE PREMIACAO. Modulo PURO, sem relogio proprio.
 *
 * ============================================================================
 * POR QUE PREMIO E O UNICO DADO COM RITMO SAZONAL
 * ============================================================================
 * Todos os outros dados desta plataforma mudam com uma taxa mais ou menos
 * constante. Premio nao: fora da temporada o texto de premiacao da OMDb fica
 * literalmente identico por meses, e dentro dela muda em horas — indicacoes
 * saem numa manha, vencedores numa noite.
 *
 * Um intervalo unico erraria nos dois sentidos: mensal perderia o vencedor por
 * ate 30 dias, e diario gastaria 11 meses de cota confirmando bytes iguais.
 *
 * ============================================================================
 * AS JANELAS SAO DE CALENDARIO, NAO DE DATA EXATA
 * ============================================================================
 * A data da cerimonia muda de ano para ano (o Oscar ja foi em fevereiro, marco
 * e abril). Fixar `2026-03-15` envelheceria em silencio no ano seguinte. Por
 * isso a janela e um INTERVALO DE MES/DIA que se repete todo ano e cobre com
 * folga o periodo de indicacao + cerimonia de cada premiacao.
 *
 * Folga deliberada: e barato manter a fila diaria por algumas semanas a mais, e
 * caro descobrir que a cerimonia caiu um dia fora da janela.
 *
 * ============================================================================
 * FUSO
 * ============================================================================
 * A avaliacao usa os campos UTC do `Date`. Uma janela de semanas nao muda de
 * veredito por causa de 3 horas de offset, e usar UTC mantem a funcao pura e
 * identica em qualquer container.
 */

/** Uma janela anual de premiacao. Mes 1-12, dia 1-31. */
export interface AwardsWindow {
  readonly name: string
  readonly fromMonth: number
  readonly fromDay: number
  readonly toMonth: number
  readonly toDay: number
  /** O que acontece nesta janela. Justifica a folga escolhida. */
  readonly rationale: string
}

/**
 * As janelas. Cobrem indicacao E cerimonia das tres premiacoes que movem o
 * texto da OMDb para o catalogo em pt-BR.
 */
export const AWARDS_WINDOWS: readonly AwardsWindow[] = [
  {
    name: 'Globo de Ouro',
    fromMonth: 12,
    fromDay: 1,
    toMonth: 1,
    toDay: 20,
    rationale:
      'Indicacoes em dezembro, cerimonia na primeira quinzena de janeiro. A janela ' +
      'ATRAVESSA a virada do ano — e por isso o comparador precisa tratar janela ' +
      'circular, senao dezembro ficaria de fora todo ano.',
  },
  {
    name: 'Oscar (Academy Awards)',
    fromMonth: 1,
    fromDay: 15,
    toMonth: 4,
    toDay: 15,
    rationale:
      'Indicacoes entre meados de janeiro e fevereiro; cerimonia entre fevereiro e ' +
      'marco, com anos recentes ja em marco cheio. Ate 15/04 por folga.',
  },
  {
    name: 'Emmy',
    fromMonth: 7,
    fromDay: 1,
    toMonth: 10,
    toDay: 15,
    rationale:
      'Indicacoes em julho, cerimonia entre setembro e comeco de outubro (a data ja ' +
      'variou em anos de greve). Ate 15/10 por folga.',
  },
]

/** Um dia do ano como numero comparavel (MMDD). */
function monthDay(month: number, day: number): number {
  return month * 100 + day
}

/**
 * A data esta dentro da janela?
 *
 * Trata janela CIRCULAR (que atravessa a virada do ano, como o Globo de Ouro):
 * quando `from > to`, dentro significa "depois do inicio OU antes do fim". Sem
 * esse ramo, dezembro cairia fora de uma janela que comeca em dezembro — o tipo
 * de erro que so aparece uma vez por ano e some antes de alguem investigar.
 */
export function isWithinWindow(window: AwardsWindow, date: Date): boolean {
  const value = monthDay(date.getUTCMonth() + 1, date.getUTCDate())
  const from = monthDay(window.fromMonth, window.fromDay)
  const to = monthDay(window.toMonth, window.toDay)
  if (from <= to) return value >= from && value <= to
  return value >= from || value <= to
}

/**
 * As janelas ativas em `now`. Lista vazia = fora de temporada.
 *
 * Devolve a LISTA, e nao um booleano, porque o painel do dono precisa dizer
 * QUAL premiacao encurtou o ritmo — "a fila esta diaria" sem o motivo parece
 * defeito de configuracao.
 */
export function activeAwardsWindows(now: Date): readonly AwardsWindow[] {
  return AWARDS_WINDOWS.filter((window) => isWithinWindow(window, now))
}

/** Estamos em temporada de premiacao? */
export function isAwardsSeason(now: Date): boolean {
  return activeAwardsWindows(now).length > 0
}
