/**
 * queues.ts — As filas do agendador, como o painel as mostra. SERVER-ONLY.
 *
 * Nenhuma regra de fila e reescrita aqui. Cadencia, teto, "vencida", "parada",
 * "represada" e a volta vem do agendador (`@screena/sync`): o mesmo codigo que
 * decide rodar e o que decide pintar de vermelho. Este modulo so JUNTA as
 * leituras e diz de onde cada numero veio.
 */

import { planOmdbRotation } from "@screena/config";
import {
  computeLap,
  computeMeasuredLap,
  detectStalledQueues,
  effectiveBatchLimit,
  evaluateBacklog,
  evaluateSchedule,
  findRhythm,
  resolveSchedulerConfig,
  SCHEDULER_QUEUES,
  type BacklogReport,
  type LapResult,
  type LapUniverse,
  type QueueSchedule,
  type Rhythm,
  type SchedulerQueue,
  type StallAlert,
} from "@screena/sync";
import { readJobBacklog, readLastRuns, readSpentToday } from "@screena/sync/facts";
import {
  readQueueDailySeries,
  readQueueDeadLetterReasons,
  readQueueObservations,
  readQueueRunHistory,
  readQueueUniverse,
  readQueueWork,
  schedulerJobRunId,
  type QueueDay,
  type QueueObservation,
  type QueueRunRow,
  type QueueUniverseKey,
  type QueueWork,
} from "@screena/sync/panel";

import type { QueueCostContext } from "../../lib/ops/estimate";
import { formatDays, formatDecimal, formatInt, formatRelative } from "../../lib/ops/format";
import { measure, type Measured } from "../../lib/ops/measure";
import { QUEUE_PANEL_SPECS, type QueuePanelSpec } from "../../lib/ops/queues";
import { opsDb, withStatementTimeout, type OpsPrisma } from "./db";

/** O teto global que o CODIGO declara. O valor real e env do `screen-cron`. */
export const DECLARED_GLOBAL_BATCH_LIMIT = resolveSchedulerConfig({}).batchLimit;

/** Teto de tempo de cada contagem de universo. */
const UNIVERSE_TIMEOUT_MS = 20_000;

/** A fila existe na tabela de ritmos? */
export function isSchedulerQueue(value: string): value is SchedulerQueue {
  return (SCHEDULER_QUEUES as readonly string[]).includes(value);
}

/** O teto por ciclo, com de onde ele veio. */
export interface PerCycle {
  readonly items: number | null;
  readonly label: string;
  /** `true` = e o default do codigo; o screen-cron pode estar com outro valor. */
  readonly usesGlobalDefault: boolean;
}

/** Resolve o teto por ciclo de uma fila. */
export function resolvePerCycle(spec: QueuePanelSpec, rhythm: Rhythm): PerCycle {
  switch (spec.perCycle.kind) {
    case "fixed":
      return { items: spec.perCycle.items, label: spec.perCycle.label, usesGlobalDefault: false };
    case "rhythm": {
      const items = effectiveBatchLimit(rhythm, DECLARED_GLOBAL_BATCH_LIMIT);
      return rhythm.batchLimit === null
        ? {
            items,
            label: `teto global ${formatInt(items)}: default do código — o valor real é CINERIE_SCHEDULER_BATCH_LIMIT do screen-cron, que o painel não enxerga`,
            usesGlobalDefault: true,
          }
        : { items, label: `teto da tabela de ritmos: ${formatInt(items)}`, usesGlobalDefault: false };
    }
    case "omdb_coverage_slots": {
      const envelope = effectiveBatchLimit(rhythm, DECLARED_GLOBAL_BATCH_LIMIT);
      const coverage = planOmdbRotation(envelope).coverageSlots;
      return {
        items: coverage,
        label: `fatia de cobertura de um dia cheio: ${formatInt(coverage)} de ${formatInt(envelope)} (planOmdbRotation)`,
        usesGlobalDefault: false,
      };
    }
  }
}

