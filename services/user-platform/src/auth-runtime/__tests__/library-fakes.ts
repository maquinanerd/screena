/**
 * Dubles em memoria dos stores de BIBLIOTECA (C8).
 *
 * Nao sao mocks de conveniencia: reproduzem as PRE-CONDICOES que os adapters
 * Prisma aplicam no banco — uniques `(user, entidade)` e `(user, episodio)`,
 * compare-and-swap sobre `version`, idempotencia do diario por
 * `(user, idempotencyKey, eventType)`, sonda de existencia em `entities`, soft
 * delete de lista e CAS de status do job de importacao.
 *
 * Um duble mais frouxo faria os testes passarem com uma composicao que o
 * Postgres reprovaria — que e exatamente o que o validador de PostgreSQL real
 * existe para pegar, e que estes dubles existem para nao deixar chegar la.
 *
 * Este arquivo nao termina em `.test.ts`: o vitest nao o coleta como suite.
 */

import type {
  CatalogReadStore,
  EpisodeProgressStore,
  ImportJobStore,
  UserListItemStore,
  UserListStore,
  UserRatingStore,
  UserWatchStateStore,
  ViewingEventStore,
} from "../../persistence/ports.js";
import type { LibraryStores, LibraryTransactionRunner } from "../deps.js";
import type { TransactionScope } from "../../persistence/types.js";
import type { FakeDb } from "./fakes.js";

const SCOPE: TransactionScope = { transactional: true };

/** Semeia uma entidade de catalogo (alvo das FKs polimorficas). */
export function seedEntity(db: FakeDb, entityType: string, entityId: bigint): void {
  if (!db.entities.some((e) => e.entityType === entityType && e.entityId === entityId)) {
    db.entities.push({ entityType, entityId });
  }
}

/**
 * Semeia um titulo de catalogo (filme/serie) para o matching de importacao, e
 * ja registra a entidade — o import precisa das duas coisas: casar por
 * tmdb/titulo E que a entidade exista para a escrita passar pela sonda.
 */
export function seedCatalogTitle(
  db: FakeDb,
  input: {
    readonly entityType: "movie" | "tv";
    readonly entityId: bigint;
    readonly title: string;
    readonly year: number | null;
    readonly tmdbId?: number | null;
    readonly imdbId?: string | null;
  },
): void {
  seedEntity(db, input.entityType, input.entityId);
  db.catalogTitles.push({
    entityType: input.entityType,
    entityId: input.entityId,
    title: input.title,
    year: input.year,
    tmdbId: input.tmdbId ?? null,
    imdbId: input.imdbId ?? null,
  });
}

/**
 * Semeia uma serie com N episodios distribuidos em temporadas.
 *
 * `specials` cria a temporada 0, para que a politica de especiais possa ser
 * provada nos DOIS sentidos (incluindo e excluindo).
 */
