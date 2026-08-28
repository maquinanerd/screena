/**
 * blocks.ts — Corpo editorial estruturado em BLOCOS discriminados. PURO.
 *
 * O corpo nunca e HTML livre. Cada bloco tem tipo, id estavel, teto de tamanho e
 * proveniencia opcional, e a uniao e discriminada por `type` — o que torna a
 * migracao futura por versao possivel sem adivinhar o formato de linhas antigas.
 */

import { z } from 'zod'

import {
  LIMITS,
  entityKind,
  httpUrl,
  optionalPlainText,
  plainText,
  provenanceRef,
  stableId,
} from './common.js'

/** Campos comuns a todo bloco. */
const blockBase = {
  /** Id estavel dentro do documento: permite ancorar comentario e correcao. */
  id: stableId,
  /** De onde veio o conteudo deste bloco especifico. */
  provenance: z.array(provenanceRef).max(10).optional(),
}

/**
 * Marcacao inline sobre o texto de um paragrafo.
 *
 * O corpo continua SEM HTML: o texto e string limpa e a formatacao viaja ao
 * lado, como intervalo (`start`/`end`) sobre esse texto. Quem renderiza
 * CONSTROI `<strong>`, `<em>` e `<a>` a partir daqui — nunca interpreta markup
 * vindo do dado. A recusa de markup em `common.ts` continua valendo intacta,
 * porque nada aqui e concatenado no texto.
 *
 * Offsets sao indices de string JavaScript (unidades UTF-16), a mesma unidade
 * que `String.prototype.slice` usa no render. Casar as duas unidades e o que
 * dispensa qualquer conversao — e converter era onde um emoji desalinhava a
 * marcacao inteira do paragrafo.
 */
export const TEXT_MARK_TYPES = ['bold', 'italic', 'link'] as const
export type TextMarkType = (typeof TEXT_MARK_TYPES)[number]

export const textMark = z.object({
  /** Inicio inclusivo, em unidades UTF-16. */
  start: z.int().min(0),
  /** Fim EXCLUSIVO, em unidades UTF-16. */
  end: z.int().min(1),
  type: z.enum(TEXT_MARK_TYPES),
  /** Obrigatorio em `link`, proibido nos demais. Somente http(s). */
  href: httpUrl.optional(),
})

export type TextMark = z.infer<typeof textMark>

/**
 * Paragrafo do corpo. `marks` e OPCIONAL e vale na ENTRADA desde a versao
 * 1.1.0 do contrato de publicacao.
 *
 * Ele ficava so na saida, e o motivo declarado era real: os contratos de
 * entrada sao comparados por hash com igualdade ESTRITA, entao acrescentar
 * campo faria todo pedido em voo virar `hash_mismatch`. O que mudou nao foi a
 * avaliacao do risco — foi o conserto dele. `checkContractCompatibility` passa
 * a aceitar tambem o par (versao, hash) ANTERIOR, declarado explicitamente em
 * `SUPERSEDED_CONTRACTS`, e com isso "campo opcional novo" volta a ser o que
 * `compatibility: 'additive'` sempre prometeu: aditivo de verdade.
 *
 * O que NAO mudou: o texto continua limpo e a marcacao continua sendo DADO. O
 * emissor descreve intervalos; o site constroi as tags. Nenhum HTML atravessa.
 */
export const paragraphBlock = z.object({
  ...blockBase,
  type: z.literal('paragraph'),
  text: plainText(LIMITS.blockText),
  marks: z.array(textMark).max(LIMITS.marks).optional(),
})

export const headingBlock = z.object({
  ...blockBase,
  type: z.literal('heading'),
  /** `h1` e do titulo da pagina; o corpo comeca em `h2`. */
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: plainText(LIMITS.shortText),
})

export const imageBlock = z.object({
  ...blockBase,
  type: z.literal('image'),
  /** Referencia a um item de midia CANDIDATA; aprovacao e humana. */
  mediaRef: stableId,
  alt: plainText(LIMITS.shortText),
  caption: optionalPlainText(LIMITS.shortText),
  credit: optionalPlainText(LIMITS.shortText),
})

