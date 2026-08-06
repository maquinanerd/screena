/**
 * editorial-publications.ts — POST /api/internal/editorial-publications.
 *
 * O canal de PUBLICACAO AUTOMATICA. Separado de `/internal/editorial-drafts` de
 * proposito: transformar o endpoint de rascunho num endpoint de publicacao faria
 * um pipeline antigo, que so sabia propor, passar a publicar sem mudar uma linha.
 * Dois caminhos, dois escopos, duas semanticas.
 *
 * A politica vive em `../auto-publication.js`, `../author-automation.js` e
 * `../canonical-slug.js` — puras e testadas sem servidor. Este arquivo COLETA os
 * fatos e EXECUTA a decisao.
 *
 * A publicacao e a criacao do evento na outbox compartilham a transacao do
 * `req`, exatamente como no fluxo humano: ou a materia esta publicada E existe o
 * evento, ou nada aconteceu.
 */

import { commitTransaction, initTransaction, killTransaction } from 'payload'
import type { Endpoint, PayloadRequest } from 'payload'

import {
  checkContractCompatibility,
  parseEditorialPublicationRequestV1,
  type EditorialPublicationRequestV1,
} from '@screena/editorial-contracts'

import { serviceHasScope } from '../access.js'
import { toActor } from '../actor.js'
import {
  authorizeAutomationAuthor,
  type AttributionMode,
  type AuthorAutomationFacts,
} from '../author-automation.js'
import {
  decideAutoPublication,
  outcomeHttpStatus,
  retryAfterSeconds,
  type BodyShapeFacts,
  type PublicationDecision,
  type PublicationOutcome,
} from '../auto-publication.js'
import { canonicalizeSlug, decideSlugChange } from '../canonical-slug.js'
import { resolveAvailableSlug } from '../slug-availability.js'
import {
  toPayloadBlocks,
  type EditorialWarning,
  type MappedBody,
} from '../editorial-body-mapper.js'
import {
  findStrippedBlockMarks,
  planSeoPersistence,
  resolveEntityReferences,
  resolveHeroMedia,
  type EntityReferenceRow,
  type MediaAuthorizationFacts,
} from '../publication-intake.js'
import { localDateIn } from '../quota.js'
import {
  consumeQuotas,
  findPreviousConsumption,
  recordConsumption,
  type QuotaWindow,
} from '../quota-store.js'
import { editorialDayWindowUtc, resolveAutoPublishConfig } from '../env-auto-publish.js'

const MAX_REQUEST_BYTES = 2 * 1024 * 1024

/** Sinal interno para abortar a transacao quando uma quota esgota. */
class QuotaRejectedError extends Error {}

/**
 * O mais restritivo entre dois tetos. `null` = sem teto naquele eixo.
 *
 * Nao e `a ?? b`: quando os dois existem, o menor vence. Um autor que aceita 3
 * publicacoes por dia nao passa a aceitar 50 porque a plataforma permite 50.
 */
function strictestLimit(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  })
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Fatos de forma do corpo, para a coerencia com o Schema.org recomendado. */
function inspectBody(request: EditorialPublicationRequestV1): BodyShapeFacts {
  const blocks = request.blocks as unknown as Record<string, unknown>[]
  return {
    hasSteps: blocks.some((block) => block.type === 'steps' || block.type === 'howto'),
    hasList: blocks.some((block) => block.type === 'list'),
    hasRating: blocks.some((block) => block.type === 'rating' || block.type === 'verdict'),
    blockCount: blocks.length,
  }
}

async function readAuthorFacts(
  req: PayloadRequest,
  authorId: string,
): Promise<AuthorAutomationFacts> {
  const empty: AuthorAutomationFacts = {
    exists: false,
    active: false,
    automationPublishingAllowed: false,
    allowedAutomationContentTypes: [],
    allowedAutomationSections: [],
    automationDailyLimit: null,
    automationAttributionModes: [],
  }
  // O id do Payload e inteiro no Postgres: lixo nunca vira consulta, porque o
  // erro de driver carregaria detalhe de banco na resposta.
  if (!/^\d+$/.test(authorId)) return empty

  try {
    const doc = (await req.payload.findByID({
      collection: 'authors',
      id: authorId,
      depth: 0,
      overrideAccess: true,
      req,
    })) as unknown as Record<string, unknown>

    return {
      exists: true,
      active: doc.active !== false,
      automationPublishingAllowed: doc.automationPublishingAllowed === true,
      allowedAutomationContentTypes: Array.isArray(doc.allowedAutomationContentTypes)
        ? doc.allowedAutomationContentTypes.map(String)
        : [],
      allowedAutomationSections: Array.isArray(doc.allowedAutomationSections)
        ? doc.allowedAutomationSections.map(String)
        : [],
      automationDailyLimit:
        typeof doc.automationDailyLimit === 'number' ? doc.automationDailyLimit : null,
      automationAttributionModes: Array.isArray(doc.automationAttributionModes)
        ? (doc.automationAttributionModes.map(String) as AttributionMode[])
        : [],
    }
  } catch {
    return empty
  }
}

