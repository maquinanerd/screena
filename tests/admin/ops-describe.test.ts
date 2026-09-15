/**
 * ops-describe.test.ts — Os julgamentos do painel em palavras, e os filtros da URL.
 *
 * Cada vermelho tem o caso VERMELHO provado e o controle negativo ao lado: um
 * julgamento que nunca fica vermelho e enfeite.
 */

import { describe, expect, it } from "vitest";

import { collectBroken } from "../../apps/admin/src/lib/ops/broken";
import {
  actionErrorText,
  describeInterval,
  describeLap,
  describeNextRun,
  describeVersion,
  utcDayList,
} from "../../apps/admin/src/lib/ops/describe";
import { escapeLike, parseJobLogFilters, parseSyncLogFilters } from "../../apps/admin/src/lib/ops/log-filters";
import { parseEntityId, parseTitleSegment, publicTitleUrl, titlePath } from "../../apps/admin/src/lib/ops/title-routes";
import { computeLap } from "../../services/sync/src/scheduler/lap";

const AGORA = new Date("2026-09-15T12:00:00.000Z");

describe("volta de fila", () => {
  it("volta de 300 dias fica VERMELHA, com os dias escritos", () => {
    // people: 30 dias de intervalo, teto global 200 -> 6,67 por dia; 2.000 pessoas = 300 dias.
    const lap = computeLap({ universe: { kind: "counted", items: 2000 }, perCycle: 200, intervalHours: 720 });
    const view = describeLap(lap);
    expect(view.red).toBe(true);
    expect(view.text).toBe("300 dias");
  });

  it("CONTROLE NEGATIVO: volta de exatamente 30 dias NAO e vermelha; 31 e", () => {
    expect(describeLap(computeLap({ universe: { kind: "counted", items: 3000 }, perCycle: 100, intervalHours: 24 }))).toMatchObject({
      text: "30 dias",
      red: false,
    });
    expect(describeLap(computeLap({ universe: { kind: "counted", items: 3100 }, perCycle: 100, intervalHours: 24 })).red).toBe(true);
  });

  it("volta que nao fecha e vermelha; nao se aplica e nao determinado nao sao verdes disfarcados", () => {
    expect(describeLap({ kind: "never", reason: "teto zero" })).toMatchObject({ red: true, text: "não fecha" });
    expect(describeLap({ kind: "not_applicable", reason: "incremental" })).toMatchObject({ red: false, text: "não se aplica" });
    expect(describeLap({ kind: "undeterminable", reason: "sem medida" })).toMatchObject({ red: false, undetermined: true, text: "não determinado" });
  });

  it("intervalos", () => {
    expect(describeInterval(6)).toBe("6 h");
    expect(describeInterval(24)).toBe("1 dia");
    expect(describeInterval(36)).toBe("1,5 dias");
    expect(describeInterval(720)).toBe("30 dias");
  });

  it("proxima execucao: nunca rodou e vencida sao atraso; futura nao", () => {
    expect(describeNextRun({ lastSuccessAt: null, dueAt: null, due: true }, AGORA).overdue).toBe(true);
    expect(
      describeNextRun({ lastSuccessAt: new Date("2026-09-13T00:00:00Z"), dueAt: new Date("2026-09-14T00:00:00Z"), due: true }, AGORA).overdue,
    ).toBe(true);
    expect(
      describeNextRun({ lastSuccessAt: new Date("2026-09-15T11:00:00Z"), dueAt: new Date("2026-09-16T11:00:00Z"), due: false }, AGORA).overdue,
    ).toBe(false);
  });
});

describe("versao de servico", () => {
  it("commit atras do main e VERMELHO com o numero escrito", () => {
    const view = describeVersion({ kind: "atras", commitSha: "b".repeat(40), behindBy: 3 });
    expect(view.red).toBe(true);
    expect(view.text).toContain("3 COMMIT");
  });

  it("CONTROLE NEGATIVO: em dia nao e vermelho; sem impressao digital e nao determinado, nunca verde", () => {
    expect(describeVersion({ kind: "em_dia", commitSha: "a".repeat(40) }).red).toBe(false);
    expect(describeVersion(null)).toMatchObject({ red: false, undetermined: true });
    expect(describeVersion({ kind: "sem_correspondencia", reason: "x" }).red).toBe(true);
  });
});

