/**
 * hero-link.ts — NUCLEO PURO de "aponte a capa desta materia para esta foto".
 *
 * POR QUE ESTA ROTA EXISTE, E POR QUE SEPARADA.
 *
 * O caminho automatico tinha um no de ordem: `POST /internal/editorial-media`
 * exige `articleId`, que so existe DEPOIS da materia criada; mas
 * `media[].mediaId` do contrato de publicacao precisa existir NO MOMENTO do
 * envio do rascunho. Quem entrega texto e foto em duas chamadas nunca consegue
 * as duas coisas na mesma rodada — e o log de producao registrou exatamente
 * isso: "mediaId=14 obtido para article_id=19, mas a capa NAO foi apontada".
 *
 * Reenviar a materia inteira so para apontar a capa nao resolve: bate em
 * `staleRevision` (a revisao nao mudou), reescreve `workflowStatus` e consome
 * cota de `article_update`. Apontar a capa e um ato de MIDIA, nao uma revisao
 * editorial — e por isso ele sai do eixo de revisao.
 *
 * O QUE ELA NAO FAZ, e o motivo de cada limite:
 *
 *  - **nao mexe em `workflowStatus`.** O `setAsHero` da rota de ingestao foi
 *    removido no PR #136 por causa do hook de governanca (`hooks/articles.ts`),
 *    que FORCA `automation_draft` para toda service account sem
 *    `editorial_auto_publish`.
 *
 *    A PRIMEIRA VERSAO DESTA ROTA (PR #139) tratou isso exigindo que a materia
 *    JA ESTIVESSE em `automation_draft`. Medido em producao (materia 23, midia
 *    18): `409 article_not_automation_draft` — a rota era INALCANCAVEL pelo
 *    caminho real. `editorial-publications.ts` cria a materia em
 *    `automation_draft` e, na mesma chamada, caminha por
 *    `ready_to_publish`/`published` (ou `needs_review`) ANTES de a resposta com
 *    o `articleId` sair. Quando o emissor tem o id para chamar esta rota, a
 *    materia ja saiu do unico estado que ela aceitava — nos DOIS desfechos.
 *
 *    A trava de ESTADO era um proxy para a pergunta que importa: **esta materia
 *    e de origem automacao?** O proxy foi trocado pela coisa. Hoje a rota exige
 *    PROVENIENCIA (`automationOrigin`, derivada dos campos que
 *    `HUMAN_FORBIDDEN_FIELDS` impede qualquer pessoa de escrever), e o hook
 *    ganhou uma excecao ESTREITA para escrita que so toca `heroMedia` vinda do
 *    escopo `editorial_media_ingest`: nessa excecao ele NAO forca
 *    `workflowStatus` nem `_status` — preserva os dois valores anteriores.
 *
 *    Por que isso nao reabre o PR #136. Aquele defeito era um REBAIXAMENTO
 *    silencioso: a escrita acontecia e a materia descia de estado. Aqui nao ha
 *    degrau para descer porque nao ha escrita de estado nenhuma — o hook
 *    reescreve `workflowStatus` com o valor que ja estava gravado. O que
 *    protegia a decisao humana nunca foi o estado: e a PROVENIENCIA DA CAPA
 *    ATUAL (`hero_not_owned_by_automation`, mais abaixo), e essa continua
 *    intacta.
 *
 *  - **nao consome cota.** Cota de autopublicacao conta materia publicada e
 *    materia atualizada. Apontar capa nao e nenhuma das duas, e gastar teto aqui
 *    faria o pipeline perder o dia por causa de uma foto.
 *
 *  - **nao passa por `sourceRevision`.** A capa nao tem revisao propria; ela
 *    aponta para uma foto que ja esta no acervo.
 *
 *  - **nao aceita foto de outra materia.** A foto tem de ter sido ingerida PARA
 *    aquele artigo (`media.ingestedForArticle`). Sem isso, o `mediaId` viraria
 *    escrita arbitraria: bastaria enumerar ids para pendurar qualquer imagem do
 *    acervo em qualquer materia.
 *
 *  - **nao troca capa escolhida por gente.** Se a capa atual nao e uma foto
 *    ingerida por maquina para aquela materia, ela veio de um humano (painel) ou
 *    do contrato de rascunho — e a rota recusa. Mesma regra dos vinculos de
 *    entidade: decisao humana nao e reescrita por automacao.
 */

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