/** Um pedido de fila aberto no screen-cron. */
export interface OpenForceRequest {
  readonly id: string;
  readonly status: string;
  readonly requestedAt: Date;
  readonly requestedBy: string;
}

/** A linha de uma fila. */
export interface QueueRow {
  readonly queue: SchedulerQueue;
  readonly rhythm: Rhythm;
  readonly spec: QueuePanelSpec;
  readonly schedule: QueueSchedule;
  readonly stall: StallAlert | null;
  readonly perCycle: PerCycle;
  readonly universe: LapUniverse;
  readonly universeLabel: string | null;
  readonly lapDeclared: LapResult;
  readonly lapMeasured: LapResult;
  /** Janela da volta medida ("7 dias" ou "30 dias"). */
  readonly measuredWindow: string;
  readonly observation: QueueObservation | null;
  readonly work: readonly QueueWork[];
  readonly openForce: OpenForceRequest | null;
  readonly redReasons: readonly string[];
}

/** A tela de filas. */
export interface QueuesPanel {
  readonly rows: readonly QueueRow[];
  readonly backlog: Measured<BacklogReport>;
  /** Subida do screen-cron (sinal de vida). `null` = sem sinal: nenhuma carencia aplicada. */
  readonly cronStartedAt: Date | null;
}

async function readCronStartedAt(db: OpsPrisma): Promise<Date | null> {
  const rows = await db.$queryRaw<Array<{ started_at: Date }>>`
    SELECT started_at FROM service_heartbeats
     WHERE service_key = 'screen-cron'
     ORDER BY last_seen_at DESC
     LIMIT 1`;
  return rows[0]?.started_at ?? null;
}

async function readOpenQueueForces(db: OpsPrisma): Promise<ReadonlyMap<string, OpenForceRequest>> {
  const rows = await db.$queryRaw<Array<{ id: string; queue: string; status: string; requested_at: Date; requested_by: string }>>`
    SELECT id::text AS id, queue, status, requested_at, requested_by
      FROM scheduler_force_requests
     WHERE kind = 'queue' AND status IN ('pending', 'running')
     ORDER BY id DESC`;
  const out = new Map<string, OpenForceRequest>();
  for (const row of rows) {
    if (!out.has(row.queue)) {
      out.set(row.queue, { id: row.id, status: row.status, requestedAt: row.requested_at, requestedBy: row.requested_by });
    }
  }
  return out;
}

/** O ritmo observado por dia: 7 dias para fila diaria, 30 para semanal/mensal. */
function observedPerDay(observation: QueueObservation | null, intervalHours: number): { readonly perDay: number | null; readonly window: string } {
  if (intervalHours <= 24) {
    if (observation === null || observation.runs7d === 0) return { perDay: null, window: "7 dias" };
    return { perDay: observation.processed7d / 7, window: "7 dias" };
  }
  if (observation === null || observation.runs30d === 0) return { perDay: null, window: "30 dias" };
  return { perDay: observation.processed30d / 30, window: "30 dias" };
}

function lapRedReason(label: string, lap: LapResult): string | null {
  if (lap.kind === "days" && lap.alert) return `VOLTA ${label} DE ${formatDays(lap.days).toUpperCase()} (acima de 30 dias)`;
  if (lap.kind === "never") return `VOLTA ${label} NÃO FECHA: ${lap.reason}`;
  return null;
}

