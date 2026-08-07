'use client'

/**
 * ParagraphTextField — escrever paragrafo com NEGRITO, ITALICO e LINK.
 *
 * O editor e o Lexical, importado atraves de `@payloadcms/richtext-lexical`.
 * Nao e capricho de import: o Lexical ja e dependencia do Payload, e puxa-lo
 * pelo proxy do proprio Payload (`/lexical/...`) garante UMA versao — declarar
 * `lexical` direto no `package.json` abriria a porta para duas copias do pacote
 * no mesmo bundle, que e como se ganha um editor que perde o estado.
 *
 * O QUE ESTE CAMPO GRAVA. Dois campos irmaos, nao um:
 *   `text`  — string LIMPA, sem nenhuma tag. Continua sendo o que sempre foi.
 *   `marks` — intervalos `{ start, end, type }` sobre esse texto.
 * A formatacao nunca vira markup dentro do texto. E o que mantem de pe a recusa
 * de HTML do contrato (`editorial-contracts/src/common.ts:58`) enquanto o
 * jornalista escreve como escreveria no WordPress.
 *
 * O QUE CONTINUA DA ETAPA ANTERIOR: colar quebrando em N blocos (agora
 * PRESERVANDO formatacao), Enter no fim criando o proximo bloco, e o aviso de
 * paragrafo vazio durante a escrita.
 *
 * Ctrl+B / Ctrl+I sao do proprio Lexical (`registerRichText` trata os
 * `beforeinput` `formatBold`/`formatItalic`). Ctrl+K e registrado aqui.
 */

