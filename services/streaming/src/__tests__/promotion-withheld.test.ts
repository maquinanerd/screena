/**
 * promotion-withheld.test.ts — "Elegivel e deliberadamente NAO promovido" passou
 * a ser dizivel.
 *
 * ============ O BURACO QUE ISTO FECHA ============
 *
 * As 5 ofertas BR que chegam pela RapidAPI (`prime`, `apple`, `hbo`) nao tinham
 * nada as bloqueando: alias existe, licenca existe, decisao existe. O unico
 * motivo de estarem apagadas era ninguem ter rodado `promote --ids` com elas.
 *
 * Isso nao e registro — e sorte. Uma revisao de rotina daqui a tres meses
 * mostraria as linhas como ELEGIVEL, e o operador as promoveria sem ter como
 * saber que ja havia decisao em contrario. Decisao do dono (2026-08-19): nao
 * promover, porque sao as MESMAS plataformas que ja acendem pela TMDB —
 * "Prime Video" apareceria duas vezes na mesma pagina, com creditos de origem
 * diferentes.
 *
 * O vocabulario ganhou `withheld-by-decision`, e a decisao virou dado
 * (`WITHHELD_OFFER_SOURCES`) com data, autor e motivo.
 */

import { describe, expect, it, vi } from 'vitest'

import { STREAMING_AVAILABILITY_PROVIDER_API } from '@screena/streaming-availability-client'

import {
  WITHHELD_OFFER_SOURCES,
  evaluatePromotionEligibility,
  evaluateRevocationEligibility,
  findWithheldDecision,
} from '../promotion/guardrails.js'
import { runPromotion, type ReviewStorePort } from '../promotion/run.js'
import { renderReviewReport, summaryLine } from '../promotion/report.js'
import { runReview } from '../promotion/run.js'
import type { SyncLogPort } from '../ports.js'
import type { PromotionCandidate } from '../promotion/types.js'

const NOW = new Date('2026-08-19T12:00:00.000Z')

/**
 * Uma oferta da RapidAPI PERFEITA em tudo: alias resolvido, modalidade legal,
 * deep link https, credito hidratado, BR, sem validade.
 *
 * A perfeicao e o ponto. Se faltasse qualquer outra coisa, a recusa poderia vir
 * de outro guard e o teste passaria pelo motivo errado.
 */
function candidate(overrides: Partial<PromotionCandidate> = {}): PromotionCandidate {
  return {
    id: '500',
    entityType: 'movie',
    entityId: '10',
    title: 'Titulo Qualquer',
    countryCode: 'BR',
    providerApi: STREAMING_AVAILABILITY_PROVIDER_API,
    providerKey: 'prime',
    providerName: 'Prime Video',
    canonicalProviderSlug: 'prime-video',
    offerType: 'subscription',
    deepLink: 'https://exemplo.test/prime/1',
    webUrl: null,
    price: null,
    currency: null,
    quality: 'hd',
    availableUntil: null,
    fetchedAt: NOW,
    displayAllowed: false,
    requiresAttribution: true,
    requiresLinkback: true,
    attributionText: 'Disponibilidade fornecida por Movie of the Night',
    attributionUrl: 'https://www.movieofthenight.com/about/api',
    ...overrides,
  }
}

describe('a decisao de reter e DADO, nao ausencia de acao', () => {
  it('as tres origens retidas estao declaradas, com data, autor e motivo', () => {
    expect(WITHHELD_OFFER_SOURCES).toHaveLength(3)
    for (const entry of WITHHELD_OFFER_SOURCES) {
      expect(entry.providerApi).toBe(STREAMING_AVAILABILITY_PROVIDER_API)
      expect(entry.decidedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.decidedBy.trim()).not.toBe('')
      // O motivo vai INTEIRO para a saida do comando: quem le nao precisa abrir
      // o codigo para entender por que aquela linha nao acende.
      expect(entry.reason.length).toBeGreaterThan(40)
    }
    expect(WITHHELD_OFFER_SOURCES.map((e) => e.providerKey).sort()).toEqual([
      'apple',
      'hbo',
      'prime',
    ])
  })

  it('findWithheldDecision acha por (fornecedor, chave), nunca so por chave', () => {
    expect(findWithheldDecision(STREAMING_AVAILABILITY_PROVIDER_API, 'prime')).not.toBeNull()
    // A MESMA chave sob outro fornecedor nao e a mesma origem. Se a busca
    // ignorasse o fornecedor, uma chave `prime` que surgisse no TMDB seria
    // retida por engano.
    expect(findWithheldDecision('tmdb', 'prime')).toBeNull()
    expect(findWithheldDecision(null, 'prime')).toBeNull()
    expect(findWithheldDecision(STREAMING_AVAILABILITY_PROVIDER_API, null)).toBeNull()
  })
})

