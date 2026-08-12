/**
 * display-authorization.ts — A politica PURA de "esta linha pode nascer exibivel?".
 *
 * Existe porque o gate de exibicao NUNCA foi um booleano. O banco tem um trigger
 * permanente (`external_ratings_display_guard_trg` / `watch_availability_display_guard`)
 * que exige, alem de `display_allowed`, uma tupla inteira: licenca vigente que
 * permita exibir, permissao de numero quando ha numero, atribuicao e linkback
 * preenchidos quando a licenca os exige, decisao de uso vigente, natureza
 * editorial classificada e `approved_payload_hash` batendo com o payload.
 *
 * Este modulo decide se VALE A PENA TENTAR exibir, e explica o motivo quando
 * nao vale. Ele NAO concede nada:
 *
 *   1. AQUI (puro)     — decide e DIAGNOSTICA, antes de gastar um write.
 *   2. SQL do adapter  — escreve a tupla; o hash sai de uma funcao DO BANCO,
 *                        nunca reimplementada em TS (divergencia entre as duas
 *                        implementacoes seria uma aprovacao que nao corresponde
 *                        ao dado).
 *   3. TRIGGER         — a trava real, que vale para psql, script e seed.
 *
 * Se a camada 1 discordar do trigger, o trigger vence e a escrita falha — nunca
 * o contrario. Por isso a camada 1 pode ser generosa sem ser perigosa: o pior
 * caso de um "sim" errado aqui e um erro barulhento do banco, nao um dado
 * exibido sem licenca.
 *
 * Invariante 6 (sem licenca clara nao aparece) e a razao de existir do arquivo.
 */

/** `license_status` que permitem exibicao. Espelha os dois triggers. */
const DISPLAYABLE_LICENSE_STATUS: readonly string[] = ['official', 'licensed', 'third_party']

/**
 * O que esta sendo exibido. Nao e a licenca — e a natureza do dado.
 */
export interface DisplaySubject {
  /** Fonte editorial (`imdb`) ou provedor canonico (`netflix`). Diagnostico. */
  readonly sourceKey: string
  /**
   * Exibir esta linha implica mostrar um NUMERO? Ratings: sim (a regra de
   * ratings §5 diz que `score_allowed=false` proibe exibir o numero). Ofertas
   * de streaming: nao — elas nomeiam um provedor, nao pontuam nada.
   */
  readonly needsScorePermission: boolean
  /**
   * Natureza editorial ja classificada. Para ratings e `score_type != null`:
   * critics e audience sao metricas DIFERENTES e nunca se misturam
   * (invariante 1). Sem classificar, nao exibe.
   */
  readonly classified: boolean
}

/**
 * O credito resolvido de `source_licenses` + `data_usage_decisions` para a
 * fonte. Vem do banco; este modulo nunca o inventa.
 */
export interface SourceCredit {
  /** `source_licenses.license_status` da licenca VIGENTE. */
  readonly licenseStatus: string
  /** `source_licenses.display_allowed` — a licenca-mae autoriza exibir? */
  readonly licenseDisplayAllowed: boolean
  /** `source_licenses.score_allowed` — autoriza exibir o NUMERO? */
  readonly licenseScoreAllowed: boolean
  /** `source_licenses.requires_attribution`. */
  readonly requiresAttribution: boolean
  /** `source_licenses.requires_linkback`. */
  readonly requiresLinkback: boolean
  /** Texto de credito. `null`/vazio quando nao ha. */
  readonly attributionText: string | null
  /** Link de credito. `null`/vazio quando nao ha. */
  readonly attributionUrl: string | null
  /**
   * `data_usage_decisions.id` da decisao VIGENTE de exibicao para esta fonte,
   * territorio e use case. `null` quando nao ha decisao que autorize exibir.
   */
  readonly usageDecisionId: string | null
}

/** Por que a linha NAO pode nascer exibivel. */
export type DisplayRefusalReason =
  | 'no-license'
  | 'license-not-displayable'
  | 'license-forbids-display'
  | 'license-forbids-score'
  | 'unclassified'
  | 'missing-attribution'
  | 'missing-linkback'
  | 'unsafe-attribution-url'
  | 'no-usage-decision'

/** Decisao + motivo. `reason` e `null` se e somente se `displayAllowed`. */
export interface DisplayResolution {
  readonly displayAllowed: boolean
  readonly reason: DisplayRefusalReason | null
  /** Frase pt-BR para log/relatorio. Nunca cita segredo nem URL inteira. */
  readonly detail: string | null
}

/** Vazio, so-espaco e ausente sao a MESMA coisa: nao ha credito. */
function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

function refuse(reason: DisplayRefusalReason, detail: string): DisplayResolution {
  return { displayAllowed: false, reason, detail }
}

/**
 * Decide se a linha pode nascer `display_allowed = true`.
 *
 * FAIL-CLOSED por construcao: `credit === null` (fonte sem licenca resolvida) e
 * recusa, e todo teste abaixo precisa passar. A ordem e deliberada — integridade
 * da licenca antes do credito, para que o operador leia o motivo mais profundo
 * primeiro em vez de sair atras de um `attribution_text` de uma licenca que nem
 * autoriza exibicao.
 */
export function resolveDisplayAllowed(
  subject: DisplaySubject,
  credit: SourceCredit | null,
): DisplayResolution {
  if (credit === null) {
    return refuse('no-license', `fonte "${subject.sourceKey}" nao tem licenca vigente resolvida`)
  }

  // --- Autoridade da licenca-mae ---

  if (!DISPLAYABLE_LICENSE_STATUS.includes(credit.licenseStatus)) {
    return refuse(
      'license-not-displayable',
      `license_status "${credit.licenseStatus}" nao permite exibicao`,
    )
  }
  if (!credit.licenseDisplayAllowed) {
    return refuse(
      'license-forbids-display',
      `licenca de "${subject.sourceKey}" tem display_allowed=false`,
    )
  }
  if (subject.needsScorePermission && !credit.licenseScoreAllowed) {
    // Exibir uma nota E exibir o numero. Sem `score_allowed`, no maximo o nome
    // da fonte — nunca o valor.
    return refuse(
      'license-forbids-score',
      `licenca de "${subject.sourceKey}" tem score_allowed=false: o numero nao pode aparecer`,
    )
  }

  // --- Natureza editorial ---

  if (!subject.classified) {
    return refuse(
      'unclassified',
      `dado de "${subject.sourceKey}" sem classificacao editorial: critics e audience nunca se misturam`,
    )
  }

  // --- Credito obrigatorio (o coracao da decisao "automatico, COM credito") ---

  if (credit.requiresAttribution && isBlank(credit.attributionText)) {
    return refuse(
      'missing-attribution',
      'licenca exige atribuicao e attribution_text esta vazio',
    )
  }
  if (credit.requiresLinkback && isBlank(credit.attributionUrl)) {
    return refuse('missing-linkback', 'licenca exige linkback e attribution_url esta vazio')
  }
  // URL de credito nao-HTTPS vira conteudo misto numa pagina HTTPS: o link de
  // credito simplesmente nao abre, e o credito deixa de ser credito.
  if (!isBlank(credit.attributionUrl) && !(credit.attributionUrl as string).trim().startsWith('https://')) {
    return refuse('unsafe-attribution-url', 'attribution_url deve ser HTTPS')
  }

  // --- Decisao de uso vigente ---

  if (isBlank(credit.usageDecisionId)) {
    return refuse(
      'no-usage-decision',
      `nao ha decisao de uso vigente autorizando exibir "${subject.sourceKey}"`,
    )
  }

  return { displayAllowed: true, reason: null, detail: null }
}
