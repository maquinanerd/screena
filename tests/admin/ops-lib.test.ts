/**
 * ops-lib.test.ts — Os nucleos puros do painel operacional.
 *
 * Cada julgamento tem o caso VERMELHO provado. Cada numero formatado tem o caso
 * "sem base" provado — zero e inexistente sao fatos diferentes.
 */

import { describe, expect, it } from "vitest";

import { SCHEDULER_QUEUES } from "../../services/sync/src/scheduler/rhythms";
import {
  estimateQueueAction,
  estimateTitleAction,
  FORCE_TITLE_ACTIONS,
} from "../../apps/admin/src/lib/ops/estimate";
import {
  formatBytes,
  formatDateTimeBrt,
  formatDays,
  formatDecimal,
  formatInt,
  formatPercent,
  formatRelative,
  shortSha,
} from "../../apps/admin/src/lib/ops/format";
import {
  evaluateLiveness,
  evaluateQuota,
  evaluateVersion,
  isVersionRed,
  SERVICE_SILENCE_MS,
} from "../../apps/admin/src/lib/ops/health";
import { describeMeasureError, measure } from "../../apps/admin/src/lib/ops/measure";
import { QUEUE_PANEL_SPECS } from "../../apps/admin/src/lib/ops/queues";

describe("format — nunca traco, nunca zero falso", () => {
  it("volta positiva pequena NAO vira '0,0 h' (le-se como zero); zero continua zero", () => {
    expect(formatDays(0.001)).toBe("menos de 0,1 h");
    expect(formatDays(0)).toBe("0 dias");
    // CONTROLE: o que uma casa decimal consegue mostrar continua em horas.
    expect(formatDays(0.25)).toBe("6,0 h");
  });

  it("valor nao finito vira 'nao determinado', nunca traco", () => {
    expect(formatInt(Number.NaN)).toBe("não determinado");
    expect(formatDecimal(Number.POSITIVE_INFINITY, 1)).toBe("não determinado");
    expect(formatDays(Number.NaN)).toBe("não determinado");
    expect(formatBytes(-1)).toBe("não determinado");
    expect(shortSha(null)).toBe("não determinado");
    // CONTROLE: valor finito continua numero.
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(shortSha("a".repeat(40))).toBe("aaaaaaa");
  });
});

describe("format — pt-BR deterministico", () => {
  it("milhar, decimal e percentual", () => {
    expect(formatInt(1_234_567)).toBe("1.234.567");
    expect(formatInt(-42)).toBe("-42");
    expect(formatDecimal(12.345, 1)).toBe("12,3");
    expect(formatPercent(1, 8)).toBe("12,5%");
  });

  it("total zero NAO vira 0% — sem base e dito com todas as letras", () => {
    expect(formatPercent(0, 0)).toBe("sem base (total zero)");
    expect(formatPercent(5, Number.NaN)).toBe("sem base (total zero)");
  });

  it("data em BRT (UTC-3 fixo) e tempo relativo", () => {
    expect(formatDateTimeBrt(new Date("2026-09-15T12:03:00.000Z"))).toBe("15/09/2026 09:03 BRT");
    const agora = new Date("2026-09-15T12:00:00.000Z");
    expect(formatRelative(new Date("2026-09-15T11:57:00.000Z"), agora)).toBe("há 3 min");
    expect(formatRelative(new Date("2026-09-15T12:20:00.000Z"), agora)).toBe("em 20 min");
    expect(formatRelative(new Date("2026-09-10T12:00:00.000Z"), agora)).toBe("há 5,0 d");
  });

  it("dias", () => {
    expect(formatDays(352.685)).toBe("352,7 dias");
    expect(formatDays(1)).toBe("1 dia");
    expect(formatDays(0.25)).toBe("6,0 h");
  });
});

