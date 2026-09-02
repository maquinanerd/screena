/**
 * watch-attribution-provenance.test.ts — O credito de uma oferta pertence a
 * ORIGEM do dado, nunca ao provedor canonico.
 *
 * O DEFEITO QUE ISTO TRAVA. `streamingProviderEntries` emitia UMA licenca por
 * provedor canonico, com o credito fixo "Movie of the Night" (o agregador da
 * RapidAPI). Quando a oferta passou a poder vir tambem do bloco
 * `watch/providers` do TMDB — que REVENDE dado do JustWatch —, aquele mesmo
 * credito seria aplicado a um dado de outra origem. Isso nao e credito faltando:
 * e **proveniencia falsa**, que afirma uma fonte que nao e a verdadeira.
 *
 * E a sancao e nominal: os termos do endpoint do TMDB dizem, literalmente, que
 * o uso do dado exige atribuir a fonte como JustWatch, e que uso fora desses
 * termos leva a REVOGACAO do acesso a API. O acesso ao TMDB sustenta o catalogo
 * inteiro (fichas, elenco, imagens, temporadas) — errar aqui nao arrisca so o
 * painel de streaming.
 */

import { describe, expect, it } from 'vitest'

import { TMDB_PROVIDER_API, TMDB_WATCH_ATTRIBUTION_TEXT } from '@screena/tmdb-client'
import { STREAMING_AVAILABILITY_PROVIDER_API } from '../../services/streaming/src/provider-identity.js'

import {
  AUTHORIZATION_BATCH,
  streamingProviderEntries,
} from '../../services/legal/src/authorization-spec'
import { planAuthorization } from '../../services/legal/src/plan'

const PROVIDERS = [
  { slug: 'netflix', canonicalName: 'Netflix' },
  { slug: 'max', canonicalName: 'Max' },
]

const entriesFor = (slug: string) =>
  streamingProviderEntries(PROVIDERS).filter((e) => e.license.sourceKey === slug)

const originOf = (slug: string, providerApi: string) =>
  entriesFor(slug).find((e) => e.license.providerKey === providerApi)

describe('proveniencia: uma licenca de streaming POR FORNECEDOR TECNICO', () => {
  it('cada provedor canonico rende uma entrada por origem (nunca uma so)', () => {
    const netflix = entriesFor('netflix')
    expect(netflix).toHaveLength(2)
    expect(netflix.map((e) => e.license.providerKey).sort()).toEqual(
      [STREAMING_AVAILABILITY_PROVIDER_API, TMDB_PROVIDER_API].sort(),
    )
  })

  it('a origem TMDB credita JUSTWATCH — e o texto vem do client, nao de um literal solto', () => {
    const tmdb = originOf('netflix', TMDB_PROVIDER_API)
    expect(tmdb).toBeDefined()
    expect(tmdb!.license.attributionText).toContain('JustWatch')
    // A igualdade com a constante do client e o que impede as duas declaracoes
    // de divergirem em silencio (o spec nao importa clients, por design).
    expect(tmdb!.license.attributionText).toBe(TMDB_WATCH_ATTRIBUTION_TEXT)
  })

  it('NAO-REGRESSAO: a origem do agregador continua creditando Movie of the Night', () => {
    const aggregator = originOf('netflix', STREAMING_AVAILABILITY_PROVIDER_API)
    expect(aggregator).toBeDefined()
    expect(aggregator!.license.attributionText).toBe('Disponibilidade fornecida por Movie of the Night')
    expect(aggregator!.license.attributionText).not.toContain('JustWatch')
  })

  it('CRUZAMENTO PROIBIDO: nenhuma entrada credita a fonte da outra origem', () => {
    for (const entry of streamingProviderEntries(PROVIDERS)) {
      const creditsJustWatch = entry.license.attributionText.includes('JustWatch')
      const isTmdbOrigin = entry.license.providerKey === TMDB_PROVIDER_API
      expect(
        creditsJustWatch,
        `"${entry.label}" credita JustWatch=${creditsJustWatch} mas a origem e ` +
          `"${entry.license.providerKey}" — credito e origem TEM de andar juntos`,
      ).toBe(isTmdbOrigin)
    }
  })

  it('toda entrada exige atribuicao; marca por decisao do dono, com base e arquivo declarados', () => {
    for (const entry of streamingProviderEntries(PROVIDERS)) {
      expect(entry.license.requiresAttribution).toBe(true)
      expect(entry.license.attributionText.trim()).not.toBe('')
      // Desde 2026-08-20 a marca do provedor e autorizada POR DECISAO DO
      // PROPRIETARIO (docs/legal/owner-authorization-2026-08-20.md), e o
      // registro grava exatamente essa base — nunca "a fonte permitiu". O
      // arquivo entra pendente: sem ele no repositorio, o painel usa a
      // palavra-marca e nada de grafico vai ao ar.
      expect(entry.license.logoAllowed).toBe(true)
      expect(entry.license.logoBasis).toBe('owner_decision')
      expect(entry.license.logoAsset?.status).toBe('pending_official_file')
      expect(entry.license.logoAsset?.path).toBe(`/brand/providers/${entry.license.sourceKey}.svg`)
      expect(entry.license.reviewQuoteAllowed).toBe(false)
      // Nenhuma leva nova foi inventada: as duas origens pertencem ao lote vigente.
      expect(entry.license.policyVersion).toBe(AUTHORIZATION_BATCH)
      expect(entry.decisions).toHaveLength(1)
      expect(entry.decisions[0]!.useCase).toBe('watch_offer_display')
      expect(entry.decisions[0]!.derivativeAllowed).toBe(false)
    }
  })
})

