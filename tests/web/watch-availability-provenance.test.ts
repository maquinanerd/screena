/**
 * watch-availability-provenance.test.ts — O painel com DUAS origens de oferta.
 *
 * Cobre o que mudou quando a oferta passou a poder vir tambem do bloco
 * `watch/providers` do TMDB (fonte: JustWatch), alem do agregador da RapidAPI:
 *
 *  1. DESTINO. O TMDB nao publica deep link por oferta — publica UM link por
 *     PAIS, que vai para `web_url`. Ele estava sendo gravado desde sempre e
 *     nunca lido: a oferta chegava sem destino e era descartada em silencio.
 *  2. NATUREZA DO DESTINO. Link do provedor e link do agregador nao sao a mesma
 *     promessa. `destinationKind` viaja com a oferta para que a UI nao possa
 *     dizer "abrir na Netflix" apontando para o agregador.
 *  3. PRECEDENCIA. A mesma plataforma pode chegar pelos dois caminhos. A regra
 *     declarada: destino no PROVEDOR vence destino no AGREGADOR, por
 *     (plataforma canonica, modalidade).
 *  4. NAO-REGRESSAO. O caminho `streaming_availability` continua identico.
 */

import { describe, expect, it } from 'vitest'

import {
  buildWatchAvailabilityView,
  selectTickerWatchOffer,
  type WatchAvailabilityRow,
} from '../../apps/web/src/lib/watch-availability-presenter'

/** Oferta da RapidAPI: deep link por oferta, credito Movie of the Night. */
function aggregatorRow(overrides: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: 'Netflix',
    providerKey: 'netflix',
    providerSlug: 'netflix',
    offerType: 'subscription',
    deepLink: 'https://www.netflix.com/title/1',
    webUrl: null,
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: '2026-08-01T00:00:00.000Z',
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por Movie of the Night',
    attributionUrl: 'https://www.movieofthenight.com/about/api',
    ...overrides,
  }
}

/**
 * Oferta do TMDB: `provider_key` e o `provider_id` NUMERICO (8 = Netflix),
 * `deep_link` NULL, destino no `web_url` (o link por pais), credito JustWatch.
 * O `providerSlug` e o que revela que "8" e "netflix" sao a MESMA plataforma.
 */
function tmdbRow(overrides: Partial<WatchAvailabilityRow> = {}): WatchAvailabilityRow {
  return {
    providerName: 'Netflix',
    providerKey: '8',
    providerSlug: 'netflix',
    offerType: 'subscription',
    deepLink: null,
    webUrl: 'https://www.themoviedb.org/movie/550/watch?locale=BR',
    quality: null,
    priceAmount: null,
    currency: null,
    displayAllowed: true,
    fetchedAtIso: '2026-08-02T00:00:00.000Z',
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por JustWatch',
    attributionUrl: 'https://www.justwatch.com/',
    ...overrides,
  }
}

describe('CONTROLE POSITIVO das fixtures', () => {
  /**
   * Sem isto, todo teste negativo abaixo passaria pelo motivo errado: uma
   * fixture malformada faz o presenter devolver `null` em TODOS os casos, e
   * "esperava null, recebeu null" nao prova nada. Ja se perderam 5 e depois
   * mais 3 testes deste repo exatamente assim.
   */
  it('as duas fixtures, sozinhas, PRODUZEM painel — entao um null adiante e informativo', () => {
    const fromAggregator = buildWatchAvailabilityView([aggregatorRow()])
    expect(fromAggregator).not.toBeNull()
    expect(fromAggregator!.groups[0]!.offers).toHaveLength(1)

    const fromTmdb = buildWatchAvailabilityView([tmdbRow()])
    expect(fromTmdb).not.toBeNull()
    expect(fromTmdb!.groups[0]!.offers).toHaveLength(1)
  })
})

