/**
 * SERVICOS DE APLICACAO da biblioteca pessoal (C8): watchlist, assistidos,
 * listas, itens, reordenacao, notas, historico e estatisticas.
 *
 * PRINCIPIO QUE GOVERNA ESTE ARQUIVO (missao §4): ACAO EXPLICITA DO USUARIO NAO
 * DEPENDE DE CONSENTIMENTO DE TRACKING OPCIONAL. Clicar em "quero assistir",
 * "assistido" ou "adicionar a lista" e o proprio produto — a biblioteca do
 * usuario nao pode ficar refem do aceite de analytics. Por isso NENHUMA funcao
 * aqui consulta `hasActiveConsent`. Telemetria comportamental (abrir pagina,
 * rolar, impressao de card) e outra coisa, vive em outra camada e continua
 * sujeita a consentimento.
 *
 * O que TODA mutacao verifica, sempre: `assertTrackingMutationAllowed` (conta
 * `active`) e ownership pelo `AuthenticatedContext` — nunca por id vindo do
 * corpo.
 */

import {
  applyWatchStateChange,
  buildUndo,
  type WatchStateSnapshot,
} from "../tracking/watch-state.js";
import { assertTrackingMutationAllowed } from "../tracking/policy.js";
import {
  LIST_LIMITS,
  canPublishList,
  slugifyListTitle,
  validateListCreate,
  validateListItemAdd,
} from "../lists/custom-lists.js";
import { SYSTEM_LISTS } from "../lists/system-lists.js";
import { planReorder, validateFullReorder } from "../lists/reorder.js";
import { SYSTEM_LIST_KEYS, type RatableEntityType, type SystemListKey, type WatchState, type WatchableEntityType } from "../core/types.js";
import { type DomainResult, err, ok } from "../core/result.js";
import type { AuthenticatedContext, AuthRuntimeDeps, LibraryStores } from "./deps.js";
import type { TransactionScope, UserListRecord, WatchStateRecord } from "../persistence/types.js";

/** Teto de itens por pagina — protege memoria e resposta. */
export const LIBRARY_PAGE_MAX = 100;

/** Numero de tentativas ao desambiguar slug de lista. */
const SLUG_ATTEMPTS = 20;

function clampLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) return 20;
  return Math.min(limit, LIBRARY_PAGE_MAX);
}

/**
 * Grava os eventos de diario de um plano de tracking.
 *
 * Cada evento carrega a `idempotencyKey` da OPERACAO; o unique
 * `(user_id, idempotency_key, event_type)` faz do replay um no-op. Duplicata
 * NAO e erro — e a resposta correta a um reenvio.
 */
async function appendEvents(
  stores: LibraryStores,
  scope: TransactionScope,
  input: {
    readonly userId: bigint;
    readonly entityType: RatableEntityType;
    readonly entityId: bigint;
    readonly events: ReadonlyArray<{ readonly eventType: string; readonly occurredAt: Date; readonly idempotencyKey: string }>;
    readonly source: string;
  },
): Promise<void> {
  for (const evento of input.events) {
    await stores.viewingEvents.append(scope, {
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: evento.eventType as never,
      occurredAt: evento.occurredAt,
      source: input.source,
      idempotencyKey: evento.idempotencyKey,
    });
  }
}

// ---------------------------------------------------------------------------
// Watch state (watchlist / assistido / acompanhando)
// ---------------------------------------------------------------------------

export interface SetWatchStateInput {
  readonly entityType: WatchableEntityType;
  readonly entityId: bigint;
  readonly status: WatchState;
  readonly idempotencyKey: string;
  /** `null` quando o cliente nao enviou Expected-Version. */
  readonly expectedVersion: number | null;
}

/**
 * Define o estado explicito do usuario sobre um filme/serie.
 *
 * `planned` e a watchlist, `watched` e o historico de assistidos — a mesma
 * operacao serve as duas, porque no modelo canonico elas sao o MESMO estado com
 * valores diferentes (ver a decisao de fonte canonica na documentacao).
 */
