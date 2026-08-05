/**
 * O planejador do botao "Publicar" de um clique.
 *
 * O que estes testes protegem nao e o caminho bonito — e a impossibilidade de
 * pular degrau. Um plano que levasse `draft` direto a `published` afirmaria
 * revisao que nunca houve, e passaria despercebido porque o resultado final
 * (materia no ar) seria o mesmo.
 */

import { describe, expect, it } from 'vitest'

import { blocksForOneClickPublish, planPublishPath } from '../publish-path.js'
import { WORKFLOW_STATUSES, canTransition, type WorkflowStatus } from '../workflow.js'

describe('planPublishPath', () => {
  it('sobe de draft ate published pelos cinco degraus, na ordem da governanca', () => {
    const plan = planPublishPath('draft', 'administrator')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.path).toEqual([
      'needs_review',
      'in_review',
      'human_reviewed',
      'ready_to_publish',
      'published',
    ])
  })

  it('CONTROLE NEGATIVO: nenhum plano contem um salto que canTransition recuse', () => {
    // Sem esta prova, um plano poderia inventar um degrau e os outros testes
    // continuariam verdes — eles so olham o comeco e o fim.
    for (const from of WORKFLOW_STATUSES as readonly WorkflowStatus[]) {
      const plan = planPublishPath(from, 'administrator')
      if (!plan.ok) continue
      let cursor: WorkflowStatus = from
      for (const hop of plan.path) {
        const verdict = canTransition(cursor, hop, 'administrator')
        expect(verdict.allowed, `${cursor} -> ${hop} nao e transicao valida`).toBe(true)
        cursor = hop
      }
      expect(cursor).toBe('published')
    }
  })

  it('prova que o detector acha o salto proibido quando ele existe', () => {
    // Controle do controle: se `canTransition` deixasse passar qualquer coisa,
    // o teste acima seria vacuo. Aqui o salto proibido e verificado de fato.
    expect(canTransition('draft', 'published', 'administrator').allowed).toBe(false)
  })

  it('automation_draft chega em dois degraus, sem passar por revisao humana falsa', () => {
    const plan = planPublishPath('automation_draft', 'administrator')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    // `automation_draft -> ready_to_publish` existe no grafo justamente para a
    // autopublicacao nao AFIRMAR revisao humana que nao houve.
    expect(plan.path).toEqual(['ready_to_publish', 'published'])
    expect(plan.path).not.toContain('human_reviewed')
  })

  it('editor sobe ate o fim da propria alcada e para: publicar e do editor-chefe', () => {
    const plan = planPublishPath('draft', 'editor')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toBe('forbidden_for_role')
    // NAO para em `draft`: anda ate a fronteira da alcada. `editor` alcanca
    // `ready_to_publish` (so `published` e do editor-chefe).
    expect(plan.partialPath[plan.partialPath.length - 1]).toBe('ready_to_publish')
    expect(plan.partialPath).not.toContain('published')
  })

  it('writer para em needs_review, que e onde a alcada dele termina', () => {
    const plan = planPublishPath('draft', 'writer')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    // `writer` so alcanca `draft` e `needs_review` — nao revisa nem libera.
    expect(plan.partialPath).toEqual(['needs_review'])
  })

  it('CONTROLE NEGATIVO: o caminho parcial tambem nao contem salto invalido', () => {
    // O parcial e escrito no banco como o completo. Se ele pudesse pular
    // degrau, o bypass entraria justamente pela porta de quem tem MENOS
    // permissao — o pior lugar possivel.
    for (const role of ['writer', 'editor', 'reviewer'] as const) {
      for (const from of WORKFLOW_STATUSES as readonly WorkflowStatus[]) {
        const plan = planPublishPath(from, role)
        if (plan.ok) continue
        let cursor: WorkflowStatus = from
        for (const hop of plan.partialPath) {
          expect(
            canTransition(cursor, hop, role).allowed,
            `${role}: ${cursor} -> ${hop} nao e transicao valida`,
          ).toBe(true)
          cursor = hop
        }
      }
    }
  })

  it('o caminho parcial nunca leva a materia para um estado que IMPEDE publicar', () => {
    for (const role of ['writer', 'editor', 'reviewer'] as const) {
      for (const from of WORKFLOW_STATUSES as readonly WorkflowStatus[]) {
        const plan = planPublishPath(from, role)
        if (plan.ok) continue
        for (const dead of ['blocked', 'archived', 'retracted']) {
          expect(plan.partialPath, `${role} partindo de ${from}`).not.toContain(dead)
        }
      }
    }
  })

  it('editor_in_chief publica', () => {
    expect(planPublishPath('draft', 'editor_in_chief').ok).toBe(true)
  })

  it('materia ja publicada nao gera plano', () => {
    const plan = planPublishPath('published', 'administrator')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toBe('already_published')
  })

  it('estado fora da maquina e recusado em vez de virar caminho inventado', () => {
    const plan = planPublishPath('publicado', 'administrator')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.reason).toBe('unknown_state')
  })

  it('o plano e o mais CURTO, nao apenas um valido', () => {
    // De `needs_update` o caminho curto e ready_to_publish -> published. Um
    // passeio por needs_review/in_review seria valido e mais longo — e faria a
    // materia afirmar uma segunda revisao que ninguem pediu.
    const plan = planPublishPath('needs_update', 'administrator')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.path).toEqual(['ready_to_publish', 'published'])
  })

  it('todo estado nao-terminal tem plano para administrator', () => {
    const semPlano = (WORKFLOW_STATUSES as readonly WorkflowStatus[])
      .filter((status) => status !== 'published')
      .filter((status) => !planPublishPath(status, 'administrator').ok)
    expect(semPlano).toEqual([])
  })

  it('o plano nunca passa por blocked nem archived', () => {
    // Atravessar `blocked` para publicar seria absurdo: e o estado que existe
    // para IMPEDIR publicacao.
    for (const from of WORKFLOW_STATUSES as readonly WorkflowStatus[]) {
      const plan = planPublishPath(from, 'administrator')
      if (!plan.ok) continue
      expect(plan.path, `partindo de ${from}`).not.toContain('blocked')
      expect(plan.path, `partindo de ${from}`).not.toContain('archived')
    }
  })

  it('rascunho sem pendencia real habilita o botao de um clique', () => {
    // O defeito que o E2E pegou: de `draft` o gate de previsao sempre devolve
    // `not_ready_to_publish`, e o botao nascia desabilitado no unico lugar
    // onde ele serve. Publicar em um clique E sair de `draft`.
    expect(blocksForOneClickPublish(['not_ready_to_publish'])).toEqual([])
  })

  it('CONTROLE NEGATIVO do detector de pendencias: ele NAO deixa passar o resto', () => {
    // Este teste existe porque o defeito real foi o oposto — o botao ficava
    // desabilitado sempre. Um filtro largo demais criaria o defeito espelhado:
    // botao habilitado prometendo publicar o que o servidor recusaria.
    const restantes = blocksForOneClickPublish([
      'not_ready_to_publish',
      'missing_active_author',
      'qa_not_passed',
      'legal_hold',
    ])
    expect(restantes).toEqual(['missing_active_author', 'qa_not_passed', 'legal_hold'])
  })

  it('service e automation_publisher nao usam este botao', () => {
    // O botao e da redacao humana. A automacao tem o proprio caminho, com
    // quota e ator proprios.
    expect(planPublishPath('draft', 'service').ok).toBe(false)
  })
})