import { $isLinkNode, $toggleLink, LinkNode } from '@payloadcms/richtext-lexical/lexical/link'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type LexicalNode,
} from '@payloadcms/richtext-lexical/lexical'
import { LexicalComposer } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@payloadcms/richtext-lexical/lexical/react/LexicalComposerContext'
import { ContentEditable } from '@payloadcms/richtext-lexical/lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@payloadcms/richtext-lexical/lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalHistoryPlugin'
import { LinkPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalLinkPlugin'
import { RichTextPlugin } from '@payloadcms/richtext-lexical/lexical/react/LexicalRichTextPlugin'
import { mergeRegister } from '@payloadcms/richtext-lexical/lexical/utils'
import { FieldLabel, useField, useForm } from '@payloadcms/ui'
import type { TextMark } from '@screena/editorial-contracts'
import type { TextareaFieldClientComponent } from 'payload'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { browserRandomHex, generateBlockId } from './block-id.js'
import {
  inlineContentToSpans,
  isSafeHref,
  spansToInlineContent,
  type InlineSpan,
} from '../inline-marks.js'
import { droppedImagesMessage, planRichPaste } from './paste-to-blocks.js'

/** `body.3.text` -> `{ parentPath: 'body', rowIndex: 3, marksPath: 'body.3.marks' }`. */
function locateRow(
  path: string,
): { parentPath: string; rowIndex: number; marksPath: string } | null {
  const segments = path.split('.')
  if (segments.length < 3) return null
  const rowIndex = Number(segments[segments.length - 2])
  if (!Number.isInteger(rowIndex)) return null
  return {
    parentPath: segments.slice(0, -2).join('.'),
    rowIndex,
    marksPath: [...segments.slice(0, -1), 'marks'].join('.'),
  }
}

/* ------------------------------------------------------------------ */
/* Lexical <-> trechos                                                 */
/* ------------------------------------------------------------------ */

/** Le o editor inteiro como uma lista plana de trechos. */
function readSpans(): InlineSpan[] {
  const spans: InlineSpan[] = []

  const walk = (node: LexicalNode, href: string | null): void => {
    if ($isTextNode(node)) {
      spans.push({
        text: node.getTextContent(),
        bold: node.hasFormat('bold'),
        italic: node.hasFormat('italic'),
        href,
      })
      return
    }
    if ($isLineBreakNode(node)) {
      spans.push({ text: '\n', bold: false, italic: false, href: null })
      return
    }
    if (!$isElementNode(node)) return
    // Somente `LinkNode` carrega destino; qualquer outro elemento so encaminha o
    // que ja vinha de fora, para negrito DENTRO de link continuar dentro dele.
    const nested = $isLinkNode(node) ? node.getURL() : href
    const resolved = isSafeHref(nested) ? nested : href
    for (const child of node.getChildren()) walk(child, resolved)
  }

  for (const child of $getRoot().getChildren()) walk(child, null)
  return spans
}

/** Monta o estado inicial do editor a partir de `text` + `marks`. */
function seedEditor(text: string, marks: unknown): void {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()

  for (const span of inlineContentToSpans(text, marks)) {
    // A quebra de linha volta como TEXTO: um `\n` dentro do paragrafo e um
    // caractere do conteudo, e nao um no estrutural — trata-lo diferente aqui
    // deslocaria todos os offsets em relacao ao que foi gravado.
    const node = $createTextNode(span.text)
    if (span.bold) node.toggleFormat('bold')
    if (span.italic) node.toggleFormat('italic')
    paragraph.append(node)
  }

  root.append(paragraph)
}

/* ------------------------------------------------------------------ */
/* Comportamento de teclado e de colagem                               */
/* ------------------------------------------------------------------ */

interface BehaviorProps {
  readonly onEnterAtEnd: () => void
  readonly onPasteParagraphs: (
    paragraphs: readonly InlineSpan[][],
    droppedImages: number,
  ) => boolean
  readonly onLinkRequest: () => void
}

function BehaviorPlugin({ onEnterAtEnd, onPasteParagraphs, onLinkRequest }: BehaviorProps): null {
  const [editor] = useLexicalComposerContext()

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            // Shift+Enter continua sendo quebra de linha, como no editor antigo.
            if (event?.shiftKey === true) return false
            const selection = $getSelection()
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false

            const last = $getRoot().getLastDescendant()
            const atEnd =
              last !== null &&
              selection.anchor.key === last.getKey() &&
              selection.anchor.offset === last.getTextContentSize()

            event?.preventDefault()
            // No MEIO do paragrafo, Enter nao parte o bloco: insere quebra. Quem
            // esta corrigindo o miolo de um texto nao quer dois blocos.
            if (!atEnd) {
              editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false)
              return true
            }
            onEnterAtEnd()
            return true
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            if (!(event instanceof ClipboardEvent) || event.clipboardData === null) return false
            const plan = planRichPaste({
              html: event.clipboardData.getData('text/html'),
              text: event.clipboardData.getData('text/plain'),
            })
            if (plan.paragraphs.length === 0) return false
            if (!onPasteParagraphs(plan.paragraphs, plan.droppedImages)) return false
            event.preventDefault()
            return true
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerRootListener((rootElement, previous) => {
          const onKeyDown = (event: KeyboardEvent): void => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
              event.preventDefault()
              onLinkRequest()
            }
          }
          previous?.removeEventListener('keydown', onKeyDown as EventListener)
          rootElement?.addEventListener('keydown', onKeyDown as EventListener)
        }),
      ),
    [editor, onEnterAtEnd, onPasteParagraphs, onLinkRequest],
  )

  return null
}

/* ------------------------------------------------------------------ */
/* Barra de formatacao                                                 */
/* ------------------------------------------------------------------ */