export interface HeroLinkAuth {
  readonly authenticated: boolean
  /** `editorial_media_ingest` — o MESMO escopo da ingestao de bytes. */
  readonly hasMediaIngestScope: boolean
}

/** O que o pedido pede, ja normalizado. */
export interface HeroLinkCommand {
  readonly mediaId: string
  readonly articleId: string
}

export type HeroLinkRejectionCode =
  | 'unauthenticated'
  | 'forbidden_scope'
  | 'invalid_json'
  | 'validation_failed'
  | 'media_not_found'
  | 'article_not_found'
  | 'media_not_ingested_for_article'
  | 'media_not_hero_eligible'
  | 'article_not_automation_origin'
  | 'article_withdrawn'
  | 'hero_not_owned_by_automation'

export interface HeroLinkRejection {
  readonly code: HeroLinkRejectionCode
  readonly status: number
  readonly issues: readonly string[]
}

export type HeroLinkIntake =
  | { readonly ok: true; readonly command: HeroLinkCommand }
  | { readonly ok: false; readonly rejection: HeroLinkRejection }

function reject(
  code: HeroLinkRejectionCode,
  status: number,
  issues: readonly string[] = [],
): { readonly ok: false; readonly rejection: HeroLinkRejection } {
  return { ok: false, rejection: { code, status, issues } }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Teto do corpo. Sao dois campos numericos; nao ha texto aqui. */
export const MAX_HERO_LINK_REQUEST_BYTES = 4 * 1024

/**
 * Forma do id do Payload no PostgreSQL: inteiro positivo, sem zero a esquerda.
 *
 * Recusar pela FORMA, e antes de consultar, nao e preciosismo: `findByID` com
 * lixo levanta erro de driver, e erro de driver carrega detalhe de banco na
 * resposta.
 */
const PAYLOAD_ID = /^[1-9][0-9]*$/

/**
 * Identidade + forma. Nao toca no banco.
 *
 * `mediaId` vem do CAMINHO e `articleId` do CORPO, e a assimetria e deliberada:
 * a foto e o recurso que esta sendo alterado (por isso vive na URL), e a materia
 * e a afirmacao que sera CONFERIDA contra `media.ingestedForArticle`. Aceitar a
 * materia pela URL tambem funcionaria; aceitar a foto pelo corpo faria a URL
 * deixar de identificar o recurso.
 */
export function intakeHeroLink(input: {
  readonly auth: HeroLinkAuth
  readonly rawBodyBytes: number
  readonly mediaIdParam: unknown
  readonly body: unknown
}): HeroLinkIntake {
  const { auth } = input

  // 401 e "quem e voce?"; 403 e "sei quem voce e, e voce nao pode". Colapsar os
  // dois faria alguem regerar uma chave que estava certa o tempo todo.
  if (!auth.authenticated) return reject('unauthenticated', 401)
  if (!auth.hasMediaIngestScope) return reject('forbidden_scope', 403)

  if (input.rawBodyBytes > MAX_HERO_LINK_REQUEST_BYTES) {
    return reject('validation_failed', 413, [
      `corpo com ${String(input.rawBodyBytes)} bytes; teto ${String(MAX_HERO_LINK_REQUEST_BYTES)}`,
    ])
  }

  if (input.body === null || typeof input.body !== 'object' || Array.isArray(input.body)) {
    return reject('invalid_json', 400, ['corpo precisa ser um objeto JSON'])
  }

  const issues: string[] = []

  const mediaId = text(input.mediaIdParam)
  if (mediaId === null) issues.push('mediaId ausente no caminho')
  else if (!PAYLOAD_ID.test(mediaId)) issues.push('mediaId precisa ser um id numerico')

  const articleId = text((input.body as Record<string, unknown>).articleId)
  if (articleId === null) issues.push('articleId ausente')
  else if (!PAYLOAD_ID.test(articleId)) issues.push('articleId precisa ser um id numerico')

  if (issues.length > 0) return reject('validation_failed', 422, issues)

  return { ok: true, command: { mediaId: mediaId as string, articleId: articleId as string } }
}

/* ------------------------------------------------------------------ */
/* Decisao                                                             */
/* ------------------------------------------------------------------ */

/** O que o CMS sabe da foto que o pedido quer promover a capa. */
export interface HeroLinkMediaFacts {
  readonly exists: boolean
  /** `media.ingestedForArticle`, como texto. `null` quando a foto e de humano. */
  readonly ingestedForArticleId: string | null
  /** `licenseStatus === 'approved'` E `allowedForEditorial`. */
  readonly licenseApproved: boolean
  readonly allowedForHero: boolean
}

/** O que o CMS sabe da materia — e da capa que ela ja tem. */
export interface HeroLinkArticleFacts {
  readonly exists: boolean
  readonly workflowStatus: string | null
  /**
   * A materia veio do pipeline?
   *
   * NAO e "esta em automation_draft" — esse era o proxy que tornou a rota
   * inalcancavel. E a presenca de pelo menos uma marca de automacao no
   * documento: `sourceClusterId`, `automationDraftId` ou `automationActorId`.
   *
   * As tres estao em `HUMAN_FORBIDDEN_FIELDS` (`access.ts`), e o hook de
   * governanca as REMOVE de todo payload humano. Ou seja: nenhuma pessoa
   * consegue marcar uma materia propria como sendo de automacao, nem apagar a
   * marca de uma que e. E por isso que a proveniencia serve de gate e o estado
   * do fluxo editorial nao servia — o estado muda o tempo todo, por desenho.
   *
   * As tres, e nao uma: os dois intakes gravam conjuntos diferentes.
   * `editorial-drafts` grava `automationDraftId` + `sourceClusterId`;
   * `editorial-publications` grava `automationActorId` + `sourceClusterId`.
   */
  readonly automationOrigin: boolean
  /** Capa atual, como texto. `null` quando a materia ainda nao tem capa. */
  readonly currentHeroMediaId: string | null
  /**
   * `ingestedForArticle` da capa ATUAL.
   *
   * E o que distingue "a maquina pos esta capa" de "alguem escolheu esta capa".
   * `null` cobre os dois casos em que a rota nao pode sobrescrever: nao ha capa
   * (e ai nem se pergunta) ou a capa veio de fora da ingestao por maquina.
   */
  readonly currentHeroIngestedForArticleId: string | null
}

export type HeroLinkOutcome =
  /** Materia nao tinha capa; agora tem. */
  | 'linked'
  /** Ja era esta capa. Nenhuma escrita. */
  | 'unchanged'
  /** Tinha OUTRA capa, tambem ingerida por maquina para esta materia. */
  | 'replaced'

export type HeroLinkDecision =
  | { readonly ok: true; readonly outcome: HeroLinkOutcome }
  | { readonly ok: false; readonly rejection: HeroLinkRejection }

/**
 * Estados em que a materia SAIU de circulacao, e nos quais a automacao nao
 * toca mesmo tendo posto a foto no acervo.
 *
 * Uma DENYLIST curta, e nao a antiga allowlist de um valor so. A diferenca nao
 * e estilo: a allowlist descrevia "onde a automacao ainda manda", e essa
 * pergunta e respondida pela proveniencia; esta lista descreve "o que ja foi
 * decidido tirar do ar", que e uma decisao humana registrada NO ESTADO. Trocar
 * a capa de uma materia retratada nao tem desfecho util — no melhor caso nao
 * muda nada, no pior mexe num documento que a redacao removeu de proposito.
 *
 * Um estado NOVO na maquina de estados nasce fora desta lista, ou seja,
 * PERMITIDO. E o certo aqui: a guarda de verdade e a proveniencia da materia e
 * a da capa atual, e um estado novo nao diz nada sobre nenhuma das duas.
 */
export const HERO_LINK_WITHDRAWN_WORKFLOW_STATUSES: readonly string[] = [
  'retracted',
  'blocked',
  'archived',
]

/**
 * Esta foto pode virar a capa desta materia?
 *
 * A ORDEM das recusas e escolhida para que a mensagem aponte a causa mais
 * corrigivel primeiro: existencia -> pertencimento -> licenca -> proveniencia
 * da materia -> materia fora de circulacao -> proveniencia da capa atual. Um
 * emissor que recebe "a materia nao e de automacao" sabe que o `mediaId` estava
 * certo.
 */
export function decideHeroLink(input: {
  readonly command: HeroLinkCommand
  readonly media: HeroLinkMediaFacts
  readonly article: HeroLinkArticleFacts
}): HeroLinkDecision {
  const { command, media, article } = input

  if (!media.exists) {
    return reject('media_not_found', 404, [`midia ${command.mediaId} nao existe`])
  }
  if (!article.exists) {
    return reject('article_not_found', 404, [`materia ${command.articleId} nao existe`])
  }

  // PERTENCIMENTO. Sem esta checagem o `mediaId` seria escrita arbitraria:
  // bastaria enumerar ids para pendurar qualquer imagem do acervo em qualquer
  // materia — inclusive uma foto licenciada so para outra pauta.
  if (media.ingestedForArticleId !== command.articleId) {
    return reject('media_not_ingested_for_article', 409, [
      media.ingestedForArticleId === null
        ? `a midia ${command.mediaId} nao foi ingerida por maquina para materia nenhuma`
        : `a midia ${command.mediaId} foi ingerida para a materia ${media.ingestedForArticleId}, nao para ${command.articleId}`,
    ])
  }

  // LICENCA POR FINALIDADE (invariante 6). A midia ingerida por esta rota nasce
  // com as duas flags ligadas, entao na pratica isto so dispara depois de um
  // humano revogar a permissao no painel — que e exatamente quando a recusa
  // importa. Fail-closed: verificar de novo custa uma leitura que ja foi feita.
  if (!media.licenseApproved || !media.allowedForHero) {
    return reject('media_not_hero_eligible', 409, [
      !media.licenseApproved
        ? `a midia ${command.mediaId} nao tem licenca editorial aprovada`
        : `a midia ${command.mediaId} nao tem allowedForHero`,
    ])
  }

  // PROVENIENCIA DA MATERIA — a pergunta que a trava de estado so aproximava.
  //
  // Materia escrita por gente nao recebe capa de robo, nem quando ela ainda nao
  // tem capa nenhuma: o acervo e compartilhado, e sem esta linha bastaria
  // ingerir uma foto "para" uma pauta humana para pendurar a capa nela.
  //
  // Diferente do estado, isto NAO muda ao longo da vida da materia — e por isso
  // e um gate honesto. As marcas sao human-forbidden: ninguem consegue forjar
  // nem apagar.
  if (!article.automationOrigin) {
    return reject('article_not_automation_origin', 409, [
      `a materia ${command.articleId} nao carrega marca de origem de automacao; capa de materia humana e decisao humana`,
    ])
  }

  // MATERIA FORA DE CIRCULACAO. Retratada, bloqueada ou arquivada e uma decisao
  // humana de tirar do ar; trocar a capa dela nao tem desfecho util.
  const status = article.workflowStatus ?? ''
  if (HERO_LINK_WITHDRAWN_WORKFLOW_STATUSES.includes(status)) {
    return reject('article_withdrawn', 409, [
      `a materia ${command.articleId} esta em "${status}"; capa por maquina nao entra em materia fora de circulacao`,
    ])
  }

  // IDEMPOTENCIA. Antes da proveniencia de proposito: reenviar o MESMO pedido
  // nunca pode virar recusa, e a capa atual e, por definicao, a que o pedido
  // anterior gravou.
  if (article.currentHeroMediaId === command.mediaId) {
    return { ok: true, outcome: 'unchanged' }
  }

  if (article.currentHeroMediaId === null) {
    return { ok: true, outcome: 'linked' }
  }

  // CAPA DE GENTE NAO E REESCRITA POR ROBO. A capa atual so pode ser trocada se
  // ela propria veio da ingestao por maquina PARA ESTA materia. Qualquer outra
  // origem (painel, contrato de rascunho, outra pauta) carrega escolha que a
  // automacao nao tomou — e a mesma regra dos vinculos de entidade.
  if (article.currentHeroIngestedForArticleId !== command.articleId) {
    return reject('hero_not_owned_by_automation', 409, [
      `a materia ${command.articleId} ja tem capa (midia ${article.currentHeroMediaId}) que nao veio da ingestao por maquina desta materia; trocar e decisao humana`,
    ])
  }

  return { ok: true, outcome: 'replaced' }
}
