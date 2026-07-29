/**
 * media-pipeline.ts — Orquestra buscar -> validar -> armazenar uma midia.
 *
 * Worker-only. NAO toca banco: devolve o que deve ser gravado, e quem grava e o
 * adapter Prisma, dentro da transacao da projecao.
 *
 * ORDEM (a parte que importa): o download e a gravacao no storage acontecem
 * ANTES de qualquer transacao no screen-db. Baixar 15 MB dentro de uma
 * transacao aberta seguraria a conexao e as travas de linha pelo tempo da rede
 * — e uma rede lenta viraria contencao no banco publico.
 *
 * Consequencia assumida: se o processo morrer entre gravar o arquivo e commitar,
 * o arquivo fica no storage sem referencia. Isso e ORFAO, nao corrupcao: a
 * chave e derivada do conteudo, entao o retry reaproveita o mesmo arquivo em vez
 * de criar uma copia. Orfaos sao coletaveis depois; um banco apontando para um
 * arquivo que nao existe, nao.
 */

import { fetchMediaEnvelope, MediaFetchError, type MediaFetchDeps } from './media-client.js'
import {
  DEFAULT_MEDIA_LIMITS,
  validateImageBytes,
  type MediaLimits,
} from './media-validation.js'
import type { MediaRequest, ResolvedMediaAsset } from './media-plan.js'
import { editorialMediaKey, type MediaStoragePort } from './storage-port.js'

/** Tudo que o banco publico precisa saber sobre um asset projetado. */
export interface ProjectedMediaAsset extends ResolvedMediaAsset {
  readonly storageKey: string
  readonly byteSize: number
  readonly rightsHolder: string | null
  readonly sourceName: string | null
  readonly sourceUrl: string | null
  readonly licenseStatus: string
  readonly licenseReference: string | null
  readonly licenseExpiresAtIso: string | null
  readonly requiresAttribution: boolean
  readonly allowedForEditorial: boolean
  readonly allowedForHero: boolean
  readonly allowedForSocial: boolean
  /** `true` quando os bytes ja estavam no storage (dedup ou retry). */
  readonly reused: boolean
}

export interface MediaPipelineDeps {
  readonly fetch: MediaFetchDeps
  readonly storage: MediaStoragePort
  readonly limits?: MediaLimits
  /** Formatos cujas dimensoes nao sabemos ler (AVIF) sao aceitos? */
  readonly allowUnreadableDimensions?: boolean
}

export class MediaPipelineError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly mediaId: string
  constructor(mediaId: string, code: string, message: string, retryable: boolean) {
    super(message)
    this.mediaId = mediaId
    this.code = code
    this.retryable = retryable
  }
}

/** Estados de licenca aceitos no banco publico (espelha o CMS). */
const PUBLIC_LICENSE_STATUS = new Set([
  'unknown',
  'pending',
  'approved',
  'restricted',
  'expired',
  'prohibited',
])

/**
 * Projeta UMA midia: busca os bytes, valida e grava no storage.
 *
 * Nao decide se a materia pode sair sem ela — isso e do chamador, que conhece a
 * politica de obrigatoriedade.
 */
