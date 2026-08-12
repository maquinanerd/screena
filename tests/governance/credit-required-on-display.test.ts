/**
 * credit-required-on-display.test.ts — "NOTA SEM CREDITO NAO VAI AO AR."
 *
 * POR QUE ESTE TESTE EXISTE
 * -------------------------
 * A autorizacao dos provedores (2026-08-11) liberou a COLETA de notas e
 * disponibilidade em producao. A condicao dessa autorizacao e o uso
 * JORNALISTICO com credito visivel a fonte em toda exibicao.
 *
 * A condicao ja estava implementada nos dois presenters quando a autorizacao foi
 * dada — mas nao estava TRAVADA. Uma "simplificacao" futura que removesse o
 * `if` do credito passaria em todos os testes existentes e violaria a licenca em
 * silencio, em producao, sem ninguem perceber. Este teste e a trava.
 *
 * Ele exercita os presenters PUROS (nao o JSX): sao eles que decidem o que
 * chega a tela. Um item que o presenter descarta nunca vira DOM.
 */

import { describe, expect, it } from 'vitest'

import { buildRatingsView } from '../../apps/web/src/lib/ratings-presenter'
import { buildWatchAvailabilityView } from '../../apps/web/src/lib/watch-availability-presenter'

/** Nota valida e creditada — o caso de referencia. */
const RATING_CREDITADA = {
  sourceKey: 'imdb',
  sourceLabel: 'IMDb',
  scoreType: 'audience',
  label: 'IMDb Rating',
  value: 7.9,
  best: 10,
  count: 12345,
  updatedAt: '2026-08-10T00:00:00.000Z',
  attribution: { text: 'Nota fornecida por IMDb', url: 'https://www.imdb.com/title/tt0000000/' },
} as const

describe('ratings: credito e requisito BLOQUEANTE de exibicao', () => {
  it('nota COM credito aparece, com fonte, escala e atribuicao', () => {
    const view = buildRatingsView({ ratings: [RATING_CREDITADA] } as never)

    expect(view).not.toBeNull()
    const item = view!.items[0]!
    // "7,9 IMDb", nunca "7,9" solto.
    expect(item.sourceLabel).toBe('IMDb')
    expect(item.scoreLabel).toBe('7,9/10')
    expect(item.attribution.text).toBe('Nota fornecida por IMDb')
  })

  it('nota SEM texto de atribuicao NAO vai ao ar', () => {
    const view = buildRatingsView({
      ratings: [{ ...RATING_CREDITADA, attribution: { text: null, url: null } }],
    } as never)
    expect(view).toBeNull()
  })

  it('nota com atribuicao VAZIA (so espacos) NAO vai ao ar', () => {
    const view = buildRatingsView({
      ratings: [{ ...RATING_CREDITADA, attribution: { text: '   ', url: null } }],
    } as never)
    expect(view).toBeNull()
  })

  it('nota sem o objeto de atribuicao NAO vai ao ar', () => {
    const view = buildRatingsView({
      ratings: [{ ...RATING_CREDITADA, attribution: undefined }],
    } as never)
    expect(view).toBeNull()
  })

  it('a escala acompanha o numero: nunca existe nota sem denominador', () => {
    // Sem escala confiavel o numero e ambiguo ("7,9" de quanto?), e um 92 do
    // Rotten Tomatoes viraria indistinguivel de um 9,2 do IMDb (invariante 1).
    const view = buildRatingsView({
      ratings: [{ ...RATING_CREDITADA, best: 0 }],
    } as never)
    expect(view).toBeNull()
  })

  it('ESTADO VAZIO HONESTO: sem nota exibivel, o painel some — nao escreve "sem avaliacoes"', () => {
    // "Sem avaliacoes" seria uma afirmacao sobre o MUNDO. A verdade e sobre NOS:
    // nao ha nota creditada para exibir. O painel inteiro nao renderiza.
    expect(buildRatingsView({ ratings: [] } as never)).toBeNull()
  })
})

/**
 * Oferta valida e creditada — o caso de referencia.
 *
 * Este objeto e um CONTROLE POSITIVO, nao decoracao. Sem ele, os cinco testes
 * negativos abaixo passariam pelo motivo errado: um fixture malformado faz o
 * presenter devolver `null` em TODOS os casos, e "esperava null, recebeu null"
 * nao prova nada sobre o gate de credito. Foi exatamente o que aconteceu na
 * primeira versao deste arquivo (faltava `displayAllowed`).
 */
const OFERTA_CREDITADA = {
  providerKey: 'netflix',
  providerName: 'Netflix',
  providerSlug: 'netflix',
  offerType: 'subscription',
  deepLink: 'https://www.netflix.com/title/00000000',
  webUrl: null,
  quality: 'hd',
  priceAmount: null,
  currency: null,
  // Gate-mestra de licenca (invariante 6): sem isto a oferta nao existe.
  displayAllowed: true,
  fetchedAtIso: '2026-08-10T00:00:00.000Z',
  requiresAttribution: true,
  requiresLinkback: true,
  attributionText: 'Disponibilidade fornecida por Movie of the Night',
  attributionUrl: 'https://www.movieofthenight.com/',
} as const

describe('streaming: nome do provedor e credito sao requisitos de exibicao', () => {
  it('oferta COM credito aparece, com o NOME do provedor visivel', () => {
    const view = buildWatchAvailabilityView([OFERTA_CREDITADA] as never)

    expect(view).not.toBeNull()
    const offer = view!.groups[0]!.offers[0]!
    expect(offer.providerName).toBe('Netflix')
  })

  it('oferta que EXIGE atribuicao e nao a tem NAO vai ao ar', () => {
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, attributionText: null },
    ] as never)
    expect(view).toBeNull()
  })

  it('oferta que EXIGE linkback e nao o tem NAO vai ao ar', () => {
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, attributionUrl: null },
    ] as never)
    expect(view).toBeNull()
  })

  it('oferta sem NOME de provedor NAO vai ao ar', () => {
    // Um link "Assistir" sem dizer onde nao e disponibilidade: e um clique cego.
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, providerName: null },
    ] as never)
    expect(view).toBeNull()
  })

  it('ESTADO VAZIO HONESTO: sem oferta exibivel, o painel some', () => {
    expect(buildWatchAvailabilityView([] as never)).toBeNull()
  })

  it('oferta sem display_allowed NAO vai ao ar (invariante 6 continua valendo)', () => {
    // A autorizacao do provedor liberou a COLETA. Ela nao toca no gate de
    // licenca da EXIBICAO — que continua sendo a palavra final.
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, displayAllowed: false },
    ] as never)
    expect(view).toBeNull()
  })
})
