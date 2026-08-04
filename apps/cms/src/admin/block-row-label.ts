/**
 * block-row-label.ts — Rotulo de um bloco recolhido. PURO: sem React, sem rede.
 *
 * O painel mostrava "01 Paragraph Untitled" em todo bloco fechado. Numa materia
 * de 15 blocos isso e uma lista de quinze linhas identicas: para achar um
 * paragrafo e preciso abrir um por um. O rotulo passa a carregar um trecho do
 * proprio conteudo, e a materia recolhida vira sumario navegavel.
 *
 * Efeito colateral desejado: bloco vazio deixa de se esconder atras de
 * "Untitled" e passa a dizer que esta vazio, na propria lista.
 */

/** Quanto do conteudo cabe no rotulo antes de virar reticencias. */
export const ROW_LABEL_MAX = 60

/** Nome legivel de cada tipo, em portugues. */
const TYPE_LABELS: Record<string, string> = {
  divider: 'Separador',
  entityCard: 'Ficha de entidade',
  factBox: 'Box de fatos',
  heading: 'Subtítulo',
  image: 'Imagem',
  paragraph: 'Parágrafo',
  quote: 'Citação',
  relatedContent: 'Conteúdo relacionado',
  sourceList: 'Lista de fontes',
  video: 'Vídeo',
}

export interface BlockRowLabel {
  /** Tipo por extenso, em portugues. */
  readonly type: string
  /** Trecho do conteudo, ou `null` quando nao ha o que resumir. */
  readonly preview: string | null
  /** O bloco esta sem o conteudo que o torna util? */
  readonly empty: boolean
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Colapsa quebras e espacos: um rotulo de uma linha so. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clamp(value: string): string {
  const flat = oneLine(value)
  if (flat.length <= ROW_LABEL_MAX) return flat
  // Corta na PALAVRA para o rotulo nao terminar no meio de uma.
  const cut = flat.slice(0, ROW_LABEL_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > ROW_LABEL_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Primeiro texto util de um bloco, conforme o TIPO.
 *
 * Cada bloco tem um campo diferente que responde "o que e isto?". Imagem nao
 * tem texto proprio: o que identifica e o `alt` (que a materia ja exige) ou a
 * legenda. Tratar todos como se tivessem `text` deixaria metade dos tipos sem
 * rotulo — que e o defeito atual, so que mais discreto.
 */
function previewOf(blockType: string, block: Record<string, unknown>): string {
  switch (blockType) {
    case 'paragraph':
    case 'quote':
      return trimmed(block.text)
    case 'heading':
      return trimmed(block.text)
    case 'image':
      return trimmed(block.alt) || trimmed(block.caption)
    case 'video':
      return trimmed(block.title) || trimmed(block.externalId) || trimmed(block.url)
    case 'entityCard':
      return trimmed(block.entityId)
    case 'factBox':
      return trimmed(block.title)
    case 'relatedContent':
      return countLabel(block.articleRefs, 'matéria vinculada', 'matérias vinculadas')
    case 'sourceList':
      return countLabel(block.sourceRefs, 'fonte', 'fontes')
    default:
      return ''
  }
}

function countLabel(value: unknown, singular: string, plural: string): string {
  const total = Array.isArray(value) ? value.length : 0
  if (total === 0) return ''
  return `${String(total)} ${total === 1 ? singular : plural}`
}

/**
 * O separador nao tem conteudo — e vazio por natureza, nao por descuido.
 *
 * Sem esta distincao ele apareceria permanentemente marcado como pendencia, e o
 * aviso de "bloco vazio" perderia o sentido justamente por gritar sempre.
 */
const SELF_SUFFICIENT = new Set(['divider'])

export function buildBlockRowLabel(raw: unknown): BlockRowLabel {
  const block = raw === null || typeof raw !== 'object' ? {} : (raw as Record<string, unknown>)
  const blockType = typeof block.blockType === 'string' ? block.blockType : ''
  const type = TYPE_LABELS[blockType] ?? 'Bloco'

  if (SELF_SUFFICIENT.has(blockType)) return { type, preview: null, empty: false }

  const preview = previewOf(blockType, block)
  if (preview === '') return { type, preview: null, empty: true }
  return { type, preview: clamp(preview), empty: false }
}

/** O rotulo ja montado em UMA string, para quem so precisa exibir. */
export function formatBlockRowLabel(raw: unknown): string {
  const label = buildBlockRowLabel(raw)
  if (label.empty) return `${label.type} — vazio`
  return label.preview === null ? label.type : `${label.type} — ${label.preview}`
}