export async function setWatchState(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: SetWatchStateInput,
): Promise<DomainResult<WatchStateRecord>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const atual = await stores.watchStates.find(scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    const current: WatchStateSnapshot | null =
      atual.kind === "found"
        ? {
            status: atual.state.status,
            startedAt: atual.state.startedAt,
            completedAt: atual.state.completedAt,
            rewatchCount: atual.state.rewatchCount,
            version: atual.state.version,
          }
        : null;

    // O DOMINIO decide: carimbos nao-destrutivos, no-op quando nada muda,
    // eventos derivados e optimistic locking.
    const plano = applyWatchStateChange({
      current,
      target: input.status,
      now,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      accountStatus: authenticated.userStatus,
    });
    if (!plano.ok) {
      return plano;
    }

    // No-op: mesmo status, nenhum evento. Nao ha o que escrever.
    if (plano.value.events.length === 0 && current !== null) {
      return ok(atual.kind === "found" ? atual.state : (null as never));
    }

    const salvo = await stores.watchStates.upsert(scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      expectedVersion: current === null ? null : current.version,
      status: plano.value.next.status,
      startedAt: plano.value.next.startedAt,
      completedAt: plano.value.next.completedAt,
      rewatchCount: plano.value.next.rewatchCount,
      nextVersion: plano.value.next.version,
      now,
    });

    if (salvo.kind === "entity_not_found") {
      return err<WatchStateRecord>("not_found", "titulo nao encontrado no catalogo.");
    }
    if (salvo.kind === "conflict") {
      return err<WatchStateRecord>(
        "version_conflict",
        "este titulo mudou em outra aba. Recarregue e tente de novo.",
      );
    }

    await appendEvents(stores, scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      events: plano.value.events,
      source: "app",
    });

    return ok(salvo.state);
  });
}

/** Remove o estado (tirar da watchlist / desmarcar). Idempotente. */
export async function clearWatchState(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly entityType: WatchableEntityType; readonly entityId: bigint },
): Promise<DomainResult<{ readonly removed: boolean }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  return deps.runInLibraryTransaction(async (scope, stores) => {
    const r = await stores.watchStates.remove(scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    // Remover o que nao existe e sucesso: o estado desejado (ausencia) foi
    // alcancado, e devolver 404 faria a UI tratar um clique repetido como erro.
    return ok({ removed: r.removed });
  });
}

/** Le o estado de UMA entidade (para o botao da pagina de detalhe). */
export async function readWatchState(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly entityType: WatchableEntityType; readonly entityId: bigint },
): Promise<WatchStateRecord | null> {
  return deps.runInLibraryTransaction(async (scope, stores) => {
    const r = await stores.watchStates.find(scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    return r.kind === "found" ? r.state : null;
  });
}

/** Pagina a biblioteca por status (watchlist, assistidos, acompanhando...). */
export async function listWatchStates(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: {
    readonly statuses: readonly WatchState[];
    readonly entityTypes: readonly WatchableEntityType[];
    readonly limit: number;
    readonly offset: number;
  },
): Promise<{ readonly items: readonly WatchStateRecord[]; readonly total: number }> {
  return deps.runInLibraryTransaction((scope, stores) =>
    stores.watchStates.listByStatus(scope, {
      userId: authenticated.userId,
      statuses: input.statuses,
      entityTypes: input.entityTypes,
      limit: clampLimit(input.limit),
      offset: Math.max(0, input.offset),
    }),
  );
}

/** Desfaz o ultimo estado, gerando evento `undo` (o diario nunca perde linha). */
export async function undoWatchState(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: {
    readonly entityType: WatchableEntityType;
    readonly entityId: bigint;
    /**
     * Snapshot ANTERIOR a mudanca que se quer desfazer. `null` significa que
     * nao havia estado — desfazer devolve a entidade a inexistencia.
     *
     * Vem de quem chama (a UI guarda o estado que acabou de substituir), e nao
     * do banco: o registro atual e o estado NOVO, entao o banco nao sabe mais
     * qual era o anterior. O diario preserva a historia, mas reconstrui-la aqui
     * seria adivinhar.
     */
    readonly previous: WatchStateSnapshot | null;
    readonly idempotencyKey: string;
  },
): Promise<DomainResult<{ readonly undone: true }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const atual = await stores.watchStates.find(scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    if (atual.kind !== "found") {
      return err<{ readonly undone: true }>("not_found", "nao ha estado para desfazer.");
    }

    const plano = buildUndo({
      previous: input.previous,
      now,
      idempotencyKey: input.idempotencyKey,
      accountStatus: authenticated.userStatus,
    });
    if (!plano.ok) {
      return plano;
    }

    if (plano.value.next === null) {
      await stores.watchStates.remove(scope, {
        userId: authenticated.userId,
        entityType: input.entityType,
        entityId: input.entityId,
      });
    } else {
      const salvo = await stores.watchStates.upsert(scope, {
        userId: authenticated.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        expectedVersion: atual.state.version,
        status: plano.value.next.status,
        startedAt: plano.value.next.startedAt,
        completedAt: plano.value.next.completedAt,
        rewatchCount: plano.value.next.rewatchCount,
        nextVersion: plano.value.next.version,
        now,
      });
      if (salvo.kind === "conflict") {
        return err<{ readonly undone: true }>(
          "version_conflict",
          "este titulo mudou em outra aba. Recarregue e tente de novo.",
        );
      }
    }

    await appendEvents(stores, scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      events: plano.value.events,
      source: "app",
    });

    return ok({ undone: true as const });
  });
}

