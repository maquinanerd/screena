/**
 * episode-media-seasons.test.ts — A MIDIA POR EPISODIO DA CASCATA AUTOMATICA
 * SAI SO DAS TEMPORADAS MAIS RECENTES.
 *
 * ============================================================================
 * O QUE FOI MEDIDO EM PRODUCAO EM 16/09/2026
 * ============================================================================
 * Em 24 h, a cascata de `airing_series` criou 107.266 `sync_media` de episodio
 * na prioridade 80 — ~65 das 96 horas-worker do dia. O worker ficou saturado e a
 * fila global por prioridade nao chegou no resto por 14 dias: detalhe agendado,
 * descoberta e `/changes` represados. O custo ia para rebuscar, toda semana, o
 * still de cada episodio antigo de cada serie em exibicao — paginas de episodio
 * que estao fora do indice desde 27/08.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO TRAVA
 * ============================================================================
 *   - cascata AUTOMATICA (`changes`/`scheduled`/`discovery`): midia por episodio
 *     so das temporadas recentes (a do ultimo episodio exibido e a do proximo);
 *   - pedido de PESSOA (`on_demand`): todas, como antes;
 *   - todo `sync_episodes` continua saindo — o recorte e so do job EXTRA;
 *   - o recorte desce pela cascata inteira ate virar job (ou nao) de verdade;
 *   - ausente, o recorte cai no lado BARATO.
 *
 * O eixo e QUANTOS jobs de midia de episodio a cascata cria, nao a forma do
 * payload: um payload "certo" que o `sync_episodes` lesse com default `true`
 * passaria num teste de forma e custaria o mesmo que antes.
 */

import { describe, expect, it } from 'vitest'

import {
  COVERAGE_EPISODE_MEDIA_SEASONS,
  COVERAGE_REASONS,
  buildCoverageJob,
} from '../../../entity-coverage/entry.js'
import { extractLatestSeasonNumbers } from '../../../normalizers/tv.js'
import { CatalogJobInputError } from '../../handler.js'
import type { EnqueueCatalogJobInput } from '../../store-port.js'
import {
  DEFAULT_EPISODE_MEDIA_SEASONS,
  EPISODE_MEDIA_SEASONS_FIELD,
  validateSyncDetailsInput,
  validateSyncEpisodesInput,
  validateSyncSeasonsInput,
} from '../schemas.js'
import { SyncDetailsHandler } from '../sync-details-handler.js'
import { SyncEpisodesHandler } from '../sync-episodes-handler.js'
import { SyncSeasonsHandler } from '../sync-seasons-handler.js'
import { createFakeContext, createHandlerFakes } from './fakes.js'

/** Referencia de episodio como o TMDB a devolve no detalhe da serie. */
function ep(season: unknown, episode = 1) {
  return { season_number: season, episode_number: episode, air_date: '2026-09-01' } as never
}

describe('extractLatestSeasonNumbers — o que e "recente" vem do TMDB, nao de palpite', () => {
  it('no meio da temporada: uma so', () => {
    expect(
      extractLatestSeasonNumbers({ last_episode_to_air: ep(3, 5), next_episode_to_air: ep(3, 6) }),
    ).toEqual([3])
  })

  it('entre temporadas: a que terminou E a anunciada', () => {
    expect(
      extractLatestSeasonNumbers({ last_episode_to_air: ep(2, 10), next_episode_to_air: ep(3, 1) }),
    ).toEqual([2, 3])
  })

  it('serie encerrada: so a ultima', () => {
    expect(
      extractLatestSeasonNumbers({ last_episode_to_air: ep(5, 12), next_episode_to_air: null }),
    ).toEqual([5])
  })

  it('serie anunciada, sem episodio exibido: so a proxima', () => {
    expect(
      extractLatestSeasonNumbers({ last_episode_to_air: null, next_episode_to_air: ep(1, 1) }),
    ).toEqual([1])
  })

  it('especial por ultimo: a temporada 0 e real', () => {
    expect(
      extractLatestSeasonNumbers({ last_episode_to_air: ep(0, 3), next_episode_to_air: ep(4, 1) }),
    ).toEqual([0, 4])
  })

  it('sem nenhuma das duas: VAZIO — nunca "a de maior numero"', () => {
    expect(extractLatestSeasonNumbers({})).toEqual([])
    expect(extractLatestSeasonNumbers(null)).toEqual([])
    expect(
      extractLatestSeasonNumbers({ last_episode_to_air: null, next_episode_to_air: null }),
    ).toEqual([])
  })

  it('numero malformado nao vira temporada', () => {
    for (const ruim of ['3', -1, 2.5, null, undefined, Number.NaN]) {
      expect(
        extractLatestSeasonNumbers({ last_episode_to_air: ep(ruim), next_episode_to_air: null }),
        String(ruim),
      ).toEqual([])
    }
  })
})

