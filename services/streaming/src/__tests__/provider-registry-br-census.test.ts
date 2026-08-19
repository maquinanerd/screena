/**
 * provider-registry-br-census.test.ts — A leva BR bate com o CENSO de ofertas
 * brasileiras, nao com palpite.
 *
 * ============ O QUE E O CENSO, E POR QUE ELE E EVIDENCIA ============
 *
 * A colheita anterior (`provider-registry-tmdb-harvest.test.ts`, 2026-08-13)
 * media volume GLOBAL: "Claro video — 324 ofertas em 7 paises". Isso nao
 * responde a unica pergunta que importa para registrar um provedor brasileiro:
 * ELE TEM OFERTA NO BRASIL? Por isso aquela leva recusou, corretamente, todas
 * as plataformas BR avulsas.
 *
 * O censo de 2026-08-19 responde. Ele conta as ofertas JA GRAVADAS em
 * `watch_availability` com `country_code = 'BR'` e `display_allowed = false`,
 * agrupadas por `(provider_name, provider_key)`. Sao os pares transcritos
 * abaixo.
 *
 * A CADEIA DE EVIDENCIA, elo por elo — e por que `provider_key` E o
 * `provider_id` do TMDB:
 *
 *   payload TMDB (`watch/providers`)
 *     -> `normalizeWatchProviders` (services/ingestion): grava
 *        `providerKey = String(entry.provider_id)` e
 *        `providerName = entry.provider_name`, VERBATIM, sem tabela de
 *        traducao, sem normalizacao de nome, sem heuristica
 *     -> `watch_availability.provider_key` / `.provider_name`
 *     -> este censo
 *
 * Nao ha ponto nessa cadeia onde um id possa trocar de dono. Ler o censo e ler
 * o que o payload publicou.
 *
 * CORROBORACAO INDEPENDENTE: 10 dos 24 pares (167, 2302, 484, 499, 19, 47, 447,
 * 477, 2156, 2157) tambem aparecem na colheita global de 08-13 — uma medicao
 * feita por outro comando, em outra data, com outro escopo. Os dois concordam
 * no mesmo par (id, nome). Isso esta travado abaixo.
 *
 * ============ O QUE ESTE ARQUIVO NAO PROVA ============
 *
 * Ele nao prova que o censo foi digitado corretamente — nenhum teste puro pode.
 * Quem prova isso e o banco: `register-watch-providers` confronta cada alias a
 * CRIAR contra os pares realmente presentes em `watch_availability`
 * (`checkAliasEvidenceAgainstOffers`) e RECUSA o que nunca apareceu. Um id
 * digitado errado (1852 em vez de 1853) passa por este arquivo e morre la.
 */

import { describe, expect, it } from 'vitest'

import {
  ALIAS_EVIDENCE_SOURCES,
  WATCH_PROVIDER_REGISTRY,
  checkAliasEvidenceAgainstOffers,
  planProviderRegistration,
  validateProviderRegistry,
  type ObservedOfferProvider,
} from '../provider-registry.js'

/**
 * Transcricao do censo de producao 2026-08-19: ofertas BR com
 * `display_allowed = false`, por `(provider_name, provider_key)`.
 *
 * Ordem preservada (decrescente por volume), como veio.
 */
