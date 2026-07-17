/**
 * Reordenacao de itens de lista — planejamento puro de posicoes.
 *
 * PURO: nao faz rede, DB nem IO. Este modulo apenas PLANEJA as novas
 * posicoes; a aplicacao e transacional no adapter (update em lote), que
 * tambem revalida ownership/versao na borda (request-guards).
 *
 * Contrato de posicoes: contiguas 0..n-1, sem buraco e sem duplicata —
 * sempre devolvidas para TODOS os itens da lista.
 */

import { type DomainResult, collect, err, ok, type ValidationResult } from "../core/result.js";

/** Posicao final planejada de um item apos a reordenacao. */
export interface ItemPosition {
  readonly itemId: bigint;
  readonly position: number;
}

/**
 * Constroi posicoes contiguas 0..n-1 a partir de uma ordem de itens.
 * Nao valida duplicatas — use validateFullReorder antes quando a ordem
 * vier do cliente.
 */
export function buildPositionsFromOrder(
  itemIds: ReadonlyArray<bigint>,
): ReadonlyArray<ItemPosition> {
  return itemIds.map((itemId, index) => ({ itemId, position: index }));
}

/**
 * Planeja o movimento de UM item para uma posicao alvo.
 *
 * Remove o item da ordem atual e insere na posicao alvo (clamp em 0..n-1),
 * devolvendo posicoes contiguas 0..n-1 para TODOS os itens. Item
 * inexistente = not_found; ordem corrompida (duplicata) ou posicao
 * nao-inteira = validation_failed.
 */
export function planReorder(input: {
  readonly orderedItemIds: ReadonlyArray<bigint>;
  readonly moveItemId: bigint;
  readonly toPosition: number;
}): DomainResult<ReadonlyArray<ItemPosition>> {
  const { orderedItemIds, moveItemId, toPosition } = input;

  if (new Set(orderedItemIds).size !== orderedItemIds.length) {
    return err("validation_failed", "ordem atual invalida.", [
      "orderedItemIds contem item duplicado.",
    ]);
  }

  if (!Number.isInteger(toPosition)) {
    return err("validation_failed", "posicao alvo invalida.", [
      "toPosition deve ser um inteiro.",
    ]);
  }

  const remaining = orderedItemIds.filter((id) => id !== moveItemId);
  if (remaining.length === orderedItemIds.length) {
    return err("not_found", "item nao encontrado nesta lista.");
  }

  // clamp da posicao alvo dentro de 0..n-1 (n = tamanho total da lista)
  const lastIndex = orderedItemIds.length - 1;
  const clamped = Math.min(Math.max(toPosition, 0), lastIndex);

  const reordered = [...remaining.slice(0, clamped), moveItemId, ...remaining.slice(clamped)];
  return ok(buildPositionsFromOrder(reordered));
}

/**
 * Valida uma reordenacao COMPLETA proposta pelo cliente contra o estado
 * atual: mesma cardinalidade, mesmos ids, sem duplicata. Acumula todas as
 * violacoes (estilo packages/schemas).
 */
export function validateFullReorder(input: {
  readonly currentItemIds: ReadonlyArray<bigint>;
  readonly proposedItemIds: ReadonlyArray<bigint>;
}): ValidationResult {
  const { currentItemIds, proposedItemIds } = input;
  const errors: string[] = [];

  if (proposedItemIds.length !== currentItemIds.length) {
    errors.push(
      `cardinalidade divergente: lista tem ${currentItemIds.length} itens, proposta tem ${proposedItemIds.length}.`,
    );
  }

  const proposedSet = new Set(proposedItemIds);
  if (proposedSet.size !== proposedItemIds.length) {
    errors.push("proposta contem item duplicado.");
  }

  const currentSet = new Set(currentItemIds);
  for (const id of proposedSet) {
    if (!currentSet.has(id)) {
      errors.push("proposta contem item que nao pertence a lista.");
      break;
    }
  }
  for (const id of currentSet) {
    if (!proposedSet.has(id)) {
      errors.push("proposta omite item existente da lista.");
      break;
    }
  }

  return collect(errors);
}