describe("o que vem da URL", () => {
  it("filtros fora da lista viram SEM FILTRO — nunca texto de SQL", () => {
    const filtros = parseSyncLogFilters({ fornecedor: "omdb'; drop", status: "success", dias: "999", antes: "12abc", endpoint: "scheduler/%" });
    expect(filtros).toEqual({ provider: null, status: "success", endpointPrefix: null, days: 7, before: null });
  });

  it("CONTROLE POSITIVO: filtros validos passam", () => {
    expect(parseJobLogFilters({ status: "dead_letter", tipo: "sync_media", origem: "admin", tmdb: "603", antes: "100" })).toEqual({
      status: "dead_letter",
      jobType: "sync_media",
      origin: "admin",
      externalId: "603",
      before: "100",
    });
    expect(parseSyncLogFilters({ fornecedor: "tmdb-exports", endpoint: "scheduler/", dias: "30" })).toMatchObject({
      provider: "tmdb-exports",
      endpointPrefix: "scheduler/",
      days: 30,
    });
  });

  it("LIKE escapado", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("codigo de erro desconhecido nao vira texto na tela", () => {
    expect(actionErrorText("falha_ao_enfileirar")).toContain("nada foi enfileirado");
    expect(actionErrorText("<script>alert(1)</script>")).toBeNull();
    expect(actionErrorText(undefined)).toBeNull();
  });

  it("rotas de titulo dizem o tipo por extenso", () => {
    expect(parseTitleSegment("filme")).toBe("movie");
    expect(parseTitleSegment("serie")).toBe("tv");
    expect(parseTitleSegment("movie")).toBeNull();
    expect(parseEntityId("0")).toBeNull();
    expect(parseEntityId("123")).toBe("123");
    expect(titlePath("tv", "9")).toBe("/titulos/serie/9");
    expect(publicTitleUrl("tv", "game-of-thrones")).toBe("https://cinerie.com/pt/series/game-of-thrones/");
  });

  it("dias UTC", () => {
    expect(utcDayList(AGORA, 3)).toEqual(["2026-09-13", "2026-09-14", "2026-09-15"]);
  });
});

describe("o que esta quebrado agora", () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value, source: "teste", measuredAt: AGORA });
  const falhou = (reason: string) => ({ ok: false as const, reason, source: "teste", measuredAt: AGORA });
  type Entrada = Parameters<typeof collectBroken>[0];

  const backlogVerde = ok({ rows: [], openTotal: 0, pendingTotal: 0, alerts: [], neverDrained: false });
  const entradaVerde = {
    queues: ok({ rows: [{ queue: "people", redReasons: [] }], backlog: backlogVerde, cronStartedAt: null }),
    quotas: ok([{ key: "omdb", judgement: { red: false, reasons: [] } }]),
    services: ok({ rows: [{ service: { key: "screen-app", label: "Site público" }, redReasons: [] }] }),
  } as unknown as Entrada;

  it("CONTROLE NEGATIVO: tudo verde -> lista vazia", () => {
    expect(collectBroken(entradaVerde)).toEqual([]);
  });

  it("fila parada, cota recusada e servico atras entram, cada um com o motivo e o link", () => {
    const entrada = {
      queues: ok({
        rows: [{ queue: "people", redReasons: ["VOLTA DECLARADA DE 300 DIAS (acima de 30 dias)"] }],
        backlog: ok({ rows: [], openTotal: 3, pendingTotal: 3, alerts: [{ jobType: "sync_media", pending: 3, oldestPendingHours: 30, message: "" }], neverDrained: false }),
        cronStartedAt: null,
      }),
      quotas: ok([{ key: "omdb", judgement: { red: true, reasons: ["o contador está subcontando"] } }]),
      services: ok({ rows: [{ service: { key: "screen-app", label: "Site público" }, redReasons: ["RODANDO CÓDIGO 3 COMMIT(S) ATRÁS DO MAIN"] }] }),
    } as unknown as Entrada;
    const itens = collectBroken(entrada);
    expect(itens.map((item) => item.area)).toEqual(["Filas", "Fila de jobs", "Cotas", "Serviços"]);
    expect(itens[0]).toMatchObject({ href: "/filas/people" });
    expect(itens[0]?.text).toContain("300 DIAS");
    expect(itens[2]?.text).toContain("subcontando");
    expect(itens[3]?.text).toContain("3 COMMIT");
  });

  it("medida que FALHOU tambem e quebrado — nunca 'nada quebrado' por falta de dado", () => {
    const entrada = { ...entradaVerde, services: falhou("o painel nao conseguiu conectar no banco") } as unknown as Entrada;
    expect(collectBroken(entrada)).toEqual([
      { area: "Painel", text: "não foi possível medir os serviços: o painel nao conseguiu conectar no banco", href: "/servicos" },
    ]);
  });
});