describe('o contrato do payload', () => {
  it('ausente = latest, em sync_details e sync_seasons', () => {
    expect(DEFAULT_EPISODE_MEDIA_SEASONS).toBe('latest')
    expect(validateSyncDetailsInput({ entityType: 'tv', tmdbId: 1 }).episodeMediaSeasons).toBe(
      'latest',
    )
    expect(validateSyncSeasonsInput({ tmdbId: 1 }).episodeMediaSeasons).toBe('latest')
  })

  it('`all` e respeitado', () => {
    expect(
      validateSyncDetailsInput({
        entityType: 'tv',
        tmdbId: 1,
        [EPISODE_MEDIA_SEASONS_FIELD]: 'all',
      }).episodeMediaSeasons,
    ).toBe('all')
    expect(
      validateSyncSeasonsInput({ tmdbId: 1, [EPISODE_MEDIA_SEASONS_FIELD]: 'all' })
        .episodeMediaSeasons,
    ).toBe('all')
  })

  it('valor desconhecido REPROVA — nao vira nenhum dos dois em silencio', () => {
    expect(() =>
      validateSyncSeasonsInput({ tmdbId: 1, [EPISODE_MEDIA_SEASONS_FIELD]: 'current' }),
    ).toThrow(CatalogJobInputError)
    expect(() =>
      validateSyncDetailsInput({
        entityType: 'tv',
        tmdbId: 1,
        [EPISODE_MEDIA_SEASONS_FIELD]: true,
      }),
    ).toThrow(CatalogJobInputError)
  })
})

describe('buildCoverageJob — quem pede decide o recorte', () => {
  it('pessoa (on_demand) leva todas; a cascata automatica, so as recentes', () => {
    const recorte = (reason: (typeof COVERAGE_REASONS)[number]) =>
      buildCoverageJob({ kind: 'tv', tmdbId: 1399, locale: 'pt-BR', reason }).payload?.[
        EPISODE_MEDIA_SEASONS_FIELD
      ]
    expect(recorte('on_demand')).toBe('all')
    expect(recorte('scheduled')).toBe('latest')
    expect(recorte('changes')).toBe('latest')
    expect(recorte('discovery')).toBe('latest')
  })

  it('todo motivo tem recorte declarado, e o validador aceita o payload', () => {
    for (const reason of COVERAGE_REASONS) {
      expect(COVERAGE_EPISODE_MEDIA_SEASONS[reason], reason).toBeDefined()
      const job = buildCoverageJob({ kind: 'tv', tmdbId: 1399, locale: 'pt-BR', reason })
      expect(validateSyncDetailsInput(job.payload).episodeMediaSeasons, reason).toBe(
        COVERAGE_EPISODE_MEDIA_SEASONS[reason],
      )
    }
  })

  it('filme e pessoa nao ganham o campo: nao tem temporada', () => {
    for (const kind of ['movie', 'person'] as const) {
      const job = buildCoverageJob({ kind, tmdbId: 603, locale: 'pt-BR', reason: 'on_demand' })
      expect(job.payload, kind).not.toHaveProperty(EPISODE_MEDIA_SEASONS_FIELD)
    }
  })
})

/**
 * A cascata inteira, com os handlers reais e a fila fake: detalhe -> temporadas
 * -> episodios. Devolve os jobs de MIDIA DE EPISODIO criados — o custo.
 */