describe("measure — procedencia, e nunca zero no lugar de erro", () => {
  it("sucesso carrega fonte e momento", async () => {
    const quando = new Date("2026-09-15T10:00:00.000Z");
    const medida = await measure("api_sync_logs", async () => 7, () => quando);
    expect(medida).toEqual({ ok: true, value: 7, source: "api_sync_logs", measuredAt: quando });
  });

  it("falha vira motivo SEGURO — a mensagem crua (que pode ter e-mail ou SQL) nao sai", async () => {
    const erro = Object.assign(new Error("SELECT ... WHERE email = 'pessoa@exemplo.com'"), {
      name: "PrismaClientKnownRequestError",
      code: "P2010",
      meta: { code: "57014" },
    });
    const medida = await measure("users", async () => {
      throw erro;
    });
    expect(medida.ok).toBe(false);
    if (medida.ok) return;
    expect(medida.reason).toBe("a consulta passou do tempo limite e foi cancelada");
    expect(JSON.stringify(medida)).not.toContain("pessoa@exemplo.com");
    expect(describeMeasureError({ name: "TypeError" })).toBe("a consulta falhou (TypeError)");
  });
});

describe("estimate — o custo aparece ANTES", () => {
  const semGasto = { spentToday: 120 };

  it("detalhe de filme: detalhe + midia = 3", () => {
    const custo = estimateTitleAction("detalhe", { kind: "movie", seasons: null, episodes: null, imdbId: "tt0133093" }, semGasto);
    expect(custo).toMatchObject({ provider: "tmdb", requests: 3, lowerBound: false, refusal: null });
  });

  it("detalhe de serie: a cascata inteira, pelo que o banco tem, como MINIMO", () => {
    const custo = estimateTitleAction("detalhe", { kind: "tv", seasons: 2, episodes: 20, imdbId: null }, semGasto);
    // 1 detalhe + 2 midia + 1 lista + 2 temporadas + 20 episodios + 4 midia temp + 40 midia ep
    expect(custo.requests).toBe(70);
    expect(custo.lowerBound).toBe(true);
    expect(custo.basis).toContain("2 temporada(s) e 20 episódio(s)");
  });

  it("temporadas de filme e nota sem imdb_id sao RECUSADAS com motivo", () => {
    expect(estimateTitleAction("temporadas", { kind: "movie", seasons: null, episodes: null, imdbId: null }, semGasto).refusal).toBe(
      "filme não tem temporadas",
    );
    expect(estimateTitleAction("nota", { kind: "movie", seasons: null, episodes: null, imdbId: null }, semGasto).refusal).toContain(
      "sem imdb_id",
    );
  });

  it("nota: cabe com 999 gastos, NAO cabe com 1000, e nao se sabe sem medida", () => {
    const titulo = { kind: "tv" as const, seasons: 1, episodes: 1, imdbId: "tt0944947" };
    const cabe = estimateTitleAction("nota", titulo, { spentToday: 999 });
    expect(cabe.quota).toMatchObject({ kind: "daily", fits: true, remainingAfter: 0 });
    const naoCabe = estimateTitleAction("nota", titulo, { spentToday: 1000 });
    expect(naoCabe.quota).toMatchObject({ fits: false });
    expect(naoCabe.refusal).toBe("a cota diária da OMDb acabou hoje");
    const semMedida = estimateTitleAction("nota", titulo, { spentToday: null });
    expect(semMedida.quota).toMatchObject({ fits: null });
    expect(semMedida.refusal).toBeNull();
  });

  it("score nao gasta nada", () => {
    expect(estimateTitleAction("score", { kind: "movie", seasons: null, episodes: null, imdbId: null }, semGasto)).toMatchObject({
      requests: 0,
      provider: null,
    });
  });

  it("toda acao de titulo tem estimativa", () => {
    for (const acao of FORCE_TITLE_ACTIONS) {
      expect(estimateTitleAction(acao, { kind: "tv", seasons: 1, episodes: 2, imdbId: "tt1234567" }, semGasto).basis.length).toBeGreaterThan(10);
    }
  });

  it("fila de midia: 2 por titulo ate o teto", () => {
    expect(estimateQueueAction("title_media", { eligible: 70_537, perCycle: 12_000, omdb: semGasto }).requests).toBe(24_000);
  });

  it("fila da OMDb: a fatia de fundo encolhe com o gasto, e zera antes da reserva do leitor", () => {
    expect(estimateQueueAction("ratings_omdb", { eligible: null, perCycle: null, omdb: { spentToday: 200 } }).requests).toBe(650);
    const esgotada = estimateQueueAction("ratings_omdb", { eligible: null, perCycle: null, omdb: { spentToday: 900 } });
    expect(esgotada.requests).toBe(0);
    expect(esgotada.refusal).toContain("acabou hoje");
  });

  it("custo nao determinavel e null, nunca zero", () => {
    expect(estimateQueueAction("changes", { eligible: null, perCycle: null, omdb: semGasto }).requests).toBeNull();
    expect(estimateQueueAction("watch_offers", { eligible: 100, perCycle: null, omdb: semGasto }).requests).toBeNull();
  });
});

