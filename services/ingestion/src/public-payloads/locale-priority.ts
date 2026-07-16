/**
 * locale-priority.ts — Prioridade de locale, PURA e testavel.
 *
 * Vive fora do reader (que e excluido do typecheck principal) porque esta e a
 * regra que garante determinismo: `pt-BR` vence `pt`, INDEPENDENTE da ordem em
 * que o banco devolver as linhas.
 *
 * Por que nao confiar no banco: um `findMany` sem `orderBy` nao tem ordem
 * garantida — ela depende do plano (seq scan devolve ordem fisica; index scan
 * devolve ordem do indice). Reduzir linhas com `new Map(rows.map(...))` deixa a
 * ULTIMA vencer, ou seja, a resposta passa a depender do plano. Hoje o plano
 * favorece a resposta certa por acidente (`'pt'` < `'pt-BR'` no indice, entao o
 * last-wins acerta) — exatamente o tipo de correcao acidental que quebra quando
 * o planejador muda de ideia. Aqui a escolha e explicita.
 */

/** Locales aceitos, em ORDEM DE PRIORIDADE (o primeiro vence). */
export const LOCALE_PRIORITY = ['pt-BR', 'pt'] as const

/** Um locale suportado nos slugs/traducoes. */
export type SupportedLocale = (typeof LOCALE_PRIORITY)[number]

/** Linha minima que participa da escolha por locale. */
export interface LocaleScopedRow {
  readonly entityId: bigint
  readonly languageCode: string
}

/**
 * Peso de prioridade (MENOR vence). Locale desconhecido perde de todos — nunca
 * ganha por vir por ultimo.
 */
export function localeRank(languageCode: string): number {
  const index = (LOCALE_PRIORITY as readonly string[]).indexOf(languageCode)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/**
 * Reduz linhas multi-locale a UMA por entidade, pela prioridade explicita.
 *
 * Deterministico: o resultado depende SO do `languageCode`, nunca da ordem de
 * entrada. Empate exato (mesmo locale duplicado) mantem a primeira linha.
 */
export function pickByLocale<T extends LocaleScopedRow>(rows: readonly T[]): Map<string, T> {
  const best = new Map<string, T>()
  for (const row of rows) {
    const key = row.entityId.toString()
    const current = best.get(key)
    if (current === undefined || localeRank(row.languageCode) < localeRank(current.languageCode)) {
      best.set(key, row)
    }
  }
  return best
}

/** Escolhe UMA linha (a de maior prioridade) de um conjunto de uma entidade. */
export function pickOneByLocale<T extends LocaleScopedRow>(rows: readonly T[]): T | null {
  let best: T | null = null
  for (const row of rows) {
    if (best === null || localeRank(row.languageCode) < localeRank(best.languageCode)) {
      best = row
    }
  }
  return best
}
