/**
 * detail-watch-availability.test.ts — O caminho NORMAL de sincronizacao traz
 * disponibilidade, provado do `append_to_response` ate a escrita da oferta.
 *
 * ============ O DEFEITO QUE ESTES TESTES TRAVAM ============
 *
 * `catalog sync --apply` respondeu `39 ok · 0 falhou` para 39 titulos, e nenhum
 * ganhou uma unica oferta de "onde assistir". O comando estava certo sobre si
 * mesmo e inutil para quem o chamou. A causa nao era o append: o append RICO ja
 * pedia `watch/providers` (o `'external_ids,credits'` de `import-movie.ts` e so
 * o rotulo da CHAVE de `api_cache`). O byte chegava, era gravado no cache e o
 * normalizador de detalhe o jogava fora.
 *
 * ============ POR QUE O TRANSPORTE E O CONTROLE NEGATIVO ============
 *
 * O transporte falso aqui HONRA `append_to_response`, como o TMDB faz: ele so
 * devolve o sub-recurso que a URL pediu. Isso amarra o teste ao append REAL de
 * `api-clients/tmdb/src/append-to-response.ts`, e nao a uma fixture combinada
 * com o teste. Remova `watch/providers` de `MOVIE_APPEND`/`TV_APPEND` no codigo
 * de verdade e estes testes reprovam — que e exatamente o que um controle
 * negativo tem de fazer.
 *
 * Sem `includes`/`toContain` em lugar nenhum: as ofertas sao comparadas por
 * igualdade estrutural completa, e os desfechos por igualdade de string. Quatro
 * testes deste repositorio ja passaram pelo motivo errado por causa de
 * assercao de continencia.
 */

import { describe, expect, it } from 'vitest'
import {
  createTmdbEndpoints,
  loadTmdbConfig,
  TmdbHttpClient,
  type HttpResponse,
} from '@screena/tmdb-client'

import { importMovie, importTvShow } from '../import/index.js'
import type { ImportContext } from '../import/types.js'
import type {
  CacheFetchInput,
  CachePort,
  CacheResult,
  EntityStorePort,
  SyncLogInput,
  SyncLogPort,
} from '../ports.js'
import { hashPayload } from '../utils/hash.js'
import type {
  ResolvedWatchEntity,
  WatchEntityResolver,
  WatchOfferStore,
  WatchSnapshotOutcome,
} from '../watch-providers/types.js'
import type { WatchProviderOffer } from '../normalizers/watch-providers.js'

const FIXED_NOW = new Date('2026-08-19T12:00:00.000Z')
const MOVIE_ID = 27205
const TV_ID = 1396
const MOVIE_ENTITY_ID = '4001'
const TV_ENTITY_ID = '5001'

/** Um snapshot capturado no lugar do SQL — a fronteira onde o Prisma comecaria. */
interface CapturedSnapshot {
  readonly entityType: string
  readonly entityId: string
  readonly countryCode: string
  readonly offers: readonly WatchProviderOffer[]
  readonly fetchedAt: Date
  readonly staleAfter: Date
}

/**
 * Sub-recursos que o TMDB devolveria, por chave de append.
 *
 * Cada valor so entra na resposta se a URL o tiver pedido. E esta funcao que
 * transforma "o append mudou" em "o teste reprova".
 */
function subResourceFor(kind: 'movie' | 'tv', append: string): Record<string, unknown> | null {
  const watchLink =
    kind === 'movie'
      ? 'https://www.themoviedb.org/movie/27205/watch?locale=BR'
      : 'https://www.themoviedb.org/tv/1396/watch?locale=BR'

  switch (append) {
    case 'credits':
      return { credits: { cast: [], crew: [] } }
    case 'external_ids':
      return { external_ids: { imdb_id: kind === 'movie' ? 'tt1375666' : 'tt0903747' } }
    case 'watch/providers':
      return {
        'watch/providers': {
          results: {
            BR: {
              link: watchLink,
              flatrate: [
                {
                  provider_id: 8,
                  provider_name: 'Netflix',
                  display_priority: 1,
                  logo_path: '/netflix.jpg',
                },
              ],
              rent: [
                {
                  provider_id: 2,
                  provider_name: 'Apple TV',
                  display_priority: 4,
                  logo_path: '/appletv.jpg',
                },
              ],
            },
            // Territorio FORA do escopo ingerido: existe no payload real e tem
            // de ser descartado e contado, nunca gravado.
            US: {
              link: 'https://www.themoviedb.org/movie/27205/watch?locale=US',
              flatrate: [{ provider_id: 1899, provider_name: 'Max', display_priority: 2 }],
            },
          },
        },
      }
    default:
      // Sub-recurso pedido e nao modelado aqui: devolve o campo vazio, como o
      // TMDB faria com um recurso sem conteudo. Nunca `null` silencioso.
      return { [append]: null }
  }
}

