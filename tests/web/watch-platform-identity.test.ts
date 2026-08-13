/**
 * watch-platform-identity.test.ts — A mesma plataforma por duas origens conta
 * UMA vez.
 *
 * O DEFEITO QUE ISTO TRAVA. O hub `/pt/onde-assistir` agrupava por
 * `provider_key`, que e a chave do FORNECEDOR TECNICO: a RapidAPI grava
 * "netflix", o TMDB grava "8" (o `provider_id` numerico). Os dois exibem
 * "Netflix". Com as duas origens promovidas, o hub listaria a Netflix DUAS
 * vezes, como se fossem dois servicos.
 *
 * Latente ate a segunda origem existir — ou seja, o defeito so apareceria
 * depois do runbook de streaming, ja em producao. E por isso ele tem teste
 * agora, e nao depois.
 *
 * NAO E TESTE DE PRESENTER: `resolveWatchPlatform` decide IDENTIDADE (a que
 * plataforma a oferta pertence). A precedencia entre origens — qual DESTINO
 * vence quando as duas existem — e outra regra, do presenter do painel, e vive
 * em `watch-availability-provenance.test.ts`.
 */

import { describe, expect, it } from 'vitest'

import {
  distinctWatchPlatforms,
  resolveWatchPlatform,
  type WatchPlatformSource,
} from '../../apps/web/src/lib/watch-platform-identity'

/** Oferta da RapidAPI: `provider_key` textual, nome do proprio fornecedor. */
function aggregatorOffer(overrides: Partial<WatchPlatformSource> = {}): WatchPlatformSource {
  return {
    providerName: 'Netflix',
    providerKey: 'netflix',
    providerSlug: 'netflix',
    canonicalName: 'Netflix',
    ...overrides,
  }
}

/** Oferta do TMDB: `provider_key` NUMERICO. Mesmo slug canonico. */
function tmdbOffer(overrides: Partial<WatchPlatformSource> = {}): WatchPlatformSource {
  return {
    providerName: 'Netflix',
    providerKey: '8',
    providerSlug: 'netflix',
    canonicalName: 'Netflix',
    ...overrides,
  }
}

describe('CONTROLE POSITIVO das fixtures', () => {
  it('cada fixture, sozinha, RESOLVE uma plataforma — entao um null adiante e informativo', () => {
    expect(resolveWatchPlatform(aggregatorOffer())).not.toBeNull()
    expect(resolveWatchPlatform(tmdbOffer())).not.toBeNull()
    expect(distinctWatchPlatforms([aggregatorOffer()])).toHaveLength(1)
    expect(distinctWatchPlatforms([tmdbOffer()])).toHaveLength(1)
  })

  it('as duas fixtures usam chaves de FORNECEDOR diferentes (senao o teste nao prova nada)', () => {
    expect(aggregatorOffer().providerKey).not.toBe(tmdbOffer().providerKey)
    expect(aggregatorOffer().providerSlug).toBe(tmdbOffer().providerSlug)
  })
})

describe('identidade: o slug canonico, nunca a chave do fornecedor', () => {
  it('as DUAS origens da mesma plataforma caem no MESMO balde', () => {
    const platforms = distinctWatchPlatforms([aggregatorOffer(), tmdbOffer()])
    expect(platforms).toHaveLength(1)
    expect(platforms[0]!.bucketKey).toBe('netflix')
    expect(platforms[0]!.displayName).toBe('Netflix')
  })

  it('a ordem de chegada nao muda o resultado', () => {
    const a = distinctWatchPlatforms([aggregatorOffer(), tmdbOffer()])
    const b = distinctWatchPlatforms([tmdbOffer(), aggregatorOffer()])
    expect(a).toEqual(b)
  })

  it('CONTROLE NEGATIVO: agrupar por provider_key produziria DUAS entradas', () => {
    // A forma exata do defeito. Se um dia `bucketKey` voltar a ser a chave do
    // fornecedor, o teste acima quebra — e este documenta o que estaria errado.
    const porFornecedor = new Set(
      [aggregatorOffer(), tmdbOffer()].map((offer) => offer.providerKey),
    )
    expect(porFornecedor.size).toBe(2)
    expect(new Set([aggregatorOffer(), tmdbOffer()].map((o) => o.providerSlug)).size).toBe(1)
  })

  it('PLATAFORMAS diferentes continuam separadas', () => {
    const platforms = distinctWatchPlatforms([
      aggregatorOffer(),
      tmdbOffer({ providerKey: '1899', providerSlug: 'max', canonicalName: 'Max', providerName: 'Max' }),
    ])
    expect(platforms.map((p) => p.bucketKey).sort()).toEqual(['max', 'netflix'])
  })
})