/** Monta a tela de filas. */
export async function getQueuesPanel(now: Date): Promise<Measured<QueuesPanel>> {
  return measure(
    "tabela de ritmos + api_sync_logs + catalog_jobs + service_heartbeats",
    async () => {
      const db = opsDb();
      const [lastRuns, observations, work, cronStartedAt, forces] = await Promise.all([
        readLastRuns(db),
        readQueueObservations(db, now),
        readQueueWork(db, now),
        readCronStartedAt(db),
        readOpenQueueForces(db),
      ]);
      const schedules = evaluateSchedule({ now, lastRuns });
      // A carencia de "nunca rodou" conta da subida do screen-cron. Sem sinal de
      // vida dele, nao ha carencia a aplicar: a fila que nunca rodou fica vermelha.
      const stalls = detectStalledQueues(schedules, { now, startedAt: cronStartedAt ?? new Date(0) });

      const universes = new Map<QueueUniverseKey, Promise<Measured<number>>>();
      const universeOf = (key: QueueUniverseKey): Promise<Measured<number>> => {
        const cached = universes.get(key);
        if (cached !== undefined) return cached;
        const pending = measure(
          `contagem do universo ${key}`,
          () => withStatementTimeout(UNIVERSE_TIMEOUT_MS, (tx) => readQueueUniverse(tx, key)),
          () => now,
        );
        universes.set(key, pending);
        return pending;
      };

      const rows = await Promise.all(
        schedules.map(async (schedule): Promise<QueueRow> => {
          const spec = QUEUE_PANEL_SPECS[schedule.queue];
          const perCycle = resolvePerCycle(spec, schedule.rhythm);

          let universe: LapUniverse;
          let universeLabel: string | null = null;
          if (spec.universe.kind === "counted") {
            const counted = await universeOf(spec.universe.key);
            universeLabel = spec.universe.label;
            universe = counted.ok
              ? { kind: "counted", items: counted.value }
              : { kind: "undeterminable", reason: `a contagem do universo falhou: ${counted.reason}` };
          } else {
            universe = spec.universe;
          }

          const observation = observations.get(schedule.queue) ?? null;
          const lapDeclared = computeLap({ universe, perCycle: perCycle.items, intervalHours: schedule.intervalHours });
          const observed = observedPerDay(observation, schedule.intervalHours);
          const lapMeasured = computeMeasuredLap(universe, observed.perDay);
          const stall = stalls.find((alert) => alert.queue === schedule.queue) ?? null;

          const redReasons: string[] = [];
          if (stall?.kind === "stalled" && stall.lastSuccessAt !== null) {
            redReasons.push(
              `PARADA: último sucesso ${formatRelative(stall.lastSuccessAt, now)} — ${formatDecimal(stall.overdueRatio + 1, 1)}× o intervalo de ${formatInt(stall.intervalHours)} h (limiar 2×)`,
            );
          }
          if (stall?.kind === "never_ran") redReasons.push("NUNCA RODOU com sucesso");
          const declaredRed = lapRedReason("DECLARADA", lapDeclared);
          if (declaredRed !== null) redReasons.push(declaredRed);
          const measuredRed = lapRedReason("MEDIDA", lapMeasured);
          if (measuredRed !== null) redReasons.push(measuredRed);

          return {
            queue: schedule.queue,
            rhythm: schedule.rhythm,
            spec,
            schedule,
            stall,
            perCycle,
            universe,
            universeLabel,
            lapDeclared,
            lapMeasured,
            measuredWindow: observed.window,
            observation,
            work: work.filter((entry) => entry.runId === schedulerJobRunId(schedule.queue)),
            openForce: forces.get(schedule.queue) ?? null,
            redReasons,
          };
        }),
      );

      const backlog = await measure(
        "catalog_jobs (por tipo de job)",
        async () => evaluateBacklog(await readJobBacklog(db), now),
        () => now,
      );
      return { rows, backlog, cronStartedAt };
    },
    () => now,
  );
}

/** Um pedido de fila, do historico. */
export interface ForceRequestHistoryRow {
  readonly id: string;
  readonly status: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly claimedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly outcomeDetail: string | null;
}