export const videoBlock = z.object({
  ...blockBase,
  type: z.literal('video'),
  provider: z.enum(['youtube', 'vimeo', 'internal']),
  externalId: stableId.optional(),
  url: httpUrl.optional(),
  title: optionalPlainText(LIMITS.shortText),
  credit: optionalPlainText(LIMITS.shortText),
})

export const quoteBlock = z.object({
  ...blockBase,
  type: z.literal('quote'),
  text: plainText(LIMITS.blockText),
  attribution: optionalPlainText(LIMITS.shortText),
  /** Citacao de terceiro exige origem: sem ela, vira afirmacao sem lastro. */
  sourceRef: stableId.optional(),
})

export const entityCardBlock = z.object({
  ...blockBase,
  type: z.literal('entityCard'),
  entityKind,
  /** Id interno do Cinerie; o writer NAO cria entidade. */
  entityId: stableId,
  note: optionalPlainText(LIMITS.shortText),
})

export const factBoxBlock = z.object({
  ...blockBase,
  type: z.literal('factBox'),
  title: plainText(LIMITS.shortText),
  items: z
    .array(
      z.object({
        label: plainText(LIMITS.shortText),
        value: plainText(LIMITS.shortText),
      }),
    )
    .min(1)
    .max(30),
})

export const relatedContentBlock = z.object({
  ...blockBase,
  type: z.literal('relatedContent'),
  /** Artigos ja publicados no Cinerie, por id interno. */
  articleRefs: z.array(stableId).min(1).max(20),
})

export const sourceListBlock = z.object({
  ...blockBase,
  type: z.literal('sourceList'),
  /** Aponta para `externalSources` do draft, por id — nunca duplica a fonte. */
  sourceRefs: z.array(stableId).min(1).max(LIMITS.externalSources),
})

export const dividerBlock = z.object({
  ...blockBase,
  type: z.literal('divider'),
})

/** Uniao discriminada de todos os blocos suportados. */
export const editorialBlock = z.discriminatedUnion('type', [
  paragraphBlock,
  headingBlock,
  imageBlock,
  videoBlock,
  quoteBlock,
  entityCardBlock,
  factBoxBlock,
  relatedContentBlock,
  sourceListBlock,
  dividerBlock,
])

export type EditorialBlock = z.infer<typeof editorialBlock>

/** Nomes de tipo de bloco suportados (fonte unica para o CMS espelhar). */
export const EDITORIAL_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'image',
  'video',
  'quote',
  'entityCard',
  'factBox',
  'relatedContent',
  'sourceList',
  'divider',
] as const

export type EditorialBlockType = (typeof EDITORIAL_BLOCK_TYPES)[number]

/**
 * Corpo do artigo: lista de blocos com teto e ids UNICOS.
 *
 * Id repetido quebra ancoragem de comentario e de correcao, e faz duas versoes
 * do mesmo documento apontarem para o "mesmo" bloco sendo outro — por isso e
 * erro de contrato, nao aviso.
 */
export const editorialBody = z
  .array(editorialBlock)
  .min(1, 'corpo vazio')
  .max(LIMITS.blocks, `corpo acima do limite de ${LIMITS.blocks} blocos`)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>()
    for (const [index, block] of blocks.entries()) {
      if (seen.has(block.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `id de bloco duplicado: ${block.id}`,
        })
      }
      seen.add(block.id)
      if (block.type === 'paragraph') checkMarks(block, ctx, index)
    }
  })

/* ------------------------------------------------------------------ */
/* Formatacao inline                                                   */
/* ------------------------------------------------------------------ */

/**
 * O paragrafo PUBLICADO e o mesmo da entrada desde a 1.1.0.
 *
 * Este alias existia porque `marks` so valia na saida; ele fica para nao quebrar
 * quem o importa, e aponta para o mesmo schema.
 */
