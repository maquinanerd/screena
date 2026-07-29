/**
 * hooks/articles.ts — Governanca editorial LIGADA ao runtime do Payload.
 *
 * A Fase 2A deixou a decisao pura e testada, mas ninguem a chamava durante uma
 * publicacao real. Estes hooks sao esse fio: sao o unico lugar por onde uma
 * mudanca de estado de artigo passa, venha ela do painel, da REST API ou da
 * Local API.
 *
 * Duas armadilhas do Payload que os hooks precisam cobrir:
 *
 *  1. `_status: 'published'` PUBLICA, mesmo com `draft: true` na chamada. Nao
 *     basta proteger o `workflowStatus`: se `_status` puder ser enviado solto,
 *     ele publica por fora do fluxo. Por isso `_status` aqui e DERIVADO de
 *     `workflowStatus`, nunca aceito como entrada independente.
 *
 *  2. A Local API IGNORA access control por padrao. Um `payload.create` interno
 *     escreve mesmo onde a collection declara `create: false`. Por isso o bypass
 *     e explicito e confinado: so o `afterChange` cria a outbox, e so a outbox.
 */

import type {
  CollectionAfterChangeHook,
  CollectionBeforeChangeHook,
  PayloadRequest,
} from 'payload'
import { APIError } from 'payload'

import { toActor } from '../actor.js'
import { AUTOMATION_PUBLISHER_FORBIDDEN_FIELDS, SERVICE_ACCOUNT_FORBIDDEN_FIELDS } from '../access.js'
import { buildOutboxRecord, buildEventIdempotencyKey } from '../outbox.js'
import {
  canTransition,
  evaluatePublishGate,
  publicationEventForTransition,
  type ActorKind,
  type WorkflowStatus,
} from '../workflow.js'
import { buildPublicationEvent } from '../publication.js'

/** Erro de governanca: vira 403 e NUNCA carrega payload nem credencial. */
function deny(message: string): never {
  throw new APIError(message, 403)
}

/* ------------------------------------------------------------------ */
/* Leituras de apoio (internas, com `req` para ficarem na transacao)   */
/* ------------------------------------------------------------------ */

function idsOf(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((item) =>
      item !== null && typeof item === 'object' && 'id' in item
        ? String((item as { id: unknown }).id)
        : String(item),
    )
    .filter((id) => id !== '' && id !== 'null' && id !== 'undefined')
}

/** Quantos dos autores ligados estao ATIVOS. Autor inativo nao publica. */
async function countActiveAuthors(req: PayloadRequest, authorIds: string[]): Promise<number> {
  if (authorIds.length === 0) return 0
  const found = await req.payload.find({
    collection: 'authors',
    where: { and: [{ id: { in: authorIds } }, { active: { equals: true } }] },
    limit: authorIds.length,
    depth: 0,
    // Leitura INTERNA de validacao: o gate precisa do estado real, e nao do que
    // o ator consegue enxergar. Nao devolve nada ao cliente.
    overrideAccess: true,
    req,
  })
  return found.totalDocs
}

/**
 * Quantos itens de midia ligados NAO estao autorizados.
 *
 * Fail-closed: so conta como autorizado `licenseStatus === 'approved'` E
 * `allowedForEditorial === true`. Hero exige ainda `allowedForHero`.
 */
/**
 * Ids de midia referenciados DENTRO dos blocos de imagem do corpo.
 *
 * Sem isto, o gate de publicacao cobria capa e galeria mas deixava passar uma
 * materia cujo CORPO aponta para midia proibida: ela publicava no CMS e depois
 * morria no worker de projecao, deixando a redacao com um artigo "publicado"
 * que nunca aparece no site. Melhor recusar na hora, onde ha um humano olhando.
 */
function bodyMediaIds(body: unknown): string[] {
  if (!Array.isArray(body)) return []
  return body.flatMap((raw) => {
    if (raw === null || typeof raw !== 'object') return []
    const block = raw as Record<string, unknown>
    if (String(block.blockType ?? block.type ?? '') !== 'image') return []
    return idsOf(block.media)
  })
}

