'use client'

/**
 * ParagraphTextField — escrever paragrafo para de exigir contorcionismo.
 *
 * Tres friccoes medidas no painel, todas no mesmo campo, resolvidas juntas
 * porque compartilham o mesmo acesso a linha de bloco:
 *
 *  1. COLAR de fora caia tudo num bloco so (o campo nao tinha handler de paste).
 *     Agora um texto com quebras duplas vira N blocos, na ordem.
 *  2. ENTER inseria quebra de linha no mesmo `textarea`, e isso era aceito sem
 *     validacao — dava para enfiar quatro paragrafos num bloco so separados por
 *     `\n`, furando o modelo por dentro. Agora Enter no FIM cria o proximo
 *     bloco; Shift+Enter continua inserindo quebra, para quem precisa dela.
 *  3. BLOCO VAZIO nao avisava durante a escrita. O Payload so pinta erro depois
 *     do submit (`useField` calcula `showError = valid === false && submitted`),
 *     entao a recusa so aparecia na publicacao. O aviso aqui e do proprio
 *     componente e nao inventa validacao paralela: quem recusa continua sendo o
 *     `required` do campo e o gate do servidor.
 *
 * O que este componente NAO faz: formatacao. Nao ha negrito, italico nem link —
 * o corpo e estruturado e o contrato recusa qualquer markup
 * (`editorial-contracts/src/common.ts:58`). O paste extrai TEXTO do HTML colado.
 */

import { FieldLabel, TextareaInput, useField, useForm } from '@payloadcms/ui'
import type { TextareaFieldClientComponent } from 'payload'
import React, { useCallback, useMemo, useState } from 'react'

import { browserRandomHex, generateBlockId } from './block-id.js'
import { planPaste } from './paste-to-blocks.js'

/** `body.3.text` -> `{ parentPath: 'body', rowIndex: 3 }`. */
function locateRow(path: string): { parentPath: string; rowIndex: number } | null {
  const segments = path.split('.')
  if (segments.length < 3) return null
  const rowIndex = Number(segments[segments.length - 2])
  if (!Number.isInteger(rowIndex)) return null
  return { parentPath: segments.slice(0, -2).join('.'), rowIndex }
}

export const ParagraphTextField: TextareaFieldClientComponent = ({
  field,
  path,
  readOnly,
  schemaPath,
}) => {
  const { value, setValue } = useField<string>({ path })
  const { addFieldRow } = useForm()
  const [notice, setNotice] = useState<string | null>(null)

  const row = useMemo(() => locateRow(path), [path])
  // O schemaPath do CAMPO e `...body.paragraph.text`; a linha vive dois niveis
  // acima. `addFieldRow` nao consome este valor na implementacao atual, mas ele
  // e exigido pelo tipo — derivar em vez de inventar mantem os dois coerentes.
  const parentSchemaPath = useMemo(
    () => (schemaPath ?? '').split('.').slice(0, -2).join('.'),
    [schemaPath],
  )

  const empty = (value ?? '').trim() === ''

  /**
   * Cria blocos de paragrafo a partir de uma lista de textos.
   *
   * Cada linha nasce com `blockType` e `blockId` JA preenchidos. `blockType`
   * ausente e o defeito historico deste repositorio: o Payload nao reclama, nao
   * percorre a linha e grava o corpo vazio respondendo 201.
   */
  const appendParagraphs = useCallback(
    (texts: readonly string[], startIndex: number): void => {
      texts.forEach((text, offset) => {
        const id = generateBlockId(browserRandomHex)
        addFieldRow({
          blockType: 'paragraph',
          path: row?.parentPath ?? '',
          rowIndex: startIndex + offset,
          schemaPath: parentSchemaPath,
          subFieldState: {
            blockId: { initialValue: id, valid: true, value: id },
            text: { initialValue: text, valid: true, value: text },
          },
        })
      })
    },
    [addFieldRow, row, parentSchemaPath],
  )

  /*
   * Os dois handlers ficam no ENVOLTORIO, nao no `TextareaInput`.
   *
   * Nao e preferencia de estilo: `TextAreaInputProps` nao expoe `onPaste`, e tipa
   * `onKeyDown` como handler de `HTMLInputElement` — o elemento real e um
   * `textarea`. Como `paste` e `keydown` sobem na arvore, delegar do envoltorio
   * entrega os dois eventos com o tipo certo e sem tocar no input do Payload.
   */
  const onPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>): void => {
      if (readOnly === true || row === null) return
      if (!(event.target instanceof HTMLTextAreaElement)) return
      const plan = planPaste({
        html: event.clipboardData.getData('text/html'),
        text: event.clipboardData.getData('text/plain'),
      })
      // Um paragrafo so e o caso comum (colar uma frase): deixa o navegador
      // fazer o de sempre, preservando cursor e desfazer.
      if (plan.paragraphs.length <= 1) return

      event.preventDefault()
      const [first, ...rest] = plan.paragraphs
      // O primeiro entra NESTE bloco quando ele esta vazio; se ja havia texto,
      // ele nao e sobrescrito — vira mais um bloco depois deste.
      if (empty) {
        setValue(first)
        appendParagraphs(rest, row.rowIndex + 1)
      } else {
        appendParagraphs(plan.paragraphs, row.rowIndex + 1)
      }

      setNotice(
        plan.dropped === 0
          ? `Texto colado dividido em ${String(plan.paragraphs.length)} parágrafos.`
          : `Texto colado dividido em ${String(plan.paragraphs.length)} parágrafos. ${String(plan.dropped)} foram descartados pelo limite de um único colar.`,
      )
    },
    [readOnly, row, empty, setValue, appendParagraphs],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey || readOnly === true || row === null) return
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement)) return
      // So no FIM do texto. No meio, Enter continua sendo quebra de linha — quem
      // esta corrigindo o miolo de um paragrafo nao quer parti-lo em dois.
      if (target.selectionStart !== target.value.length) return
      if (target.selectionStart !== target.selectionEnd) return

      event.preventDefault()
      setNotice(null)
      appendParagraphs([''], row.rowIndex + 1)
    },
    [readOnly, row, appendParagraphs],
  )

  return (
    <div className="cinerie-paragraph field-type textarea" onKeyDown={onKeyDown} onPaste={onPaste}>
      <FieldLabel label={field?.label ?? 'Texto'} path={path} required={field?.required} />

      <TextareaInput
        onChange={(event) => {
          setNotice(null)
          setValue(event.target.value)
        }}
        path={path}
        readOnly={readOnly}
        value={value ?? ''}
      />

      {empty ? (
        <p className="cinerie-paragraph__empty" role="status">
          Parágrafo vazio — escreva o texto ou remova o bloco antes de publicar.
        </p>
      ) : null}

      {notice === null ? null : (
        <p className="cinerie-paragraph__notice" role="status">
          {notice}
        </p>
      )}

      <p className="cinerie-paragraph__hint">
        Enter cria o próximo parágrafo. Shift+Enter quebra a linha aqui dentro. Texto colado com
        linhas em branco vira um bloco por parágrafo.
      </p>
    </div>
  )
}

export default ParagraphTextField
