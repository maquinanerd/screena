/**
 * SERVICOS DE APLICACAO do TRACKER de series (C8): episodio, temporada, serie
 * inteira, progresso e proximo episodio.
 *
 * ESCALA E O EIXO DESTE ARQUIVO. O catalogo real tem `Tagesschau` com ~21 mil
 * episodios, entao "marcar a serie toda" e um clique que toca 21 mil linhas.
 * As tres decisoes que tornam isso viavel:
 *
 *  1. A LISTA DE EPISODIOS NUNCA VAI PARA O CLIENTE. O navegador pede
 *     "marcar a serie"; quem enumera os episodios e o servidor.
 *  2. A ENUMERACAO E PAGINADA e a marcacao e feita em LOTES set-based (o
 *     adapter usa chunks de 1000 com duas operacoes por chunk).
 *  3. CADA LOTE E IDEMPOTENTE, entao uma falha no meio pode ser retentada sem
 *     compensacao — nao ha rollback gigante a inventar.
 *
 * POLITICA DE ESPECIAIS: `season_number = 0` fica FORA por padrao, das
 * contagens e das marcacoes em massa. E explicito em toda chamada
 * (`includeSpecials`) e testado nos dois sentidos — nao ha default implicito
 * espalhado pelo codigo.
 */

import { applyEpisodeProgress, deriveSeriesWatchState } from "../tracking/episode-progress.js";
import { assertTrackingMutationAllowed } from "../tracking/policy.js";
import { applyWatchStateChange } from "../tracking/watch-state.js";
import { type DomainResult, err, ok } from "../core/result.js";
import type { AuthenticatedContext, AuthRuntimeDeps, LibraryStores } from "./deps.js";
import type { CatalogEpisodeRecord, TransactionScope } from "../persistence/types.js";

/**
 * Episodios lidos por pagina ao enumerar uma serie.
 *
 * 2000 mantem cada leitura barata e limita a memoria do processo; para 21 mil
 * episodios sao ~11 paginas. Nao e o mesmo numero do chunk de ESCRITA (1000):
 * ler e mais barato do que escrever, e os dois tetos existem por razoes
 * diferentes.
 */
export const SERIES_PAGE_SIZE = 2000;

/**
 * Teto absoluto de episodios que UMA operacao em massa percorre.
 *
 * Existe para que uma serie patologica nao prenda a transacao indefinidamente.
 * Ao atingir o teto a operacao devolve `limit_exceeded` com o que ja fez — e
 * como cada lote e idempotente, repetir a chamada continua de onde parou em vez
 * de refazer tudo.
 */
export const SERIES_BULK_MAX_EPISODES = 50_000;

/** Politica de especiais padrao do produto. */
export const DEFAULT_INCLUDE_SPECIALS = false;

/**
 * Enumera episodios de uma serie percorrendo paginas.
 *
 * Devolve os ids em ORDEM canonica (temporada, episodio). O chamador nunca
 * recebe a lista completa por acidente: quem chama e sempre um servico deste
 * arquivo, e nenhum deles a devolve para a borda.
 */