function Toolbar({ onLink }: { readonly onLink: () => void }): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const format = useCallback(
    (kind: 'bold' | 'italic') => (event: React.MouseEvent) => {
      // O botao nao pode roubar o cursor: sem isto a selecao some no mousedown e
      // o comando aplicaria formatacao a nada.
      event.preventDefault()
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, kind)
    },
    [editor],
  )

  return (
    <div className="cinerie-paragraph__toolbar">
      <button
        aria-label="Negrito (Ctrl+B)"
        className="cinerie-paragraph__tool"
        onMouseDown={format('bold')}
        title="Negrito (Ctrl+B)"
        type="button"
      >
        <strong>N</strong>
      </button>
      <button
        aria-label="Itálico (Ctrl+I)"
        className="cinerie-paragraph__tool"
        onMouseDown={format('italic')}
        title="Itálico (Ctrl+I)"
        type="button"
      >
        <em>I</em>
      </button>
      <button
        aria-label="Link (Ctrl+K)"
        className="cinerie-paragraph__tool"
        onMouseDown={(event) => {
          event.preventDefault()
          onLink()
        }}
        title="Link (Ctrl+K)"
        type="button"
      >
        Link
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Ponte com o formulario do Payload                                   */
/* ------------------------------------------------------------------ */

/**
 * Propaga o conteudo do editor para o formulario.
 *
 * Nao usa `OnChangePlugin` de proposito: ele dispara tambem em mudanca de
 * SELECAO, e cada `setValue` do Payload despacha UPDATE e marca o formulario
 * como sujo mesmo quando o valor e igual. Mover o cursor marcaria a materia como
 * alterada — e foi assim que a digitacao derrubou o admin no campo de slug.
 */
function ChangeBridge({
  setContent,
  readOnly,
}: {
  readonly setContent: (text: string, marks: TextMark[]) => void
  readonly readOnly: boolean
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (readOnly) return undefined
    return editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return
      editorState.read(() => {
        const { text, marks } = spansToInlineContent(readSpans())
        setContent(text, marks)
      })
    })
  }, [editor, setContent, readOnly])

  return null
}

interface BridgeProps {
  readonly setContent: (text: string, marks: TextMark[]) => void
  readonly requestLink: React.MutableRefObject<(() => void) | null>
  readonly appendSpans: (paragraphs: readonly InlineSpan[][], droppedImages: number) => boolean
  readonly onEnterAtEnd: () => void
  readonly readOnly: boolean
}