export function seedSeries(
  db: FakeDb,
  input: {
    readonly tvShowId: bigint;
    readonly seasons: number;
    readonly episodesPerSeason: number;
    readonly runtimeMinutes?: number | null;
    readonly withSpecials?: boolean;
  },
): bigint[] {
  seedEntity(db, "tv", input.tvShowId);
  const criados: bigint[] = [];
  const temporadas = input.withSpecials === true ? [0, ...range(1, input.seasons)] : range(1, input.seasons);

  for (const seasonNumber of temporadas) {
    for (let ep = 1; ep <= input.episodesPerSeason; ep += 1) {
      const episodeId = db.nextId;
      db.nextId += 1n;
      db.episodes.push({
        episodeId,
        tvShowId: input.tvShowId,
        seasonId: BigInt(seasonNumber + 1),
        seasonNumber,
        episodeNumber: ep,
        airDate: null,
        runtimeMinutes: input.runtimeMinutes ?? 45,
      });
      seedEntity(db, "episode", episodeId);
      criados.push(episodeId);
    }
  }
  return criados;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

/** Monta os oito stores de biblioteca sobre o `FakeDb`. */
export function createFakeLibraryStores(db: FakeDb): LibraryStores {
  const agora = (): Date => new Date("2026-07-24T12:00:00.000Z");

  const watchStates: UserWatchStateStore = {
    async find(_s, input) {
      const row = db.watchStates.find(
        (w) =>
          w.userId === input.userId &&
          w.entityType === input.entityType &&
          w.entityId === input.entityId,
      );
      return row === undefined
        ? { kind: "not_found" }
        : { kind: "found", state: { ...row, visibility: "private" as const } };
    },
    async upsert(_s, input) {
      const existe = db.entities.some(
        (e) => e.entityType === input.entityType && e.entityId === input.entityId,
      );
      if (!existe) return { kind: "entity_not_found" };

      const idx = db.watchStates.findIndex(
        (w) =>
          w.userId === input.userId &&
          w.entityType === input.entityType &&
          w.entityId === input.entityId,
      );

      if (input.expectedVersion === null) {
        if (idx >= 0) {
          return {
            kind: "conflict",
            conflict: { reason: "unique_violation", target: "watchState.entity" },
          };
        }
        const row = {
          userId: input.userId,
          entityType: input.entityType,
          entityId: input.entityId,
          status: input.status,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
          lastActivityAt: input.now,
          rewatchCount: input.rewatchCount,
          version: input.nextVersion,
          updatedAt: input.now,
        };
        db.watchStates.push(row);
        return { kind: "saved", state: { ...row, visibility: "private" as const } };
      }

      // CAS sobre `version` — igual ao adapter real.
      if (idx < 0 || db.watchStates[idx]!.version !== input.expectedVersion) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "watchState.version" },
        };
      }
      const row = db.watchStates[idx]!;
      row.status = input.status;
      row.startedAt = input.startedAt;
      row.completedAt = input.completedAt;
      row.rewatchCount = input.rewatchCount;
      row.version = input.nextVersion;
      row.lastActivityAt = input.now;
      row.updatedAt = input.now;
      return { kind: "saved", state: { ...row, visibility: "private" as const } };
    },
    async remove(_s, input) {
      const antes = db.watchStates.length;
      const restantes = db.watchStates.filter(
        (w) =>
          !(
            w.userId === input.userId &&
            w.entityType === input.entityType &&
            w.entityId === input.entityId
          ),
      );
      db.watchStates.length = 0;
      db.watchStates.push(...restantes);
      return { removed: db.watchStates.length < antes };
    },
    async listByStatus(_s, input) {
      const todos = db.watchStates.filter(
        (w) =>
          w.userId === input.userId &&
          (input.statuses.length === 0 || input.statuses.includes(w.status)) &&
          (input.entityTypes.length === 0 || input.entityTypes.includes(w.entityType)),
      );
      const ordenados = [...todos].sort(
        (a, b) =>
          b.lastActivityAt.getTime() - a.lastActivityAt.getTime() ||
          Number(b.entityId - a.entityId),
      );
      return {
        items: ordenados
          .slice(input.offset, input.offset + input.limit)
          .map((w) => ({ ...w, visibility: "private" as const })),
        total: todos.length,
      };
    },
    async countByStatus(_s, userId) {
      const mapa = new Map<string, number>();
      for (const w of db.watchStates.filter((x) => x.userId === userId)) {
        const chave = `${w.status}|${w.entityType}`;
        mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
      }
      return [...mapa.entries()].map(([chave, count]) => {
        const [status, entityType] = chave.split("|");
        return {
          status: status as never,
          entityType: entityType as "movie" | "tv",
          count,
        };
      });
    },
  };

  const episodeProgress: EpisodeProgressStore = {
    async find(_s, input) {
      const row = db.episodeProgress.find(
        (p) => p.userId === input.userId && p.episodeId === input.episodeId,
      );
      return row === undefined ? { kind: "not_found" } : { kind: "found", progress: { ...row } };
    },
    async upsert(_s, input) {
      if (!db.episodes.some((e) => e.episodeId === input.episodeId)) {
        return { kind: "episode_not_found" };
      }
      const idx = db.episodeProgress.findIndex(
        (p) => p.userId === input.userId && p.episodeId === input.episodeId,
      );
      if (input.expectedVersion === null) {
        if (idx >= 0) {
          return {
            kind: "conflict",
            conflict: { reason: "unique_violation", target: "episodeProgress.episode" },
          };
        }
        const row = {
          userId: input.userId,
          episodeId: input.episodeId,
          watched: input.watched,
          watchedAt: input.watchedAt,
          progressSeconds: input.progressSeconds,
          durationSeconds: input.durationSeconds,
          version: input.nextVersion,
          updatedAt: input.now,
        };
        db.episodeProgress.push(row);
        return { kind: "saved", progress: { ...row } };
      }
      if (idx < 0 || db.episodeProgress[idx]!.version !== input.expectedVersion) {
        return {
          kind: "conflict",
          conflict: { reason: "stale_preimage", target: "episodeProgress.version" },
        };
      }
      const row = db.episodeProgress[idx]!;
      row.watched = input.watched;
      row.watchedAt = input.watchedAt;
      row.progressSeconds = input.progressSeconds;
      row.durationSeconds = input.durationSeconds;
      row.version = input.nextVersion;
      row.updatedAt = input.now;
      return { kind: "saved", progress: { ...row } };
    },
    async markBulk(_s, input) {
      let created = 0;
      let updated = 0;
      // INDICES, construidos UMA vez. Antes, cada episodio varria `db.episodes`
      // inteiro e `db.episodeProgress` inteiro: com 21 mil episodios isso e
      // ~441 milhoes de comparacoes DENTRO DO DUBLE, e nao no codigo sob teste.
      // O `markBulk` real e UMA instrucao no banco; a lentidao era so do fake.
      const episodiosExistentes = new Set(db.episodes.map((e) => e.episodeId));
      const progressoPorEpisodio = new Map(
        db.episodeProgress
          .filter((p) => p.userId === input.userId)
          .map((p) => [p.episodeId, p] as const),
      );
      for (const episodeId of input.episodeIds) {
        if (!episodiosExistentes.has(episodeId)) continue;
        const existente = progressoPorEpisodio.get(episodeId);
        if (existente === undefined) {
          const nova = {
            userId: input.userId,
            episodeId,
            watched: input.watched,
            watchedAt: input.watched ? input.watchedAt : null,
            progressSeconds: null,
            durationSeconds: null,
            version: 1,
            updatedAt: input.now,
          };
          db.episodeProgress.push(nova);
          // O indice acompanha a escrita: ids repetidos na MESMA chamada nao
          // podem virar duas linhas (o `find` anterior tambem nao deixava).
          progressoPorEpisodio.set(episodeId, nova);
          created += 1;
          continue;
        }
        // IDEMPOTENTE: ja no alvo nao conta nem reescreve.
        if (existente.watched === input.watched) continue;
        existente.watched = input.watched;
        if (input.watched) existente.watchedAt = input.watchedAt;
        existente.version += 1;
        existente.updatedAt = input.now;
        updated += 1;
      }
      return { created, updated };
    },
    async countWatchedForSeries(_s, input) {
      // `Array.includes` dentro de `filter` e quadratico; o Set nao muda a
      // semantica e tira o custo que nao pertence ao codigo sob teste.
      const alvo = new Set(input.episodeIds);
      return {
        watched: db.episodeProgress.filter(
          (p) => p.userId === input.userId && p.watched && alvo.has(p.episodeId),
        ).length,
      };
    },
    async listWatchedIds(_s, input) {
      const alvo = new Set(input.episodeIds);
      return db.episodeProgress
        .filter((p) => p.userId === input.userId && p.watched && alvo.has(p.episodeId))
        .map((p) => p.episodeId);
    },
    async countWatchedTotal(_s, userId) {
      return db.episodeProgress.filter((p) => p.userId === userId && p.watched).length;
    },
  };

  const viewingEvents: ViewingEventStore = {
    async append(_s, input) {
      // Unique (user, idempotencyKey, eventType) — a base do replay seguro.
      const duplicado = db.viewingEvents.some(
        (e) =>
          e.userId === input.userId &&
          e.idempotencyKey === input.idempotencyKey &&
          e.eventType === input.eventType,
      );
      if (duplicado) return { kind: "duplicate" };
      const id = db.nextId;
      db.nextId += 1n;
      db.viewingEvents.push({ id, ...input });
      return { kind: "appended", eventId: id };
    },
    async list(_s, input) {
      const todos = db.viewingEvents.filter(
        (e) =>
          e.userId === input.userId &&
          (input.eventTypes === null ||
            input.eventTypes.length === 0 ||
            input.eventTypes.includes(e.eventType)),
      );
      const ordenados = [...todos].sort(
        (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || Number(b.id - a.id),
      );
      return {
        items: ordenados.slice(input.offset, input.offset + input.limit),
        total: todos.length,
      };
    },
  };

  const lists: UserListStore = {
    async create(_s, input) {
      // Unique (owner, slug) NAO parcial: lista removida ainda ocupa o slug.
      if (db.userLists.some((l) => l.ownerId === input.ownerId && l.slug === input.slug)) {
        return { kind: "conflict", conflict: { reason: "unique_violation", target: "userList.slug" } };
      }
      const id = db.nextId;
      db.nextId += 1n;
      const row = {
        id,
        ownerId: input.ownerId,
        kind: "custom" as const,
        systemKey: null,
        title: input.title,
        slug: input.slug,
        description: input.description,
        visibility: input.visibility,
        ordered: input.ordered,
        deletedAt: null,
        createdAt: agora(),
        updatedAt: agora(),
      };
      db.userLists.push(row);
      return { kind: "created", list: { ...row, itemCount: 0 } };
    },
    async findById(_s, listId) {
      const row = db.userLists.find((l) => l.id === listId && l.deletedAt === null);
      return row === undefined
        ? { kind: "not_found" }
        : {
            kind: "found",
            list: { ...row, itemCount: db.userListItems.filter((i) => i.listId === row.id).length },
          };
    },
    async listByOwner(_s, input) {
      const todos = db.userLists.filter((l) => l.ownerId === input.ownerId && l.deletedAt === null);
      return {
        items: todos.slice(input.offset, input.offset + input.limit).map((l) => ({
          ...l,
          itemCount: db.userListItems.filter((i) => i.listId === l.id).length,
        })),
        total: todos.length,
      };
    },
    async update(_s, input) {
      const row = db.userLists.find((l) => l.id === input.listId && l.deletedAt === null);
      if (row === undefined) return { kind: "not_found" };
      row.title = input.title;
      row.slug = input.slug;
      row.description = input.description;
      row.visibility = input.visibility;
      row.ordered = input.ordered;
      row.updatedAt = input.now;
      return {
        kind: "found",
        list: { ...row, itemCount: db.userListItems.filter((i) => i.listId === row.id).length },
      };
    },
    async softDelete(_s, input) {
      const row = db.userLists.find((l) => l.id === input.listId && l.deletedAt === null);
      if (row === undefined) return { removed: false };
      row.deletedAt = input.now;
      return { removed: true };
    },
    async countCustomByOwner(_s, ownerId) {
      return db.userLists.filter(
        (l) => l.ownerId === ownerId && l.kind === "custom" && l.deletedAt === null,
      ).length;
    },
    async ensureSystemLists(_s, input) {
      let created = 0;
      for (const def of input.definitions) {
        // Unique parcial (owner, system_key) WHERE system_key IS NOT NULL.
        const existe = db.userLists.some(
          (l) => l.ownerId === input.ownerId && l.systemKey === def.systemKey,
        );
        if (existe) continue;
        const id = db.nextId;
        db.nextId += 1n;
        db.userLists.push({
          id,
          ownerId: input.ownerId,
          kind: "system",
          systemKey: def.systemKey,
          title: def.title,
          slug: def.slug,
          description: null,
          visibility: "private",
          ordered: false,
          deletedAt: null,
          createdAt: agora(),
          updatedAt: agora(),
        });
        created += 1;
      }
      return { created };
    },
    async findSystemList(_s, input) {
      const row = db.userLists.find(
        (l) => l.ownerId === input.ownerId && l.systemKey === input.systemKey && l.deletedAt === null,
      );
      return row === undefined
        ? { kind: "not_found" }
        : {
            kind: "found",
            list: { ...row, itemCount: db.userListItems.filter((i) => i.listId === row.id).length },
          };
    },
  };

  const listItems: UserListItemStore = {
    async add(_s, input) {
      const existe = db.entities.some(
        (e) => e.entityType === input.entityType && e.entityId === input.entityId,
      );
      if (!existe) return { kind: "entity_not_found" };
      // Unique (list, entityType, entityId) — adicionar duas vezes e idempotente.
      const jaTem = db.userListItems.some(
        (i) =>
          i.listId === input.listId &&
          i.entityType === input.entityType &&
          i.entityId === input.entityId,
      );
      if (jaTem) return { kind: "already_present" };
      const id = db.nextId;
      db.nextId += 1n;
      const row = {
        id,
        listId: input.listId,
        entityType: input.entityType,
        entityId: input.entityId,
        position: input.position,
        note: input.note,
        addedAt: input.now,
      };
      db.userListItems.push(row);
      return { kind: "added", item: { ...row } };
    },
    async remove(_s, input) {
      const antes = db.userListItems.length;
      // `listId` no filtro: um item so e removido pela lista a que pertence.
      const restantes = db.userListItems.filter(
        (i) => !(i.id === input.itemId && i.listId === input.listId),
      );
      db.userListItems.length = 0;
      db.userListItems.push(...restantes);
      return { removed: db.userListItems.length < antes };
    },
    async list(_s, input) {
      const todos = ordenarItens(db, input.listId);
      return {
        items: todos.slice(input.offset, input.offset + input.limit).map((i) => ({ ...i })),
        total: todos.length,
      };
    },
    async listOrderedIds(_s, listId) {
      return ordenarItens(db, listId).map((i) => i.id);
    },
    async count(_s, listId) {
      return db.userListItems.filter((i) => i.listId === listId).length;
    },
    async applyPositions(_s, input) {
      let updated = 0;
      for (const p of input.positions) {
        const row = db.userListItems.find((i) => i.id === p.itemId && i.listId === input.listId);
        if (row === undefined) continue;
        row.position = p.position;
        updated += 1;
      }
      return { updated };
    },
  };

  const ratings: UserRatingStore = {
    async upsert(_s, input) {
      const existe = db.entities.some(
        (e) => e.entityType === input.entityType && e.entityId === input.entityId,
      );
      if (!existe) return { kind: "entity_not_found" };
      const row = db.userRatings.find(
        (r) =>
          r.userId === input.userId &&
          r.entityType === input.entityType &&
          r.entityId === input.entityId,
      );
      if (row === undefined) {
        const novo = {
          userId: input.userId,
          entityType: input.entityType,
          entityId: input.entityId,
          value: input.value,
          createdAt: input.now,
          updatedAt: input.now,
        };
        db.userRatings.push(novo);
        return { kind: "saved", rating: { ...novo, scale: 5 } };
      }
      row.value = input.value;
      row.updatedAt = input.now;
      return { kind: "saved", rating: { ...row, scale: 5 } };
    },
    async insertIfAbsent(_s, input) {
      const existe = db.entities.some(
        (e) => e.entityType === input.entityType && e.entityId === input.entityId,
      );
      if (!existe) return { kind: "entity_not_found" };
      const row = db.userRatings.find(
        (r) =>
          r.userId === input.userId &&
          r.entityType === input.entityType &&
          r.entityId === input.entityId,
      );
      if (row !== undefined) return { kind: "already_exists" };
      db.userRatings.push({
        userId: input.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        value: input.value,
        createdAt: input.now,
        updatedAt: input.now,
      });
      return { kind: "created" };
    },
    async remove(_s, input) {
      const antes = db.userRatings.length;
      const restantes = db.userRatings.filter(
        (r) =>
          !(
            r.userId === input.userId &&
            r.entityType === input.entityType &&
            r.entityId === input.entityId
          ),
      );
      db.userRatings.length = 0;
      db.userRatings.push(...restantes);
      return { removed: db.userRatings.length < antes };
    },
    async find(_s, input) {
      const row = db.userRatings.find(
        (r) =>
          r.userId === input.userId &&
          r.entityType === input.entityType &&
          r.entityId === input.entityId,
      );
      return row === undefined
        ? { kind: "not_found" }
        : { kind: "found", rating: { ...row, scale: 5 } };
    },
    async listByUser(_s, input) {
      const todos = db.userRatings.filter((r) => r.userId === input.userId);
      return {
        items: todos.slice(input.offset, input.offset + input.limit).map((r) => ({ ...r, scale: 5 })),
        total: todos.length,
      };
    },
  };

  const imports: ImportJobStore = {
    async create(_s, input) {
      const id = db.nextId;
      db.nextId += 1n;
      const row = {
        id,
        userId: input.userId,
        source: input.source,
        status: input.status,
        fileName: input.fileName,
        itemCount: 0,
        conflictCount: 0,
        appliedCount: 0,
        error: null,
        appliedAt: null,
        preview: null,
        conflicts: null,
        createdAt: agora(),
        updatedAt: agora(),
      };
      db.importJobs.push(row);
      return { kind: "created", job: { ...row } };
    },
    async findById(_s, jobId) {
      const row = db.importJobs.find((j) => j.id === jobId);
      return row === undefined
        ? { kind: "not_found" }
        : { kind: "found", job: { ...row }, preview: row.preview, conflicts: row.conflicts };
    },
    async listByUser(_s, input) {
      const todos = db.importJobs.filter((j) => j.userId === input.userId);
      return {
        items: todos.slice(input.offset, input.offset + input.limit).map((j) => ({ ...j })),
        total: todos.length,
      };
    },
    async transition(_s, input) {
      const row = db.importJobs.find((j) => j.id === input.id);
      if (row === undefined) return { kind: "not_found" };
      // CAS de status: trava dois `apply` concorrentes do mesmo job.
      if (row.status !== input.expectedStatus) {
        return { kind: "conflict", conflict: { reason: "stale_preimage", target: "importJob.status" } };
      }
      row.status = input.nextStatus;
      if (input.itemCount !== undefined) row.itemCount = input.itemCount;
      if (input.conflictCount !== undefined) row.conflictCount = input.conflictCount;
      if (input.appliedCount !== undefined) row.appliedCount = input.appliedCount;
      if (input.error !== undefined) row.error = input.error;
      if (input.appliedAt !== undefined) row.appliedAt = input.appliedAt;
      if (input.preview !== undefined) row.preview = input.preview;
      if (input.conflicts !== undefined) row.conflicts = input.conflicts;
      row.updatedAt = input.now;
      return { kind: "updated" };
    },
  };

  const catalog: CatalogReadStore = {
    async entityExists(_s, input) {
      return db.entities.some(
        (e) => e.entityType === input.entityType && e.entityId === input.entityId,
      );
    },
    async listSeriesEpisodes(_s, query) {
      const filtrados = db.episodes
        .filter((e) => e.tvShowId === query.tvShowId)
        .filter((e) =>
          query.seasonNumber !== null
            ? e.seasonNumber === query.seasonNumber
            : query.includeSpecials || e.seasonNumber > 0,
        )
        .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
      return filtrados.slice(query.offset, query.offset + query.limit).map((e) => ({ ...e }));
    },
    async countSeriesEpisodes(_s, input) {
      return db.episodes
        .filter((e) => e.tvShowId === input.tvShowId)
        .filter((e) =>
          input.seasonNumber !== null
            ? e.seasonNumber === input.seasonNumber
            : input.includeSpecials || e.seasonNumber > 0,
        ).length;
    },
    async findByExternalId(_s, input) {
      // Le o catalogo semeado via INDICE por tmdb/imdb (o schema real tem
      // unique nesses campos). O indice mantem a busca O(1) — sem ele, um
      // preview de milhares de linhas seria O(n^2) e o teste nao terminaria.
      const idx = catalogIndex(db);
      const porTmdb = input.tmdbId !== null ? idx.byTmdb.get(`${input.entityType}:${input.tmdbId}`) : undefined;
      const porImdb = input.imdbId !== null ? idx.byImdb.get(`${input.entityType}:${input.imdbId}`) : undefined;
      const encontrado = porTmdb ?? porImdb;
      return encontrado === undefined
        ? []
        : [
            {
              entityType: encontrado.entityType,
              entityId: encontrado.entityId,
              title: encontrado.title,
              year: encontrado.year,
              tmdbId: encontrado.tmdbId,
              imdbId: encontrado.imdbId,
            },
          ];
    },
    async findByTitle(_s, input) {
      // Indice por (tipo, titulo-normalizado, ano). Comparacao case-insensitive
      // como o adapter real (`mode: insensitive`).
      const idx = catalogIndex(db);
      const chave = `${input.entityType}:${input.title.toLowerCase()}:${input.year ?? ""}`;
      return (idx.byTitle.get(chave) ?? []).slice(0, input.limit).map((t) => ({
        entityType: t.entityType,
        entityId: t.entityId,
        title: t.title,
        year: t.year,
        tmdbId: t.tmdbId,
        imdbId: t.imdbId,
      }));
    },
    async sumMovieRuntime() {
      return { totalMinutes: 0, withRuntime: 0, withoutRuntime: 0 };
    },
    async sumEpisodeRuntime(_s, episodeIds) {
      const pedidos = new Set(episodeIds);
      const encontrados = db.episodes.filter((e) => pedidos.has(e.episodeId));
      const comRuntime = encontrados.filter((e) => e.runtimeMinutes !== null);
      return {
        totalMinutes: comRuntime.reduce((soma, e) => soma + (e.runtimeMinutes ?? 0), 0),
        withRuntime: comRuntime.length,
        withoutRuntime: encontrados.length - comRuntime.length,
      };
    },
  };

  return {
    watchStates,
    episodeProgress,
    viewingEvents,
    lists,
    listItems,
    ratings,
    imports,
    catalog,
  };
}