/** Nada se sabe sobre esta midia — e por isso ela nao serve para nada. */
const UNKNOWN_MEDIA: MediaAuthorizationFacts = {
  exists: false,
  licenseApproved: false,
  allowedForHero: false,
}

interface MediaAuthorizationReport {
  /** Midia referenciada que o CMS NAO consegue autorizar (invariante 6). */
  readonly unauthorizedCount: number
  /** Os MESMOS fatos, por id, para quem precisa decidir a capa. */
  readonly authorizations: ReadonlyMap<string, MediaAuthorizationFacts>
}

/**
 * Le a autorizacao de toda midia referenciada — UMA vez.
 *
 * Antes esta funcao so devolvia a contagem, e a contagem so servia ao gate de
 * licenca; os fatos por item eram descartados. Como `intendedUse: 'hero'` agora
 * precisa dos mesmos fatos para decidir a capa, devolver o mapa evita uma
 * segunda consulta que poderia ate discordar da primeira.
 */
async function readMediaAuthorizations(
  req: PayloadRequest,
  request: EditorialPublicationRequestV1,
): Promise<MediaAuthorizationReport> {
  const ids = [...new Set(request.media.map((item) => item.mediaId))]
  if (ids.length === 0) return { unauthorizedCount: 0, authorizations: new Map() }

  /** Fail-closed: nada verificado e nada autorizado. */
  const allUnknown = (): MediaAuthorizationReport => ({
    unauthorizedCount: ids.length,
    authorizations: new Map(ids.map((id) => [id, UNKNOWN_MEDIA])),
  })

  try {
    const found = await req.payload.find({
      collection: 'media',
      where: { id: { in: ids } },
      limit: ids.length,
      depth: 0,
      overrideAccess: true,
      req,
    })
    const authorizations = new Map<string, MediaAuthorizationFacts>()
    let unauthorized = 0
    const seen = new Set<string>()
    for (const media of found.docs) {
      const id = String(media.id)
      seen.add(id)
      const approved =
        media.licenseStatus === 'approved' && (media as { allowedForEditorial?: unknown }).allowedForEditorial === true
      const allowedForHero = (media as { allowedForHero?: unknown }).allowedForHero === true
      authorizations.set(id, { exists: true, licenseApproved: approved, allowedForHero })
      const heroOk =
        !request.media.some((item) => item.mediaId === id && item.intendedUse === 'hero') ||
        allowedForHero
      if (!approved || !heroOk) unauthorized += 1
    }
    // Referencia para midia INEXISTENTE tambem conta: nao publicamos apontando
    // para um item que nao conseguimos verificar.
    const missing = ids.filter((id) => !seen.has(id))
    for (const id of missing) authorizations.set(id, UNKNOWN_MEDIA)
    return { unauthorizedCount: unauthorized + missing.length, authorizations }
  } catch {
    // Falha ao verificar NAO vira "autorizado": fail-closed.
    return allUnknown()
  }
}

/* ------------------------------------------------------------------ */
/* Endpoint                                                            */
/* ------------------------------------------------------------------ */

