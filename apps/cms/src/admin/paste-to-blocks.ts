/**
 * paste-to-blocks.ts — Texto colado -> N paragrafos. PURO: sem React, sem DOM.
 *
 * Colar uma materia de fora caia inteira num bloco so: o campo nao tinha handler
 * de paste, e o comportamento padrao despeja tudo no `textarea`. O resultado
 * atravessava a validacao (o contrato nao proibe `\n` dentro de um paragrafo) e
 * furava o modelo por dentro — quatro paragrafos gravados como um.
 *
 * PROPOSITAL: nada aqui produz markup. O corpo da Cinerie e estruturado e o
 * contrato recusa qualquer tag (`editorial-contracts/src/common.ts:58`). O que
 * mudou: negrito, italico e link do documento de origem NAO sao mais
 * descartados — agora ha onde guarda-los (`marks`, no corpo publicado), entao a
 * extracao produz TRECHOS FORMATADOS em vez de texto cru. Continua nao havendo
 * tag nenhuma na saida: a formatacao vira intervalo, nao markup.
 *
 * Sem DOM de proposito: `DOMParser` nao existe no ambiente de teste deste
 * pacote (`vitest.config.ts` roda `environment: 'node'`), e um parser de HTML
 * completo seria peso desnecessario para o unico uso real — separar paragrafos
 * e reconhecer meia duzia de tags inline.
 */

import { isSafeHref, type InlineSpan } from '../inline-marks.js'

/** Teto de blocos que um unico paste pode criar. */
export const PASTE_MAX_BLOCKS = 50

/**
 * Tags que terminam um paragrafo.
 *
 * O que importa nao e reconstruir o documento, e saber ONDE cortar. `</p>`,
 * `</div>`, `<br><br>` e itens de lista sao os limites que a redacao percebe
 * como "novo paragrafo" ao colar do Word ou do Google Docs.
 */
const BLOCK_TAG = /^(?:p|div|h[1-6]|li|tr|blockquote)$/

/** Entidades que aparecem em texto colado de editor de texto. */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&nbsp;/gi, ' '],
  [/&amp;/gi, '&'],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  [/&mdash;/gi, '—'],
  [/&ndash;/gi, '–'],
  [/&hellip;/gi, '…'],
]

