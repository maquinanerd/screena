/**
 * inline-marks.ts — Conversao PURA entre trechos formatados e `{ text, marks }`.
 *
 * O editor pensa em TRECHOS ("este pedaco esta em negrito"); o contrato pensa em
 * INTERVALOS sobre um texto limpo ("de 4 a 9 e negrito"). Este modulo e a unica
 * traducao entre os dois, e e puro de proposito: a parte dificil da formatacao
 * inline e aritmetica de offset, e aritmetica de offset se testa sem navegador.
 *
 * O texto que sai daqui NUNCA contem markup. A formatacao viaja ao lado, e o
 * render CONSTROI os elementos — e por isso que a recusa de HTML do contrato
 * (`editorial-contracts/src/common.ts:58`) continua valendo sem excecao.
 */

import type { TextMark, TextMarkType } from '@screena/editorial-contracts'

/** Um pedaco contiguo de texto com formatacao uniforme. */
export interface InlineSpan {
  readonly text: string
  readonly bold: boolean
  readonly italic: boolean
  /** Destino do link, ou `null` quando o trecho nao e link. */
  readonly href: string | null
}

export interface InlineContent {
  readonly text: string
  readonly marks: TextMark[]
}

/** Somente http(s). Espelha `httpUrl` do contrato, para recusar ANTES de salvar. */
export function isSafeHref(value: unknown): value is string {
  if (typeof value !== 'string' || value === '') return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

/**
 * Trechos -> `{ text, marks }`.
 *
 * Trechos vizinhos com a MESMA formatacao viram uma marcacao so. Sem essa fusao,
 * digitar uma palavra em negrito produziria uma marcacao por tecla — e o
 * contrato recusaria o paragrafo por marcacoes do mesmo tipo sobrepostas.
 */
export function spansToInlineContent(spans: readonly InlineSpan[]): InlineContent {
  let text = ''
  const open = new Map<TextMarkType, { start: number; end: number; href?: string }>()
  const closed: TextMark[] = []

  const flush = (type: TextMarkType): void => {
    const run = open.get(type)
    if (run === undefined) return
    closed.push({
      start: run.start,
      end: run.end,
      type,
      ...(run.href === undefined ? {} : { href: run.href }),
    })
    open.delete(type)
  }

  for (const span of spans) {
    if (span.text === '') continue
    const start = text.length
    text += span.text
    const end = text.length

    const active: { type: TextMarkType; href?: string }[] = []
    if (span.bold) active.push({ type: 'bold' })
    if (span.italic) active.push({ type: 'italic' })
    if (isSafeHref(span.href)) active.push({ type: 'link', href: span.href })

    const activeTypes = new Set(active.map((entry) => entry.type))
    for (const type of open.keys()) {
      if (!activeTypes.has(type)) flush(type)
    }

    for (const entry of active) {
      const run = open.get(entry.type)
      // Continua a marcacao aberta so quando ela encosta EXATAMENTE aqui e o
      // destino e o mesmo: dois links diferentes colados sao dois links.
      if (run !== undefined && run.end === start && run.href === entry.href) {
        run.end = end
      } else {
        flush(entry.type)
        open.set(entry.type, {
          start,
          end,
          ...(entry.href === undefined ? {} : { href: entry.href }),
        })
      }
    }
  }

  for (const type of [...open.keys()]) flush(type)

  closed.sort((a, b) => a.start - b.start || a.end - b.end || a.type.localeCompare(b.type))
  return { text, marks: closed }
}

/**
 * Marcacoes cruas -> marcacoes CONFIAVEIS, ou `null` quando o conjunto e
 * inutilizavel.
 *
 * FAIL-CLOSED por paragrafo: uma marcacao invalida degrada o paragrafo INTEIRO
 * para texto puro, em vez de descartar so a ruim. Descartar a ruim silenciosa
 * deslocaria as vizinhas em relacao ao que o revisor viu, e formatacao
 * parcialmente aplicada e mais dificil de perceber que formatacao ausente.
 */
export function sanitizeMarks(text: string, raw: unknown): TextMark[] | null {
  if (raw === null || raw === undefined) return []
  if (!Array.isArray(raw)) return null

  const marks: TextMark[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') return null
    const entry = item as Record<string, unknown>
    const { start, end, type, href } = entry

    if (typeof start !== 'number' || !Number.isInteger(start)) return null
    if (typeof end !== 'number' || !Number.isInteger(end)) return null
    if (type !== 'bold' && type !== 'italic' && type !== 'link') return null
    if (start < 0 || end > text.length || end <= start) return null
    if (splitsSurrogatePair(text, start) || splitsSurrogatePair(text, end)) return null

    if (type === 'link') {
      if (!isSafeHref(href)) return null
      marks.push({ start, end, type, href })
    } else {
      if (href !== undefined && href !== null) return null
      marks.push({ start, end, type })
    }
  }

  marks.sort((a, b) => a.start - b.start || a.end - b.end || a.type.localeCompare(b.type))

  // Mesmo tipo sobreposto e recusado pelo contrato: pegar aqui evita salvar um
  // paragrafo que so falharia na publicacao, longe de quem o escreveu.
  for (const type of ['bold', 'italic', 'link'] as const) {
    const sameType = marks.filter((mark) => mark.type === type)
    for (let i = 1; i < sameType.length; i += 1) {
      if (sameType[i]!.start < sameType[i - 1]!.end) return null
    }
  }

  return marks
}

/** `true` quando cortar em `index` partiria um par surrogado ao meio. */
export function splitsSurrogatePair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false
  const before = text.charCodeAt(index - 1)
  const at = text.charCodeAt(index)
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff
}

/**
 * `{ text, marks }` -> trechos, para remontar o editor.
 *
 * Corta o texto em toda fronteira de marcacao e resolve cada pedaco pelo que o
 * cobre. Percorrer fronteiras (em vez de tratar as marcacoes uma a uma) e o que
 * faz sobreposicao entre tipos diferentes — negrito dentro de link — sair certa
 * sem nenhum caso especial.
 */
export function inlineContentToSpans(text: string, rawMarks: unknown): InlineSpan[] {
  const marks = sanitizeMarks(text, rawMarks)
  if (text === '') return []
  if (marks === null || marks.length === 0) {
    return [{ text, bold: false, italic: false, href: null }]
  }

  const boundaries = new Set<number>([0, text.length])
  for (const mark of marks) {
    boundaries.add(mark.start)
    boundaries.add(mark.end)
  }
  const ordered = [...boundaries].sort((a, b) => a - b)

  const spans: InlineSpan[] = []
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const start = ordered[i]!
    const end = ordered[i + 1]!
    if (end <= start) continue
    const covering = marks.filter((mark) => mark.start <= start && mark.end >= end)
    const link = covering.find((mark) => mark.type === 'link')
    spans.push({
      text: text.slice(start, end),
      bold: covering.some((mark) => mark.type === 'bold'),
      italic: covering.some((mark) => mark.type === 'italic'),
      href: link?.href ?? null,
    })
  }
  return spans
}
