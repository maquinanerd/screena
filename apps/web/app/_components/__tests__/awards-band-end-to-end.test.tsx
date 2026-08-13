/**
 * awards-band-end-to-end.test.tsx — O ultimo elo: da LINHA DO BANCO ao texto que
 * o leitor ve.
 *
 * POR QUE ELE EXISTE, tendo ja o validador de PostgreSQL real e o teste do
 * componente. Cada um prova uma metade e nenhum prova a emenda:
 *
 *  - `validate:awards` para em `entity_awards.display_allowed = true`. Ele nao
 *    renderiza nada, entao continuaria verde se a faixa nunca chegasse a tela;
 *  - `awards-band.test.tsx` comeca de uma `AwardsView` ja montada, com um
 *    credito de fixture. Ele continuaria verde se o credito REAL da licenca
 *    fosse outro.
 *
 * Aqui a linha entra na FORMA EXATA que a query de leitura projeta (a mesma
 * `AwardsRow`), com o credito importado de `@screena/legal` — a licenca de
 * verdade, nao uma copia. Se alguem trocar o texto no spec e esquecer a tela (ou
 * o contrario), este arquivo cai.
 *
 * TEXTO VISIVEL, NUNCA MARCACAO CRUA: `markup.includes(...)` fica verde quando a
 * frase aparece so num atributo. Toda assercao passa por `visibleText`.
 *
 * POR QUE ELE MORA EM `apps/web` e nao em `tests/web`, onde o assunto ficaria
 * mais bem arrumado: `react` so resolve a partir de `apps/web/node_modules`. Um
 * teste de componente na raiz do repo falha na COLETA, nao numa assercao — e o
 * `include` do vitest ja cobre `apps/**\/*.test.tsx` exatamente por isso.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AWARDS_ATTRIBUTION_TEXT, AWARDS_SOURCE_KEY } from '@screena/legal'

import { AwardsBand } from '../awards-band'
import { toAwardsPanelView, type AwardsRow } from '../../../src/server/entity-awards'

const NOW = new Date('2026-08-13T12:00:00.000Z')

/** Remove TODAS as tags: sobra so o que o leitor le. */
function visibleText(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ')
}

/**
 * A linha como o banco a devolve DEPOIS de `awards:promote --apply` com a
 * licenca aplicada. Os valores do fato sao os medidos em producao para
 * Inception; os de licenca vem do spec.
 */
const ROW_FROM_DB: AwardsRow = {
  outcome: 'won',
  highlightCount: 4,
  awardName: 'Oscars',
  wins: 160,
  nominations: 220,
  sourceKey: AWARDS_SOURCE_KEY,
  attributionText: AWARDS_ATTRIBUTION_TEXT,
  // NULL: `apply.ts` nao escreve `terms_url`, e por isso o linkback e dispensado.
  attributionUrl: null,
  requiresAttribution: true,
  requiresLinkback: false,
  dataUsageDecision: {
    useCase: 'awards_display',
    isCurrent: true,
    stage: 'approved_for_display',
    displayAllowed: true,
    territory: 'BR',
    validFrom: new Date('2026-08-13T00:00:00.000Z'),
    validUntil: null,
    sourceLicense: {
      isCurrent: true,
      licenseStatus: 'third_party',
      displayAllowed: true,
      sourceKey: AWARDS_SOURCE_KEY,
    },
  },
}

function render(row: AwardsRow): string | null {
  const panel = toAwardsPanelView(row, NOW)
  if (panel === null) return null
  return renderToStaticMarkup(
    <AwardsBand credit={panel.credit} vertical="movie" view={panel.view} />,
  )
}

describe('CONTROLE POSITIVO: a linha do banco vira faixa na tela', () => {
  const markup = render(ROW_FROM_DB)

  it('renderiza (a linha licenciada nao e descartada no caminho)', () => {
    expect(markup).not.toBeNull()
  })

  it('o texto visivel e a frase em pt-BR com o nome do premio VERBATIM', () => {
    const text = visibleText(markup!)
    expect(text).toContain('Venceu 4 Oscars')
    expect(text).toContain('160 vitórias · 220 indicações')
    // A frase da FONTE nao vaza em ingles para um site em portugues.
    expect(text).not.toContain('Won 4 Oscars')
    expect(text).not.toContain('nominations total')
    // E o nome do premio nao foi traduzido no meio do caminho.
    expect(text).not.toContain('Prêmios Oscar')
  })

  it('o CREDITO REAL da licenca aparece, e DENTRO da faixa', () => {
    const open = markup!.indexOf('<section')
    const close = markup!.indexOf('</section>')
    expect(close).toBeGreaterThan(open)
    const inside = visibleText(markup!.slice(open, close))

    expect(inside).toContain(AWARDS_ATTRIBUTION_TEXT)
    // Assercao LITERAL do texto decidido: o verbo e de transporte.
    expect(inside).toContain('Dados de premiacao fornecidos por OMDb')
    // A forma curta diria que a OMDb PREMIOU alguem.
    expect(inside).not.toContain('Premiacao fornecida por OMDb')
  })

  it('sem linkback: credito em texto, nenhum link fabricado', () => {
    expect(markup).not.toContain('<a ')
  })
})

describe('CONTROLE NEGATIVO: o que derruba a faixa antes da tela', () => {
  it('sem licenca vigente (o estado anterior a decisao) nao ha faixa', () => {
    expect(render({ ...ROW_FROM_DB, sourceKey: null, attributionText: null })).toBeNull()
  })

  it('credito removido da licenca derruba a faixa inteira', () => {
    expect(render({ ...ROW_FROM_DB, attributionText: null })).toBeNull()
  })

  it('decisao de rating_display nao acende a faixa de premios', () => {
    expect(
      render({
        ...ROW_FROM_DB,
        dataUsageDecision: { ...ROW_FROM_DB.dataUsageDecision!, useCase: 'rating_display' },
      }),
    ).toBeNull()
  })

  it('licenca de OUTRA fonte nao credita esta linha', () => {
    expect(
      render({
        ...ROW_FROM_DB,
        dataUsageDecision: {
          ...ROW_FROM_DB.dataUsageDecision!,
          sourceLicense: { ...ROW_FROM_DB.dataUsageDecision!.sourceLicense, sourceKey: 'imdb' },
        },
      }),
    ).toBeNull()
  })
})
