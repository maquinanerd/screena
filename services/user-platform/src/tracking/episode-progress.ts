/**
 * episode-progress.ts — Progresso de episodio e derivacao de watch state de
 * serie a partir dos episodios assistidos.
 *
 * Modulo PURO: sem rede, sem DB, sem fs, sem Date.now() — o relogio entra
 * por parametro (`now`).
 *
 * Regras de produto (nao violar):
 * - diario de eventos e APPEND-ONLY: planos daqui so appendam eventos;
 * - carimbos derivam de forma NUNCA destrutiva (watchedAt so ganha default
 *   quando null; desmarcar nao apaga watchedAt salvo pedido explicito);
 * - patch identico = no-op (sem evento, sem bump de versao);
 * - derivacao de serie e conservadora: NUNCA rebaixa estado escolhido pelo
 *   usuario (watched/paused/dropped/rewatching/not_interested).
 */

import { checkExpectedVersion, validateIdempotencyKey } from "../core/request-guards.js";
import { type DomainResult, err, ok } from "../core/result.js";
import { type UserStatus, type ViewingEventType, type WatchState } from "../core/types.js";
import { assertTrackingMutationAllowed, exceedsOverDurationTolerance } from "./policy.js";
import { type TrackingEvent } from "./watch-state.js";

// ---------------------------------------------------------------------------
// Formas
// ---------------------------------------------------------------------------

/** Fotografia versionada do progresso de um episodio para um usuario. */
export interface EpisodeProgressSnapshot {
  readonly watched: boolean;
  readonly watchedAt: Date | null;
  readonly progressSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly version: number;
}

/**
 * Patch parcial: campo ausente (undefined) = nao alterar; null = limpar
 * explicitamente (quando o campo aceita null).
 */
export interface EpisodeProgressPatch {
  readonly watched?: boolean;
  readonly watchedAt?: Date | null;
  readonly progressSeconds?: number | null;
  readonly durationSeconds?: number | null;
}

export interface ApplyEpisodeProgressInput {
  readonly current: EpisodeProgressSnapshot | null;
  readonly patch: EpisodeProgressPatch;
  readonly now: Date;
  /** Versao esperada pelo cliente (null = cliente nao enviou Expected-Version). */
  readonly expectedVersion: number | null;
  readonly idempotencyKey: string;
  /** Estado da conta: so `active` pode mutar (bloqueia pending_deletion/deleted/disabled). */
  readonly accountStatus: UserStatus;
  /**
   * Permite regressao EXPLICITA de progresso (correcao ou rewatch). Sem esta
   * flag, um progressSeconds menor que o atual e rejeitado (nunca substitui
   * silenciosamente o maior).
   */
  readonly allowRegression?: boolean;
}

export interface EpisodeProgressChange {
  readonly next: EpisodeProgressSnapshot;
  readonly events: ReadonlyArray<TrackingEvent>;
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function makeEvent(
  eventType: ViewingEventType,
  now: Date,
  idempotencyKey: string,
): TrackingEvent {
  return { eventType, occurredAt: now, idempotencyKey };
}

function sameNullableDate(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.getTime() === b.getTime();
}

// ---------------------------------------------------------------------------
// Aplicacao de patch de progresso
// ---------------------------------------------------------------------------

/**
 * Aplica um patch de progresso de episodio de forma pura.
 *
 * Validacao (erros ACUMULADOS em pt-BR):
 * - progressSeconds >= 0 (quando presente);
 * - durationSeconds > 0 (quando presente);
 * - progressSeconds <= durationSeconds (quando ambos presentes).
 *
 * Eventos:
 * - marcar watched=true (false -> true) gera episode_watched; watchedAt
 *   ganha default `now` SOMENTE se ficar null apos o patch (nao destrutivo);
 * - desmarcar (true -> false) gera episode_unwatched; watchedAt e
 *   PRESERVADO salvo null explicito no patch;
 * - mudanca de progressSeconds/durationSeconds gera progress_updated;
 * - patch identico = no-op: events vazio, next identico, versao inalterada.
 *
 * Optimistic locking: quando current existe e expectedVersion e nao-null,
 * usa checkExpectedVersion — versao defasada retorna version_conflict.
 */
export function applyEpisodeProgress(
  input: ApplyEpisodeProgressInput,
): DomainResult<EpisodeProgressChange> {
  const accountCheck = assertTrackingMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }

  const keyCheck = validateIdempotencyKey(input.idempotencyKey);
  if (!keyCheck.ok) {
    return keyCheck;
  }

  if (input.current !== null && input.expectedVersion !== null) {
    const versionCheck = checkExpectedVersion(input.expectedVersion, input.current.version);
    if (!versionCheck.ok) {
      return versionCheck;
    }
  }

  const base: EpisodeProgressSnapshot =
    input.current ?? {
      watched: false,
      watchedAt: null,
      progressSeconds: null,
      durationSeconds: null,
      version: 0,
    };

  // Estado efetivo apos o patch (undefined = mantem o valor atual).
  const nextWatched = input.patch.watched !== undefined ? input.patch.watched : base.watched;
  const patchedWatchedAt =
    input.patch.watchedAt !== undefined ? input.patch.watchedAt : base.watchedAt;
  const nextProgress =
    input.patch.progressSeconds !== undefined ? input.patch.progressSeconds : base.progressSeconds;
  const nextDuration =
    input.patch.durationSeconds !== undefined ? input.patch.durationSeconds : base.durationSeconds;

