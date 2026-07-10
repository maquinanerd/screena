/**
 * sanitize.ts — Sanitizacao de payload antes de virar SAMPLE em disco.
 *
 * Um sample existe para um humano inspecionar a FORMA do payload de uma API sem
 * schema publico. Ele nunca pode carregar segredo. Duas camadas, ambas ativas:
 *
 *  1. por CHAVE — qualquer campo cujo nome sugira credencial vira `[REDACTED]`
 *     (key, secret, token, authorization, password, apikey, cookie, x-rapidapi-*);
 *  2. por VALOR — qualquer string que CONTENHA um dos segredos conhecidos e
 *     substituida. Isso protege contra um upstream que ecoe a chave num campo
 *     de nome inocente (ex.: `{"debug":"...?key=abc"}`).
 *
 * `maxArrayItems` limita o tamanho do sample: um `/popular/` inteiro nao precisa
 * ir para o disco para revelar a forma.
 *
 * Modulo PURO. Nao escreve arquivo — quem escreve e o bin.
 */

/** Marcador que substitui qualquer segredo detectado. */
export const REDACTED = '[REDACTED]'

/** Nomes de campo tratados como credencial (case-insensitive, por substring). */
const SECRET_KEY_PATTERN = /(?:api[-_]?key|secret|token|authorization|password|cookie|x-rapidapi)/i

/** Opcoes de sanitizacao. */
export interface SanitizeOptions {
  /**
   * Valores de segredo conhecidos (ex.: a chave RapidAPI). Toda string que os
   * contenha e neutralizada. Valores vazios/curtos demais sao ignorados, para
   * nao transformar o sample inteiro em `[REDACTED]`.
   */
  readonly secrets?: readonly string[]
  /** Teto de itens preservados por array (default 5). */
  readonly maxArrayItems?: number
}

/** Comprimento minimo para um "segredo" ser usado em busca textual. */
const MIN_SECRET_LENGTH = 8

/** Escapa uma string para uso literal em RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Substitui, numa string, qualquer ocorrencia dos segredos conhecidos. */
export function redactSecrets(value: string, secrets: readonly string[]): string {
  let output = value
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue
    output = output.replace(new RegExp(escapeRegExp(secret), 'g'), REDACTED)
  }
  return output
}

/**
 * Devolve uma copia sanitizada do payload.
 *
 * Nao muta a entrada. Estruturas nao-serializaveis (funcao, symbol) viram
 * `undefined` e somem no `JSON.stringify` do bin.
 */
export function sanitizePayload(payload: unknown, options: SanitizeOptions = {}): unknown {
  const secrets = (options.secrets ?? []).filter((s) => s.length >= MIN_SECRET_LENGTH)
  const maxArrayItems = options.maxArrayItems ?? 5
  return walk(payload, secrets, maxArrayItems)
}

function walk(value: unknown, secrets: readonly string[], maxArrayItems: number): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value, secrets)
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, maxArrayItems).map((item) => walk(item, secrets, maxArrayItems))
    if (value.length > maxArrayItems) {
      kept.push(`…[+${value.length - maxArrayItems} itens omitidos no sample]`)
    }
    return kept
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(source)) {
      output[key] = SECRET_KEY_PATTERN.test(key)
        ? REDACTED
        : walk(source[key], secrets, maxArrayItems)
    }
    return output
  }
  return value
}
