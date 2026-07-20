/**
 * watch-state.ts — Maquina de estados de acompanhamento (watch state) do
 * usuario sobre uma entidade assistivel (movie|tv).
 *
 * Modulo PURO: sem rede, sem DB, sem fs, sem Date.now() — o relogio entra
 * por parametro (`now`). A persistencia e o diario de eventos (append-only)
 * ficam na fronteira de escrita; aqui so se DECIDE a transicao e o plano de
 * eventos resultante.
 *
 * Contexto de produto (nao violar):
 * - tudo nasce privado; o diario de viewing events e APPEND-ONLY — nenhum
 *   plano produzido aqui apaga evento ja registrado (undo gera evento NOVO);
 * - carimbos (startedAt/completedAt) derivam de forma NUNCA destrutiva;
 * - idempotencia: mesmo estado = no-op, sem evento novo;
 * - optimistic locking via Expected-Version (../core/request-guards.js).
 */

import { checkExpectedVersion, validateIdempotencyKey } from "../core/request-guards.js";
import { type DomainResult, err, ok } from "../core/result.js";
import { WATCH_STATES, type UserStatus, type ViewingEventType, type WatchState } from "../core/types.js";
import { assertTrackingMutationAllowed } from "./policy.js";

// ---------------------------------------------------------------------------
// Formas compartilhadas do modulo de tracking
// ---------------------------------------------------------------------------

/** Fotografia versionada do estado de acompanhamento persistido. */
export interface WatchStateSnapshot {
  readonly status: WatchState;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly rewatchCount: number;
  readonly version: number;
}

/** Evento de diario a ser APPENDADO (nunca substitui nem apaga evento). */
export interface TrackingEvent {
  readonly eventType: ViewingEventType;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
}

/** Plano de mudanca: proximo snapshot + eventos append-only a registrar. */
export interface WatchStateChange {
  readonly next: WatchStateSnapshot;
  readonly events: ReadonlyArray<TrackingEvent>;
}

// ---------------------------------------------------------------------------
// Tabela de transicoes
// ---------------------------------------------------------------------------

const ALL_STATES: ReadonlySet<WatchState> = new Set(WATCH_STATES);

/**
 * Tabela EXPLICITA e liberal de transicoes: o usuario pode ir de qualquer
 * estado para qualquer estado, porque toda chamada a esta tabela acontece no
 * caminho de uma DECISAO EXPLICITA do usuario (acao direta na UI/API).
 *
 * Nota sobre `not_interested`: sair de not_interested SO acontece por decisao
 * explicita do usuario — e como esta funcao so roda nesse caminho, qualquer
 * `to` e valido a partir dele. Derivacoes AUTOMATICAS (ex.:
 * deriveSeriesWatchState em episode-progress.ts) NUNCA movem um estado para
 * fora de not_interested (nem de watched/paused/dropped/rewatching): la a
 * regra e conservadora e retorna "sem mudanca".
 *
 * A tabela permanece explicita (em vez de um simples `return true`) para que
 * qualquer restricao futura seja uma edicao LOCAL e auditavel, coberta por
 * teste — nunca uma condicao espalhada.
 */
const WATCH_TRANSITIONS: Readonly<Record<WatchState, ReadonlySet<WatchState>>> = {
  planned: ALL_STATES,
  watching: ALL_STATES,
  watched: ALL_STATES,
  paused: ALL_STATES,
  dropped: ALL_STATES,
  rewatching: ALL_STATES,
  not_interested: ALL_STATES,
};

/**
 * Decide se a transicao from -> to e valida.
 *
 * - from === null: primeiro estado do usuario sobre a entidade — qualquer
 *   alvo e valido.
 * - from === to: valido e IDEMPOTENTE (a aplicacao vira no-op e nao gera
 *   evento novo — ver applyWatchStateChange).
 */
export function isValidWatchTransition(from: WatchState | null, to: WatchState): boolean {
  if (!ALL_STATES.has(to)) {
    return false;
  }
  if (from === null || from === to) {
    return true;
  }
  return WATCH_TRANSITIONS[from].has(to);
}

// ---------------------------------------------------------------------------
// Aplicacao de mudanca de estado
// ---------------------------------------------------------------------------

export interface ApplyWatchStateChangeInput {
  readonly current: WatchStateSnapshot | null;
  readonly target: WatchState;
  readonly now: Date;
  /** Versao esperada pelo cliente (null = cliente nao enviou Expected-Version). */
  readonly expectedVersion: number | null;
  readonly idempotencyKey: string;
  /** Estado da conta: so `active` pode mutar (bloqueia pending_deletion/deleted/disabled). */
  readonly accountStatus: UserStatus;
}

