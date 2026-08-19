/**
 * promotion-territory.test.ts — O caminho de promocao NAO consegue acender uma
 * oferta fora do Brasil. Provado nos DOIS sentidos.
 *
 * ============ POR QUE ESTE ARQUIVO EXISTE ============
 *
 * `watch_availability` guarda ofertas de 138 paises (o payload do TMDB traz o
 * mundo inteiro por titulo). A leva BR de 2026-08-19 registrou 24 provedores
 * novos, e um provedor registrado passa a ter licenca + decisao de uso — o que
 * remove o unico obstaculo ACIDENTAL que mantinha as ofertas estrangeiras
 * apagadas (elas nao tinham provedor canonico). O que resta e o obstaculo
 * DELIBERADO. Este arquivo prova que ele existe e que aguenta.
 *
 * ============ AS QUATRO BARREIRAS, E O QUE CADA TESTE ALCANCA ============
 *
 *  1. `evaluatePromotionEligibility` recusa `wrong-country`  — PURO, aqui.
 *  2. `runPromotion` nunca entrega um id nao-BR ao store      — PURO, aqui.
 *  3. `listCandidates` filtra `country_code` no banco         — PURO, aqui
 *     (a porta e verificada; o SQL do adapter, nao).
 *  4. o UPDATE do adapter tem `AND w."country_code" = 'BR'` e o trigger
 *     `watch_availability_display_guard` recusa decisao cujo territorio nao
 *     cobre o pais da oferta — PRECISA DE POSTGRES, e esta em
 *     `scripts/validate-stores-real-postgres.ts` (checks 14 e 15).
 *
 * As barreiras 1-3 vivem em codigo puro e rodam na CI. A 4 e a mais forte —
 * sobrevive a SQL bruto — e por isso mesmo nao cabe num teste sem banco.
 * Declarar aqui onde ela e verificada e melhor do que fingir que ela nao existe
 * ou que este arquivo a cobre.
 *
 * ============ SOBRE OS CONTROLES NEGATIVOS ============
 *
 * Nenhuma assercao aqui compara texto de fonte. Elas medem COMPORTAMENTO:
 * apagar a linha `if (candidate.countryCode... ) return reject('wrong-country')`
 * de `guardrails.ts` faz os testes deste arquivo reprovarem — inclusive o que
 * observa a chamada do store, que e o que de fato mutaria o banco.
 */

import { describe, expect, it, vi } from 'vitest'

import { STREAMING_AVAILABILITY_PROVIDER_API } from '@screena/streaming-availability-client'

import {
  PROMOTION_COUNTRY,
  evaluatePromotionEligibility,
} from '../promotion/guardrails.js'
import { runPromotion, runReview, type ReviewStorePort } from '../promotion/run.js'
import type { SyncLogPort } from '../ports.js'
import type { PromotionCandidate } from '../promotion/types.js'

const NOW = new Date('2026-08-19T12:00:00.000Z')

/**
 * Paises REAIS que o banco carrega alem do Brasil. Nao e lista decorativa: sao
 * os territorios citados no enunciado da leva ("o banco tem ofertas de
 * Argentina, Australia e outros paises") mais os que o payload do TMDB traz com
 * mais frequencia.
 */
const PAISES_ESTRANGEIROS = ['AR', 'AU', 'US', 'PT', 'GB', 'MX', 'ES', 'FR', 'DE', 'JP'] as const

/**
 * Uma oferta PERFEITA em tudo, menos o pais: provedor governado, alias
 * resolvido, modalidade legal, destino https, credito hidratado, sem validade.
 *
 * A perfeicao e o ponto. Se faltasse qualquer outra coisa, a recusa poderia vir
 * de outro guard e o teste passaria pelo motivo errado — o defeito que este
 * repositorio ja teve tres vezes.
 */
function ofertaPerfeitaEm(countryCode: string): PromotionCandidate {
  return {
    id: '900',
    entityType: 'movie',
    entityId: '10',
    title: 'Titulo Estrangeiro',
    countryCode,
    providerApi: 'tmdb',
    providerKey: '1825',
    providerName: 'HBO Max Amazon Channel',
    canonicalProviderSlug: 'hbo-max-amazon-channel',
    offerType: 'subscription',
    deepLink: null,
    webUrl: 'https://www.themoviedb.org/movie/550/watch?locale=AR',
    price: null,
    currency: null,
    quality: 'hd',
    availableUntil: null,
    fetchedAt: NOW,
    displayAllowed: false,
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por JustWatch',
    attributionUrl: 'https://www.justwatch.com/',
  }
}