async function countUnauthorizedMedia(
  req: PayloadRequest,
  heroId: string | null,
  galleryIds: string[],
  bodyIds: string[] = [],
): Promise<number> {
  const allIds = [...new Set([...(heroId === null ? [] : [heroId]), ...galleryIds, ...bodyIds])]
  if (allIds.length === 0) return 0

  const found = await req.payload.find({
    collection: 'media',
    where: { id: { in: allIds } },
    limit: allIds.length,
    depth: 0,
    overrideAccess: true,
    req,
  })

  let unauthorized = 0
  const seen = new Set<string>()
  for (const media of found.docs) {
    const id = String(media.id)
    seen.add(id)
    const approved = media.licenseStatus === 'approved' && media.allowedForEditorial === true
    const heroOk = id !== heroId || media.allowedForHero === true
    if (!approved || !heroOk) unauthorized += 1
  }
  // Referencia para midia inexistente tambem e "nao autorizada": nao publicamos
  // apontando para um item que nao conseguimos verificar.
  unauthorized += allIds.filter((id) => !seen.has(id)).length
  return unauthorized
}

/* ------------------------------------------------------------------ */
/* beforeChange — governanca                                           */
/* ------------------------------------------------------------------ */

export const enforceEditorialGovernance: CollectionBeforeChangeHook = async ({
  data,
  req,
  operation,
  originalDoc,
}) => {
  const actor = toActor(req.user)
  if (actor.kind === 'anonymous') deny('escrita editorial exige autenticacao')

  // As DUAS contas tecnicas nao sao o mesmo ator. Quem tem
  // `editorial_auto_publish` publica sob politica e passa pelo gate; quem tem
  // so `draft_ingest` continua confinado a `automation_draft`. Derivar isso do
  // ESCOPO, e nao de `kind === 'service'`, e o que impede a conta de ingestao
  // de herdar o poder de publicar.
  const autoPublisher =
    actor.kind === 'service' && actor.scopes.includes('editorial_auto_publish')
  const actorKind: ActorKind =
    actor.kind === 'service'
      ? autoPublisher
        ? 'automation_publisher'
        : 'service'
      : actor.role
  const previous = (originalDoc ?? {}) as Record<string, unknown>
  const incoming = data as Record<string, unknown>
  // Autosave envia PATCH parcial: validar so `data` deixaria o gate cego para o
  // que ja esta no documento.
  const next = { ...previous, ...incoming }

  /* --- Service account: superficie minima --------------------------- */
  if (actor.kind === 'service' && !autoPublisher) {
    // Campos de decisao humana sao REMOVIDOS do payload da automacao, nao
    // recusados.
    //
    // Recusar por presenca nao funciona: o Payload monta `data` com todos os
    // campos da collection e ja aplica os defaults, entao `publishedAt: null` e
    // `legalHold: false` aparecem mesmo quando o chamador nunca os enviou —
    // presenca nao e intencao, e nem sequer o valor distingue (o default de um
    // checkbox e `false`, indistinguivel de um `false` enviado de proposito).
    //
    // Remover garante o invariante — a automacao nao escreve estes campos — sem
    // falso positivo. A tentativa EXPLICITA de publicar ja e recusada alto e
    // claro na fronteira do contrato (422), antes de chegar aqui.
    for (const field of SERVICE_ACCOUNT_FORBIDDEN_FIELDS) {
      if (field === 'workflowStatus') continue
      delete incoming[field]
    }
    const target = String(next.workflowStatus ?? 'automation_draft')
    if (target !== 'automation_draft') {
      deny('service account so pode manter o artigo em automation_draft')
    }
    incoming.workflowStatus = 'automation_draft'
    incoming._status = 'draft'
    return incoming
  }

  /* --- Automacao PUBLICADORA: superficie ampliada, nao ilimitada ----- */
  if (autoPublisher) {
    // A lista e curta e explicita. `authors`, `primaryAuthor`, `qaPassedAt` e
    // `workflowStatus` saem dela porque sao exatamente o que a autopublicacao
    // precisa escrever — e o que o gate de publicacao vai conferir logo abaixo,
    // no servidor, contra o estado real do documento.
    //
    // O que continua fora do alcance da automacao sao as decisoes que tiram do
    // ar ou reescrevem a historia: retencao juridica, correcao, retratacao,
    // agendamento e o carimbo de publicacao (que o servidor emite).
    for (const field of AUTOMATION_PUBLISHER_FORBIDDEN_FIELDS) {
      delete incoming[field]
    }
  }

  /* --- Transicao de estado ----------------------------------------- */
  const from = operation === 'create' ? null : String(previous.workflowStatus ?? 'draft')
  const to = String(next.workflowStatus ?? 'draft') as WorkflowStatus

  if (operation === 'create') {
    // Humano nunca cria `automation_draft`: esse estado significa "veio do
    // pipeline", e mentir sobre a origem apaga a proveniencia.
    if (actorKind === 'automation_publisher') {
      // A automacao publicadora tambem NASCE em `automation_draft`: a origem
      // fica gravada no estado inicial, e a subida ate `published` percorre a
      // allowlist como qualquer outra.
      if (to !== 'automation_draft') deny('automacao cria artigo em automation_draft')
    } else {
      if (to === 'automation_draft') deny('automation_draft e criado apenas pela automacao')
      if (to !== 'draft') deny('artigo humano nasce em draft')
    }
  } else if (from !== null && to !== from) {
    const verdict = canTransition(from, to, actorKind)
    if (!verdict.allowed) deny(verdict.detail)
  }

  /* --- `_status` e DERIVADO de `workflowStatus` --------------------- */
  //
  // Mesma licao de "presenca nao e intencao", agora no `_status`: num artigo JA
  // publicado o Payload ecoa `_status: 'published'` em `data` a cada alteracao
  // de qualquer outro campo. Ler o eco como pedido de publicacao travava
  // despublicar e retratar — operacoes que PARTEM de um artigo publicado.
  // O que caracteriza intencao e a MUDANCA de nao-publicado para publicado.
  const alreadyPublished = previous._status === 'published'
  const wantsToPublish = incoming._status === 'published' && !alreadyPublished
  if (wantsToPublish && to !== 'published') {
    deny('_status "published" exige workflowStatus "published" (que so vem de ready_to_publish)')
  }

  /* --- Gate de publicacao ------------------------------------------ */
  const becomingPublic = to === 'published' && previous.workflowStatus !== 'published'
  if (becomingPublic) {
    const authorIds = idsOf(next.authors)
    const heroIds = idsOf(next.heroMedia)
    const gate = evaluatePublishGate({
      workflowStatus: String(previous.workflowStatus ?? 'draft'),
      slug: (next.slug as string | null) ?? null,
      title: (next.title as string | null) ?? null,
      language: (next.language as string | null) ?? null,
      activeAuthorCount: await countActiveAuthors(req, authorIds),
      blockingErrors: Array.isArray(next.blockingErrors)
        ? (next.blockingErrors as string[])
        : [],
      qaPassedAt: next.qaPassedAt === undefined || next.qaPassedAt === null
        ? null
        : String(next.qaPassedAt),
      aiAssisted: next.aiAssisted === true,
      externalSourceCount: Array.isArray(next.externalSources) ? next.externalSources.length : 0,
      unauthorizedMediaCount: await countUnauthorizedMedia(
        req,
        heroIds[0] ?? null,
        idsOf(next.gallery),
        bodyMediaIds(next.body),
      ),
      legalHold: next.legalHold === true,
    })
    if (!gate.canPublish) {
      deny(`publicacao bloqueada: ${gate.reasons.join(', ')}`)
    }
    // `publishedAt` e carimbado pelo SERVIDOR, no ato da publicacao.
    if (next.publishedAt === undefined || next.publishedAt === null) {
      incoming.publishedAt = new Date().toISOString()
    }
  }

  // Sincronizacao final: `workflowStatus` manda em `_status`, sempre.
  if (to === 'published') incoming._status = 'published'
  else if (previous._status === 'published') incoming._status = 'draft'

  return incoming
}