function Bridge({
  setContent,
  requestLink,
  appendSpans,
  onEnterAtEnd,
  readOnly,
}: BridgeProps): React.JSX.Element {
  const [editor] = useLexicalComposerContext()

  const onLinkRequest = useCallback(() => {
    let current: string | null = null
    let collapsed = true

    editor.getEditorState().read(() => {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return
      collapsed = selection.isCollapsed()
      for (const node of selection.getNodes()) {
        if ($isLinkNode(node)) current = node.getURL()
        const parent = node.getParent()
        if ($isLinkNode(parent)) current = parent.getURL()
      }
    })

    if (collapsed) {
      window.alert('Selecione o texto que deve virar link.')
      return
    }

    const answer = window.prompt('Endereço do link (http:// ou https://)', current ?? 'https://')
    if (answer === null) return
    const trimmed = answer.trim()
    // Campo vazio remove o link — e o unico jeito de desfaze-lo sem apagar o
    // texto. Endereco invalido recusa, em vez de gravar um link quebrado.
    if (trimmed === '') {
      editor.update(() => {
        $toggleLink(null)
      })
      return
    }
    if (!isSafeHref(trimmed)) {
      window.alert('O link precisa começar com http:// ou https://')
      return
    }
    editor.update(() => {
      $toggleLink(trimmed)
    })
  }, [editor])

  useEffect(() => {
    requestLink.current = onLinkRequest
    return () => {
      requestLink.current = null
    }
  }, [requestLink, onLinkRequest])

  const onPasteParagraphs = useCallback(
    (paragraphs: readonly InlineSpan[][], droppedImages: number): boolean => {
      const [first, ...rest] = paragraphs
      if (first === undefined) return false

      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        selection.insertNodes(
          first.map((span) => {
            const node = $createTextNode(span.text)
            if (span.bold) node.toggleFormat('bold')
            if (span.italic) node.toggleFormat('italic')
            return node
          }),
        )
        // O link do primeiro paragrafo e aplicado DEPOIS da insercao:
        // `$toggleLink` trabalha sobre a selecao, e so agora ela cobre o texto
        // novo. Vale so quando o paragrafo inteiro e um link — link parcial em
        // texto colado exigiria refazer a selecao trecho a trecho.
        const href = first.find((span) => span.href !== null)?.href
        if (first.length > 0 && first.every((span) => span.href !== null) && isSafeHref(href)) {
          $toggleLink(href)
        }
      })

      // Sempre chamado, mesmo sem paragrafo extra: a perda de imagem precisa ser
      // dita tambem quando o que colou coube num paragrafo so.
      appendSpans(rest, droppedImages)
      return true
    },
    [editor, appendSpans],
  )

  return (
    <>
      <BehaviorPlugin
        onEnterAtEnd={onEnterAtEnd}
        onLinkRequest={onLinkRequest}
        onPasteParagraphs={onPasteParagraphs}
      />
      <ChangeBridge readOnly={readOnly} setContent={setContent} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Campo                                                               */
/* ------------------------------------------------------------------ */

export const ParagraphTextField: TextareaFieldClientComponent = ({
  field,
  path,
  readOnly,
  schemaPath,
}) => {
  const { value, setValue } = useField<string>({ path })
  const row = useMemo(() => locateRow(path), [path])
  const marksPath = row?.marksPath ?? `${path}__marks`
  const { setValue: setMarks, value: marksValue } = useField<unknown>({ path: marksPath })
  const { addFieldRow } = useForm()

  const [notice, setNotice] = useState<string | null>(null)
  /**
   * Imagens que a ultima colagem deixou para tras.
   *
   * Estado SEPARADO do `notice`, e nao a mesma frase concatenada, porque os dois
   * dizem coisas de peso diferente: um informa o que o editor fez com o texto, o
   * outro cobra uma acao de quem escreve. Juntar os dois numa linha so faria o
   * segundo herdar o tom neutro do primeiro.
   */
  const [lostImages, setLostImages] = useState(0)
  const requestLink = useRef<(() => void) | null>(null)

  // O schemaPath do CAMPO e `...body.paragraph.text`; a linha vive dois niveis
  // acima. `addFieldRow` nao consome este valor na implementacao atual, mas ele
  // e exigido pelo tipo — derivar em vez de inventar mantem os dois coerentes.
  const parentSchemaPath = useMemo(
    () => (schemaPath ?? '').split('.').slice(0, -2).join('.'),
    [schemaPath],
  )

  /*
   * O estado inicial e lido UMA vez.
   *
   * `LexicalComposer` so consulta `initialConfig` na montagem. Congelar aqui e
   * proposital: reagir ao `value` do formulario remontaria o editor a cada
   * tecla, porque cada tecla escreve nesse mesmo `value`.
   */
  const seed = useRef<{ text: string; marks: unknown } | null>(null)
  if (seed.current === null) seed.current = { text: value ?? '', marks: marksValue }

  /**
   * Escreve no formulario SO quando algo mudou de verdade.
   *
   * `setValue` do Payload nao e no-op para valor igual: ele despacha UPDATE e
   * chama `setModified` sempre. Sem esta guarda, cada tecla marcaria o documento
   * como alterado repetidamente e o autosave entraria em laco.
   */
  const lastWritten = useRef<string | null>(null)
  const setContent = useCallback(
    (text: string, marks: TextMark[]): void => {
      const serialized = JSON.stringify({ text, marks })
      if (lastWritten.current === serialized) return
      lastWritten.current = serialized
      setNotice(null)
      setLostImages(0)
      setValue(text)
      setMarks(marks.length === 0 ? null : marks)
    },
    [setValue, setMarks],
  )

  const appendParagraphs = useCallback(
    (paragraphs: readonly InlineSpan[][], startIndex: number): void => {
      paragraphs.forEach((spans, offset) => {
        const id = generateBlockId(browserRandomHex)
        const { text, marks } = spansToInlineContent(spans)
        const storedMarks = marks.length === 0 ? null : marks
        addFieldRow({
          blockType: 'paragraph',
          path: row?.parentPath ?? '',
          rowIndex: startIndex + offset,
          schemaPath: parentSchemaPath,
          subFieldState: {
            blockId: { initialValue: id, valid: true, value: id },
            text: { initialValue: text, valid: true, value: text },
            marks: { initialValue: storedMarks, valid: true, value: storedMarks },
          },
        })
      })
    },
    [addFieldRow, row, parentSchemaPath],
  )

  const onEnterAtEnd = useCallback(() => {
    if (row === null) return
    setNotice(null)
    setLostImages(0)
    appendParagraphs([[]], row.rowIndex + 1)
  }, [appendParagraphs, row])

  const appendSpans = useCallback(
    (paragraphs: readonly InlineSpan[][], droppedImages: number): boolean => {
      if (row === null) return false
      // Lista vazia e um caso legitimo: a colagem coube neste mesmo paragrafo.
      // Nao ha o que anexar, mas ha o que RELATAR sobre a imagem perdida.
      if (paragraphs.length > 0) {
        appendParagraphs(paragraphs, row.rowIndex + 1)
        setNotice(`Texto colado dividido em ${String(paragraphs.length + 1)} parágrafos.`)
      }
      setLostImages(droppedImages)
      return true
    },
    [appendParagraphs, row],
  )

  const empty = (value ?? '').trim() === ''
  const disabled = readOnly === true

  const initialConfig = useMemo(
    () => ({
      namespace: 'cinerie-paragraph',
      // SO `LinkNode`. Sem heading, sem lista, sem imagem: o corpo e estruturado
      // em BLOCOS, e um heading digitado dentro do paragrafo seria um heading que
      // o contrato nao ve e o site nao renderiza.
      nodes: [LinkNode],
      editable: !disabled,
      editorState: () => {
        seedEditor(seed.current?.text ?? '', seed.current?.marks)
      },
      theme: {
        link: 'cinerie-paragraph__link',
        text: {
          bold: 'cinerie-paragraph__bold',
          italic: 'cinerie-paragraph__italic',
        },
      },
      onError: (error: Error) => {
        // Nunca derruba o painel: um editor que quebra a tela inteira e pior que
        // um paragrafo que perdeu a formatacao.
        console.error('[cinerie] editor de paragrafo:', error)
      },
    }),
    [disabled],
  )

  return (
    <div className="cinerie-paragraph field-type textarea">
      <FieldLabel label={field?.label ?? 'Texto'} path={path} required={field?.required} />

      <LexicalComposer initialConfig={initialConfig}>
        {disabled ? null : (
          <Toolbar
            onLink={() => {
              requestLink.current?.()
            }}
          />
        )}
        <RichTextPlugin
          ErrorBoundary={LexicalErrorBoundary}
          contentEditable={
            <ContentEditable
              aria-label={typeof field?.label === 'string' ? field.label : 'Texto do parágrafo'}
              className="cinerie-paragraph__input"
            />
          }
        />
        <HistoryPlugin />
        <LinkPlugin />
        <Bridge
          appendSpans={appendSpans}
          onEnterAtEnd={onEnterAtEnd}
          readOnly={disabled}
          requestLink={requestLink}
          setContent={setContent}
        />
      </LexicalComposer>

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

      {/* Perda de conteudo pede `alert`, e nao `status`: o leitor de tela
          interrompe, porque ha uma acao pendente do outro lado da frase. */}
      {lostImages > 0 ? (
        <p className="cinerie-paragraph__media-notice" role="alert">
          {droppedImagesMessage(lostImages)}
        </p>
      ) : null}

      <p className="cinerie-paragraph__hint">
        Ctrl+B negrito, Ctrl+I itálico, Ctrl+K link. Enter cria o próximo parágrafo. Shift+Enter
        quebra a linha aqui dentro. Texto colado vira um bloco por parágrafo, com a formatação
        preservada — imagens não vêm junto, use o bloco de imagem.
      </p>
    </div>
  )
}

export default ParagraphTextField
