/**
 * Validador da BIBLIOTECA PESSOAL, do TRACKER e da IMPORTACAO (C8) contra
 * PostgreSQL 16 REAL, efemero e descartavel.
 *
 * Por que um banco de verdade, e nao os dubles em memoria (que ja provam a
 * logica): os pontos que decidem a corretude desta unidade so existem no
 * Postgres — o CHECK que limita `entity_type`, as FKs polimorficas para
 * `entities` com ON DELETE RESTRICT, o unique parcial das listas de sistema, o
 * unique de item por lista, o CHECK da grade de nota, o compare-and-swap sob
 * concorrencia real e o comportamento de uma serie com milhares de episodios.
 *
 * Cobre tambem as duas integracoes que so fazem sentido ponta a ponta: a
 * EXPORTACAO LGPD com os dados novos e o ENCERRAMENTO executando a retencao.
 *
 * Nada aqui toca banco de producao: sobe um PostgreSQL proprio numa porta
 * livre, aplica TODAS as migrations num database vazio e derruba tudo no fim.
 *
 * Uso: pnpm --filter @screena/user-platform validate:library
 */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";

import { buildLibraryDeps, seedMovie, seedSeries, seedUser } from "./_library-harness.js";
import {
  addListItem,
  clearWatchState,
  createList,
  deleteList,
  ensureSystemLists,
  listWatchStates,
  readList,
  reorderList,
  setRating,
  setWatchState,
} from "../src/auth-runtime/library-services.js";
import {
  markSeriesEpisodes,
  readSeriesProgress,
  setEpisodeWatched,
} from "../src/auth-runtime/tracker-services.js";
import { anonymizeAccount, requestDataExport } from "../src/auth-runtime/privacy-services.js";
import {
  applyImport,
  cancelImport,
  createImportPreview,
} from "../src/auth-runtime/import-services.js";
import { createPrismaUserWatchStateStore, createEntityProbe } from "../src/persistence/prisma/index.js";
import type { AuthenticatedContext } from "../src/auth-runtime/deps.js";
import type { TransactionScope } from "../src/persistence/types.js";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const dbDir = path.join(repoRoot, "packages", "db");
const schemaPath = path.join(dbDir, "prisma", "schema.prisma");

const SCOPE: TransactionScope = { transactional: true };

/** Tamanho da serie grande. Prova a estrategia sem tornar a CI lenta. */
const SERIE_GRANDE_EPISODIOS = 5_000;