describe('destino: o link por pais do TMDB e uma oferta exibivel', () => {
  it('oferta TMDB usa web_url como destino e se declara AGREGADOR', () => {
    const view = buildWatchAvailabilityView([tmdbRow()])
    const offer = view!.groups[0]!.offers[0]!
    expect(offer.destinationUrl).toBe('https://www.themoviedb.org/movie/550/watch?locale=BR')
    expect(offer.destinationKind).toBe('aggregator')
  })

  it('oferta do agregador usa deep_link e se declara PROVEDOR', () => {
    const view = buildWatchAvailabilityView([aggregatorRow()])
    const offer = view!.groups[0]!.offers[0]!
    expect(offer.destinationUrl).toBe('https://www.netflix.com/title/1')
    expect(offer.destinationKind).toBe('provider')
  })

  it('SEM link no payload a oferta NAO vai ao ar (nunca CTA morto)', () => {
    expect(buildWatchAvailabilityView([tmdbRow({ webUrl: null })])).toBeNull()
  })

  it('link inseguro no web_url e recusado como qualquer outro destino', () => {
    expect(buildWatchAvailabilityView([tmdbRow({ webUrl: 'javascript:alert(1)' })])).toBeNull()
    expect(buildWatchAvailabilityView([tmdbRow({ webUrl: 'tmdb://x' })])).toBeNull()
  })

  it('deep_link do provedor tem precedencia sobre web_url na MESMA linha', () => {
    const view = buildWatchAvailabilityView([
      aggregatorRow({ webUrl: 'https://agregador.example/x' }),
    ])
    const offer = view!.groups[0]!.offers[0]!
    expect(offer.destinationUrl).toBe('https://www.netflix.com/title/1')
    expect(offer.destinationKind).toBe('provider')
  })
})

describe('credito: JustWatch acompanha a oferta TMDB, e nada vai ao ar sem credito', () => {
  it('o painel credita JustWatch quando a oferta exibida veio do TMDB', () => {
    const view = buildWatchAvailabilityView([tmdbRow()])
    expect(view!.attributions).toEqual([
      { text: 'Disponibilidade fornecida por JustWatch', url: 'https://www.justwatch.com/' },
    ])
  })

  it('oferta TMDB SEM credito de JustWatch NAO vai ao ar (segundo dos tres negativos)', () => {
    expect(buildWatchAvailabilityView([tmdbRow({ attributionText: null })])).toBeNull()
    expect(buildWatchAvailabilityView([tmdbRow({ attributionText: '   ' })])).toBeNull()
    expect(buildWatchAvailabilityView([tmdbRow({ attributionUrl: null })])).toBeNull()
  })

  it('credito da PERDEDORA da precedencia nao sobra na tela (credito orfao = mentira)', () => {
    const view = buildWatchAvailabilityView([aggregatorRow(), tmdbRow()])
    expect(view!.attributions).toHaveLength(1)
    expect(view!.attributions[0]!.text).toBe('Disponibilidade fornecida por Movie of the Night')
  })
})

describe('precedencia entre fornecedores (regra declarada)', () => {
  it('mesma plataforma + mesma modalidade: o destino no PROVEDOR vence', () => {
    const view = buildWatchAvailabilityView([tmdbRow(), aggregatorRow()])
    const offers = view!.groups[0]!.offers
    expect(offers).toHaveLength(1)
    expect(offers[0]!.destinationKind).toBe('provider')
    expect(offers[0]!.destinationUrl).toBe('https://www.netflix.com/title/1')
  })

  it('a ordem de chegada das linhas NAO muda o vencedor', () => {
    const a = buildWatchAvailabilityView([aggregatorRow(), tmdbRow()])
    const b = buildWatchAvailabilityView([tmdbRow(), aggregatorRow()])
    expect(a!.groups[0]!.offers[0]!.destinationUrl).toBe(b!.groups[0]!.offers[0]!.destinationUrl)
    expect(a!.groups[0]!.offers).toHaveLength(1)
    expect(b!.groups[0]!.offers).toHaveLength(1)
  })

  it('MODALIDADES DIFERENTES nao rivalizam: as duas aparecem', () => {
    const view = buildWatchAvailabilityView([
      aggregatorRow({ offerType: 'subscription' }),
      tmdbRow({ offerType: 'rent' }),
    ])
    expect(view!.groups.map((g) => g.offerType)).toEqual(['subscription', 'rent'])
    expect(view!.groups[1]!.offers[0]!.destinationKind).toBe('aggregator')
  })

  it('PLATAFORMAS DIFERENTES nao rivalizam: TMDB entra ao lado do agregador', () => {
    const view = buildWatchAvailabilityView([
      aggregatorRow(),
      tmdbRow({ providerName: 'Max', providerKey: '1899', providerSlug: 'max' }),
    ])
    const offers = view!.groups[0]!.offers
    expect(offers).toHaveLength(2)
    expect(offers.map((o) => o.providerName).sort()).toEqual(['Max', 'Netflix'])
    // Duas origens exibidas => os DOIS creditos aparecem.
    expect(view!.attributions.map((a) => a.text).sort()).toEqual([
      'Disponibilidade fornecida por JustWatch',
      'Disponibilidade fornecida por Movie of the Night',
    ])
  })

  it('a precedencia NAO colapsa variantes reais de qualidade do mesmo provedor', () => {
    const view = buildWatchAvailabilityView([
      aggregatorRow({ offerType: 'rent', deepLink: 'https://n/hd', quality: 'hd', priceAmount: '9.90', currency: 'BRL' }),
      aggregatorRow({ offerType: 'rent', deepLink: 'https://n/uhd', quality: 'uhd', priceAmount: '14.90', currency: 'BRL' }),
    ])
    expect(view!.groups[0]!.offers).toHaveLength(2)
  })

  it('sem providerSlug (alias nao mapeado) cada linha so rivaliza consigo mesma', () => {
    const view = buildWatchAvailabilityView([
      aggregatorRow({ providerSlug: null }),
      tmdbRow({ providerSlug: null }),
    ])
    // Sem identidade canonica nao ha como afirmar que sao a mesma plataforma —
    // e afirmar seria pior do que mostrar as duas.
    expect(view!.groups[0]!.offers).toHaveLength(2)
  })
})