/** Corpo base do detalhe, sem nenhum sub-recurso. */
function baseDetail(kind: 'movie' | 'tv', tmdbId: number): Record<string, unknown> {
  if (kind === 'movie') {
    return {
      id: tmdbId,
      title: 'A Origem',
      original_title: 'Inception',
      original_language: 'en',
      overview: 'Um ladrao que rouba segredos do subconsciente.',
      release_date: '2010-07-16',
      runtime: 148,
      status: 'Released',
    }
  }
  return {
    id: tmdbId,
    name: 'Breaking Bad',
    original_name: 'Breaking Bad',
    original_language: 'en',
    overview: 'Um professor de quimica vira fabricante de metanfetamina.',
    first_air_date: '2008-01-20',
    status: 'Ended',
    // Sem temporadas: o foco aqui e a disponibilidade da SERIE, e cada
    // temporada custaria uma requisicao a mais no transporte falso.
    seasons: [],
  }
}

/**
 * Client TMDB REAL (`createTmdbEndpoints` + `TmdbHttpClient`) sobre um
 * transporte que honra `append_to_response`.
 */
function realEndpointsWithHonestTransport() {
  const urls: string[] = []
  const config = loadTmdbConfig({ TMDB_API_KEY: 'k', TMDB_DEFAULT_LANGUAGE: 'pt-BR' })
  const client = new TmdbHttpClient(config, {
    transport: async (request): Promise<HttpResponse> => {
      urls.push(request.url)
      const url = new URL(request.url)
      const kind: 'movie' | 'tv' = url.pathname.startsWith('/3/movie/') ? 'movie' : 'tv'
      const tmdbId = Number(url.pathname.split('/').filter((p) => p !== '')[2])
      const body: Record<string, unknown> = baseDetail(kind, tmdbId)
      const append = url.searchParams.get('append_to_response')
      for (const key of append === null ? [] : append.split(',')) {
        Object.assign(body, subResourceFor(kind, key) ?? {})
      }
      return { status: 200, headers: {}, body: JSON.stringify(body) }
    },
    now: () => 0,
    sleep: async () => {},
    random: () => 0,
  })
  return { endpoints: createTmdbEndpoints(client, config), urls }
}

/** Cache que guarda o payload VERBATIM, como `createPrismaCache` faz. */
class VerbatimCache implements CachePort {
  private readonly hashes = new Map<string, string>()
  constructor(private readonly alwaysUnchanged = false) {}

  async getOrFetch<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>> {
    const data = await input.fetcher()
    const payloadHash = hashPayload(data)
    const changed = this.alwaysUnchanged ? false : this.hashes.get(input.endpoint) !== payloadHash
    this.hashes.set(input.endpoint, payloadHash)
    return { data, fromCache: false, payloadHash, changed }
  }
}

/** Store minimo: so o que os imports de filme/serie tocam. */
function fakeStore(): EntityStorePort {
  const credits = {
    castReplaced: true,
    crewReplaced: true,
    castLinked: 0,
    crewLinked: 0,
    castDropped: 0,
    crewDropped: 0,
  }
  return {
    upsertMovie: async () => ({ id: MOVIE_ENTITY_ID, created: true, credits }),
    touchMovie: async () => true,
    upsertTvShow: async () => ({ id: TV_ENTITY_ID, created: true, credits }),
    touchTvShow: async () => true,
    upsertSeasonWithEpisodes: async () => ({ id: '1', created: true, episodesUpserted: 0 }),
    touchSeason: async () => true,
    upsertPerson: async () => ({ id: '1', created: true }),
    touchPerson: async () => true,
  } as unknown as EntityStorePort
}

/** Log de sync que apenas acumula — nenhuma ingestao pode ficar sem log. */
function fakeSyncLog(): { port: SyncLogPort; entries: SyncLogInput[] } {
  const entries: SyncLogInput[] = []
  return {
    port: {
      async write(input) {
        entries.push(input)
      },
    },
    entries,
  }
}

/** Escritor de ofertas que captura o que o SQL receberia. */
function capturingOfferStore(): { store: WatchOfferStore; captured: CapturedSnapshot[] } {
  const captured: CapturedSnapshot[] = []
  return {
    store: {
      async replaceSnapshot(input): Promise<WatchSnapshotOutcome> {
        captured.push({
          entityType: input.entityType,
          entityId: input.entityId,
          countryCode: input.countryCode,
          offers: input.offers,
          fetchedAt: input.fetchedAt,
          staleAfter: input.staleAfter,
        })
        return { upserted: input.offers.length, revoked: 0 }
      },
    },
    captured,
  }
}

