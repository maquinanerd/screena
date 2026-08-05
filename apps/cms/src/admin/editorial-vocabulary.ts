/**
 * editorial-vocabulary.ts — A traducao da governanca para a lingua da redacao.
 * PURO: sem React, sem rede, sem Payload.
 *
 * O servidor fala em codigo (`qa_not_passed`, `ready_to_publish`) porque codigo
 * e estavel, comparavel e nao depende de locale. A redacao fala em portugues.
 * Este modulo e a fronteira entre os dois — e ele mora do lado da INTERFACE,
 * nunca do lado da regra: mudar uma frase aqui nao pode mudar o que publica.
 *
 * REGRA DE DERIVACAO: as transicoes possiveis NAO sao copiadas de
 * `workflow.ts`. Elas sao descobertas perguntando a `canTransition`, que e a
 * fonte unica. Copiar a allowlist criaria uma segunda verdade que envelheceria
 * em silencio — a barra ofereceria um botao que o servidor recusa, ou esconderia
 * um caminho que existe.
 */

import {
  canTransition,
  EDITORIAL_ROLES,
  WORKFLOW_STATUSES,
  type ActorKind,
  type EditorialRole,
  type PublishBlockReason,
  type WorkflowStatus,
} from '../workflow.js'

/* ------------------------------------------------------------------ */
/* Estados                                                             */
/* ------------------------------------------------------------------ */

/** Nome do estado como a redacao o chama. */
export const STATUS_LABELS: Readonly<Record<WorkflowStatus, string>> = {
  automation_draft: 'Rascunho da automação',
  draft: 'Rascunho',
  needs_review: 'Aguardando revisão',
  in_review: 'Em revisão',
  changes_requested: 'Mudanças solicitadas',
  human_reviewed: 'Revisada',
  ready_to_publish: 'Pronta para publicar',
  published: 'Publicada',
  needs_update: 'Precisa de atualização',
  blocked: 'Bloqueada',
  archived: 'Arquivada',
  retracted: 'Retratada',
}

/** Uma linha sobre o que o estado significa, para quem chegou agora. */
export const STATUS_HINTS: Readonly<Record<WorkflowStatus, string>> = {
  automation_draft: 'Chegou do pipeline externo e ainda não foi assumida por uma pessoa.',
  draft: 'Em escrita. Ninguém fora da redação vê.',
  needs_review: 'Na fila de revisão, esperando alguém assumir.',
  in_review: 'Alguém está revisando agora.',
  changes_requested: 'A revisão pediu ajustes antes de seguir.',
  human_reviewed: 'Revisada por uma pessoa. Falta liberar para publicação.',
  ready_to_publish: 'Liberada. É daqui que a publicação acontece.',
  published: 'No ar. O site já foi avisado.',
  needs_update: 'Publicada, com atualização pendente.',
  blocked: 'Retirada do fluxo. Volta pela revisão.',
  archived: 'Fora do fluxo de publicação.',
  retracted: 'Retirada do ar por decisão editorial.',
}

/** O tom visual do estado — usado so para cor/ícone, nunca para decisão. */
export type StatusTone = 'neutral' | 'progress' | 'review' | 'ready' | 'live' | 'halted'

export const STATUS_TONES: Readonly<Record<WorkflowStatus, StatusTone>> = {
  automation_draft: 'neutral',
  draft: 'neutral',
  needs_review: 'progress',
  in_review: 'review',
  changes_requested: 'halted',
  human_reviewed: 'review',
  ready_to_publish: 'ready',
  published: 'live',
  needs_update: 'progress',
  blocked: 'halted',
  archived: 'halted',
  retracted: 'halted',
}

/* ------------------------------------------------------------------ */
/* Transicoes                                                          */
/* ------------------------------------------------------------------ */

/**
 * Rotulo do BOTAO, que e diferente do nome do estado.
 *
 * "Aguardando revisão" descreve onde a matéria está; "Enviar para revisão"
 * descreve o que o clique faz. Botao nomeado com substantivo obriga o leitor a
 * traduzir sozinho.
 */
