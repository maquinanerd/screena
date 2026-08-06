/**
 * "Da para usar esta imagem?", respondido no seletor.
 *
 * O que estes testes protegem e o FAIL-CLOSED. Um erro para o lado permissivo
 * aqui nao mostra um rotulo errado: faz o redator escolher uma foto que a
 * publicacao vai recusar depois de todo o trabalho pronto.
 */

import { describe, expect, it } from 'vitest'

import { mediaUsability } from '../admin/media-usability.js'

const liberada = { licenseStatus: 'approved', allowedForEditorial: true, allowedForHero: true }

describe('mediaUsability', () => {
  it('licenca aprovada e as duas permissoes: liberada', () => {
    expect(mediaUsability(liberada)).toMatchObject({ tone: 'ok', label: 'Liberada' })
  })

  it('sem permissao de capa: SO NO CORPO, nao "bloqueada"', () => {
    // A distincao importa: dizer "bloqueada" faria o redator descartar uma foto
    // que ele PODE usar no texto.
    const verdict = mediaUsability({ ...liberada, allowedForHero: false })
    expect(verdict.tone).toBe('partial')
    expect(verdict.label).toBe('Só no corpo')
  })

  it('sem permissao editorial: bloqueada, com o motivo', () => {
    const verdict = mediaUsability({ ...liberada, allowedForEditorial: false })
    expect(verdict.tone).toBe('blocked')
    expect(verdict.detail).toContain('uso editorial')
  })

  it('licenca nao aprovada: bloqueada, qualquer que seja a permissao', () => {
    for (const licenseStatus of ['unknown', 'pending', 'rejected', 'expired']) {
      const verdict = mediaUsability({ ...liberada, licenseStatus })
      expect(verdict.tone, licenseStatus).toBe('blocked')
    }
  })

  it('FAIL-CLOSED: fato ausente NAO vira liberado', () => {
    // O caso perigoso de verdade. Uma leitura incompleta da lista (campo que
    // nao veio, tipo errado, `null`) nao pode transformar midia sem licenca em
    // midia liberada.
    for (const facts of [
      {},
      { licenseStatus: 'approved' },
      { licenseStatus: 'approved', allowedForEditorial: 'sim', allowedForHero: 'sim' },
      { licenseStatus: null, allowedForEditorial: null, allowedForHero: null },
      { licenseStatus: 1, allowedForEditorial: 1, allowedForHero: 1 },
    ]) {
      expect(mediaUsability(facts as never).tone, JSON.stringify(facts)).not.toBe('ok')
    }
  })

  it('CONTROLE NEGATIVO: o detector reconhece a midia realmente liberada', () => {
    // Sem isto, um `mediaUsability` que devolvesse `blocked` sempre passaria em
    // todos os casos acima e o seletor recusaria o acervo inteiro.
    expect(mediaUsability(liberada).tone).toBe('ok')
  })

  it('todo desfecho tem rotulo curto e nao vaza codigo', () => {
    for (const facts of [
      liberada,
      { ...liberada, allowedForHero: false },
      { ...liberada, allowedForEditorial: false },
      { ...liberada, licenseStatus: 'unknown' },
    ]) {
      const verdict = mediaUsability(facts)
      expect(verdict.label).not.toBe('')
      expect(verdict.label.length).toBeLessThanOrEqual(20)
      // Rotulo de lista e para gente: nada de `allowedForHero` na tela.
      expect(verdict.label).not.toMatch(/[a-z]+[A-Z]|_/)
    }
  })
})
