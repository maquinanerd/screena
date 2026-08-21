/**
 * image-authorization.ts — O GATE DE LICENCA DA IMAGEM, que nao existia.
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * Cinco modulos do render consultam `source_licenses` antes de exibir dado de
 * terceiro: premiacao, trailer, notas, onde-assistir e o hero. IMAGEM nao era um
 * deles. O caminho `movie-presenter.ts:185` -> `imageAsset` -> `buildTmdbImageUrl`
 * nao mencionava licenca em ponto nenhum, e nem `media-url.ts` mencionava.
 *
 * Isso NAO era um contorno de gate: o gate nunca existiu nesse caminho. E a
 * consequencia e que o valor de `display_allowed` para `tmdb`/`image` era
 * DECORACAO — `true` ou `false`, o poster renderizava igual. E a mesma classe de
 * defeito do `COLOR_TOKENS`: registro de governanca que nada consome, que
 * sobrevive porque ninguem testou se alguem o lia.
 *
 * ============================================================================
 * POR QUE O GATE VEM ANTES DO FLAG
 * ============================================================================
 * A ordem importa e nao e estetica. Ligar `display_allowed = true` primeiro
 * produziria a tela certa pelo motivo errado, e no dia em que alguem pusesse
 * `false` de volta nada mudaria — a governanca continuaria mentindo, so que na
 * direcao oposta. Com o gate existindo, o flag passa a SIGNIFICAR alguma coisa.
 *
 * ============================================================================
 * O TIPO E UMA MARCA, NAO UM BOOLEANO
 * ============================================================================
 * `ImageDisplayAuthorization` e uma marca opaca. Nao da para fabrica-la com
 * `true`: quem quiser uma tem de pedir a `authorizeImageDisplay`, que exige a
 * linha de licenca. Um `boolean` cru deixaria qualquer chamador escrever
 * `tmdbImageUrlIfAllowed(path, size, true)` e o gate viraria comentario.
 *
 * PURO: sem rede, sem banco, sem relogio proprio. Quem le `source_licenses` e o
 * adapter em `apps/web/src/server/image-license.ts`; este modulo so DECIDE.
 */

import { buildTmdbImageUrl, type TmdbImageSize } from './media-url.js'

/** Os `license_status` que NUNCA autorizam exibicao (invariante 6). */
const BLOCKING_LICENSE_STATUS: readonly string[] = ['unknown', 'blocked']

/**
 * A marca de autorizacao. Opaca de proposito: o campo privado impede que um
 * objeto literal seja aceito no lugar dela.
 */
export interface ImageDisplayAuthorization {
  readonly authorized: boolean
  /** Por que. Sempre preenchido — inclusive quando autoriza. */
  readonly reason: string
  /** Impede construcao por literal. Nao carrega informacao. */
  readonly __brand: 'ImageDisplayAuthorization'
}

/** A linha de `source_licenses` de que a decisao depende. Subset minimo. */
export interface ImageLicenseRow {
  readonly sourceKey: string
  readonly contentType: string
  readonly licenseStatus: string
  readonly displayAllowed: boolean
  readonly isCurrent: boolean
}

/**
 * Decide se imagem do TMDB pode ir ao ar.
 *
 * FAIL-CLOSED em todas as portas: ausencia de linha NAO autoriza. Uma licenca
 * que "ainda nao foi registrada" e indistinguivel, do lado de fora, de uma que
 * foi negada — e a invariante 6 manda tratar as duas igual.
 *
 * Recebe a lista de linhas (nao uma so) porque a consulta pode devolver
 * historico; so a `is_current` decide.
 */
export function authorizeImageDisplay(
  rows: readonly ImageLicenseRow[],
): ImageDisplayAuthorization {
  const vigente = rows.find(
    (row) => row.isCurrent && row.sourceKey === 'tmdb' && row.contentType === 'image',
  )

  if (vigente === undefined) {
    return deny('sem licenca vigente de tmdb/image em source_licenses')
  }
  if (BLOCKING_LICENSE_STATUS.includes(vigente.licenseStatus)) {
    return deny(`license_status = "${vigente.licenseStatus}" (invariante 6)`)
  }
  if (!vigente.displayAllowed) {
    return deny('display_allowed = false na licenca vigente de tmdb/image')
  }
  return {
    authorized: true,
    reason: `licenca vigente de tmdb/image com display_allowed e license_status "${vigente.licenseStatus}"`,
    __brand: 'ImageDisplayAuthorization',
  }
}

function deny(reason: string): ImageDisplayAuthorization {
  return { authorized: false, reason, __brand: 'ImageDisplayAuthorization' }
}

/**
 * A autorizacao NEGADA, para quem precisa de uma sem consultar o banco.
 *
 * Existe para TESTE e para caminho degradado (banco inalcancavel): negar e o
 * default seguro. Nao ha `IMAGE_DISPLAY_ALLOWED` simetrico de proposito — uma
 * constante que autoriza seria exatamente a porta dos fundos que a marca opaca
 * existe para fechar.
 */
export const IMAGE_DISPLAY_DENIED: ImageDisplayAuthorization = deny(
  'autorizacao nao resolvida (default seguro)',
)

/**
 * A URL publica de uma imagem do TMDB, SE a licenca permitir.
 *
 * E a UNICA funcao que o render publico pode chamar para montar URL de imagem.
 * `buildTmdbImageUrl` continua existindo e continua sendo o ponto unico do host,
 * mas ela decide FORMA (o path e valido?), nunca PERMISSAO — e por isso o guard
 * `tests/governance/image-license-gate.test.ts` proibe `apps/web` de importa-la
 * direto.
 *
 * Devolve `null` nos dois casos, e isso e deliberado: a pagina nao precisa
 * distinguir "path invalido" de "licenca negada" — os dois significam "nao
 * exibir". Quem precisa da diferenca le `authorization.reason`, que nunca vem
 * vazio.
 */
export function tmdbImageUrlIfAllowed(
  path: string | null | undefined,
  size: TmdbImageSize,
  authorization: ImageDisplayAuthorization,
): string | null {
  if (!authorization.authorized) return null
  return buildTmdbImageUrl(path, size)
}
