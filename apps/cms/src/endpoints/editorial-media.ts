/**
 * editorial-media.ts — `POST /api/internal/editorial-media`.
 *
 * ADAPTADOR FINO. Toda a decisao esta em `../media-intake.js` (puro e testado);
 * aqui so ha IO: ler o corpo, conferir o artigo, procurar a entrada anterior,
 * gravar o upload e responder.
 *
 * O QUE ESTA ROTA FAZ QUE NENHUMA OUTRA FAZIA. Ate aqui a foto so entrava com um
 * humano arrastando arquivo no painel. O MNScr entrega a materia inteira menos a
 * imagem — e era esse o ultimo bloqueio para a foto ir ao ar sem intervencao.
 *
 * O QUE ELA NAO FAZ, por contrato:
 *  - nao cria materia (isso e `editorial-drafts`), nao publica, nao mexe em
 *    `workflowStatus` e NAO APONTA A CAPA — ver `media-intake.ts` para o motivo
 *    (o hook de governanca rebaixaria a materia a `automation_draft`);
 *  - nao BAIXA de `sourceUrl`. Os bytes vem no corpo. Seguir um link escrito por
 *    terceiro seria buscar conteudo num host arbitrario com a credencial do CMS
 *    no bolso (SSRF); `sourceUrl` e prova de origem, nao endereco de download;
 *  - nao escreve no `screen-db` nem chama o `screen-app`. A projecao publica
 *    continua sendo do worker, pela outbox.
 *
 * LICENCA (decisao do operador, 2026-08-06). A midia ingerida nasce `approved` +
 * `allowedForEditorial` + `allowedForHero`: imagem de robo e publica sempre. A
 * proveniencia serve para ATENDER RECLAMACAO — saber de onde veio e tirar do ar
 * em minutos —, nao para bloquear. Por isso ela e exigida na ENTRADA, aqui, onde
 * ha um emissor para receber o `422`; recusar depois, na entrega, seria uma
 * imagem que some sem ninguem ficar sabendo.
 */

import { createHash } from 'node:crypto'

import type { Endpoint, PayloadRequest, Where } from 'payload'

import { serviceHasScope } from '../access.js'
import { toActor } from '../actor.js'
import {
  EXTENSION_BY_MIME,
  MAX_MEDIA_REQUEST_BYTES,
  decideMediaIngestOutcome,
  intakeEditorialMedia,
  type ExistingIngestedMedia,
  type MediaIngestCommand,
} from '../media-intake.js'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** `sha256:<hex>` dos bytes. Mesmo formato do hash da projecao publica. */
function contentHashOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

/**
 * Nome de arquivo DERIVADO, nunca vindo do cliente.
 *
 * Um `filename` de terceiro carrega travessia de caminho, caracteres que o
 * storage interpreta e colisao entre materias. O hash resolve os tres de uma
 * vez, e ainda deixa o arquivo auto-identificavel no acervo.
 */
function filenameFor(command: MediaIngestCommand, contentHash: string): string {
  const hex = contentHash.slice('sha256:'.length, 'sha256:'.length + 32)
  return `mnscr-${hex}.${EXTENSION_BY_MIME[command.contentType]}`
}

/**
 * A materia existe?
 *
 * BYPASS DE LEITURA deliberado e confinado: a service account NAO le `articles`
 * (materia humana em revisao nao e assunto de pipeline), mas sem confirmar o
 * artigo a foto entraria orfa no acervo, sem chave de idempotencia utilizavel. O
 * resultado NUNCA volta ao cliente — a resposta carrega so `outcome`, `mediaId`
 * e o hash.
 */
async function findArticle(req: PayloadRequest, articleId: string): Promise<number | null> {
  // A PK de `articles` e INTEIRA no PostgreSQL. `intakeEditorialMedia` ja
  // garantiu que a string e so digitos; aqui ela vira numero para o Payload.
  const numericId = Number(articleId)
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null
  try {
    const doc = await req.payload.findByID({
      collection: 'articles',
      id: numericId,
      depth: 0,
      overrideAccess: true,
      req,
    })
    return doc === null || doc === undefined ? null : Number(doc.id)
  } catch {
    // `findByID` levanta quando nao existe. Um id inexistente e resposta de
    // negocio (404 nomeado), nao erro de servidor.
    return null
  }
}

/**
 * A entrada anterior deste par (artigo, sourceUrl), se houver.
 *
 * `articleId` nulo = foto que ainda nao tem materia. A idempotencia continua
 * existindo, so muda de chave: em vez de (artigo, url), ela vira (SEM artigo,
 * url). Procurar por url apenas juntaria a foto sem dono com a foto de uma
 * materia qualquer que usou a mesma URL — e devolveria ao emissor um `mediaId`
 * que pertence a outra materia.
 */
