/**
 * Testes do TRACKER (C8): episodio, temporada, serie inteira, progresso,
 * proximo episodio, politica de especiais e a serie GIGANTE.
 */

import { describe, expect, it } from "vitest";
import {
  markSeriesEpisodes,
  readSeriesProgress,
  setEpisodeWatched,
} from "../tracker-services.js";
import { createTestRuntime, seedUser } from "./fakes.js";
import { seedSeries } from "./library-fakes.js";
import type { AuthenticatedContext } from "../deps.js";

function auth(userId: bigint): AuthenticatedContext {
  return {
    userId,
    sessionId: 1n,
    userStatus: "active",
    csrfTokenHash: "c".repeat(64),
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const TV = 900n;

describe("setEpisodeWatched", () => {
  it("(1) marca, desmarca e e idempotente", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const eps = seedSeries(rt.db, { tvShowId: TV, seasons: 1, episodesPerSeason: 3 });

    const marcado = await setEpisodeWatched(rt.deps, auth(userId), {
      episodeId: eps[0]!,
      tvShowId: TV,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-marcar-0001",
      expectedVersion: null,
    });
    expect(marcado.ok).toBe(true);
    expect(rt.db.episodeProgress.filter((p) => p.watched)).toHaveLength(1);

    // Repetir a MESMA operacao nao cria segundo evento (unique do diario).
    await setEpisodeWatched(rt.deps, auth(userId), {
      episodeId: eps[0]!,
      tvShowId: TV,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-marcar-0001",
      expectedVersion: null,
    });
    expect(rt.db.viewingEvents.filter((e) => e.eventType === "episode_watched")).toHaveLength(1);

    const desmarcado = await setEpisodeWatched(rt.deps, auth(userId), {
      episodeId: eps[0]!,
      tvShowId: TV,
      watched: false,
      watchedAt: null,
      idempotencyKey: "op-desmarcar-001",
      expectedVersion: 1,
    });
    expect(desmarcado.ok).toBe(true);
    expect(rt.db.episodeProgress.filter((p) => p.watched)).toHaveLength(0);
  });

  it("(2) episodio inexistente => not_found (a FK nunca chega a explodir)", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedSeries(rt.db, { tvShowId: TV, seasons: 1, episodesPerSeason: 1 });

    const r = await setEpisodeWatched(rt.deps, auth(userId), {
      episodeId: 999_999n,
      tvShowId: TV,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-inexistente-01",
      expectedVersion: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_found");
  });

  it("(3) marcar TODOS os episodios promove a serie a `watched` (derivacao)", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const eps = seedSeries(rt.db, { tvShowId: TV, seasons: 1, episodesPerSeason: 2 });

    for (const [i, ep] of eps.entries()) {
      await setEpisodeWatched(rt.deps, auth(userId), {
        episodeId: ep,
        tvShowId: TV,
        watched: true,
        watchedAt: null,
        idempotencyKey: `op-serie-${String(i).padStart(8, "0")}`,
        expectedVersion: null,
      });
    }
    const serie = rt.db.watchStates.find((w) => w.entityType === "tv" && w.entityId === TV);
    expect(serie?.status).toBe("watched");
  });
});

describe("markSeriesEpisodes (operacao em massa)", () => {
  it("(1) marca a temporada inteira e e IDEMPOTENTE na repeticao", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedSeries(rt.db, { tvShowId: TV, seasons: 2, episodesPerSeason: 5 });

    const primeira = await markSeriesEpisodes(rt.deps, auth(userId), {
      tvShowId: TV,
      seasonNumber: 1,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-temporada-0001",
    });
    expect(primeira.ok).toBe(true);
    if (!primeira.ok) return;
    expect(primeira.value.episodesConsidered).toBe(5);
    expect(primeira.value.created).toBe(5);

    // Repetir: zero criacao, zero atualizacao (cada lote e idempotente).
    const segunda = await markSeriesEpisodes(rt.deps, auth(userId), {
      tvShowId: TV,
      seasonNumber: 1,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-temporada-0002",
    });
    expect(segunda.ok).toBe(true);
    if (!segunda.ok) return;
    expect(segunda.value.created).toBe(0);
    expect(segunda.value.updated).toBe(0);
  });

  it("(2) ESPECIAIS ficam de fora por padrao e entram quando pedido", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    // 1 temporada normal (3 eps) + temporada 0 (3 especiais).
    seedSeries(rt.db, { tvShowId: TV, seasons: 1, episodesPerSeason: 3, withSpecials: true });

    const semEspeciais = await markSeriesEpisodes(rt.deps, auth(userId), {
      tvShowId: TV,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-sem-especiais1",
    });
    expect(semEspeciais.ok).toBe(true);
    if (!semEspeciais.ok) return;
    expect(semEspeciais.value.episodesConsidered).toBe(3);

    const comEspeciais = await markSeriesEpisodes(rt.deps, auth(userId), {
      tvShowId: TV,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      includeSpecials: true,
      idempotencyKey: "op-com-especiais1",
    });
    expect(comEspeciais.ok).toBe(true);
    if (!comEspeciais.ok) return;
    expect(comEspeciais.value.episodesConsidered).toBe(6);
    // Os 3 normais ja estavam marcados: so os especiais sao criados.
    expect(comEspeciais.value.created).toBe(3);
  });

  it("(3) SERIE GIGANTE: 21.000 episodios em UMA operacao", async () => {
    // Reproduz a ordem de grandeza real do catalogo (`Tagesschau`).
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedSeries(rt.db, { tvShowId: TV, seasons: 21, episodesPerSeason: 1000 });
    expect(rt.db.episodes).toHaveLength(21_000);

    const inicio = Date.now();
    const r = await markSeriesEpisodes(rt.deps, auth(userId), {
      tvShowId: TV,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-serie-gigante1",
    });
    const duracao = Date.now() - inicio;

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.episodesConsidered).toBe(21_000);
    expect(r.value.created).toBe(21_000);
    // Guarda de sanidade: uma implementacao obviamente inviavel estoura isto.
    expect(duracao).toBeLessThan(30_000);

    // A INVARIANTE QUE IMPORTA: o numero de eventos de diario e CONSTANTE,
    // independente do tamanho da serie. Uma implementacao ingenua (um evento
    // por episodio) produziria 21 mil aqui e passaria despercebida num
    // `toBeLessThan` frouxo — por isso a comparacao e contra uma serie pequena
    // submetida a MESMA operacao.
    const eventosSerieGigante = rt.db.viewingEvents.length;

    const rtPequena = createTestRuntime();
    const outroUser = seedUser(rtPequena.db, { emailNormalized: "b@c.test" });
    seedSeries(rtPequena.db, { tvShowId: TV, seasons: 1, episodesPerSeason: 2 });
    await markSeriesEpisodes(rtPequena.deps, auth(outroUser), {
      tvShowId: TV,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-serie-pequena1",
    });

    expect(eventosSerieGigante).toBe(rtPequena.db.viewingEvents.length);
    // E o valor absoluto continua pequeno (evento da operacao + derivacao).
    expect(eventosSerieGigante).toBeLessThanOrEqual(5);
  });
});