export const publishedParagraphBlock = paragraphBlock

/**
 * Lista com marcador ou numerada. SO NA SAIDA.
 *
 * O motivo NAO e mais o hash — `SUPERSEDED_CONTRACTS` resolveu isso e foi por
 * ele que `marks` entrou na entrada na 1.1.0. O que segura `list` aqui e
 * editorial: lista nasce na redacao humana, nao no pipeline. O dia em que o
 * MNScr precisar emitir lista, o caminho ja existe — nova versao aditiva, a
 * anterior declarada como superada.
 *
 * `items` guarda TEXTO LIMPO, um por item — sem markup, como o paragrafo. O
 * `ordered` decide `<ol>` ou `<ul>` no site; nao ha "estilo" livre.
 */
export const listBlock = z.object({
  ...blockBase,
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(plainText(LIMITS.shortText)).min(1, 'lista sem itens').max(30),
})

/**
 * Provedores de incorporacao aceitos. Allowlist FECHADA, nao validacao de URL.
 *
 * O redator cola uma URL; o CMS extrai o id e guarda DADO TIPADO. O site monta o
 * que for preciso a partir desse id. Em nenhum momento HTML ou script de
 * terceiro atravessa o editor — e a diferenca entre "incorporar um video" e
 * "executar o que colarem".
 */
export const EMBED_PROVIDERS = ['youtube', 'instagram', 'x'] as const
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number]

/**
 * Incorporacao por DADO, nunca por markup. SO NA SAIDA (regra do `marks`).
 *
 * `externalId` e o que o site usa para montar o player do YouTube. `canonicalUrl`
 * e a forma normalizada (sem rastreador, sem `si=`), e e o que vira link quando
 * o embed nao carrega. `originalUrl` fica para auditoria: e o que a pessoa
 * colou, e diverge da canonica com frequencia.
 *
 * NAO ha campo de HTML, e isso e deliberado: se existisse, o oEmbed do provedor
 * acabaria guardado nele e o site passaria a injetar markup de terceiro.
 */
export const embedBlock = z.object({
  ...blockBase,
  type: z.literal('embed'),
  provider: z.enum(EMBED_PROVIDERS),
  externalId: plainText(LIMITS.shortText),
  canonicalUrl: httpUrl,
  originalUrl: httpUrl,
  caption: optionalPlainText(LIMITS.shortText),
  /**
   * Metadados colhidos NA COLAGEM, dentro do painel — nunca no render publico.
   * Opcionais de proposito: se o provedor nao responder, o cartao degrada para
   * link em vez de a publicacao falhar.
   */
  authorName: optionalPlainText(LIMITS.shortText),
  excerpt: optionalPlainText(LIMITS.shortText),
})

/**
 * Galeria: varias imagens do acervo, em ordem, com direitos por imagem.
 *
 * `mediaRef` aponta para a midia ja aprovada — a galeria nao cria nem libera
 * nada. `alt`, `caption` e `credit` viajam por IMAGEM porque credito de foto e
 * por foto, e uma galeria com um credito so mente sobre as demais.
 */
export const galleryBlock = z.object({
  ...blockBase,
  type: z.literal('gallery'),
  items: z
    .array(
      z.object({
        mediaRef: stableId,
        alt: plainText(LIMITS.shortText),
        caption: optionalPlainText(LIMITS.shortText),
        credit: optionalPlainText(LIMITS.shortText),
      }),
    )
    .min(1, 'galeria sem imagem')
    .max(30),
  /** Indice da imagem de abertura. Fora da faixa, o site usa a primeira. */
  initialIndex: z.number().int().min(0).max(29).optional(),
})

export const publishedEditorialBlock = z.discriminatedUnion('type', [
  publishedParagraphBlock,
  listBlock,
  embedBlock,
  galleryBlock,
  headingBlock,
  imageBlock,
  videoBlock,
  quoteBlock,
  entityCardBlock,
  factBoxBlock,
  relatedContentBlock,
  sourceListBlock,
  dividerBlock,
])

