/**
 * credit-required-on-display.test.ts — "DADO NO AR EXIGE CREDITO NA PAGINA."
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO DEFENDIA, E O QUE ELE DEFENDE AGORA
 * ============================================================================
 * A autorizacao dos provedores (2026-08-11) liberou a COLETA de notas e
 * disponibilidade em producao. A condicao dessa autorizacao e o uso
 * JORNALISTICO com credito visivel a fonte em toda exibicao
 * (`requires_attribution = true` em `source_licenses`). ISSO NAO MUDOU.
 *
 * O que mudou foi o ENDERECO do credito. Decisao do proprietario (Pablo Eduardo,
 * 2026-08-13): todo credito de fonte sai do corpo das paginas e passa a viver no
 * RODAPE GLOBAL.
 *
 * A versao anterior deste arquivo travava a regra na forma "o presenter RECUSA a
 * linha sem credito adjacente". Essa forma morreu com a decisao — e os testes
 * dela nao foram deletados, foram REESCRITOS: os que exigiam a recusa agora
 * exigem o contrario (a linha PASSA, porque o credito nao mora mais ali), e
 * apontam para onde a garantia foi morar.
 *
 *   A trava nova vive em
 *   `apps/web/app/_components/__tests__/footer-credits.test.tsx`:
 *     metade 1 — o rodape nomeia TODA fonte autorizada (derivado de
 *                `services/legal`, entao nao pode esquecer nenhuma);
 *     metade 2 — o rodape esta em toda pagina que exibe dado licenciado.
 *
 * O QUE CONTINUA AQUI, INTACTO: os gates que NAO se mudaram — licenca
 * (`display_allowed`), escala da nota, nome do provedor, destino da oferta e
 * estado vazio honesto. Nenhum deles tem a ver com onde o credito e desenhado, e
 * afrouxar qualquer um deles continua sendo violacao.
 *
 * Ele exercita os presenters PUROS (nao o JSX): sao eles que decidem o que chega
 * a tela. Um item que o presenter descarta nunca vira DOM.
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

describe('ratings: o credito saiu do chip, mas continua VIAJANDO no dado', () => {
  it('CONTROLE POSITIVO: nota valida aparece, com fonte, escala e a atribuicao preservada', () => {
    const view = buildRatingsView({ ratings: [RATING_CREDITADA] } as never)

    expect(view).not.toBeNull()
    const item = view!.items[0]!
    // "7,9 IMDb", nunca "7,9" solto.
    expect(item.sourceLabel).toBe('IMDb')
    expect(item.scoreLabel).toBe('7,9/10')
    // A atribuicao NAO e mais desenhada ao lado da nota, mas continua no item:
    // e proveniencia, alimenta auditoria e e o que liga a nota ao credito do
    // rodape. Perder o campo seria perder o rastro.
    expect(item.attribution.text).toBe('Nota fornecida por IMDb')
    expect(item.attribution.url).toBe('https://www.imdb.com/title/tt0000000/')
  })

  it('REESCRITO: nota SEM texto de atribuicao AGORA vai ao ar — o credito esta no rodape', () => {
    // Antes: `expect(view).toBeNull()`. O credito ficava dentro do chip, entao
    // sem credito nao havia o que desenhar e a nota caia junto.
    // Agora: o credito vem do rodape, derivado da LICENCA da fonte — nao da
    // linha. Uma linha sem `attribution_text` continua sendo anomalia de
    // ingestao (o trigger `external_ratings_display_guard` a recusa na escrita),
    // mas a decisao de desenhar a nota deixou de depender disso.
    const view = buildRatingsView({
      ratings: [{ ...RATING_CREDITADA, attribution: { text: null, url: null } }],
    } as never)

    expect(view).not.toBeNull()
    expect(view!.items[0]!.scoreLabel).toBe('7,9/10')
    expect(view!.items[0]!.attribution.text).toBeNull()
  })

  it('REESCRITO: atribuicao VAZIA (so espacos) nao derruba a nota, e normaliza para null', () => {
    const view = buildRatingsView({
      ratings: [{ ...RATING_CREDITADA, attribution: { text: '   ', url: null } }],
    } as never)

    expect(view).not.toBeNull()
    // Espaco em branco NAO vira credito de mentira: normaliza para `null`, que e
    // "nao ha credito nesta linha", nao "o credito e uma string vazia".
    expect(view!.items[0]!.attribution.text).toBeNull()
  })

  it('REESCRITO: nota sem o objeto de atribuicao nao derruba a nota', () => {
    const view = buildRatingsView({
      ratings: [{ ...RATING_CREDITADA, attribution: undefined }],
    } as never)

    expect(view).not.toBeNull()
    expect(view!.items[0]!.attribution.text).toBeNull()
  })

  it('INTACTO: a escala acompanha o numero — nunca existe nota sem denominador', () => {
    // Sem escala confiavel o numero e ambiguo ("7,9" de quanto?), e um 92 do
    // Rotten Tomatoes viraria indistinguivel de um 9,2 do IMDb (invariante 1).
    // Este gate nao tem nada a ver com credito e continua bloqueante.
    const view = buildRatingsView({
      ratings: [{ ...RATING_CREDITADA, best: 0 }],
    } as never)
    expect(view).toBeNull()
  })

  it('INTACTO: ESTADO VAZIO HONESTO — sem nota exibivel, o painel some', () => {
    // "Sem avaliacoes" seria uma afirmacao sobre o MUNDO. A verdade e sobre NOS:
    // nao ha nota para exibir. O painel inteiro nao renderiza.
    expect(buildRatingsView({ ratings: [] } as never)).toBeNull()
  })
})

/**
 * Oferta valida e creditada — o caso de referencia.
 *
 * Este objeto e um CONTROLE POSITIVO, nao decoracao. Sem ele, os negativos
 * abaixo passariam pelo motivo errado: um fixture malformado faz o presenter
 * devolver `null` em TODOS os casos, e "esperava null, recebeu null" nao prova
 * nada. Foi exatamente o que aconteceu na primeira versao deste arquivo (faltava
 * `displayAllowed`).
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

describe('streaming: nome do provedor e DESTINO continuam bloqueantes; o credito mudou de lugar', () => {
  it('CONTROLE POSITIVO: oferta valida aparece, com o NOME do provedor visivel', () => {
    const view = buildWatchAvailabilityView([OFERTA_CREDITADA] as never)

    expect(view).not.toBeNull()
    const offer = view!.groups[0]!.offers[0]!
    expect(offer.providerName).toBe('Netflix')
    // A proveniencia continua sendo montada, mesmo sem ir para a tela deste painel.
    expect(view!.attributions[0]?.text).toBe('Disponibilidade fornecida por Movie of the Night')
  })

  it('REESCRITO: oferta sem texto de atribuicao AGORA vai ao ar — o credito esta no rodape', () => {
    // Antes: `expect(view).toBeNull()`. O credito era desenhado sob o painel.
    // Agora o rodape credita as DUAS origens possiveis de oferta a partir de
    // `STREAMING_ORIGIN_CREDITS`, entao a origem nunca fica sem credito na
    // pagina — independentemente do que a LINHA carregue.
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, attributionText: null },
    ] as never)

    expect(view).not.toBeNull()
    expect(view!.groups[0]!.offers[0]!.providerName).toBe('Netflix')
    // Credito ausente na linha nao vira credito vazio na lista de proveniencia.
    expect(view!.attributions).toHaveLength(0)
  })

  it('REESCRITO: oferta sem linkback de credito AGORA vai ao ar', () => {
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, attributionUrl: null },
    ] as never)

    expect(view).not.toBeNull()
    expect(view!.groups[0]!.offers[0]!.providerName).toBe('Netflix')
  })

  it('INTACTO: oferta sem DESTINO nao vai ao ar — e link quebrado, nao falta de credito', () => {
    // A distincao que o enunciado da migracao exigiu preservar: `attribution_url`
    // e o linkback para a FONTE (mudou de lugar); `deep_link`/`web_url` sao para
    // onde o usuario vai ASSISTIR (continua bloqueante). Sao campos diferentes.
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, deepLink: null, webUrl: null },
    ] as never)
    expect(view).toBeNull()
  })

  it('INTACTO: oferta sem NOME de provedor nao vai ao ar', () => {
    // Um link "Assistir" sem dizer onde nao e disponibilidade: e um clique cego.
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, providerName: null },
    ] as never)
    expect(view).toBeNull()
  })

  it('INTACTO: ESTADO VAZIO HONESTO — sem oferta exibivel, o painel some', () => {
    expect(buildWatchAvailabilityView([] as never)).toBeNull()
  })

  it('INTACTO: oferta sem display_allowed nao vai ao ar (invariante 6 continua valendo)', () => {
    // A autorizacao do provedor liberou a COLETA. Ela nao toca no gate de
    // licenca da EXIBICAO — que continua sendo a palavra final. Mover o credito
    // para o rodape TAMBEM nao toca nele.
    const view = buildWatchAvailabilityView([
      { ...OFERTA_CREDITADA, displayAllowed: false },
    ] as never)
    expect(view).toBeNull()
  })
})