async function collectSeriesEpisodes(
  stores: LibraryStores,
  scope: TransactionScope,
  input: {
    readonly tvShowId: bigint;
    readonly seasonNumber: number | null;
    readonly includeSpecials: boolean;
  },
): Promise<{ readonly episodes: readonly CatalogEpisodeRecord[]; readonly truncated: boolean }> {
  const todos: CatalogEpisodeRecord[] = [];
  let offset = 0;

  for (;;) {
    const pagina = await stores.catalog.listSeriesEpisodes(scope, {
      tvShowId: input.tvShowId,
      includeSpecials: input.includeSpecials,
      seasonNumber: input.seasonNumber,
      limit: SERIES_PAGE_SIZE,
      offset,
    });
    todos.push(...pagina);
    if (pagina.length < SERIES_PAGE_SIZE) {
      return { episodes: todos, truncated: false };
    }
    offset += SERIES_PAGE_SIZE;
    if (todos.length >= SERIES_BULK_MAX_EPISODES) {
      return { episodes: todos, truncated: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Episodio individual
// ---------------------------------------------------------------------------

export interface SetEpisodeWatchedInput {
  readonly episodeId: bigint;
  readonly tvShowId: bigint;
  readonly watched: boolean;
  readonly watchedAt: Date | null;
  readonly idempotencyKey: string;
  readonly expectedVersion: number | null;
}

/**
 * Marca/desmarca UM episodio e reavalia o estado da serie.
 *
 * A derivacao do estado da serie e CONSERVADORA (`deriveSeriesWatchState`):
 * promove para `watching`/`watched`, e NUNCA rebaixa `watched`, `paused`,
 * `dropped` ou `not_interested` — sair desses estados e decisao explicita do
 * usuario, nao efeito colateral de marcar um episodio.
 */
export async function setEpisodeWatched(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: SetEpisodeWatchedInput,
): Promise<DomainResult<{ readonly watched: boolean; readonly seriesStatusChanged: boolean }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const atual = await stores.episodeProgress.find(scope, {
      userId: authenticated.userId,
      episodeId: input.episodeId,
    });
    const current =
      atual.kind === "found"
        ? {
            watched: atual.progress.watched,
            watchedAt: atual.progress.watchedAt,
            progressSeconds: atual.progress.progressSeconds,
            durationSeconds: atual.progress.durationSeconds,
            version: atual.progress.version,
          }
        : null;

    const plano = applyEpisodeProgress({
      current,
      patch: { watched: input.watched, watchedAt: input.watchedAt ?? undefined },
      now,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      accountStatus: authenticated.userStatus,
      allowRegression: false,
    });
    if (!plano.ok) {
      return plano;
    }

    // No-op: nada mudou, nada a escrever.
    if (plano.value.events.length === 0 && current !== null) {
      return ok({ watched: current.watched, seriesStatusChanged: false });
    }

    const salvo = await stores.episodeProgress.upsert(scope, {
      userId: authenticated.userId,
      episodeId: input.episodeId,
      expectedVersion: current === null ? null : current.version,
      watched: plano.value.next.watched,
      watchedAt: plano.value.next.watchedAt,
      progressSeconds: plano.value.next.progressSeconds,
      durationSeconds: plano.value.next.durationSeconds,
      nextVersion: plano.value.next.version,
      now,
    });
    if (salvo.kind === "episode_not_found") {
      return err<{ readonly watched: boolean; readonly seriesStatusChanged: boolean }>(
        "not_found",
        "episodio nao encontrado no catalogo.",
      );
    }
    if (salvo.kind === "conflict") {
      return err<{ readonly watched: boolean; readonly seriesStatusChanged: boolean }>(
        "version_conflict",
        "este episodio mudou em outra aba. Recarregue e tente de novo.",
      );
    }

    for (const evento of plano.value.events) {
      await stores.viewingEvents.append(scope, {
        userId: authenticated.userId,
        entityType: "episode",
        entityId: input.episodeId,
        eventType: evento.eventType,
        occurredAt: evento.occurredAt,
        source: "app",
        idempotencyKey: evento.idempotencyKey,
      });
    }

    const mudouSerie = await refreshSeriesState(stores, scope, {
      userId: authenticated.userId,
      userStatus: authenticated.userStatus,
      tvShowId: input.tvShowId,
      now,
      idempotencyKey: `${input.idempotencyKey}-series`,
    });

    return ok({ watched: plano.value.next.watched, seriesStatusChanged: mudouSerie });
  });
}

/**
 * Reavalia o estado da serie a partir da contagem de episodios assistidos.
 *
 * Usa CONTAGENS (`count`), nunca a lista de progresso — para uma serie de 21
 * mil episodios, materializar as linhas so para contar seria o mesmo erro que o
 * resto do arquivo evita.
 */
async function refreshSeriesState(
  stores: LibraryStores,
  scope: TransactionScope,
  input: {
    readonly userId: bigint;
    readonly userStatus: AuthenticatedContext["userStatus"];
    readonly tvShowId: bigint;
    readonly now: Date;
    readonly idempotencyKey: string;
  },
): Promise<boolean> {
  const total = await stores.catalog.countSeriesEpisodes(scope, {
    tvShowId: input.tvShowId,
    includeSpecials: DEFAULT_INCLUDE_SPECIALS,
    seasonNumber: null,
  });
  if (total === 0) {
    return false;
  }

  const { episodes } = await collectSeriesEpisodes(stores, scope, {
    tvShowId: input.tvShowId,
    seasonNumber: null,
    includeSpecials: DEFAULT_INCLUDE_SPECIALS,
  });
  const assistidos = await stores.episodeProgress.countWatchedForSeries(scope, {
    userId: input.userId,
    episodeIds: episodes.map((e) => e.episodeId),
  });

  const atual = await stores.watchStates.find(scope, {
    userId: input.userId,
    entityType: "tv",
    entityId: input.tvShowId,
  });
  const statusAtual = atual.kind === "found" ? atual.state.status : null;

  const derivado = deriveSeriesWatchState({
    currentSeriesStatus: statusAtual,
    totalKnownEpisodes: total,
    watchedEpisodes: assistidos.watched,
  });
  // `null` = sem mudanca. A derivacao e nao-destrutiva por construcao.
  if (derivado === null || derivado === statusAtual) {
    return false;
  }

  const plano = applyWatchStateChange({
    current:
      atual.kind === "found"
        ? {
            status: atual.state.status,
            startedAt: atual.state.startedAt,
            completedAt: atual.state.completedAt,
            rewatchCount: atual.state.rewatchCount,
            version: atual.state.version,
          }
        : null,
    target: derivado,
    now: input.now,
    expectedVersion: null,
    idempotencyKey: input.idempotencyKey,
    accountStatus: input.userStatus,
  });
  if (!plano.ok) {
    return false;
  }

  const salvo = await stores.watchStates.upsert(scope, {
    userId: input.userId,
    entityType: "tv",
    entityId: input.tvShowId,
    expectedVersion: atual.kind === "found" ? atual.state.version : null,
    status: plano.value.next.status,
    startedAt: plano.value.next.startedAt,
    completedAt: plano.value.next.completedAt,
    rewatchCount: plano.value.next.rewatchCount,
    nextVersion: plano.value.next.version,
    now: input.now,
  });
  if (salvo.kind !== "saved") {
    return false;
  }

  for (const evento of plano.value.events) {
    await stores.viewingEvents.append(scope, {
      userId: input.userId,
      entityType: "tv",
      entityId: input.tvShowId,
      eventType: evento.eventType,
      occurredAt: evento.occurredAt,
      source: "app",
      idempotencyKey: evento.idempotencyKey,
    });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Temporada e serie inteira (operacao em massa)
// ---------------------------------------------------------------------------

export interface BulkMarkInput {
  readonly tvShowId: bigint;
  /** `null` = serie inteira; numero = uma temporada. */
  readonly seasonNumber: number | null;
  readonly watched: boolean;
  readonly watchedAt: Date | null;
  readonly includeSpecials?: boolean;
  readonly idempotencyKey: string;
}

export interface BulkMarkResult {
  readonly episodesConsidered: number;
  readonly created: number;
  readonly updated: number;
  /** true quando o teto foi atingido: repetir a chamada continua de onde parou. */
  readonly truncated: boolean;
  readonly seriesStatusChanged: boolean;
}

/**
 * Marca/desmarca TODOS os episodios de uma temporada ou da serie.
 *
 * O trabalho pesado e do adapter (`markBulk`, set-based em chunks). Aqui a
 * responsabilidade e enumerar sob a politica correta e reavaliar o estado da
 * serie UMA vez ao final — nao uma vez por episodio.
 */
export async function markSeriesEpisodes(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: BulkMarkInput,
): Promise<DomainResult<BulkMarkResult>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();
  const includeSpecials = input.includeSpecials ?? DEFAULT_INCLUDE_SPECIALS;

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const { episodes, truncated } = await collectSeriesEpisodes(stores, scope, {
      tvShowId: input.tvShowId,
      seasonNumber: input.seasonNumber,
      includeSpecials,
    });

    if (episodes.length === 0) {
      return ok<BulkMarkResult>({
        episodesConsidered: 0,
        created: 0,
        updated: 0,
        truncated: false,
        seriesStatusChanged: false,
      });
    }

    const r = await stores.episodeProgress.markBulk(scope, {
      userId: authenticated.userId,
      episodeIds: episodes.map((e) => e.episodeId),
      watched: input.watched,
      watchedAt: input.watched ? (input.watchedAt ?? now) : null,
      now,
    });

    // UM evento para a operacao inteira, nao um por episodio: 21 mil eventos
    // de diario para um clique tornariam o historico ilegivel e a escrita
    // proibitiva.
    await stores.viewingEvents.append(scope, {
      userId: authenticated.userId,
      entityType: "tv",
      entityId: input.tvShowId,
      eventType: input.watched ? "episode_watched" : "episode_unwatched",
      occurredAt: now,
      source: "app",
      idempotencyKey: input.idempotencyKey,
    });

    const mudouSerie = await refreshSeriesState(stores, scope, {
      userId: authenticated.userId,
      userStatus: authenticated.userStatus,
      tvShowId: input.tvShowId,
      now,
      idempotencyKey: `${input.idempotencyKey}-series`,
    });

    return ok<BulkMarkResult>({
      episodesConsidered: episodes.length,
      created: r.created,
      updated: r.updated,
      truncated,
      seriesStatusChanged: mudouSerie,
    });
  });
}