export const editorialPublicationsEndpoint: Endpoint = {
  path: '/internal/editorial-publications',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    // O instante do SERVIDOR. `generatedAt` vem do produtor e serve como
    // metadado do pipeline, nao como carimbo de auditoria: o relogio dele nao e
    // confiavel e nao esta sob nosso controle.
    const receivedAtIso = new Date().toISOString()

    const actor = toActor(req.user)
    if (actor.kind === 'anonymous') return json({ error: 'unauthenticated' }, 401)
    // Escopo PROPRIO. `draft_ingest` nao publica; `publication_projection` nao
    // publica. Os tres poderes sao disjuntos por design.
    if (!serviceHasScope(actor, 'editorial_auto_publish')) {
      return json({ error: 'forbidden_scope' }, 403)
    }

    let raw = ''
    try {
      raw = (await req.text?.()) ?? ''
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }
    if (raw === '' || Buffer.byteLength(raw, 'utf8') > MAX_REQUEST_BYTES) {
      return json({ error: 'invalid_body' }, 400)
    }

    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }

    const parsed = parseEditorialPublicationRequestV1(body)
    if (!parsed.ok) {
      // Contrato invalido e BLOCKED, nao CONFLICT: reenviar igual repete o
      // defeito. Os `issues` nomeiam o campo, nunca ecoam o valor.
      return json(
        { outcome: 'BLOCKED', reasons: parsed.issues.map((issue) => ({ code: 'contract_invalid', detail: `${issue.path}: ${issue.message}` })) },
        outcomeHttpStatus('BLOCKED'),
      )
    }
    const request = parsed.value

    // Compatibilidade de SCHEMA. Falha FECHADO: um schema diferente pode ter
    // campo de mesmo nome com outra semantica.
    // Os TRES valores sao conferidos: nome, versao e hash. Nome errado e outro
    // contrato; versao errada e outra semantica; hash errado e outro schema com
    // o mesmo rotulo — o caso mais perigoso, porque parece certo.
    const compatibility = checkContractCompatibility({
      contractName: request.contractName,
      declaredVersion: request.contractVersion,
      declaredHash: request.schemaHash,
    })

    const authorFacts = await readAuthorFacts(req, request.publicAuthorId)
    const section = text(request.seo.articleSectionSuggestion)

    const configResult = resolveAutoPublishConfig(process.env)
    if (!configResult.ok) {
      // Fuso invalido NAO e defeito editorial da materia: e configuracao da
      // plataforma. Nada e criado, nada vai para revisao, nenhum limite e
      // consumido — e o 503 diz ao produtor que vale retentar DEPOIS da
      // correcao operacional.
      return json(
        {
          outcome: 'OPERATIONAL_ERROR',
          code: 'AUTO_PUBLISH_TIME_ZONE_INVALID',
          retryable: true,
          reasons: configResult.errors.map((detail) => ({
            code: 'AUTO_PUBLISH_TIME_ZONE_INVALID',
            detail,
          })),
        },
        503,
      )
    }
    const config = configResult.config

    // Janela do DIA CIVIL da redacao, convertida para UTC. Half-open: uma
    // publicacao a meia-noite exata contaria em dois dias se os extremos
    // fossem ambos inclusivos.
    const dayWindow = editorialDayWindowUtc(receivedAtIso, config.timeZone)

    // Nao ha mais `SELECT COUNT` aqui. A contagem virou RESERVA transacional
    // (ver `quota-store.ts`): contar antes e publicar depois deixa uma janela em
    // que duas requisicoes simultaneas leem o mesmo numero e ambas passam.
    //
    // O gate abaixo ainda recebe `usage`, mas so para os desfechos que NAO
    // dependem de corrida (kill switch, QA, autor). O teto real e aplicado na
    // reserva, dentro da transacao.
    const quotaWindow: QuotaWindow = {
      timeZone: config.timeZone,
      localDate: localDateIn(receivedAtIso, config.timeZone),
      windowStartUtcIso: dayWindow.startUtcIso,
      windowEndUtcIso: dayWindow.nextStartUtcIso,
    }

    const slug = canonicalizeSlug(request.seo.slugSuggestion)

    // Idempotencia e revisao: procuramos um artigo com a MESMA chave.
    let existing: Record<string, unknown> | null = null
    try {
      const found = await req.payload.find({
        collection: 'articles',
        where: { automationIdempotencyKey: { equals: request.idempotencyKey } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        req,
      })
      existing = (found.docs[0] ?? null) as Record<string, unknown> | null
    } catch {
      existing = null
    }

    // TROCA DE AUTOR em materia ja publicada.
    //
    // Comparamos com o ESTADO REAL do artigo, nao com o que o payload diz. O
    // request pode ate repetir o autor certo por acidente; o que decide e o que
    // esta persistido.
    const currentAuthorId =
      existing === null ? null : String((existing as { primaryAuthor?: unknown }).primaryAuthor ?? '')
    const alreadyPublished =
      existing !== null && (existing as { workflowStatus?: unknown }).workflowStatus === 'published'
    const authorChangeRequiresHuman =
      alreadyPublished &&
      currentAuthorId !== null &&
      currentAuthorId !== '' &&
      currentAuthorId !== request.publicAuthorId

    const appliedRevision =
      existing !== null && typeof existing.automationSourceRevision === 'number'
        ? existing.automationSourceRevision
        : null
    const staleRevision =
      request.publicationIntent === 'update' &&
      appliedRevision !== null &&
      request.sourceRevision <= appliedRevision
    const idempotencyConflict =
      existing !== null &&
      typeof existing.automationPayloadHash === 'string' &&
      existing.automationPayloadHash !== request.sourcePayloadHash &&
      request.publicationIntent === 'publish'

    /* ---------------------------------------------------------------- */
    /* O que o pedido VIRA — e o que ele PERDE                          */
    /* ---------------------------------------------------------------- */
    //
    // Este bloco roda ANTES da resposta, e essa ordem e a correcao.
    //
    // Ate aqui o corpo so era mapeado la dentro de `persistPublication`, depois
    // que a resposta ja estava montada: os avisos do mapeador iam para o
    // registro do artigo e para um log, e o emissor recebia um `2xx` limpo
    // enquanto uma imagem, uma proveniencia ou um bloco inteiro ficavam pelo
    // caminho. Mapear antes e o que permite devolver a verdade.
    //
    // Roda tambem para os desfechos que NAO persistem (BLOCKED, CONFLICT): o
    // pedido recusado e justamente o que mais precisa saber o que estava errado.
    const mediaReport = await readMediaAuthorizations(req, request)
    const mappedBody = toPayloadBody(request)
    const hero = resolveHeroMedia(request.media, mediaReport.authorizations)
    const entityRefs = resolveEntityReferences(request.entityLinks)
    const seoPlan = planSeoPersistence(request.seo)

    // A varredura de `marks` usa o JSON CRU, nao o pedido validado: o `z.object`
    // do paragrafo remove a chave em silencio, e a essa altura nao ha mais o que
    // reportar.
    const strippedMarks = findStrippedBlockMarks(body)

    // Vinculo de entidade NAO e reaplicado em update. Diferente do titulo ou do
    // SEO, `entityReferences` carrega uma decisao HUMANA dentro (`verified`), e
    // reescrever o array a cada atualizacao apagaria a curadoria com linhas
    // `verified: false`. Mesma regra da capa, pelo mesmo motivo.
    const entityLinksSkippedOnUpdate: readonly EditorialWarning[] =
      existing !== null && entityRefs.rows.length > 0
        ? [
            {
              code: 'ENTITY_LINK_NOT_REAPPLIED',
              field: 'entityLinks',
              detail: `${String(entityRefs.rows.length)} vinculo(s) NAO reaplicado(s): a materia ja existe e o campo carrega confirmacao humana, que uma reescrita automatica apagaria`,
            },
          ]
        : []

    // O update NAO troca todos os avisos de vinculo pelo de "nao reaplicado".
    // So UM deles deixa de valer: `ENTITY_LINK_UNVERIFIED` afirma que linhas
    // foram GRAVADAS como nao verificadas, e no update nada e gravado — repetir
    // esse seria a mentira simetrica. A recusa por id malformado continua
    // valendo em qualquer intencao: um id externo aponta para outra entidade,
    // exista a materia ou nao.
    //
    // O filtro e pelo que SAI, nao pelo que fica. Listar o que fica
    // recriaria este mesmo defeito no dia em que alguem acrescentar um codigo
    // de recusa a `resolveEntityReferences`: ele nasceria fora da lista e
    // sumiria calado no update — exatamente o que esta correcao existe para
    // impedir. Assim, aviso novo sobrevive por padrao.
    const entityLinkWarnings: readonly EditorialWarning[] =
      existing === null
        ? entityRefs.warnings
        : [
            ...entityRefs.warnings.filter((warning) => warning.code !== 'ENTITY_LINK_UNVERIFIED'),
            ...entityLinksSkippedOnUpdate,
          ]

    const intakeWarnings: readonly EditorialWarning[] = [
      ...mappedBody.details,
      ...strippedMarks,
      ...hero.warnings,
      ...entityLinkWarnings,
      ...seoPlan.warnings,
    ]

    const decision: PublicationDecision = decideAutoPublication({
      limits: config,
      // ZERADOS DE PROPOSITO. NAO "CONSERTE" ISTO.
      //
      // Parece um pre-cheque quebrado — um teto que nunca dispara — e a correcao
      // obvia seria alimentar `usage` com a contagem real do dia. Essa correcao
      // reabriria exatamente a corrida que a reserva transacional existe para
      // fechar: entre o `SELECT COUNT` e o `INSERT` da publicacao ha uma janela,
      // e duas requisicoes simultaneas leem o mesmo numero, ambas concluem que
      // cabe mais uma, e o dia fecha acima do teto. Com um pipeline que dispara
      // em lote, isso nao e raro: e o caso normal.
      //
      // O teto e aplicado em UM lugar so, dentro da transacao, por
      // `consumeQuotas` (ver `quota-store.ts`). Ter duas aplicacoes seria pior
      // que ter uma: a de fora recusaria antes, com outro desfecho, e as duas
      // divergiriam na primeira mudanca de limite.
      //
      // O gate abaixo continua recebendo o campo porque decide desfechos que NAO
      // dependem de corrida (kill switch, QA, autoria, SEO).
      usage: { publishedTodayGlobal: 0, publishedTodayByAuthor: 0 },
      authorAuthorization: authorizeAutomationAuthor({
        facts: authorFacts,
        contentType: request.contentType,
        section,
        attributionMode: request.attributionMode,
        publishedTodayByAuthor: 0,
      }),
      contractCompatible: compatibility.compatible,
      qaPassed: request.qa.passed,
      qaBlockingErrors: request.qa.blockingErrors,
      qaWarnings: request.qa.warnings,
      seo: request.seo,
      body: inspectBody(request),
      contentType: request.contentType,
      unauthorizedMediaCount: mediaReport.unauthorizedCount,
      staleRevision,
      idempotencyConflict,
      slugValid: slug.ok,
      authorChangeRequiresHuman,
    })

    // A resposta e AUDITAVEL e nao vaza conteudo: desfecho, motivos com codigo,
    // avisos e a identidade do pedido.
    //
    // `warnings` continua sendo LISTA DE STRINGS, o formato de sempre — so que
    // agora completa: as perdas do mapeamento, da capa, dos vinculos e do SEO
    // entram nela em vez de morrer num log interno. `warningDetails` e o campo
    // NOVO, com codigo e campo, para o pipeline decidir por codigo em vez de
    // casar substring de uma frase em portugues.
    //
    // Acrescentar campo a RESPOSTA nao mexe no `schemaHash`, que cobre o pedido:
    // nenhum emissor em voo passa a receber `hash_mismatch` por causa disto.
    const responseBody = {
      outcome: decision.outcome,
      requestId: request.requestId,
      idempotencyKey: request.idempotencyKey,
      reasons: decision.reasons,
      warnings: [...decision.warnings, ...intakeWarnings.map((warning) => warning.detail)],
      warningDetails: intakeWarnings,
      // O ATOR TECNICO fica registrado; o autor publico e o do pedido.
      technicalActorId: actor.kind === 'service' ? actor.id : null,
      publicAuthorId: request.publicAuthorId,
      canonicalSlug: slug.ok ? slug.slug : null,
    }

    if (decision.outcome !== 'PUBLISHED' && decision.outcome !== 'ROUTED_TO_REVIEW') {
      return json(responseBody, outcomeHttpStatus(decision.outcome))
    }

    // A partir daqui o conteudo E persistido. Em `ROUTED_TO_REVIEW` ele fica em
    // `needs_review` e NADA vira publico — jogar fora um conteudo que passou por
    // todas as validacoes de forma seria perder trabalho valido.
    // Troca de autor recusada NAO aplica os demais campos: aplicar metade de um
    // update e pior do que nao aplicar nada — a materia ficaria com corpo novo e
    // assinatura antiga, sem ninguem ter decidido isso.
    if (authorChangeRequiresHuman) {
      return json(responseBody, outcomeHttpStatus(decision.outcome))
    }

    // IDEMPOTENCIA ANTES DA QUOTA.
    //
    // Um retry cujo HTTP se perdeu no caminho ja consumiu o teto na primeira
    // tentativa. Consumir de novo faria o produtor gastar o dia inteiro
    // reenviando o MESMO pedido — e o teto protegeria contra a coisa errada.
    const previous = await findPreviousConsumption(req, request.requestId)
    if (previous !== null) {
      return json(
        {
          ...responseBody,
          idempotent: true,
          articleId: text(previous.articleId),
          reasons: [
            { code: 'ALREADY_CONSUMED', detail: 'pedido ja processado; nada foi reaplicado' },
          ],
        },
        outcomeHttpStatus(decision.outcome),
      )
    }

    const technicalActorId = actor.kind === 'service' ? actor.id : 'desconhecido'

    // RESERVA + PUBLICACAO na MESMA transacao.
    //
    // `initTransaction` abre a transacao e grava o id em `req.transactionID`;
    // tudo que usar esse `req` — inclusive o SQL da reserva — participa dela. Se
    // qualquer etapa falhar, `killTransaction` desfaz o conjunto: nao existe o
    // estado "contou e nao publicou".
    //
    // NAO use `payload.db.transaction`: essa funcao nao existe no adapter, e
    // chama-la com `?.` transforma o bloco inteiro em no-op silencioso — nada
    // persistido e ainda assim um `PUBLISHED` na resposta.
    let quotaRejection: Awaited<ReturnType<typeof consumeQuotas>> | null = null
    let articleId: string | null = null

    try {
      await initTransaction(req)
      // Sem transacao NAO se publica. Reservar quota e publicar fora de
      // transacao quebraria a garantia central desta fase.
      if (req.transactionID === undefined || req.transactionID === null) {
        throw new Error('adapter de banco sem suporte a transacao')
      }
      await (async () => {
        const reservation = await consumeQuotas(req, quotaWindow, {
          publicationIntent: request.publicationIntent,
          contentType: request.contentType,
          section,
          publicAuthorId: request.publicAuthorId,
          targetArticleId: request.targetArticleId ?? null,
          limits: {
            dailyLimit: config.dailyLimit,
            // O teto do AUTOR e o mais restritivo entre a plataforma e o proprio
            // documento dele. `authorizeAutomationAuthor` nao consegue mais
            // aplicar `automationDailyLimit` — ele recebe contagem zero, porque
            // contar antes da transacao e justamente o que reabre a corrida.
            // Sem esta linha a decisao da redatora sobre o proprio nome ficaria
            // registrada no documento e nao valeria nada.
            perAuthorLimit: strictestLimit(config.perAuthorLimit, authorFacts.automationDailyLimit),
            perSectionLimit: config.perSectionLimit,
            perContentTypeLimit: config.perContentTypeLimit,
            perArticleUpdateLimit: config.perArticleUpdateLimit,
          },
        })

        if (!reservation.ok) {
          quotaRejection = reservation
          // Abortar e o que garante que NENHUMA das dimensoes anteriores fique
          // incrementada. Compensar a mao abriria a janela que a transacao
          // existe para fechar.
          throw new QuotaRejectedError()
        }

        const persisted = await persistPublication(req, {
          request,
          decision,
          slug: slug.ok ? slug.slug : null,
          existingId: existing === null ? null : String(existing.id),
          mappedBody,
          heroMediaId: hero.heroMediaId,
          entityReferences: entityRefs.rows,
          seoFields: seoPlan.fields,
          // O revisor humano ve no admin a MESMA lista que o emissor recebeu.
          intakeWarnings: intakeWarnings.map((warning) => warning.detail),
          // TUDO derivado da credencial autenticada, nada do corpo.
          technicalActorId,
          technicalActorLabel: text((req.user as { label?: unknown } | null)?.label) ?? null,
          scopesUsed: actor.kind === 'service' ? [...actor.scopes] : [],
          receivedAtIso,
        })
        if (persisted.articleId === null) {
          // Persistencia falhou: derruba a transacao junto com os contadores.
          throw new Error('persistencia da publicacao falhou')
        }
        articleId = persisted.articleId

        await recordConsumption(req, {
          requestId: request.requestId,
          idempotencyKey: request.idempotencyKey,
          sourceClusterId: request.sourceClusterId,
          sourceRevision: request.sourceRevision,
          articleId: persisted.articleId,
          publicAuthorId: request.publicAuthorId,
          publicationIntent: request.publicationIntent,
          window: quotaWindow,
          dimensionsConsumed: reservation.consumed,
          serviceAccountId: technicalActorId,
          pipelineVersion: request.pipelineVersion,
          consumedAtIso: receivedAtIso,
        })
      })()
      await commitTransaction(req)
    } catch (error) {
      // Rollback SEMPRE, antes de qualquer resposta. Deixar a transacao aberta
      // seguraria uma conexao do pool ate o timeout e manteria as linhas de
      // contador travadas — os proximos pedidos esperariam por nada.
      await killTransaction(req)
      const rejection = quotaRejection as
        | { readonly code: string; readonly dimension: string; readonly nextEligibleAtIso: string | null }
        | null
      if (rejection !== null) {
        // TETO ESGOTADO — e aqui esta a distincao que faltava.
        //
        // Nada foi publicado, nada foi para a outbox, nenhuma dimensao ficou
        // consumida e — o ponto — NENHUM ARTIGO FOI CRIADO: a reserva roda antes
        // de `persistPublication`, e o rollback desfaz o conjunto. Nao existe
        // rascunho nenhum esperando um editor.
        //
        // Por isso a resposta NAO e `ROUTED_TO_REVIEW`. Aquele desfecho promete
        // uma fila com algo dentro; este caminho deixa a fila vazia. Responder
        // "encaminhado para revisao" mandava o produtor esperar por uma revisao
        // que nunca existiria, e `shouldRetry` mandava nao reenviar — a materia
        // se perdia com 202 na resposta.
        //
        // `nextEligibleAtIso` decide entre ESPERAR e DESISTIR (a regra e de
        // `quotaExhaustionIsDeferrable`): ha horario prometido -> `DEFERRED`,
        // retentavel; nao ha -> `BLOCKED`, e reenviar so repetiria a recusa.
        const deferrable = rejection.nextEligibleAtIso !== null
        const outcome: PublicationOutcome = deferrable ? 'DEFERRED' : 'BLOCKED'
        // O header sai do MESMO instante e do MESMO horario que vao no corpo:
        // um `Retry-After` derivado de outro relogio contradiria o
        // `nextEligibleAt` da resposta.
        const retryAfter = retryAfterSeconds(rejection.nextEligibleAtIso, receivedAtIso)
        return json(
          {
            ...responseBody,
            outcome,
            reasons: [{ code: rejection.code, detail: `dimensao ${rejection.dimension}` }],
            nextEligibleAt: rejection.nextEligibleAtIso,
            retryable: deferrable,
          },
          outcomeHttpStatus(outcome),
          retryAfter === null ? {} : { 'retry-after': String(retryAfter) },
        )
      }
      // Falha de persistencia: nada foi publicado e nenhum contador sobreviveu.
      //
      // Registramos so a CLASSE do erro, nunca a mensagem: erro de banco carrega
      // valor de coluna, e valor de coluna aqui e trecho de materia inedita.
      req.payload.logger.error({
        msg: 'autopublicacao abortada',
        requestId: request.requestId,
        errorKind: error instanceof Error ? error.constructor.name : typeof error,
      })
      return json(
        {
          ...responseBody,
          outcome: 'OPERATIONAL_ERROR',
          code: 'AUTO_PUBLISH_PERSISTENCE_FAILED',
          retryable: true,
        },
        503,
      )
    }

    return json({ ...responseBody, articleId }, outcomeHttpStatus(decision.outcome))
  },
}

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */

