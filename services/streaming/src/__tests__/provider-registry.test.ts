/**
 * Registro canonico de provedores: forma valida, plano idempotente, conflito
 * ABORTA (nunca retarget silencioso) e alias desconhecido e reportado.
 */

import { describe, expect, it } from 'vitest'

import {
  WATCH_PROVIDER_REGISTRY,
  planProviderRegistration,
  validateProviderRegistry,
  type ProviderRegistryState,
} from '../provider-registry.js'

function state(input: {
  providers?: Record<string, string>
  aliases?: Record<string, string>
}): ProviderRegistryState {
  return {
    providers: new Map(Object.entries(input.providers ?? {})),
    aliases: new Map(Object.entries(input.aliases ?? {})),
  }
}

describe('o registro embarcado e valido', () => {
  it('passa na validacao de forma', () => {
    expect(validateProviderRegistry(WATCH_PROVIDER_REGISTRY)).toEqual([])
  })

  it('todo alias tem evidencia dos DOIS fornecedores conhecidos', () => {
    for (const entry of WATCH_PROVIDER_REGISTRY) {
      for (const alias of entry.aliases) {
        expect(['streaming_availability', 'tmdb']).toContain(alias.providerApi)
      }
    }
  })

  it('as chaves TMDB sao numericas em texto (String(provider_id))', () => {
    for (const entry of WATCH_PROVIDER_REGISTRY) {
      for (const alias of entry.aliases) {
        if (alias.providerApi === 'tmdb') {
          expect(alias.externalKey).toMatch(/^[0-9]+$/)
        }
      }
    }
  })
})

describe('plano idempotente', () => {
  it('banco vazio: tudo CREATE', () => {
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, state({}))
    expect(plan.ok).toBe(true)
    expect(plan.providers.every((p) => p.action === 'create')).toBe(true)
    expect(plan.aliases.every((a) => a.action === 'create')).toBe(true)
  })

  it('banco ja aplicado: tudo KEEP (segunda execucao e no-op)', () => {
    const providers = Object.fromEntries(
      WATCH_PROVIDER_REGISTRY.map((e) => [e.slug, e.canonicalName]),
    )
    const aliases = Object.fromEntries(
      WATCH_PROVIDER_REGISTRY.flatMap((e) =>
        e.aliases.map((a) => [`${a.providerApi}:${a.externalKey}`, e.slug]),
      ),
    )
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, state({ providers, aliases }))
    expect(plan.ok).toBe(true)
    expect(plan.providers.every((p) => p.action === 'keep')).toBe(true)
    expect(plan.aliases.every((a) => a.action === 'keep')).toBe(true)
  })

  it('nome canonico divergente vira RENAME (slug e a identidade)', () => {
    const plan = planProviderRegistration(
      [{ slug: 'netflix', canonicalName: 'Netflix', aliases: [] }],
      state({ providers: { netflix: 'NETFLIX BR' } }),
    )
    expect(plan.providers[0]?.action).toBe('rename')
  })
})

describe('os caminhos de falha GRITAM', () => {
  it('alias de OUTRO provedor e CONFLITO e derruba o plano — nunca retarget', () => {
    const plan = planProviderRegistration(
      [
        {
          slug: 'netflix',
          canonicalName: 'Netflix',
          aliases: [{ providerApi: 'tmdb', externalKey: '8', displayName: 'Netflix' }],
        },
      ],
      state({ providers: { netflix: 'Netflix' }, aliases: { 'tmdb:8': 'outro-provedor' } }),
    )
    expect(plan.ok).toBe(false)
    expect(plan.conflicts).toHaveLength(1)
    expect(plan.conflicts[0]).toMatchObject({ wantedSlug: 'netflix', currentSlug: 'outro-provedor' })
  })

  it('registro malformado (slug invalido, alias repetido) derruba o plano', () => {
    const plan = planProviderRegistration(
      [
        {
          slug: 'Netflix!',
          canonicalName: 'Netflix',
          aliases: [
            { providerApi: 'tmdb', externalKey: '8', displayName: 'a' },
            { providerApi: 'tmdb', externalKey: '8', displayName: 'b' },
          ],
        },
      ],
      state({}),
    )
    expect(plan.ok).toBe(false)
    expect(plan.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('alias que so existe no banco e REPORTADO como desconhecido, nunca tocado', () => {
    const plan = planProviderRegistration(
      [{ slug: 'netflix', canonicalName: 'Netflix', aliases: [] }],
      state({
        providers: { netflix: 'Netflix' },
        aliases: { 'tmdb:9999': 'netflix' },
      }),
    )
    expect(plan.ok).toBe(true)
    expect(plan.unknownDbAliases).toEqual(['tmdb:9999'])
  })
})