interface CheckResult {
  readonly n: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
function record(n: number, name: string, ok: boolean, detail: string): void {
  results.push({ n, name, ok, detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${n}. ${name} — ${detail}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function prismaBin(): string {
  const pkgPath = require.resolve("prisma/package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return path.join(path.dirname(pkgPath), rel);
}

async function safeRm(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.warn(`[cleanup] nao foi possivel remover ${dir}.`);
}

function ctx(userId: bigint, status: AuthenticatedContext["userStatus"] = "active"): AuthenticatedContext {
  return {
    userId,
    sessionId: 1n,
    userStatus: status,
    csrfTokenHash: "c".repeat(64),
    emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

async function runChecks(url: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: url });
  const deps = buildLibraryDeps(prisma);
  const q = <T = Record<string, unknown>>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

  try {
    const alice = await seedUser(prisma, "alice@example.test");
    const bob = await seedUser(prisma, "bob@example.test");
    const filme = await seedMovie(prisma, { tmdbId: 348, title: "Alien", year: 1979 });

    // -----------------------------------------------------------------------
    // WATCHLIST / ASSISTIDOS
    // -----------------------------------------------------------------------
    const add = await setWatchState(deps, ctx(alice), {
      entityType: "movie",
      entityId: filme,
      status: "planned",
      idempotencyKey: "val-watchlist-0001",
      expectedVersion: null,
    });
    record(1, "adiciona a watchlist", add.ok, `ok=${add.ok}`);

    const [ws] = await q<{ status: string; version: number }>(
      `SELECT status, version FROM "user_watch_states" WHERE user_id = ${alice} AND entity_id = ${filme}`,
    );
    record(2, "watch state persistido com versao inicial", ws?.status === "planned" && ws.version === 1, `status=${ws?.status} v=${ws?.version}`);

    const paraAssistido = await setWatchState(deps, ctx(alice), {
      entityType: "movie",
      entityId: filme,
      status: "watched",
      idempotencyKey: "val-watched-00001",
      expectedVersion: null,
    });
    record(3, "muda para assistido (CAS sobre version)", paraAssistido.ok, `ok=${paraAssistido.ok}`);

    const [ws2] = await q<{ status: string; version: number; completed_at: Date | null }>(
      `SELECT status, version, completed_at FROM "user_watch_states" WHERE user_id = ${alice} AND entity_id = ${filme}`,
    );
    record(
      4,
      "assistido carimba completed_at e sobe a versao",
      ws2?.status === "watched" && ws2.completed_at !== null && ws2.version === 2,
      `status=${ws2?.status} v=${ws2?.version} completed=${ws2?.completed_at !== null}`,
    );

    const [contagemUnica] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_watch_states" WHERE user_id = ${alice} AND entity_id = ${filme}`,
    );
    record(5, "unique (user, tipo, entidade): UMA linha por titulo", Number(contagemUnica!.c) === 1, `count=${contagemUnica!.c}`);

    const inexistente = await setWatchState(deps, ctx(alice), {
      entityType: "movie",
      entityId: 987_654_321n,
      status: "planned",
      idempotencyKey: "val-inexistente-01",
      expectedVersion: null,
    });
    record(
      6,
      "entidade inexistente e RECUSADA sem abortar a transacao (sonda antes da FK)",
      !inexistente.ok,
      `ok=${inexistente.ok}`,
    );

    // A transacao seguinte precisa funcionar — se a FK tivesse explodido, o
    // pool estaria com uma transacao abortada.
    const aindaFunciona = await listWatchStates(deps, ctx(alice), {
      statuses: [],
      entityTypes: [],
      limit: 10,
      offset: 0,
    });
    record(7, "apos a recusa, a conexao segue utilizavel", aindaFunciona.total === 1, `total=${aindaFunciona.total}`);

    // -----------------------------------------------------------------------
    // CONCORRENCIA — CAS elege exatamente um vencedor
    // -----------------------------------------------------------------------
    const filme2 = await seedMovie(prisma, { tmdbId: 603, title: "The Matrix", year: 1999 });
    const disputa = await Promise.all(
      [0, 1].map(async () =>
        prisma.$transaction(async (tx) =>
          createPrismaUserWatchStateStore(tx, createEntityProbe(tx)).upsert(SCOPE, {
            userId: alice,
            entityType: "movie",
            entityId: filme2,
            expectedVersion: null,
            status: "planned",
            startedAt: null,
            completedAt: null,
            rewatchCount: 0,
            nextVersion: 1,
            now: new Date(),
          }),
        ),
      ),
    );
    const vencedores = disputa.filter((r) => r.kind === "saved").length;
    record(8, "CAS do watch state: sob concorrencia real UM vencedor", vencedores === 1, `vencedores=${vencedores}`);

    // -----------------------------------------------------------------------
    // TRACKER — serie pequena, especiais, progresso e proximo episodio
    // -----------------------------------------------------------------------
    const serie = await seedSeries(prisma, {
      tmdbId: 1399,
      name: "Serie de Teste",
      seasons: 2,
      episodesPerSeason: 3,
      withSpecials: true,
    });

    const umEpisodio = await setEpisodeWatched(deps, ctx(alice), {
      episodeId: serie.episodeIds[3]!, // primeiro da temporada 1 (0..2 sao especiais)
      tvShowId: serie.tvShowId,
      watched: true,
      watchedAt: null,
      idempotencyKey: "val-episodio-00001",
      expectedVersion: null,
    });
    record(9, "marca UM episodio", umEpisodio.ok, `ok=${umEpisodio.ok}`);

    const progresso = await readSeriesProgress(deps, ctx(alice), { tvShowId: serie.tvShowId });
    record(
      10,
      "ESPECIAIS fora da contagem por padrao (6 episodios, nao 9)",
      progresso.totalEpisodes === 6,
      `total=${progresso.totalEpisodes}`,
    );
    record(
      11,
      "progresso DERIVADO e proximo episodio na ordem canonica",
      progresso.watchedEpisodes === 1 && progresso.nextEpisode !== null,
      `assistidos=${progresso.watchedEpisodes} proximo=${progresso.nextEpisode?.episodeId}`,
    );

    const temporada = await markSeriesEpisodes(deps, ctx(alice), {
      tvShowId: serie.tvShowId,
      seasonNumber: 1,
      watched: true,
      watchedAt: null,
      idempotencyKey: "val-temporada-0001",
    });
    record(
      12,
      "marca a temporada inteira em lote",
      temporada.ok && temporada.value.episodesConsidered === 3,
      temporada.ok ? `considerados=${temporada.value.episodesConsidered} criados=${temporada.value.created}` : "falhou",
    );

    const repetida = await markSeriesEpisodes(deps, ctx(alice), {
      tvShowId: serie.tvShowId,
      seasonNumber: 1,
      watched: true,
      watchedAt: null,
      idempotencyKey: "val-temporada-0002",
    });
    record(
      13,
      "repetir a operacao em lote e IDEMPOTENTE (zero escrita)",
      repetida.ok && repetida.value.created === 0 && repetida.value.updated === 0,
      repetida.ok ? `criados=${repetida.value.created} atualizados=${repetida.value.updated}` : "falhou",
    );

    const comEspeciais = await markSeriesEpisodes(deps, ctx(alice), {
      tvShowId: serie.tvShowId,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      includeSpecials: true,
      idempotencyKey: "val-especiais-0001",
    });
    record(
      14,
      "includeSpecials=true passa a considerar a temporada 0",
      comEspeciais.ok && comEspeciais.value.episodesConsidered === 9,
      comEspeciais.ok ? `considerados=${comEspeciais.value.episodesConsidered}` : "falhou",
    );

    const completa = await readSeriesProgress(deps, ctx(alice), { tvShowId: serie.tvShowId });
    record(
      15,
      "serie completa: 100% e sem proximo episodio",
      completa.completed && completa.percent === 100 && completa.nextEpisode === null,
      `percent=${completa.percent} proximo=${completa.nextEpisode}`,
    );

    const [statusSerie] = await q<{ status: string }>(
      `SELECT status FROM "user_watch_states" WHERE user_id = ${alice} AND entity_type = 'tv' AND entity_id = ${serie.tvShowId}`,
    );
    record(16, "estado da SERIE derivado para `watched`", statusSerie?.status === "watched", `status=${statusSerie?.status}`);

    // -----------------------------------------------------------------------
    // SERIE GIGANTE — a prova de escala
    // -----------------------------------------------------------------------
    const gigante = await seedSeries(prisma, {
      tmdbId: 20_000,
      name: "Serie Gigante",
      seasons: 5,
      episodesPerSeason: SERIE_GRANDE_EPISODIOS / 5,
    });
    const inicio = Date.now();
    const massa = await markSeriesEpisodes(deps, ctx(alice), {
      tvShowId: gigante.tvShowId,
      seasonNumber: null,
      watched: true,
      watchedAt: null,
      idempotencyKey: "val-gigante-000001",
    });
    const duracao = Date.now() - inicio;
    record(
      17,
      `SERIE GIGANTE: ${SERIE_GRANDE_EPISODIOS} episodios em UMA operacao`,
      massa.ok && massa.value.created === SERIE_GRANDE_EPISODIOS,
      massa.ok ? `criados=${massa.value.created} em ${duracao}ms` : "falhou",
    );

    const [eventosGigante] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_viewing_events" WHERE user_id = ${alice} AND source = 'app'`,
    );
    record(
      18,
      "eventos de diario NAO escalam com o tamanho da serie",
      Number(eventosGigante!.c) < 50,
      `eventos=${eventosGigante!.c} (para ${SERIE_GRANDE_EPISODIOS} episodios)`,
    );

    // -----------------------------------------------------------------------
    // LISTAS
    // -----------------------------------------------------------------------
    const sistema = await ensureSystemLists(deps, ctx(alice));
    record(19, "cria as 4 listas de sistema", sistema.created === 4, `criadas=${sistema.created}`);
    const sistemaDeNovo = await ensureSystemLists(deps, ctx(alice));
    record(20, "ensureSystemLists e IDEMPOTENTE (unique parcial)", sistemaDeNovo.created === 0, `criadas=${sistemaDeNovo.created}`);

    const lista = await createList(deps, ctx(alice), {
      title: "Clássicos",
      description: "favoritos",
      visibility: "private",
      ordered: true,
    });
    record(21, "cria lista customizada", lista.ok, lista.ok ? `slug=${lista.value.slug}` : "falhou");
    if (!lista.ok) throw new Error("lista base falhou");

    const listaDup = await createList(deps, ctx(alice), {
      title: "Clássicos",
      description: null,
      visibility: "private",
      ordered: false,
    });
    record(
      22,
      "slug duplicado e DESAMBIGUADO (nao reciclado)",
      listaDup.ok && listaDup.value.slug === "classicos-2",
      listaDup.ok ? `slug=${listaDup.value.slug}` : "falhou",
    );

    for (const id of [filme, filme2]) {
      await addListItem(deps, ctx(alice), {
        listId: lista.value.id,
        entityType: "movie",
        entityId: id,
        note: null,
      });
    }
    const repetido = await addListItem(deps, ctx(alice), {
      listId: lista.value.id,
      entityType: "movie",
      entityId: filme,
      note: null,
    });
    record(
      23,
      "item duplicado e IDEMPOTENTE (unique da lista)",
      repetido.ok && repetido.value.added === false,
      repetido.ok ? `added=${repetido.value.added}` : "falhou",
    );

    const conteudo = await readList(deps, ctx(alice), { listId: lista.value.id, limit: 10, offset: 0 });
    record(24, "lista tem exatamente 2 itens", conteudo.ok && conteudo.value.total === 2, conteudo.ok ? `total=${conteudo.value.total}` : "falhou");
    if (!conteudo.ok) throw new Error("leitura de lista falhou");

    const ordem = await reorderList(deps, ctx(alice), {
      listId: lista.value.id,
      kind: "move",
      itemId: conteudo.value.items[1]!.id,
      toPosition: 0,
    });
    record(25, "reordenacao aplica posicoes", ordem.ok, ordem.ok ? `atualizados=${ordem.value.updated}` : "falhou");

    const [posicoes] = await q<{ positions: string }>(
      `SELECT string_agg(position::text, ',' ORDER BY position) AS positions FROM "user_list_items" WHERE list_id = ${lista.value.id}`,
    );
    record(26, "posicoes contiguas 0..n-1", posicoes?.positions === "0,1", `positions=${posicoes?.positions}`);

    // -----------------------------------------------------------------------
    // OWNERSHIP — Bob nao alcanca a lista de Alice
    // -----------------------------------------------------------------------
    const leituraIntrusa = await readList(deps, ctx(bob), { listId: lista.value.id, limit: 10, offset: 0 });
    record(27, "OWNERSHIP: outro usuario nao le a lista", !leituraIntrusa.ok, `ok=${leituraIntrusa.ok}`);

    const itemIntruso = await addListItem(deps, ctx(bob), {
      listId: lista.value.id,
      entityType: "movie",
      entityId: filme,
      note: null,
    });
    record(28, "OWNERSHIP: outro usuario nao adiciona item", !itemIntruso.ok, `ok=${itemIntruso.ok}`);

    const remocaoIntrusa = await deleteList(deps, ctx(bob), { listId: lista.value.id });
    record(29, "OWNERSHIP: outro usuario nao remove a lista", !remocaoIntrusa.ok, `ok=${remocaoIntrusa.ok}`);

    // -----------------------------------------------------------------------
    // NOTA PESSOAL — grade do banco
    // -----------------------------------------------------------------------
    const nota = await setRating(deps, ctx(alice), { entityType: "movie", entityId: filme, value: 4.5 });
    record(30, "nota pessoal 4,5 aceita", nota.ok, `ok=${nota.ok}`);
    const notaInvalida = await setRating(deps, ctx(alice), { entityType: "movie", entityId: filme, value: 4.3 });
    record(31, "nota fora da grade de 0,5 e RECUSADA antes do CHECK", !notaInvalida.ok, `ok=${notaInvalida.ok}`);

    // -----------------------------------------------------------------------
    // EXPORTACAO LGPD com os dados novos
    // -----------------------------------------------------------------------
    const exportado = await requestDataExport(deps, ctx(alice), {
      correlationId: "val-export",
      clientIpHash: null,
      userAgent: null,
    });
    record(32, "exportacao gerada", exportado.ok, `ok=${exportado.ok}`);
    if (exportado.ok) {
      const json = JSON.stringify(exportado.value);
      record(
        33,
        "exportacao inclui listas, tracking e notas",
        json.includes("watchStates") && json.includes("lists") && json.includes("ratings"),
        "conteudo presente",
      );
      record(
        34,
        "exportacao NUNCA contem segredo",
        !/passwordHash|csrfTokenHash|tokenHash|ip_?hash/i.test(json),
        "sem segredo",
      );
    }

    // -----------------------------------------------------------------------
    // ENCERRAMENTO — a retencao e EXECUTADA
    // -----------------------------------------------------------------------
    const [antesWatch] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_watch_states" WHERE user_id = ${alice}`,
    );
    record(35, "biblioteca populada antes do encerramento", Number(antesWatch!.c) > 0, `watch_states=${antesWatch!.c}`);

    await prisma.$executeRawUnsafe(
      `UPDATE "users" SET status = 'pending_deletion', deleted_at = now() WHERE id = ${alice}`,
    );
    const anon = await anonymizeAccount(deps, alice, "operador@cinerie");
    record(36, "anonimizacao aplicada", anon.ok, `ok=${anon.ok}`);

    const [depoisWatch] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_watch_states" WHERE user_id = ${alice}`,
    );
    const [depoisListas] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_lists" WHERE owner_id = ${alice}`,
    );
    const [depoisProgresso] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_episode_progress" WHERE user_id = ${alice}`,
    );
    record(
      37,
      "ENCERRAMENTO EXECUTA a retencao: conteudo de produto APAGADO",
      Number(depoisWatch!.c) === 0 && Number(depoisListas!.c) === 0 && Number(depoisProgresso!.c) === 0,
      `watch=${depoisWatch!.c} listas=${depoisListas!.c} progresso=${depoisProgresso!.c}`,
    );

