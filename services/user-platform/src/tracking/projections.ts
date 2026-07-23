/**
 * projections.ts — Projecoes deterministas do tracking (Backend C, C4).
 *
 * PURO: sem rede, sem DB, sem relogio. Deriva progresso de temporada/serie,
 * episodios concluidos, rewatches, retomada, ultima atividade e um resumo
 * NEUTRO que stats/ pode consumir no futuro (sem importar stats/ — zero
 * acoplamento circular). Determinismo total: mesma entrada (qualquer ordem)
 * => mesma saida. Sem divisao por zero, sem NaN, sem relogio global.
 */

import { computeProgressFraction } from "./policy.js";
import type { StoredViewingEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Progresso de temporada / serie
// ---------------------------------------------------------------------------

/** Progresso de UM episodio para projecao (fonte: episode-progress snapshots). */
export interface EpisodeProgressEntry {
  readonly episodeId: bigint;
  readonly seasonNumber: number;
  readonly watched: boolean;
  readonly progressSeconds: number | null;
  readonly durationSeconds: number | null;
  /** Ultima atividade do episodio (para ordenar a retomada); null = sem atividade. */
  readonly lastActivityAt: Date | null;
}

export interface SeasonProgress {
  readonly totalEpisodes: number;
  readonly watchedEpisodes: number;
  /** Fracao 0..1; temporada sem episodios => 0 (nunca NaN). */
  readonly fraction: number;
  readonly complete: boolean;
}

/** Dedup por episodeId com semantica OR (assistido se QUALQUER ocorrencia). */
function dedupWatched(episodes: readonly EpisodeProgressEntry[]): Map<bigint, boolean> {
  const byId = new Map<bigint, boolean>();
  for (const ep of episodes) {
    byId.set(ep.episodeId, (byId.get(ep.episodeId) ?? false) || ep.watched === true);
  }
  return byId;
}

/**
 * Progresso de uma temporada a partir dos episodios dela. Deduplica por
 * episodeId (nao infla contagem); temporada sem episodios => fraction 0,
 * complete false (nunca divisao por zero).
 */
export function computeSeasonProgress(episodes: readonly EpisodeProgressEntry[]): SeasonProgress {
  const byId = dedupWatched(episodes);
  const totalEpisodes = byId.size;
  let watchedEpisodes = 0;
  for (const watched of byId.values()) {
    if (watched) watchedEpisodes += 1;
  }
  const fraction = totalEpisodes > 0 ? watchedEpisodes / totalEpisodes : 0;
  return { totalEpisodes, watchedEpisodes, fraction, complete: totalEpisodes > 0 && watchedEpisodes === totalEpisodes };
}

/**
 * Progresso por temporada, agrupado por seasonNumber e ordenado
 * DETERMINISTICAMENTE (asc). Episodios especiais (seasonNumber = 0) formam seu
 * proprio grupo e NAO corrompem a temporada principal.
 */
export function groupSeasonProgress(
  episodes: readonly EpisodeProgressEntry[],
): ReadonlyArray<{ readonly seasonNumber: number; readonly progress: SeasonProgress }> {
  const bySeason = new Map<number, EpisodeProgressEntry[]>();
  for (const ep of episodes) {
    const list = bySeason.get(ep.seasonNumber);
    if (list === undefined) {
      bySeason.set(ep.seasonNumber, [ep]);
    } else {
      list.push(ep);
    }
  }
  return [...bySeason.keys()]
    .sort((a, b) => a - b)
    .map((seasonNumber) => ({
      seasonNumber,
      progress: computeSeasonProgress(bySeason.get(seasonNumber) ?? []),
    }));
}

/**
 * Progresso da SERIE inteira: deduplica por episodeId globalmente (especiais
 * incluidos como episodios). Serie sem episodios => estado vazio seguro.
 */
export function computeSeriesProgress(episodes: readonly EpisodeProgressEntry[]): SeasonProgress {
  return computeSeasonProgress(episodes);
}

/** Episodios concluidos (unicos). Duplicatas nao inflam a contagem. */
export function countCompletedEpisodes(episodes: readonly EpisodeProgressEntry[]): number {
  let count = 0;
  for (const watched of dedupWatched(episodes).values()) {
    if (watched) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Retomada
// ---------------------------------------------------------------------------

export interface ResumePoint {
  readonly episodeId: string;
  readonly progressSeconds: number;
  readonly fraction: number;
}

/**
 * Retomada: entre os episodios NAO concluidos com progresso > 0, escolhe o de
 * atividade mais recente (desempate determinista por episodeId maior). Nenhum
 * candidato => null. Nao usa relogio global (usa lastActivityAt dos dados).
 */
export function deriveResumePoint(episodes: readonly EpisodeProgressEntry[]): ResumePoint | null {
  let best: EpisodeProgressEntry | null = null;
  for (const ep of episodes) {
    if (ep.watched) continue;
    if (ep.progressSeconds === null || !Number.isFinite(ep.progressSeconds) || ep.progressSeconds <= 0) {
      continue;
    }
    if (best === null) {
      best = ep;
      continue;
    }
    const tb = best.lastActivityAt?.getTime() ?? -Infinity;
    const te = ep.lastActivityAt?.getTime() ?? -Infinity;
    if (te > tb || (te === tb && ep.episodeId > best.episodeId)) {
      best = ep;
    }
  }
  if (best === null || best.progressSeconds === null) {
    return null;
  }
  return {
    episodeId: best.episodeId.toString(10),
    progressSeconds: best.progressSeconds,
    fraction: computeProgressFraction(best.progressSeconds, best.durationSeconds),
  };
}

// ---------------------------------------------------------------------------
// Projecoes sobre eventos
// ---------------------------------------------------------------------------

/** Data (ISO UTC) da ultima atividade entre os eventos; null se vazio. Evento antigo nao rebaixa. */
export function lastActivityAt(events: readonly StoredViewingEvent[]): string | null {
  let maxTime = -Infinity;
  for (const event of events) {
    const t = event.occurredAt.getTime();
    if (t > maxTime) maxTime = t;
  }
  return maxTime === -Infinity ? null : new Date(maxTime).toISOString();
}

/** Conta rewatches distintos (eventos rewatch_started dedup por idempotencyKey). */
export function countRewatches(events: readonly StoredViewingEvent[]): number {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.eventType === "rewatch_started") {
      keys.add(event.idempotencyKey);
    }
  }
  return keys.size;
}

// ---------------------------------------------------------------------------
// Resumo NEUTRO para stats/ (sem importar stats/)
// ---------------------------------------------------------------------------

/** Saida neutra que stats/ podera consumir; sem acoplamento circular. */
export interface TrackingActivitySummary {
  readonly completedEpisodes: number;
  readonly rewatches: number;
  readonly lastActivityAt: string | null;
  readonly seasonsComplete: number;
}

export function buildTrackingActivitySummary(input: {
  readonly episodes: readonly EpisodeProgressEntry[];
  readonly events: readonly StoredViewingEvent[];
}): TrackingActivitySummary {
  const seasons = groupSeasonProgress(input.episodes);
  return {
    completedEpisodes: countCompletedEpisodes(input.episodes),
    rewatches: countRewatches(input.events),
    lastActivityAt: lastActivityAt(input.events),
    seasonsComplete: seasons.filter((s) => s.progress.complete).length,
  };
}