// ---------------------------------------------------------------------------
// Historico (diario)
// ---------------------------------------------------------------------------

/**
 * Historico do titular: SO consumo explicitamente registrado.
 *
 * Nao ha "paginas visitadas" aqui — isso e telemetria, vive noutra camada e
 * depende de consentimento. O diario e o que o usuario declarou ter assistido.
 */
export async function readHistory(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly limit: number; readonly offset: number },
) {
  return deps.runInLibraryTransaction((scope, stores) =>
    stores.viewingEvents.list(scope, {
      userId: authenticated.userId,
      eventTypes: null,
      limit: clampLimit(input.limit),
      offset: Math.max(0, input.offset),
    }),
  );
}

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

/** Garante as quatro listas de sistema do usuario, idempotentemente. */
export async function ensureSystemLists(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
): Promise<{ readonly created: number }> {
  return deps.runInLibraryTransaction((scope, stores) =>
    stores.lists.ensureSystemLists(scope, {
      ownerId: authenticated.userId,
      definitions: SYSTEM_LIST_KEYS.map((key: SystemListKey) => ({
        systemKey: key,
        title: SYSTEM_LISTS[key].titlePt,
        slug: SYSTEM_LISTS[key].slug,
      })),
    }),
  );
}

export interface CreateListInput {
  readonly title: string;
  readonly description: string | null;
  readonly visibility: string;
  readonly ordered: boolean;
}

/**
 * Cria uma lista customizada.
 *
 * O slug e desambiguado com sufixo numerico quando ja existe — inclusive
 * quando o ocupante e uma lista REMOVIDA (o unique `(owner_id, slug)` nao e
 * parcial em `deleted_at`). Reciclar o slug faria a lista nova herdar a URL da
 * antiga.
 */
export async function createList(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: CreateListInput,
): Promise<DomainResult<UserListRecord>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const total = await stores.lists.countCustomByOwner(scope, authenticated.userId);
    const validacao = validateListCreate(
      {
        title: input.title,
        description: input.description ?? undefined,
        visibility: input.visibility,
        ordered: input.ordered,
      },
      { currentCustomListCount: total },
    );
    if (!validacao.ok) {
      return err<UserListRecord>("validation_failed", "dados da lista invalidos.", validacao.errors);
    }

    const visibility = input.visibility as "private" | "unlisted" | "public";
    // Publicar exige e-mail verificado (antiabuso). O gate e do dominio.
    const publicavel = canPublishList({
      visibility,
      emailVerifiedAt: authenticated.emailVerifiedAt,
    });
    if (!publicavel.ok) {
      return publicavel;
    }

    const base = slugifyListTitle(input.title);
    for (let tentativa = 0; tentativa < SLUG_ATTEMPTS; tentativa += 1) {
      const slug = tentativa === 0 ? base : `${base}-${tentativa + 1}`;
      const criada = await stores.lists.create(scope, {
        ownerId: authenticated.userId,
        title: input.title.trim(),
        slug,
        description: input.description,
        visibility,
        ordered: input.ordered,
      });
      if (criada.kind === "created") {
        return ok(criada.list);
      }
    }
    return err<UserListRecord>("conflict", "nao foi possivel gerar um endereco unico para a lista.");
  });
}

/**
 * Autoriza o acesso a uma lista. ESTE e o unico ponto de ownership de listas.
 *
 * Nao basta conhecer o id: `list.ownerId` tem de ser o titular da sessao. A
 * mensagem e a MESMA para "nao existe" e "nao e sua" — distinguir permitiria
 * descobrir quais ids existem.
 */
async function authorizeList(
  stores: LibraryStores,
  scope: TransactionScope,
  authenticated: AuthenticatedContext,
  listId: bigint,
): Promise<DomainResult<UserListRecord>> {
  const lista = await stores.lists.findById(scope, listId);
  if (lista.kind !== "found" || lista.list.ownerId !== authenticated.userId) {
    return err<UserListRecord>("not_found", "lista nao encontrada.");
  }
  return ok(lista.list);
}