describe("readSeriesProgress", () => {
  it("(1) percentual DERIVADO e proximo episodio na ordem canonica", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const eps = seedSeries(rt.db, { tvShowId: TV, seasons: 2, episodesPerSeason: 2 });

    await setEpisodeWatched(rt.deps, auth(userId), {
      episodeId: eps[0]!,
      tvShowId: TV,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-progresso-0001",
      expectedVersion: null,
    });

    const p = await readSeriesProgress(rt.deps, auth(userId), { tvShowId: TV });
    expect(p.totalEpisodes).toBe(4);
    expect(p.watchedEpisodes).toBe(1);
    expect(p.percent).toBe(25);
    expect(p.completed).toBe(false);
    // Proximo = primeiro NAO marcado na ordem (temporada, episodio).
    expect(p.nextEpisode?.episodeId).toBe(eps[1]!);
  });

  it("(2) serie completa => sem proximo episodio (estado explicito)", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedSeries(rt.db, { tvShowId: TV, seasons: 1, episodesPerSeason: 2 });

    await markSeriesEpisodes(rt.deps, auth(userId), {
      tvShowId: TV,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-completa-00001",
    });

    const p = await readSeriesProgress(rt.deps, auth(userId), { tvShowId: TV });
    expect(p.completed).toBe(true);
    expect(p.percent).toBe(100);
    expect(p.nextEpisode).toBeNull();
  });

  it("(3) serie sem episodios nao divide por zero", async () => {
    const rt = createTestRuntime();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    const p = await readSeriesProgress(rt.deps, auth(userId), { tvShowId: 12345n });
    expect(p.totalEpisodes).toBe(0);
    expect(p.percent).toBe(0);
    expect(p.nextEpisode).toBeNull();
  });
});
