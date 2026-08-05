/**
 * publish-path.ts — O caminho mais curto ate `published`, para ESTE ator.
 *
 * PURO: sem IO, sem Payload, sem banco. E o miolo do botao "Publicar" de um
 * clique, e existe separado do `.tsx` porque o vitest deste app coleta apenas
 * `src/**\/__tests__/**\/*.test.ts` — logica dentro do componente seria logica
 * sem teste.
 *
 * POR QUE UM PLANEJADOR, E NAO UM ATALHO.
 *
 * A tentacao obvia era mandar `workflowStatus: 'published'` direto e deixar o
 * servidor resolver. Isso destruiria a governanca: `ALLOWED_TRANSITIONS` so
 * admite `published` vindo de `ready_to_publish`, e cada degrau intermediario
 * afirma um fato editorial diferente (foi revisado, foi aprovado, foi liberado).
 * Pular degrau nao e conveniencia — e afirmar revisao que nao houve.
 *
 * Entao o botao nao pula nada: ele DESCOBRE a escada e sobe degrau por degrau,
 * cada um passando pelos mesmos hooks de sempre. O que muda e o numero de
 * cliques, nunca o rastro que fica.
 *
 * A busca e em LARGURA porque o caminho mais curto e o unico defensavel: uma
 * busca em profundidade poderia devolver `draft -> needs_review ->
 * changes_requested -> draft -> ...`, passeando por estados que afirmam coisas
 * que nao aconteceram.
 */

import {
  WORKFLOW_STATUSES,
  canTransition,
  type ActorKind,
  type PublishBlockReason,
  type WorkflowStatus,
} from './workflow.js'

/** Destino fixo: o botao existe para uma coisa so. */
const TARGET: WorkflowStatus = 'published'

export type PublishPathRejection =
  /** Ja esta publicada — nao ha o que fazer. */
  | 'already_published'
  /** O estado atual nao pertence a maquina (dado corrompido). */
  | 'unknown_state'
  /**
   * Existe caminho no grafo, mas nao PARA ESTE PAPEL. E o caso do `editor`:
   * ele leva ate `ready_to_publish` e para ali, porque publicar e do
   * editor-chefe. Isso e regra de governanca, nao defeito.
   */
  | 'forbidden_for_role'

export type PublishPathPlan =
  | {
      readonly ok: true
      /**
       * Os estados a ATRAVESSAR, em ordem, sem incluir o atual e terminando em
       * `published`. De `draft` sao cinco; de `automation_draft`, dois.
       */
      readonly path: readonly WorkflowStatus[]
    }
  | { readonly ok: false; readonly reason: PublishPathRejection }

function isWorkflowStatus(value: string): value is WorkflowStatus {
  return (WORKFLOW_STATUSES as readonly string[]).includes(value)
}

/**
 * Planeja a subida de `from` ate `published` para `actor`.
 *
 * Usa apenas `canTransition`, que ja e a autoridade sobre "degrau existe" E
 * "papel alcanca". Reimplementar a tabela aqui criaria uma segunda verdade que
 * derivaria da primeira no primeiro estado novo.
 *
 * A varredura segue a ordem declarada em `WORKFLOW_STATUSES`, entao o plano e
 * deterministico: mesma entrada, mesmo caminho, sempre.
 */
export function planPublishPath(from: string, actor: ActorKind): PublishPathPlan {
  if (!isWorkflowStatus(from)) return { ok: false, reason: 'unknown_state' }
  if (from === TARGET) return { ok: false, reason: 'already_published' }

  // BFS. `cameFrom` guarda o predecessor de cada estado alcancado, e e o que
  // permite reconstruir o caminho no fim sem carregar listas pela fila.
  const cameFrom = new Map<WorkflowStatus, WorkflowStatus>()
  const seen = new Set<WorkflowStatus>([from])
  let frontier: WorkflowStatus[] = [from]

  while (frontier.length > 0) {
    const next: WorkflowStatus[] = []
    for (const current of frontier) {
      for (const candidate of WORKFLOW_STATUSES) {
        if (seen.has(candidate)) continue
        if (!canTransition(current, candidate, actor).allowed) continue
        seen.add(candidate)
        cameFrom.set(candidate, current)
        if (candidate === TARGET) return { ok: true, path: rebuild(cameFrom, from, TARGET) }
        next.push(candidate)
      }
    }
    frontier = next
  }

  // O grafo tem caminho (todo estado chega a `ready_to_publish`), mas o papel
  // nao fecha o ultimo degrau. Dizer "impossivel" seria mentir sobre o motivo.
  return { ok: false, reason: 'forbidden_for_role' }
}

/**
 * Dos motivos de bloqueio, quais AINDA valem para o botao de um clique.
 *
 * `not_ready_to_publish` sai — e a unica pendencia que subir a escada resolve,
 * e e o estado normal de toda materia em rascunho. Mante-la desabilitaria o
 * botao exatamente onde ele serve. Todos os outros motivos ficam: sem autor
 * ativo, sem QA, com midia sem licenca ou sob retencao juridica, percorrer os
 * degraus nao resolveria nada, e o ultimo recusaria de qualquer forma.
 *
 * E o espelho, no cliente, do que o servidor faz no pre-voo — la o gate e
 * consultado com `ready_to_publish` no lugar do estado atual, o que remove
 * este mesmo motivo e preserva os demais.
 *
 * Vive aqui, e nao dentro do componente, porque o vitest deste app nao coleta
 * `.tsx`: a regra so vira teste se for uma funcao.
 */
export function blocksForOneClickPublish(
  reasons: readonly PublishBlockReason[],
): readonly PublishBlockReason[] {
  return reasons.filter((reason) => reason !== 'not_ready_to_publish')
}

function rebuild(
  cameFrom: ReadonlyMap<WorkflowStatus, WorkflowStatus>,
  from: WorkflowStatus,
  to: WorkflowStatus,
): readonly WorkflowStatus[] {
  const reversed: WorkflowStatus[] = []
  let cursor: WorkflowStatus = to
  while (cursor !== from) {
    reversed.push(cursor)
    const previous = cameFrom.get(cursor)
    // Nao acontece: todo estado na fila entrou com predecessor. A guarda existe
    // para o tipo, e para nao girar em falso se isso mudar.
    if (previous === undefined) break
    cursor = previous
  }
  return reversed.reverse()
}