  // Validacao acumulada (estilo ValidationResult do repo).
  const errors: string[] = [];
  if (nextProgress !== null && (!Number.isFinite(nextProgress) || nextProgress < 0)) {
    errors.push("progressSeconds deve ser um numero >= 0.");
  }
  if (nextDuration !== null && (!Number.isFinite(nextDuration) || nextDuration <= 0)) {
    errors.push("durationSeconds deve ser um numero > 0.");
  }
  // Posicao pode exceder a duracao apenas dentro da tolerancia explicita
  // (clock skew / arredondamento); alem disso e invalido.
  if (
    nextProgress !== null &&
    nextDuration !== null &&
    Number.isFinite(nextProgress) &&
    Number.isFinite(nextDuration) &&
    nextDuration > 0 &&
    exceedsOverDurationTolerance(nextProgress, nextDuration)
  ) {
    errors.push("progressSeconds excede durationSeconds alem da tolerancia.");
  }
  if (errors.length > 0) {
    return err("validation_failed", "dados de progresso de episodio invalidos.", errors);
  }

  // Regressao de progresso: um progressSeconds MENOR que o atual nunca
  // substitui o maior silenciosamente. So e aceito com allowRegression
  // explicito (correcao ou rewatch).
  if (
    !input.allowRegression &&
    input.patch.progressSeconds !== undefined &&
    nextProgress !== null &&
    base.progressSeconds !== null &&
    nextProgress < base.progressSeconds
  ) {
    return err(
      "precondition_failed",
      "regressao de progresso nao permitida sem intencao explicita.",
    );
  }

  const markingWatched = nextWatched && !base.watched;
  const unmarkingWatched = !nextWatched && base.watched;

  // watchedAt default `now` SOMENTE ao marcar assistido e SOMENTE se null
  // (nunca sobrescreve carimbo existente nem valor explicito do patch).
  const nextWatchedAt = markingWatched && patchedWatchedAt === null ? input.now : patchedWatchedAt;

  const progressChanged =
    nextProgress !== base.progressSeconds || nextDuration !== base.durationSeconds;

  // Patch identico = no-op: nada muda, nenhum evento, versao inalterada.
  const isNoOp =
    input.current !== null &&
    nextWatched === base.watched &&
    sameNullableDate(nextWatchedAt, base.watchedAt) &&
    !progressChanged;
  if (isNoOp) {
    return ok({ next: { ...base }, events: [] });
  }

  const next: EpisodeProgressSnapshot = {
    watched: nextWatched,
    watchedAt: nextWatchedAt,
    progressSeconds: nextProgress,
    durationSeconds: nextDuration,
    version: base.version + 1,
  };

  const events: TrackingEvent[] = [];
  if (markingWatched) {
    events.push(makeEvent("episode_watched", input.now, input.idempotencyKey));
  }
  if (unmarkingWatched) {
    events.push(makeEvent("episode_unwatched", input.now, input.idempotencyKey));
  }
  if (progressChanged) {
    events.push(makeEvent("progress_updated", input.now, input.idempotencyKey));
  }

  return ok({ next, events });
}

// ---------------------------------------------------------------------------
// Derivacao de watch state da serie
// ---------------------------------------------------------------------------

export interface DeriveSeriesWatchStateInput {
  readonly currentSeriesStatus: WatchState | null;
  readonly totalKnownEpisodes: number;
  readonly watchedEpisodes: number;
}

/**
 * Deriva o watch state da SERIE a partir do progresso de episodios.
 *
 * Derivacao NUNCA destrutiva (retorno null = sem mudanca):
 * - "watching" APENAS se ha >= 1 episodio assistido E o status atual e
 *   null ou "planned";
 * - "watched" APENAS se totalKnownEpisodes > 0 E watchedEpisodes === total
 *   E o status atual e "watching", null ou "planned";
 * - QUALQUER outro caso retorna null. Em particular, NUNCA rebaixa
 *   watched/paused/dropped/rewatching/not_interested — sair desses estados
 *   e decisao EXPLICITA do usuario (ver watch-state.ts), nunca derivada.
 *
 * Entradas anomalas (contagem nao-inteira ou negativa) tambem retornam
 * null: na duvida, a derivacao nao mexe em nada (fail-closed para "sem
 * mudanca").
 */
export function deriveSeriesWatchState(input: DeriveSeriesWatchStateInput): WatchState | null {
  const { currentSeriesStatus, totalKnownEpisodes, watchedEpisodes } = input;

  if (!Number.isInteger(totalKnownEpisodes) || totalKnownEpisodes < 0) {
    return null;
  }
  if (!Number.isInteger(watchedEpisodes) || watchedEpisodes < 0) {
    return null;
  }

  const upgradeableFromIdle = currentSeriesStatus === null || currentSeriesStatus === "planned";

  if (
    totalKnownEpisodes > 0 &&
    watchedEpisodes === totalKnownEpisodes &&
    (upgradeableFromIdle || currentSeriesStatus === "watching")
  ) {
    return "watched";
  }

  if (watchedEpisodes >= 1 && upgradeableFromIdle) {
    return "watching";
  }

  return null;
}