export const TRANSITION_LABELS: Readonly<Record<WorkflowStatus, string>> = {
  automation_draft: 'Devolver para a automação',
  draft: 'Voltar para rascunho',
  needs_review: 'Enviar para revisão',
  in_review: 'Assumir a revisão',
  changes_requested: 'Solicitar mudanças',
  human_reviewed: 'Aprovar revisão',
  ready_to_publish: 'Liberar para publicação',
  published: 'Publicar',
  needs_update: 'Marcar para atualização',
  blocked: 'Bloquear',
  archived: 'Arquivar',
  retracted: 'Retratar',
}

/**
 * Peso da acao na interface.
 *
 * `danger` nao e enfeite: tirar do ar e retratar sao decisoes que a barra
 * precisa apresentar com atrito visual, para nao serem clicadas por engano ao
 * lado de "Publicar".
 */
export type TransitionWeight = 'primary' | 'secondary' | 'danger'

export const TRANSITION_WEIGHTS: Readonly<Record<WorkflowStatus, TransitionWeight>> = {
  automation_draft: 'secondary',
  draft: 'secondary',
  needs_review: 'primary',
  in_review: 'primary',
  changes_requested: 'secondary',
  human_reviewed: 'primary',
  ready_to_publish: 'primary',
  published: 'primary',
  needs_update: 'secondary',
  blocked: 'danger',
  archived: 'danger',
  retracted: 'danger',
}

/** Papeis humanos como a redacao os chama (para "aguardando ..."). */
export const ROLE_LABELS: Readonly<Record<EditorialRole, string>> = {
  administrator: 'administração',
  editor_in_chief: 'editor-chefe',
  editor: 'editor',
  reviewer: 'revisor',
  writer: 'redator',
}

/** Uma transicao oferecida (ou explicada) pela barra. */
export interface TransitionOption {
  readonly to: WorkflowStatus
  readonly label: string
  readonly weight: TransitionWeight
  /** O ator atual pode executar? */
  readonly allowedForActor: boolean
  /**
   * Quem PODE, quando o ator atual nao pode. Vazio significa "ninguem humano" —
   * caso de transicao exclusiva da automacao.
   */
  readonly allowedRoles: readonly EditorialRole[]
}

/**
 * As transicoes que existem a partir de `from`, com quem pode executar cada uma.
 *
 * Descobre por interrogatorio a `canTransition`: para cada destino possivel,
 * pergunta pelo ator atual e, se ele nao puder, pergunta por cada papel humano
 * para saber de quem a redacao esta esperando. Nenhuma tabela e reproduzida.
 */
export function transitionsFrom(
  from: WorkflowStatus,
  actor: ActorKind,
): readonly TransitionOption[] {
  const options: TransitionOption[] = []

  for (const to of WORKFLOW_STATUSES) {
    // Uma transicao "existe" se algum ator humano OU o ator atual a alcanca.
    // Perguntar so pelo ator atual esconderia o caminho que ele nao pode
    // percorrer — e e justamente esse que a barra precisa explicar.
    const allowedForActor = canTransition(from, to, actor).allowed
    const allowedRoles = EDITORIAL_ROLES.filter((role) => canTransition(from, to, role).allowed)

    if (!allowedForActor && allowedRoles.length === 0) continue

    options.push({
      to,
      label: TRANSITION_LABELS[to],
      weight: TRANSITION_WEIGHTS[to],
      allowedForActor,
      allowedRoles,
    })
  }

  // Ordem de leitura: o que faz a materia AVANCAR primeiro, o que a retira por
  // ultimo. Sem isto, "Arquivar" pode aparecer antes de "Publicar".
  const rank: Record<TransitionWeight, number> = { primary: 0, secondary: 1, danger: 2 }
  return options.sort((a, b) => rank[a.weight] - rank[b.weight])
}

/**
 * Quem pode levar uma materia a `published`.
 *
 * DERIVADO, nunca escrito a mao: sai da mesma allowlist que o servidor usa. Uma
 * lista literal aqui viraria segunda verdade e sobreviveria calada a uma mudanca
 * de governanca — a tela diria "exige editor-chefe" depois de o editor-chefe
 * deixar de publicar.
 */