describe('faixa da home usa a MESMA regra do painel', () => {
  it('escolhe a oferta com destino no provedor quando as duas existem', () => {
    const offer = selectTickerWatchOffer([tmdbRow(), aggregatorRow()])
    expect(offer!.destinationKind).toBe('provider')
  })

  it('cai para a oferta TMDB quando e a unica exibivel', () => {
    const offer = selectTickerWatchOffer([tmdbRow()])
    expect(offer!.destinationKind).toBe('aggregator')
    expect(offer!.attribution!.text).toBe('Disponibilidade fornecida por JustWatch')
  })
})

describe('NAO-REGRESSAO: o caminho streaming_availability nao mudou', () => {
  it('painel so com ofertas do agregador continua identico ao contrato anterior', () => {
    const view = buildWatchAvailabilityView([
      aggregatorRow({ providerName: 'Netflix', providerKey: 'netflix', providerSlug: 'netflix' }),
      aggregatorRow({
        providerName: 'Max',
        providerKey: 'max',
        providerSlug: 'max',
        offerType: 'rent',
        deepLink: 'https://max.com/r',
        priceAmount: '12.90',
        currency: 'BRL',
      }),
    ])
    expect(view!.groups.map((g) => g.offerType)).toEqual(['subscription', 'rent'])
    expect(view!.groups[0]!.offers[0]!.destinationUrl).toBe('https://www.netflix.com/title/1')
    expect(view!.groups[1]!.offers[0]!.priceLabel).toBe('R$ 12.90')
    expect(view!.attributions).toEqual([
      {
        text: 'Disponibilidade fornecida por Movie of the Night',
        url: 'https://www.movieofthenight.com/about/api',
      },
    ])
    expect(view!.updatedAtLabel).toBe('Atualizado em 01/08/2026')
  })

  it('gate de licenca continua absoluto para as DUAS origens', () => {
    expect(buildWatchAvailabilityView([aggregatorRow({ displayAllowed: false })])).toBeNull()
    expect(buildWatchAvailabilityView([tmdbRow({ displayAllowed: false })])).toBeNull()
  })

  it('modalidade ilegal/desconhecida continua descartada nas DUAS origens', () => {
    expect(buildWatchAvailabilityView([aggregatorRow({ offerType: 'addon' })])).toBeNull()
    expect(buildWatchAvailabilityView([tmdbRow({ offerType: 'addon' })])).toBeNull()
    expect(buildWatchAvailabilityView([tmdbRow({ offerType: 'cinema' })])).toBeNull()
    expect(buildWatchAvailabilityView([aggregatorRow({ offerType: 'torrent' })])).toBeNull()
  })

  it('`ads` passa a ser exibida nas DUAS origens, com o mesmo rotulo', () => {
    // Antes `ads` era descartada e sumia da tela sem log. O vocabulario agora e
    // unico (`watch-offer-modality.ts`), entao as duas origens produzem o MESMO
    // rotulo — divergir aqui seria a mesma plataforma dizendo precos diferentes
    // conforme quem transportou o dado.
    const viaAggregator = buildWatchAvailabilityView([aggregatorRow({ offerType: 'ads' })])
    const viaTmdb = buildWatchAvailabilityView([tmdbRow({ offerType: 'ads' })])
    expect(viaAggregator?.groups[0]?.label).toBe('Grátis com anúncios')
    expect(viaTmdb?.groups[0]?.label).toBe('Grátis com anúncios')
  })
})
