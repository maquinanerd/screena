/**
 * birth.ts — A POLITICA DE NASCIMENTO da midia do TMDB. PURA (sem banco, sem
 * rede, sem relogio).
 *
 * ============================================================================
 * O QUE ESTE MODULO EXISTE PARA APAGAR
 * ============================================================================
 * `tmdb_images` e `tmdb_videos` nasciam `display_allowed = false` +
 * `license_status = 'unknown'` por DEFAULT do DDL, e nada na escrita consultava
 * a licenca. A consequencia nao era um defeito pontual: era um DEBITO QUE
 * CRESCIA. Cada ciclo de ingestao acrescentava linhas apagadas, e a unica forma
 * de acende-las era uma operacao em massa DEPOIS — que precisaria ser repetida
 * para sempre, porque a ingestao seguinte voltava a gravar no escuro.
 *
 * A decisao do proprietario (2026-08-28, registrada em
 * `services/legal/src/authorization-spec.ts`) encerrou a duvida sobre a
 * permissao. Este modulo encerra a REPETICAO: a linha passa a nascer no estado
 * que a licenca vigente autoriza, e `promote:media` vira ferramenta de ACERVO —
 * para o que ja esta no banco — em vez de rotina perpetua.
 *
 * ============================================================================
 * NASCER LIBERADO NAO E IGNORAR A LICENCA — E CONSULTA-LA NA HORA CERTA
 * ============================================================================
 * A autorizacao continua vindo de `source_licenses`, pelo MESMO gate da
 * promocao (`authorizeMediaPromotion`). Sem licenca vigente, ou com licenca
 * bloqueante, a linha nasce APAGADA — exatamente como antes. O que muda e o
 * MOMENTO da pergunta, nao a resposta. E o `license_status` gravado e o da
 * licenca vigente, nunca um literal: uma linha jamais afirma mais do que a
 * fonte concede.
 *
 * ============================================================================
 * SO NO NASCIMENTO. ATUALIZAR NUNCA REACENDE.
 * ============================================================================
 * Esta politica vale para a linha CRIADA. O caminho de atualizacao (o payload
 * mudou) NAO toca `display_allowed` nem `license_status`. Se tocasse,
 * `promote:media --revoke` deixaria de existir na pratica: bastaria o proximo
 * ciclo de ingestao para desfazer, em silencio, uma revogacao deliberada.
 * Apagar continua sendo um ato que so outro ato desfaz.
 *
 * ============================================================================
 * UMA SO LEITURA DE LICENCA PARA IMAGEM, E ELA E A MAIS ESTRITA
 * ============================================================================
 * O alvo `person-photo` e mais estrito que o de video: exige a licenca em
 * `official`/`licensed` (`in`, nao `notIn`), porque e o que a galeria de pessoa
 * consulta. Esta politica aplica esse gate a TODA imagem, inclusive a de
 * titulo.
 *
 * Nao e rigor decorativo, e a direcao segura de errar: a licenca vigente de
 * `tmdb`/`image` e `official`, entao hoje as duas leituras dao o mesmo
 * resultado; e no dia em que ela cair para `third_party`, a linha de titulo
 * nascer apagada nao muda NADA na tela (a galeria de titulo e gated pela FONTE
 * e ignora a coluna da linha, ver `apps/web/src/server/entity-gallery.ts`),
 * enquanto nascer acesa criaria uma linha afirmando permissao que a superficie
 * mais estrita ja teria recusado.
 */

import {
  isRenderableImagePath,
  isRenderableVideoShape,
} from './guardrails.js'
import { authorizeMediaPromotion, type MediaLicenseRow } from './license.js'

/** O estado com que uma linha de midia e GRAVADA na criacao. */
export interface MediaBirthState {
  readonly displayAllowed: boolean
  readonly licenseStatus: string
}

/**
 * O estado de nascimento APAGADO — o default seguro e o unico caminho quando a
 * licenca nao autoriza. E o par exato que o DDL ja usava.
 */
export const MEDIA_BIRTH_DARK: MediaBirthState = {
  displayAllowed: false,
  licenseStatus: 'unknown',
}

/** O subconjunto de uma linha de imagem de que a politica precisa. */
export interface MediaBirthImageInput {
  readonly filePath: string
}

/** O subconjunto de uma linha de video de que a politica precisa. */
export interface MediaBirthVideoInput {
  readonly site: string
  readonly videoKey: string
}

/** A politica aplicada a cada linha NOVA. */
export interface MediaBirthPolicy {
  forImage(row: MediaBirthImageInput): MediaBirthState
  forVideo(row: MediaBirthVideoInput): MediaBirthState
}

/**
 * A politica que NUNCA acende.
 *
 * Existe para o caminho degradado (licenca ilegivel) e para teste. NAO ha
 * constante simetrica que sempre acenda, pelo mesmo motivo de
 * `MEDIA_PROMOTION_DENIED`: ela seria a porta dos fundos que o gate existe para
 * fechar.
 */
export const DARK_MEDIA_BIRTH_POLICY: MediaBirthPolicy = {
  forImage: () => MEDIA_BIRTH_DARK,
  forVideo: () => MEDIA_BIRTH_DARK,
}

/**
 * As linhas de `source_licenses` de que a politica depende, por content_type.
 *
 * A lista COMPLETA de cada uma (historico incluso): `is_current` decide, e quem
 * decide e `authorizeMediaPromotion` — este modulo nao reimplementa a leitura.
 */
export interface MediaBirthLicenses {
  readonly image: readonly MediaLicenseRow[]
  readonly video: readonly MediaLicenseRow[]
}

/**
 * Cria a politica a partir das licencas vigentes.
 *
 * As duas autorizacoes sao resolvidas UMA vez, na construcao: a licenca e do
 * ALVO, nao da linha. Resolve-las por linha faria a mesma decisao milhares de
 * vezes por ciclo sem mudar de resposta.
 */
export function createMediaBirthPolicy(licenses: MediaBirthLicenses): MediaBirthPolicy {
  const image = authorizeMediaPromotion('person-photo', licenses.image)
  const video = authorizeMediaPromotion('video', licenses.video)

  return {
    forImage(row: MediaBirthImageInput): MediaBirthState {
      if (!image.authorized || image.licenseStatus === null) return MEDIA_BIRTH_DARK
      if (!isRenderableImagePath(row.filePath)) return MEDIA_BIRTH_DARK
      return { displayAllowed: true, licenseStatus: image.licenseStatus }
    },

    forVideo(row: MediaBirthVideoInput): MediaBirthState {
      if (!video.authorized || video.licenseStatus === null) return MEDIA_BIRTH_DARK
      if (!isRenderableVideoShape(row.site, row.videoKey)) return MEDIA_BIRTH_DARK
      return { displayAllowed: true, licenseStatus: video.licenseStatus }
    },
  }
}
