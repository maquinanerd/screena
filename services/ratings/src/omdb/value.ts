/**
 * value.ts — Parser PURO do campo `Ratings[].Value` da OMDb.
 *
 * A OMDb entrega o valor como STRING, num formato que depende da fonte:
 *
 *   "7.6/10"  -> IMDb            (media de usuarios, escala 10)
 *   "85%"     -> Rotten Tomatoes (percentual de criticas positivas, escala 100)
 *   "67/100"  -> Metacritic      (metascore, escala 100)
 *
 * REGRA CENTRAL: a escala sai do PROPRIO literal, nunca de um chute. `"85%"` e
 * escala 100 porque o simbolo diz isso; `"7.6/10"` e escala 10 porque o
 * denominador diz isso. Nada e reescalado, convertido ou normalizado — 85% do
 * Rotten Tomatoes nao e 8,5 de coisa nenhuma (invariante 1).
 *
 * O que este modulo NAO faz: nao sabe qual fonte e, nao valida se a escala lida
 * bate com a escala canonica daquela fonte (isso e `mapping.ts` +
 * `validateRating`), e nao arredonda.
 *
 * FAIL-CLOSED: `"N/A"`, string vazia e qualquer formato fora dos tres acima
 * devolvem recusa COM MOTIVO. Nunca `null` mudo.
 */

/** Valor lido com sucesso: numero + escala, ambos vindos do literal. */
export interface ParsedRatingValue {
  readonly value: number
  readonly scale: number
}

/** Por que o literal nao virou valor. */
export type RatingValueRefusal =
  /** Campo ausente, nao textual, vazio ou so espaco. */
  | 'empty'
  /** O sentinela explicito da OMDb para "nao ha nota". */
  | 'not-available'
  /** Nao casou com nenhum dos tres formatos conhecidos. */
  | 'unrecognized-format'
  /** Casou com o formato, mas o numero e invalido (NaN/negativo/escala <= 0). */
  | 'invalid-number'
  /** Casou com o formato, mas o valor excede a propria escala declarada. */
  | 'value-exceeds-scale'

/** Resultado do parse: valor, ou recusa com motivo legivel. */
export type RatingValueResult =
  | { readonly ok: true; readonly parsed: ParsedRatingValue }
  | { readonly ok: false; readonly refusal: RatingValueRefusal; readonly detail: string }

/** `"7.6/10"`, `"67/100"` — numero, barra, denominador. */
const FRACTION_PATTERN = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/
/** `"85%"` — numero seguido de porcento. Escala implicita e SEMPRE 100. */
const PERCENT_PATTERN = /^(\d+(?:\.\d+)?)\s*%$/

/** Escala de um percentual. Nao e configuravel: `%` significa "de 100". */
export const PERCENT_SCALE = 100

/**
 * Sentinelas da OMDb para "nao ha valor". Comparados em minusculas e trimados.
 * Sao DISTINTOS de "formato irreconhecivel": um diz "nao existe nota", o outro
 * diz "existe algo que nao sei ler" — e o segundo merece investigacao.
 */
const NOT_AVAILABLE: ReadonlySet<string> = new Set(['n/a', 'na', 'null', 'none', '-'])

function refuse(refusal: RatingValueRefusal, detail: string): RatingValueResult {
  return { ok: false, refusal, detail }
}

/**
 * Interpreta UM literal de `Ratings[].Value`.
 *
 * Aceita exatamente tres formatos (fracao, percentual) e recusa todo o resto
 * com motivo. Nunca lanca.
 */
export function parseOmdbRatingValue(raw: unknown): RatingValueResult {
  if (typeof raw !== 'string') {
    return refuse('empty', `Value ausente ou nao textual (tipo ${typeof raw})`)
  }

  const trimmed = raw.trim()
  if (trimmed === '') return refuse('empty', 'Value vazio')

  if (NOT_AVAILABLE.has(trimmed.toLowerCase())) {
    return refuse('not-available', `Value "${trimmed}": a fonte nao publicou nota`)
  }

  const percent = PERCENT_PATTERN.exec(trimmed)
  if (percent !== null) {
    const value = Number(percent[1])
    if (!Number.isFinite(value)) {
      return refuse('invalid-number', `Value "${trimmed}": percentual nao numerico`)
    }
    if (value > PERCENT_SCALE) {
      return refuse('value-exceeds-scale', `Value "${trimmed}": percentual acima de 100`)
    }
    return { ok: true, parsed: { value, scale: PERCENT_SCALE } }
  }

  const fraction = FRACTION_PATTERN.exec(trimmed)
  if (fraction !== null) {
    const value = Number(fraction[1])
    const scale = Number(fraction[2])
    if (!Number.isFinite(value) || !Number.isFinite(scale)) {
      return refuse('invalid-number', `Value "${trimmed}": fracao nao numerica`)
    }
    if (scale <= 0) {
      return refuse('invalid-number', `Value "${trimmed}": denominador precisa ser > 0`)
    }
    if (value > scale) {
      return refuse('value-exceeds-scale', `Value "${trimmed}": numerador acima do denominador`)
    }
    return { ok: true, parsed: { value, scale } }
  }

  return refuse(
    'unrecognized-format',
    `Value "${trimmed}": fora dos formatos conhecidos (N/M, N%)`,
  )
}