/** Resolvedor tmdbId -> id interno (usado so no short-circuit de cache). */
function fakeResolver(known: Readonly<Record<number, string>>): WatchEntityResolver {
  return {
    async resolve(_entityType, tmdbIds): Promise<readonly ResolvedWatchEntity[]> {
      const rows: ResolvedWatchEntity[] = []
      for (const tmdbId of tmdbIds) {
        const entityId = known[tmdbId]
        if (entityId !== undefined) rows.push({ tmdbId, entityId })
      }
      return rows
    },
  }
}

interface Harness {
  readonly ctx: ImportContext
  readonly captured: CapturedSnapshot[]
  readonly urls: string[]
  readonly syncLog: SyncLogInput[]
}

function harness(
  options: { readonly withSink?: boolean; readonly unchanged?: boolean; readonly known?: Readonly<Record<number, string>> } = {},
): Harness {
  const withSink = options.withSink ?? true
  const { endpoints, urls } = realEndpointsWithHonestTransport()
  const offers = capturingOfferStore()
  const log = fakeSyncLog()

  const ctx: ImportContext = {
    tmdb: endpoints,
    cache: new VerbatimCache(options.unchanged ?? false),
    store: fakeStore(),
    syncLog: log.port,
    now: () => FIXED_NOW,
    staleAfter: (at) => new Date(at.getTime() + 7 * 24 * 60 * 60 * 1000),
    watch: withSink
      ? {
          store: offers.store,
          resolver: fakeResolver(
            options.known ?? { [MOVIE_ID]: MOVIE_ENTITY_ID, [TV_ID]: TV_ENTITY_ID },
          ),
          territories: ['BR'],
          staleAfterMs: 24 * 60 * 60 * 1000,
        }
      : undefined,
  }
  return { ctx, captured: offers.captured, urls, syncLog: log.entries }
}