const BR_CENSUS_2026_08_19 = [
  { providerName: 'HBO Max Amazon Channel', providerKey: '1825', offers: 35 },
  { providerName: 'Claro video', providerKey: '167', offers: 23 },
  { providerName: 'Telecine Amazon Channel', providerKey: '2156', offers: 21 },
  { providerName: 'Paramount+ Amazon Channel', providerKey: '582', offers: 18 },
  { providerName: 'Claro tv+', providerKey: '484', offers: 18 },
  { providerName: 'Paramount Plus', providerKey: '531', offers: 17 },
  { providerName: 'Paramount Plus Premium', providerKey: '2303', offers: 17 },
  { providerName: 'Universal+ Amazon Channel', providerKey: '1889', offers: 14 },
  { providerName: 'Oldflix', providerKey: '499', offers: 13 },
  { providerName: 'Mercado Play', providerKey: '2302', offers: 13 },
  { providerName: 'Sony One Amazon Channel', providerKey: '2161', offers: 8 },
  { providerName: 'Paramount Plus Apple TV Channel', providerKey: '1853', offers: 7 },
  { providerName: 'Looke', providerKey: '47', offers: 4 },
  { providerName: 'NetMovies', providerKey: '19', offers: 4 },
  { providerName: 'Lionsgate+ Amazon Channels', providerKey: '2358', offers: 4 },
  { providerName: 'Plex', providerKey: '538', offers: 2 },
  { providerName: 'Belas Artes à La Carte', providerKey: '447', offers: 2 },
  { providerName: 'Looke Amazon Channel', providerKey: '683', offers: 2 },
  { providerName: 'MGM+ Apple TV Channel', providerKey: '2142', offers: 1 },
  { providerName: 'Filmelier Plus Amazon Channel', providerKey: '2356', offers: 1 },
  { providerName: 'GOSPEL PLAY', providerKey: '477', offers: 1 },
  { providerName: 'MGM Plus Amazon Channel', providerKey: '2141', offers: 1 },
  { providerName: 'Arte Amazon Channel', providerKey: '2607', offers: 1 },
  { providerName: 'Reserva Imovision Amazon Channel', providerKey: '2157', offers: 1 },
] as const

/**
 * Os pares NAO numericos do mesmo censo: 6 ofertas BR apagadas cuja
 * `provider_key` nao e id do TMDB, e sim chave do fornecedor
 * `streaming_availability` (Movie of the Night, via RapidAPI).
 *
 * Estao aqui de proposito. Sem eles, alguem lendo so a lista de cima concluiria
 * que "Prime Video" e "Apple TV" ja estao cobertos por 119 e 2 — e as tres
 * ofertas de `prime` continuariam sem explicacao.
 */
const BR_CENSUS_NON_TMDB_2026_08_19 = [
  { providerApi: 'streaming_availability', providerKey: 'prime', providerName: 'Prime Video', offers: 3 },
  { providerApi: 'streaming_availability', providerKey: 'apple', providerName: 'Apple TV', offers: 2 },
  { providerApi: 'streaming_availability', providerKey: 'hbo', providerName: 'HBO Max', offers: 1 },
] as const

/** Ids que TAMBEM apareceram na colheita GLOBAL de 2026-08-13. */
const CORROBORATED_BY_GLOBAL_HARVEST = [
  '167',
  '2302',
  '484',
  '499',
  '19',
  '47',
  '447',
  '477',
  '2156',
  '2157',
] as const

/** `external_key` TMDB -> entrada do registro. */
function tmdbAliasIndex(): Map<string, { slug: string; displayName: string; evidence: string }> {
  const index = new Map<string, { slug: string; displayName: string; evidence: string }>()
  for (const entry of WATCH_PROVIDER_REGISTRY) {
    for (const alias of entry.aliases) {
      if (alias.providerApi !== 'tmdb') continue
      index.set(alias.externalKey, {
        slug: entry.slug,
        displayName: alias.displayName,
        evidence: alias.evidence,
      })
    }
  }
  return index
}

