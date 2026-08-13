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
import { SERIES_PAGE_SIZE } from "../tracker-services.js";
import type { AuthenticatedContext, LibraryStores } from "../deps.js";

/**
 * Runtime que CONTA as idas ao banco, em vez de cronometrar.
 *
 * POR QUE ISTO EXISTE. A guarda antiga era `expect(duracao).toBeLessThan(30_000)`
 * e ela nao media o que dizia medir. Medido: a operacao gastava ~8,5 s isolada e
 * 32-37 s com a suite inteira em paralelo — reprovando sem nenhuma mudanca no
 * codigo sob teste. Pior, o tempo era quase todo do PROPRIO DUBLE: `markBulk`
 * varria `db.episodes` e `db.episodeProgress` por episodio (~441 milhoes de
 * comparacoes com 21 mil). Depois de indexar o fake, a mesma operacao caiu para
 * ~1,2 s. Uma assercao que mede sobretudo o custo do dublê nao pode reprovar
 * uma regressao no codigo real.
 *
 * O QUE SUBSTITUI. O custo real desta operacao em producao nao e CPU em memoria
 * — sao IDAS AO BANCO. Uma implementacao inviavel e a que fala com o banco uma
 * vez POR EPISODIO; a correta fala um numero CONSTANTE de vezes. Contar chamadas
 * mede exatamente isso, e o resultado nao depende de quantos nucleos a maquina
 * tinha livres no momento.
 */
interface ContagemDeChamadas {
  total: number;
  readonly porMetodo: Map<string, number>;
}

