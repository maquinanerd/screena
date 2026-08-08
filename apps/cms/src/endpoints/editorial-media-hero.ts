/**
 * editorial-media-hero.ts — `PATCH /api/internal/editorial-media/:mediaId/hero`.
 *
 * ADAPTADOR FINO. Toda a decisao — e o motivo de cada limite — esta em
 * `../hero-link.js` (puro e testado sem servidor). Aqui so ha IO: ler o corpo,
 * ler a foto, ler a materia, gravar a relacao e responder.
 *
 * O QUE ESTA ROTA RESOLVE. `POST /internal/editorial-media` exige `articleId`,
 * que so existe depois da materia criada; e `media[].mediaId` do contrato de
 * publicacao precisa existir no momento do envio. Quem entrega texto e foto em
 * duas chamadas nunca fecha o circuito na mesma rodada. Esta rota fecha — sem
 * atravessar o eixo de revisao.
 *
 * O QUE ELA NAO FAZ: nao muda `workflowStatus`, nao consome cota, nao le nem
 * escreve `sourceRevision`, nao emite evento na outbox e nao escreve no
 * `screen-db`. Ver `hero-link.ts` para o porque de cada um.
 *
 * ESCRITA MINIMA, E DE PROPOSITO. O `data` do update carrega UM campo:
 * `heroMedia`. E ele viaja com `context.heroMediaLink`, que abre no hook de
 * governanca a UNICA excecao existente: nessa escrita o hook nao forca
 * `workflowStatus` nem `_status` — preserva os dois valores anteriores.
 *
 * O `context` e a peca de seguranca, e nao um detalhe de implementacao: ele e
 * montado NO PROCESSO, por este handler, e nenhum cliente HTTP consegue
 * preencher — o mesmo mecanismo que `publish-now.ts` usa para o rastro do
 * colapso. Se a excecao dependesse de olhar o `data`, ela seria inutil: o
 * Payload ecoa TODOS os campos da collection em `data`, entao "so veio
 * heroMedia" nao e uma pergunta que o hook consiga responder.
 */

import type { Endpoint, PayloadRequest } from 'payload'

import { serviceHasScope } from '../access.js'
import { toActor } from '../actor.js'
import {
  MAX_HERO_LINK_REQUEST_BYTES,
  decideHeroLink,
  intakeHeroLink,
  type HeroLinkArticleFacts,
  type HeroLinkMediaFacts,
} from '../hero-link.js'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Id de uma relacao, venha ele cru ou populado.
 *
 * O Payload popula relacao conforme a profundidade da leitura, e `depth: 0` nao
 * e garantia em toda versao: ler so o numero deixaria `heroMedia` como objeto
 * virar `null`, e a rota concluiria "sem capa" numa materia que tem capa — o
 * pior desfecho possivel, porque ela sobrescreveria em silencio.
 */
function relationId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return text(value)
  if (typeof value === 'object' && 'id' in value) {
    return text(String((value as { id: unknown }).id))
  }
  return null
}

/** Documento de `media`, ou `null` quando nao existe. Nunca levanta. */
async function readMedia(
  req: PayloadRequest,
  mediaId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const doc = await req.payload.findByID({
      collection: 'media',
      id: Number(mediaId),
      depth: 0,
      // BYPASS DELIBERADO, igual ao da rota de ingestao: a autorizacao desta
      // rota e o ESCOPO, conferido acima, e nao a politica generica da
      // collection (que e de humano). O documento nunca volta ao cliente — a
      // resposta carrega so `outcome` e os dois ids que o pedido ja tinha.
      overrideAccess: true,
      req,
    })
    return doc as unknown as Record<string, unknown>
  } catch {
    return null
  }
}