    const [tumba] = await q<{ email: string; status: string }>(
      `SELECT email, status FROM "users" WHERE id = ${alice}`,
    );
    record(
      38,
      "a linha de users permanece como TUMBA (sem PII)",
      tumba !== undefined && tumba.email.includes("anonymized.invalid") && tumba.status === "deleted",
      `email=${tumba?.email} status=${tumba?.status}`,
    );

    const [pedidos] = await q<{ c: bigint }>(
      `SELECT count(*)::int AS c FROM "user_data_requests" WHERE user_id = ${alice}`,
    );
    record(
      39,
      "pedidos LGPD PRESERVADOS (retain_indefinitely)",
      Number(pedidos!.c) > 0,
      `pedidos=${pedidos!.c}`,
    );

    // Bob continua intacto: a purga e por titular.
    const bobLista = await createList(deps, ctx(bob), {
      title: "Do Bob",
      description: null,
      visibility: "private",
      ordered: false,
    });
    record(40, "a purga NAO afeta outro usuario", bobLista.ok, `ok=${bobLista.ok}`);

    // Conta encerrada nao muta mais nada.
    const aposEncerrar = await clearWatchState(deps, ctx(alice, "deleted"), {
      entityType: "movie",
      entityId: filme,
    });
    record(41, "conta encerrada nao muta a biblioteca", !aposEncerrar.ok, `ok=${aposEncerrar.ok}`);

