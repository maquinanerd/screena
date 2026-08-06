/**
 * publish-preview.ts — "O que vai aparecer na pagina?", bloco a bloco. PURO.
 *
 * POR QUE ESTE PREVIEW, E NAO UMA IMITACAO DA PAGINA.
 *
 * A rota B (renderizar o rascunho no `apps/web`) foi recusada por custo: ela
 * atravessa a fronteira que `editorial-worker-boundary.test.ts` protege, poe o
 * site chamando servico externo em tempo de request, e exige token, endpoint e
 * expiracao em DOIS aplicativos. O motivo completo esta no log da F11.
 *
 * A rota A tem um limite honesto — nao e a pagina, e nao tem o CSS do site. Mas
 * responde a pergunta que este repositorio erra ha quatro vezes seguidas: o que
 * vai SUMIR. `entityCard` de pessoa, `video` interno, lista sem item, galeria
 * sem imagem: todos legais no CMS, todos invisiveis na materia publicada, e
 * nenhum deles avisa.
 *
 * A regra aqui espelha o renderizador publico. Quando os dois discordarem, o
 * teste de varredura da F13 e que vai gritar — este modulo e a base dele.
 */

/** O que acontece com um bloco quando a materia for publicada. */
export type BlockOutcome = 'renders' | 'vanishes' | 'degrades'

export interface BlockPreview {
  readonly index: number
  readonly type: string
  readonly outcome: BlockOutcome
  /** Frase em pt-BR. Vazia quando o bloco simplesmente aparece. */
  readonly note: string
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : []
}

/**
 * Os tipos de entidade que o site HIDRATA hoje.
 *
 * O contrato aceita sete; `news-pages.ts` resolve dois. Os outros cinco fazem o
 * cartao inteiro desaparecer, sem erro nenhum.
 */
const HYDRATED_ENTITY_KINDS = new Set(['movie', 'tv'])

/** Provedores de `video` que o site desenha. `internal` nao e um deles. */
const RENDERED_VIDEO_PROVIDERS = new Set(['youtube', 'vimeo'])

/**
 * Julga UM bloco do corpo do CMS.
 *
 * Nao valida contrato — isso ja e feito na publicacao. Responde a pergunta
 * anterior: "se eu publicar assim, isto aparece?"
 */
export function previewBlock(index: number, raw: unknown): BlockPreview {
  const block = (raw ?? {}) as Record<string, unknown>
  const type = String(block.blockType ?? block.type ?? '')
  const base = { index, type }

  switch (type) {
    case 'paragraph':
      return text(block.text) === ''
        ? { ...base, outcome: 'vanishes', note: 'Parágrafo vazio não aparece na página.' }
        : { ...base, outcome: 'renders', note: '' }

    case 'heading':
      return text(block.text) === ''
        ? { ...base, outcome: 'vanishes', note: 'Subtítulo sem texto não aparece.' }
        : { ...base, outcome: 'renders', note: '' }

    case 'image':
      return rows([block.media]).length === 0 && text(block.media) === ''
        ? { ...base, outcome: 'vanishes', note: 'Imagem sem arquivo escolhido não aparece.' }
        : { ...base, outcome: 'renders', note: '' }

    case 'entityCard': {
      const kind = text(block.entityKind)
      if (!HYDRATED_ENTITY_KINDS.has(kind)) {
        // Desde a F12 a NOTA sobrevive: some a ficha, nao o texto. Sem nota, ai
        // sim nao resta nada para desenhar.
        return text(block.note) === ''
          ? {
              ...base,
              outcome: 'vanishes',
              note: `O site só monta ficha para filme e série. Como "${kind}" e sem nota escrita, nada vai aparecer — escreva uma nota ou troque o tipo.`,
            }
          : {
              ...base,
              outcome: 'degrades',
              note: 'Só a sua nota vai aparecer; a ficha da entidade, não.',
            }
      }
      return text(block.entityId) === ''
        ? { ...base, outcome: 'vanishes', note: 'Cartão sem entidade escolhida não aparece.' }
        : { ...base, outcome: 'renders', note: '' }
    }

    case 'video': {
      const provider = text(block.provider)
      if (provider === 'internal') {
        // Desde a F12 vira LINK quando ha endereco. Sem endereco, some.
        return text(block.url) === ''
          ? { ...base, outcome: 'vanishes', note: 'Vídeo interno sem endereço não aparece.' }
          : { ...base, outcome: 'degrades', note: 'Aparece como link, não como player.' }
      }
      if (!RENDERED_VIDEO_PROVIDERS.has(provider)) {
        return { ...base, outcome: 'vanishes', note: 'Provedor desconhecido não aparece no site.' }
      }
      return {
        ...base,
        outcome: 'degrades',
        note: 'O site publica como link para o provedor, não como player.',
      }
    }

    case 'embed': {
      const provider = text(block.provider)
      if (provider === 'youtube') {
        return {
          ...base,
          outcome: 'renders',
          note: 'Player carrega depois que o leitor clica.',
        }
      }
      return {
        ...base,
        outcome: 'degrades',
        note: 'Aparece como cartão com link, não como publicação incorporada.',
      }
    }

    case 'list':
      return rows(block.items).filter((item) => text(item.text) !== '').length === 0
        ? { ...base, outcome: 'vanishes', note: 'Lista sem item preenchido não aparece.' }
        : { ...base, outcome: 'renders', note: '' }

    case 'gallery':
      return rows(block.items).length === 0
        ? { ...base, outcome: 'vanishes', note: 'Galeria sem imagem não aparece.' }
        : { ...base, outcome: 'renders', note: '' }

    case 'quote':
      return text(block.text) === ''
        ? { ...base, outcome: 'vanishes', note: 'Citação sem texto não aparece.' }
        : { ...base, outcome: 'renders', note: '' }

    case 'factBox':
      return rows(block.items).length === 0
        ? { ...base, outcome: 'vanishes', note: 'Quadro sem linha não aparece.' }
        : { ...base, outcome: 'renders', note: '' }

    case 'relatedContent':
    case 'sourceList':
      return { ...base, outcome: 'renders', note: '' }

    case 'divider':
      return { ...base, outcome: 'renders', note: '' }

    default:
      // Tipo que o site nao conhece e descartado no render. Dizer isso e melhor
      // que deixar o redator supor que apareceu.
      return {
        ...base,
        outcome: 'vanishes',
        note: `O site não conhece o bloco "${type}" e vai descartá-lo.`,
      }
  }
}

export interface BodyPreview {
  readonly blocks: readonly BlockPreview[]
  /** Quantos somem por completo. E o numero que a redacao precisa ver. */
  readonly vanishing: number
  /** Quantos aparecem, mas diferente do que o redator provavelmente espera. */
  readonly degrading: number
}

/** Julga o corpo inteiro. */
export function previewBody(body: unknown): BodyPreview {
  const blocks = rows(body).map((block, index) => previewBlock(index, block))
  return {
    blocks,
    vanishing: blocks.filter((block) => block.outcome === 'vanishes').length,
    degrading: blocks.filter((block) => block.outcome === 'degrades').length,
  }
}
