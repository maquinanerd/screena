/**
 * fixtures.ts — Golden fixtures dos payloads publicos (PURO).
 *
 * Uma fixture COMPLETA por tipo de payload, com todos os campos povoados —
 * inclusive os casos que os contract tests provam: midia bloqueada
 * (displayAllowed=false) misturada com liberada, file_path invalido, credito
 * sem slug de pessoa, alias duplicado. Deterministicas (datas fixas), sem
 * rede, sem banco.
 */

import type {
  CardSourceRow,
  CatalogJobSourceRow,
  CreditRow,
  EpisodeSourceRow,
  MediaRows,
  MovieSourceRow,
  PersonSourceRow,
  SearchSourceRow,
  SeasonSourceRow,
  TvSourceRow,
} from '../source-rows.js'
import type { MapOptions } from '../map.js'

/** Opcoes fixas dos testes. */
export const FIXTURE_OPTIONS: MapOptions = {
  siteOrigin: 'https://cinerie.com',
  locale: 'pt-BR',
}

/** Midia mista: liberada + BLOQUEADA + file_path invalido (os 2 ultimos caem). */
export const MEDIA_FIXTURE: MediaRows = {
  images: [
    {
      id: '11',
      imageType: 'poster',
      filePath: '/poster-ok.jpg',
      languageCode: 'pt',
      width: 500,
      height: 750,
      aspectRatio: 0.667,
      voteAverage: 8.2,
      displayAllowed: true,
    },
    {
      // BLOQUEADA com o MAIOR voto: se o fail-closed falhar, ela viraria poster.
      id: '12',
      imageType: 'poster',
      filePath: '/poster-bloqueado.jpg',
      languageCode: 'pt',
      width: 2000,
      height: 3000,
      aspectRatio: 0.667,
      voteAverage: 9.9,
      displayAllowed: false,
    },
    {
      id: '13',
      imageType: 'backdrop',
      filePath: '/backdrop-ok.jpg',
      languageCode: null,
      width: 1280,
      height: 720,
      aspectRatio: 1.778,
      voteAverage: 7.0,
      displayAllowed: true,
    },
    {
      // file_path INVALIDO (traversal): o helper canonico devolve null e a
      // linha e descartada — nunca URL quebrada no contrato.
      id: '14',
      imageType: 'poster',
      filePath: '/a/../etc/passwd',
      languageCode: null,
      width: null,
      height: null,
      aspectRatio: null,
      voteAverage: 5.0,
      displayAllowed: true,
    },
  ],
  videos: [
    {
      id: '21',
      tmdbVideoId: 'v-trailer',
      site: 'YouTube',
      videoKey: 'abc123',
      name: 'Trailer oficial',
      videoType: 'Trailer',
      official: true,
      languageCode: 'pt',
      publishedAt: new Date('2026-01-15T12:00:00.000Z'),
      displayAllowed: true,
    },
    {
      // Video BLOQUEADO: nunca chega ao contrato.
      id: '22',
      tmdbVideoId: 'v-blocked',
      site: 'YouTube',
      videoKey: 'blocked1',
      name: 'Clip bloqueado',
      videoType: 'Clip',
      official: false,
      languageCode: null,
      publishedAt: null,
      displayAllowed: false,
    },
    {
      // Site fora de YouTube/Vimeo: entra SEM embed (invariante 8).
      id: '23',
      tmdbVideoId: 'v-other',
      site: 'DesconhecidoTube',
      videoKey: 'zzz',
      name: 'Featurette externa',
      videoType: 'Featurette',
      official: null,
      languageCode: 'en',
      publishedAt: null,
      displayAllowed: true,
    },
  ],
}

/** Elenco: billing fora de ordem + pessoa sem slug (link null, nunca 404). */
export const CAST_FIXTURE: readonly CreditRow[] = [
  {
    personId: '301',
    personName: 'Beatriz Segunda',
    personSlug: 'beatriz-segunda',
    character: 'Coadjuvante',
    job: null,
    department: null,
    billingOrder: 2,
  },
  {
    personId: '300',
    personName: 'Alice Primeira',
    personSlug: 'alice-primeira',
    character: 'Protagonista',
    job: null,
    department: null,
    billingOrder: 1,
  },
  {
    personId: '302',
    personName: 'Sem Slug Ainda',
    personSlug: null,
    character: 'Extra',
    job: null,
    department: null,
    billingOrder: null,
  },
]

/** Equipe. */
export const CREW_FIXTURE: readonly CreditRow[] = [
  {
    personId: '310',
    personName: 'Diretora Exemplo',
    personSlug: 'diretora-exemplo',
    character: null,
    job: 'Director',
    department: 'Directing',
    billingOrder: null,
  },
]

/** Filme completo. */
export const MOVIE_FIXTURE: MovieSourceRow = {
  id: '100',
  tmdbId: 603,
  slug: 'matrix',
  titleOriginal: 'The Matrix',
  translation: {
    title: 'Matrix',
    summary: 'Um hacker descobre a verdade sobre a realidade.',
    metaTitle: 'Matrix (filme)',
    metaDescription: 'Ficha completa de Matrix.',
  },
  aliases: ['The Matrix', 'Matrix 1'],
  releaseDate: new Date('1999-03-31T00:00:00.000Z'),
  runtimeMinutes: 136,
  certification: '14',
  cast: CAST_FIXTURE,
  crew: CREW_FIXTURE,
  collection: { id: '900', name: 'Matrix — Colecao' },
  media: MEDIA_FIXTURE,
  ratings: [
    {
      source: 'imdb',
      label: 'IMDb Rating',
      value: 8.7,
      scale: 10,
      url: 'https://www.imdb.com/title/tt0133093/',
      attributionText: 'Nota fornecida por IMDb',
      attributionUrl: 'https://www.imdb.com/title/tt0133093/',
    },
  ],
  streaming: [
    { provider: 'ExemploFlix', offerType: 'subscription', country: 'BR', url: 'https://exemplo.test/matrix' },
  ],
}