describe('leva BR 2026-08-19 — cobertura', () => {
  it('CONTROLE POSITIVO: os 24 provedores do censo estao no registro', () => {
    const index = tmdbAliasIndex()
    const ausentes = BR_CENSUS_2026_08_19.filter((row) => !index.has(row.providerKey)).map(
      (row) => `${row.providerName} (${row.providerKey})`,
    )
    expect(ausentes).toEqual([])
    expect(BR_CENSUS_2026_08_19).toHaveLength(24)
  })

  it('o nome declarado no alias e o nome que o censo mediu — sem correcao de grafia', () => {
    // "GOSPEL PLAY" em caixa alta, "Claro tv+" em caixa baixa, "Belas Artes à
    // La Carte" com acento: o registro AUDITA o upstream, nao o corrige.
    // Divergir aqui e o comeco de um alias apontando para outra plataforma.
    const index = tmdbAliasIndex()
    for (const row of BR_CENSUS_2026_08_19) {
      expect(index.get(row.providerKey)?.displayName).toBe(row.providerName)
    }
  })

  it('todo alias da leva declara a medicao de onde saiu', () => {
    const index = tmdbAliasIndex()
    for (const row of BR_CENSUS_2026_08_19) {
      expect(index.get(row.providerKey)?.evidence).toBe('br-offer-census-2026-08-19')
    }
  })

  it('CONTROLE NEGATIVO: evidencia fora do conjunto fechado INVALIDA o registro', () => {
    // Este e o teste do proprio mecanismo, e ele tem de falhar quando quebrado —
    // por isso quebra o registro DE VERDADE (um objeto real, com um valor real
    // fora da lista) em vez de comparar strings do fonte.
    const forjado = [
      {
        slug: 'provedor-forjado',
        canonicalName: 'Provedor Forjado',
        aliases: [
          {
            providerApi: 'tmdb' as const,
            externalKey: '999999',
            displayName: 'Provedor Forjado',
            // Valor plausivel, e ainda assim fora de ALIAS_EVIDENCE_SOURCES.
            evidence: 'colheita-que-nunca-existiu' as never,
          },
        ],
      },
    ]
    const errors = validateProviderRegistry(forjado)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('evidencia invalida')
    // ...e um plano com esse registro NAO aplica.
    const plan = planProviderRegistration(forjado, { providers: new Map(), aliases: new Map() })
    expect(plan.ok).toBe(false)
    // O conjunto fechado continua sendo exatamente tres medicoes nomeadas.
    expect([...ALIAS_EVIDENCE_SOURCES]).toEqual([
      'rapidapi-fixture',
      'tmdb-harvest-2026-08-13',
      'br-offer-census-2026-08-19',
    ])
  })

  it('duas medicoes independentes concordam no mesmo par (id, nome)', () => {
    // Corroboracao: 10 dos 24 ids ja tinham sido vistos pela colheita global de
    // 08-13, por outro comando e em outra data. Nenhum deles mudou de nome
    // entre as duas medicoes.
    const censo = new Map(BR_CENSUS_2026_08_19.map((r) => [r.providerKey, r.providerName]))
    const globalNames: Readonly<Record<string, string>> = {
      '167': 'Claro video',
      '2302': 'Mercado Play',
      '484': 'Claro tv+',
      '499': 'Oldflix',
      '19': 'NetMovies',
      '47': 'Looke',
      '447': 'Belas Artes à La Carte',
      '477': 'GOSPEL PLAY',
      '2156': 'Telecine Amazon Channel',
      '2157': 'Reserva Imovision Amazon Channel',
    }
    for (const key of CORROBORATED_BY_GLOBAL_HARVEST) {
      expect(censo.get(key)).toBe(globalNames[key])
    }
  })
})

