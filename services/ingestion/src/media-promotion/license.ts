/**
 * license.ts — O GATE DE LICENCA da promocao de midia. PURO.
 *
 * ============================================================================
 * POR QUE ELE E O PRIMEIRO GUARDRAIL, E NAO UMA FLAG
 * ============================================================================
 * `tmdb_videos` NAO TEM TRIGGER. `watch_availability` e `external_ratings` sao
 * protegidas no banco por `data_usage_decisions_guard`: uma promocao sem
 * licenca morre no Postgres mesmo que a CLI erre. Aqui nao ha nada disso — um
 * `UPDATE` cru passa. A unica coisa entre uma linha apagada e uma linha publica
 * e este arquivo.
 *
 * Consequencia de desenho: a autorizacao **nao pode vir de argumento**. Nao ha
 * `--license-ok`, nao ha `--force` que a pule, e `--confirm` nao a substitui.
 * Ela vem de uma leitura de `source_licenses`, sempre, em toda execucao — e o
 * dry-run le exatamente a mesma coisa que o `--confirm`, senao o dry-run
 * mentiria sobre o que o apply faria.
 *
 * ============================================================================
 * A MARCA E OPACA, PELO MESMO MOTIVO DE `ImageDisplayAuthorization`
 * ============================================================================
 * `MediaPromotionAuthorization` carrega um campo privado de marca. Sem ele, um
 * chamador escreveria `promote(ids, { authorized: true, ... })` e o gate viraria
 * comentario. Quem quiser uma autorizacao tem de pedi-la a
 * `authorizeMediaPromotion`, que exige as linhas de licenca.
 *
 * ============================================================================
 * O STATUS QUE VAI PARA A LINHA E DERIVADO, NUNCA LITERAL
 * ============================================================================
 * A promocao grava `license_status` na linha promovida. O valor gravado e o da
 * LICENCA VIGENTE — nao um `'official'` escrito a mao. Assim a linha nunca pode
 * afirmar mais do que a fonte concede: se a licenca cair para `third_party`
 * amanha, a proxima promocao grava `third_party`, e nao ha caminho pelo qual um
 * literal otimista entre no banco.
 *
 * PURO: sem rede, sem Prisma, sem relogio. Quem le `source_licenses` e o adapter
 * em `../persistence/media-promotion-store.ts`; este modulo so DECIDE.
 */

import {
  BLOCKING_LICENSE_STATUS,
  GOVERNED_SOURCE_KEY,
  LICENSE_CONTENT_TYPE_BY_TARGET,
  PERSON_GALLERY_ACCEPTED_STATUS,
  type PromotionTarget,
} from './types.js'

/** A linha de `source_licenses` de que a decisao depende. Subset minimo. */
export interface MediaLicenseRow {
  readonly sourceKey: string
  readonly contentType: string
  readonly licenseStatus: string
  readonly displayAllowed: boolean
  readonly isCurrent: boolean
  /** So para o relatorio: o operador precisa ver QUAL politica autorizou. */
  readonly policyVersion: string | null
}

/**
 * A autorizacao. Opaca de proposito — ver o cabecalho.
 *
 * `licenseStatus` so vem preenchido quando `authorized`; e o valor que a
 * promocao grava na linha.
 */
export interface MediaPromotionAuthorization {
  readonly authorized: boolean
  /** Por que. SEMPRE preenchido, inclusive quando autoriza. */
  readonly reason: string
  /** O `license_status` a gravar na linha promovida. `null` quando nega. */
  readonly licenseStatus: string | null
  /** Politica vigente que autorizou, para o cabecalho do relatorio. */
  readonly policyVersion: string | null
  /** Impede construcao por literal. Nao carrega informacao. */
  readonly __brand: 'MediaPromotionAuthorization'
}

function deny(reason: string): MediaPromotionAuthorization {
  return {
    authorized: false,
    reason,
    licenseStatus: null,
    policyVersion: null,
    __brand: 'MediaPromotionAuthorization',
  }
}

/**
 * A autorizacao NEGADA, para caminho degradado e teste.
 *
 * Nao ha constante simetrica que autorize, de proposito: ela seria exatamente a
 * porta dos fundos que a marca opaca existe para fechar.
 */
export const MEDIA_PROMOTION_DENIED: MediaPromotionAuthorization = deny(
  'autorizacao nao resolvida (default seguro)',
)

/**
 * Decide se o alvo pode ter linhas promovidas, a partir de `source_licenses`.
 *
 * FAIL-CLOSED em todas as portas. Ausencia de linha NAO autoriza: uma licenca
 * "que ainda nao foi registrada" e, do lado de fora, indistinguivel de uma
 * negada — e a invariante 6 manda tratar as duas igual.
 *
 * Recebe a LISTA (nao uma linha) porque `source_licenses` guarda historico
 * imutavel: cada reavaliacao insere linha nova e `is_current` marca a vigente.
 * So a vigente decide; as superadas ficam para auditoria.
 */
export function authorizeMediaPromotion(
  target: PromotionTarget,
  rows: readonly MediaLicenseRow[],
): MediaPromotionAuthorization {
  const contentType = LICENSE_CONTENT_TYPE_BY_TARGET[target]

  const vigente = rows.find(
    (row) =>
      row.isCurrent &&
      row.sourceKey === GOVERNED_SOURCE_KEY &&
      row.contentType === contentType,
  )

  if (vigente === undefined) {
    return deny(
      `sem licenca vigente de ${GOVERNED_SOURCE_KEY}/${contentType} em source_licenses ` +
        `(rode "pnpm legal sources review" e, se for o caso, "apply")`,
    )
  }
  if (BLOCKING_LICENSE_STATUS.includes(vigente.licenseStatus)) {
    return deny(
      `license_status = "${vigente.licenseStatus}" na licenca vigente de ` +
        `${GOVERNED_SOURCE_KEY}/${contentType} (invariante 6)`,
    )
  }
  if (!vigente.displayAllowed) {
    return deny(
      `display_allowed = false na licenca vigente de ${GOVERNED_SOURCE_KEY}/${contentType}`,
    )
  }

  // ============ O ESTREITAMENTO ESPECIFICO DA GALERIA DE PESSOA ============
  //
  // `person-page.ts:375` consulta com `licenseStatus: { in: [official, licensed] }`
  // — `in`, nao `notIn`. Um `third_party` passaria na invariante 6 e mesmo assim
  // seria descartado pela tela, em silencio. Promover nesse estado gravaria 490
  // linhas acesas no banco e uma galeria vazia na pagina, e o proximo a
  // investigar comecaria pela coluna certa lendo o valor certo.
  //
  // Recusar aqui e mais barato que essa investigacao.
  if (
    target === 'person-photo' &&
    !PERSON_GALLERY_ACCEPTED_STATUS.includes(vigente.licenseStatus)
  ) {
    return deny(
      `a licenca vigente de ${GOVERNED_SOURCE_KEY}/${contentType} tem license_status ` +
        `"${vigente.licenseStatus}", e a galeria de pessoa so aceita ` +
        `${PERSON_GALLERY_ACCEPTED_STATUS.join('/')} (person-page.ts). ` +
        `Promover neste estado acenderia linhas que a tela descarta.`,
    )
  }

  return {
    authorized: true,
    reason:
      `licenca vigente de ${GOVERNED_SOURCE_KEY}/${contentType} com display_allowed ` +
      `e license_status "${vigente.licenseStatus}"`,
    licenseStatus: vigente.licenseStatus,
    policyVersion: vigente.policyVersion,
    __brand: 'MediaPromotionAuthorization',
  }
}