/* ------------------------------------------------------------------ */
/* afterChange — outbox                                                */
/* ------------------------------------------------------------------ */

export const emitPublicationEvent: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
  operation,
}) => {
  if (operation === 'create') return doc

  const current = doc as Record<string, unknown>
  const before = (previousDoc ?? {}) as Record<string, unknown>

  const fromStatus = String(before.workflowStatus ?? 'draft') as WorkflowStatus
  const toStatus = String(current.workflowStatus ?? 'draft') as WorkflowStatus

  const eventType = publicationEventForTransition(fromStatus, toStatus)
  // Movimento interno da redacao (draft, autosave, revisao, assignedTo): o lado
  // publico nao precisa saber, e emitir aqui poluiria a fila.
  if (eventType === null) return doc

  const event = await buildPublicationEvent({ req, doc: current, eventType })

  const built = buildOutboxRecord({
    event,
    eventType,
    articleId: String(current.id),
    articleVersionId: String(event.articleVersionId),
    availableAtIso: new Date().toISOString(),
  })
  if (!built.ok) {
    // Evento invalido NAO vai para a fila: seria veneno descoberto so no
    // consumidor. Lancar aqui derruba a transacao inteira — o artigo nao fica
    // publicado sem evento.
    throw new APIError(
      `publication-event-v1 invalido: ${built.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
      500,
    )
  }

  // Caminho normal: se o evento ja existe, nao ha o que emitir. A consulta e o
  // que evita transformar uma republicacao legitima em erro; a UNIQUE abaixo
  // continua sendo a garantia sob concorrencia, onde duas requisicoes leem
  // "nao existe" ao mesmo tempo.
  const alreadyEmitted = await req.payload.find({
    collection: 'publication-outbox',
    where: { idempotencyKey: { equals: built.record.idempotencyKey } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  if (alreadyEmitted.totalDocs > 0) return doc

  try {
    // BYPASS EXPLICITO E CONFINADO. `publication-outbox` declara `create: false`
    // para todo mundo — inclusive administrador — porque evento nao se cria a
    // mao. Esta e a UNICA escrita autorizada, e ela acontece com o MESMO `req`
    // e com `await`: sem isso a linha sairia da transacao da publicacao.
    await req.payload.create({
      collection: 'publication-outbox',
      data: {
        eventId: built.record.eventId,
        idempotencyKey: built.record.idempotencyKey,
        eventType: built.record.eventType,
        aggregateType: built.record.aggregateType,
        aggregateId: built.record.aggregateId,
        aggregateVersion: built.record.aggregateVersion,
        payload: built.record.payload as never,
        status: built.record.status,
        attempts: built.record.attempts,
        availableAt: built.record.availableAt,
      },
      overrideAccess: true,
      req,
    })
  } catch (error) {
    // A UNIQUE de `idempotency_key` e a defesa real contra duplicata sob
    // concorrencia — memoria nao serve, porque duas requisicoes simultaneas
    // leem "nao existe" ao mesmo tempo. Colisao aqui significa que o mesmo
    // evento ja foi registrado: nao e erro, e idempotencia funcionando.
    if (isUniqueViolation(error)) return doc
    throw error
  }

  return doc
}

/**
 * A falha e uma colisao de unicidade do evento?
 *
 * Duas formas, porque a colisao chega por dois caminhos diferentes:
 *  - `23505` do PostgreSQL, quando a corrida passa pela UNIQUE do banco;
 *  - `ValidationError` do Payload, que valida `unique` na camada de aplicacao
 *    ANTES de chegar ao banco e reporta o campo por nome.
 * Tratar so o 23505 fazia uma republicacao legitima virar erro de publicacao.
 */
function isUniqueViolation(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; cause?: unknown; message?: unknown; name?: unknown }

  if (candidate.code === '23505') return true
  if (
    candidate.cause !== null &&
    typeof candidate.cause === 'object' &&
    (candidate.cause as { code?: unknown }).code === '23505'
  ) {
    return true
  }

  const message = typeof candidate.message === 'string' ? candidate.message : ''
  if (message.includes('23505')) return true

  // O Payload nomeia o campo invalido; so aceitamos os DOIS campos de
  // identidade do evento, para nao engolir uma validacao de outra coisa.
  const isValidation = candidate.name === 'ValidationError'
  return isValidation && (message.includes('eventId') || message.includes('idempotencyKey'))
}

export { buildEventIdempotencyKey }