export async function listUserLists(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly limit: number; readonly offset: number },
) {
  return deps.runInLibraryTransaction((scope, stores) =>
    stores.lists.listByOwner(scope, {
      ownerId: authenticated.userId,
      limit: clampLimit(input.limit),
      offset: Math.max(0, input.offset),
    }),
  );
}

export async function readList(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly listId: bigint; readonly limit: number; readonly offset: number },
) {
  return deps.runInLibraryTransaction(async (scope, stores) => {
    const autorizada = await authorizeList(stores, scope, authenticated, input.listId);
    if (!autorizada.ok) {
      return autorizada;
    }
    const itens = await stores.listItems.list(scope, {
      listId: input.listId,
      limit: clampLimit(input.limit),
      offset: Math.max(0, input.offset),
    });
    return ok({ list: autorizada.value, items: itens.items, total: itens.total });
  });
}

export async function updateList(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly listId: bigint } & CreateListInput,
): Promise<DomainResult<UserListRecord>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const autorizada = await authorizeList(stores, scope, authenticated, input.listId);
    if (!autorizada.ok) {
      return autorizada;
    }
    if (autorizada.value.kind === "system") {
      return err<UserListRecord>("forbidden", "listas do sistema nao podem ser editadas.");
    }

    const validacao = validateListCreate(
      {
        title: input.title,
        description: input.description ?? undefined,
        visibility: input.visibility,
        ordered: input.ordered,
      },
      // A propria lista ja existe: o limite nao conta contra ela mesma.
      { currentCustomListCount: 0 },
    );
    if (!validacao.ok) {
      return err<UserListRecord>("validation_failed", "dados da lista invalidos.", validacao.errors);
    }

    const visibility = input.visibility as "private" | "unlisted" | "public";
    const publicavel = canPublishList({
      visibility,
      emailVerifiedAt: authenticated.emailVerifiedAt,
    });
    if (!publicavel.ok) {
      return publicavel;
    }

    const atualizada = await stores.lists.update(scope, {
      listId: input.listId,
      title: input.title.trim(),
      // Slug PRESERVADO: mudar o titulo nao muda o endereco. Trocar o slug
      // quebraria qualquer link que o proprio dono ja tenha guardado.
      slug: autorizada.value.slug,
      description: input.description,
      visibility,
      ordered: input.ordered,
      now,
    });
    return atualizada.kind === "found"
      ? ok(atualizada.list)
      : err<UserListRecord>("not_found", "lista nao encontrada.");
  });
}

export async function deleteList(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly listId: bigint },
): Promise<DomainResult<{ readonly removed: boolean }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const autorizada = await authorizeList(stores, scope, authenticated, input.listId);
    if (!autorizada.ok) {
      return autorizada;
    }
    if (autorizada.value.kind === "system") {
      return err<{ readonly removed: boolean }>(
        "forbidden",
        "listas do sistema nao podem ser removidas.",
      );
    }
    const r = await stores.lists.softDelete(scope, { listId: input.listId, now });
    return ok({ removed: r.removed });
  });
}

export async function addListItem(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: {
    readonly listId: bigint;
    readonly entityType: RatableEntityType;
    readonly entityId: bigint;
    readonly note: string | null;
  },
): Promise<DomainResult<{ readonly added: boolean }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const autorizada = await authorizeList(stores, scope, authenticated, input.listId);
    if (!autorizada.ok) {
      return autorizada;
    }

    const total = await stores.listItems.count(scope, input.listId);
    // `user_list_items` NAO tem CHECK de entity_type: esta validacao e a UNICA
    // guarda que impede um item de tipo invalido entrar na lista.
    const validacao = validateListItemAdd(
      { entityType: input.entityType, note: input.note ?? undefined },
      { currentItemCount: total },
    );
    if (!validacao.ok) {
      return err<{ readonly added: boolean }>(
        "validation_failed",
        "nao foi possivel adicionar o item.",
        validacao.errors,
      );
    }

    const r = await stores.listItems.add(scope, {
      listId: input.listId,
      entityType: input.entityType,
      entityId: input.entityId,
      // Ordenada: o item novo entra no FIM (posicao = total atual).
      position: autorizada.value.ordered ? total : null,
      note: input.note,
      now,
    });
    if (r.kind === "entity_not_found") {
      return err<{ readonly added: boolean }>("not_found", "titulo nao encontrado no catalogo.");
    }
    // `already_present` e sucesso idempotente.
    return ok({ added: r.kind === "added" });
  });
}