/**
 * Blocos do contrato -> blocos do Payload.
 *
 * A traducao propriamente dita vive em `../editorial-body-mapper.js`, comum a
 * este fluxo e ao de ingestao de rascunho. Aqui fica so o que e PROPRIO da
 * publicacao: a resolucao de midia.
 *
 * Antes esta funcao era um spread (`{ ...rest, blockType, blockId }`), e o
 * spread nao traduzia dois campos que precisam de traducao: `heading.level`
 * (numero no contrato, ENUM de texto na coluna) e `image.mediaRef` (referencia
 * de contrato, relacao `media_id` na coluna). O resultado era heading sem nivel
 * e imagem sem relacao — invisivel para o gate de midia do corpo, que le
 * `block.media`.
 *
 * Na publicacao o salto e curto: o contrato define `media[].mediaId` como midia
 * JA APROVADA no CMS, entao `block.mediaRef` que casa com um `mediaId` E o id
 * da linha. Nao ha candidata pendente neste fluxo — quem publica ja passou pelo
 * gate de licenca.
 */
function toPayloadBody(request: EditorialPublicationRequestV1): MappedBody {
  const approved = new Set(request.media.map((item) => item.mediaId))
  return toPayloadBlocks(request.blocks, {
    resolveMedia: (mediaRef) => (approved.has(mediaRef) ? mediaRef : null),
  })
}

