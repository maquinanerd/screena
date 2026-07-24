/**
 * Testes da BIBLIOTECA PESSOAL (C8): watchlist, assistidos, listas, itens,
 * reordenacao, notas e — o mais importante — OWNERSHIP e a separacao entre
 * acao explicita e consentimento de tracking.
 */

import { describe, expect, it } from "vitest";
import {
  addListItem,
  clearWatchState,
  createList,
  deleteList,
  ensureSystemLists,
  listWatchStates,
  readList,
  removeListItem,
  reorderList,
  setRating,
  setWatchState,
  updateList,
} from "../library-services.js";
import { setConsent } from "../privacy-services.js";
import { createTestRuntime, seedUser } from "./fakes.js";
import { seedEntity } from "./library-fakes.js";
import type { AuthenticatedContext } from "../deps.js";

function auth(userId: bigint, over: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    userId,
    sessionId: 1n,
    userStatus: "active",
    csrfTokenHash: "c".repeat(64),
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

const FILME = 500n;

describe("watchlist e assistidos", () => {
  it("(1) adiciona a watchlist, le por status e remove (idempotente)", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedEntity(rt.db, "movie", FILME);

    const add = await setWatchState(rt.deps, auth(userId), {
      entityType: "movie",
      entityId: FILME,
      status: "planned",
      idempotencyKey: "op-watchlist-0001",
      expectedVersion: null,
    });
    expect(add.ok).toBe(true);

    const pagina = await listWatchStates(rt.deps, auth(userId), {
      statuses: ["planned"],
      entityTypes: [],
      limit: 10,
      offset: 0,
    });
    expect(pagina.total).toBe(1);

    const rm = await clearWatchState(rt.deps, auth(userId), {
      entityType: "movie",
      entityId: FILME,
    });
    expect(rm.ok).toBe(true);
    // Remover de novo continua sucesso: o estado desejado foi alcancado.
    const rm2 = await clearWatchState(rt.deps, auth(userId), {
      entityType: "movie",
      entityId: FILME,
    });
    expect(rm2.ok).toBe(true);
  });

  it("(2) entidade inexistente => not_found (sonda antes da FK)", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const r = await setWatchState(rt.deps, auth(userId), {
      entityType: "movie",
      entityId: 424242n,
      status: "planned",
      idempotencyKey: "op-inexistente-01",
      expectedVersion: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_found");
  });

  it("(3) OBRIGATORIO: acao explicita NAO depende de consentimento de tracking", async () => {
    // A biblioteca do usuario nao pode ficar refem do aceite de analytics.
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedEntity(rt.db, "movie", FILME);

    // Recusa EXPLICITA de analytics e de comunicacao.
    await setConsent(rt.deps, auth(userId), { kind: "analytics", granted: false }, {
      correlationId: "c",
      clientIpHash: null,
      userAgent: null,
    });
    await setConsent(rt.deps, auth(userId), { kind: "marketing_email", granted: false }, {
      correlationId: "c",
      clientIpHash: null,
      userAgent: null,
    });

    // Ainda assim: watchlist, assistido, lista e nota funcionam.
    expect(
      (
        await setWatchState(rt.deps, auth(userId), {
          entityType: "movie",
          entityId: FILME,
          status: "watched",
          idempotencyKey: "op-sem-consent-01",
          expectedVersion: null,
        })
      ).ok,
    ).toBe(true);

    expect((await setRating(rt.deps, auth(userId), { entityType: "movie", entityId: FILME, value: 4.5 })).ok).toBe(true);

    const lista = await createList(rt.deps, auth(userId), {
      title: "Favoritos de terror",
      description: null,
      visibility: "private",
      ordered: false,
    });
    expect(lista.ok).toBe(true);
  });

  it("(4) conta nao-active nao muta a biblioteca", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedEntity(rt.db, "movie", FILME);
    const r = await setWatchState(rt.deps, auth(userId, { userStatus: "pending_deletion" }), {
      entityType: "movie",
      entityId: FILME,
      status: "planned",
      idempotencyKey: "op-inelegivel-001",
      expectedVersion: null,
    });
    expect(r.ok).toBe(false);
  });
});