describe('nome exibido: o canonico da plataforma, nao o que o fornecedor escreveu', () => {
  it('duas grafias do mesmo servico convergem para o nome canonico', () => {
    const platforms = distinctWatchPlatforms([
      aggregatorOffer({
        providerName: 'Prime Video',
        providerKey: 'prime',
        providerSlug: 'amazon-prime-video',
        canonicalName: 'Prime Video',
      }),
      tmdbOffer({
        providerName: 'Amazon Prime Video',
        providerKey: '119',
        providerSlug: 'amazon-prime-video',
        canonicalName: 'Prime Video',
      }),
    ])
    expect(platforms).toHaveLength(1)
    expect(platforms[0]!.displayName).toBe('Prime Video')
  })

  it('sem nome canonico registrado, cai para o nome do fornecedor (nunca vazio)', () => {
    const identity = resolveWatchPlatform(aggregatorOffer({ canonicalName: null }))
    expect(identity?.displayName).toBe('Netflix')
  })

  it('nome canonico so de espacos nao substitui o do fornecedor', () => {
    const identity = resolveWatchPlatform(aggregatorOffer({ canonicalName: '   ' }))
    expect(identity?.displayName).toBe('Netflix')
  })
})

describe('sem alias mapeado: a linha responde so por si', () => {
  it('cai para uma chave PREFIXADA, que nunca colide com um slug real', () => {
    const identity = resolveWatchPlatform(tmdbOffer({ providerSlug: null }))
    expect(identity?.bucketKey).toBe('vendor:8')
    expect(identity?.bucketKey).not.toBe('netflix')
  })

  it('sem alias, as duas origens NAO se fundem (nao ha como afirmar que sao a mesma)', () => {
    const platforms = distinctWatchPlatforms([
      aggregatorOffer({ providerSlug: null }),
      tmdbOffer({ providerSlug: null }),
    ])
    expect(platforms).toHaveLength(2)
  })

  it('a chave prefixada nunca colide com um slug que se chame igual', () => {
    const platforms = distinctWatchPlatforms([
      aggregatorOffer({ providerKey: 'netflix', providerSlug: null }),
      aggregatorOffer({ providerKey: 'netflix', providerSlug: 'netflix' }),
    ])
    expect(platforms.map((p) => p.bucketKey).sort()).toEqual(['netflix', 'vendor:netflix'])
  })
})

describe('oferta que nao pode virar entrada de lista', () => {
  it('sem nome exibivel -> null (provedor sem nome seria provedor inventado)', () => {
    expect(resolveWatchPlatform(aggregatorOffer({ providerName: '   ' }))).toBeNull()
  })

  it('sem chave de fornecedor -> null', () => {
    expect(resolveWatchPlatform(aggregatorOffer({ providerKey: null }))).toBeNull()
    expect(resolveWatchPlatform(aggregatorOffer({ providerKey: '  ' }))).toBeNull()
  })

  it('a oferta recusada nao entra na lista, e nao derruba as outras', () => {
    const platforms = distinctWatchPlatforms([
      aggregatorOffer({ providerName: '' }),
      tmdbOffer(),
    ])
    expect(platforms).toHaveLength(1)
    expect(platforms[0]!.bucketKey).toBe('netflix')
  })
})