interface Harness {
  readonly store: ReviewStorePort
  readonly promote: ReturnType<typeof vi.fn>
  readonly revoke: ReturnType<typeof vi.fn>
  readonly listCandidates: ReturnType<typeof vi.fn>
  readonly syncLog: SyncLogPort
}

function makeHarness(rows: readonly PromotionCandidate[]): Harness {
  const listCandidates = vi.fn(async () => rows)
  const findByIds = vi.fn(async () => rows)
  const promote = vi.fn(async (ids: readonly string[]) => ({ updated: ids.length }))
  const revoke = vi.fn(async (ids: readonly string[]) => ({ updated: ids.length }))
  return {
    store: { listCandidates, findByIds, promote, revoke },
    promote,
    revoke,
    listCandidates,
    syncLog: { write: vi.fn(async () => undefined) },
  }
}

describe('T4 — o guardrail puro recusa todo pais que nao seja BR', () => {
  it('CONTROLE POSITIVO: a MESMA oferta, em BR, e elegivel', () => {
    // Sem este par, um `wrong-country` universal (recusar tudo) passaria como
    // se fosse a regra territorial funcionando.
    const decisao = evaluatePromotionEligibility(ofertaPerfeitaEm('BR'), { now: NOW })
    expect(decisao.eligible).toBe(true)
    expect(decisao.reason).toBeNull()
  })

  it('CONTROLE NEGATIVO: nenhum dos 10 paises estrangeiros e elegivel', () => {
    for (const pais of PAISES_ESTRANGEIROS) {
      const decisao = evaluatePromotionEligibility(ofertaPerfeitaEm(pais), { now: NOW })
      expect(decisao.eligible, `${pais} nao pode ser elegivel`).toBe(false)
      // O MOTIVO importa tanto quanto a recusa: `wrong-country` e o unico que
      // manda o operador para a decisao certa. Se viesse `missing-link`, a
      // recusa seria acidental e sumiria no dia em que o link aparecesse.
      expect(decisao.reason, `${pais} deve recusar por territorio`).toBe('wrong-country')
    }
  })

  it('o pais so normaliza CAIXA — nunca prefixo, sufixo ou vizinho', () => {
    // `br` minusculo e o mesmo territorio escrito em outra caixa.
    expect(evaluatePromotionEligibility(ofertaPerfeitaEm('br'), { now: NOW }).eligible).toBe(true)
    // Tudo o mais e outro pais (ou nao e pais nenhum).
    for (const quase of ['BRA', 'B', '', ' BR', 'BR ', 'RB', 'BZ']) {
      const decisao = evaluatePromotionEligibility(ofertaPerfeitaEm(quase), { now: NOW })
      expect(decisao.reason, `"${quase}" nao pode passar por BR`).toBe('wrong-country')
    }
  })

  it('o territorio governado e um so, e e o Brasil', () => {
    expect(PROMOTION_COUNTRY).toBe('BR')
  })

  it('a recusa territorial vem ANTES de tudo que possa ser consertado', () => {
    // Precedencia: `wrong-provider` (fornecedor nao governado) vence, porque nem
    // olhamos dado de fora do escopo. Depois vem o pais — e ele vence
    // `invalid-offer-type`, `no-canonical-provider`, `missing-link` e
    // `missing-attribution`. Isso importa: se a ordem fosse outra, o operador
    // receberia "falta o link" para uma oferta argentina e passaria a tarde
    // consertando um link que nunca poderia acender.
    const argentinaQuebrada = {
      ...ofertaPerfeitaEm('AR'),
      offerType: 'ads',
      canonicalProviderSlug: null,
      webUrl: null,
      deepLink: null,
      attributionText: null,
    }
    expect(evaluatePromotionEligibility(argentinaQuebrada, { now: NOW }).reason).toBe(
      'wrong-country',
    )
    // ...e o fornecedor nao governado continua vencendo o pais.
    expect(
      evaluatePromotionEligibility(
        { ...ofertaPerfeitaEm('AR'), providerApi: 'fornecedor-fantasma' },
        { now: NOW },
      ).reason,
    ).toBe('wrong-provider')
  })
})

