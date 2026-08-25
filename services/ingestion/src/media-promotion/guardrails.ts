/**
 * guardrails.ts — Guardrails PUROS por LINHA. Sem banco, sem rede, sem relogio.
 *
 * A licenca (../media-promotion/license.ts) decide se o ALVO pode ser promovido.
 * Este modulo decide se AQUELA LINHA pode. Os dois sao necessarios e nenhum
 * substitui o outro: licenca sem guardrail acenderia lixo licenciado; guardrail
 * sem licenca acenderia dado limpo e proibido.
 *
 * ============================================================================
 * A REGRA GERAL: NAO PROMOVER O QUE A TELA VAI DESCARTAR
 * ============================================================================
 * Cada checagem daqui espelha uma condicao que o render ja aplica. Promover uma
 * linha que o presenter depois joga fora produz o pior desfecho possivel para
 * quem opera: o banco diz "1.119 acesas", a pagina mostra nada, e nenhuma das
 * duas leituras esta errada. Ver o mesmo raciocinio em
 * `services/streaming/src/promotion/guardrails.ts` (`promotionDestination`).
 *
 * ============================================================================
 * O QUE **NAO** E GUARDRAIL AQUI, POR DECISAO DO DONO (2026-08-25)
 * ============================================================================
 * `video_type` NAO filtra. A promocao cobre os 1.119 videos, nao so os de tipo
 * `Trailer`/`Teaser`. A licenca vigente (`tmdb-video/2026-08-v2`) cobre metadado
 * de video do YouTube sem distincao de tipo, e o arquivo nao e rehospedado em
 * caso nenhum.
 *
 * Consequencia que vale dizer em voz alta: `pickTrailer` CONTINUA escolhendo so
 * `Trailer`/`Teaser` para o botao da ficha, e isso esta certo — um botao que
 * promete trailer e abre bastidor mente. O tipo deixou de ser gate de PROMOCAO;
 * segue sendo criterio de ESCOLHA no presenter. Sao decisoes diferentes, em
 * camadas diferentes.
 *
 * `official` tambem nao filtra por padrao — vira recusa so com `--only-official`.
 * O censo sempre separa oficiais de nao-oficiais para que a escolha seja vista,
 * nunca herdada por omissao.
 */

import { buildTmdbImageUrl, isYouTubeVideoId } from '@screena/public-contracts'

import {
  ALLOWED_VIDEO_SITE,
  BLOCKING_LICENSE_STATUS,
  GOVERNED_SOURCE_KEY,
  PERSON_PHOTO_IMAGE_TYPE,
  type PromotionCandidate,
  type PromotionEvaluation,
  type PromotionRejectionReason,
  type RevocationRejectionReason,
} from './types.js'

/** Opcoes que mudam o rigor da avaliacao (nunca a licenca). */
export interface GuardrailOptions {
  /** Recusa linha com `official !== true`. Default `false` (decisao do dono). */
  readonly onlyOfficial: boolean
}

/** Default explicito: sem estreitamento por `official`. */
export const DEFAULT_GUARDRAIL_OPTIONS: GuardrailOptions = { onlyOfficial: false }

function reject(reason: PromotionRejectionReason): PromotionEvaluation {
  return { eligible: false, reason }
}

function rejectRevoke(reason: RevocationRejectionReason): PromotionEvaluation {
  return { eligible: false, reason }
}

const ELIGIBLE: PromotionEvaluation = { eligible: true, reason: null }

/**
 * A linha ja esta efetivamente acesa?
 *
 * Espelha o PAR que todo consumidor de render filtra. Uma linha com
 * `display_allowed = true` e `license_status = 'unknown'` NAO conta como acesa —
 * ela esta num meio-termo invisivel, e promover e exatamente o que a conserta.
 * Tratar esse estado como "ja promovida" o congelaria para sempre.
 */
function isEffectivelyLit(candidate: PromotionCandidate): boolean {
  return (
    candidate.displayAllowed && !BLOCKING_LICENSE_STATUS.includes(candidate.licenseStatus)
  )
}

/**
 * Avalia UMA linha para promocao.
 *
 * Precedencia (a primeira que bate e reportada):
 *   1. wrong-provider     — origem fora de `tmdb`;
 *   2. row-blocked        — bloqueio DELIBERADO da linha (nunca sobrescrito);
 *   3. already-promoted   — nada a fazer;
 *   4+ especificas do alvo.
 *
 * `row-blocked` vem antes de `already-promoted` de proposito: uma linha
 * bloqueada que estivesse acesa e o desfecho mais grave possivel aqui, e
 * reportar "ja promovida" o esconderia atras de um motivo inofensivo. Mesma
 * ordem, e mesmo motivo, de `withheld-by-decision` no guardrail de streaming.
 */
export function evaluatePromotion(
  candidate: PromotionCandidate,
  options: GuardrailOptions = DEFAULT_GUARDRAIL_OPTIONS,
): PromotionEvaluation {
  if (candidate.providerApi !== GOVERNED_SOURCE_KEY) return reject('wrong-provider')
  if (candidate.licenseStatus === 'blocked') return reject('row-blocked')
  if (isEffectivelyLit(candidate)) return reject('already-promoted')

  if (candidate.kind === 'video') {
    // Comparacao EXATA, nunca `includes`: um `site` de "YouTube Kids" ou
    // "MyYouTube" nao e o player que o produto carrega.
    if (candidate.site !== ALLOWED_VIDEO_SITE) return reject('wrong-site')
    // Sem id valido nao existe player: `buildYouTubeEmbedUrl` devolveria `null`
    // e a linha entraria na galeria sem botao. Melhor nem acender.
    if (!isYouTubeVideoId(candidate.videoKey)) return reject('invalid-video-key')
    if (options.onlyOfficial && candidate.official !== true) return reject('not-official')
    return ELIGIBLE
  }

  // person-photo. O escopo e duplo (entidade E tipo de imagem) porque
  // `tmdb_images` guarda poster/backdrop/logo/still/profile na MESMA tabela: um
  // filtro so deixaria passar backdrop de filme por esta porta.
  if (candidate.entityType !== 'person') return reject('wrong-image-scope')
  if (candidate.imageType !== PERSON_PHOTO_IMAGE_TYPE) return reject('wrong-image-scope')
  // A MESMA funcao que o render usa para montar a URL. Se ela recusa o path, a
  // foto promovida seria um buraco na grade.
  if (buildTmdbImageUrl(candidate.filePath, 'w500') === null) return reject('invalid-file-path')
  return ELIGIBLE
}

/**
 * Avalia UMA linha para reversao.
 *
 * Reversao e a direcao SEGURA e por isso quase nao tem guardrail: nao consulta
 * licenca (apagar nunca precisa de permissao) e so recusa o que nao faria
 * diferenca. Exigir licenca para revogar seria o pior acoplamento possivel —
 * uma licenca que caiu impediria de apagar o que ela mesma deixou de autorizar.
 */
export function evaluateRevocation(candidate: PromotionCandidate): PromotionEvaluation {
  if (candidate.providerApi !== GOVERNED_SOURCE_KEY) return rejectRevoke('wrong-provider')
  // `already-dark` mede o EFEITO, nao a coluna: uma linha com
  // `display_allowed = true` e status bloqueante ja esta invisivel, mas revogar
  // ainda a normaliza para o estado de nascimento — entao ela NAO e "ja apagada".
  if (!candidate.displayAllowed) return rejectRevoke('already-dark')
  return ELIGIBLE
}
