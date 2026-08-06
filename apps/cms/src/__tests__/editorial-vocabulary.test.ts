/**
 * Testes do vocabulario editorial da interface.
 *
 * O que estes testes protegem NAO e a redacao das frases: e a DERIVACAO. A barra
 * de transicao so pode oferecer o que `canTransition` permite. No dia em que
 * alguem editar a allowlist de `workflow.ts`, estes testes falham se a interface
 * tiver criado uma segunda verdade.
 */

import { describe, expect, it } from 'vitest'

import {
  ARTICLE_TABS,
  explainServerRejection,
  mediaBlockReason,
  partialAdvanceMessage,
  PUBLISH_BLOCK_EXPLANATIONS,
  ROLE_LABELS,
  STATUS_HINTS,
  STATUS_LABELS,
  STATUS_TONES,
  TRANSITION_LABELS,
  transitionsFrom,
  showsAutomationTab,
  waitingForLabel,
} from '../admin/editorial-vocabulary.js'
import { canTransition, WORKFLOW_STATUSES, type WorkflowStatus } from '../workflow.js'

describe('cobertura do vocabulario', () => {
  it('todos os 12 estados tem rotulo, dica, tom e rotulo de acao', () => {
    for (const status of WORKFLOW_STATUSES) {
      expect(STATUS_LABELS[status], status).toBeTruthy()
      expect(STATUS_HINTS[status], status).toBeTruthy()
      expect(STATUS_TONES[status], status).toBeTruthy()
      expect(TRANSITION_LABELS[status], status).toBeTruthy()
    }
  })

  it('os 10 motivos de bloqueio tem frase e aba conhecida', () => {
    const tabs = Object.values(ARTICLE_TABS)
    const reasons = Object.keys(PUBLISH_BLOCK_EXPLANATIONS)
    expect(reasons).toHaveLength(10)
    for (const reason of reasons) {
      const explanation = PUBLISH_BLOCK_EXPLANATIONS[reason as keyof typeof PUBLISH_BLOCK_EXPLANATIONS]
      expect(explanation.message, reason).not.toBe('')
      // Frase, nao codigo: se o `_` sobrar, alguem ecoou o identificador.
      expect(explanation.message, reason).not.toContain('_')
      expect(tabs, reason).toContain(explanation.tab)
    }
  })
})

describe('transicoes derivadas de canTransition', () => {
  it('nunca oferece ao ator uma transicao que o servidor recusaria', () => {
    for (const from of WORKFLOW_STATUSES) {
      for (const role of ['administrator', 'editor_in_chief', 'editor', 'reviewer', 'writer'] as const) {
        for (const option of transitionsFrom(from, role)) {
          if (!option.allowedForActor) continue
          expect(
            canTransition(from, option.to, role).allowed,
            `${role}: ${from} -> ${option.to}`,
          ).toBe(true)
        }
      }
    }
  })

  it('nunca esconde uma transicao que o servidor permitiria', () => {
    for (const from of WORKFLOW_STATUSES) {
      for (const role of ['administrator', 'editor_in_chief', 'writer'] as const) {
        const offered = new Set(
          transitionsFrom(from, role)
            .filter((option) => option.allowedForActor)
            .map((option) => option.to),
        )
        for (const to of WORKFLOW_STATUSES) {
          if (canTransition(from, to, role).allowed) {
            expect(offered.has(to), `${role}: ${from} -> ${to} sumiu da barra`).toBe(true)
          }
        }
      }
    }
  })

  it('editor NAO publica, e a barra diz de quem se espera', () => {
    const options = transitionsFrom('ready_to_publish', 'editor')
    const publish = options.find((option) => option.to === 'published')
    expect(publish).toBeDefined()
    expect(publish?.allowedForActor).toBe(false)
    expect(publish?.allowedRoles).toEqual(['administrator', 'editor_in_chief'])
    expect(waitingForLabel(publish?.allowedRoles ?? [])).toBe(
      'aguardando administração ou editor-chefe',
    )
  })

  it('editor-chefe publica a partir de ready_to_publish', () => {
    const publish = transitionsFrom('ready_to_publish', 'editor_in_chief').find(
      (option) => option.to === 'published',
    )
    expect(publish?.allowedForActor).toBe(true)
  })

  it('nao oferece publicar direto de draft — o caminho passa pela revisao', () => {
    const targets = transitionsFrom('draft', 'administrator')
      .filter((option) => option.allowedForActor)
      .map((option) => option.to)
    expect(targets).not.toContain('published')
    expect(targets).toContain('needs_review')
  })

  it('acoes que avancam vem antes das que retiram do ar', () => {
    const weights = transitionsFrom('published', 'administrator').map((option) => option.weight)
    const firstDanger = weights.indexOf('danger')
    const lastSafe = weights.lastIndexOf('secondary')
    if (firstDanger >= 0 && lastSafe >= 0) expect(firstDanger).toBeGreaterThan(lastSafe)
  })

  it('estado sem saida para o ator ainda explica quem alcanca', () => {
    // `writer` nao leva nada a `blocked`; a barra mostra o caminho e o dono.
    const blocked = transitionsFrom('draft', 'writer').find((option) => option.to === 'blocked')
    expect(blocked?.allowedForActor).toBe(false)
    expect(blocked?.allowedRoles.length).toBeGreaterThan(0)
  })
})

