/**
 * A FILMOGRAFIA NAO PODE VOLTAR A DESCARTAR CALADA.
 *
 * ============================================================================
 * O DEFEITO (medido em 25/08/2026)
 * ============================================================================
 * A pagina de pessoa monta a filmografia a partir de `cast_members`/
 * `crew_members` e perdia credito sem contar, em dois pontos candidatos. So um
 * deles e alcancavel — a diferenca foi MEDIDA, nao presumida:
 *
 *  1. `apps/web/src/lib/person-presenter.ts` — `buildPersonCredits()` descarta
 *     credito sem slug canonico pt-BR. REAL: o titulo ESTA no catalogo e mesmo
 *     assim some, porque nao ha pagina para onde linkar.
 *  2. `apps/web/src/server/person-page.ts` — `toCredit()` devolve `null` quando
 *     o alvo nao esta em `movies`/`tv_shows`. NAO alcancavel: existe FK
 *     `cast_members.(entity_type, entity_id) -> entities`, e `entities` e
 *     mantida 1:1 com as tabelas-raiz por trigger (ON DELETE RESTRICT). O banco
 *     recusa a linha orfa — check 29 de
 *     `apps/web/scripts/validate-person-page-real-postgres.ts` prova isso
 *     tentando o insert. O ramo fica como defesa e ja esta contado.
 *
 * Nenhum dos dois contava, e a secao FILMOGRAFIA nao dizia nada — a lista
 * parcial tinha exatamente a mesma cara da lista inteira. Mesma familia do
 * `entities_synced_total` e do "success com zero criados": o numero que a tela
 * mostra descreve o que sobrou, e se apresenta como o que existe.
 *
 * ============================================================================
 * O QUE ESTE GUARD TRAVA, E POR QUE NAO ESTA NO TESTE DO PRESENTER
 * ============================================================================
 * A subtracao e a copy sao PURAS e tem teste proprio em
 * `tests/web/person-presenter.test.ts`. O que nenhum teste puro alcanca e a
 * LIGACAO: de onde sai o denominador.
 *
 * Isso importa porque a regressao e silenciosa. Trocar
 * `countLinkableCreditRows(castRows) + countLinkableCreditRows(crewRows)` por
 * `credits.length` deixa `hiddenCreditCount` permanentemente zero, some com a
 * linha da tela — e TODOS os testes do presenter continuam verdes, porque cada
 * um passa o denominador na mao. O defeito voltaria inteiro com a suite verde.
 *
 * Guard textual, entao, com a limitacao que isso tem: ele pega a GRAFIA da
 * ligacao, nao o seu sentido. E o suficiente aqui porque o que se afirma e
 * estreito ("o denominador vem das linhas cruas") e a afirmacao contraria
 * ("vem da lista ja filtrada") esta travada explicitamente abaixo.
 */

import { describe, expect, it } from 'vitest'

import { readSourceWithoutComments } from '../support/source-text.js'

const SERVER_REL = 'apps/web/src/server/person-page.ts'
const PRESENTER_REL = 'apps/web/src/lib/person-presenter.ts'
const PAGE_REL = 'apps/web/app/pt/pessoas/[slug]/page.tsx'

// SEM comentarios, pela porta unica: a prosa acima cita cada literal que este
// guard procura, e ler o arquivo cru faria o guard casar com a propria
// explicacao — o defeito que `tests/governance/guard-source-reading.test.ts`
// existe para impedir.
const server = readSourceWithoutComments(SERVER_REL)
const presenter = readSourceWithoutComments(PRESENTER_REL)
const page = readSourceWithoutComments(PAGE_REL).replaceAll("'", '"')

describe('filmografia de pessoa · o descarte tem de ser contado', () => {
  it('o denominador sai das linhas CRUAS, nao da lista ja filtrada', () => {
    expect(server).toContain('countLinkableCreditRows(castRows)')
    expect(server).toContain('countLinkableCreditRows(crewRows)')
    // A regressao exata que apagaria a linha da tela com a suite verde.
    expect(server).not.toMatch(/rawCreditCount:\s*(?:view\.)?credits\.length/)
  })

  it('contar e descartar passam pela MESMA porta de tipo de alvo', () => {
    // Se `toCredit` filtrasse por um criterio proprio, o denominador contaria
    // linha que a lista nunca teve chance de exibir, e o numero mentiria.
    expect(server).toContain('isPersonCreditEntityType(entityType)')
    expect(server).not.toMatch(/entityType\s*!==\s*["']movie["']/)
  })

  it('a view carrega o numero e a subtracao acontece onde os dois lados aparecem', () => {
    expect(presenter).toContain('hiddenCreditCount')
    expect(presenter).toContain('countHiddenCredits(input.rawCreditCount, credits.length)')
  })

  it('`rawCreditCount` e obrigatorio: um default seria o silencio de volta', () => {
    // Opcional com default significaria "nada escondido" para todo chamador que
    // esquecesse de informar — exatamente o estado anterior ao conserto.
    expect(presenter).toMatch(/rawCreditCount:\s*number/)
    expect(presenter).not.toMatch(/rawCreditCount\?:/)
  })

  it('a pagina exibe a linha, e FORA do ramo que exige lista nao vazia', () => {
    expect(page).toContain('formatHiddenCreditsNotice(view.hiddenCreditCount)')
    expect(page).toContain('{hiddenCreditsNotice}')

    // O caso que mais importa e a lista VAZIA com creditos no banco: ali
    // "Filmografia ainda nao disponivel" sozinha afirma que a pessoa nao tem
    // credito. A linha tem de sobreviver aos DOIS ramos, entao ela aparece
    // depois do ternario se fechar — nunca dentro dele.
    const ternario = page.indexOf('Filmografia ainda não disponível')
    const fimDoTernario = page.indexOf(')}', ternario)
    const linha = page.indexOf('hiddenCreditsNotice !== null')
    expect(ternario).toBeGreaterThan(-1)
    expect(fimDoTernario).toBeGreaterThan(-1)
    expect(linha).toBeGreaterThan(fimDoTernario)
  })

  it('a copy nao afirma "fora do catalogo" — so uma das duas causas e isso', () => {
    // Descarte 2 e um titulo que ESTA no catalogo e so nao tem slug pt-BR.
    expect(presenter.toLowerCase()).not.toContain('fora do catálogo')
  })
})
