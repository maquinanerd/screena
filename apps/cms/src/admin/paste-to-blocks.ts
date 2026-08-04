/**
 * paste-to-blocks.ts — Texto colado -> N paragrafos. PURO: sem React, sem DOM.
 *
 * Colar uma materia de fora caia inteira num bloco so: o campo nao tinha handler
 * de paste, e o comportamento padrao despeja tudo no `textarea`. O resultado
 * atravessava a validacao (o contrato nao proibe `\n` dentro de um paragrafo) e
 * furava o modelo por dentro — quatro paragrafos gravados como um.
 *
 * PROPOSITAL: nada aqui produz markup. O corpo da Cinerie e estruturado e o
 * contrato recusa qualquer tag (`editorial-contracts/src/common.ts:58`), entao a
 * limpeza de HTML colado do Word/Docs e uma EXTRACAO DE TEXTO com quebra por
 * paragrafo — negrito e link do documento de origem sao descartados junto com o
 * resto, porque nao ha onde guarda-los. Preserva-los exigiria mudar o contrato.
 *
 * Sem DOM de proposito: `DOMParser` nao existe no ambiente de teste deste
 * pacote (`vitest.config.ts` roda `environment: 'node'`), e um parser de HTML
 * completo seria peso desnecessario para o unico uso real — separar paragrafos.
 */

/** Teto de blocos que um unico paste pode criar. */
export const PASTE_MAX_BLOCKS = 50

/**
 * Tags que terminam um paragrafo.
 *
 * O que importa nao e reconstruir o documento, e saber ONDE cortar. `</p>`,
 * `<br><br>`, `</div>` e itens de lista sao os limites que a redacao percebe
 * como "novo paragrafo" ao colar do Word ou do Google Docs.
 */
const BLOCK_BOUNDARY = /<\/(?:p|div|h[1-6]|li|tr|blockquote)\s*>|<br\s*\/?>\s*<br\s*\/?>/gi

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
  const boundaried = stripDangerous(html).replace(BLOCK_BOUNDARY, '\n\n')
  // O que sobrou de markup vira espaco: `<b>ne</b>grito` nao pode virar "negrito"
  // colado errado nem "ne grito" — a tag inline some sem separar a palavra.
  const text = decodeEntities(boundaried.replace(/<[^>]*>/g, ''))
  return splitPastedText(text)
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
