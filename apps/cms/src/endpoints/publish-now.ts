/**
 * publish-now.ts — "Publicar" em um clique, sem afrouxar nada.
 *
 * O QUE ESTE ENDPOINT NAO E: um atalho para `published`. Ele nao escreve o
 * estado final direto, nao usa `overrideAccess`, nao desliga hook e nao inventa
 * transicao. Ele sobe a MESMA escada que a redacao subia a mao — so que numa
 * requisicao em vez de cinco.
 *
 * Cada degrau e um `payload.update` proprio, e por isso cada degrau dispara
 * `enforceEditorialGovernance` (beforeChange) e `emitPublicationEvent`
 * (afterChange) exatamente como antes. O rastro de auditoria que fica no banco
 * e indistinguivel do rastro de cinco cliques: mesmos estados, mesma ordem,
 * mesmo `updatedBy` a cada passo. Era esse o requisito — juntar os cliques,
 * nunca as transicoes.
 *
 * PRE-VOO ANTES DE ANDAR.
 *
 * O gate de publicacao so e avaliado pelo hook no ULTIMO degrau. Se a materia
 * estivesse sem autor ativo, uma subida ingenua moveria quatro degraus e
 * morreria no quinto, deixando a materia parada em `ready_to_publish` — um
 * estado que AFIRMA que houve revisao e liberacao. Por isso o gate e avaliado
 * aqui antes do primeiro passo, com o mesmo montador de fatos que o hook usa
 * (`assemblePublishGateInput`), e nada se move se ele barrar.
 */

import type { Endpoint, PayloadRequest } from 'payload'

import { toActor } from '../actor.js'
import { assemblePublishGateInput } from '../hooks/articles.js'
import { planPublishPath } from '../publish-path.js'
import { evaluatePublishGate } from '../workflow.js'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export const publishNowEndpoint: Endpoint = {
  path: '/internal/publish-now',
  method: 'post',
  handler: async (req: PayloadRequest): Promise<Response> => {
    const actor = toActor(req.user)

    // O botao e da redacao humana. Conta de servico tem o proprio caminho, com
    // quota e ator proprios — deixa-la entrar aqui contornaria os dois.
    if (actor.kind !== 'human') {
      return json({ error: 'forbidden', message: 'Apenas contas editoriais publicam por aqui.' }, 403)
    }

    let body: unknown = null
    try {
      body = JSON.parse((await req.text?.()) ?? '')
    } catch {
      return json({ error: 'invalid_json' }, 400)
    }
    const id = (body as { id?: unknown } | null)?.id
    if (typeof id !== 'string' && typeof id !== 'number') {
      return json({ error: 'missing_id' }, 400)
    }

    // Leitura de VERIFICACAO: o plano e o gate julgam o estado real do banco,
    // nunca o que o formulario afirma. `depth: 0` basta — o montador de fatos
    // resolve autor e midia por conta propria.
    let article: Record<string, unknown>
    try {
      article = (await req.payload.findByID({
        collection: 'articles',
        id,
        depth: 0,
        overrideAccess: false,
        user: req.user,
        req,
      })) as unknown as Record<string, unknown>
    } catch {
      return json({ error: 'not_found' }, 404)
    }

    const from = String(article.workflowStatus ?? 'draft')
    const plan = planPublishPath(from, actor.role)
    if (!plan.ok) {
      return json({ error: 'no_path', reason: plan.reason, from }, 409)
    }

    // Pre-voo. `ready_to_publish` e o estado em que a materia estara quando o
    // ultimo degrau for tentado — perguntar com o estado ATUAL devolveria
    // `not_ready_to_publish` para toda materia em rascunho, que e justamente o
    // que este botao existe para resolver.
    const gate = evaluatePublishGate(
      await assemblePublishGateInput(req, article, 'ready_to_publish'),
    )
    if (!gate.canPublish) {
      // Os codigos voltam crus: a traducao para portugues e o link para a aba
      // vivem em `editorial-vocabulary.ts`, que ja e a fonte unica dessas
      // frases. Traduzir aqui criaria um segundo texto para o mesmo bloqueio.
      return json({ error: 'blocked', reasons: gate.reasons, from }, 422)
    }

    // A subida. Um `update` por degrau, em ordem, cada um com access control
    // ligado e passando pelos hooks.
    const walked: string[] = []
    for (const hop of plan.path) {
      try {
        await req.payload.update({
          collection: 'articles',
          id,
          data: { workflowStatus: hop },
          overrideAccess: false,
          user: req.user,
          req,
        })
        walked.push(hop)
      } catch (error) {
        // Parou no meio. A materia fica no ultimo estado que alcancou — todos
        // legais — e a resposta diz ONDE parou, para a tela nao afirmar que
        // publicou. `message` do Payload ja vem sem payload nem credencial.
        return json(
          {
            error: 'transition_failed',
            stoppedAt: walked[walked.length - 1] ?? from,
            failedOn: hop,
            walked,
            message: error instanceof Error ? error.message : 'transicao recusada',
          },
          422,
        )
      }
    }

    return json({ ok: true, walked }, 200)
  },
}