describe('leva BR 2026-08-19 — o que NAO foi colapsado', () => {
  it('os TRES Paramount+ sao tres slugs, nao um', () => {
    const index = tmdbAliasIndex()
    const slugs = ['531', '2303', '582'].map((k) => index.get(k)?.slug)
    expect(slugs).toEqual([
      'paramount-plus',
      'paramount-plus-premium',
      'paramount-plus-amazon-channel',
    ])
    expect(new Set(slugs).size).toBe(3)
  })

  it('CONTROLE NEGATIVO: colapsar Premium no plano de entrada mentiria sobre o acesso', () => {
    // O contraste com `netflix`/`1796` e o ponto inteiro. La o colapso e de
    // PLANO da mesma assinatura, com o mesmo catalogo — "Netflix Standard with
    // Ads" da acesso ao que "Netflix" da. Aqui nao: quem assina o plano de
    // entrada do Paramount+ nao assiste ao que so esta no Premium.
    const index = tmdbAliasIndex()
    expect(index.get('531')?.slug).not.toBe(index.get('2303')?.slug)
    // ...enquanto o colapso de PLANO continua de pe, intocado por esta leva.
    expect(index.get('8')?.slug).toBe(index.get('1796')?.slug)
  })

  it('canal na Amazon e canal na Apple da MESMA marca sao slugs distintos', () => {
    const index = tmdbAliasIndex()
    // MGM+ chega por duas lojas. Ids diferentes, lugares de compra diferentes.
    expect(index.get('2141')?.slug).toBe('mgm-plus-amazon-channel')
    expect(index.get('2142')?.slug).toBe('mgm-plus-apple-tv-channel')
    expect(index.get('2141')?.slug).not.toBe(index.get('2142')?.slug)
    // O mesmo para Looke: plataforma propria (47) e canal na Amazon (683).
    expect(index.get('47')?.slug).toBe('looke')
    expect(index.get('683')?.slug).toBe('looke-amazon-channel')
    expect(index.get('47')?.slug).not.toBe(index.get('683')?.slug)
  })

  it('nenhum slug repetido e nenhum alias repetido apos a leva', () => {
    expect(validateProviderRegistry(WATCH_PROVIDER_REGISTRY)).toEqual([])
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, {
      providers: new Map(),
      aliases: new Map(),
    })
    expect(plan.ok).toBe(true)
    expect(plan.conflicts).toEqual([])
    // 24 provedores novos + os 9 que ja existiam.
    expect(plan.providers).toHaveLength(33)
  })
})

describe('as 6 ofertas de provider_key NAO numerico continuam de fora', () => {
  it('`hbo` nao tem alias em nenhum fornecedor — e o slug `max` usa `max`', () => {
    const chaves = new Set(
      WATCH_PROVIDER_REGISTRY.flatMap((entry) =>
        entry.aliases
          .filter((a) => a.providerApi === 'streaming_availability')
          .map((a) => a.externalKey),
      ),
    )
    // A oferta de `hbo` morre no PRIMEIRO elo: nao ha alias para essa chave.
    expect(chaves.has('hbo')).toBe(false)
    // A chave que a RapidAPI usa para a mesma marca, e que ESTA mapeada, e
    // `max`. Cadastrar `hbo` apontando para o slug `max` seria inventar uma
    // chave que nenhum fixture do fornecedor publica.
    expect(chaves.has('max')).toBe(true)
  })

  it('`prime` e `apple` TEM alias — o que os mantem apagados nao e este elo', () => {
    const chaves = new Set(
      WATCH_PROVIDER_REGISTRY.flatMap((entry) =>
        entry.aliases
          .filter((a) => a.providerApi === 'streaming_availability')
          .map((a) => a.externalKey),
      ),
    )
    // Registrado aqui porque a leitura contraria e facil de fazer e custa caro:
    // estas duas chaves NAO estao bloqueadas por falta de alias. Elas estao
    // apagadas porque ninguem as promoveu — a promocao exige `--ids` explicito.
    // Ver o relatorio da PR.
    expect(chaves.has('prime')).toBe(true)
    expect(chaves.has('apple')).toBe(true)
    expect(BR_CENSUS_NON_TMDB_2026_08_19).toHaveLength(3)
  })
})

