/**
 * COMANDOS VALIDADOS da biblioteca pessoal (C8) + parsers.
 *
 * PURO: sem rede, sem DB, sem relogio. Allow-list estrita, nunca spread.
 *
 * NENHUM comando daqui carrega `userId` — nem opcionalmente. A identidade vem
 * SEMPRE da sessao resolvida no servidor, e o parser estrito
 * (`rejectUnknownKeys`) recusa a chave se alguem tentar envia-la. E a defesa de
 * ownership no nivel do CONTRATO, antes de qualquer servico.
 */

import { type DomainResult, err, ok } from "../core/result.js";
import {
  RATABLE_ENTITY_TYPES,
  VISIBILITIES,
  WATCHABLE_ENTITY_TYPES,
  WATCH_STATES,
  type RatableEntityType,
  type Visibility,
  type WatchState,
  type WatchableEntityType,
} from "../core/types.js";
import { asRecord, optionalString, rejectUnknownKeys, requireString } from "./parse.js";
import { parseEntityId } from "./payloads.js";
import { LIST_LIMITS } from "../lists/custom-lists.js";

/** Le e valida uma referencia de entidade (tipo + id serializado). */
function requireEntityRef<T extends string>(
  record: Record<string, unknown>,
  allowed: readonly T[],
): DomainResult<{ entityType: T; entityId: bigint }> {
  const tipo = record["entityType"];
  if (typeof tipo !== "string" || !(allowed as readonly string[]).includes(tipo)) {
    return err("validation_failed", "dados invalidos.", [
      `entityType deve ser um de: ${allowed.join(", ")}.`,
    ]);
  }
  const idRaw = requireString(record, "entityId", { trim: true, max: 20 });
  if (!idRaw.ok) return idRaw;
  const id = parseEntityId(idRaw.value);
  if (!id.ok) return id;
  return ok({ entityType: tipo as T, entityId: id.value });
}

export interface SetWatchStateCommand {
  readonly entityType: WatchableEntityType;
  readonly entityId: bigint;
  readonly status: WatchState;
}

export function parseSetWatchStateCommand(
  input: unknown,
): DomainResult<SetWatchStateCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["entityType", "entityId", "status"]);
  if (!strict.ok) return strict;

  const ref = requireEntityRef(record.value, WATCHABLE_ENTITY_TYPES);
  if (!ref.ok) return ref;

  const status = record.value["status"];
  if (typeof status !== "string" || !(WATCH_STATES as readonly string[]).includes(status)) {
    return err("validation_failed", "dados invalidos.", [
      `status deve ser um de: ${WATCH_STATES.join(", ")}.`,
    ]);
  }

  return ok({ ...ref.value, status: status as WatchState });
}

export interface EntityRefCommand {
  readonly entityType: WatchableEntityType;
  readonly entityId: bigint;
}

export function parseEntityRefCommand(input: unknown): DomainResult<EntityRefCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["entityType", "entityId"]);
  if (!strict.ok) return strict;
  return requireEntityRef(record.value, WATCHABLE_ENTITY_TYPES);
}

export interface SetEpisodeWatchedCommand {
  readonly episodeId: bigint;
  readonly tvShowId: bigint;
  readonly watched: boolean;
}

export function parseSetEpisodeWatchedCommand(
  input: unknown,
): DomainResult<SetEpisodeWatchedCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["episodeId", "tvShowId", "watched"]);
  if (!strict.ok) return strict;

  const episodeRaw = requireString(record.value, "episodeId", { trim: true, max: 20 });
  if (!episodeRaw.ok) return episodeRaw;
  const episodeId = parseEntityId(episodeRaw.value);
  if (!episodeId.ok) return episodeId;

  const tvRaw = requireString(record.value, "tvShowId", { trim: true, max: 20 });
  if (!tvRaw.ok) return tvRaw;
  const tvShowId = parseEntityId(tvRaw.value);
  if (!tvShowId.ok) return tvShowId;

  const watched = record.value["watched"];
  if (typeof watched !== "boolean") {
    return err("validation_failed", "dados invalidos.", ["watched deve ser booleano."]);
  }

  return ok({ episodeId: episodeId.value, tvShowId: tvShowId.value, watched });
}

export interface BulkMarkCommand {
  readonly tvShowId: bigint;
  readonly seasonNumber: number | null;
  readonly watched: boolean;
  readonly includeSpecials: boolean;
}