/** Serie completa. */
export const TV_FIXTURE: TvSourceRow = {
  id: '200',
  tmdbId: 1399,
  slug: 'game-of-thrones',
  nameOriginal: 'Game of Thrones',
  translation: {
    title: 'Game of Thrones',
    summary: 'Casas nobres disputam o Trono de Ferro.',
    metaTitle: null,
    metaDescription: null,
  },
  aliases: ['GoT'],
  firstAirDate: new Date('2011-04-17T00:00:00.000Z'),
  lastAirDate: new Date('2019-05-19T00:00:00.000Z'),
  numberOfSeasons: 8,
  numberOfEpisodes: 73,
  certification: '16',
  cast: CAST_FIXTURE,
  seasons: [
    { id: '201', seasonNumber: 2, name: 'Temporada 2', episodeCount: 10 },
    { id: '202', seasonNumber: 0, name: 'Especiais', episodeCount: 3 },
    { id: '203', seasonNumber: 1, name: 'Temporada 1', episodeCount: 10 },
  ],
  media: MEDIA_FIXTURE,
  ratings: [],
  streaming: [],
}

/** Temporada completa. */
export const SEASON_FIXTURE: SeasonSourceRow = {
  id: '201',
  seasonNumber: 1,
  name: 'Temporada 1',
  overview: 'O inverno esta chegando.',
  airDate: new Date('2011-04-17T00:00:00.000Z'),
  series: { id: '200', title: 'Game of Thrones', slug: 'game-of-thrones' },
  episodes: [
    { id: '2102', episodeNumber: 2, name: 'The Kingsroad', airDate: new Date('2011-04-24T00:00:00.000Z') },
    { id: '2101', episodeNumber: 1, name: 'Winter Is Coming', airDate: new Date('2011-04-17T00:00:00.000Z') },
  ],
  media: { images: [], videos: [] },
}

/** Episodio completo. */
export const EPISODE_FIXTURE: EpisodeSourceRow = {
  id: '2101',
  seasonNumber: 1,
  episodeNumber: 1,
  name: 'Winter Is Coming',
  overview: 'A Patrulha da Noite encontra algo alem da Muralha.',
  airDate: new Date('2011-04-17T00:00:00.000Z'),
  runtimeMinutes: 62,
  series: { id: '200', title: 'Game of Thrones', slug: 'game-of-thrones' },
  media: MEDIA_FIXTURE,
}

/** Pessoa completa. */
export const PERSON_FIXTURE: PersonSourceRow = {
  id: '300',
  tmdbId: 6384,
  slug: 'keanu-reeves',
  name: 'Keanu Reeves',
  knownForDepartment: 'Acting',
  birthday: new Date('1964-09-02T00:00:00.000Z'),
  deathday: null,
  placeOfBirth: 'Beirute, Libano',
  biography: null,
  credits: [
    {
      personId: '300',
      personName: 'Keanu Reeves',
      personSlug: 'keanu-reeves',
      character: 'Neo',
      job: null,
      department: null,
      billingOrder: 1,
    },
  ],
  media: MEDIA_FIXTURE,
}

/** Cards de home/descoberta (um com score exibivel, um sem poster). */
export const CARDS_FIXTURE: readonly CardSourceRow[] = [
  {
    kind: 'movie',
    id: '100',
    title: 'Matrix',
    slug: 'matrix',
    year: 1999,
    posterPath: '/poster-ok.jpg',
    screenScore: 4.5,
  },
  {
    kind: 'movie',
    id: '101',
    title: 'Sem Poster',
    slug: 'sem-poster',
    year: 2024,
    posterPath: null,
    screenScore: null,
  },
]

/** Resultados de busca (um SEM canonicalUrl — deve ser descartado). */
export const SEARCH_ROWS_FIXTURE: readonly SearchSourceRow[] = [
  {
    entityType: 'movie',
    entityId: '100',
    title: 'Matrix',
    subtitle: 'Filme · 1999',
    year: 1999,
    imagePath: '/poster-ok.jpg',
    canonicalUrl: '/pt/filmes/matrix/',
    matchReason: 'exact',
    score: 1,
  },
  {
    entityType: 'person',
    entityId: '300',
    title: 'Keanu Reeves',
    subtitle: 'Pessoa',
    year: null,
    imagePath: null,
    // SEM canonicalUrl: apontaria para 404 — o mapper descarta.
    canonicalUrl: null,
    matchReason: 'fuzzy',
    score: 0.4,
  },
]

/** Jobs para o status da fila. */
export const DEAD_LETTER_FIXTURE: readonly CatalogJobSourceRow[] = [
  {
    id: '9001',
    jobType: 'sync_details',
    status: 'dead_letter',
    entityType: 'movie',
    externalId: '603',
    attempts: 5,
    maxAttempts: 5,
    priority: 100,
    availableAt: null,
    lastErrorCode: 'upstream_5xx',
    lastErrorSafe: 'HTTP 500 do provider',
  },
]
