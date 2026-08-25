/**
 * types.ts — Vocabulario da promocao governada de MIDIA. PURO (sem banco/rede).
 *
 * ============================================================================
 * O QUE ESTE MODULO GOVERNA
 * ============================================================================
 * Duas tabelas que nasceram `display_allowed = false` por linha e que NADA no
 * repositorio jamais promoveu:
 *
 *   `tmdb_videos`  — o trailer da ficha, a galeria de videos, o trilho "Em breve".
 *   `tmdb_images`  — SO as linhas de PESSOA (`entity_type='person'`,
 *                    `image_type='profile'`), que `person-page.ts` filtra por
 *                    linha. A galeria de TITULO nao entra aqui: ela e gated pela
 *                    FONTE (`source_licenses` -> `authorizeImageDisplay`) e
 *                    deliberadamente ignora a coluna da linha.
 *
 * ============================================================================
 * SAO DUAS COLUNAS, NAO UMA — E ESSE E O PONTO MAIS FACIL DE ERRAR
 * ============================================================================
 * Todo consumidor de render filtra o PAR:
 *
 *   display_allowed = true  AND  license_status NOT IN ('unknown','blocked')
 *
 * `license_status` nasce `'unknown'` (DEFAULT do DDL) e nunca foi escrito por
 * ninguem. Ligar so `display_allowed` nao acende NADA: a linha continua parada
 * na segunda condicao. Por isso a promocao escreve as duas, e o valor de
 * `license_status` e DERIVADO da licenca vigente — nunca literal.
 */

/** As duas superficies que esta ferramenta promove. */
export type PromotionTarget = 'video' | 'person-photo'

/** Os dois alvos, para iteracao e validacao de argumento. */
export const PROMOTION_TARGETS: readonly PromotionTarget[] = ['video', 'person-photo']

/**
 * `content_type` de `source_licenses` que governa cada alvo.
 *
 * Nao e cosmetico: e a chave da consulta que decide se ha permissao. Errar o
 * mapeamento leria a licenca de OUTRA coisa — e uma licenca de imagem dizendo
 * "sim" nao autoriza acender video.
 */
export const LICENSE_CONTENT_TYPE_BY_TARGET: Readonly<Record<PromotionTarget, string>> = {
  video: 'video',
  'person-photo': 'image',
}

/** A fonte governada. Nenhum outro `provider_api` e tocado por esta ferramenta. */
export const GOVERNED_SOURCE_KEY = 'tmdb'

/** O unico site cujo metadado de video vale promover (e o unico player do site). */
export const ALLOWED_VIDEO_SITE = 'YouTube'

/** Tipos de imagem promoviveis no alvo `person-photo`. */
export const PERSON_PHOTO_IMAGE_TYPE = 'profile'

/**
 * `license_status` que a invariante 6 barra, em qualquer camada.
 *
 * Vale para os DOIS lados: uma licenca-mae com este status nao autoriza nada, e
 * uma LINHA com este status nunca e promovida (ver `row-blocked`).
 */
export const BLOCKING_LICENSE_STATUS: readonly string[] = ['unknown', 'blocked']

/**
 * Statuses que a galeria de PESSOA aceita (`person-page.ts:375`).
 *
 * Mais estrito que o gate de video, e a diferenca importa: aquela consulta usa
 * `licenseStatus: { in: ['official','licensed'] }`, nao `notIn`. Promover uma
 * foto com `third_party` gravaria uma linha que a tela descarta em silencio —
 * uma promocao que mente. Por isso o alvo `person-photo` exige que a
 * licenca-mae esteja num destes dois.
 */
export const PERSON_GALLERY_ACCEPTED_STATUS: readonly string[] = ['official', 'licensed']

/** Uma linha de `tmdb_videos` candidata. `id` e BigInt serializado como string. */
export interface VideoCandidate {
  readonly kind: 'video'
  readonly id: string
  readonly providerApi: string | null
  readonly entityType: string
  readonly tmdbId: number
  readonly site: string
  readonly videoKey: string
  readonly name: string | null
  readonly videoType: string | null
  readonly official: boolean | null
  readonly languageCode: string | null
  readonly displayAllowed: boolean
  readonly licenseStatus: string
}

/** Uma linha de `tmdb_images` de PESSOA candidata. */
export interface PersonPhotoCandidate {
  readonly kind: 'person-photo'
  readonly id: string
  readonly providerApi: string | null
  readonly entityType: string
  readonly tmdbId: number
  readonly imageType: string
  readonly filePath: string
  readonly languageCode: string | null
  readonly displayAllowed: boolean
  readonly licenseStatus: string
}

/** Qualquer candidata. O discriminador `kind` decide qual guardrail roda. */
export type PromotionCandidate = VideoCandidate | PersonPhotoCandidate

/**
 * Motivos de recusa de UMA linha.
 *
 * Cada um e acionavel: o operador le o motivo e sabe o que fazer, sem abrir o
 * codigo. Um motivo generico ("invalida") transformaria o censo em ruido.
 */
export type PromotionRejectionReason =
  /** `provider_api` nao e `tmdb` — origem nao governada por esta ferramenta. */
  | 'wrong-provider'
  /** A linha ja esta acesa (display + status nao bloqueante). Nada a fazer. */
  | 'already-promoted'
  /**
   * A LINHA tem `license_status = 'blocked'`.
   *
   * Nasce `'unknown'`; `'blocked'` so aparece se alguem a bloqueou de proposito.
   * A promocao NUNCA sobrescreve isso — reverter um bloqueio deliberado tem de
   * ser um ato deliberado, nao efeito colateral de um ciclo em massa.
   */
  | 'row-blocked'
  /** Video de site que o produto nao carrega (so YouTube tem player aqui). */
  | 'wrong-site'
  /** `video_key` fora do padrao de 11 caracteres — nao vira player nenhum. */
  | 'invalid-video-key'
  /** `--only-official` ligado e a linha nao e `official = true`. */
  | 'not-official'
  /** Imagem que nao e de pessoa, ou nao e `profile`. */
  | 'wrong-image-scope'
  /** `file_path` que `buildTmdbImageUrl` recusa — nao vira URL nenhuma. */
  | 'invalid-file-path'

/** Motivos de recusa de uma REVERSAO. */
export type RevocationRejectionReason = 'wrong-provider' | 'already-dark'

/** Decisao sobre uma linha. `reason` e `null` sse `eligible`. */
export interface PromotionEvaluation {
  readonly eligible: boolean
  readonly reason: PromotionRejectionReason | RevocationRejectionReason | null
}
