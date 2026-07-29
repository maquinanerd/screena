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
  requests.push(...imageBlockRequests(blocks))

  // Dedup por (mediaId, purpose): a mesma foto usada como capa e no corpo e um
  // download so por finalidade.
  const seen = new Set<string>()
  const deduped = requests.filter((request) => {
    const key = `${request.mediaId}::${request.purpose}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { requests: deduped, malformedBlockIds }
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
  const projected = blocks.map((block) => {
    if (block.type !== 'image') return block
    const mediaId = textOrNull(block.mediaRef)
    const asset = mediaId === null ? undefined : assets.get(mediaId)
    if (asset === undefined) {
      unresolved.push(textOrNull(block.id) ?? '(sem id)')
      return block
    }
    // `mediaRef` sai do bloco publico: um id do CMS no corpo publico e um
    // vazamento de identificador interno que nao serve para nada no render.
    const { mediaRef: _dropped, ...rest } = block
    return {
      ...rest,
      publicPath: asset.publicPath,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
      alt: textOrNull(block.alt) ?? asset.alt,
      caption: textOrNull(block.caption) ?? asset.caption,
      credit: textOrNull(block.credit) ?? asset.credit,
    } as ProjectionBlock
  })
  return { blocks: projected, unresolved }
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