describe("health — o vermelho existe e e alcancavel", () => {
  const agora = new Date("2026-09-15T12:00:00.000Z");

  it("sinal de vida: na fronteira ainda esta no ar; um ms depois, sem sinal", () => {
    expect(evaluateLiveness(new Date(agora.getTime() - SERVICE_SILENCE_MS), agora).kind).toBe("no_ar");
    expect(evaluateLiveness(new Date(agora.getTime() - SERVICE_SILENCE_MS - 1), agora).kind).toBe("sem_sinal");
    expect(evaluateLiveness(null, agora).kind).toBe("nunca");
  });

  const main = { headSha: "a".repeat(40), readAt: agora };
  const match = (over: Partial<{ commitSha: string; behindHeadBy: number | null; behindHeadSha: string | null }>) => ({
    commitSha: "b".repeat(40),
    title: "x",
    mainPosition: 3,
    behindHeadBy: 3,
    behindHeadSha: "a".repeat(40),
    ...over,
  });

  it("commit atras do main e VERMELHO, com o numero de commits", () => {
    const veredito = evaluateVersion({ sourceDigest: "d".repeat(64), digestError: null, main, match: match({}) });
    expect(veredito).toEqual({ kind: "atras", commitSha: "b".repeat(40), behindBy: 3 });
    expect(isVersionRed(veredito)).toBe(true);
  });

  it("CONTROLE NEGATIVO: rodando a cabeca, verde", () => {
    const veredito = evaluateVersion({ sourceDigest: "d".repeat(64), digestError: null, main, match: match({ commitSha: "a".repeat(40) }) });
    expect(veredito.kind).toBe("em_dia");
    expect(isVersionRed(veredito)).toBe(false);
  });

  it("arvore que nao bate com commit nenhum e VERMELHO", () => {
    const veredito = evaluateVersion({ sourceDigest: "d".repeat(64), digestError: null, main, match: null });
    expect(veredito.kind).toBe("sem_correspondencia");
    expect(isVersionRed(veredito)).toBe(true);
  });

  it("distancia medida contra uma cabeca ANTIGA nao vale", () => {
    const veredito = evaluateVersion({
      sourceDigest: "d".repeat(64),
      digestError: null,
      main,
      match: match({ behindHeadSha: "c".repeat(40), behindHeadBy: 0 }),
    });
    expect(veredito.kind).toBe("distancia_pendente");
  });

  it("sem digest ou sem main: nao determinado, com motivo — nunca verde", () => {
    expect(evaluateVersion({ sourceDigest: null, digestError: "em_calculo", main, match: null })).toMatchObject({ kind: "nao_determinado" });
    expect(evaluateVersion({ sourceDigest: "d".repeat(64), digestError: null, main: { headSha: null, readAt: null }, match: null })).toMatchObject({
      kind: "nao_determinado",
    });
  });

  it("cota: recusa do fornecedor com contador ABAIXO do teto e vermelho e diz que o contador subconta", () => {
    const julgamento = evaluateQuota({ dailyLimit: 1000, spentToday: 12, providerRefusalsToday: 2 });
    expect(julgamento.red).toBe(true);
    expect(julgamento.reasons[0]).toContain("subcontando");
  });

  it("CONTROLE NEGATIVO: sem recusa e abaixo do teto, verde", () => {
    expect(evaluateQuota({ dailyLimit: 1000, spentToday: 12, providerRefusalsToday: 0 }).red).toBe(false);
  });

  it("teto atingido e vermelho; gasto nao medido nao e verde silencioso", () => {
    expect(evaluateQuota({ dailyLimit: 1000, spentToday: 1000, providerRefusalsToday: 0 }).red).toBe(true);
    expect(evaluateQuota({ dailyLimit: 1000, spentToday: null, providerRefusalsToday: null }).reasons).toContain("gasto de hoje não determinado");
  });
});

describe("queues — toda fila tem ficha no painel", () => {
  it("cobre a tabela de ritmos inteira, sem sobra", () => {
    expect(Object.keys(QUEUE_PANEL_SPECS).sort()).toEqual([...SCHEDULER_QUEUES].sort());
  });
});