/** `true` quando cortar em `index` partiria um par surrogado ao meio. */
function splitsSurrogatePair(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false
  const before = text.charCodeAt(index - 1)
  const at = text.charCodeAt(index)
  return before >= 0xd800 && before <= 0xdbff && at >= 0xdc00 && at <= 0xdfff
}

/**
 * Valida as marcacoes de UM paragrafo contra o texto dele.
 *
 * Vive no nivel do CORPO, e nao dentro do bloco, porque `z.discriminatedUnion`
 * exige objetos puros nos ramos: um `superRefine` no ramo o transformaria em
 * outro tipo de schema e a uniao deixaria de discriminar.
 */
function checkMarks(
  block: { readonly text: string; readonly marks?: readonly TextMark[] },
  ctx: z.RefinementCtx,
  blockIndex: number,
): void {
  const marks = block.marks
  if (marks === undefined) return
  const length = block.text.length

  const issue = (index: number, message: string): void => {
    ctx.addIssue({ code: 'custom', path: [blockIndex, 'marks', index], message })
  }

  marks.forEach((mark, index) => {
    if (mark.end <= mark.start) {
      issue(index, `marcacao vazia ou invertida: ${String(mark.start)}..${String(mark.end)}`)
    }
    if (mark.end > length) {
      issue(index, `marcacao fora do texto: fim ${String(mark.end)} > ${String(length)}`)
    }
    if (splitsSurrogatePair(block.text, mark.start) || splitsSurrogatePair(block.text, mark.end)) {
      issue(index, 'marcacao corta um caractere ao meio')
    }
    // `link` sem destino nao e link; `bold`/`italic` com destino e um link
    // disfarcado que o render nao mostraria — os dois sao erro, nao aviso.
    if (mark.type === 'link' && mark.href === undefined) {
      issue(index, 'link sem href')
    }
    if (mark.type !== 'link' && mark.href !== undefined) {
      issue(index, `href so e permitido em link, veio em ${mark.type}`)
    }
  })

  // Sobreposicao entre tipos DIFERENTES e legitima (negrito dentro de link).
  // Entre marcacoes do MESMO tipo nao e: sao duas formas de dizer a mesma coisa,
  // e o render teria de escolher uma sem criterio.
  for (const type of TEXT_MARK_TYPES) {
    const sameType = marks
      .map((mark, index) => ({ mark, index }))
      .filter((entry) => entry.mark.type === type)
      .sort((a, b) => a.mark.start - b.mark.start)
    for (let i = 1; i < sameType.length; i += 1) {
      const previous = sameType[i - 1]!
      const current = sameType[i]!
      if (current.mark.start < previous.mark.end) {
        issue(current.index, `marcacoes ${type} sobrepostas`)
      }
    }
  }
}

/**
 * Corpo do artigo PUBLICADO: identico ao de entrada, mais formatacao inline.
 *
 * Separado de `editorialBody` de proposito. Os contratos de ENTRADA
 * (`editorial-draft-v1`, `editorial-publication-request-v1`) sao comparados por
 * hash com igualdade estrita em `checkContractCompatibility`, e o MNScr declara
 * esse hash a cada pedido. Acrescentar campo la — mesmo opcional — faria todo
 * pedido em voo virar `hash_mismatch`. A formatacao nasce na redacao humana,
 * nao na automacao, entao ela so precisa existir na SAIDA.
 */
export const publishedEditorialBody = z
  .array(publishedEditorialBlock)
  .min(1, 'corpo vazio')
  .max(LIMITS.blocks, `corpo acima do limite de ${LIMITS.blocks} blocos`)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>()
    for (const [index, block] of blocks.entries()) {
      if (seen.has(block.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `id de bloco duplicado: ${block.id}`,
        })
      }
      seen.add(block.id)
      if (block.type === 'paragraph') checkMarks(block, ctx, index)
    }
  })

export type PublishedEditorialBody = z.infer<typeof publishedEditorialBody>
