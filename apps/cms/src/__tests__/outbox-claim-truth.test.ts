/**
 * "Fila vazia" e "eu nao consegui olhar" deixam de ser a mesma resposta.
 *
 * O `claim` respondia `200 { claimed: 0, events: [] }` nos dois casos, porque o
 * `catch` do laco de tomada engolia qualquer erro e seguia para o proximo
 * candidato. Adapter sem pool, coluna ausente depois de uma migration pela
 * metade, permissao negada — tudo virava lote vazio.
 *
 * O resultado e o pior estado possivel para uma ponte: CMS verde, worker verde,
 * projecao parada.
 */

import { describe, expect, it } from 'vitest'

import { summarizeClaimAttempt } from '../outbox-api.js'

describe('claim: lote vazio x lote que falhou', () => {
  it('CONTROLE POSITIVO: fila genuinamente vazia continua 200', () => {
    // Sem este caso, um resumo que devolvesse 503 sempre passaria em todos os
    // testes negativos sem nunca deixar o worker dormir em paz.
    const summary = summarizeClaimAttempt({ candidatesRead: true, claimed: 0, failures: 0 })
    expect(summary.ok).toBe(true)
    expect(summary.status).toBe(200)
  })

  it('lote com eventos e 200', () => {
    expect(summarizeClaimAttempt({ candidatesRead: true, claimed: 3, failures: 0 }).status).toBe(200)
  })

  it('consulta de candidatos que NAO concluiu e 503, nao fila vazia', () => {
    const summary = summarizeClaimAttempt({ candidatesRead: false, claimed: 0, failures: 0 })
    expect(summary.ok).toBe(false)
    expect(summary.status).toBe(503)
    if (!summary.ok) expect(summary.code).toBe('claim_query_failed')
  })

  it('TODAS as tomadas falharam: 503, nao 200 com lote vazio', () => {
    // Este e o caso que existia e nao aparecia. Havia candidatos, o
    // compare-and-swap errou em todos, e a resposta dizia "nada a fazer".
    const summary = summarizeClaimAttempt({ candidatesRead: true, claimed: 0, failures: 7 })
    expect(summary.ok).toBe(false)
    expect(summary.status).toBe(503)
    if (!summary.ok) {
      expect(summary.code).toBe('claim_all_attempts_failed')
      expect(summary.detail).toContain('7')
    }
  })

  it('falha PARCIAL continua 200: houve progresso', () => {
    // Derrubar o lote inteiro por um erro numa linha entregaria menos do que
    // entregar o que deu certo. A contagem de falhas vai no corpo.
    const summary = summarizeClaimAttempt({ candidatesRead: true, claimed: 2, failures: 1 })
    expect(summary.ok).toBe(true)
    expect(summary.status).toBe(200)
  })

  it('perder a corrida NAO e falha', () => {
    // Zero linhas no `RETURNING` nao levanta excecao: e outro worker tendo
    // chegado antes, o funcionamento normal. Se isso contasse como falha, um
    // segundo worker saudavel derrubaria o primeiro em 503.
    expect(summarizeClaimAttempt({ candidatesRead: true, claimed: 0, failures: 0 }).status).toBe(200)
  })
})