/**
 * Indice do catalogo de titulos, memoizado por comprimento do array.
 *
 * Reconstruir a cada lookup seria O(n) por chamada; memoizar enquanto o
 * catalogo nao cresce mantem o matching de um preview grande em O(n) total em
 * vez de O(n^2). A chave de invalidacao e o TAMANHO (o catalogo so cresce nos
 * testes, via seedCatalogTitle).
 */
type CatalogTitleRow = FakeDb["catalogTitles"][number];
interface CatalogIndex {
  readonly size: number;
  readonly byTmdb: Map<string, CatalogTitleRow>;
  readonly byImdb: Map<string, CatalogTitleRow>;
  readonly byTitle: Map<string, CatalogTitleRow[]>;
}
const catalogIndexCache = new WeakMap<FakeDb, CatalogIndex>();

function catalogIndex(db: FakeDb): CatalogIndex {
  const existente = catalogIndexCache.get(db);
  if (existente !== undefined && existente.size === db.catalogTitles.length) {
    return existente;
  }
  const byTmdb = new Map<string, CatalogTitleRow>();
  const byImdb = new Map<string, CatalogTitleRow>();
  const byTitle = new Map<string, CatalogTitleRow[]>();
  for (const t of db.catalogTitles) {
    if (t.tmdbId !== null) byTmdb.set(`${t.entityType}:${t.tmdbId}`, t);
    if (t.imdbId !== null) byImdb.set(`${t.entityType}:${t.imdbId}`, t);
    const chave = `${t.entityType}:${t.title.toLowerCase()}:${t.year ?? ""}`;
    const lista = byTitle.get(chave);
    if (lista === undefined) byTitle.set(chave, [t]);
    else lista.push(t);
  }
  const idx: CatalogIndex = { size: db.catalogTitles.length, byTmdb, byImdb, byTitle };
  catalogIndexCache.set(db, idx);
  return idx;
}