describe('traducao da recusa do servidor', () => {
  it('traduz a mensagem crua do hook', () => {
    const explained = explainServerRejection(
      'publicacao bloqueada: qa_not_passed, missing_active_author',
    )
    expect(explained).toHaveLength(2)
    expect(explained?.[0]?.message).toContain('QA')
    expect(explained?.[1]?.tab).toBe(ARTICLE_TABS.authorship)
  })

  it('devolve null para erro que nao e do gate — nao inventa causa', () => {
    expect(explainServerRejection('service account so pode manter o artigo em automation_draft')).toBeNull()
    expect(explainServerRejection('')).toBeNull()
  })

  it('ignora codigo desconhecido em vez de exibir o identificador cru', () => {
    const explained = explainServerRejection('publicacao bloqueada: motivo_que_nao_existe')
    expect(explained).toBeNull()
  })

  it('traduz mesmo com codigo desconhecido no meio', () => {
    const explained = explainServerRejection('publicacao bloqueada: motivo_novo, missing_slug')
    expect(explained).toHaveLength(1)
    expect(explained?.[0]?.tab).toBe(ARTICLE_TABS.content)
  })
})

describe('licenca de midia', () => {
  it('licenca nao aprovada e a primeira causa reportada', () => {
    expect(
      mediaBlockReason({
        licenseStatus: 'unknown',
        allowedForEditorial: true,
        allowedForHero: true,
        usedAsHero: true,
      }),
    ).toContain('sem licença definida')
  })

  it('distingue permissao editorial de permissao de capa', () => {
    expect(
      mediaBlockReason({
        licenseStatus: 'approved',
        allowedForEditorial: false,
        allowedForHero: true,
        usedAsHero: false,
      }),
    ).toContain('uso editorial')

    expect(
      mediaBlockReason({
        licenseStatus: 'approved',
        allowedForEditorial: true,
        allowedForHero: false,
        usedAsHero: true,
      }),
    ).toContain('capa')
  })

  it('midia liberada para o corpo nao e acusada quando nao e capa', () => {
    expect(
      mediaBlockReason({
        licenseStatus: 'approved',
        allowedForEditorial: true,
        allowedForHero: false,
        usedAsHero: false,
      }),
    ).toBeNull()
  })
})

describe('a barra nao inventa estado', () => {
  it('todo destino oferecido e um WorkflowStatus valido', () => {
    const valid = new Set<string>(WORKFLOW_STATUSES)
    for (const from of WORKFLOW_STATUSES) {
      for (const option of transitionsFrom(from, 'administrator')) {
        expect(valid.has(option.to as WorkflowStatus)).toBe(true)
      }
    }
  })
})

describe('partialAdvanceMessage', () => {
  it('diz ate onde foi e o que falta, sem nome de estado cru', () => {
    const message = partialAdvanceMessage('ready_to_publish', ['editor_in_chief'])
    // O rotulo em portugues, nao a chave do banco.
    expect(message).not.toContain('ready_to_publish')
    expect(message).toContain(STATUS_LABELS.ready_to_publish)
    // E o que resolve: quem publica.
    expect(message).toContain(ROLE_LABELS.editor_in_chief)
  })

  it('lista mais de um papel de forma legivel', () => {
    const message = partialAdvanceMessage('ready_to_publish', ['administrator', 'editor_in_chief'])
    expect(message).toContain(' ou ')
    expect(message).toContain(ROLE_LABELS.administrator)
  })

  it('CONTROLE NEGATIVO: nenhum estado cru vaza para a frase, em nenhum estado', () => {
    // Um `STATUS_LABELS` incompleto devolveria `undefined` e a frase sairia
    // "avancou ate undefined" — pior que o silencio que isto veio corrigir.
    for (const status of WORKFLOW_STATUSES) {
      const message = partialAdvanceMessage(status, ['editor_in_chief'])
      expect(message, status).not.toContain('undefined')
      expect(message, status).not.toContain(status)
    }
  })

  it('sem papel humano, aponta a automacao em vez de frase quebrada', () => {
    expect(partialAdvanceMessage('ready_to_publish', [])).toContain('automação')
  })
})

describe('visibilidade da aba de automacao', () => {
  it('materia AUTOMATIZADA mostra a aba para qualquer papel', () => {
    for (const role of ['writer', 'reviewer', 'editor', 'editor_in_chief', 'administrator']) {
      expect(showsAutomationTab({ autoPublished: true, role }), role).toBe(true)
    }
  })

  it('materia MANUAL esconde a aba de quem escreve, e mantem para administrador', () => {
    for (const role of ['writer', 'reviewer', 'editor', 'editor_in_chief']) {
      expect(showsAutomationTab({ autoPublished: false, role }), role).toBe(false)
    }
    // O administrador mantem a aba porque ela e a prova VISIVEL de que os campos
    // de automacao sao somente leitura — e o E2E de governanca depende disso.
    expect(showsAutomationTab({ autoPublished: false, role: 'administrator' })).toBe(true)
  })

  it('FAIL-VISIBLE: dado ausente nao esconde auditoria de administrador', () => {
    // Esconder por engano e pior que mostrar de mais: a aba e read-only, e o
    // custo de exibi-la a mais e ruido, nao risco.
    expect(showsAutomationTab({ autoPublished: undefined, role: 'administrator' })).toBe(true)
    expect(showsAutomationTab({ autoPublished: null, role: 'administrator' })).toBe(true)
  })

  it('valor truthy que NAO e `true` nao conta como automatizada', () => {
    // `autoPublished` e booleano no schema; string "false" ou 1 seriam dado
    // corrompido, e tratar como automatizada mentiria sobre a origem.
    expect(showsAutomationTab({ autoPublished: 'false', role: 'writer' })).toBe(false)
    expect(showsAutomationTab({ autoPublished: 1, role: 'writer' })).toBe(false)
  })
})