// ---------------------------------------------------------------------------
// Progresso e proximo episodio
// ---------------------------------------------------------------------------

export interface SeriesProgress {
  readonly tvShowId: bigint;
  readonly totalEpisodes: number;
  readonly watchedEpisodes: number;
  /** 0..100 com uma casa; derivado, NUNCA a fonte de verdade. */
  readonly percent: number;
  readonly completed: boolean;
  readonly nextEpisode: {
    readonly episodeId: bigint;
    readonly seasonNumber: number;
    readonly episodeNumber: number;
  } | null;
}

/**
 * Progresso da serie + PROXIMO EPISODIO.
 *
 * O progresso e DERIVADO dos episodios marcados — a fonte de verdade e
 * `user_episode_progress`, e o percentual e so apresentacao. Guardar o
 * percentual como verdade o faria divergir do dado assim que o catalogo
 * ganhasse um episodio.
 *
 * O proximo episodio e o PRIMEIRO nao marcado na ordem canonica (temporada,
 * episodio), sob a mesma politica de especiais. Ausencia de proximo e um estado
 * explicito (`null`), nao um erro.
 */
export async function readSeriesProgress(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly tvShowId: bigint; readonly includeSpecials?: boolean },
): Promise<SeriesProgress> {
  const includeSpecials = input.includeSpecials ?? DEFAULT_INCLUDE_SPECIALS;

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const { episodes } = await collectSeriesEpisodes(stores, scope, {
      tvShowId: input.tvShowId,
      seasonNumber: null,
      includeSpecials,
    });
    if (episodes.length === 0) {
      return {
        tvShowId: input.tvShowId,
        totalEpisodes: 0,
        watchedEpisodes: 0,
        percent: 0,
        completed: false,
        nextEpisode: null,
      };
    }

    const assistidosIds = new Set(
      await stores.episodeProgress.listWatchedIds(scope, {
        userId: authenticated.userId,
        episodeIds: episodes.map((e) => e.episodeId),
      }),
    );

    const proximo = episodes.find((e) => !assistidosIds.has(e.episodeId)) ?? null;
    const watched = assistidosIds.size;
    const total = episodes.length;

    return {
      tvShowId: input.tvShowId,
      totalEpisodes: total,
      watchedEpisodes: watched,
      percent: Math.round((watched / total) * 1000) / 10,
      completed: watched === total,
      nextEpisode:
        proximo === null
          ? null
          : {
              episodeId: proximo.episodeId,
              seasonNumber: proximo.seasonNumber,
              episodeNumber: proximo.episodeNumber,
            },
    };
  });
}
