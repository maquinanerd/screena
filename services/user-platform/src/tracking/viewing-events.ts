/**
 * viewing-events.ts — Registro de eventos de visualizacao (Backend C, C4).
 *
 * PURO: sem rede, sem DB, sem relogio (`now` e `occurredAt` injetados; nunca
 * Date.now). Decide se um evento candidato deve ser APPENDADO, e um replay
 * IDEMPOTENTE (no-op) ou um CONFLITO. Nao gera id nem timestamp — a persistencia
 * append-only faz isso. O timestamp de CHEGADA (`now`) so serve para a
 * tolerancia de evento futuro; o timestamp EFETIVO (`occurredAt`) e o do evento.
 */

import { validateIdempotencyKey } from "../core/request-guards.js";
import { type DomainResult, err, ok } from "../core/result.js";
import { VIEWING_EVENT_TYPES, type UserStatus } from "../core/types.js";
import { assertTrackingMutationAllowed, isFutureBeyondTolerance } from "./policy.js";
import {
  isTrackableEntityType,
  type StoredViewingEvent,
  VIEWING_EVENT_SOURCES,
  type ViewingEventInput,
} from "./types.js";

const EVENT_TYPE_SET: ReadonlySet<string> = new Set(VIEWING_EVENT_TYPES);
const SOURCE_SET: ReadonlySet<string> = new Set(VIEWING_EVENT_SOURCES);

/** Resultado do registro: appendar um evento novo, ou no-op (replay identico). */
export type ViewingEventRegistration =
  | { readonly action: "append"; readonly event: ViewingEventInput }
  | { readonly action: "noop" };

/** Compara metadata de forma canonica (chaves ordenadas; valores primitivos). */
function sameMetadata(
  a: ViewingEventInput["metadata"],
  b: StoredViewingEvent["metadata"],
): boolean {
  const ka = a ? Object.keys(a).sort() : [];
  const kb = b ? Object.keys(b).sort() : [];
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    const key = ka[i]!;
    if (key !== kb[i]) return false;
    if (a?.[key] !== b?.[key]) return false;
  }
  return true;
}

/**
 * Dois eventos tem o MESMO conteudo quando coincidem em TODOS os campos:
 * usuario, entidade, tipo, timestamp efetivo, origem E metadata. A regra da
 * missao e "mesma chave com conteudo divergente deve falhar" — por isso um
 * replay com a mesma chave porem QUALQUER campo divergente (inclusive metadata)
 * nao e no-op, e sim conflito. So um replay byte-a-byte identico e idempotente.
 */
function sameContent(candidate: ViewingEventInput, existing: StoredViewingEvent): boolean {
  return (
    candidate.userId === existing.userId &&
    candidate.entityType === existing.entityType &&
    candidate.entityId === existing.entityId &&
    candidate.eventType === existing.eventType &&
    candidate.occurredAt.getTime() === existing.occurredAt.getTime() &&
    candidate.source === existing.source &&
    sameMetadata(candidate.metadata, existing.metadata)
  );
}

/**
 * Decide o registro de um evento de visualizacao.
 *
 * Ordem de validacao (fail-closed):
 *  1. conta `active` (bloqueia pending_deletion/deleted/disabled);
 *  2. entidade RASTREAVEL (movie|tv|season|episode) — pessoa/noticia rejeitadas;
 *  3. tipo de evento pertence ao enum; source controlada;
 *  4. idempotencyKey valida;
 *  5. occurredAt nao pode estar no futuro alem da tolerancia;
 *  6. idempotencia: chave ja existente com MESMO conteudo => no-op; com
 *     conteudo DIVERGENTE => conflict; inexistente => append.
 */
export function registerViewingEvent(input: {
  readonly candidate: ViewingEventInput;
  readonly existingWithSameKey: StoredViewingEvent | null;
  readonly now: Date;
  readonly accountStatus: UserStatus;
}): DomainResult<ViewingEventRegistration> {
  const accountCheck = assertTrackingMutationAllowed(input.accountStatus);
  if (!accountCheck.ok) {
    return accountCheck;
  }

  const { candidate } = input;

  if (!isTrackableEntityType(candidate.entityType)) {
    return err("validation_failed", "entidade nao rastreavel.");
  }
  if (!EVENT_TYPE_SET.has(candidate.eventType)) {
    return err("validation_failed", "tipo de evento desconhecido.");
  }
  if (!SOURCE_SET.has(candidate.source)) {
    return err("validation_failed", "origem de evento invalida.");
  }

  const keyCheck = validateIdempotencyKey(candidate.idempotencyKey);
  if (!keyCheck.ok) {
    return keyCheck;
  }

  if (isFutureBeyondTolerance(candidate.occurredAt, input.now)) {
    return err("precondition_failed", "evento no futuro alem da tolerancia.");
  }

  // Idempotencia por chave.
  if (input.existingWithSameKey !== null) {
    if (input.existingWithSameKey.idempotencyKey !== candidate.idempotencyKey) {
      // Chamador entregou um registro que nao corresponde a chave: fail-closed.
      return err("conflict", "chave de idempotencia inconsistente.");
    }
    if (sameContent(candidate, input.existingWithSameKey)) {
      return ok({ action: "noop" });
    }
    return err("conflict", "mesma chave de idempotencia com conteudo divergente.");
  }

  return ok({ action: "append", event: candidate });
}