describe('proveniencia: as duas licencas coexistem (grupos distintos)', () => {
  /**
   * ESTA E A ASSERCAO ESTRUTURAL. O indice `source_licenses_current_unique` e
   * `(source_key, content_type, COALESCE(provider_key,''), COALESCE(territory_code,''))`
   * e `licenseGroupKey` em `plan.ts` espelha o mesmo conjunto. Se `provider_key`
   * saisse de qualquer um dos dois lados, as duas licencas de um mesmo slug
   * colidiriam: o planejador supersederia uma com a outra a cada `apply`, e o
   * registro passaria a alternar de credito indefinidamente.
   */
  it('planAuthorization CRIA as duas, sem supersedir uma com a outra', () => {
    const entries = streamingProviderEntries(PROVIDERS)
    const plan = planAuthorization(entries, [], [])

    expect(plan.summary.licensesCreate).toBe(entries.length)
    expect(plan.summary.licensesSupersede).toBe(0)
    expect(plan.entries.every((e) => e.license.action === 'create')).toBe(true)
  })

  it('IDEMPOTENCIA: com as duas ja vigentes, o plano nao escreve nada', () => {
    const entries = streamingProviderEntries(PROVIDERS)
    // Projeta cada entrada como se ja estivesse no banco, VIGENTE.
    const licenses = entries.map((entry, index) => ({
      id: String(index + 1),
      sourceKey: entry.license.sourceKey,
      contentType: entry.license.contentType,
      ratingSourceKey: entry.license.ratingSourceKey,
      providerKey: entry.license.providerKey,
      territory: entry.license.territory,
      licenseStatus: entry.license.licenseStatus,
      displayAllowed: entry.license.displayAllowed,
      logoAllowed: entry.license.logoAllowed,
      scoreAllowed: entry.license.scoreAllowed,
      reviewQuoteAllowed: entry.license.reviewQuoteAllowed,
      requiresAttribution: entry.license.requiresAttribution,
      requiresLinkback: entry.license.requiresLinkback,
      attributionText: entry.license.attributionText,
      policyVersion: entry.license.policyVersion,
    }))
    const decisions = entries.map((entry, index) => ({
      id: String(index + 1),
      sourceLicenseId: String(index + 1),
      useCase: entry.decisions[0]!.useCase,
      territory: entry.decisions[0]!.territory,
      stage: entry.decisions[0]!.stage,
      displayAllowed: entry.decisions[0]!.displayAllowed,
      storageAllowed: entry.decisions[0]!.storageAllowed,
      derivativeAllowed: entry.decisions[0]!.derivativeAllowed,
      attributionRequired: entry.decisions[0]!.attributionRequired,
      linkbackRequired: entry.decisions[0]!.linkbackRequired,
      policyVersion: entry.decisions[0]!.policyVersion,
    }))

    const plan = planAuthorization(entries, licenses, decisions)
    expect(plan.summary.licensesCreate).toBe(0)
    expect(plan.summary.licensesSupersede).toBe(0)
    expect(plan.summary.decisionsCreate).toBe(0)
    expect(plan.summary.decisionsSupersede).toBe(0)
  })

  /**
   * CONTROLE POSITIVO. Se as duas entradas cairem no MESMO grupo (por exemplo,
   * porque alguem removeu `provider_key` do agrupamento), este teste falha —
   * e ele falha AQUI, e nao seis meses depois num apply de producao que fica
   * trocando o credito a cada execucao.
   */
  it('CONTROLE POSITIVO: colapsar a origem faria as duas colidirem no mesmo grupo', () => {
    const entries = streamingProviderEntries(PROVIDERS)
    const groupKey = (e: (typeof entries)[number]) =>
      JSON.stringify([
        e.license.sourceKey,
        e.license.contentType,
        e.license.providerKey ?? '',
        e.license.territory ?? '',
      ])
    const distinct = new Set(entries.map(groupKey))
    expect(distinct.size).toBe(entries.length)

    // Sem `provider_key` no grupo, os pares por slug colapsariam — exatamente o
    // estado que produziria supersede infinito.
    const collapsed = new Set(
      entries.map((e) =>
        JSON.stringify([e.license.sourceKey, e.license.contentType, e.license.territory ?? '']),
      ),
    )
    expect(collapsed.size).toBe(PROVIDERS.length)
    expect(collapsed.size).toBeLessThan(entries.length)
  })
})