function makeEvent(
  eventType: ViewingEventType,
  now: Date,
  idempotencyKey: string,
): TrackingEvent {
  return { eventType, occurredAt: now, idempotencyKey };
}

/**
 * Aplica uma mudanca de watch state de forma pura, derivando carimbos SEM
 * destruir informacao:
 *
 * - -> watching: seta startedAt SOMENTE se null (primeira vez); gera
 *   watch_started apenas nessa primeira ida;
 * - -> watched: seta completedAt SOMENTE se null; gera watch_completed
 *   apenas nessa primeira conclusao;
 * - -> rewatching: incrementa rewatchCount e gera rewatch_started;
 * - mesmo status: no-op (events vazio, next identico, versao inalterada);
 * - toda mudanca real de status gera state_changed.
 *
 * Optimistic locking: quando current existe e expectedVersion e nao-null,
 * usa checkExpectedVersion — versao defasada retorna version_conflict.
 */
export function applyWatchStateChange(
  input: ApplyWatchStateChangeInput,
): DomainResult<WatchStateChange> {
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

  const from = input.current === null ? null : input.current.status;
  if (!isValidWatchTransition(from, input.target)) {
    return err("precondition_failed", "transicao de estado de acompanhamento nao permitida.");
  }

  // Idempotencia: mesmo status = no-op. Nao gera evento novo, nao bumpa
  // versao e devolve snapshot identico.
  if (input.current !== null && input.current.status === input.target) {
    return ok({ next: { ...input.current }, events: [] });
  }

  const base: WatchStateSnapshot =
    input.current ?? {
      status: input.target,
      startedAt: null,
      completedAt: null,
      rewatchCount: 0,
      version: 0,
    };

  const firstWatching = input.target === "watching" && base.startedAt === null;
  const firstWatched = input.target === "watched" && base.completedAt === null;
  const isRewatch = input.target === "rewatching";

  const next: WatchStateSnapshot = {
    status: input.target,
    // Carimbos NUNCA destrutivos: uma vez setados, nao sao sobrescritos.
    startedAt: firstWatching ? input.now : base.startedAt,
    completedAt: firstWatched ? input.now : base.completedAt,
    rewatchCount: isRewatch ? base.rewatchCount + 1 : base.rewatchCount,
    version: base.version + 1,
  };

  const events: TrackingEvent[] = [makeEvent("state_changed", input.now, input.idempotencyKey)];
  if (firstWatching) {
    events.push(makeEvent("watch_started", input.now, input.idempotencyKey));
  }
  if (firstWatched) {
    events.push(makeEvent("watch_completed", input.now, input.idempotencyKey));
  }
  if (isRewatch) {
    events.push(makeEvent("rewatch_started", input.now, input.idempotencyKey));
  }

  return ok({ next, events });
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export interface BuildUndoInput {
  /** Snapshot anterior a mudanca que se quer desfazer (null = nao havia estado). */
  readonly previous: WatchStateSnapshot | null;
  readonly now: Date;
  readonly idempotencyKey: string;
  /** Estado da conta: so `active` pode desfazer (undo tambem e mutacao). */
  readonly accountStatus: UserStatus;
}

/** Plano de undo: restaura o snapshot anterior e APPENDA evento undo. */
export interface UndoPlan {
  /**
   * Estado a restaurar. null significa que antes da mudanca nao havia
   * estado — o registro de acompanhamento volta a inexistir.
   *
   * Nota de versionamento: o plano preserva os campos do snapshot anterior
   * como valor de dominio; o bump de versao da ESCRITA do undo e aplicado
   * pela fronteira de persistencia (optimistic write), que e quem conhece a
   * versao vigente no banco.
   */
  readonly next: WatchStateSnapshot | null;
  /**
   * SOMENTE o evento undo. O evento original NUNCA e apagado: o diario e
   * append-only e o undo e registrado como um evento NOVO por cima.
   */
  readonly events: ReadonlyArray<TrackingEvent>;
}

/**
 * Constroi o plano de undo de uma mudanca de watch state. O plano restaura
 * o estado anterior E gera o evento `undo`; nada e removido do diario.
 */
export function buildUndo(input: BuildUndoInput): DomainResult<UndoPlan> {
  const accountCheck = assertTrackingMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }

  const keyCheck = validateIdempotencyKey(input.idempotencyKey);
  if (!keyCheck.ok) {
    return keyCheck;
  }

  return ok({
    next: input.previous === null ? null : { ...input.previous },
    events: [makeEvent("undo", input.now, input.idempotencyKey)],
  });
}