export async function removeListItem(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly listId: bigint; readonly itemId: bigint },
): Promise<DomainResult<{ readonly removed: boolean }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  return deps.runInLibraryTransaction(async (scope, stores) => {
    const autorizada = await authorizeList(stores, scope, authenticated, input.listId);
    if (!autorizada.ok) {
      return autorizada;
    }
    const r = await stores.listItems.remove(scope, {
      listId: input.listId,
      itemId: input.itemId,
    });
    return ok({ removed: r.removed });
  });
}

/**
 * Reordena a lista.
 *
 * Aceita as DUAS formas que a UI produz: mover um item para uma posicao
 * (`moveItemId`/`toPosition`) ou enviar a ordem completa. Nos dois casos o
 * dominio devolve posicoes contiguas 0..n-1 para TODOS os itens, e a aplicacao
 * acontece em UMA transacao.
 */
export async function reorderList(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input:
    | { readonly listId: bigint; readonly kind: "move"; readonly itemId: bigint; readonly toPosition: number }
    | { readonly listId: bigint; readonly kind: "full"; readonly itemIds: readonly bigint[] },
): Promise<DomainResult<{ readonly updated: number }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const autorizada = await authorizeList(stores, scope, authenticated, input.listId);
    if (!autorizada.ok) {
      return autorizada;
    }

    const ordemAtual = await stores.listItems.listOrderedIds(scope, input.listId);

    const posicoes =
      input.kind === "move"
        ? planReorder({
            orderedItemIds: ordemAtual,
            moveItemId: input.itemId,
            toPosition: input.toPosition,
          })
        : (() => {
            const validacao = validateFullReorder({
              currentItemIds: ordemAtual,
              proposedItemIds: input.itemIds,
            });
            if (!validacao.ok) {
              return err<ReadonlyArray<{ readonly itemId: bigint; readonly position: number }>>(
                "validation_failed",
                "ordem proposta invalida.",
                validacao.errors,
              );
            }
            return ok(input.itemIds.map((itemId, index) => ({ itemId, position: index })));
          })();

    if (!posicoes.ok) {
      return posicoes;
    }

    const r = await stores.listItems.applyPositions(scope, {
      listId: input.listId,
      positions: posicoes.value,
      now,
    });
    return ok({ updated: r.updated });
  });
}

// ---------------------------------------------------------------------------
// Nota pessoal
// ---------------------------------------------------------------------------

/**
 * Define a nota pessoal (0.5..5.0, passo 0.5).
 *
 * NUNCA se mistura com nota externa: nao tem `rating_source`, nao vira
 * `AggregateRating`, nao entra no Cinerie Score (invariantes 1 e 2).
 */
export async function setRating(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly entityType: RatableEntityType; readonly entityId: bigint; readonly value: number },
): Promise<DomainResult<{ readonly value: number }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  // Grade do banco: 0.5..5.0 em passo 0.5 (CHECK). Validar aqui produz mensagem
  // util em vez de deixar o CHECK abortar a transacao.
  const emGrade = Number.isFinite(input.value) && input.value * 2 === Math.floor(input.value * 2);
  if (!emGrade || input.value < 0.5 || input.value > 5) {
    return err("validation_failed", "nota invalida.", ["a nota vai de 0,5 a 5,0 em passos de 0,5"]);
  }
  const now = deps.now();

  return deps.runInLibraryTransaction(async (scope, stores) => {
    const r = await stores.ratings.upsert(scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      value: input.value,
      now,
    });
    if (r.kind === "entity_not_found") {
      return err<{ readonly value: number }>("not_found", "titulo nao encontrado no catalogo.");
    }
    return ok({ value: r.rating.value });
  });
}

export async function clearRating(
  deps: AuthRuntimeDeps,
  authenticated: AuthenticatedContext,
  input: { readonly entityType: RatableEntityType; readonly entityId: bigint },
): Promise<DomainResult<{ readonly removed: boolean }>> {
  const permitido = assertTrackingMutationAllowed(authenticated.userStatus);
  if (!permitido.ok) {
    return permitido;
  }
  return deps.runInLibraryTransaction(async (scope, stores) => {
    const r = await stores.ratings.remove(scope, {
      userId: authenticated.userId,
      entityType: input.entityType,
      entityId: input.entityId,
    });
    return ok({ removed: r.removed });
  });
}