export const PUBLISHER_ROLES: readonly EditorialRole[] =
  transitionsFrom('ready_to_publish', 'administrator').find((option) => option.to === 'published')
    ?.allowedRoles ?? []

/**
 * O que dizer quando o botao "Publicar" avancou a materia mas NAO publicou.
 *
 * Sem esta frase o defeito e mudo: a pessoa aperta "Publicar", a materia sobe
 * dois ou tres degraus, nada na tela anuncia o que houve, e ela aperta de novo.
 *
 * Duas regras de redacao aqui, as duas deliberadas:
 *  - NADA de nome de estado cru. "ready_to_publish" e vocabulario de banco;
 *    quem le e a redacao, e `STATUS_LABELS` ja tem o rotulo em portugues.
 *  - Dizer o que FALTA, nao so o que aconteceu. "Avancou ate X" sozinho deixa a
 *    pessoa sem saber o proximo passo; o papel que publica e a informacao que
 *    resolve.
 */
export function partialAdvanceMessage(
  stoppedAt: WorkflowStatus,
  publisherRoles: readonly EditorialRole[],
): string {
  const reached = `A matéria avançou até "${STATUS_LABELS[stoppedAt]}".`
  if (publisherRoles.length === 0) return `${reached} Publicar depende da automação.`
  const names = publisherRoles.map((role) => ROLE_LABELS[role])
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}`
  return `${reached} Publicar exige ${who}.`
}

/** Frase de espera: "aguardando editor-chefe". */
export function waitingForLabel(roles: readonly EditorialRole[]): string {
  if (roles.length === 0) return 'somente a automação alcança este estado'
  const names = roles.map((role) => ROLE_LABELS[role])
  if (names.length === 1) return `aguardando ${names[0]}`
  const last = names[names.length - 1]
  return `aguardando ${names.slice(0, -1).join(', ')} ou ${last}`
}

/* ------------------------------------------------------------------ */
/* Gate de publicacao                                                  */
/* ------------------------------------------------------------------ */

/**
 * Abas do formulario de `articles`, pelo rotulo exato que aparece na interface.
 *
 * As abas sao SEM NOME de proposito (aba nomeada aninharia o caminho de
 * armazenamento e exigiria migration), entao nao ha id nem rota para linkar:
 * o rotulo e a unica ancora estavel que a UI tem.
 */
export const ARTICLE_TABS = {
  content: 'Conteudo',
  media: 'Midia',
  authorship: 'Autoria',
  seo: 'SEO',
  entities: 'Entidades',
  sourcesQa: 'Fontes e QA',
  publication: 'Publicacao',
  automation: 'Automacao (auditoria)',
} as const

export type ArticleTabLabel = (typeof ARTICLE_TABS)[keyof typeof ARTICLE_TABS]

export interface PublishBlockExplanation {
  /** O que falta, em portugues, na voz de quem resolve. */
  readonly message: string
  /** Onde se resolve. */
  readonly tab: ArticleTabLabel
}

/**
 * Os 10 motivos de bloqueio, traduzidos.
 *
 * O tipo `Record<PublishBlockReason, ...>` e a trava: se `workflow.ts` ganhar um
 * motivo novo, o TypeScript recusa este arquivo ate alguem escrever a frase.
 * Um motivo sem traducao viraria um bloqueio invisivel na tela.
 */
export const PUBLISH_BLOCK_EXPLANATIONS: Readonly<
  Record<PublishBlockReason, PublishBlockExplanation>
> = {
  not_ready_to_publish: {
    message: 'A matéria precisa estar em "pronta para publicar".',
    tab: ARTICLE_TABS.publication,
  },
  missing_slug: {
    message: 'Falta o slug — é ele que vira o endereço da matéria no site.',
    tab: ARTICLE_TABS.content,
  },
  missing_title: {
    message: 'Falta o título.',
    tab: ARTICLE_TABS.content,
  },
  missing_language: {
    message: 'Falta o idioma.',
    tab: ARTICLE_TABS.content,
  },
  missing_active_author: {
    message: 'Nenhum autor ativo vinculado — a matéria precisa de assinatura pública.',
    tab: ARTICLE_TABS.authorship,
  },
  qa_not_passed: {
    message: 'O QA ainda não foi aprovado.',
    tab: ARTICLE_TABS.sourcesQa,
  },
  has_blocking_errors: {
    message: 'Há erros bloqueantes registrados que precisam ser resolvidos.',
    tab: ARTICLE_TABS.sourcesQa,
  },
  ai_assisted_without_sources: {
    message: 'Conteúdo assistido por IA exige pelo menos uma fonte externa declarada.',
    tab: ARTICLE_TABS.sourcesQa,
  },
  unauthorized_media: {
    message: 'Há mídia sem licença aprovada para este uso (capa, corpo ou galeria).',
    tab: ARTICLE_TABS.media,
  },
  legal_hold: {
    message: 'A matéria está sob retenção jurídica.',
    tab: ARTICLE_TABS.publication,
  },
}

/* ------------------------------------------------------------------ */
/* Licenca de midia                                                    */
/* ------------------------------------------------------------------ */

/**
 * Os seis estados de `media.licenseStatus`.
 *
 * `unknown` e o DEFAULT — midia recem-enviada nasce sem permissao nenhuma
 * (`collections.ts`). Isso e correto e nao muda; o que muda e a midia passar a
 * dizer isso na tela, em vez de o redator descobrir no 403 da publicacao.
 */
export const MEDIA_LICENSE_LABELS: Readonly<Record<string, string>> = {
  unknown: 'sem licença definida',
  pending: 'licença em análise',
  approved: 'licença aprovada',
  restricted: 'uso restrito',
  expired: 'licença expirada',
  prohibited: 'uso proibido',
}

export function mediaLicenseLabel(status: string): string {
  return MEDIA_LICENSE_LABELS[status] ?? `estado desconhecido (${status})`
}

/**
 * A frase que explica por que ESTA midia nao publica.
 *
 * Duas causas independentes, e a diferenca importa: licença nao aprovada e
 * decisao juridica; permissao de uso desmarcada e decisao editorial. Colapsar as
 * duas mandaria a pessoa para o lugar errado.
 */
export function mediaBlockReason(input: {
  readonly licenseStatus: string
  readonly allowedForEditorial: boolean
  readonly allowedForHero: boolean
  readonly usedAsHero: boolean
}): string | null {
  if (input.licenseStatus !== 'approved') {
    return `${mediaLicenseLabel(input.licenseStatus)} — precisa ser aprovada`
  }
  if (!input.allowedForEditorial) return 'licença aprovada, mas sem permissão de uso editorial'
  if (input.usedAsHero && !input.allowedForHero) {
    return 'liberada para o corpo da matéria, mas não para capa'
  }
  return null
}

/**
 * Traduz a mensagem CRUA do servidor.
 *
 * O hook recusa com `publicacao bloqueada: qa_not_passed, missing_active_author`
 * (`hooks/articles.ts`). Quando a barra erra a previsao — o servidor decide
 * sobre o estado REAL do banco, a barra sobre o que o formulario carrega —, e
 * esta funcao que impede o codigo cru de chegar aos olhos do redator.
 *
 * Devolve `null` quando a mensagem nao e do gate: inventar uma traducao para um
 * erro desconhecido esconderia a causa real.
 */
export function explainServerRejection(
  raw: string,
): readonly PublishBlockExplanation[] | null {
  const marker = 'publicacao bloqueada:'
  const at = raw.toLowerCase().indexOf(marker)
  if (at < 0) return null

  const codes = raw
    .slice(at + marker.length)
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code !== '')

  const explanations = codes
    .filter((code): code is PublishBlockReason => code in PUBLISH_BLOCK_EXPLANATIONS)
    .map((code) => PUBLISH_BLOCK_EXPLANATIONS[code])

  return explanations.length > 0 ? explanations : null
}
