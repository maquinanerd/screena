/**
 * editorial-drafts.ts — `POST /api/internal/editorial-drafts`.
 *
 * ADAPTADOR FINO. Toda a decisao esta em `../draft-intake.js` (puro e testado);
 * aqui so ha IO: ler o corpo, consultar o artigo existente, gravar e responder.
 *
 * O que este arquivo NAO faz, por contrato: nao escreve no `screen-db`, nao
 * chama o `screen-app`, nao chama servico externo e nao registra o corpo do
 * draft no log (ele carrega texto de terceiro e metadados de fonte).
 */

import type { Endpoint, PayloadRequest, Where } from 'payload'

import { toActor } from '../collections.js'
import { intakeEditorialDraft, MAX_REQUEST_BYTES } from '../draft-intake.js'
import type { ExistingArticleSnapshot } from '../idempotency.js'

/** Resposta JSON compacta e sem eco do payload. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Busca o artigo que colide com este draft.
 *
 * Procura por `idempotencyKey` e, em seguida, pelo cluster de origem: o mesmo
 * acontecimento pode ter sido registrado antes com outra chave (revisao nova do
 * pipeline), e ignorar isso criaria uma segunda materia sobre o mesmo fato.
 */
async function findExistingArticle(
  req: PayloadRequest,
  idempotencyKey: string,
  sourceClusterId: string,
  targetArticleId: string | undefined,
): Promise<ExistingArticleSnapshot | null> {
  const where: Where =
    targetArticleId !== undefined
      ? { id: { equals: targetArticleId } }
      : {
          or: [
            { idempotencyKey: { equals: idempotencyKey } },
            { sourceClusterId: { equals: sourceClusterId } },
          ],
        }

  const found = await req.payload.find({
    collection: 'articles',
    where,
    limit: 1,
    depth: 0,
    // A busca acontece com privilegio do servidor: a service account nao tem
    // leitura geral da colecao, e nao deveria ganhar por um efeito colateral.
    overrideAccess: true,
    req,
  })

  const doc = found.docs[0]
  if (doc === undefined) return null

  // `doc` e o tipo GERADO por `payload generate:types`. Ler os campos direto
  // dele (em vez de um cast para `Record<string, unknown>`) faz o compilador
  // avisar se um campo for renomeado no schema do CMS.
  const workflowStatus = String(doc.workflowStatus ?? 'draft')
  return {
    articleId: String(doc.id),
    idempotencyKey: doc.idempotencyKey ?? null,
    sourceClusterId: doc.sourceClusterId ?? null,
    sourceRevision: doc.sourceRevision ?? null,
    draftPayloadHash: doc.draftPayloadHash ?? null,
    workflowStatus,
    // Qualquer estado alem de `automation_draft` significa que um humano ja
    // tocou (ou esta tocando) o texto.
    humanAuthored: workflowStatus !== 'automation_draft',
  }
}

export const editorialDraftsEndpoint: Endpoint = {
  path: '/internal/editorial-drafts',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const actor = toActor(req.user)

    let raw = ''
    try {
      raw = (await req.text?.()) ?? ''
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }
    const rawBodyBytes = Buffer.byteLength(raw, 'utf8')

    let body: unknown = null
    if (rawBodyBytes > 0 && rawBodyBytes <= MAX_REQUEST_BYTES) {
      try {
        body = JSON.parse(raw)
      } catch {
        return json({ error: 'invalid_json' }, 400)
      }
    }

    // Pre-checagem barata de identidade antes de qualquer consulta ao banco.
    const preflight = intakeEditorialDraft({
      auth: {
        authenticated: actor.kind !== 'anonymous',
        isServiceAccount: actor.kind === 'service',
        accountId: actor.kind === 'anonymous' ? null : actor.id,
      },
      rawBodyBytes,
      body,
      existing: null,
    })

    if (!preflight.ok && preflight.rejection.code !== 'idempotency_conflict') {
      return json(
        { error: preflight.rejection.code, issues: preflight.rejection.issues },
        preflight.rejection.status,
      )
    }

    const candidate = body as Record<string, unknown>
    const idempotencyKey = String(candidate.idempotencyKey ?? '')
    const sourceClusterId = String(candidate.sourceClusterId ?? '')
    const targetArticleId =
      typeof candidate.targetArticleId === 'string' ? candidate.targetArticleId : undefined

    const existing = await findExistingArticle(
      req,
      idempotencyKey,
      sourceClusterId,
      targetArticleId,
    )

    const result = intakeEditorialDraft({
      auth: {
        authenticated: actor.kind !== 'anonymous',
        isServiceAccount: actor.kind === 'service',
        accountId: actor.kind === 'anonymous' ? null : actor.id,
      },
      rawBodyBytes,
      body,
      existing,
    })

    if (!result.ok) {
      return json({ error: result.rejection.code, issues: result.rejection.issues }, result.rejection.status)
    }

    const { acceptance } = result

    // Reenvio identico: nada e escrito, e a resposta e a mesma da primeira vez.
    if (acceptance.document === null || acceptance.outcome === 'duplicate_noop') {
      return json(
        {
          outcome: acceptance.outcome,
          articleId: acceptance.articleId,
          draftPayloadHash: acceptance.identity.draftPayloadHash,
        },
        acceptance.status,
      )
    }

    const data = {
      ...acceptance.document,
      // A midia chega como CANDIDATA: fica registrada em `warnings` para o
      // revisor avaliar, e nenhuma linha de `media` e criada ou aprovada aqui.
      warnings: [
        ...acceptance.document.warnings,
        ...acceptance.mediaCandidates.map(
          (_candidateMedia, index) => `midia candidata #${index + 1} aguarda avaliacao humana`,
        ),
      ],
    }

    const articleId =
      acceptance.outcome === 'create'
        ? String(
            (
              await req.payload.create({
                collection: 'articles',
                data: data as never,
                overrideAccess: true,
                req,
              })
            ).id,
          )
        : String(
            (
              await req.payload.update({
                collection: 'articles',
                id: acceptance.articleId as string,
                data: data as never,
                overrideAccess: true,
                req,
              })
            ).id,
          )

    return json(
      {
        outcome: acceptance.outcome,
        articleId,
        workflowStatus: 'automation_draft',
        draftPayloadHash: acceptance.identity.draftPayloadHash,
      },
      acceptance.status,
    )
  },
}