    // -----------------------------------------------------------------------
    // IMPORTACAO — preview sem escrita, exact aplicado, ambigua ignorada,
    // retomada idempotente e cancelamento. Roda em Bob (ativo; nao purgado).
    // Alien(tmdb 348) e Matrix(tmdb 603) ja existem no catalogo; a 3a linha nao
    // tem id nem ano => AMBIGUA => nunca vira entidade nem watch state.
    // -----------------------------------------------------------------------
    const csvCinerie = [
      "entity_type,tmdb_id,imdb_id,title,year,state,watched_at,list,rating",
      "movie,348,,Alien,1979,watched,2020-01-02,,4.5",
      "movie,603,,The Matrix,1999,watched,2021-05-05,,5",
      // Sem id e sem ano: bate por titulo com Alien, mas sem ano nao ha veredito
      // estavel => AMBIGUA => nunca aplicada e nunca cria entidade nova.
      "movie,,,Alien,,watched,,,",
      "",
    ].join("\n");
    const bytesCinerie = new TextEncoder().encode(csvCinerie);

    const contarWatchBob = async (): Promise<number> => {
      const [linha] = await q<{ c: bigint }>(
        `SELECT count(*)::int AS c FROM "user_watch_states" WHERE user_id = ${bob}`,
      );
      return Number(linha!.c);
    };

