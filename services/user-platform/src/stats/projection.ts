/**
 * projection.ts — Projecao de estatisticas do usuario (Backend C).
 *
 * PURO: nao faz rede, DB, fs nem relogio proprio — o instante atual chega
 * por parametro (`now`). O adapter monta a entrada AGREGADA (StatsInput) a
 * partir do Postgres; esta projecao apenas deriva numeros deterministas.
 *
 * Decisoes de determinismo:
 *  - streak calculado por strings ISO (yyyy-mm-dd) convertidas em "epoch day"
 *    via Date.UTC — nunca depende do timezone do runtime;
 *  - desempates sempre explicitos (genero: alfabetico por code unit;
 *    decada: cronologico) para a mesma entrada gerar SEMPRE a mesma saida;
 *  - notas de usuario ficam na escala propria 0.5..5.0 passo 0.5 (escala
 *    fixa 5) e NUNCA se misturam com fontes externas (invariantes 1/2) —
 *    valores fora da grade sao ignorados, nao "arredondados".
 */

/** Versao do algoritmo de projecao (persistida junto do snapshot). */
export const STATS_ALGORITHM_VERSION = "stats-v1";

/** Milissegundos em um dia (conversao epoch ms -> epoch day). */
const MILLIS_PER_DAY = 86_400_000;

/** Quantidade de generos no ranking. */
const TOP_GENRES_LIMIT = 5;

/** Chaves canonicas da distribuicao de notas (0.5..5.0 passo 0.5). */
export const RATING_DISTRIBUTION_KEYS = [
  "0.5",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "3.5",
  "4",
  "4.5",
  "5",
] as const;
export type RatingDistributionKey = (typeof RATING_DISTRIBUTION_KEYS)[number];

/**
 * Entrada AGREGADA da projecao. O adapter (camada de persistencia) e quem
 * consulta o banco e monta estes arrays; aqui nada e buscado.
 */
export interface StatsInput {
  /** Instante de referencia (injetado; nunca Date.now() interno). */
  readonly now: Date;
  /** Runtimes (minutos) dos FILMES assistidos; null = runtime desconhecido. */
  readonly movieRuntimes: ReadonlyArray<number | null>;
  /** Total de filmes assistidos (contagem ja agregada pelo chamador). */
  readonly watchedMovieCount: number;
  /** Episodios assistidos com runtime em minutos (null = desconhecido). */
  readonly watchedEpisodes: ReadonlyArray<{ readonly runtimeMinutes: number | null }>;
  /**
   * Dias ISO (yyyy-mm-dd) com atividade. O chamador garante ausencia de
   * duplicata, mas a projecao deduplica mesmo assim (defensivo).
   */
  readonly activityDays: ReadonlyArray<string>;
  /** Contagem por genero ja agregada pelo chamador. */
  readonly genreCounts: ReadonlyArray<{ readonly genreName: string; readonly count: number }>;
  /** Anos de lancamento dos titulos assistidos. */
  readonly releaseYears: ReadonlyArray<number>;
  /** Notas do usuario (0.5..5.0 passo 0.5; fora da grade e ignorado). */
  readonly ratings: ReadonlyArray<number>;
  /** Contagem de listas do usuario. */
  readonly listCounts: { readonly total: number; readonly custom: number };
}

/** Snapshot deterministico das estatisticas do usuario. */
export interface UserStatsProjection {
  readonly version: typeof STATS_ALGORITHM_VERSION;
  /** ISO 8601 do instante `now` recebido (nao do relogio do runtime). */
  readonly computedAt: string;
  /** Soma dos runtimes NAO-nulos (filmes assistidos + episodios). */
  readonly minutesWatched: number;
  readonly moviesWatched: number;
  readonly episodesWatched: number;
  /** Top 5 generos por contagem; desempate alfabetico (code unit). */
  readonly topGenres: ReadonlyArray<{ readonly genreName: string; readonly count: number }>;
  /** Decadas ("1990s") ordenadas por contagem desc; desempate cronologico. */
  readonly decades: ReadonlyArray<{ readonly decade: string; readonly count: number }>;
  /** Dias CONSECUTIVOS de atividade; current termina em `now` ou ontem. */
  readonly streak: { readonly currentDays: number; readonly longestDays: number };
  readonly ratings: {
    readonly count: number;
    /** Media com 1 casa decimal (0 quando nao ha nota valida). */
    readonly average: number;
    readonly distribution: Record<RatingDistributionKey, number>;
  };
  readonly lists: { readonly total: number; readonly custom: number };
}

const ISO_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Converte "yyyy-mm-dd" em epoch day (dias desde 1970-01-01 UTC).
 * Retorna null para formato invalido ou dia inexistente (ex.: 2024-02-30),
 * evitando que o rollover do Date.UTC crie dias fantasmas.
 */
function isoDayToEpochDay(isoDay: string): number | null {
  const match = ISO_DAY_PATTERN.exec(isoDay);
  if (match === null) {
    return null;
  }
  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return null;
  }
  const year = Number(yearText);
  const month = Number(monthText);
  const dayOfMonth = Number(dayText);
  const utcMillis = Date.UTC(year, month - 1, dayOfMonth);
  const roundTrip = new Date(utcMillis);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== dayOfMonth
  ) {
    return null;
  }
  return utcMillis / MILLIS_PER_DAY;
}

/** Epoch day do instante `now`, usando SEMPRE os componentes UTC. */
function nowToEpochDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / MILLIS_PER_DAY;
}

/** Runtime valido soma; null/nao-finito/nao-positivo soma zero. */
function runtimeOrZero(value: number | null): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return 0;
}

/** Normaliza contagens externas para inteiro nao-negativo. */
function toNonNegativeInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