async function cascata(input: {
  readonly reason: (typeof COVERAGE_REASONS)[number]
  readonly seasonNumbers: readonly number[]
  readonly latestSeasonNumbers: readonly number[]
}): Promise<{
  readonly episodios: readonly EnqueueCatalogJobInput[]
  readonly midiaDeEpisodio: readonly EnqueueCatalogJobInput[]
  readonly temporadasComMidia: readonly number[]
}> {
  const fakes = createHandlerFakes()
  fakes.setSeasonNumbers(input.seasonNumbers)
  fakes.setLatestSeasonNumbers(input.latestSeasonNumbers)
  const detalhe = new SyncDetailsHandler({
    detailSync: fakes.deps.detailSync,
    store: fakes.store,
    search: fakes.deps.search,
  })
  const temporadas = new SyncSeasonsHandler({
    seasonsSync: fakes.deps.seasonsSync,
    store: fakes.store,
  })
  const episodios = new SyncEpisodesHandler({
    episodesSync: fakes.deps.episodesSync,
    store: fakes.store,
  })

  const raiz = buildCoverageJob({
    kind: 'tv',
    tmdbId: 1399,
    locale: 'pt-BR',
    reason: input.reason,
    scope: 'airing_series:2026-09-16',
  })
  await detalhe.execute(createFakeContext().context, detalhe.validateInput(raiz.payload))

  const jobDeTemporadas = fakes.store.enqueued.find((job) => job.jobType === 'sync_seasons')
  expect(jobDeTemporadas).toBeDefined()
  const resultado = await temporadas.execute(
    createFakeContext().context,
    temporadas.validateInput(jobDeTemporadas!.payload),
  )

  const jobsDeEpisodios = fakes.store.enqueued.filter((job) => job.jobType === 'sync_episodes')
  for (const job of jobsDeEpisodios) {
    await episodios.execute(createFakeContext().context, episodios.validateInput(job.payload))
  }

  return {
    episodios: jobsDeEpisodios,
    midiaDeEpisodio: fakes.store.enqueued.filter(
      (job) => job.jobType === 'sync_media' && job.entityType === 'episode',
    ),
    temporadasComMidia: resultado.episodeMediaSeasonNumbers,
  }
}

/** Temporadas dos jobs de midia de episodio. */
function temporadasDe(jobs: readonly EnqueueCatalogJobInput[]): number[] {
  return [
    ...new Set(jobs.map((job) => (job.payload as { seasonNumber: number }).seasonNumber)),
  ].sort((a, b) => a - b)
}