    const antesPreview = await contarWatchBob();
    const preview = await createImportPreview(deps, ctx(bob), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: "cinerie-export.csv",
      bytes: bytesCinerie,
    });
    record(42, "IMPORT: preview gerado (preview_ready)", preview.ok && preview.value.job.status === "preview_ready", preview.ok ? `status=${preview.value.job.status}` : "falhou");

    if (preview.ok) {
      const resumo = preview.value.plan.summary;
      record(
        43,
        "IMPORT: 2 exact + 1 ambigua; so 2 aplicaveis (fail-closed)",
        resumo.exact === 2 && resumo.ambiguous === 1 && resumo.applicable === 2,
        `exact=${resumo.exact} ambiguous=${resumo.ambiguous} applicable=${resumo.applicable}`,
      );

      const depoisPreview = await contarWatchBob();
      record(
        44,
        "IMPORT: preview NAO escreve na biblioteca",
        antesPreview === 0 && depoisPreview === 0,
        `antes=${antesPreview} depois=${depoisPreview}`,
      );

      const jobId = preview.value.job.id;
      const aplicado = await applyImport(deps, ctx(bob), { jobId });
      const watchDepoisApply = await contarWatchBob();
      record(
        45,
        "IMPORT: apply grava SO os 2 exact",
        aplicado.ok && aplicado.value.appliedCount === 2 && watchDepoisApply === 2,
        aplicado.ok ? `applied=${aplicado.value.appliedCount} watch=${watchDepoisApply}` : "falhou",
      );

      // A linha ambigua nunca criou entidade de catalogo: continua havendo UM
      // unico "Alien" no banco (o semeado), nao um duplicado inventado.
      const [aliens] = await q<{ c: bigint }>(
        `SELECT count(*)::int AS c FROM "movies" WHERE title_original = 'Alien'`,
      );
      record(46, "IMPORT: linha ambigua NAO cria entidade falsa", Number(aliens!.c) === 1, `movies_alien=${aliens!.c}`);

      // Reaplicar um job ja `applied` e recusado (CAS de status): sem trabalho duplicado.
      const reaplicado = await applyImport(deps, ctx(bob), { jobId });
      const watchAposReaplicar = await contarWatchBob();
      record(
        47,
        "IMPORT: reaplicar job concluido e RECUSADO (nao duplica)",
        !reaplicado.ok && watchAposReaplicar === 2,
        `ok=${reaplicado.ok} watch=${watchAposReaplicar}`,
      );

      // RETOMADA: forca o job de volta a `applying` no meio (como um crash) e
      // reaplica — a acao repetida e idempotente (unique user+entidade), entao
      // continua com EXATAMENTE 2 watch states.
      await prisma.$executeRawUnsafe(
        `UPDATE "user_import_jobs" SET status = 'applying', applied_count = 1 WHERE id = ${jobId}`,
      );
      const retomado = await applyImport(deps, ctx(bob), { jobId });
      const watchAposRetomada = await contarWatchBob();
      record(
        48,
        "IMPORT: retomada de crash continua e NAO duplica",
        retomado.ok && retomado.value.appliedCount === 2 && watchAposRetomada === 2,
        retomado.ok ? `applied=${retomado.value.appliedCount} watch=${watchAposRetomada}` : "falhou",
      );
    }

    // OWNERSHIP + CANCELAMENTO: outro usuario nao aplica/cancela o job alheio;
    // um job novo pode ser cancelado pelo dono antes de aplicar.
    const carol = await seedUser(prisma, "carol@example.test");
    const previewCarol = await createImportPreview(deps, ctx(carol), {
      source: "cinerie_csv",
      targetState: "watched",
      fileName: "carol.csv",
      bytes: bytesCinerie,
    });
    if (previewCarol.ok) {
      const jobCarol = previewCarol.value.job.id;
      const bobTentaAplicar = await applyImport(deps, ctx(bob), { jobId: jobCarol });
      record(49, "IMPORT OWNERSHIP: outro usuario NAO aplica o job alheio", !bobTentaAplicar.ok, `ok=${bobTentaAplicar.ok}`);

      const bobTentaCancelar = await cancelImport(deps, ctx(bob), { jobId: jobCarol });
      record(50, "IMPORT OWNERSHIP: outro usuario NAO cancela o job alheio", !bobTentaCancelar.ok, `ok=${bobTentaCancelar.ok}`);

      const cancelaDono = await cancelImport(deps, ctx(carol), { jobId: jobCarol });
      const carolWatch = await q<{ c: bigint }>(
        `SELECT count(*)::int AS c FROM "user_watch_states" WHERE user_id = ${carol}`,
      );
      record(
        51,
        "IMPORT: dono cancela o job antes de aplicar (sem efeitos)",
        cancelaDono.ok && Number(carolWatch[0]!.c) === 0,
        cancelaDono.ok ? `cancelado; watch=${carolWatch[0]!.c}` : "falhou",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const port = await freePort();
  const dataDir = mkdtempSync(path.join(tmpdir(), "screena-c8-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });
  console.log(
    `\n=== C8 — biblioteca, tracker e importacao | Postgres 16 efemero :${port} (postgres:****) ===\n`,
  );

  let started = false;
  try {
    await pg.initialise();
    await pg.start();
    started = true;
    await pg.createDatabase("c8");
    const url = `postgresql://postgres:postgres@127.0.0.1:${port}/c8?schema=public`;

    execFileSync("node", [prismaBin(), "migrate", "deploy", "--schema", schemaPath], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
      cwd: dbDir,
    });
    record(0, "todas as migrations aplicam em banco vazio", true, "migrate deploy ok");

    await runChecks(url);
  } catch (e) {
    record(99, "execucao", false, (e as Error).message.split("\n")[0] ?? "erro");
  } finally {
    if (started) {
      try {
        await pg.stop();
      } catch (e) {
        console.warn(`[cleanup] pg.stop: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    await safeRm(dataDir);
    console.log("\n=== Postgres efemero derrubado e dir temporario removido ===");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} checks OK.`);
  if (failed.length > 0) {
    console.error("FALHAS:", failed.map((f) => `${f.n}.${f.name}`).join(" | "));
    process.exit(1);
  }
  console.log("Resultado: PASSOU. Biblioteca, tracker e importacao validados em PostgreSQL 16 real.");
}

main().catch((e) => {
  console.error("Erro fatal:", e);
  process.exit(1);
});
