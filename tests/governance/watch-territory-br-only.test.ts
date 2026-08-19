/**
 * watch-territory-br-only.test.ts — Nenhuma decisao de exibicao de oferta pode
 * ser GLOBAL. Toda `watch_offer_display` nasce com territorio `BR`.
 *
 * ============ O UNICO BURACO POSSIVEL, E POR QUE ELE PRECISA DE GUARDA ========
 *
 * O trigger `watch_availability_display_guard` recusa a oferta quando o
 * territorio da decisao nao cobre o pais da linha. A clausula literal e:
 *
 *   IF decision."territory" IS NOT NULL AND decision."territory" <> NEW."country_code"
 *
 * Leia com atencao o `IS NOT NULL`: uma decisao com `territory = NULL` e GLOBAL,
 * e cobre QUALQUER pais. Ela e legitima para outros usos (`internal_analytics`
 * de uma fonte sem recorte territorial, por exemplo), e por isso a coluna e
 * anulavel e o trigger a aceita.
 *
 * Consequencia: se algum dia uma decisao `watch_offer_display` fosse emitida com
 * `territory = null`, a barreira territorial mais profunda — a unica que
 * sobrevive a SQL bruto — deixaria de existir para TODA oferta de streaming, em
 * silencio. Nao haveria erro, nao haveria log: ofertas da Argentina, da
 * Australia e de outros 135 paises passariam a ser promoviveis.
 *
 * As barreiras de aplicacao (`evaluatePromotionEligibility`, o `WHERE` do
 * `promote()`) continuariam de pe — mas elas sao codigo nosso, e a razao de o
 * trigger existir e justamente nao depender so disso.
 *
 * Este arquivo fecha esse buraco na origem: o unico lugar do repositorio que
 * emite decisoes `watch_offer_display` e `streamingProviderEntries`, e aqui se
 * prova que ela nao consegue emitir uma decisao global.
 *
 * ============ POR QUE NAO E TESTE DE STRING ============
 *
 * A assercao chama a funcao de verdade, com provedores de verdade, e le o valor
 * do objeto que ela devolve — o mesmo objeto que `legal sources apply` grava.
 * Trocar `CINERIE_TERRITORY` por `null` no spec faz este arquivo reprovar.
 */

import { describe, expect, it } from 'vitest'

import {
  CINERIE_TERRITORY,
  STATIC_AUTHORIZATION,
  streamingProviderEntries,
} from '../../services/legal/src/authorization-spec'

/** Uma fatia real do registro canonico, incluindo provedores da leva BR. */
const PROVEDORES = [
  { slug: 'netflix', canonicalName: 'Netflix' },
  { slug: 'hbo-max-amazon-channel', canonicalName: 'HBO Max Amazon Channel' },
  { slug: 'claro-video', canonicalName: 'Claro video' },
  { slug: 'paramount-plus-premium', canonicalName: 'Paramount Plus Premium' },
]

describe('territorialidade das decisoes de exibicao de oferta', () => {
  it('o territorio da Cinerie e BR, e so BR', () => {
    expect(CINERIE_TERRITORY).toBe('BR')
  })

  it('toda decisao watch_offer_display nasce com territorio BR — nunca global', () => {
    const decisoes = streamingProviderEntries(PROVEDORES).flatMap((entry) => entry.decisions)
    expect(decisoes.length).toBeGreaterThan(0)
    for (const decisao of decisoes) {
      expect(decisao.useCase).toBe('watch_offer_display')
      // `null` aqui seria uma decisao GLOBAL, e o trigger a aceitaria para
      // qualquer pais. E o unico caminho pelo qual uma oferta estrangeira
      // poderia acender.
      expect(decisao.territory).not.toBeNull()
      expect(decisao.territory).toBe('BR')
    }
  })

  it('a licenca-mae dessas decisoes tambem e territorial', () => {
    // O trigger revalida a licenca-mae. Uma licenca global sob uma decisao BR
    // nao abriria o buraco sozinha, mas seria a metade dele — e a assimetria
    // entre os dois so se descobre quando alguem precisa dela.
    for (const entry of streamingProviderEntries(PROVEDORES)) {
      expect(entry.license.contentType).toBe('watch_availability')
      expect(entry.license.territory).toBe('BR')
    }
  })

  it('CONTROLE NEGATIVO: nenhuma OUTRA entrada do spec emite watch_offer_display', () => {
    // Se uma entrada estatica emitisse `watch_offer_display` — com territorio
    // global, por descuido — ela autorizaria exibicao de oferta sem passar por
    // este arquivo. O registro dinamico tem de ser a UNICA origem desse uso.
    const estaticasComEsseUso = STATIC_AUTHORIZATION.flatMap((entry) =>
      entry.decisions.filter((d) => d.useCase === 'watch_offer_display'),
    )
    expect(estaticasComEsseUso).toEqual([])
  })

  it('CONTROLE NEGATIVO: sem provedor registrado nao ha decisao nenhuma', () => {
    // Fail-closed na origem: zero provedores => zero licencas => zero decisoes.
    // Nunca uma decisao "guarda-chuva" que valesse para todos.
    expect(streamingProviderEntries([])).toEqual([])
  })
})