describe("listas", () => {
  it("(1) cria as listas de sistema idempotentemente", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    expect((await ensureSystemLists(rt.deps, auth(userId))).created).toBe(4);
    expect((await ensureSystemLists(rt.deps, auth(userId))).created).toBe(0);
  });

  it("(2) publicar exige e-mail verificado (gate antiabuso)", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const semVerificar = await createList(rt.deps, auth(userId, { emailVerifiedAt: null }), {
      title: "Publica",
      description: null,
      visibility: "public",
      ordered: false,
    });
    expect(semVerificar.ok).toBe(false);
    if (!semVerificar.ok) expect(semVerificar.error.code).toBe("forbidden");

    // Privada continua permitida sem verificacao.
    const privada = await createList(rt.deps, auth(userId, { emailVerifiedAt: null }), {
      title: "Privada",
      description: null,
      visibility: "private",
      ordered: false,
    });
    expect(privada.ok).toBe(true);
  });

  it("(3) slug e desambiguado quando ja existe", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const a = await createList(rt.deps, auth(userId), {
      title: "Clássicos",
      description: null,
      visibility: "private",
      ordered: false,
    });
    const b = await createList(rt.deps, auth(userId), {
      title: "Clássicos",
      description: null,
      visibility: "private",
      ordered: false,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.slug).toBe("classicos");
    expect(b.value.slug).toBe("classicos-2");
  });

  it("(4) OWNERSHIP: usuario A nao le, edita nem apaga lista de B", async () => {
    const rt = createTestRuntime();
    const dono = seedUser(rt.db, { emailNormalized: "dono@b.test" });
    const intruso = seedUser(rt.db, { emailNormalized: "intruso@b.test" });

    const lista = await createList(rt.deps, auth(dono), {
      title: "Privada do dono",
      description: null,
      visibility: "private",
      ordered: false,
    });
    expect(lista.ok).toBe(true);
    if (!lista.ok) return;
    const listId = lista.value.id;

    // Conhecer o id NAO basta: a mensagem e a mesma de "nao existe".
    const leitura = await readList(rt.deps, auth(intruso), { listId, limit: 10, offset: 0 });
    expect(leitura.ok).toBe(false);
    if (!leitura.ok) expect(leitura.error.code).toBe("not_found");

    const edicao = await updateList(rt.deps, auth(intruso), {
      listId,
      title: "invadida",
      description: null,
      visibility: "private",
      ordered: false,
    });
    expect(edicao.ok).toBe(false);

    const remocao = await deleteList(rt.deps, auth(intruso), { listId });
    expect(remocao.ok).toBe(false);

    // A lista do dono continua intacta.
    const doDono = await readList(rt.deps, auth(dono), { listId, limit: 10, offset: 0 });
    expect(doDono.ok).toBe(true);
    if (doDono.ok) expect(doDono.value.list.title).toBe("Privada do dono");
  });

  it("(5) listas de sistema nao podem ser editadas nem removidas", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    await ensureSystemLists(rt.deps, auth(userId));
    const sistema = rt.db.userLists.find((l) => l.kind === "system")!;

    const edicao = await updateList(rt.deps, auth(userId), {
      listId: sistema.id,
      title: "renomeada",
      description: null,
      visibility: "private",
      ordered: false,
    });
    expect(edicao.ok).toBe(false);

    const remocao = await deleteList(rt.deps, auth(userId), { listId: sistema.id });
    expect(remocao.ok).toBe(false);
  });
});

