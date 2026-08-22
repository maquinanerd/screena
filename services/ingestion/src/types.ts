/**
 * types.ts — Contratos de entrada normalizada (TMDB -> formato canonico Screena).
 *
 * Estes tipos sao PLANOS e independentes do Prisma Client (para que os
 * normalizers sejam puros e typecheckaveis sem o client gerado). Os adapters de
 * persistencia traduzem estes objetos para chamadas
 * Prisma. Espelham as colunas das tabelas da Fase 1.
 *
 * REGRA: nenhum campo de rating editorial aqui. `vote_average_tmdb`/
 * `vote_count_tmdb` sao dados tecnicos do provider, nunca nota editorial.
 */

/** Tipo de entidade polimorfica (espelha o enum EntityType do schema). */
export type EntityType = 'movie' | 'tv' | 'season' | 'episode' | 'person'

/** Erro de normalizacao: payload sem dados minimos exigidos. */
export class NormalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NormalizationError'
  }
}

/** Upsert de `movies` (chave: tmdbId). */
export interface MovieUpsert {
  readonly tmdbId: number
  readonly imdbId: string | null
  readonly titleOriginal: string
  readonly originalLanguage: string | null
  readonly releaseDate: string | null
  readonly runtimeMinutes: number | null
  readonly status: string | null
  readonly popularity: number | null
  readonly voteAverageTmdb: number | null
  readonly voteCountTmdb: number | null
  readonly posterPath: string | null
  readonly backdropPath: string | null
  /**
   * Orcamento do detalhe (inteiro; dolar por convencao documentada da API).
   * `0` do upstream = "nao informado" e vira null na normalizacao.
   */
  readonly budget: bigint | null
  /** Estreia regional BR (`release_dates`, recorte BR). */
  readonly releaseDateBr: string | null
  /** Classificacao indicativa BRASILEIRA (`release_dates`, recorte BR). */
  readonly certification: string | null
}

/** Vinculo titulo->pais de origem, na ordem do payload. */
export interface TitleCountryLink {
  readonly countryCode: string
  readonly position: number
}

/** Os dois sinais de parentesco que o TMDB devolve. Vocabulario FECHADO. */
export type RecommendationKind = 'recommendation' | 'similar'

/** Um vinculo de recomendacao, com a POSICAO que o TMDB devolveu. */
export interface TitleRecommendationLink {
  readonly kind: RecommendationKind
  readonly targetMediaType: 'movie' | 'tv'
  readonly targetTmdbId: number
  /** Ordem no array do TMDB — e o proprio sinal de forca. */
  readonly position: number
}

/** Um genero ligado a um titulo, com a POSICAO que o TMDB devolveu. */
export interface TitleGenreLink {
  readonly tmdbId: number
  /** Ordem no array do TMDB. Editorial: o primeiro e o mais representativo. */
  readonly position: number
}

/** Upsert de `tv_shows` (chave: tmdbId). */
export interface TvShowUpsert {
  readonly tmdbId: number
  readonly imdbId: string | null
  readonly nameOriginal: string
  readonly originalLanguage: string | null
  readonly firstAirDate: string | null
  readonly lastAirDate: string | null
  readonly status: string | null
  readonly numberOfSeasons: number | null
  readonly numberOfEpisodes: number | null
  readonly popularity: number | null
  readonly voteAverageTmdb: number | null
  readonly voteCountTmdb: number | null
  readonly posterPath: string | null
  readonly backdropPath: string | null
  /** Classificacao indicativa BRASILEIRA (`content_ratings`, recorte BR). */
  readonly certification: string | null
}

/** Upsert de `seasons` (chave: tvShowId + seasonNumber). */
export interface SeasonUpsert {
  readonly tmdbId: number | null
  readonly seasonNumber: number
  readonly name: string | null
  readonly overview: string | null
  readonly airDate: string | null
  readonly episodeCount: number | null
  readonly posterPath: string | null
}

/** Upsert de `episodes` (chave: seasonId + episodeNumber). */
export interface EpisodeUpsert {
  readonly tmdbId: number | null
  readonly episodeNumber: number
  readonly name: string | null
  readonly overview: string | null
  readonly airDate: string | null
  readonly runtimeMinutes: number | null
  readonly stillPath: string | null
}

/** Upsert de `people` (chave: tmdbId). */
export interface PersonUpsert {
  readonly tmdbId: number
  readonly imdbId: string | null
  readonly name: string
  readonly knownForDepartment: string | null
  readonly gender: number | null
  readonly birthday: string | null
  readonly deathday: string | null
  readonly placeOfBirth: string | null
  readonly profilePath: string | null
  /**
   * Biografia crua do TMDB. `null` quando a fonte nao trouxe.
   *
   * ATENCAO: presenca aqui NAO e autorizacao de exibicao. Quem governa a tela e
   * `people.biography_source_status` (invariante 6), que continua no default
   * `unknown` — persistir o texto e condicao necessaria, nunca suficiente.
   */
  readonly biography: string | null
}

/** Pessoa minima derivada de um credito (para upsert antes de ligar credito). */
export interface PersonStub {
  readonly tmdbId: number
  readonly name: string
  readonly knownForDepartment: string | null
  readonly gender: number | null
  readonly profilePath: string | null
}

/** Credito de elenco normalizado. */
export interface CastMemberInput {
  readonly personTmdbId: number
  readonly person: PersonStub
  readonly character: string | null
  readonly billingOrder: number | null
  readonly creditId: string | null
}

/** Credito de equipe normalizado. */
export interface CrewMemberInput {
  readonly personTmdbId: number
  readonly person: PersonStub
  readonly department: string | null
  readonly job: string | null
  readonly creditId: string | null
}

/** Id externo normalizado para `entity_external_ids`. */
export interface ExternalIdInput {
  readonly source: string
  readonly externalId: string
  readonly url: string | null
}