describe('caminho normal de sync: o detalhe materializa disponibilidade', () => {
  it('filme sincronizado ganha as ofertas BR do payload, sem chamada extra ao TMDB', async () => {
    const { ctx, captured, urls } = harness()

    const result = await importMovie(ctx, MOVIE_ID)

    // Uma unica requisicao: a disponibilidade vem no MESMO detalhe. Se alguem
    // "consertar" isto com um fetch dedicado, este numero muda e o teste avisa.
    expect(urls).toHaveLength(1)
    expect(result.status).toBe('success')
    expect(result.watch.outcome).toBe('applied')
    expect(result.watch.offersUpserted).toBe(2)

    // Um snapshot, so BR — US veio no payload e foi descartado por escopo.
    expect(captured).toHaveLength(1)
    expect(captured[0]?.entityType).toBe('movie')
    expect(captured[0]?.entityId).toBe(MOVIE_ENTITY_ID)
    expect(captured[0]?.countryCode).toBe('BR')
    expect(captured[0]?.fetchedAt).toEqual(FIXED_NOW)
    expect(captured[0]?.staleAfter).toEqual(new Date('2026-08-20T12:00:00.000Z'))

    // Igualdade ESTRUTURAL completa das ofertas: nenhum campo inventado passa.
    expect(captured[0]?.offers).toEqual([
      {
        entityType: 'movie',
        tmdbId: MOVIE_ID,
        countryCode: 'BR',
        providerKey: '8',
        providerName: 'Netflix',
        offerType: 'subscription',
        webUrl: 'https://www.themoviedb.org/movie/27205/watch?locale=BR',
        displayPriority: 1,
        logoPath: '/netflix.jpg',
      },
      {
        entityType: 'movie',
        tmdbId: MOVIE_ID,
        countryCode: 'BR',
        providerKey: '2',
        providerName: 'Apple TV',
        offerType: 'rent',
        webUrl: 'https://www.themoviedb.org/movie/27205/watch?locale=BR',
        displayPriority: 4,
        logoPath: '/appletv.jpg',
      },
    ])

    // O que ficou de fora do escopo e CONTADO, nunca silenciado.
    expect(result.watch.offersOutOfScope).toBe(1)
    expect(result.watch.countriesOutOfScope).toEqual({ US: 1 })
  })

  it('serie sincronizada ganha as ofertas BR pelo mesmo caminho', async () => {
    const { ctx, captured } = harness()

    const result = await importTvShow(ctx, TV_ID)

    expect(result.status).toBe('success')
    expect(result.watch.outcome).toBe('applied')
    expect(result.watch.offersUpserted).toBe(2)
    expect(captured).toHaveLength(1)
    expect(captured[0]?.entityType).toBe('tv')
    expect(captured[0]?.entityId).toBe(TV_ENTITY_ID)
    expect(captured[0]?.countryCode).toBe('BR')
    expect(captured[0]?.offers.map((o) => o.providerKey)).toEqual(['8', '2'])
    expect(captured[0]?.offers.map((o) => o.offerType)).toEqual(['subscription', 'rent'])
  })

  it('short-circuit de cache tambem materializa: e o caso da passada de recuperacao', async () => {
    // Payload inalterado => o import faz `touch` e nao tem id em maos. Se a
    // ingestao fosse pulada aqui, uma passada de recuperacao sobre o catalogo
    // ja sincronizado devolveria `ok` e gravaria ZERO oferta — o defeito
    // original, so que uma camada mais fundo.
    const { ctx, captured } = harness({ unchanged: true })

    const result = await importMovie(ctx, MOVIE_ID)

    expect(result.changed).toBe(false)
    expect(result.id).toBe(null)
    expect(result.watch.outcome).toBe('applied')
    expect(captured).toHaveLength(1)
    expect(captured[0]?.entityId).toBe(MOVIE_ENTITY_ID)
  })

  it('entidade nao promovida vira `unresolved`, nunca "sem oferta"', async () => {
    const { ctx, captured } = harness({ unchanged: true, known: {} })

    const result = await importMovie(ctx, MOVIE_ID)

    expect(result.watch.outcome).toBe('unresolved')
    expect(result.watch.offersUpserted).toBe(0)
    expect(captured).toHaveLength(0)
  })

  it('runtime sem sink ACUSA a ausencia em vez de parecer titulo sem oferta', async () => {
    const { ctx, captured } = harness({ withSink: false })

    const result = await importMovie(ctx, MOVIE_ID)

    expect(result.status).toBe('success')
    expect(result.watch.outcome).toBe('not-configured')
    expect(result.watch.offersUpserted).toBe(0)
    expect(captured).toHaveLength(0)
  })

  it('falha ao gravar oferta NAO derruba o import nem apaga o log do detalhe', async () => {
    // A disponibilidade e efeito secundario de um detalhe que ja foi persistido.
    // Se um erro de banco na escrita da oferta escapasse, `importMovie` cairia
    // no catch: um detalhe gravado seria reportado `failed` e `api_sync_logs`
    // nao receberia a linha de sucesso. O erro tem de virar desfecho, nao
    // excecao.
    const { ctx, syncLog } = harness()
    const boom = new RangeError('conexao recusada')
    const sink = ctx.watch
    if (sink === undefined) throw new Error('harness sem sink')
    const failing: ImportContext = {
      ...ctx,
      watch: {
        ...sink,
        store: {
          async replaceSnapshot() {
            throw boom
          },
        },
      },
    }

    const result = await importMovie(failing, MOVIE_ID)

    expect(result.status).toBe('success')
    expect(result.id).toBe(MOVIE_ENTITY_ID)
    expect(result.watch.outcome).toBe('failed')
    expect(result.watch.offersUpserted).toBe(0)
    expect(result.watch.errorClass).toBe('RangeError')
    expect(result.watch.message).toBe('conexao recusada')
    expect(syncLog).toHaveLength(1)
    expect(syncLog[0]?.status).toBe('success')
  })

  it('falha na RESOLUCAO tambem vira desfecho, nao excecao', async () => {
    const { ctx } = harness({ unchanged: true })
    const sink = ctx.watch
    if (sink === undefined) throw new Error('harness sem sink')
    const failing: ImportContext = {
      ...ctx,
      watch: {
        ...sink,
        resolver: {
          async resolve() {
            throw new TypeError('resolver indisponivel')
          },
        },
      },
    }

    const result = await importMovie(failing, MOVIE_ID)

    expect(result.status).toBe('success')
    expect(result.watch.outcome).toBe('failed')
    expect(result.watch.errorClass).toBe('TypeError')
  })

  it('a ingestao continua logada: disponibilidade nao substitui `api_sync_logs`', async () => {
    const { ctx, syncLog } = harness()

    await importMovie(ctx, MOVIE_ID)

    expect(syncLog).toHaveLength(1)
    expect(syncLog[0]?.endpoint).toBe(`/movie/${String(MOVIE_ID)}`)
    expect(syncLog[0]?.status).toBe('success')
  })
})