describe("itens e reordenacao", () => {
  async function listaComItens(rt: ReturnType<typeof createTestRuntime>, userId: bigint) {
    const lista = await createList(rt.deps, auth(userId), {
      title: "Ordenada",
      description: null,
      visibility: "private",
      ordered: true,
    });
    if (!lista.ok) throw new Error("falha ao criar lista no teste");
    const ids: bigint[] = [];
    for (const entityId of [10n, 11n, 12n]) {
      seedEntity(rt.db, "movie", entityId);
      await addListItem(rt.deps, auth(userId), {
        listId: lista.value.id,
        entityType: "movie",
        entityId,
        note: null,
      });
    }
    const itens = await readList(rt.deps, auth(userId), {
      listId: lista.value.id,
      limit: 10,
      offset: 0,
    });
    if (!itens.ok) throw new Error("falha ao ler lista no teste");
    ids.push(...itens.value.items.map((i) => i.id));
    return { listId: lista.value.id, itemIds: ids };
  }

  it("(1) adiciona (idempotente), remove e conta", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const { listId, itemIds } = await listaComItens(rt, userId);
    expect(itemIds).toHaveLength(3);

    // Adicionar o mesmo item de novo e sucesso idempotente, sem duplicar.
    seedEntity(rt.db, "movie", 10n);
    const repetido = await addListItem(rt.deps, auth(userId), {
      listId,
      entityType: "movie",
      entityId: 10n,
      note: null,
    });
    expect(repetido.ok).toBe(true);
    if (repetido.ok) expect(repetido.value.added).toBe(false);

    const rm = await removeListItem(rt.deps, auth(userId), { listId, itemId: itemIds[0]! });
    expect(rm.ok).toBe(true);
  });

  it("(2) mover item produz posicoes contiguas 0..n-1", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const { listId, itemIds } = await listaComItens(rt, userId);

    const r = await reorderList(rt.deps, auth(userId), {
      listId,
      kind: "move",
      itemId: itemIds[2]!,
      toPosition: 0,
    });
    expect(r.ok).toBe(true);

    const depois = await readList(rt.deps, auth(userId), { listId, limit: 10, offset: 0 });
    expect(depois.ok).toBe(true);
    if (!depois.ok) return;
    expect(depois.value.items.map((i) => i.id)).toEqual([itemIds[2], itemIds[0], itemIds[1]]);
    expect(depois.value.items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("(3) reordenacao completa invalida e recusada", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const { listId, itemIds } = await listaComItens(rt, userId);

    // Omite um item existente: cardinalidade divergente.
    const r = await reorderList(rt.deps, auth(userId), {
      listId,
      kind: "full",
      itemIds: [itemIds[0]!, itemIds[1]!],
    });
    expect(r.ok).toBe(false);
  });

  it("(4) OWNERSHIP: intruso nao adiciona nem reordena item em lista alheia", async () => {
    const rt = createTestRuntime();
    const dono = seedUser(rt.db, { emailNormalized: "dono@b.test" });
    const intruso = seedUser(rt.db, { emailNormalized: "intruso@b.test" });
    const { listId, itemIds } = await listaComItens(rt, dono);

    seedEntity(rt.db, "movie", 99n);
    const add = await addListItem(rt.deps, auth(intruso), {
      listId,
      entityType: "movie",
      entityId: 99n,
      note: null,
    });
    expect(add.ok).toBe(false);

    const reorder = await reorderList(rt.deps, auth(intruso), {
      listId,
      kind: "move",
      itemId: itemIds[0]!,
      toPosition: 2,
    });
    expect(reorder.ok).toBe(false);
  });
});

describe("nota pessoal", () => {
  it("(1) aceita a grade 0,5..5,0 e recusa fora dela", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedEntity(rt.db, "movie", FILME);

    expect((await setRating(rt.deps, auth(userId), { entityType: "movie", entityId: FILME, value: 4.5 })).ok).toBe(true);
    expect((await setRating(rt.deps, auth(userId), { entityType: "movie", entityId: FILME, value: 4.3 })).ok).toBe(false);
    expect((await setRating(rt.deps, auth(userId), { entityType: "movie", entityId: FILME, value: 0 })).ok).toBe(false);
    expect((await setRating(rt.deps, auth(userId), { entityType: "movie", entityId: FILME, value: 6 })).ok).toBe(false);
  });
});