export async function projectMediaAsset(
  deps: MediaPipelineDeps,
  request: MediaRequest,
): Promise<ProjectedMediaAsset> {
  let envelope
  try {
    envelope = await fetchMediaEnvelope(deps.fetch, request.mediaId, request.purpose)
  } catch (error) {
    if (error instanceof MediaFetchError) {
      throw new MediaPipelineError(request.mediaId, error.code, error.message, error.retryable)
    }
    throw new MediaPipelineError(
      request.mediaId,
      'media_fetch_failed',
      'falha nao classificada ao buscar midia',
      true,
    )
  }

  const validation = validateImageBytes({
    bytes: envelope.bytes,
    contentHash: envelope.contentHash,
    declaredMime: envelope.declaredMime,
    // O CMS promete um hash; conferimos contra os bytes que chegaram. Divergir
    // significa que o corpo mudou no caminho — nada e gravado.
    expectedContentHash: envelope.declaredContentHash,
    limits: deps.limits ?? DEFAULT_MEDIA_LIMITS,
    ...(deps.allowUnreadableDimensions === undefined
      ? {}
      : { allowUnreadableDimensions: deps.allowUnreadableDimensions }),
  })

  if (!validation.ok) {
    // Bytes invalidos NUNCA sao retentaveis: o arquivo nao muda sozinho, e
    // insistir so adiaria o dead-letter que o editor precisa ver.
    throw new MediaPipelineError(
      request.mediaId,
      validation.code,
      `midia recusada (${validation.code}): ${validation.detail}`,
      false,
    )
  }

  const storageKey = editorialMediaKey(validation.contentHash, validation.extension)

  // Dedup e retry na mesma pergunta: se os bytes ja estao la, nao ha o que
  // gravar. A chave e derivada do conteudo, entao "ja existe" implica
  // "identico" — nao ha risco de reaproveitar arquivo diferente.
  const existing = await deps.storage.stat(storageKey)
  const reused = existing !== null && existing.byteSize === validation.byteSize
  if (!reused) {
    try {
      await deps.storage.put({
        key: storageKey,
        bytes: envelope.bytes,
        contentType: validation.mime,
      })
    } catch (error) {
      // Storage fora do ar e transitorio: vale retentar.
      throw new MediaPipelineError(
        request.mediaId,
        'media_storage_failed',
        `falha ao gravar no storage (${error instanceof Error ? error.name : 'desconhecida'})`,
        true,
      )
    }
  }

  const licenseStatus = (envelope.licenseStatus ?? '').trim()

  return {
    mediaId: request.mediaId,
    storageKey,
    publicPath: deps.storage.publicReference(storageKey),
    contentHash: validation.contentHash,
    mimeType: validation.mime,
    // A dimensao lida dos BYTES vence a declarada pelo CMS: o cabecalho do
    // arquivo e a verdade; o campo do painel pode estar desatualizado.
    width: validation.dimensions?.width ?? envelope.width,
    height: validation.dimensions?.height ?? envelope.height,
    byteSize: validation.byteSize,
    alt: envelope.alt,
    caption: envelope.caption,
    credit: envelope.credit,
    rightsHolder: envelope.rightsHolder,
    sourceName: envelope.sourceName,
    sourceUrl: envelope.sourceUrl,
    // Valor desconhecido vira `unknown` (o default seguro do enum), nunca um
    // status inventado que o banco recusaria no meio da transacao.
    licenseStatus: PUBLIC_LICENSE_STATUS.has(licenseStatus) ? licenseStatus : 'unknown',
    licenseReference: envelope.licenseReference,
    licenseExpiresAtIso: envelope.licenseExpiresAtIso,
    requiresAttribution: envelope.requiresAttribution,
    allowedForEditorial: envelope.allowedForEditorial,
    allowedForHero: envelope.allowedForHero,
    allowedForSocial: envelope.allowedForSocial,
    reused,
  }
}

export interface MediaProjectionResult {
  readonly assets: Map<string, ProjectedMediaAsset>
  readonly warnings: string[]
}

/**
 * Projeta todas as midias de um plano.
 *
 * SERIAL de proposito. Paralelizar aqui multiplicaria a memoria (N x 15 MB) e a
 * carga no CMS por evento, para ganhar segundos numa fila que ja e assincrona.
 *
 * A primeira falha de asset OBRIGATORIO interrompe: nao adianta baixar o resto
 * se a materia nao vai poder ser publicada de qualquer forma.
 */
export async function projectEventMedia(
  deps: MediaPipelineDeps,
  requests: readonly MediaRequest[],
): Promise<MediaProjectionResult> {
  const assets = new Map<string, ProjectedMediaAsset>()
  const warnings: string[] = []

  for (const request of requests) {
    if (assets.has(request.mediaId)) continue
    try {
      const asset = await projectMediaAsset(deps, request)
      assets.set(request.mediaId, asset)
      if (asset.reused) warnings.push(`midia ${request.mediaId} reaproveitada do storage`)
    } catch (error) {
      if (request.required) throw error
      const code = error instanceof MediaPipelineError ? error.code : 'media_failed'
      warnings.push(`midia opcional ${request.mediaId} nao projetada (${code})`)
    }
  }

  return { assets, warnings }
}