describe('checkAliasEvidenceAgainstOffers — a trava que pergunta ao DADO', () => {
  const estadoVazio = { providers: new Map<string, string>(), aliases: new Map<string, string>() }

  /** O censo, na forma que o adapter Prisma devolve. */
  function observadosDoCenso(): ObservedOfferProvider[] {
    return [
      ...BR_CENSUS_2026_08_19.map((row) => ({
        providerApi: 'tmdb',
        providerKey: row.providerKey,
        providerName: row.providerName,
        offers: row.offers,
      })),
      // Os aliases de levas ANTERIORES tambem precisam existir no dado
      // observado, senao a trava (corretamente) recusaria o registro inteiro
      // contra um banco vazio. O nome vem do proprio registro para que estas
      // linhas de apoio nao apareçam como "renomeadas" e poluam o teste de
      // renomeacao — o cenario aqui e UMA troca de nome, nao vinte.
      ...WATCH_PROVIDER_REGISTRY.flatMap((entry) =>
        entry.aliases
          .filter((alias) => alias.evidence !== 'br-offer-census-2026-08-19')
          .map((alias) => ({
            providerApi: alias.providerApi as string,
            providerKey: alias.externalKey,
            providerName: alias.displayName,
            offers: 1,
          })),
      ),
    ]
  }

  it('CONTROLE POSITIVO: com o censo inteiro observado, a leva passa', () => {
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, estadoVazio)
    const check = checkAliasEvidenceAgainstOffers(plan, observadosDoCenso())
    expect(check.unobserved).toEqual([])
    expect(check.ok).toBe(true)
    expect(check.confirmed.length).toBe(plan.aliases.filter((a) => a.action === 'create').length)
  })

  it('CONTROLE NEGATIVO: um id que o dado nunca viu RECUSA o plano', () => {
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, estadoVazio)
    // Um digito trocado — 1853 -> 1852 — e exatamente o erro que a evidencia
    // DECLARADA nao pega: o alias continua dizendo que veio do censo.
    const semUmId = observadosDoCenso().filter((row) => row.providerKey !== '1853')
    const check = checkAliasEvidenceAgainstOffers(plan, semUmId)
    expect(check.ok).toBe(false)
    expect(check.unobserved.map((u) => u.externalKey)).toEqual(['1853'])
    expect(check.unobserved[0]?.slug).toBe('paramount-plus-apple-tv-channel')
  })

  it('renomeacao do upstream AVISA, nunca recusa (nome nunca foi identidade)', () => {
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, estadoVazio)
    const renomeado = observadosDoCenso().map((row) =>
      row.providerKey === '1825' && row.providerApi === 'tmdb'
        ? { ...row, providerName: 'Max Amazon Channel' }
        : row,
    )
    const check = checkAliasEvidenceAgainstOffers(plan, renomeado)
    // O TMDB renomeia provedor sem trocar o `provider_id`; derrubar o registro
    // por troca de rotulo seria fail-closed no campo errado.
    expect(check.ok).toBe(true)
    expect(check.renamed).toEqual([
      {
        providerApi: 'tmdb',
        externalKey: '1825',
        slug: 'hbo-max-amazon-channel',
        declaredName: 'HBO Max Amazon Channel',
        observedName: 'Max Amazon Channel',
      },
    ])
  })

  it('so olha alias a CRIAR: o que ja esta no banco nao e reauditado', () => {
    // Um comando idempotente nao pode virar auditoria retroativa que falha por
    // dado que ninguem esta mexendo agora.
    const jaNoBanco = {
      providers: new Map(WATCH_PROVIDER_REGISTRY.map((e) => [e.slug, e.canonicalName])),
      aliases: new Map(
        WATCH_PROVIDER_REGISTRY.flatMap((e) =>
          e.aliases.map(
            (a) => [`${a.providerApi}:${a.externalKey}`, e.slug] as readonly [string, string],
          ),
        ),
      ),
    }
    const plan = planProviderRegistration(WATCH_PROVIDER_REGISTRY, jaNoBanco)
    // Banco sem NENHUMA oferta observada e, ainda assim, nada a recusar.
    const check = checkAliasEvidenceAgainstOffers(plan, [])
    expect(plan.aliases.every((a) => a.action === 'keep')).toBe(true)
    expect(check.ok).toBe(true)
    expect(check.confirmed).toEqual([])
  })
})