describe('uma oferta retida NAO promove — e diz por que', () => {
  it('CONTROLE NEGATIVO: perfeita em tudo, e ainda assim recusada', () => {
    const decisao = evaluatePromotionEligibility(candidate(), { now: NOW })
    expect(decisao.eligible).toBe(false)
    expect(decisao.reason).toBe('withheld-by-decision')
  })

  it('CONTROLE POSITIVO: a MESMA oferta sob chave nao retida e elegivel', () => {
    // Sem este par, `withheld-by-decision` poderia estar recusando tudo e o
    // teste acima nao notaria.
    const decisao = evaluatePromotionEligibility(
      candidate({ providerKey: 'netflix', canonicalProviderSlug: 'netflix' }),
      { now: NOW },
    )
    expect(decisao.eligible).toBe(true)
  })

  it('a mesma PLATAFORMA pela origem TMDB continua promovivel', () => {
    // A decisao retem a ORIGEM (a chave da RapidAPI), nao a plataforma. O
    // Prime Video pela TMDB (`provider_id` 119) e exatamente o que deve acender.
    const decisao = evaluatePromotionEligibility(
      candidate({
        providerApi: 'tmdb',
        providerKey: '119',
        deepLink: null,
        webUrl: 'https://exemplo.test/br/119',
        attributionText: 'Disponibilidade fornecida por JustWatch',
        attributionUrl: 'https://exemplo.test/justwatch',
      }),
      { now: NOW },
    )
    expect(decisao.eligible).toBe(true)
  })

  it('a retencao vence `already-display-allowed` (o desfecho mais grave primeiro)', () => {
    // Uma linha retida que estivesse ACESA e o pior caso possivel aqui.
    // Reportar "ja exibivel" a esconderia atras de um motivo inofensivo.
    const decisao = evaluatePromotionEligibility(candidate({ displayAllowed: true }), { now: NOW })
    expect(decisao.reason).toBe('withheld-by-decision')
  })

  it('pais e fornecedor ainda vencem a retencao (escopo antes de decisao)', () => {
    // Nao olhamos dado fora do escopo governado — nem para dizer que esta retido.
    expect(
      evaluatePromotionEligibility(candidate({ providerApi: 'omdb' }), { now: NOW }).reason,
    ).toBe('wrong-provider')
    expect(
      evaluatePromotionEligibility(candidate({ countryCode: 'AR' }), { now: NOW }).reason,
    ).toBe('wrong-country')
  })

  it('REVOGAR uma oferta retida continua possivel (assimetria deliberada)', () => {
    // Reter e sobre ACENDER. Se uma linha retida estiver acesa por um caminho
    // historico, a ferramenta precisa poder apaga-la.
    const decisao = evaluateRevocationEligibility(candidate({ displayAllowed: true }))
    expect(decisao.eligible).toBe(true)
  })
})

describe('o fluxo inteiro nunca entrega um id retido ao banco', () => {
  it('com --confirm e id valido, o store NAO e chamado', async () => {
    const rows = [candidate()]
    const promote = vi.fn(async (ids: readonly string[]) => ({ updated: ids.length }))
    const store: ReviewStorePort = {
      listCandidates: vi.fn(async () => rows),
      findByIds: vi.fn(async () => rows),
      promote,
      revoke: vi.fn(async (ids: readonly string[]) => ({ updated: ids.length })),
    }
    const syncLog: SyncLogPort = { write: vi.fn(async () => undefined) }

    const resultado = await runPromotion(
      { ids: ['500'], country: 'BR', confirm: true, revoke: false, reviewer: 'pablo@cinerie' },
      { store, syncLog, now: () => NOW },
    )
    expect(promote).not.toHaveBeenCalled()
    expect(resultado.updated).toBe(0)
    expect(resultado.summary.byReason).toEqual([{ reason: 'withheld-by-decision', count: 1 }])
  })
})

describe('a decisao aparece para quem for ler daqui a tres meses', () => {
  const store: ReviewStorePort = {
    listCandidates: async () => [candidate()],
    findByIds: async () => [candidate()],
    promote: async (ids) => ({ updated: ids.length }),
    revoke: async (ids) => ({ updated: ids.length }),
  }

  it('o resumo do console NOMEIA o motivo', async () => {
    const revisao = await runReview(
      { kind: null, country: 'BR', entityId: null, limit: 10, providerApis: [STREAMING_AVAILABILITY_PROVIDER_API] },
      { store, now: () => NOW },
    )
    expect(summaryLine(revisao.summary)).toContain('withheld-by-decision')
  })

  it('o relatorio traz a tabela de retencao MESMO sem candidata retida no filtro', async () => {
    // O ponto: quem le o relatorio precisa encontrar a decisao sem ter tido a
    // sorte de a oferta aparecer no filtro daquele dia. Uma decisao que so
    // aparece quando ja foi acionada nao previne nada.
    const vazio: ReviewStorePort = {
      listCandidates: async () => [],
      findByIds: async () => [],
      promote: async () => ({ updated: 0 }),
      revoke: async () => ({ updated: 0 }),
    }
    const revisao = await runReview(
      { kind: null, country: 'BR', entityId: null, limit: 10, providerApis: ['tmdb'] },
      { store: vazio, now: () => NOW },
    )
    const markdown = renderReviewReport(revisao)
    expect(revisao.evaluated).toEqual([])
    expect(markdown).toContain('Origens retidas por decisao humana')
    for (const entry of WITHHELD_OFFER_SOURCES) {
      expect(markdown).toContain(entry.providerKey)
      expect(markdown).toContain(entry.decidedOn)
    }
    // E diz COMO reverter — sem isso, o leitor conclui que precisa promover por id.
    expect(markdown).toContain('WITHHELD_OFFER_SOURCES')
  })
})