describe('T4 — o fluxo de promocao nunca entrega um id estrangeiro ao banco', () => {
  it('CONTROLE NEGATIVO: com --confirm e id valido, o store NAO e chamado', async () => {
    // Esta e a assercao que mede o que de fato mutaria o banco. Um guardrail que
    // devolvesse `wrong-country` mas cujo id vazasse para `promote()` seria uma
    // recusa decorativa.
    const harness = makeHarness([ofertaPerfeitaEm('AR')])
    const resultado = await runPromotion(
      { ids: ['900'], country: 'AR', confirm: true, revoke: false, reviewer: 'pablo@cinerie' },
      { store: harness.store, syncLog: harness.syncLog, now: () => NOW },
    )
    expect(harness.promote).not.toHaveBeenCalled()
    expect(harness.revoke).not.toHaveBeenCalled()
    expect(resultado.updated).toBe(0)
    expect(resultado.eligibleIds).toEqual([])
    expect(resultado.summary.byReason).toEqual([{ reason: 'wrong-country', count: 1 }])
  })

  it('CONTROLE POSITIVO: a mesma chamada, com a oferta em BR, chama o store', async () => {
    const harness = makeHarness([ofertaPerfeitaEm('BR')])
    const resultado = await runPromotion(
      { ids: ['900'], country: 'BR', confirm: true, revoke: false, reviewer: 'pablo@cinerie' },
      { store: harness.store, syncLog: harness.syncLog, now: () => NOW },
    )
    expect(harness.promote).toHaveBeenCalledTimes(1)
    expect(harness.promote).toHaveBeenCalledWith(['900'], 'pablo@cinerie')
    expect(resultado.updated).toBe(1)
  })

  it('lote misto: so o brasileiro vai para o store, e o resto e NOMEADO', async () => {
    // O desfecho perigoso nao e "recusa tudo" — e "acende junto". Um lote com
    // BR e AR precisa promover so o BR e dizer, por motivo, o que ficou.
    const harness = makeHarness([
      { ...ofertaPerfeitaEm('BR'), id: '1' },
      { ...ofertaPerfeitaEm('AR'), id: '2' },
      { ...ofertaPerfeitaEm('US'), id: '3' },
    ])
    const resultado = await runPromotion(
      {
        ids: ['1', '2', '3'],
        country: 'BR',
        confirm: true,
        revoke: false,
        reviewer: 'pablo@cinerie',
      },
      { store: harness.store, syncLog: harness.syncLog, now: () => NOW },
    )
    expect(harness.promote).toHaveBeenCalledWith(['1'], 'pablo@cinerie')
    expect(resultado.eligibleIds).toEqual(['1'])
    expect(resultado.summary).toMatchObject({
      found: 3,
      eligible: 1,
      rejected: 2,
      byReason: [{ reason: 'wrong-country', count: 2 }],
    })
  })

  it('a REVERSAO nao e territorial — apagar oferta estrangeira sempre pode', async () => {
    // Assimetria deliberada: acender e territorial, apagar nao. Exigir BR no
    // revoke deixaria uma oferta estrangeira acesa por qualquer caminho
    // historico sem forma de apaga-la pela ferramenta.
    const harness = makeHarness([{ ...ofertaPerfeitaEm('AR'), displayAllowed: true }])
    const resultado = await runPromotion(
      { ids: ['900'], country: 'AR', confirm: true, revoke: true, reviewer: '' },
      { store: harness.store, syncLog: harness.syncLog, now: () => NOW },
    )
    expect(harness.revoke).toHaveBeenCalledWith(['900'])
    expect(resultado.updated).toBe(1)
  })
})

describe('T4 — a revisao tambem nao alcanca dado de outro pais', () => {
  it('a consulta ao banco carrega o pais pedido, e so ele', async () => {
    const harness = makeHarness([ofertaPerfeitaEm('BR')])
    await runReview(
      {
        kind: 'movie',
        country: PROMOTION_COUNTRY,
        entityId: null,
        limit: 20,
        providerApis: [STREAMING_AVAILABILITY_PROVIDER_API, 'tmdb'],
      },
      { store: harness.store, now: () => NOW },
    )
    expect(harness.listCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ countryCode: 'BR' }),
    )
  })

  it('se uma linha estrangeira vazar para a listagem, ela aparece RECUSADA', async () => {
    // Defesa em profundidade: mesmo que o filtro do banco falhasse, a revisao
    // nao pode reportar a oferta argentina como elegivel — seria um convite a
    // promove-la por id.
    const harness = makeHarness([ofertaPerfeitaEm('AR')])
    const revisao = await runReview(
      { kind: null, country: 'BR', entityId: null, limit: 20, providerApis: ['tmdb'] },
      { store: harness.store, now: () => NOW },
    )
    expect(revisao.evaluated[0]?.eligible).toBe(false)
    expect(revisao.evaluated[0]?.reason).toBe('wrong-country')
  })
})