async function findExistingMedia(
  req: PayloadRequest,
  articleId: number | null,
  sourceUrl: string,
): Promise<ExistingIngestedMedia | null> {
  const where: Where = {
    and: [
      articleId === null
        ? { ingestedForArticle: { exists: false } }
        : { ingestedForArticle: { equals: articleId } },
      { sourceUrl: { equals: sourceUrl } },
    ],
  }
  const found = await req.payload.find({
    collection: 'media',
    where,
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const doc = found.docs[0]
  if (doc === undefined) return null
  return {
    mediaId: String(doc.id),
    contentHash: typeof doc.contentHash === 'string' ? doc.contentHash : null,
  }
}

export const editorialMediaEndpoint: Endpoint = {
  path: '/internal/editorial-media',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const actor = toActor(req.user)

    let rawBody = ''
    try {
      rawBody = (await req.text?.()) ?? ''
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }
    const rawBodyBytes = Buffer.byteLength(rawBody, 'utf8')

    let body: unknown = null
    if (rawBodyBytes > 0 && rawBodyBytes <= MAX_MEDIA_REQUEST_BYTES) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        return json({ error: 'invalid_json' }, 400)
      }
    }

    const decision = intakeEditorialMedia({
      auth: {
        authenticated: req.user !== null && req.user !== undefined,
        hasMediaIngestScope: serviceHasScope(actor, 'editorial_media_ingest'),
        accountId: actor.kind === 'anonymous' ? null : actor.id,
      },
      rawBodyBytes,
      body,
    })

    if (!decision.ok) {
      const { code, status, issues } = decision.rejection
      return json(issues.length > 0 ? { error: code, issues } : { error: code }, status)
    }

    const command = decision.command

    // SEM `articleId` a foto entra sem dono, e isso e um caminho declarado, nao
    // um descuido: o bloco `image` do contrato referencia `media[].mediaId` do
    // MESMO pedido, entao a foto precisa existir ANTES da primeira publicacao.
    // Ver `MediaIngestCommand.articleId`.
    //
    // O preco: foto ingerida e nunca referenciada fica orfa no acervo. E o mesmo
    // preco de qualquer upload que o redator faz e depois nao usa, e o acervo ja
    // sabe conviver com ele.
    let articleId: number | null = null
    if (command.articleId !== null) {
      articleId = await findArticle(req, command.articleId)
      if (articleId === null) {
        return json({ error: 'article_not_found', issues: ['articleId nao existe'] }, 404)
      }
    }

    const contentHash = contentHashOf(command.bytes)

    let existing: ExistingIngestedMedia | null = null
    try {
      existing = await findExistingMedia(req, articleId, command.sourceUrl)
    } catch {
      // Falha de leitura NAO pode virar "nao existe": isso criaria uma segunda
      // entrada a cada reenvio, que e exatamente o defeito que a idempotencia
      // existe para impedir. Sem confirmacao, recusamos e o emissor repete.
      return json({ error: 'idempotency_unavailable' }, 503)
    }

    const outcome = decideMediaIngestOutcome(existing, contentHash)

    if (outcome === 'unchanged' && existing !== null) {
      // Reenvio identico: nenhum upload novo, nenhuma escrita. A resposta e a
      // mesma de quando foi criada, para o emissor nao precisar distinguir.
      return json({ outcome, mediaId: existing.mediaId, contentHash }, 200)
    }

    let created: { id: unknown }
    try {
      created = await req.payload.create({
        collection: 'media',
        // `editorialAssetAccess.create` e de HUMANO (`canAuthorContent`). O
        // bypass aqui e a razao de existir um escopo proprio: a autorizacao
        // desta rota e o escopo, verificado acima, e nao a politica generica da
        // collection.
        overrideAccess: true,
        req,
        data: {
          alt: command.alt,
          caption: command.caption ?? undefined,
          credit: command.credit,
          sourceName: command.sourceName,
          sourceUrl: command.sourceUrl,
          rightsHolder: command.rightsHolder,
          // DECISAO DO OPERADOR: imagem de robo e publica sempre. A
          // proveniencia acima e o que responde reclamacao.
          licenseStatus: 'approved',
          requiresAttribution: true,
          allowedForEditorial: true,
          allowedForHero: true,
          // Social fica FALSE: card de rede social e outra superficie, com outro
          // acordo de uso. Ligar por simetria seria decidir sem base.
          allowedForSocial: false,
          provenanceType: 'external_source',
          contentHash,
          // `undefined` deixa a relacao vazia; `null` seria uma escrita
          // explicita de "sem artigo", que o Payload trata diferente em update.
          ingestedForArticle: articleId ?? undefined,
        },
        file: {
          data: Buffer.from(command.bytes),
          mimetype: command.contentType,
          name: filenameFor(command, contentHash),
          size: command.bytes.length,
        },
      })
    } catch {
      // Sem eco do erro do Payload/driver: ele carrega caminho de filesystem e,
      // em alguns modos, a URL do banco.
      return json({ error: 'media_write_failed' }, 500)
    }

    const mediaId = String(created.id)


    return json({ outcome, mediaId, contentHash }, outcome === 'created' ? 201 : 200)
  },
}