export function parseBulkMarkCommand(input: unknown): DomainResult<BulkMarkCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, [
    "tvShowId",
    "seasonNumber",
    "watched",
    "includeSpecials",
  ]);
  if (!strict.ok) return strict;

  const tvRaw = requireString(record.value, "tvShowId", { trim: true, max: 20 });
  if (!tvRaw.ok) return tvRaw;
  const tvShowId = parseEntityId(tvRaw.value);
  if (!tvShowId.ok) return tvShowId;

  const watched = record.value["watched"];
  if (typeof watched !== "boolean") {
    return err("validation_failed", "dados invalidos.", ["watched deve ser booleano."]);
  }

  const seasonRaw = record.value["seasonNumber"];
  let seasonNumber: number | null = null;
  if (seasonRaw !== undefined && seasonRaw !== null) {
    if (typeof seasonRaw !== "number" || !Number.isInteger(seasonRaw) || seasonRaw < 0) {
      return err("validation_failed", "dados invalidos.", [
        "seasonNumber deve ser um inteiro >= 0.",
      ]);
    }
    seasonNumber = seasonRaw;
  }

  const especiais = record.value["includeSpecials"];
  if (especiais !== undefined && typeof especiais !== "boolean") {
    return err("validation_failed", "dados invalidos.", [
      "includeSpecials deve ser booleano.",
    ]);
  }

  return ok({
    tvShowId: tvShowId.value,
    seasonNumber,
    watched,
    // Politica EXPLICITA: especiais ficam de fora quando o cliente nao pede.
    includeSpecials: especiais === true,
  });
}

export interface ListWriteCommand {
  readonly title: string;
  readonly description: string | null;
  readonly visibility: Visibility;
  readonly ordered: boolean;
}

export function parseListWriteCommand(input: unknown): DomainResult<ListWriteCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, [
    "title",
    "description",
    "visibility",
    "ordered",
  ]);
  if (!strict.ok) return strict;

  const title = requireString(record.value, "title", {
    trim: true,
    max: LIST_LIMITS.maxTitleLength,
  });
  if (!title.ok) return title;

  const description = optionalString(record.value, "description", {
    trim: true,
    max: LIST_LIMITS.maxDescriptionLength,
  });
  if (!description.ok) return description;

  const visibility = record.value["visibility"];
  if (
    visibility !== undefined &&
    (typeof visibility !== "string" || !(VISIBILITIES as readonly string[]).includes(visibility))
  ) {
    return err("validation_failed", "dados invalidos.", [
      `visibility deve ser um de: ${VISIBILITIES.join(", ")}.`,
    ]);
  }

  const ordered = record.value["ordered"];
  if (ordered !== undefined && typeof ordered !== "boolean") {
    return err("validation_failed", "dados invalidos.", ["ordered deve ser booleano."]);
  }

  return ok({
    title: title.value,
    description: description.value ?? null,
    // Default CONSERVADOR: nasce privada.
    visibility: (visibility as Visibility | undefined) ?? "private",
    ordered: ordered === true,
  });
}

export interface AddListItemCommand {
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly note: string | null;
}

export function parseAddListItemCommand(input: unknown): DomainResult<AddListItemCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["entityType", "entityId", "note"]);
  if (!strict.ok) return strict;

  const ref = requireEntityRef(record.value, RATABLE_ENTITY_TYPES);
  if (!ref.ok) return ref;

  const note = optionalString(record.value, "note", {
    trim: true,
    max: LIST_LIMITS.maxNoteLength,
  });
  if (!note.ok) return note;

  return ok({ ...ref.value, note: note.value ?? null });
}

export type ReorderCommand =
  | { readonly kind: "move"; readonly itemId: bigint; readonly toPosition: number }
  | { readonly kind: "full"; readonly itemIds: readonly bigint[] };

export function parseReorderCommand(input: unknown): DomainResult<ReorderCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["itemId", "toPosition", "itemIds"]);
  if (!strict.ok) return strict;

  const itemIds = record.value["itemIds"];
  if (Array.isArray(itemIds)) {
    if (itemIds.length > LIST_LIMITS.maxItemsPerList) {
      return err("validation_failed", "dados invalidos.", [
        `a lista aceita no maximo ${LIST_LIMITS.maxItemsPerList} itens.`,
      ]);
    }
    const ids: bigint[] = [];
    for (const raw of itemIds) {
      if (typeof raw !== "string") {
        return err("validation_failed", "dados invalidos.", ["itemIds deve conter ids em texto."]);
      }
      const id = parseEntityId(raw);
      if (!id.ok) return id;
      ids.push(id.value);
    }
    return ok({ kind: "full", itemIds: ids });
  }

  const itemRaw = requireString(record.value, "itemId", { trim: true, max: 20 });
  if (!itemRaw.ok) return itemRaw;
  const itemId = parseEntityId(itemRaw.value);
  if (!itemId.ok) return itemId;

  const toPosition = record.value["toPosition"];
  if (typeof toPosition !== "number" || !Number.isInteger(toPosition) || toPosition < 0) {
    return err("validation_failed", "dados invalidos.", [
      "toPosition deve ser um inteiro >= 0.",
    ]);
  }

  return ok({ kind: "move", itemId: itemId.value, toPosition });
}

export interface SetRatingCommand {
  readonly entityType: RatableEntityType;
  readonly entityId: bigint;
  readonly value: number;
}

export function parseSetRatingCommand(input: unknown): DomainResult<SetRatingCommand> {
  const record = asRecord(input);
  if (!record.ok) return record;
  const strict = rejectUnknownKeys(record.value, ["entityType", "entityId", "value"]);
  if (!strict.ok) return strict;

  const ref = requireEntityRef(record.value, RATABLE_ENTITY_TYPES);
  if (!ref.ok) return ref;

  const value = record.value["value"];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return err("validation_failed", "dados invalidos.", ["value deve ser numerico."]);
  }
  return ok({ ...ref.value, value });
}
