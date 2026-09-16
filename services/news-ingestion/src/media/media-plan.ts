/**
 * media-plan.ts — Que midias um evento precisa, e para que. PURO.
 *
 * Separado do download de proposito: decidir o que buscar e uma regra
 * editorial; buscar e IO. A separacao permite testar "materia com hero e dois
 * blocos de imagem pede tres assets, o hero com finalidade `hero`" sem subir
 * servidor nem tocar disco.
 *
 * Tambem e aqui que se decide o que acontece quando a midia FALHA — e a resposta
 * nao e "seguir sem imagem". Uma capa que some sem ninguem perceber e pior do
 * que uma publicacao que falha ruidosamente: a materia vai ao ar quebrada e
 * ninguem e avisado.
 */

import type { ProjectionBlock, ProjectionEvent } from '../editorial-projection.js'

export type MediaPurpose = 'editorial' | 'hero' | 'social'

export interface MediaRequest {
  readonly mediaId: string
  readonly purpose: MediaPurpose
  /** `hero` ou o `blockId` do bloco de imagem que pediu o asset. */
  readonly usage: 'hero' | { readonly blockId: string }
  /** A publicacao FALHA se este asset nao puder ser projetado? */
  readonly required: boolean
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Blocos de imagem do corpo, com o `mediaRef` que cada um exige. */
export function imageBlockRequests(blocks: readonly ProjectionBlock[]): MediaRequest[] {
  const requests: MediaRequest[] = []
  for (const block of blocks) {
    if (block.type !== 'image') continue
    const mediaId = textOrNull(block.mediaRef)
    const blockId = textOrNull(block.id) ?? ''
    if (mediaId === null) continue
    requests.push({
      mediaId,
      purpose: 'editorial',
      usage: { blockId },
      // Um bloco de imagem cujo asset nao pode ser projetado NAO vira bloco
      // vazio: o editor colocou aquela imagem por um motivo, e uma legenda
      // orfa no meio do texto e pior que uma publicacao recusada.
      required: true,
    })
  }
  return requests
}

/**
 * Itens de GALERIA, cada um com o proprio `mediaRef`.
 *
 * A galeria existe no CMS, no contrato e no site — e so o worker nao a
 * conhecia. Sem estes pedidos nenhum byte era baixado, `applyMediaToBlocks`
 * devolvia o bloco intacto e o site descartava todos os itens por falta de
 * caminho local: a galeria publicada sumia da pagina, com 200 e sem log.
 *
 * OPCIONAL por item, ao contrario do bloco `image`. O site ja trata a galeria
 * com "fallback por imagem" (uma foto sem caminho nao derruba as outras);
 * exigir aqui recusaria a materia inteira por uma foto em dez — o oposto da
 * politica de exibicao. O item que nao projetar e reportado por
 * `applyMediaToBlocks`, nao engolido.
 *
 * O `blockId` do uso e `<bloco>#<indice>`: o operador precisa saber QUAL foto
 * de QUAL galeria caiu.
 */
export function galleryItemRequests(blocks: readonly ProjectionBlock[]): MediaRequest[] {
  const requests: MediaRequest[] = []
  for (const block of blocks) {
    if (block.type !== 'gallery') continue
    const blockId = textOrNull(block.id) ?? ''
    const items = Array.isArray(block.items) ? (block.items as unknown[]) : []
    items.forEach((raw, index) => {
      const item = raw as Record<string, unknown> | null
      const mediaId = textOrNull(item?.mediaRef)
      if (mediaId === null) return
      requests.push({
        mediaId,
        purpose: 'editorial',
        usage: { blockId: `${blockId}#${String(index)}` },
        required: false,
      })
    })
  }
  return requests
}

export interface MediaPlan {
  readonly requests: readonly MediaRequest[]
  /** `mediaRef` de bloco de imagem sem id utilizavel. */
  readonly malformedBlockIds: readonly string[]
}

/**
 * Monta o plano de midia de um evento.
 *
 * O hero sai de `event.media` com `role: 'hero'` — nunca de uma URL. O contrato
 * carrega `url`, e ela e deliberadamente IGNORADA aqui: seguir aquele link seria
 * buscar bytes num host que o worker nao controla, com a credencial dele no
 * bolso.
 */
export function planEventMedia(event: ProjectionEvent): MediaPlan {
  const requests: MediaRequest[] = []
  const malformedBlockIds: string[] = []

  for (const item of event.media) {
    if (item.role !== 'hero') continue
    const mediaId = textOrNull((item as { mediaId?: unknown }).mediaId)
    if (mediaId === null) continue
    requests.push({ mediaId, purpose: 'hero', usage: 'hero', required: true })
  }

  const blocks = event.publishedContent?.body ?? []
  for (const block of blocks) {
    if (block.type !== 'image') continue
    const mediaId = textOrNull(block.mediaRef)
    if (mediaId === null) {
      malformedBlockIds.push(textOrNull(block.id) ?? '(sem id)')
    }
  }
  for (const block of blocks) {
    if (block.type !== 'gallery') continue
    const items = Array.isArray(block.items) ? (block.items as unknown[]) : []
    items.forEach((raw, index) => {
      const item = raw as Record<string, unknown> | null
      if (textOrNull(item?.mediaRef) === null) {
        malformedBlockIds.push(`${textOrNull(block.id) ?? '(sem id)'}#${String(index)}`)
      }
    })
  }
  requests.push(...imageBlockRequests(blocks))
  requests.push(...galleryItemRequests(blocks))

  // Dedup por (mediaId, purpose): a mesma foto usada como capa e no corpo e um
  // download so por finalidade.
  //
  // O PEDIDO MAIS FORTE PREVALECE. A mesma foto num bloco `image` (obrigatorio)
  // e numa galeria (opcional) e um download so — mas obrigatorio. Ficar com o
  // primeiro que aparecesse faria a ORDEM dos blocos decidir se uma falha
  // recusa a materia ou passa calada.
  const byKey = new Map<string, MediaRequest>()
  for (const request of requests) {
    const key = `${request.mediaId}::${request.purpose}`
    const previous = byKey.get(key)
    if (previous === undefined) {
      byKey.set(key, request)
    } else if (request.required && !previous.required) {
      byKey.set(key, { ...previous, required: true })
    }
  }

  return { requests: [...byKey.values()], malformedBlockIds }
}

/* ------------------------------------------------------------------ */
/* Aplicacao do resultado                                              */
/* ------------------------------------------------------------------ */

/** Asset ja projetado e disponivel no storage publico. */
export interface ResolvedMediaAsset {
  readonly mediaId: string
  readonly publicPath: string
  readonly contentHash: string
  readonly mimeType: string
  readonly width: number | null
  readonly height: number | null
  readonly alt: string
  readonly caption: string | null
  readonly credit: string | null
}

/**
 * Reescreve os blocos de imagem trocando `mediaRef` (id do CMS, inutil para o
 * publico) pelo caminho publico projetado.
 *
 * Preserva `id`, ORDEM, alt, legenda e credito. O bloco continua sendo o mesmo
 * bloco: so a referencia da imagem muda de "documento no CMS" para "arquivo no
 * storage publico".
 */
export function applyMediaToBlocks(
  blocks: readonly ProjectionBlock[],
  assets: ReadonlyMap<string, ResolvedMediaAsset>,
): { readonly blocks: ProjectionBlock[]; readonly unresolved: string[] } {
  const unresolved: string[] = []
  const projected = blocks.flatMap((block): ProjectionBlock[] => {
    if (block.type === 'gallery') {
      const gallery = applyMediaToGallery(block, assets, unresolved)
      return gallery === null ? [] : [gallery]
    }
    if (block.type !== 'image') return [block]
    const mediaId = textOrNull(block.mediaRef)
    const asset = mediaId === null ? undefined : assets.get(mediaId)
    if (asset === undefined) {
      unresolved.push(textOrNull(block.id) ?? '(sem id)')
      return [block]
    }
    // `mediaRef` sai do bloco publico: um id do CMS no corpo publico e um
    // vazamento de identificador interno que nao serve para nada no render.
    const { mediaRef: _dropped, ...rest } = block
    return [
      {
        ...rest,
        publicPath: asset.publicPath,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType,
        alt: textOrNull(block.alt) ?? asset.alt,
        caption: textOrNull(block.caption) ?? asset.caption,
        credit: textOrNull(block.credit) ?? asset.credit,
      } as ProjectionBlock,
    ]
  })
  return { blocks: projected, unresolved }
}

/**
 * A galeria com cada item resolvido para caminho publico — ou `null` se nenhum
 * item resolveu.
 *
 * Item sem asset SAI do bloco publico e entra em `unresolved` como
 * `<bloco>#<indice>`. Mante-lo com `mediaRef` levaria o id interno do CMS ao
 * corpo publico (o mesmo vazamento que o bloco `image` evita), e o site o
 * descartaria de qualquer forma — so que sem ninguem saber.
 *
 * `initialIndex` acompanha o ITEM, nao a posicao: se a galeria abria na 2a foto
 * e a 1a caiu, ela continua abrindo naquela foto, que agora e a 1a. Se a foto
 * de abertura caiu, o indice sai e o site abre na primeira.
 */
function applyMediaToGallery(
  block: ProjectionBlock,
  assets: ReadonlyMap<string, ResolvedMediaAsset>,
  unresolved: string[],
): ProjectionBlock | null {
  const blockId = textOrNull(block.id) ?? '(sem id)'
  const rawItems = Array.isArray(block.items) ? (block.items as unknown[]) : []
  const wantedIndex = typeof block.initialIndex === 'number' ? block.initialIndex : null

  const items: Record<string, unknown>[] = []
  let initialIndex: number | null = null

  rawItems.forEach((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>
    const mediaId = textOrNull(item.mediaRef)
    const asset = mediaId === null ? undefined : assets.get(mediaId)
    if (asset === undefined) {
      unresolved.push(`${blockId}#${String(index)}`)
      return
    }
    if (index === wantedIndex) initialIndex = items.length
    const { mediaRef: _dropped, ...rest } = item
    items.push({
      ...rest,
      publicPath: asset.publicPath,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
      // Credito e legenda sao POR FOTO: o do item vence; sem ele, o do acervo.
      alt: textOrNull(item.alt) ?? asset.alt,
      caption: textOrNull(item.caption) ?? asset.caption,
      credit: textOrNull(item.credit) ?? asset.credit,
    })
  })

  if (items.length === 0) return null

  const { initialIndex: _previous, items: _raw, ...rest } = block
  return {
    ...rest,
    items,
    ...(initialIndex === null ? {} : { initialIndex }),
  } as ProjectionBlock
}

/**
 * Blocos de video: nada e baixado nesta fase.
 *
 * O que sobrevive e a referencia ESTRUTURADA (provider + id). URL livre e
 * embed de HTML nao atravessam — um `<iframe>` vindo do corpo de uma materia e
 * execucao de terceiro numa pagina nossa.
 */
export const ALLOWED_VIDEO_PROVIDERS = ['youtube', 'vimeo', 'internal'] as const

export function isAllowedVideoBlock(block: ProjectionBlock): boolean {
  if (block.type !== 'video') return true
  const provider = textOrNull(block.provider)
  if (provider === null) return false
  return (ALLOWED_VIDEO_PROVIDERS as readonly string[]).includes(provider)
}
