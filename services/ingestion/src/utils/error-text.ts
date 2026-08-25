/**
 * utils/error-text.ts — Como uma causa de erro vira TEXTO sem se perder.
 *
 * Existe por causa de um defeito medido em 25/08/2026: 7.076 jobs de
 * `sync_details` em `retry_wait` gravaram `last_error_safe` com a mensagem
 *
 *     "importMovie(614934) falhou (failed): "
 *
 * — prefixo do embrulho, dois-pontos, e NADA depois. O sistema sabia que tinha
 * falhado e nao sabia de que. A causa nao foi perdida em nenhum `catch`: ela foi
 * DECAPITADA na gravacao. O gate cortava a mensagem na primeira quebra de linha
 * (`message.split('\n')[0]`), e a mensagem do Prisma COMECA com `\n`:
 *
 *     "\nInvalid `prisma.movie.upsert()` invocation:\n\n\nForeign key ..."
 *
 * Concatenada ao prefixo, a primeira linha e o prefixo. Um erro Prisma CRU (sem
 * embrulho) era pior ainda: gravava string vazia.
 *
 * As tres regras deste modulo saem direto dai:
 *  1. achatar TODO espaco em branco em vez de cortar na primeira quebra;
 *  2. percorrer a cadeia de `cause` (um embrulho sem detalhe concatenado ainda
 *     assim entrega a causa);
 *  3. truncar pelas DUAS pontas, porque o Prisma poe o motivo no FIM.
 *
 * PURO: sem IO, sem relogio, sem rede.
 */

/** Teto do texto gravado no banco. Nunca despeja stack/payload inteiro. */
export const SAFE_TEXT_MAX = 200

/** Quanto da cabeca sobrevive quando o texto e truncado. */
const HEAD_BUDGET = 110

/** Marcador de corte, visivel para quem le a linha. */
const ELLIPSIS = ' ... '

/** Profundidade maxima da cadeia de `cause` percorrida. */
export const MAX_CAUSE_DEPTH = 4

/** Separador entre um erro e a causa dele, em uma linha so. */
const CAUSE_SEPARATOR = ' <- '

/**
 * Achata quebras de linha e espacos repetidos em um unico espaco.
 *
 * NAO e cosmetico: e o que impede que qualquer consumidor futuro "corte na
 * primeira linha" e jogue a causa fora de novo.
 */
export function flattenErrorText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Trunca preservando as DUAS pontas.
 *
 * A cabeca diz QUAL operacao falhou (`Invalid prisma.movie.upsert() invocation`)
 * e a cauda diz POR QUE (`Foreign key constraint violated on ...`). Truncar so
 * pela cabeca, como faz um `slice(0, n)`, descarta sistematicamente o motivo —
 * seria trocar a decapitacao por uma amputacao.
 */
export function clampSafeText(value: string, max: number = SAFE_TEXT_MAX): string {
  if (value.length <= max) return value
  const head = Math.min(HEAD_BUDGET, Math.max(0, max - ELLIPSIS.length))
  const tail = max - head - ELLIPSIS.length
  if (tail <= 0) return value.slice(0, max)
  return `${value.slice(0, head)}${ELLIPSIS}${value.slice(value.length - tail)}`
}

/**
 * Mensagem do erro + cadeia de `cause`, achatada em UMA linha.
 *
 * Erro sem mensagem entra pelo `name`: `""` nao identifica nada, `"AbortError"`
 * identifica. O `Set` corta ciclo de `cause` (um erro que aponta para si mesmo
 * travaria o laco).
 */
export function errorMessageWithCauses(error: Error, maxDepth: number = MAX_CAUSE_DEPTH): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (!(current instanceof Error) || seen.has(current)) break
    seen.add(current)
    const text = flattenErrorText(current.message)
    parts.push(text === '' ? current.name : text)
    current = current.cause
  }
  return parts.join(CAUSE_SEPARATOR)
}