async function readArticle(
  req: PayloadRequest,
  articleId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const doc = await req.payload.findByID({
      collection: 'articles',
      id: Number(articleId),
      depth: 0,
      overrideAccess: true,
      req,
    })
    return doc as unknown as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Marcas que so a automacao grava — e que nenhum humano consegue gravar.
 *
 * As tres estao em `HUMAN_FORBIDDEN_FIELDS` (`../access.js`): o hook de
 * governanca as remove de todo payload de pessoa, tanto no painel quanto na
 * REST API. Por isso servem de prova de origem, e nao apenas de indicio.
 *
 * TRES, e nao uma, porque os dois intakes gravam conjuntos diferentes:
 * `/internal/editorial-drafts` grava `automationDraftId` + `sourceClusterId`;
 * `/internal/editorial-publications` grava `automationActorId` +
 * `sourceClusterId`. Exigir so o campo de um dos dois deixaria o outro caminho
 * de fora — que e a forma do defeito que esta correcao fecha.
 */
const AUTOMATION_ORIGIN_FIELDS = [
  'sourceClusterId',
  'automationDraftId',
  'automationActorId',
] as const

function hasAutomationOrigin(doc: Record<string, unknown>): boolean {
  return AUTOMATION_ORIGIN_FIELDS.some((field) => text(doc[field]) !== null)
}

function mediaFacts(doc: Record<string, unknown> | null): HeroLinkMediaFacts {
  if (doc === null) {
    // Fail-closed: nada verificado, nada autorizado.
    return {
      exists: false,
      ingestedForArticleId: null,
      licenseApproved: false,
      allowedForHero: false,
    }
  }
  return {
    exists: true,
    ingestedForArticleId: relationId(doc.ingestedForArticle),
    licenseApproved: doc.licenseStatus === 'approved' && doc.allowedForEditorial === true,
    allowedForHero: doc.allowedForHero === true,
  }
}

export const editorialMediaHeroEndpoint: Endpoint = {
  path: '/internal/editorial-media/:mediaId/hero',
  method: 'patch',
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
    if (rawBodyBytes > 0 && rawBodyBytes <= MAX_HERO_LINK_REQUEST_BYTES) {
      try {
        body = JSON.parse(rawBody)
      } catch {
        return json({ error: 'invalid_json' }, 400)
      }
    }

    const intake = intakeHeroLink({
      auth: {
        authenticated: req.user !== null && req.user !== undefined,
        // O MESMO escopo da ingestao de bytes, e nao um terceiro: quem ja pode
        // POR a foto no acervo daquela materia nao ganha poder novo ao dizer
        // qual delas e a capa. `draft_ingest` continua sem alcance nenhum aqui —
        // e isso e travado por teste.
        hasMediaIngestScope: serviceHasScope(actor, 'editorial_media_ingest'),
      },
      rawBodyBytes,
      mediaIdParam: (req.routeParams as { mediaId?: unknown } | undefined)?.mediaId,
      body,
    })

    if (!intake.ok) {
      const { code, status, issues } = intake.rejection
      return json(issues.length > 0 ? { error: code, issues } : { error: code }, status)
    }

    const command = intake.command

    const [mediaDoc, articleDoc] = await Promise.all([
      readMedia(req, command.mediaId),
      readArticle(req, command.articleId),
    ])

    // A capa ATUAL precisa da propria proveniencia para a rota saber se pode
    // troca-la. Uma leitura a mais, e so quando ha capa: sem ela, a unica
    // alternativa seria presumir — e presumir aqui significa sobrescrever a
    // escolha de um humano.
    const currentHeroMediaId = articleDoc === null ? null : relationId(articleDoc.heroMedia)
    const currentHero =
      currentHeroMediaId === null ? null : await readMedia(req, currentHeroMediaId)

    const article: HeroLinkArticleFacts = {
      exists: articleDoc !== null,
      workflowStatus: articleDoc === null ? null : text(articleDoc.workflowStatus),
      automationOrigin: articleDoc !== null && hasAutomationOrigin(articleDoc),
      currentHeroMediaId,
      currentHeroIngestedForArticleId:
        currentHero === null ? null : relationId(currentHero.ingestedForArticle),
    }

    const decision = decideHeroLink({ command, media: mediaFacts(mediaDoc), article })
    if (!decision.ok) {
      const { code, status, issues } = decision.rejection
      return json(issues.length > 0 ? { error: code, issues } : { error: code }, status)
    }

    const responseBody = {
      outcome: decision.outcome,
      articleId: command.articleId,
      mediaId: command.mediaId,
      previousMediaId: currentHeroMediaId,
    }

    // `unchanged` NAO ESCREVE. Nao e otimizacao: cada `update` cria uma linha de
    // versao, e um pipeline que reenvia a cada revisao encheria o historico da
    // materia com versoes que nao mudaram nada.
    if (decision.outcome === 'unchanged') return json(responseBody, 200)

    try {
      await req.payload.update({
        collection: 'articles',
        id: Number(command.articleId),
        // UM CAMPO SO. Ver o cabecalho: tudo o que nao esta aqui e o que esta
        // rota promete nao tocar.
        data: { heroMedia: Number(command.mediaId) } as never,
        overrideAccess: true,
        // A EXCECAO DO HOOK, e ela vive AQUI porque so aqui ela e verdadeira.
        // Sem esta chave o hook forca `automation_draft` e a escrita e negada
        // em toda materia que ja saiu daquele estado — que, no caminho real, e
        // toda materia (ver o cabecalho de `../hero-link.js`).
        context: { ...(req.context ?? {}), heroMediaLink: true },
        req,
      })
    } catch (error) {
      // Sem eco do erro do Payload/driver na RESPOSTA: ele carrega caminho de
      // filesystem e, em alguns modos, a URL do banco.
      //
      // Mas nao em silencio. Chegar aqui significa que a decisao aprovou e a
      // escrita ainda assim falhou — o caso mais provavel e uma recusa do hook
      // de governanca por um motivo que esta rota nao previu, e sem esta linha
      // ele viraria um `500` sem causa nenhuma no servidor.
      req.payload.logger.error({
        msg: 'capa editorial nao pode ser gravada',
        articleId: command.articleId,
        mediaId: command.mediaId,
        errorKind: error instanceof Error ? error.constructor.name : typeof error,
      })
      return json({ error: 'hero_write_failed' }, 500)
    }

    return json(responseBody, 200)
  },
}