/** Ordem canonica dos itens: posicao (nulls last), depois entrada. */
function ordenarItens(db: FakeDb, listId: bigint) {
  return db.userListItems
    .filter((i) => i.listId === listId)
    .sort((a, b) => {
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      return pa - pb || a.addedAt.getTime() - b.addedAt.getTime() || Number(a.id - b.id);
    });
}

/** Runner de biblioteca com ROLLBACK real (snapshot/restore em excecao). */
export function createFakeLibraryRunner(db: FakeDb): LibraryTransactionRunner {
  return async <T>(
    work: (scope: TransactionScope, stores: LibraryStores) => Promise<T>,
  ): Promise<T> => {
    const snapshot = {
      watchStates: structuredClone(db.watchStates),
      episodeProgress: structuredClone(db.episodeProgress),
      viewingEvents: structuredClone(db.viewingEvents),
      userLists: structuredClone(db.userLists),
      userListItems: structuredClone(db.userListItems),
      userRatings: structuredClone(db.userRatings),
      importJobs: structuredClone(db.importJobs),
      nextId: db.nextId,
    };
    try {
      return await work(SCOPE, createFakeLibraryStores(db));
    } catch (error) {
      db.watchStates = snapshot.watchStates;
      db.episodeProgress = snapshot.episodeProgress;
      db.viewingEvents = snapshot.viewingEvents;
      db.userLists = snapshot.userLists;
      db.userListItems = snapshot.userListItems;
      db.userRatings = snapshot.userRatings;
      db.importJobs = snapshot.importJobs;
      db.nextId = snapshot.nextId;
      throw error;
    }
  };
}