/** O detalhe de uma fila. */
export interface QueueDetail {
  readonly panel: QueuesPanel;
  readonly row: QueueRow;
  readonly history: Measured<readonly QueueRunRow[]>;
  readonly series: Measured<readonly QueueDay[]>;
  readonly deadLetter: Measured<ReadonlyArray<{ readonly code: string; readonly count: number }>>;
  readonly forces: Measured<readonly ForceRequestHistoryRow[]>;
}

/** Monta o detalhe de uma fila. */
export async function getQueueDetail(queue: SchedulerQueue, now: Date): Promise<Measured<QueueDetail>> {
  const panel = await getQueuesPanel(now);
  if (!panel.ok) return panel;
  const row = panel.value.rows.find((entry) => entry.queue === queue);
  if (row === undefined) {
    return { ok: false, reason: "fila fora da tabela de ritmos", source: panel.source, measuredAt: now };
  }
  const db = opsDb();
  const [history, series, deadLetter, forces] = await Promise.all([
    measure(`api_sync_logs (scheduler/${queue})`, () => readQueueRunHistory(db, queue, now), () => now),
    measure(`api_sync_logs por dia (scheduler/${queue})`, () => readQueueDailySeries(db, queue, now, 30), () => now),
    measure(
      `catalog_jobs dead_letter (run_id ${schedulerJobRunId(queue)})`,
      () => readQueueDeadLetterReasons(db, schedulerJobRunId(queue), now),
      () => now,
    ),
    measure(
      "scheduler_force_requests",
      async () => {
        const rows = await db.$queryRaw<
          Array<{ id: string; status: string; requested_by: string; requested_at: Date; claimed_at: Date | null; finished_at: Date | null; outcome_detail: string | null }>
        >`
          SELECT id::text AS id, status, requested_by, requested_at, claimed_at, finished_at, outcome_detail
            FROM scheduler_force_requests
           WHERE kind = 'queue' AND queue = ${queue}
           ORDER BY id DESC
           LIMIT 20`;
        return rows.map((r) => ({
          id: r.id,
          status: r.status,
          requestedBy: r.requested_by,
          requestedAt: r.requested_at,
          claimedAt: r.claimed_at,
          finishedAt: r.finished_at,
          outcomeDetail: r.outcome_detail,
        }));
      },
      () => now,
    ),
  ]);
  return {
    ok: true,
    value: { panel: panel.value, row, history, series, deadLetter, forces },
    source: panel.source,
    measuredAt: now,
  };
}

/** O que o custo de UM ciclo forcado precisa. */
export interface QueueCostInputs {
  readonly context: QueueCostContext;
  readonly perCycle: PerCycle;
  readonly universe: Measured<number> | null;
  readonly omdbSpent: Measured<number>;
}

/** Le o que a estimativa de um ciclo forcado precisa. */
export async function getQueueCostInputs(queue: SchedulerQueue, now: Date): Promise<QueueCostInputs> {
  const rhythm = findRhythm(queue);
  const spec = QUEUE_PANEL_SPECS[queue];
  const db = opsDb();
  const perCycle: PerCycle =
    rhythm === null ? { items: null, label: "fila fora da tabela de ritmos", usesGlobalDefault: false } : resolvePerCycle(spec, rhythm);
  const universe =
    spec.universe.kind === "counted"
      ? await measure(
          `contagem do universo ${spec.universe.key}`,
          () => withStatementTimeout(UNIVERSE_TIMEOUT_MS, (tx) => readQueueUniverse(tx, (spec.universe as { key: QueueUniverseKey }).key)),
          () => now,
        )
      : null;
  const omdbSpent = await measure("api_sync_logs.quota_cost (omdb, hoje UTC)", () => readSpentToday(db, "omdb", now), () => now);
  return {
    context: {
      eligible: universe !== null && universe.ok ? universe.value : null,
      perCycle: perCycle.items,
      omdb: { spentToday: omdbSpent.ok ? omdbSpent.value : null },
    },
    perCycle,
    universe,
    omdbSpent,
  };
}
