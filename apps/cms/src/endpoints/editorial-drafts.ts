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

import { toActor } from '../actor.js'
import { serviceHasScope } from '../access.js'
import {
  collectAcervoMediaRefs,
  intakeEditorialDraft,
  MAX_REQUEST_BYTES,
  type AcervoMediaIndex,
} from '../draft-intake.js'
import type { ResolvedMediaId } from '../editorial-body-mapper.js'
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
    // BYPASS DE LEITURA, deliberado e confinado. A service account NAO tem
    // `read` em `articles` (um draft humano em revisao nao e assunto de
    // pipeline). Mas a decisao de idempotencia precisa do estado real, senao
    // um reenvio criaria materia duplicada. O resultado NUNCA volta ao cliente:
    // a resposta carrega so `outcome`, `articleId` e o hash.
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

/**
 * Quais referencias de acervo declaradas no draft EXISTEM mesmo em `media`?
 *
 * O filtro numerico nao e cosmetico: a PK de `media` no PostgreSQL e inteira, e
 * mandar `'catalog-image-7788'` para um `where id in (...)` compara texto com
 * inteiro. Referencia nao numerica simplesmente nao tem como apontar para uma
 * linha — resolver para nada e a resposta correta, nao um contorno.
 *
 * Falha de leitura devolve indice VAZIO (fail-closed): sem confirmacao, nenhuma
 * imagem ganha relacao de midia. O bloco entao vira aviso nomeado para o
 * revisor, que e melhor do que um vinculo que nao conseguimos verificar.
 */
async function resolveAcervoMedia(
  req: PayloadRequest,
  refs: readonly string[],
): Promise<AcervoMediaIndex> {
  const numeric = refs.filter((ref) => /^\d+$/.test(ref))
  if (numeric.length === 0) return new Map()
  try {
    const found = await req.payload.find({
      collection: 'media',
      where: { id: { in: numeric } },
      limit: numeric.length,
      depth: 0,
      // Leitura INTERNA de verificacao: precisa do estado real do acervo, e o
      // resultado nunca volta ao cliente.
      overrideAccess: true,
      req,
    })
    const index = new Map<string, ResolvedMediaId>()
    for (const media of found.docs) index.set(String(media.id), media.id)
    return index
  } catch {
    return new Map()
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
        // AUTENTICADO e IDENTIDADE UTILIZAVEL sao perguntas diferentes. O Payload
        // pode reconhecer a credencial (`req.user`) enquanto `toActor` rebaixa a
        // conta a anonima por estar INATIVA. Colapsar as duas devolveria 401
        // ("quem e voce?") para quem a plataforma sabe exatamente quem e — o
        // certo e 403 ("sei quem voce e, e voce nao pode").
        authenticated: req.user !== null && req.user !== undefined,
        hasIngestScope: serviceHasScope(actor, 'draft_ingest'),
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
    const acervoMedia = await resolveAcervoMedia(req, collectAcervoMediaRefs(body))

    const result = intakeEditorialDraft({
      auth: {
        // AUTENTICADO e IDENTIDADE UTILIZAVEL sao perguntas diferentes. O Payload
        // pode reconhecer a credencial (`req.user`) enquanto `toActor` rebaixa a
        // conta a anonima por estar INATIVA. Colapsar as duas devolveria 401
        // ("quem e voce?") para quem a plataforma sabe exatamente quem e — o
        // certo e 403 ("sei quem voce e, e voce nao pode").
        authenticated: req.user !== null && req.user !== undefined,
        hasIngestScope: serviceHasScope(actor, 'draft_ingest'),
        accountId: actor.kind === 'anonymous' ? null : actor.id,
      },
      rawBodyBytes,
      body,
      existing,
      acervoMedia,
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
                // ESCRITA EM NOME DO ATOR: respeita o access control da
                // collection. A Local API ignora `access` por padrao — o
                // `false` explicito e o que impede este caminho de virar uma
                // porta dos fundos para quem nao poderia escrever.
                overrideAccess: false,
                user: req.user,
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
                overrideAccess: false,
                user: req.user,
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