async function persistPublication(
  req: PayloadRequest,
  input: {
    readonly request: EditorialPublicationRequestV1
    readonly decision: PublicationDecision
    readonly slug: string | null
    readonly existingId: string | null
    /** Corpo JA mapeado pelo handler — a resposta depende dele, entao ele nasce la. */
    readonly mappedBody: MappedBody
    /** Capa a GRAVAR. `null` = nao ha capa a gravar; NUNCA "apague a capa". */
    readonly heroMediaId: string | null
    readonly entityReferences: readonly EntityReferenceRow[]
    readonly seoFields: Readonly<Record<string, unknown>>
    readonly intakeWarnings: readonly string[]
    readonly technicalActorId: string
    readonly technicalActorLabel: string | null
    readonly scopesUsed: readonly string[]
    readonly receivedAtIso: string
  },
): Promise<{ articleId: string | null }> {
  const { request } = input
  const publish = input.decision.outcome === 'PUBLISHED'

  // Slug: derivada, e resolvida contra colisao de forma DETERMINISTICA.
  // SEM SAIDA SILENCIOSA. Antes havia um `catch {}` vazio aqui: quando a busca
  // de colisao falhava, a publicacao seguia com a slug colidida — 2xx neste
  // ponto e falha depois, na projecao, com erro de outro sistema. O resolvedor
  // agora e compartilhado com a ingestao de rascunho, que nao tinha nenhum.
  let slug = input.slug ?? ''
  if (input.existingId === null) {
    slug = await resolveAvailableSlug(req, { slug, language: request.language })
  }

  const authorRef: string | number = /^\d+$/.test(request.publicAuthorId)
    ? Number(request.publicAuthorId)
    : request.publicAuthorId

  // O campo se chama `body`, e o Payload discrimina bloco por `blockType` —
  // o contrato usa `type`/`id`. Gravar `blocks: request.blocks` cru nao
  // falhava alto: o Payload ignorava a chave desconhecida e a materia ficava
  // SEM CORPO, publicada e vazia.
  //
  // O mapeamento agora vem PRONTO do handler: ele precisa dos avisos para
  // montar a resposta, e mapear duas vezes deixaria a resposta e a persistencia
  // livres para divergir.
  const { mappedBody } = input

  // A CAPA so entra quando ha uma capa autorizada a gravar.
  //
  // A ausencia da chave e o que preserva o hero que um humano escolheu: um
  // pedido de update sem capa nao pode apagar a que ja existe. Gravar `null`
  // aqui — a alternativa obvia — faria exatamente isso.
  //
  // O id vai como NUMERO pelo mesmo motivo do autor: no Postgres o id do
  // Payload e inteiro e a validacao de relacionamento recusa a string.
  const heroRef =
    input.heroMediaId === null
      ? {}
      : {
          heroMedia: /^\d+$/.test(input.heroMediaId)
            ? Number(input.heroMediaId)
            : input.heroMediaId,
        }

  const common: Record<string, unknown> = {
    title: request.title,
    summary: request.summary,
    language: request.language,
    contentType: request.contentType,
    body: mappedBody.blocks,
    // Autoria PUBLICA. O ator tecnico vai nos campos de automacao abaixo.
    //
    // O id vai como NUMERO: no Postgres o id do Payload e inteiro, e a
    // validacao de relacionamento recusa a string equivalente ("The following
    // fields are invalid: Authors, Primary Author"). O contrato trafega texto
    // porque nao deve depender do tipo de chave do CMS — a conversao mora aqui,
    // na fronteira.
    primaryAuthor: authorRef,
    // `authors` e o que o gate de publicacao conta (`activeAuthorCount`).
    // Preencher so `primaryAuthor` deixava o gate ver zero autores ativos e
    // recusar toda publicacao automatica.
    authors: [authorRef],
    // Materia de pipeline E assistida por IA. Declarar isso liga o gate que
    // exige fonte externa — parafrase sem lastro nao publica.
    aiAssisted: true,
    externalSources: request.externalSources.map((source) => ({
      sourceId: source.id,
      name: source.name,
      url: source.url,
      role: source.role,
    })),
    ...heroRef,
    blockingErrors: [...request.qa.blockingErrors],
    // Bloco que o mapper nao conseguiu traduzir vira aviso NOMEADO, nunca
    // sumico silencioso — a mesma politica do caminho de ingestao. A lista
    // carrega tambem as perdas de capa, vinculo e SEO: o revisor humano ve no
    // admin a mesma verdade que o emissor recebeu por HTTP.
    //
    // `mappedBody.warnings` NAO entra aqui, e a ausencia e o conserto.
    // `input.intakeWarnings` ja comeca com os detalhes do mapper (a frase de
    // cada perda), entao somar as duas listas gravava cada perda de bloco DUAS
    // vezes — a mesma string — e acrescentava a redacao AGREGADA da
    // proveniencia, que a resposta HTTP nunca carregou. O admin passava a
    // mostrar mais e diferente do que o emissor recebeu, justo no campo cuja
    // razao de existir e as duas pontas baterem. Ver `MappedBody.details`.
    warnings: [...request.qa.warnings, ...input.intakeWarnings],
    qaVersion: request.qa.version,
    // Carimbo do SERVIDOR, condicionado ao veredito do QA. Copiar um horario do
    // produtor deixaria o pipeline decidir sozinho que passou no QA.
    ...(request.qa.passed ? { qaPassedAt: input.receivedAtIso } : {}),
    ...(request.seo.articleSectionSuggestion === undefined
      ? {}
      : { section: request.seo.articleSectionSuggestion }),
    // Rastro da automacao: quem operou, com que pipeline, sob que contrato.
    autoPublished: publish,
    automationActorId: input.technicalActorId,
    automationActorLabel: input.technicalActorLabel,
    automationScopesUsed: [...input.scopesUsed],
    automationReceivedAt: input.receivedAtIso,
    automationIdempotencyKey: request.idempotencyKey,
    automationSourceRevision: request.sourceRevision,
    automationPayloadHash: request.sourcePayloadHash,
    automationPipelineVersion: request.pipelineVersion,
    automationContractName: request.contractName,
    automationContractVersion: request.contractVersion,
    automationSchemaHash: request.schemaHash,
    automationAttributionMode: request.attributionMode,
    // SEO: sugestoes revalidadas, guardadas como decisao do CMS.
    //
    // Os cinco campos abaixo sempre atravessaram. O que `seoFields` acrescenta
    // e o resto do que o contrato ja aceitava e a whitelist descartava sem uma
    // linha de log: palavras-chave editoriais, termos relacionados e o par
    // social. O que continua sem coluna sai como aviso, nao como silencio (ver
    // `planSeoPersistence`).
    ...input.seoFields,
    metaTitle: request.seo.title,
    metaDescription: request.seo.metaDescription,
    focusKeyphrase: request.seo.focusKeyphrase,
    schemaTypeRecommendation: request.seo.schemaTypeRecommendation,
    ...(request.subtitle === undefined ? {} : { subtitle: request.subtitle }),
    ...(request.seo.articleSectionSuggestion === undefined
      ? {}
      : { articleSection: request.seo.articleSectionSuggestion }),
  }


  try {
    if (input.existingId !== null) {
      // Atualizacao: a slug de materia PUBLICADA nao muda por automacao.
      const current = (await req.payload.findByID({
        collection: 'articles',
        id: input.existingId,
        depth: 0,
        overrideAccess: true,
        req,
      })) as unknown as Record<string, unknown>

      const slugPolicy = decideSlugChange({
        currentSlug: String(current.slug ?? ''),
        proposedSlug: slug,
        alreadyPublished: current.workflowStatus === 'published',
        automated: true,
      })

      await req.payload.update({
        collection: 'articles',
        id: input.existingId,
        data: {
          ...common,
          ...(slugPolicy.action === 'change' ? { slug: slugPolicy.slug } : {}),
          workflowStatus: publish ? 'published' : 'needs_review',
        } as never,
        overrideAccess: true,
        req,
      })
      return { articleId: input.existingId }
    }

    const created = await req.payload.create({
      collection: 'articles',
      data: {
        ...common,
        slug,
        // VINCULOS DE ENTIDADE, so na CRIACAO.
        //
        // O campo carrega `verified`, que e decisao humana; reescrever o array
        // a cada update apagaria a curadoria e devolveria tudo a `false`. Por
        // isso o update nao toca nele — e diz isso ao emissor, pelo aviso
        // `ENTITY_LINK_NOT_REAPPLIED`.
        entityReferences: input.entityReferences.map((row) => ({ ...row })),
        // Nasce marcado como origem de automacao e SOBE pela maquina de
        // estados — nao ha atalho que pule o gate de publicacao.
        workflowStatus: 'automation_draft',
      } as never,
      overrideAccess: true,
      req,
    })
    const articleId = String(created.id)

    // A transicao ate `published` passa pelos MESMOS estados do fluxo humano.
    // Pular direto para `published` burlaria `evaluatePublishGate`, que e quem
    // confere autor, QA, fontes e midia no servidor.
    // A automacao NAO atravessa `in_review` nem `human_reviewed`: passar por
    // esses estados gravaria que um humano revisou quando nenhum revisou. Ela
    // sobe direto para `ready_to_publish` — a aresta onde `evaluatePublishGate`
    // roda — e so entao para `published`.
    const path = publish ? ['ready_to_publish', 'published'] : ['needs_review']
    for (const status of path) {
      await req.payload.update({
        collection: 'articles',
        id: articleId,
        data: { workflowStatus: status } as never,
        overrideAccess: true,
        req,
      })
    }
    return { articleId }
  } catch (error) {
    // Falha de persistencia NAO vira sucesso silencioso. O chamador recebe o
    // artigo nulo e derruba a transacao.
    //
    // O log e o unico lugar onde a causa sobrevive: o `catch` apaga o erro e a
    // resposta ao produtor e deliberadamente generica. Sem esta linha, "falhou
    // ao persistir" seria tudo o que existiria — foi exatamente esse silencio
    // que escondeu a causa na primeira vez.
    req.payload.logger.error({
      msg: 'persistencia da publicacao falhou',
      errorKind: error instanceof Error ? error.constructor.name : typeof error,
    })
    return { articleId: null }
  }
}