describe('a cascata de ponta a ponta — o custo em jobs', () => {
  // Uma serie longa em exibicao: especiais + 12 temporadas, no ar na 12.
  const LONGA = {
    seasonNumbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    latestSeasonNumbers: [12],
  }
  // A fake devolve 10 episodios por temporada.
  const EPISODIOS_POR_TEMPORADA = 10

  it('AUTOMATICA: midia de episodio so da temporada no ar', async () => {
    const r = await cascata({ reason: 'scheduled', ...LONGA })
    expect(temporadasDe(r.midiaDeEpisodio)).toEqual([12])
    expect(r.midiaDeEpisodio).toHaveLength(EPISODIOS_POR_TEMPORADA)
    expect(r.temporadasComMidia).toEqual([12])
  })

  it('mas TODA temporada continua ganhando o seu sync_episodes', async () => {
    const r = await cascata({ reason: 'scheduled', ...LONGA })
    expect(r.episodios).toHaveLength(LONGA.seasonNumbers.length)
  })

  it('SOB DEMANDA: todas as temporadas, como antes', async () => {
    const r = await cascata({ reason: 'on_demand', ...LONGA })
    expect(temporadasDe(r.midiaDeEpisodio)).toEqual(LONGA.seasonNumbers)
    expect(r.midiaDeEpisodio).toHaveLength(LONGA.seasonNumbers.length * EPISODIOS_POR_TEMPORADA)
  })

  it('o corte, nesta serie, e de 13 para 1 temporada de midia', async () => {
    const automatica = await cascata({ reason: 'changes', ...LONGA })
    const sobDemanda = await cascata({ reason: 'on_demand', ...LONGA })
    expect(sobDemanda.midiaDeEpisodio.length / automatica.midiaDeEpisodio.length).toBe(13)
  })

  it('entre temporadas, as DUAS recentes', async () => {
    const r = await cascata({
      reason: 'discovery',
      seasonNumbers: [1, 2, 3],
      latestSeasonNumbers: [2, 3],
    })
    expect(temporadasDe(r.midiaDeEpisodio)).toEqual([2, 3])
  })

  it('temporada recente que o provider NAO listou nao vira job', async () => {
    // `next_episode_to_air` apontando para a 4, que ainda nao esta em seasons[].
    const r = await cascata({
      reason: 'scheduled',
      seasonNumbers: [1, 2, 3],
      latestSeasonNumbers: [4],
    })
    expect(r.episodios).toHaveLength(3)
    expect(r.midiaDeEpisodio).toEqual([])
  })

  it('sem temporada recente informada: nenhuma midia de episodio na automatica', async () => {
    const r = await cascata({ reason: 'scheduled', seasonNumbers: [1, 2], latestSeasonNumbers: [] })
    expect(r.midiaDeEpisodio).toEqual([])
    expect(r.temporadasComMidia).toEqual([])
  })

  it('o payload do sync_episodes diz `false` EXPLICITO nas temporadas cortadas', async () => {
    const r = await cascata({
      reason: 'scheduled',
      seasonNumbers: [1, 2],
      latestSeasonNumbers: [2],
    })
    const porTemporada = Object.fromEntries(
      r.episodios.map((job) => {
        const payload = job.payload as { seasonNumber: number; enqueueEpisodeMedia?: unknown }
        return [payload.seasonNumber, payload.enqueueEpisodeMedia]
      }),
    )
    expect(porTemporada).toEqual({ 1: false, 2: true })
  })
})

describe('CONTROLES NEGATIVOS', () => {
  it('sem o campo no payload, o sync_episodes LIGA a midia — por isso o `false` e explicito', () => {
    // O default de `sync_episodes` e `true` (CLI e reparo manual contam com ele).
    // Um `sync_seasons` que omitisse o campo nas temporadas cortadas devolveria
    // a cascata ao custo de antes, com o payload parecendo certo.
    expect(validateSyncEpisodesInput({ tmdbId: 1399, seasonNumber: 1 }).enqueueEpisodeMedia).toBe(
      true,
    )
  })

  it('um sync_seasons SEM o recorte no payload cai em latest, nao em all', async () => {
    // Job enfileirado antes do campo existir (ou montado a mao). O erro para o
    // lado barato custa still antigo; para o outro, represou a fila 14 dias.
    const fakes = createHandlerFakes()
    fakes.setSeasonNumbers([1, 2, 3])
    fakes.setLatestSeasonNumbers([3])
    const handler = new SyncSeasonsHandler({
      seasonsSync: fakes.deps.seasonsSync,
      store: fakes.store,
    })
    const resultado = await handler.execute(
      createFakeContext().context,
      handler.validateInput({ tmdbId: 1399, locale: 'pt-BR' }),
    )
    expect(resultado.episodeMediaSeasons).toBe('latest')
    expect(resultado.episodeMediaSeasonNumbers).toEqual([3])
  })

  it('o sync_details repassa o recorte: `all` nao se perde no meio da cascata', async () => {
    const fakes = createHandlerFakes()
    const handler = new SyncDetailsHandler({
      detailSync: fakes.deps.detailSync,
      store: fakes.store,
      search: fakes.deps.search,
    })
    await handler.execute(
      createFakeContext().context,
      handler.validateInput({
        entityType: 'tv',
        tmdbId: 1399,
        [EPISODE_MEDIA_SEASONS_FIELD]: 'all',
      }),
    )
    const temporadas = fakes.store.enqueued.find((job) => job.jobType === 'sync_seasons')
    expect(temporadas?.payload?.[EPISODE_MEDIA_SEASONS_FIELD]).toBe('all')
  })
})
