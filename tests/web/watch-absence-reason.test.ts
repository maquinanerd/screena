/**
 * watch-absence-reason.test.ts — O motivo da ausencia e DERIVADO, nunca fixo.
 *
 * O DEFEITO QUE ISTO TRAVA. As duas paginas de detalhe escreviam
 * `reason: 'no_authorized_provider'` a mao, com um comentario dizendo "enquanto
 * for assim". Era verdade enquanto houvesse zero ofertas exibiveis — e deixaria
 * de ser verdade exatamente no dia em que a cadeia de streaming fosse
 * concluida. A partir dai TODO titulo sem oferta emitiria um evento
 * `actionable: true`, que e o ruido que o proprio `section-absence.ts` descreve
 * como "o que afogaria o unico evento que importa".
 *
 * Uma afirmacao fixa sobre um estado que vai mudar envelhece sozinha, em
 * silencio, e no pior momento: logo depois do deploy que a invalida.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildSectionAbsence } from '../../apps/web/src/lib/section-absence'
import { watchAbsenceReasonFor } from '../../apps/web/src/server/entity-watch'

const ROOT = process.cwd()

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function readPage(rel: string): string {
  return withoutComments(readFileSync(path.join(ROOT, rel), 'utf8'))
}

const PAGES: ReadonlyArray<readonly [string, string]> = [
  ['filme', 'apps/web/app/pt/filmes/[slug]/page.tsx'],
  ['serie', 'apps/web/app/pt/series/[slug]/page.tsx'],
]

const LOADERS: ReadonlyArray<readonly [string, string]> = [
  ['filme', 'apps/web/src/server/movie-page.ts'],
  ['serie', 'apps/web/src/server/series-page.ts'],
]

describe('os dois estados do catalogo produzem motivos diferentes', () => {
  it('CONTROLE POSITIVO: os dois estados sao mesmo distintos (senao nada abaixo prova nada)', () => {
    expect(watchAbsenceReasonFor(false)).not.toBe(watchAbsenceReasonFor(true))
  })

  it('sem NENHUMA oferta exibivel no catalogo: alguem precisa agir', () => {
    const reason = watchAbsenceReasonFor(false)
    expect(reason).toBe('no_authorized_provider')

    const absence = buildSectionAbsence({
      section: 'onde-assistir',
      reason,
      entityType: 'movie',
      entityId: '42',
    })
    expect(absence.actionable).toBe(true)
    expect(absence.event).toBe('section_absent')
  })

  it('ha oferta exibivel em ALGUM titulo, so nao neste: e fato sobre a obra', () => {
    const reason = watchAbsenceReasonFor(true)
    expect(reason).toBe('no_offer_for_entity')

    const absence = buildSectionAbsence({
      section: 'onde-assistir',
      reason,
      entityType: 'tv',
      entityId: '7',
    })
    expect(absence.actionable).toBe(false)
  })

  /**
   * O ponto operacional inteiro: os dois estados NAO podem cair no mesmo
   * `actionable`. Se caissem, a separacao nao serviria para nada — que era
   * exatamente a situacao antes, com o motivo fixo.
   */
  it('o par (reason, actionable) separa "passo pendente" de "fato sobre o titulo"', () => {
    const ref = { section: 'onde-assistir', entityType: 'movie', entityId: '1' } as const
    const vazio = buildSectionAbsence({ ...ref, reason: watchAbsenceReasonFor(false) })
    const semOferta = buildSectionAbsence({ ...ref, reason: watchAbsenceReasonFor(true) })
    expect(vazio.actionable).not.toBe(semOferta.actionable)
  })
})

describe('as paginas nao escrevem o motivo a mao', () => {
  for (const [label, rel] of PAGES) {
    it(`${label}: le o motivo do loader, nao um literal no JSX`, () => {
      const code = readPage(rel)
      expect(code).toContain('watchAbsence')
      expect(code).toMatch(/reason: watchAbsence/)
    })

    it(`${label}: NEGATIVO — nao ha mais motivo de streaming fixo no codigo da pagina`, () => {
      const code = readPage(rel)
      // O unico `no_authorized_provider` tolerado e o fallback do `??`, que
      // existe so para o tipo: `watchAbsence` e null apenas quando HA painel, e
      // ai `decideSection` nem le o motivo.
      const ocorrencias = code.match(/no_authorized_provider/g) ?? []
      expect(ocorrencias).toHaveLength(1)
      expect(code).toMatch(/reason: watchAbsence \?\? 'no_authorized_provider'/)
    })
  }
})

describe('os loaders derivam o motivo, e so quando ha ausencia', () => {
  for (const [label, rel] of LOADERS) {
    it(`${label}: computa o motivo a partir do estado`, () => {
      const code = withoutComments(readFileSync(path.join(ROOT, rel), 'utf8'))
      expect(code).toContain('watchAbsenceReason')
      expect(code).toMatch(/watch === null \? await watchAbsenceReason\(prisma\) : null/)
    })
  }

  /**
   * CUSTO. A sonda so roda quando o painel esta ausente — quem tem oferta nao
   * paga consulta nenhuma. Travado no texto porque e a diferenca entre "uma
   * consulta a mais quando nao ha nada" e "uma consulta a mais em toda pagina".
   */
  it('a sonda nao roda quando ha painel (curto-circuito, nao consulta incondicional)', () => {
    for (const [, rel] of LOADERS) {
      const code = withoutComments(readFileSync(path.join(ROOT, rel), 'utf8'))
      expect(code).not.toMatch(/const watchAbsence = await watchAbsenceReason/)
    }
  })

  it('a sonda usa a MESMA clausula que decide exibir', () => {
    const code = withoutComments(
      readFileSync(path.join(ROOT, 'apps/web/src/server/entity-watch.ts'), 'utf8'),
    )
    expect(code).toMatch(/watchAbsenceReason = cache\(/)
    expect(code).toMatch(/where: licensedWatchWhere\(new Date\(\)\)/)
  })
})