function decodeEntities(value: string): string {
  return ENTITIES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

/**
 * O conteudo de `<script>`/`<style>` some ANTES de qualquer outra coisa.
 *
 * Remover so as tags deixaria o CORPO delas (regras CSS, codigo JS) como texto
 * do paragrafo. O usuario veria um bloco cheio de lixo, e o contrato recusaria a
 * publicacao por conteudo proibido — depois do texto pronto.
 */
function stripDangerous(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
}

function normalizeWhitespace(value: string): string {
  // NBSP (U+00A0) entra como ESCAPE, nunca como byte cru: literal no fonte ele e
  // invisivel na revisao e o lint recusa (`no-irregular-whitespace`). Ele precisa
  // estar aqui porque Word e Docs colam NBSP no lugar de espaco.
  return value.replace(/[\t\r\u00a0]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

/** Divide HTML colado em paragrafos de TEXTO PURO. */
export function splitPastedHtml(html: string): string[] {
  return splitPastedHtmlRich(html).map((spans) => spans.map((span) => span.text).join(''))
}

/* ------------------------------------------------------------------ */
/* Extracao COM formatacao                                             */
/* ------------------------------------------------------------------ */

/** Estado de formatacao enquanto o scanner percorre o HTML. */
interface FormatState {
  bold: number
  italic: number
  href: string | null
}

/**
 * `style="..."` do Word e do Google Docs.
 *
 * O Docs nao cola `<b>`: cola `<span style="font-weight:700">`. Ignorar o
 * atributo `style` significaria perder o negrito exatamente na origem mais
 * comum de texto colado numa redacao.
 */
function styleFormatting(attrs: string): { bold: boolean; italic: boolean } {
  const style = /style\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs)?.[2] ?? ''
  const weight = /font-weight\s*:\s*([a-z0-9]+)/i.exec(style)?.[1] ?? ''
  const numeric = Number(weight)
  return {
    bold: weight === 'bold' || weight === 'bolder' || (Number.isFinite(numeric) && numeric >= 600),
    italic: /font-style\s*:\s*italic/i.test(style),
  }
}

function hrefOf(attrs: string): string | null {
  const raw = /href\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs)?.[2]
  if (raw === undefined) return null
  const value = decodeEntities(raw).trim()
  return isSafeHref(value) ? value : null
}

/**
 * Colapsa espaco entre trechos SEM apagar a fronteira de formatacao.
 *
 * Normalizar o paragrafo como uma string so seria mais simples, mas destruiria
 * os limites: e nesses limites que mora a diferenca entre "negrito na palavra
 * certa" e "negrito deslocado por um espaco".
 */
function normalizeSpans(spans: readonly InlineSpan[]): InlineSpan[] {
  const collapsed: InlineSpan[] = []
  let endsWithSpace = true // borda inicial: come espaco a esquerda do paragrafo

  for (const span of spans) {
    // NBSP como ESCAPE, nunca byte cru: literal no fonte ele e invisivel na
    // revisao e o lint recusa (`no-irregular-whitespace`). Word e Docs colam
    // NBSP no lugar de espaco, entao ele precisa estar aqui.
    let text = span.text.replace(/[\t\r\n\u00a0 ]+/g, ' ').replace(/ {2,}/g, ' ')
    if (endsWithSpace) text = text.replace(/^ +/, '')
    if (text === '') continue
    endsWithSpace = text.endsWith(' ')
    collapsed.push({ ...span, text })
  }

  const last = collapsed[collapsed.length - 1]
  if (last !== undefined) {
    const trimmed = last.text.replace(/ +$/, '')
    if (trimmed === '') collapsed.pop()
    else collapsed[collapsed.length - 1] = { ...last, text: trimmed }
  }
  return collapsed
}

/**
 * Divide HTML colado em paragrafos de TRECHOS FORMATADOS.
 *
 * Scanner de uma passada: acumula texto e, a cada tag, ajusta a formatacao
 * corrente. Tag desconhecida e ignorada sem separar palavra — `<b>ne</b>grito`
 * continua "negrito", com o "ne" em negrito.
 */
export function splitPastedHtmlRich(html: string): InlineSpan[][] {
  const source = stripDangerous(html)
  const state: FormatState = { bold: 0, italic: 0, href: null }
  // Pilha paralela: `<span style=...>` precisa saber, ao fechar, se ELE abriu o
  // negrito. Sem isso, fechar um span qualquer zeraria o negrito de um `<b>` que
  // ainda esta aberto por fora.
  const openTags: { name: string; bold: boolean; italic: boolean; link: boolean }[] = []

  const paragraphs: InlineSpan[][] = []
  let current: InlineSpan[] = []

  const pushText = (raw: string): void => {
    const text = decodeEntities(raw)
    if (text === '') return
    current.push({
      text,
      bold: state.bold > 0,
      italic: state.italic > 0,
      href: state.href,
    })
  }

  /**
   * Fecha o paragrafo corrente — e o subdivide por LINHA EM BRANCO.
   *
   * HTML colado nem sempre traz tag de bloco (o Docs as vezes entrega um bloco
   * so com quebras). Aplicar a mesma regra do texto puro aqui evita um caminho
   * de codigo separado que so alguem descobriria colando do lugar errado.
   */
  const breakParagraph = (): void => {
    let chunk: InlineSpan[] = []
    const flush = (): void => {
      const normalized = normalizeSpans(chunk)
      if (normalized.length > 0) paragraphs.push(normalized)
      chunk = []
    }
    for (const span of current) {
      const parts = span.text.split(/\n[^\S\n]*\n+/)
      parts.forEach((part, index) => {
        if (index > 0) flush()
        if (part !== '') chunk.push({ ...span, text: part })
      })
    }
    flush()
    current = []
  }

  const TAG = /<(\/?)([a-z][a-z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/gi
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = TAG.exec(source)) !== null) {
    pushText(source.slice(cursor, match.index))
    cursor = TAG.lastIndex

    const closing = match[1] === '/'
    const name = (match[2] ?? '').toLowerCase()
    const attrs = match[3] ?? ''

    if (BLOCK_TAG.test(name)) {
      if (closing) breakParagraph()
      continue
    }
    if (name === 'br') {
      // `<br><br>` separa paragrafo; um `<br>` sozinho e so espaco.
      if (/^\s*<br\s*\/?>/i.test(source.slice(cursor))) breakParagraph()
      else pushText(' ')
      continue
    }

    if (closing) {
      const index = openTags.map((tag) => tag.name).lastIndexOf(name)
      if (index === -1) continue
      const [tag] = openTags.splice(index, 1)
      if (tag === undefined) continue
      if (tag.bold) state.bold -= 1
      if (tag.italic) state.italic -= 1
      if (tag.link) state.href = null
      continue
    }

    // Tag que se fecha sozinha nao empilha; sem isso, `<img />` deixaria uma
    // entrada orfa que rouba o proximo fechamento de mesmo nome.
    if (attrs.trimEnd().endsWith('/')) continue

    const inlineBold = name === 'b' || name === 'strong'
    const inlineItalic = name === 'i' || name === 'em'
    const style = styleFormatting(attrs)
    const bold = inlineBold || style.bold
    const italic = inlineItalic || style.italic
    const href = name === 'a' ? hrefOf(attrs) : null

    if (bold) state.bold += 1
    if (italic) state.italic += 1
    // Link aninhado nao existe em HTML valido; o mais interno vence.
    if (href !== null) state.href = href

    openTags.push({ name, bold, italic, link: href !== null })
  }

  pushText(source.slice(cursor))
  breakParagraph()
  return paragraphs
}

/** Igual a `planPaste`, porem preservando negrito, italico e link. */
export function planRichPaste(input: {
  readonly html?: string
  readonly text?: string
}): { readonly paragraphs: readonly InlineSpan[][]; readonly dropped: number } {
  const fromHtml = typeof input.html === 'string' && input.html.trim() !== ''
  const paragraphs = fromHtml
    ? splitPastedHtmlRich(input.html ?? '')
    : splitPastedText(input.text ?? '').map((text) => [
        { text, bold: false, italic: false, href: null },
      ])

  if (paragraphs.length <= PASTE_MAX_BLOCKS) return { paragraphs, dropped: 0 }
  return {
    paragraphs: paragraphs.slice(0, PASTE_MAX_BLOCKS),
    dropped: paragraphs.length - PASTE_MAX_BLOCKS,
  }
}

/**
 * Divide texto puro em paragrafos.
 *
 * Linha em branco e o separador — nao a quebra simples. Texto colado de PDF ou
 * de e-mail costuma vir com quebra a cada linha da tela; tratar cada uma como
 * paragrafo produziria trinta blocos de meia frase.
 */
export function splitPastedText(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((paragraph) => normalizeWhitespace(paragraph.replace(/\n+/g, ' ')))
    .filter((paragraph) => paragraph !== '')
}

export interface PastePlan {
  /** Paragrafos prontos, na ordem. Vazio significa "nao ha o que colar". */
  readonly paragraphs: readonly string[]
  /** Quantos foram descartados pelo teto — nunca some em silencio. */
  readonly dropped: number
}

/**
 * Decide o que um paste vira.
 *
 * `html` tem precedencia sobre `text` porque so ele carrega o limite de
 * paragrafo de forma confiavel; o `text/plain` que o Word oferece junto costuma
 * vir com as quebras ja achatadas.
 */
export function planPaste(input: { readonly html?: string; readonly text?: string }): PastePlan {
  const fromHtml = typeof input.html === 'string' && input.html.trim() !== ''
  const paragraphs = fromHtml
    ? splitPastedHtml(input.html ?? '')
    : splitPastedText(input.text ?? '')

  if (paragraphs.length <= PASTE_MAX_BLOCKS) return { paragraphs, dropped: 0 }
  return {
    paragraphs: paragraphs.slice(0, PASTE_MAX_BLOCKS),
    dropped: paragraphs.length - PASTE_MAX_BLOCKS,
  }
}