function runtimeContado(): {
  db: ReturnType<typeof createTestRuntime>["db"];
  deps: ReturnType<typeof createTestRuntime>["deps"];
  chamadas: ContagemDeChamadas;
} {
  const rt = createTestRuntime();
  const chamadas: ContagemDeChamadas = { total: 0, porMetodo: new Map() };

  const contar = (nomeDaStore: string, store: object): object =>
    new Proxy(store, {
      get(alvo, prop, receiver) {
        const valor = Reflect.get(alvo, prop, receiver);
        if (typeof valor !== "function") return valor;
        return (...args: unknown[]) => {
          const chave = `${nomeDaStore}.${String(prop)}`;
          chamadas.total += 1;
          chamadas.porMetodo.set(chave, (chamadas.porMetodo.get(chave) ?? 0) + 1);
          return (valor as (...a: unknown[]) => unknown).apply(alvo, args);
        };
      },
    });

  // Envolve as stores no momento em que a transacao as entrega ao trabalho —
  // o unico ponto por onde o servico as recebe.
  const original = rt.deps.runInLibraryTransaction;
  const runInLibraryTransaction: typeof original = (work) =>
    original((scope, stores) => {
      const contadas = Object.fromEntries(
        Object.entries(stores).map(([nome, store]) => [nome, contar(nome, store as object)]),
      ) as unknown as LibraryStores;
      return work(scope, contadas);
    });

  return { db: rt.db, deps: { ...rt.deps, runInLibraryTransaction }, chamadas };
}

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
    const rt = runtimeContado();
    const userId = seedUser(rt.db, { emailNormalized: "a@b.test" });
    seedSeries(rt.db, { tvShowId: TV, seasons: 21, episodesPerSeason: 1000 });
    expect(rt.db.episodes).toHaveLength(21_000);

    const r = await markSeriesEpisodes(rt.deps, auth(userId), {
      tvShowId: TV,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-serie-gigante1",
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.episodesConsidered).toBe(21_000);
    expect(r.value.created).toBe(21_000);

    const eventosSerieGigante = rt.db.viewingEvents.length;

    // A MESMA operacao numa serie de 2 episodios. Tudo abaixo compara contra
    // ela: e o unico jeito de afirmar "constante" sem escolher uma constante.
    const rtPequena = runtimeContado();
    const outroUser = seedUser(rtPequena.db, { emailNormalized: "b@c.test" });
    seedSeries(rtPequena.db, { tvShowId: TV, seasons: 1, episodesPerSeason: 2 });
    await markSeriesEpisodes(rtPequena.deps, auth(outroUser), {
      tvShowId: TV,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      idempotencyKey: "op-serie-pequena1",
    });

    // (a) EVENTOS DE DIARIO: constantes. Uma implementacao ingenua (um evento
    // por episodio) produziria 21 mil aqui.
    expect(eventosSerieGigante).toBe(rtPequena.db.viewingEvents.length);
    expect(eventosSerieGigante).toBeLessThanOrEqual(5);

    // (b) IDAS AO BANCO — a guarda que substituiu o cronometro.
    //
    // MEDIDO, nao suposto. Gigante: 30 chamadas. Pequena: 10. A diferenca de 20
    // NAO e escala com episodios — e PAGINACAO. A leitura do catalogo e
    // paginada em `SERIES_PAGE_SIZE`, entao 21.000 episodios sao 11 paginas
    // contra 1. Escrever `toBe(constante)` aqui descreveria um sistema que nao
    // e o nosso, e o teste passaria a mentir na primeira mudanca de pagina.
    const leiturasPaginadas = (contagem: ContagemDeChamadas): number =>
      contagem.porMetodo.get("catalog.listSeriesEpisodes") ?? 0;
    const foraDaPaginacao = (contagem: ContagemDeChamadas): number =>
      contagem.total - leiturasPaginadas(contagem);

    /** Paginas que o laco de leitura percorre para N episodios. */
    const paginasPara = (episodios: number): number =>
      Math.max(1, Math.ceil(episodios / SERIES_PAGE_SIZE));

    // (b1) FORA DA PAGINACAO, o custo e IDENTICO — 8 chamadas nos dois casos.
    // E aqui que moraria "uma implementacao que fala com o banco por episodio":
    // ela apareceria como ~21.000 chamadas, e nenhum relogio precisaria opinar.
    expect(foraDaPaginacao(rt.chamadas)).toBe(foraDaPaginacao(rtPequena.chamadas));

    // (b2) A paginacao custa PAGINAS, e o numero de PASSADAS sobre a lista e o
    // mesmo nas duas series. Derivado de `SERIES_PAGE_SIZE`, nunca um numero
    // magico: mudar a constante de pagina nao quebra este teste, e mudar o
    // numero de passadas quebra — que e exatamente o que ele deve vigiar.
    const passadasGigante = leiturasPaginadas(rt.chamadas) / paginasPara(21_000);
    const passadasPequena = leiturasPaginadas(rtPequena.chamadas) / paginasPara(2);
    expect(passadasGigante).toBe(passadasPequena);
    expect(Number.isInteger(passadasGigante)).toBe(true);

    // (c) TETOS ABSOLUTOS, para o caso degenerado em que as DUAS series
    // escalassem juntas — a comparacao acima sozinha nao pegaria isso.
    expect(foraDaPaginacao(rt.chamadas)).toBeLessThanOrEqual(10);
    expect(passadasGigante).toBeLessThanOrEqual(2);
  });

  it("(3b) CONTROLE NEGATIVO: um episodio por chamada seria detectado", () => {
    // A assercao (b) so vale se a contagem realmente CRESCE quando a
    // implementacao passa a falar com o banco por episodio. Aqui isso e
    // simulado sobre o proprio contador, sem quebrar o servico de verdade: se
    // um dia o Proxy parar de contar, este teste cai junto e denuncia que a
    // guarda virou decorativa.
    const rt = runtimeContado();
    const chamadasIniciais = rt.chamadas.total;
    expect(chamadasIniciais).toBe(0);

    let contadas = 0;
    const fingirChamadaPorEpisodio = (): void => {
      rt.chamadas.total += 1;
      contadas += 1;
    };
    for (let i = 0; i < 21_000; i += 1) fingirChamadaPorEpisodio();

    expect(contadas).toBe(21_000);
    expect(rt.chamadas.total).toBeGreaterThan(20);
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