/** Comparacao de strings por code unit (deterministica; nao usa locale). */
function compareByCodeUnit(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/**
 * Calcula streaks de dias CONSECUTIVOS a partir dos dias de atividade.
 * currentDays: tamanho do run que termina em `now` ou ontem (senao 0).
 * longestDays: maior run consecutivo do historico inteiro.
 */
function computeStreak(
  activityDays: ReadonlyArray<string>,
  todayEpochDay: number,
): { currentDays: number; longestDays: number } {
  // Dedupe defensivo mesmo com garantia do chamador.
  const uniqueDays = new Set<number>();
  for (const isoDay of activityDays) {
    const epochDay = isoDayToEpochDay(isoDay);
    if (epochDay !== null) {
      uniqueDays.add(epochDay);
    }
  }
  const sorted = [...uniqueDays].sort((a, b) => a - b);

  let longestDays = 0;
  let runLength = 0;
  let previous: number | null = null;
  for (const day of sorted) {
    runLength = previous !== null && day === previous + 1 ? runLength + 1 : 1;
    if (runLength > longestDays) {
      longestDays = runLength;
    }
    previous = day;
  }

  let currentDays = 0;
  const lastDay = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
  if (lastDay !== undefined && (lastDay === todayEpochDay || lastDay === todayEpochDay - 1)) {
    currentDays = 1;
    for (let index = sorted.length - 2; index >= 0; index -= 1) {
      const candidate = sorted[index];
      const successor = sorted[index + 1];
      if (candidate === undefined || successor === undefined || candidate !== successor - 1) {
        break;
      }
      currentDays += 1;
    }
  }

  return { currentDays, longestDays };
}

/** Top 5 generos por contagem; duplicatas de nome sao somadas (defensivo). */
function computeTopGenres(
  genreCounts: ReadonlyArray<{ readonly genreName: string; readonly count: number }>,
): ReadonlyArray<{ genreName: string; count: number }> {
  const merged = new Map<string, number>();
  for (const entry of genreCounts) {
    if (!Number.isInteger(entry.count) || entry.count <= 0) {
      continue;
    }
    merged.set(entry.genreName, (merged.get(entry.genreName) ?? 0) + entry.count);
  }
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1] || compareByCodeUnit(a[0], b[0]))
    .slice(0, TOP_GENRES_LIMIT)
    .map(([genreName, count]) => ({ genreName, count }));
}

/** Agrupa anos por decada ("1990s"); ordena por contagem desc, decada asc. */
function computeDecades(
  releaseYears: ReadonlyArray<number>,
): ReadonlyArray<{ decade: string; count: number }> {
  const counts = new Map<number, number>();
  for (const year of releaseYears) {
    if (!Number.isInteger(year)) {
      continue;
    }
    const decadeStart = Math.floor(year / 10) * 10;
    counts.set(decadeStart, (counts.get(decadeStart) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([decadeStart, count]) => ({ decade: `${decadeStart}s`, count }));
}

/**
 * Mapeia uma nota de usuario para a chave canonica da distribuicao.
 * Nota fora da grade 0.5..5.0 passo 0.5 => null (ignorada, nunca arredondada).
 */
function ratingToDistributionKey(value: number): RatingDistributionKey | null {
  if (!Number.isFinite(value) || value < 0.5 || value > 5) {
    return null;
  }
  // Passo 0.5: o dobro precisa ser inteiro (0.5 e exato em binario).
  if (!Number.isInteger(value * 2)) {
    return null;
  }
  const key = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return (RATING_DISTRIBUTION_KEYS as readonly string[]).includes(key)
    ? (key as RatingDistributionKey)
    : null;
}

/** Distribuicao zerada com TODAS as 10 chaves presentes. */
function emptyDistribution(): Record<RatingDistributionKey, number> {
  const distribution = {} as Record<RatingDistributionKey, number>;
  for (const key of RATING_DISTRIBUTION_KEYS) {
    distribution[key] = 0;
  }
  return distribution;
}

/** Agrega notas validas em count/average(1 casa)/distribution. */
function computeRatings(ratings: ReadonlyArray<number>): UserStatsProjection["ratings"] {
  const distribution = emptyDistribution();
  let count = 0;
  let sum = 0;
  for (const value of ratings) {
    const key = ratingToDistributionKey(value);
    if (key === null) {
      continue;
    }
    distribution[key] += 1;
    count += 1;
    sum += value;
  }
  const average = count === 0 ? 0 : Math.round((sum / count) * 10) / 10;
  return { count, average, distribution };
}

/**
 * Projecao deterministica das estatisticas do usuario.
 * Mesma entrada => mesma saida, em qualquer timezone de runtime.
 */
export function computeUserStats(input: StatsInput): UserStatsProjection {
  let minutesWatched = 0;
  for (const runtime of input.movieRuntimes) {
    minutesWatched += runtimeOrZero(runtime);
  }
  for (const episode of input.watchedEpisodes) {
    minutesWatched += runtimeOrZero(episode.runtimeMinutes);
  }

  return {
    version: STATS_ALGORITHM_VERSION,
    computedAt: input.now.toISOString(),
    minutesWatched,
    moviesWatched: toNonNegativeInt(input.watchedMovieCount),
    episodesWatched: input.watchedEpisodes.length,
    topGenres: computeTopGenres(input.genreCounts),
    decades: computeDecades(input.releaseYears),
    streak: computeStreak(input.activityDays, nowToEpochDay(input.now)),
    ratings: computeRatings(input.ratings),
    lists: {
      total: toNonNegativeInt(input.listCounts.total),
      custom: toNonNegativeInt(input.listCounts.custom),
    },
  };
}
